"""Tests for search providers and the HTTP layer, with network mocked out.

The Kagi fixtures reproduce the REAL response envelopes observed live:

    no auth  -> 401 {"errors":[{"code":"general.no_authorization_provided",...}]}
    bad key  -> 400 {"errors":[{"code":"general.invalid_token",...}]}
    success  -> {"meta":{...},"data":[{"t":0,"url":...,"title":...,"snippet":...},
                                      {"t":1,"list":[...]}]}
"""

from __future__ import annotations

import json

import pytest

from jobsearch import http as http_mod
from jobsearch.config import Config
from jobsearch.http import HttpError, request
from jobsearch.search import KagiProvider, SearchError, build_provider


def _config(**env):
    base = {
        "JOBSEARCH_SEARCH_PROVIDER": "kagi",
        "SEARCH_API_KEY": "test-key",
        "JOBSEARCH_CACHE_DIR": "/tmp/jscache",
    }
    base.update(env)
    return Config.from_env(base)


def test_config_defaults_to_kagi():
    cfg = Config.from_env({})
    assert cfg.search_provider == "kagi"
    assert cfg.search_api_key is None


def test_config_reads_single_search_api_key():
    """One variable serves whichever provider is selected."""
    cfg = Config.from_env({"SEARCH_API_KEY": "k"})
    assert cfg.search_api_key == "k"


def test_legacy_provider_key_vars_are_ignored():
    cfg = Config.from_env({"KAGI_API_KEY": "k", "BRAVE_API_KEY": "b"})
    assert cfg.search_api_key is None


def test_shared_key_reaches_either_provider():
    assert build_provider(_config()).api_key == "test-key"
    brave = build_provider(_config(JOBSEARCH_SEARCH_PROVIDER="brave"))
    assert brave.name == "brave" and brave.api_key == "test-key"


def test_kagi_requires_key():
    with pytest.raises(SearchError, match="SEARCH_API_KEY"):
        KagiProvider(None)


def test_brave_requires_key():
    from jobsearch.search import BraveProvider

    with pytest.raises(SearchError, match="SEARCH_API_KEY"):
        BraveProvider(None)


def test_build_provider_unknown():
    with pytest.raises(SearchError, match="Unknown search provider"):
        build_provider(_config(JOBSEARCH_SEARCH_PROVIDER="nope"))


def test_build_provider_selects_brave():
    p = build_provider(_config(JOBSEARCH_SEARCH_PROVIDER="brave"))
    assert p.name == "brave"


# Captured from the LIVE Kagi v1 API. `data` is an OBJECT with a `search` list,
# not a list of typed objects -- assuming otherwise made the provider entirely
# non-functional against production (see test_kagi_live_shape below).
LIVE_KAGI_PAYLOAD = {
    "meta": {"trace": "014fb5badfec036aa16e0cafa667d5c6", "ms": 786, "node": "us-central1"},
    "data": {
        "search": [
            {
                "url": "https://jobs.ashbyhq.com/middesk/0a706e5b-e064-4662-ac6e-9cd28b4fa7d8",
                "title": "Chief of Staff @ Middesk",
                "snippet": "As <strong>Chief</strong> of <strong>Staff</strong>, you&#39;ll work "
                "directly with our CEO to advance the company&#39;s most important priorities",
                "time": "2026-11-08T14:20:48Z",
                "props": {"language": "en", "group_id": "jobs.ashbyhq.com"},
            },
            {
                "url": "https://jobs.ashbyhq.com/haydenai/1629ef11-5399-465",
                "title": "Chief of Staff @ Hayden AI",
                "snippet": "Lead strategy.",
                "time": "2026-11-01T00:00:00Z",
                "props": {"group_id": "jobs.ashbyhq.com"},
            },
        ]
    },
}


def test_kagi_parses_live_v1_shape(monkeypatch):
    """Regression (#10): the provider assumed the legacy v0 shape
    (`data: [{"t": 0, ...}]`) and returned nothing / raised against the real
    v1 API, which returns `data: {"search": [...]}`."""
    captured = {}

    def fake_post(url, data, headers=None, **kw):
        captured["url"] = url
        captured["data"] = data
        captured["headers"] = headers
        return 200, LIVE_KAGI_PAYLOAD

    monkeypatch.setattr("jobsearch.search.post_json", fake_post)

    results = KagiProvider("test-key").search("site:jobs.ashbyhq.com (CoS)", limit=10)

    assert captured["url"] == "https://kagi.com/api/v1/search"
    assert captured["data"] == {"query": "site:jobs.ashbyhq.com (CoS)"}
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert len(results) == 2
    assert results[0].title == "Chief of Staff @ Middesk"
    assert "ashbyhq.com/middesk" in results[0].url


