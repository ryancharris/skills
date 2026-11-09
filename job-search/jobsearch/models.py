"""Shared data models for the job-search skill.

Everything here is plain stdlib dataclasses so the skill stays importable in any
agent harness without third-party dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


@dataclass
class Job:
    """A single normalized job posting from any source."""

    title: str
    company: str
    url: str
    source: str  # "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "search"
    location: str = ""
    remote: bool | None = None
    department: str = ""
    employment_type: str = ""
    posted_at: str | None = None  # ISO-8601 string, best-effort
    compensation: str | None = None
    identifier: str = ""  # provider-specific id, used for dedupe within a board
    snippet: str = ""  # only for search-sourced results

    def dedupe_key(self) -> tuple[str, str]:
        """Stable key for collapsing the same posting seen twice.

        Prefer the canonical URL (always unique per posting). Within one board
        the provider id is more stable than a URL that may carry tracking, so
        use it when present.
        """
        if self.identifier:
            return (self.source, f"{self.company}:{self.identifier}".lower())
        return (self.source, self.url.rstrip("/").lower())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Board:
    """A company's job board on a specific ATS."""

    company: str
    ats: str
    slug: str
    job_count: int = 0
    url: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SearchProfile:
    """User-supplied search inputs that refine results."""

    titles: list[str] = field(default_factory=list)
    locations: list[str] = field(default_factory=list)
    remote_only: bool = False
    seniority: list[str] = field(default_factory=list)
    include_keywords: list[str] = field(default_factory=list)
    exclude_keywords: list[str] = field(default_factory=list)
    exclude_companies: list[str] = field(default_factory=list)
    max_age_days: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso(value: str | None) -> datetime | None:
    """Parse the assorted ISO-8601 timestamps the ATSes return.

    Returns None on anything unparseable rather than raising, because freshness
    is a nice-to-have and must never break a run.
    """
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
