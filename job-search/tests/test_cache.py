"""Tests for the on-disk response cache (B4).

The cache must never be able to break a run: every failure path degrades to a
miss. These tests cover that contract, not just the happy path.
"""

from __future__ import annotations

import json
import os

from jobsearch import cache


def test_miss_on_empty_dir(tmp_path):
    assert cache.get("https://x/1", ttl=60, cache_dir=str(tmp_path)) is None


def test_put_then_get_roundtrip(tmp_path):
    url = "https://x/1"
    cache.put(url, {"jobs": [1, 2]}, cache_dir=str(tmp_path))
    assert cache.get(url, ttl=60, cache_dir=str(tmp_path)) == {"jobs": [1, 2]}


def test_expiry(tmp_path):
    url = "https://x/1"
    cache.put(url, {"a": 1}, cache_dir=str(tmp_path))
    path = os.path.join(str(tmp_path), f"{cache._key(url)}.json")
    old = os.path.getmtime(path) - 1000
    os.utime(path, (old, old))
    assert cache.get(url, ttl=60, cache_dir=str(tmp_path)) is None


def test_ttl_zero_disables_cache(tmp_path):
    url = "https://x/1"
    cache.put(url, {"a": 1}, cache_dir=str(tmp_path))
    assert cache.get(url, ttl=0, cache_dir=str(tmp_path)) is None


def test_different_urls_do_not_collide(tmp_path):
    cache.put("https://x/1", {"v": 1}, cache_dir=str(tmp_path))
    cache.put("https://x/2", {"v": 2}, cache_dir=str(tmp_path))
    assert cache.get("https://x/1", ttl=60, cache_dir=str(tmp_path)) == {"v": 1}
    assert cache.get("https://x/2", ttl=60, cache_dir=str(tmp_path)) == {"v": 2}


def test_corrupt_entry_is_a_miss(tmp_path):
    url = "https://x/1"
    path = os.path.join(str(tmp_path), f"{cache._key(url)}.json")
    with open(path, "w") as fh:
        fh.write("{not json")
    assert cache.get(url, ttl=60, cache_dir=str(tmp_path)) is None


def test_unwritable_dir_never_raises():
    """A bad cache dir must degrade to a miss, not crash the fetch."""
    cache.put("https://x/1", {"a": 1}, cache_dir="/proc/definitely/not/writable")
    assert cache.get("https://x/1", ttl=60, cache_dir="/proc/definitely/not/writable") is None


def test_empty_cache_dir_is_noop():
    cache.put("https://x/1", {"a": 1}, cache_dir="")
    assert cache.get("https://x/1", ttl=60, cache_dir="") is None


def test_clear_removes_entries(tmp_path):
    cache.put("https://x/1", {"a": 1}, cache_dir=str(tmp_path))
    cache.put("https://x/2", {"b": 2}, cache_dir=str(tmp_path))
    assert cache.clear(str(tmp_path)) == 2
    assert cache.get("https://x/1", ttl=60, cache_dir=str(tmp_path)) is None


def test_clear_on_missing_dir(tmp_path):
    assert cache.clear(str(tmp_path / "nope")) == 0


def test_get_json_uses_cache(monkeypatch, tmp_path):
    """The HTTP layer must read through the cache and not refetch on a hit."""
    from jobsearch import http as http_mod

    calls = {"n": 0}

    class Resp:
        status = 200

        def read(self):
            return b'{"v": 1}'

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(*a, **k):
        calls["n"] += 1
        return Resp()

    monkeypatch.setattr(http_mod.urllib.request, "urlopen", fake_urlopen)
    d = str(tmp_path)

    assert http_mod.get_json("https://y/1", cache_ttl=60, cache_dir=d) == {"v": 1}
    assert http_mod.get_json("https://y/1", cache_ttl=60, cache_dir=d) == {"v": 1}
    assert calls["n"] == 1, "second call must be served from cache"

    # Disabled cache always refetches.
    http_mod.get_json("https://y/1", cache_ttl=0, cache_dir=d)
    assert calls["n"] == 2


def test_post_json_is_never_cached(monkeypatch, tmp_path):
    """The search API is billed per call; it must never be replayed silently."""
    from jobsearch import http as http_mod

    calls = {"n": 0}

    class Resp:
        status = 200

        def read(self):
            return b'{"data": []}'

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(*a, **k):
        calls["n"] += 1
        return Resp()

    monkeypatch.setattr(http_mod.urllib.request, "urlopen", fake_urlopen)
    http_mod.post_json("https://z/1", {"query": "q"})
    http_mod.post_json("https://z/1", {"query": "q"})
    assert calls["n"] == 2


def test_cache_json_is_valid_json(tmp_path):
    cache.put("https://x/1", {"a": [1, {"b": 2}]}, cache_dir=str(tmp_path))
    files = [f for f in os.listdir(str(tmp_path)) if f.endswith(".json")]
    assert len(files) == 1
    with open(os.path.join(str(tmp_path), files[0])) as fh:
        assert json.load(fh) == {"a": [1, {"b": 2}]}