def test_kagi_strips_highlight_markup_from_snippets(monkeypatch):
    """Live snippets carry <strong> tags and HTML entities; users must not see them."""
    monkeypatch.setattr(
        "jobsearch.search.post_json", lambda *a, **k: (200, LIVE_KAGI_PAYLOAD)
    )
    results = KagiProvider("k").search("q")
    snippet = results[0].snippet
    assert "<strong>" not in snippet
    assert "&#39;" not in snippet
    assert "you'll" in snippet


def test_kagi_respects_limit(monkeypatch):
    monkeypatch.setattr(
        "jobsearch.search.post_json", lambda *a, **k: (200, LIVE_KAGI_PAYLOAD)
    )
    assert len(KagiProvider("k").search("q", limit=1)) == 1


def test_kagi_tolerates_empty_and_odd_data(monkeypatch):
    for payload in (
        {"data": {}},
        {"data": {"search": []}},
        {"data": None},
        {"data": {"search": ["not a dict", {"no_url": 1}]}},
        {},
    ):
        monkeypatch.setattr(
            "jobsearch.search.post_json", lambda *a, _p=payload, **k: (200, _p)
        )
        assert KagiProvider("k").search("q") == []


def test_kagi_still_accepts_legacy_list_shape(monkeypatch):
    """The legacy list-of-objects shape must not break (without relying on it)."""
    payload = {"data": [{"url": "https://x/1", "title": "T", "snippet": "s"}]}
    monkeypatch.setattr("jobsearch.search.post_json", lambda *a, **k: (200, payload))
    results = KagiProvider("k").search("q")
    assert [r.url for r in results] == ["https://x/1"]


def test_kagi_respects_limit_on_legacy_list_shape(monkeypatch):
    payload = {"data": [{"t": 0, "url": f"https://x/{i}", "title": "t"} for i in range(50)]}
    monkeypatch.setattr("jobsearch.search.post_json", lambda *a, **k: (200, payload))
    assert len(KagiProvider("k").search("q", limit=3)) == 3


def test_kagi_surfaces_api_errors(monkeypatch):
    """Real failure envelope: 400 + errors[] must raise, not return empty."""
    payload = {
        "meta": {"trace": "x"},
        "data": None,
        "errors": [
            {
                "code": "general.invalid_token",
                "message": "Token signature failed to verify.",
            }
        ],
    }
    monkeypatch.setattr("jobsearch.search.post_json", lambda *a, **k: (400, payload))
    with pytest.raises(SearchError, match="invalid_token|Token signature"):
        KagiProvider("bad").search("q")


def test_kagi_401_reports_missing_key(monkeypatch):
    def boom(*a, **k):
        raise HttpError("https://kagi.com/api/v1/search", 401, "")

    monkeypatch.setattr("jobsearch.search.post_json", boom)
    with pytest.raises(SearchError, match="no API key sent.*SEARCH_API_KEY"):
        KagiProvider("k").search("q")


def test_kagi_invalid_token_message_is_actionable(monkeypatch):
    """Regression: the raw body is long and truncated mid-sentence; the user
    needs the cause and the fix, not a JSON blob."""
    body = json.dumps(
        {
            "meta": {"trace": "x"},
            "data": None,
            "errors": [
                {
                    "code": "general.invalid_token",
                    "message": "Token signature failed to verify. Ensure your "
                    "token has been correctly copied from your dashboard.",
                }
            ],
        }
    )

    def boom(*a, **k):
        raise HttpError("https://kagi.com/api/v1/search", 400, body)

    monkeypatch.setattr("jobsearch.search.post_json", boom)
    with pytest.raises(SearchError) as exc:
        KagiProvider("k").search("q")
    msg = str(exc.value)
    assert "SEARCH_API_KEY" in msg
    assert "{" not in msg, "must not leak the raw JSON body"
    assert "Traceback" not in msg


def test_kagi_402_reports_billing(monkeypatch):
    def boom(*a, **k):
        raise HttpError("https://kagi.com/api/v1/search", 402, "insufficient balance")

    monkeypatch.setattr("jobsearch.search.post_json", boom)
    with pytest.raises(SearchError, match="balance exhausted"):
        KagiProvider("k").search("q")


