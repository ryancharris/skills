"""Search-profile expansion and job filtering.

Two jobs:
  1. Turn a user's short title list into boolean search groups, so the
     `site:` queries catch synonyms ("chief of staff" OR "CoS" OR "chief of staff
     to CEO") exactly like the source post suggests.
  2. Filter normalized `Job` objects by location, remote, seniority, keyword and
     exclusion rules.
"""

from __future__ import annotations

import re

from .models import Job, SearchProfile, parse_iso, utc_now

# Common title synonyms, keyed by a matching stem. Extend via the profile.
TITLE_SYNONYMS: dict[str, list[str]] = {
    "chief of staff": ["chief of staff", "CoS", "chief of staff to CEO"],
    "software engineer": ["software engineer", "SWE", "software developer"],
    "site reliability": ["site reliability engineer", "SRE"],
    "product manager": ["product manager", "PM"],
    "data scientist": ["data scientist", "DS"],
    "machine learning": ["machine learning engineer", "ML engineer", "MLE"],
    "engineering manager": ["engineering manager", "EM", "manager, engineering"],
    "designer": ["product designer", "UX designer", "UI designer"],
    "devops": ["devops engineer", "platform engineer"],
}

SENIORITY_TERMS = {
    "intern": ["intern", "internship"],
    "junior": ["junior", "jr", "entry level", "associate"],
    "mid": ["mid", "intermediate", "ii"],
    "senior": ["senior", "sr", "staff", "lead", "principal"],
    "director": ["director", "vp", "head of", "chief"],
}


def expand_titles(titles: list[str]) -> list[list[str]]:
    """Expand each title into a synonym group (each group is OR-ed)."""
    groups: list[list[str]] = []
    for title in titles:
        low = title.lower().strip()
        group = [title]
        for stem, syns in TITLE_SYNONYMS.items():
            if stem in low:
                for s in syns:
                    if s.lower() not in {g.lower() for g in group}:
                        group.append(s)
        groups.append(group)
    return groups


def build_site_query(domain: str, title_groups: list[list[str]], extras: list[str] | None = None) -> str:
    """Build a boolean `site:` query, e.g.

    site:jobs.ashbyhq.com ("chief of staff" OR "CoS") (remote)
    """
    parts = [f"site:{domain}"]
    for group in title_groups:
        terms = " OR ".join(f'"{t}"' for t in group)
        parts.append(f"({terms})")
    for extra in extras or []:
        parts.append(f'"{extra}"' if " " in extra else extra)
    return " ".join(parts)


def build_discovery_query(company: str) -> str:
    """Query to find which ATS a company uses when API probing fails."""
    return f'"{company}" (careers OR jobs) (greenhouse OR lever OR ashby OR workday)'


def _matches_location(job: Job, locations: list[str]) -> bool:
    if not locations:
        return True
    hay = f"{job.location}".lower()
    return any(loc.lower() in hay for loc in locations)


# Word boundaries so short terms match as words, not substrings. Without this,
# the synonym "PM" matches the "pm" inside "Develo**pm**ent", and keyword "go"
# matches "MongoDB". Multi-word phrases still work: their space is a boundary.
_WORD_START = r"(?<![a-z0-9])"
_WORD_END = r"(?![a-z0-9])"


def _contains_term(haystack: str, term: str) -> bool:
    """Case-insensitive word-boundary containment, used by every text filter."""
    if not term:
        return False
    pattern = _WORD_START + re.escape(term.lower()) + _WORD_END
    return re.search(pattern, haystack.lower()) is not None


def _matches_text(haystack: str, needles: list[str]) -> bool:
    return all(_contains_term(haystack, n) for n in needles)


def title_contains(title: str, term: str) -> bool:
    """Does `title` contain `term` as a word? See _contains_term for why."""
    return _contains_term(title, term)


def matches(job: Job, profile: SearchProfile, *, now=None) -> bool:
    """True if the job satisfies every active constraint in the profile."""
    now = now or utc_now()

    if profile.remote_only and not (job.remote or "remote" in job.location.lower()):
        return False

    if not _matches_location(job, profile.locations):
        return False

    if profile.titles:
        groups = expand_titles(profile.titles)
        if not any(any(title_contains(job.title, t) for t in group) for group in groups):
            return False

    if profile.seniority:
        terms = [t for s in profile.seniority for t in SENIORITY_TERMS.get(s.lower(), [s.lower()])]
        if not any(title_contains(job.title, t) for t in terms):
            return False

    if profile.include_keywords:
        blob = f"{job.title} {job.department} {job.location} {job.snippet}"
        if not _matches_text(blob, profile.include_keywords):
            return False

    if profile.exclude_keywords:
        blob = f"{job.title} {job.department} {job.snippet}"
        if any(_contains_term(blob, k) for k in profile.exclude_keywords):
            return False

    if profile.exclude_companies:
        comp = job.company.lower()
        if any(c.lower() in comp for c in profile.exclude_companies):
            return False

    if profile.max_age_days is not None and job.posted_at:
        posted = parse_iso(job.posted_at)
        if posted and (now - posted).days > profile.max_age_days:
            return False

    return True


def filter_jobs(jobs: list[Job], profile: SearchProfile, *, now=None) -> list[Job]:
    now = now or utc_now()
    return [j for j in jobs if matches(j, profile, now=now)]


def keyword_hits(job: Job, profile: SearchProfile) -> int:
    blob = f"{job.title} {job.department}"
    return sum(1 for k in profile.include_keywords if _contains_term(blob, k))


def rank_jobs(jobs: list[Job], profile: SearchProfile, *, now=None) -> list[Job]:
    """Order jobs by relevance to the profile.

    Score = keyword hits + title-synonym hits, tie-broken by recency. Freshness
    is a separate axis so a perfect title match with no date still ranks above
    an unrelated fresh posting.
    """
    now = now or utc_now()
    groups = expand_titles(profile.titles) if profile.titles else []

    def title_hits(job: Job) -> int:
        return sum(1 for g in groups if any(title_contains(job.title, t) for t in g))

    def age_days(job: Job) -> float:
        posted = parse_iso(job.posted_at)
        if not posted:
            return 3650.0
        return max(0.0, (now - posted).total_seconds() / 86400)

    def score(job: Job) -> tuple[int, int, float]:
        return (
            title_hits(job) + keyword_hits(job, profile),
            len(job.snippet) > 0,
            -age_days(job),
        )

    return sorted(jobs, key=score, reverse=True)
