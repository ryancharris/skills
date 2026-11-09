"""Pipeline orchestration: seed -> discover -> fetch -> filter -> rank -> emit."""

from __future__ import annotations

import concurrent.futures as cf
import html
import re
from dataclasses import dataclass, field

from .ats import all_adapters, shared_domain_site_targets
from .config import Config
from .discovery import discover_boards
from .filtering import (
    build_discovery_query,
    build_site_query,
    expand_titles,
    filter_jobs,
    rank_jobs,
)
from .hiring_signal import HiringSignal, summarize_hiring
from .models import Board, Job, SearchProfile
from .output import dedupe_jobs
from .search import SearchError, SearchProvider, build_provider


@dataclass
class RunResult:
    jobs: list[Job] = field(default_factory=list)
    boards: list[Board] = field(default_factory=list)
    #: Company names that were searched, in input order.
    companies: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    #: Per-company hiring signal, populated by `check_hiring`.
    signals: list[HiringSignal] = field(default_factory=list)

    #: Postings pulled from live boards before profile filtering.
    raw_count: int = 0
    #: Postings that satisfied the profile before cross-source dedupe.
    matched_count: int = 0

    def meta(self) -> dict:
        """Stage-by-stage counts, so a zero result is diagnosable.

        `raw` > 0 with `matched` == 0 means the boards had postings but the
        profile excluded them (widen the filters), not that discovery failed.
        """
        return {
            "companies searched": len(self.companies),
            "live boards": len([b for b in self.boards if b.job_count]),
            "raw postings": self.raw_count,
            "matched postings": self.matched_count,
            "returned": len(self.jobs),
            "queries offered": len(self.queries),
        }


def _fetch_board(
    board: Board, adapters, timeout: float, errors: list[str] | None = None
) -> list[Job]:
    """Fetch one board's postings.

    Returns [] on failure (never raises), but records why in `errors` when
    given. Silence here was a real bug: a board we know has 767 jobs returning
    nothing because of a timeout looked identical to a genuinely empty board, so
    `--check` could report "not hiring" for a company with 767 openings.
    """
    adapter = next((a for a in adapters if a.name == board.ats), None)
    if adapter is None:
        return []
    if adapter.timeout != timeout:
        adapter = type(adapter)(timeout)
    try:
        return adapter.fetch(board.slug)
    except Exception as exc:
        if errors is not None:
            errors.append(
                f"could not read {board.company}'s {board.ats} board "
                f"({type(exc).__name__}); counts may be understated"
            )
        return []


def resolve_companies(
    result: RunResult,
    *,
    companies: list[str],
    max_companies: int,
) -> None:
    """Normalize the requested company names: dedupe (case-insensitive), then cap."""
    seen: set[str] = set()
    unique: list[str] = []
    for name in companies:
        cleaned = " ".join(name.split())
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(cleaned)

    result.companies = unique[:max_companies]


def _resolve_boards(
    companies: list[str], adapters, result: RunResult
) -> tuple[list[Board], dict[str, list[Board]]]:
    """Discover boards for every company, keeping them grouped per company."""
    boards: list[Board] = []
    by_company: dict[str, list[Board]] = {c: [] for c in companies}

    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        # One error sink per company: threads must not append to a shared list.
        sinks: dict[str, list[str]] = {name: [] for name in companies}
        futs = {
            pool.submit(
                discover_boards, name, adapters=adapters, errors=sinks[name]
            ): name
            for name in companies
        }
        for fut in cf.as_completed(futs):
            name = futs[fut]
            try:
                found = fut.result()
            except Exception as exc:  # pragma: no cover - defensive
                result.warnings.append(f"Could not look up {name}: {exc}")
                continue
            by_company[name] = found
            boards.extend(found)

        # Drain per-company failures after all threads finish.
        for sink in sinks.values():
            result.warnings.extend(sink)

    boards.sort(key=lambda b: b.job_count, reverse=True)
    return boards, by_company