def test_kagi_429_reports_rate_limit(monkeypatch):
    def boom(*a, **k):
        raise HttpError("https://kagi.com/api/v1/search", 429, "")

    monkeypatch.setattr("jobsearch.search.post_json", boom)
    with pytest.raises(SearchError, match="rate limit"):
        KagiProvider("k").search("q")


def test_brave_401_reports_key(monkeypatch):
    from jobsearch.search import BraveProvider

    def boom(*a, **k):
        raise HttpError("https://api.search.brave.com", 401, "")

    monkeypatch.setattr("jobsearch.search.get_json", boom)
    with pytest.raises(SearchError, match="Brave rejected the API key"):
        BraveProvider("k").search("q")


def test_search_fallback_stops_after_first_fatal_error(monkeypatch):
    """Regression: an auth failure used to produce one identical warning per
    domain and waste quota retrying."""
    from jobsearch import pipeline as p
    from jobsearch.models import SearchProfile

    monkeypatch.setattr(p, "discover_boards", lambda *a, **k: [])
    calls = {"n": 0}

    class Provider:
        name = "stub"

        def search(self, query, limit=20):
            calls["n"] += 1
            from jobsearch.search import SearchError

            raise SearchError("Kagi rejected the API key")

    result = p.run_search(
        SearchProfile(titles=["engineer"]), companies=["Amazon"], provider=Provider()
    )
    assert calls["n"] == 1, "must not retry an identical auth failure per domain"
    assert len(result.warnings) == 1


def test_kagi_handles_null_data(monkeypatch):
    monkeypatch.setattr("jobsearch.search.post_json", lambda *a, **k: (200, {"data": None}))
    assert KagiProvider("k").search("q") == []


def test_parse_failure_is_not_reported_as_http_200(monkeypatch):
    """Regression (#7): a JSON parse failure used to raise `HTTP 200 for ...`,
    which reads as success. It must identify itself as a parse failure."""

    class Resp:
        status = 200

        def read(self):
            return b"<!DOCTYPE html><html>nope</html>"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(http_mod.urllib.request, "urlopen", lambda *a, **k: Resp())
    from jobsearch.http import get_json

    with pytest.raises(HttpError) as exc:
        get_json("https://tenant.example/careers/list")
    msg = str(exc.value)
    assert "HTTP 200 for" not in msg, "must not present a parse failure as success"
    assert "non-JSON" in msg
    assert "<html" not in msg.lower(), "HTML body must not leak into the message"
    assert exc.value.kind == "parse"
    assert exc.value.is_missing_board is True


def test_http_404_is_missing_board_but_500_is_not():
    assert HttpError("u", 404, "", "status").is_missing_board is True
    assert HttpError("u", 500, "", "status").is_missing_board is False
    assert HttpError("u", 403, "", "status").is_missing_board is False


def test_get_json_raises_httperror_on_html(monkeypatch):
    """Regression: non-JSON bodies (per-tenant ATSes return HTML) must surface as
    HttpError so slug probing treats them as 'no board', not a crash."""

    class Resp:
        status = 200

        def read(self):
            return b"<!DOCTYPE html><html>Not Found</html>"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(http_mod.urllib.request, "urlopen", lambda *a, **k: Resp())
    from jobsearch.http import get_json

    with pytest.raises(HttpError) as exc:
        get_json("https://tenant.example/careers/list")
    assert "Not Found" in exc.value.body or exc.value.status == 200


def test_http_get_json_parses(monkeypatch):
    class Resp:
        status = 200

        def read(self):
            return b'{"ok": true}'

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(http_mod.urllib.request, "urlopen", lambda *a, **k: Resp())
    status, body = request("https://example.test/x")
    assert status == 200 and json.loads(body) == {"ok": True}


def test_http_raises_on_client_error(monkeypatch):
    import io
    import urllib.error

    def fake_urlopen(req, timeout=None):
        raise urllib.error.HTTPError(
            "https://x", 404, "nf", {}, io.BytesIO(b'{"status":404}')
        )

    monkeypatch.setattr(http_mod.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(HttpError) as exc:
        request("https://x", retries=1)
    assert exc.value.status == 404


def test_http_retries_then_succeeds(monkeypatch):
    import io
    import urllib.error

    calls = {"n": 0}

    class Resp:
        status = 200

        def read(self):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError("https://x", 503, "busy", {}, io.BytesIO(b""))
        return Resp()

    monkeypatch.setattr(http_mod.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(http_mod.time, "sleep", lambda *_: None)

    status, _ = request("https://x", retries=3)
    assert status == 200
    assert calls["n"] == 2, "should retry once on 503"
