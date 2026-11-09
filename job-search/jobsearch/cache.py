"""On-disk response cache for ATS lookups.

Why this exists: a single search refetches whole boards (Stripe alone is 767
postings) on every run, which is slow and discards nothing. Boards change on the
order of hours, not seconds, so a short TTL removes almost all of that cost.

Deliberately simple and opt-in:

  * Disabled by default (`JOBSEARCH_CACHE_TTL=0`), because stale data in a job
    search is a correctness risk and the caller should choose it explicitly.
  * Keyed by a hash of the request URL, so different queries never collide.
  * Any cache failure (permissions, corrupt JSON, clock skew) degrades to a miss
    and a normal fetch. The cache must never be able to break a run.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any


def _key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]


def _path(cache_dir: str, url: str) -> str:
    return os.path.join(cache_dir, f"{_key(url)}.json")


def get(url: str, *, ttl: float, cache_dir: str) -> Any | None:
    """Return the cached payload for `url`, or None on miss/expiry/any error."""
    if ttl <= 0 or not cache_dir:
        return None
    path = _path(cache_dir, url)
    try:
        if time.time() - os.path.getmtime(path) > ttl:
            return None
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def put(url: str, payload: Any, *, cache_dir: str) -> None:
    """Store `payload` for `url`. Silently does nothing on any failure."""
    if not cache_dir:
        return
    try:
        os.makedirs(cache_dir, exist_ok=True)
        path = _path(cache_dir, url)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, path)  # atomic: readers never see a partial file
    except Exception:
        return


def clear(cache_dir: str) -> int:
    """Delete cached entries; returns how many files were removed."""
    if not cache_dir or not os.path.isdir(cache_dir):
        return 0
    removed = 0
    for name in os.listdir(cache_dir):
        if name.endswith(".json"):
            try:
                os.remove(os.path.join(cache_dir, name))
                removed += 1
            except OSError:
                pass
    return removed