def _board_key(board: Board) -> tuple[str, str, str]:
    """Identity of one board.

    The ATS must be part of the key: the same company can hold the same slug on
    two vendors (Ramp has `ashby/ramp` with 169 jobs and `greenhouse/ramp` with
    1). Keying on (company, slug) made one silently overwrite the other, so a
    search reported 1 raw posting instead of 170.
    """
    return (board.company, board.ats, board.slug)


def _fetch_all(
    live: list[Board], adapters, timeout: float, result: RunResult
) -> dict[tuple[str, str, str], list[Job]]:
    """Fetch every live board, keyed by (company, ats, slug)."""
    fetched: dict[tuple[str, str, str], list[Job]] = {}
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        # Per-board sinks: threads must not append to a shared list.
        sinks: dict[tuple[str, str, str], list[str]] = {
            _board_key(b): [] for b in live
        }
        futs = {
            pool.submit(
                _fetch_board, b, adapters, timeout, sinks[_board_key(b)]
            ): b
            for b in live
        }
        for fut in cf.as_completed(futs):
            board = futs[fut]
            try:
                fetched[_board_key(board)] = fut.result()
            except Exception as exc:  # pragma: no cover - defensive
                result.warnings.append(
                    f"Could not read {board.company}'s job board: {exc}"
                )
                fetched[_board_key(board)] = []

        for sink in sinks.values():
            result.warnings.extend(sink)
    return fetched


def run_search(
    profile: SearchProfile,
    *,
    companies: list[str] | None = None,
    max_companies: int = 40,
    config: Config | None = None,
    adapters=None,
    provider: SearchProvider | None = None,
    search_limit: int = 15,
) -> RunResult:
    """Search live ATS boards at the named companies for roles matching `profile`."""
    config = config or Config.from_env()
    adapters = adapters or all_adapters(
        timeout=config.http_timeout,
        cache_ttl=config.cache_ttl,
        cache_dir=config.cache_dir,
    )
    result = RunResult()

    resolve_companies(result, companies=companies or [], max_companies=max_companies)

    if not result.companies:
        result.warnings.append("No companies to search. Pass --company NAME.")
        return result

    # 1) Resolve each company to live boards (parallel).
    boards, _ = _resolve_boards(result.companies, adapters, result)
    result.boards = boards

    # 2) Fetch postings from every live board (parallel).
    live = [b for b in boards if b.job_count]
    fetched = _fetch_all(live, adapters, config.http_timeout, result)
    raw: list[Job] = [job for jobs in fetched.values() for job in jobs]
    result.jobs = raw
    result.raw_count = len(raw)

    # 3) For companies with no live board, hand the agent a discovery query.
    resolved = {b.company for b in boards}
    for name in result.companies:
        if name not in resolved:
            result.queries.append(build_discovery_query(name))

    # 4) Offer boolean site: queries the agent can execute via the search API.
    if profile.titles:
        groups = expand_titles(profile.titles)
        for domain in shared_domain_site_targets():
            extras = list(profile.locations)
            result.queries.append(build_site_query(domain, groups, extras))

    # 5) Filter -> dedupe -> rank. Metrics use postings from boards we actually own.
    if raw:
        matched = filter_jobs(raw, profile)
        result.matched_count = len(matched)
        deduped = dedupe_jobs(matched)
        result.jobs = rank_jobs(deduped, profile)
        if not result.jobs:
            result.warnings.append(
                f"{len(raw)} open roles were found, but none matched your filters. "
                "Try a broader --title, a different --location, or remove "
                "--remote/--max-age-days."
            )
    else:
        # No API-sourced postings: fall back to the search engine, if configured.
        result.jobs = _search_fallback(profile, result, config, provider, search_limit)

    return result


