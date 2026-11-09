"""Configuration for the job-search skill.

All configuration is environment-driven so the skill can be dropped into any
agent harness (pi, Claude Code, cron) without a config file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_UA = "job-search-skill/1.0 (+https://github.com/)"


@dataclass(frozen=True)
class Config:
    search_provider: str
    #: Key for whichever search backend is selected. Env: SEARCH_API_KEY.
    search_api_key: str | None
    http_timeout: float
    #: Seconds to cache ATS board responses; 0 disables caching entirely.
    cache_ttl: float = 0.0
    #: Directory for the on-disk response cache.
    cache_dir: str = ""

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Config":
        e = os.environ if env is None else env
        return cls(
            search_provider=e.get("JOBSEARCH_SEARCH_PROVIDER", "kagi").lower(),
            search_api_key=e.get("SEARCH_API_KEY") or None,
            http_timeout=float(e.get("JOBSEARCH_HTTP_TIMEOUT", "20")),
            cache_ttl=float(e.get("JOBSEARCH_CACHE_TTL", "0")),
            cache_dir=e.get(
                "JOBSEARCH_CACHE_DIR",
                os.path.join(os.path.expanduser("~"), ".cache", "jobsearch"),
            ),
        )
