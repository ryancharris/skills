"""Search-engine providers.

The skill treats the search engine as pluggable. Kagi is the default and the
first-class implementation because its API contract was verified live:

    POST https://kagi.com/api/v1/search
    Authorization: Bearer $SEARCH_API_KEY
    {"query": "..."}

    -> {"meta": {...}, "data": [{"t": 0, "url": ..., "title": ..., "snippet": ...}] | null,
        "errors": [{"code": ..., "message": ...}]?}

Errors observed live:
    401 general.no_authorization_provided
    400 general.invalid_token
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any

from ..http import HttpError, post_json, get_json

# Kagi returns snippets with inline HTML highlighting (<strong>…</strong>).
_TAG = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    """Remove markup and unescape entities from a result snippet."""
    return html.unescape(_TAG.sub("", text)).strip()


@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str = ""

    def to_dict(self) -> dict[str, str]:
        return {"url": self.url, "title": self.title, "snippet": self.snippet}


class SearchError(RuntimeError):
    pass


class SearchProvider:
    name = "base"

    def search(self, query: str, limit: int = 20) -> list[SearchResult]:  # pragma: no cover
        raise NotImplementedError


def _kagi_http_error(exc: HttpError) -> str:
    """Turn a Kagi HTTP failure into one short, actionable sentence.

    Kagi returns its real reason in the JSON body (`errors[].message`). The raw
    body is long and gets truncated mid-sentence, which is useless to a user, so
    extract the code/message and add the fix for the common auth failures.
    """
    import json as _json

    code = ""
    message = ""
    try:
        payload = _json.loads(exc.body)
        errors = payload.get("errors") or []
        if errors:
            code = str(errors[0].get("code", ""))
            message = str(errors[0].get("message", ""))
    except Exception:
        pass

    if code == "general.no_authorization_provided" or exc.status == 401:
        return "Kagi rejected the request: no API key sent. Export SEARCH_API_KEY."
    if code == "general.invalid_token" or exc.status == 400 and message:
        return (
            "Kagi rejected the API key (invalid_token). Check that SEARCH_API_KEY "
            "is complete and has no extra spaces."
        )
    if exc.status == 402 or "insufficient" in message.lower():
        return "Kagi balance exhausted. Top up at https://kagi.com/api/billing."
    if exc.status == 429:
        return "Kagi rate limit hit. Retry shortly."
    detail = message or f"HTTP {exc.status}"
    return f"Kagi search failed: {detail}"


class KagiProvider(SearchProvider):
    name = "kagi"
    ENDPOINT = "https://kagi.com/api/v1/search"

    def __init__(self, api_key: str | None, timeout: float = 20.0) -> None:
        if not api_key:
            raise SearchError(
                "SEARCH_API_KEY is not set. Create a Kagi key at "
                "https://kagi.com/settings/api and export SEARCH_API_KEY=your-key"
            )
        self.api_key = api_key
        self.timeout = timeout

    def search(self, query: str, limit: int = 20) -> list[SearchResult]:
        try:
            status, payload = post_json(
                self.ENDPOINT,
                {"query": query},
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=self.timeout,
            )
        except HttpError as exc:
            raise SearchError(_kagi_http_error(exc)) from exc

        if not isinstance(payload, dict):
            raise SearchError(f"Unexpected Kagi response: {payload!r}")
        if payload.get("errors"):
            msg = "; ".join(e.get("message", e.get("code", "?")) for e in payload["errors"])
            raise SearchError(f"Kagi API error: {msg}")

        # Verified against the live v1 API:
        #   {"meta": {...}, "data": {"search": [{"url", "title", "snippet",
        #      "time", "props": {...}}, ...]}}
        # `data` is an OBJECT with a `search` list -- not a list of typed
        # objects. An earlier version assumed the legacy v0 shape
        # (`data: [{"t": 0, ...}]`) and was non-functional against v1: every
        # query either produced no results or raised AttributeError.
        data = payload.get("data")
        items: list[Any] = []
        if isinstance(data, dict):
            items = data.get("search") or []
        elif isinstance(data, list):
            # Tolerate the legacy shape too, without depending on it.
            items = data

        results: list[SearchResult] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            url = item.get("url")
            if not url:
                continue
            results.append(
                SearchResult(
                    url=str(url),
                    title=str(item.get("title") or ""),
                    snippet=_strip_html(str(item.get("snippet") or "")),
                )
            )
            if len(results) >= limit:
                break
        return results


class BraveProvider(SearchProvider):
    name = "brave"
    ENDPOINT = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str | None, timeout: float = 20.0) -> None:
        if not api_key:
            raise SearchError(
                "SEARCH_API_KEY is not set. Create a Brave key at "
                "https://api.search.brave.com/ and export SEARCH_API_KEY=your-key"
            )
        self.api_key = api_key
        self.timeout = timeout

    def search(self, query: str, limit: int = 20) -> list[SearchResult]:
        from urllib.parse import quote

        url = f"{self.ENDPOINT}?q={quote(query)}&count={min(limit, 20)}"
        try:
            payload = get_json(
                url,
                headers={"X-Subscription-Token": self.api_key, "Accept": "application/json"},
                timeout=self.timeout,
            )
        except HttpError as exc:
            if exc.status in (401, 403):
                raise SearchError(
                    "Brave rejected the API key. Check SEARCH_API_KEY."
                ) from exc
            if exc.status == 429:
                raise SearchError("Brave rate limit hit. Retry shortly.") from exc
            raise SearchError(f"Brave search failed: HTTP {exc.status}") from exc
        out: list[SearchResult] = []
        for item in payload.get("web", {}).get("results", [])[:limit]:
            out.append(
                SearchResult(
                    url=item.get("url", ""),
                    title=item.get("title", ""),
                    snippet=item.get("description", "") or "",
                )
            )
        return out


def build_provider(config) -> SearchProvider:
    """Instantiate the configured search provider.

    One key serves whichever backend is selected (SEARCH_API_KEY), so switching
    providers is a one-variable change.
    """
    name = config.search_provider
    if name == "kagi":
        return KagiProvider(config.search_api_key, timeout=config.http_timeout)
    if name == "brave":
        return BraveProvider(config.search_api_key, timeout=config.http_timeout)
    raise SearchError(
        f"Unknown search provider {name!r}. Supported: kagi, brave. "
        "Set JOBSEARCH_SEARCH_PROVIDER."
    )