def check_hiring(
    companies: list[str],
    *,
    recent_days: int = 30,
    max_companies: int = 40,
    config: Config | None = None,
    adapters=None,
) -> RunResult:
    """Answer "is this company hiring, and for what?" for each named company.

    This is the supported successor to seeding from WARN layoff filings. It
    starts from a company the user already cares about (e.g. one that just
    announced cuts) and reports the live board, open-role count, recency and the
    departments hiring most — the actionable "where are they re-investing"
    read that a filing feed could never provide.

    See jobsearch/hiring_signal.py for why the feed-based approach was removed.
    """
    config = config or Config.from_env()
    adapters = adapters or all_adapters(
        timeout=config.http_timeout,
        cache_ttl=config.cache_ttl,
        cache_dir=config.cache_dir,
    )
    result = RunResult()

    resolve_companies(result, companies=companies, max_companies=max_companies)
    if not result.companies:
        result.warnings.append("No companies to check. Pass --check COMPANY.")
        return result

    boards, by_company = _resolve_boards(result.companies, adapters, result)
    result.boards = boards

    live = [b for b in boards if b.job_count]
    fetched = _fetch_all(live, adapters, config.http_timeout, result)
    result.raw_count = sum(len(v) for v in fetched.values())

    for name in result.companies:
        company_boards = by_company.get(name, [])
        company_jobs = [
            job
            for board in company_boards
            for job in fetched.get(_board_key(board), [])
        ]
        result.signals.append(
            summarize_hiring(
                name, company_boards, company_jobs, recent_days=recent_days
            )
        )
        if not company_boards:
            result.queries.append(build_discovery_query(name))

    return result


def _search_fallback(
    profile: SearchProfile,
    result: RunResult,
    config: Config,
    provider: SearchProvider | None,
    search_limit: int,
) -> list[Job]:
    """Use the search engine when no ATS APIs produced postings."""
    if not profile.titles:
        return []
    try:
        provider = provider or build_provider(config)
    except SearchError as exc:
        result.warnings.append(f"Search fallback skipped: {exc}")
        return []

    jobs: list[Job] = []
    for domain in shared_domain_site_targets()[:3]:
        query = build_site_query(domain, expand_titles(profile.titles))
        try:
            hits = provider.search(query, limit=search_limit)
        except SearchError as exc:
            # An auth/quota error will fail identically on every domain, so
            # stop rather than emit the same warning three times and burn quota.
            result.warnings.append(str(exc))
            break
        for hit in hits:
            jobs.append(
                Job(
                    title=hit.title,
                    company=_company_from_url(hit.url, hit.title),
                    url=hit.url,
                    source="search",
                    snippet=hit.snippet,
                )
            )
    return dedupe_jobs(jobs)


_AT = re.compile(r"\s+(?:at|@)\s+(.+)$", re.IGNORECASE)


def _company_from_url(url: str, title: str = "") -> str:
    """Best-effort company name for a search-sourced result.

    ATS slugs make poor display names ("andurilindustries", "sodali_co"), so
    prefer the title, which usually ends "... at <Company>". Anything over-eager
    ("Chief of Staff at Series B Startup") is still better than a slug, and the
    URL fallback is title-cased by display_company().
    """
    match = _AT.search(title or "")
    if match:
        candidate = html.unescape(match.group(1)).strip(" .,-_")
        # Drop a trailing parenthetical, e.g. "Pendo (YC S14)".
        candidate = re.sub(r"\s*\([^)]*\)\s*$", "", candidate).strip()
        if candidate and len(candidate) <= 60:
            return candidate

    parts = [p for p in url.split("/") if p]
    # e.g. https://jobs.ashbyhq.com/<company>/<id>
    for i, p in enumerate(parts):
        if "." in p and i + 1 < len(parts):
            slug = html.unescape(parts[i + 1]).replace("_", " ").replace("-", " ")
            return " ".join(w.capitalize() if w.islower() else w for w in slug.split())
    return ""
