"""Minimal stdlib HTTP client with retries.

Uses urllib so the skill has zero third-party runtime dependencies. Handles the
retryable cases we actually observed against live hosts: connection resets,
429s, and 5xx.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

from .config import DEFAULT_UA

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class HttpError(RuntimeError):
    """A request failed, or returned something we could not use.

    `kind` distinguishes the two, because reporting a JSON parse failure as
    "HTTP 200" is actively misleading -- 200 means the request succeeded. Use
    `is_missing_board` to tell a genuine "no such board" (404, or a per-tenant
    host answering with HTML) from a transient problem worth retrying.
    """

    #: "status" for a non-2xx response, "parse" for an unusable body.
    kind = "status"

    def __init__(self, url: str, status: int, body: str, kind: str = "status") -> None:
        self.url = url
        self.status = status
        self.body = body
        self.kind = kind
        if kind == "parse":
            summary = f"unexpected non-JSON response from {url} (HTTP {status})"
        else:
            summary = f"HTTP {status} for {url}: {body[:200]}"
        super().__init__(summary)

    @property
    def is_missing_board(self) -> bool:
        """True when this most likely means 'this company has no board here'."""
        return self.status == 404 or self.kind == "parse"


def request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = 20.0,
    retries: int = 3,
    backoff: float = 0.5,
) -> tuple[int, bytes]:
    """Perform an HTTP request, retrying transient failures.

    Returns (status, body). Raises HttpError for non-retryable error statuses so
    callers can distinguish "this slug does not exist" from "network is down".
    """
    hdrs = {"User-Agent": DEFAULT_UA, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)

    last_exc: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            if exc.code in RETRYABLE_STATUS and attempt < retries - 1:
                last_exc = HttpError(url, exc.code, payload.decode("utf-8", "replace"))
                time.sleep(backoff * (2**attempt))
                continue
            raise HttpError(url, exc.code, payload.decode("utf-8", "replace")) from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(backoff * (2**attempt))
                continue
            raise
    raise RuntimeError(f"exhausted retries for {url}: {last_exc}")


def get_json(
    url: str, *, cache_ttl: float = 0.0, cache_dir: str = "", **kwargs: Any
) -> Any:
    """GET and parse JSON, optionally through a short-lived on-disk cache.

    Caching is opt-in via cache_ttl > 0 and is read-through only: a miss or any
    cache error falls back to a normal request. Only GETs are cached -- POSTs
    (the search API) are billed per call and should never be replayed silently.
    """
    if cache_ttl > 0:
        from . import cache

        hit = cache.get(url, ttl=cache_ttl, cache_dir=cache_dir)
        if hit is not None:
            return hit

    status, payload = request(url, **kwargs)
    try:
        parsed = json.loads(payload)
    except (ValueError, UnicodeDecodeError) as exc:
        # Per-tenant ATSes (BambooHR) answer an unknown tenant with an HTML error
        # page, not JSON. Surface that as a normal HTTP-style failure so slug
        # probing treats it as "no such board" rather than crashing the run.
        raise HttpError(
            url, status, payload[:200].decode("utf-8", "replace"), kind="parse"
        ) from exc

    if cache_ttl > 0:
        from . import cache

        cache.put(url, parsed, cache_dir=cache_dir)
    return parsed


def post_json(
    url: str, data: dict[str, Any], *, headers: dict[str, str] | None = None, **kwargs: Any
) -> tuple[int, Any]:
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    status, payload = request(
        url, method="POST", headers=hdrs, body=json.dumps(data).encode(), **kwargs
    )
    try:
        return status, json.loads(payload)
    except json.JSONDecodeError:
        return status, payload.decode("utf-8", "replace")
