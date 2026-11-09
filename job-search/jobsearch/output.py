"""Dedupe and output formatting.

Results are emitted twice: JSON for machines (agents composing further steps)
and Markdown for humans. Provenance is preserved so a reader can tell where
each posting came from and whether it is fresh.
"""

from __future__ import annotations

import json

from .hiring_signal import display_company, friendly_department
from .models import Board, Job, parse_iso, utc_now


def _content_key(job: Job) -> tuple[str, str]:
    """Repost identity: normalised title + company + location.

    Deliberately excludes the provider id: two ids with the same title/company/
    location may be genuinely distinct requisitions (verified: Stripe posts
    several separate "Software Engineer" openings in Seattle).
    """
    return (
        " ".join(job.title.lower().split()),
        f"{job.company.lower()}|{job.location.lower()}",
    )


def dedupe_jobs(jobs: list[Job]) -> list[Job]:
    """Collapse the same posting seen on multiple sources.

    Only *cross-source* duplicates are collapsed. Within a single board, two
    postings with distinct provider ids are distinct openings and must both
    survive -- collapsing them would silently hide real jobs.

    Among cross-source duplicates, prefer a record with a real posting date and
    a longer location string (the origin board over an aggregator repost).
    """
    groups: dict[tuple[str, str], list[Job]] = {}
    order: list[tuple[str, str]] = []

    for job in jobs:
        key = _content_key(job)
        if key not in groups:
            groups[key] = [job]
            order.append(key)
            continue

        existing = groups[key]
        same_source = [j for j in existing if j.source == job.source]
        if same_source:
            # Same board. Distinct non-empty ids mean distinct requisitions
            # (keep both); otherwise treat it as the same posting.
            distinct = all(
                job.identifier and other.identifier and job.identifier != other.identifier
                for other in same_source
            )
            if distinct:
                existing.append(job)
            continue

        # Cross-source repost: keep one, preferring a dated record from the
        # origin board over an undated aggregator repost.
        incumbent = existing[0]
        if (job.posted_at and not incumbent.posted_at) or len(job.location) > len(
            incumbent.location
        ):
            existing[0] = job

    return [job for key in order for job in groups[key]]


#: Fields an agent needs; omitted in `--format json-compact` when empty.
_COMPACT_DROP_IF_FALSY = (
    "remote", "department", "employment_type", "posted_at",
    "compensation", "snippet",
)

#: Always dropped in compact mode: redundant, not merely empty.
#: `identifier` is the ATS id, which already appears inside `url`.
_COMPACT_ALWAYS_DROP = ("identifier",)


