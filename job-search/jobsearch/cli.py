"""Command-line interface for the job-search skill.

Design goals: runnable in any harness (`python -m jobsearch ...`), no third-party
dependencies, and JSON output by default so an agent can chain on the results.
"""

from __future__ import annotations

import argparse
import sys

from .ats import shared_domain_site_targets
from .config import Config
from .filtering import build_site_query, expand_titles
from .models import SearchProfile
from .output import (
    to_hiring_json,
    to_hiring_markdown,
    to_json,
    to_markdown,
)
from .pipeline import check_hiring, run_search


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="jobsearch",
        description="Find jobs on company ATS boards, and check whether a company is still hiring.",
    )
    p.add_argument("--company", action="append", default=[], help="Company name (repeatable).")
    p.add_argument(
        "--check",
        action="append",
        default=[],
        help=(
            "Report whether each company is hiring and for what (repeatable). "
            "Use after a layoff announcement to see where it is still investing."
        ),
    )
    p.add_argument(
        "--recent-days", type=int, default=30, help="Window for --check 'hiring recently'."
    )
    p.add_argument("--max-companies", type=int, default=40, help="Cap companies to probe.")
    p.add_argument("--title", action="append", default=[], help="Job title (repeatable; synonyms expand).")
    p.add_argument("--location", action="append", default=[], help="Location filter (repeatable).")
    p.add_argument("--remote", action="store_true", help="Remote roles only.")
    p.add_argument("--seniority", action="append", default=[], help="intern|junior|mid|senior|director")
    p.add_argument("--keyword", action="append", default=[], help="Required keyword (repeatable, AND).")
    p.add_argument("--exclude-keyword", action="append", default=[], help="Excluded keyword.")
    p.add_argument("--exclude-company", action="append", default=[], help="Excluded company.")
    p.add_argument("--max-age-days", type=int, default=None, help="Only postings newer than N days.")
    p.add_argument("--limit", type=int, default=50, help="Max results to print.")
    p.add_argument(
        "--format",
        choices=["json", "json-compact", "md"],
        default="json",
        help=(
            "Output format. json-compact omits empty fields (roughly 40 percent "
            "fewer tokens); md is for humans."
        ),
    )
    p.add_argument("--queries", action="store_true", help="Print only the generated site: queries.")
    p.add_argument(
        "--cache-ttl",
        type=float,
        default=None,
        help="Reuse ATS responses for N seconds (default 0 = no cache). Env: JOBSEARCH_CACHE_TTL.",
    )
    p.add_argument(
        "--clear-cache", action="store_true", help="Delete cached ATS responses, then exit."
    )
    p.add_argument("--list-boards", action="store_true", help="Print only resolved boards.")
    return p


def _check_boards(companies: list[str], config: Config):
    """Resolve boards only, for `--check ... --list-boards`.

    Reuses check_hiring (which already discovered them) rather than duplicating
    the discovery path.
    """
    result = check_hiring(companies, config=config)
    return [b for b in result.boards if b.job_count]


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    # Load config first: cache maintenance must work without a search target.
    config = Config.from_env()

    if args.cache_ttl is not None:
        from dataclasses import replace

        config = replace(config, cache_ttl=args.cache_ttl)

    if args.clear_cache:
        from .cache import clear

        removed = clear(config.cache_dir)
        print(f"Cleared {removed} cached response(s) from {config.cache_dir}")
        return 0

    if not args.company and not args.check:
        print(
            "error: nothing to search. Pass --company NAME (repeatable) to find "
            "matching roles, or --check COMPANY to see whether a company is hiring.",
            file=sys.stderr,
        )
        return 2

    # Generated queries are pure string building: never touch the network.
    if args.queries:
        if not args.title:
            print("error: --queries needs at least one --title.", file=sys.stderr)
            return 2
        print("Boolean site: queries (export SEARCH_API_KEY to execute):\n")
        for domain in shared_domain_site_targets():
            print(build_site_query(domain, expand_titles(args.title), args.location))
        return 0

    if args.check:
        # Filter/output flags that only apply to a role search would otherwise be
        # silently ignored, which reads like a bug to the caller.
        ignored = [
            flag
            for flag, value in (
                ("--title", args.title),
                ("--location", args.location),
                ("--keyword", args.keyword),
                ("--exclude-keyword", args.exclude_keyword),
                ("--exclude-company", args.exclude_company),
                ("--seniority", args.seniority),
                ("--max-age-days", args.max_age_days),
            )
            if value
        ]
        if args.remote:
            ignored.append("--remote")
        if ignored:
            print(
                "warning: --check ignores role filters ("
                + ", ".join(ignored)
                + "); it reports whole-board hiring. Use --company for filtered roles.",
                file=sys.stderr,
            )
        if args.list_boards:
            result_boards = _check_boards(args.check, config)
            if not result_boards:
                print("No live ATS boards resolved.")
                return 0
            for b in result_boards:
                print(f"{b.company}\t{b.ats}\t{b.slug}\t{b.job_count}")
            return 0

        result = check_hiring(
            args.check,
            recent_days=args.recent_days,
            max_companies=args.max_companies,
            config=config,
        )
        for w in result.warnings:
            print(f"warning: {w}", file=sys.stderr)
        if args.format == "md":
            print(to_hiring_markdown(result.signals, result.queries))
        else:
            print(
                to_hiring_json(
                    result.signals, queries=result.queries, warnings=result.warnings
                )
            )
        return 0

    profile = SearchProfile(
        titles=args.title,
        locations=args.location,
        remote_only=args.remote,
        seniority=args.seniority,
        include_keywords=args.keyword,
        exclude_keywords=args.exclude_keyword,
        exclude_companies=args.exclude_company,
        max_age_days=args.max_age_days,
    )

    result = run_search(
        profile,
        companies=args.company,
        max_companies=args.max_companies,
        config=config,
    )

    for w in result.warnings:
        print(f"warning: {w}", file=sys.stderr)

    if args.list_boards:
        boards = [b for b in result.boards if b.job_count]
        if not boards:
            print("No live ATS boards resolved.")
            return 0
        for b in boards:
            print(f"{b.company}\t{b.ats}\t{b.slug}\t{b.job_count}")
        return 0

    if args.format == "md":
        print(to_markdown(result.jobs, result.boards, result.meta(), limit=args.limit))
    else:
        print(
            to_json(
                result.jobs[: args.limit],
                result.boards,
                result.meta(),
                queries=result.queries,
                warnings=result.warnings,
                total=len(result.jobs),
                compact=args.format == "json-compact",
            )
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