def to_json(
    jobs: list[Job],
    boards: list[Board] | None = None,
    meta: dict | None = None,
    queries: list[str] | None = None,
    warnings: list[str] | None = None,
    total: int | None = None,
    compact: bool = False,
) -> str:
    """Serialize results.

    `count` is how many jobs are IN THIS PAYLOAD; `total` is how many matched
    before `--limit`. Both are given because an agent that reads only `count`
    would report "3 roles" for a company with 9 and would not know to re-run
    with a higher limit.

    `compact` drops fields that are empty on most postings, which is the bulk of
    the token cost when feeding results into a model.
    """
    job_dicts = []
    for job in jobs:
        as_dict = job.to_dict()
        if compact:
            as_dict = {
                k: v
                for k, v in as_dict.items()
                if k not in _COMPACT_ALWAYS_DROP
                and (k not in _COMPACT_DROP_IF_FALSY or v)
            }
        job_dicts.append(as_dict)

    hired_total = len(jobs) if total is None else total
    payload = {
        "generated_at": utc_now().isoformat(),
        "count": len(jobs),
        "total": hired_total,
        "truncated": len(jobs) < hired_total,
        "meta": meta or {},
        "warnings": warnings or [],
        "boards": [b.to_dict() for b in (boards or [])],
        "queries": queries or [],
        "jobs": job_dicts,
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


def to_hiring_json(signals, queries=None, warnings=None) -> str:
    """Serialize hiring signals for agent consumption."""
    payload = {
        "generated_at": utc_now().isoformat(),
        "count": len(signals),
        "total": len(signals),
        "truncated": False,
        "warnings": warnings or [],
        "queries": queries or [],
        "signals": [s.to_dict() for s in signals],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


def to_hiring_markdown(signals, queries=None) -> str:
    """Human-readable hiring report.

    Department names are expanded via friendly_department() where the vendor
    acronym would be opaque ("GTM" -> "Sales & Marketing (GTM)").

    Deliberately omits the ATS/slug/board table: a job seeker reading this does
    not need to know which vendor hosts the board, and it was pure noise on the
    page. The same data stays available in `to_hiring_json`.
    """
    lines: list[str] = ["# Is this company hiring?", ""]

    if not signals:
        lines.append("_No companies checked._")

    for signal in signals:
        lines.append(f"## {display_company(signal.company)}")
        lines.append("")
        lines.append(signal.verdict())
        lines.append("")
        if signal.top_departments:
            lines.append("| Department | Open roles |")
            lines.append("|---|---|")
            for name, count in signal.top_departments[:10]:
                lines.append(f"| {friendly_department(name)} | {count} |")
            lines.append("")

    if queries:
        # Make the very first query something a human can act on immediately: it
        # is what a user needs when a company resolved to no board at all.
        lines.append("## Next step: find the careers page yourself")
        lines.append("")
        lines.append("Paste this into a search engine to locate the company's board:")
        lines.append("")
        lines.append(f"> {queries[0]}")
        lines.append("")
        if len(queries) > 1:
            lines.append("Other boards to check directly:")
            lines.append("")
            for q in queries[1:]:
                lines.append(f"- `{q}`")
            lines.append("")

    return "\n".join(lines)


def to_markdown(
    jobs: list[Job],
    boards: list[Board] | None = None,
    meta: dict | None = None,
    limit: int | None = None,
) -> str:
    """Human-readable role search.

    Design review: jobs must appear in the first screenful. The old layout led
    with ~18 lines of metadata and an ATS table, so the reader scrolled past
    noise to reach the thing they asked for. Diagnostics now go last, under a
    heading that says they are diagnostics.
    """
    now = utc_now()
    shown = jobs[:limit] if limit else jobs

    companies = sorted({display_company(j.company) for j in jobs if j.company})
    where = ", ".join(companies[:4]) + (" +%d more" % (len(companies) - 4) if len(companies) > 4 else "")
    headline = f"# {len(jobs)} role" + ("s" if len(jobs) != 1 else "")
    if where:
        headline += f" at {where}"

    lines: list[str] = [headline, ""]

    if len(shown) < len(jobs):
        lines.append(f"_Showing the first {len(shown)}. Raise `--limit` for more._")
        lines.append("")

    if not shown:
        lines.append("_No postings matched. Try widening titles/locations or dropping filters._")
        lines.append("")

    for job in shown:
        freshness = ""
        posted = parse_iso(job.posted_at)
        if posted:
            days = max(0, (now - posted).days)
            freshness = f" · {days}d ago"
        remote = " · remote" if job.remote else ""
        loc = f" · {job.location}" if job.location else ""
        comp = f" · {job.compensation}" if job.compensation else ""

        lines.append(f"### [{job.title}]({job.url})")
        lines.append(f"{display_company(job.company)}{loc}{remote}{comp}{freshness}")
        if job.snippet:
            lines.append("")
            lines.append(f"> {job.snippet}")
        lines.append("")

    # Diagnostics last: useful when something looks wrong, distracting otherwise.
    if boards or meta:
        lines.append("---")
        lines.append("")
        lines.append("<sub>Diagnostics</sub>")
        lines.append("")
        if meta:
            lines.append(
                ", ".join(f"{k}: **{v}**" for k, v in meta.items())
            )
            lines.append("")
        live = [b for b in (boards or []) if b.job_count]
        if live:
            lines.append(
                "Boards read: "
                + ", ".join(f"{display_company(b.company)} ({b.ats}, {b.job_count})" for b in live)
            )
            lines.append("")

    return "\n".join(lines)
