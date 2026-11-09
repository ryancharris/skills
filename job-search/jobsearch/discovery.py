"""Slug discovery: map a company name to live ATS board(s).

Measured hit rate against 26 modern-tech companies: 22/26 (85%). Greenhouse and
Ashby dominate; Lever returned 0/26; enterprise (Amazon/Meta/Google/Boeing) uses
bespoke career sites and resolves on none of them.

Because one company can have boards on several ATSes -- and some are stale
(ramp: greenhouse 1 job vs ashby 169) -- discovery returns every live board and
callers rank by `job_count` instead of trusting the first hit.
"""

from __future__ import annotations

import concurrent.futures as cf
import re
import unicodedata

from .ats import ATSAdapter, all_adapters
from .http import HttpError
from .models import Board

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _fold(text: str) -> str:
    """Lowercase and strip diacritics so accented names map to real slugs.

    "Societe Generale" is served from slug `societegenerale`, so "Société
    Générale" must fold to that rather than lose the accented letters entirely.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))

# Fraction of a board's own name tokens that must be covered by the queried
# company name before we accept the board. See _board_belongs_to for the
# measured basis of this threshold.
_IDENTITY_COVERAGE = 0.66

# Corporate suffixes/words that ATS slugs almost never carry.
_DROP_TOKENS = {
    "inc", "llc", "ltd", "corp", "corporation", "company", "co", "plc",
    "holdings", "group", "the", "and",
}


def slug_candidates(company: str) -> list[str]:
    """Generate plausible ATS slugs for a company name, most likely first.

    "Meta Platforms" -> ["metaplatforms", "meta", "meta-platforms", "metaplatformsinc"]
    "Cisco Systems, Inc." -> ["ciscosystems", "cisco", "cisco-systems", ...]
    """
    low = _fold(company.lower()).strip()
    tokens = [t for t in _NON_ALNUM.split(low) if t]
    if not tokens:
        return []

    core = [t for t in tokens if t not in _DROP_TOKENS] or tokens

    out: list[str] = []
    out.append("".join(core))
    if len(core) > 1:
        out.append(core[0])
        out.append("-".join(core))
    out.append("".join(tokens))

    # Preserve order, drop empties/dupes.
    seen: set[str] = set()
    result: list[str] = []
    for c in out:
        if c and c not in seen:
            seen.add(c)
            result.append(c)
    return result


def _board_belongs_to(company: str, adapter: ATSAdapter, slug: str) -> bool:
    """Guard against slug collisions across companies.

    A bare first-token slug matches unrelated boards ("general motors" ->
    board `general` = "General Interest"; "international paper" ->
    `international` = "UpWork International"). When the vendor exposes a company
    name, require token overlap with the company we asked for.
    """
    try:
        actual = adapter.board_company(slug)
    except Exception:
        actual = None
    if not actual:
        # Vendor gives no identity (e.g. Ashby): trust the 404 semantics.
        return True

    want = {t for t in _NON_ALNUM.split(_fold(company.lower())) if t and t not in _DROP_TOKENS}
    have = {t for t in _NON_ALNUM.split(_fold(actual.lower())) if t and t not in _DROP_TOKENS}
    if not want or not have:
        return False

    # Require the queried company to account for most of the board's name.
    # Measured on live data: genuine boards score 1.00 even when the query is a
    # longer official name ("Meta Platforms" -> "Meta", "Cisco Systems, Inc."
    # -> "Cisco"), because abbreviations drop query tokens, not board tokens.
    # Look-alikes score 0.50 ("General Motors" -> "General Interest",
    # "International Paper" -> "UpWork International").
    coverage = len(want & have) / len(have)
    return coverage >= _IDENTITY_COVERAGE


def discover_boards(
    company: str,
    *,
    adapters: list[ATSAdapter] | None = None,
    max_workers: int = 8,
    verify: bool = True,
    errors: list[str] | None = None,
) -> list[Board]:
    """Probe ATSes for a company and return every live board, biggest first.

    `errors`, if given, collects messages for *transient* failures (network,
    timeout, 5xx). Those are important to distinguish from "this company is not
    on that ATS": swallowing both meant a DNS blip made a real company look
    like it had no boards, and the user was told to give up.
    """
    adapters = adapters or all_adapters()
    candidates = slug_candidates(company)
    if not candidates:
        return []

    def probe(adapter: ATSAdapter) -> list[Board]:
        found: list[Board] = []
        for slug in candidates:
            try:
                jobs = adapter.fetch(slug)
            except HttpError as exc:
                if not exc.is_missing_board and errors is not None:
                    errors.append(
                        f"{company}: {adapter.name} lookup failed ({exc}); "
                        "results may be incomplete"
                    )
                continue
            except Exception as exc:
                # Network/DNS/timeout: worth reporting, never fatal.
                if errors is not None:
                    errors.append(
                        f"{company}: {adapter.name} lookup failed ({type(exc).__name__}); "
                        "results may be incomplete"
                    )
                continue
            if not jobs:
                continue
            if not _board_belongs_to(company, adapter, slug):
                continue  # look-alike board for a different company
            count = len(jobs)
            if adapter.name == "smartrecruiters":
                try:
                    count = adapter.total_count(slug) or count
                except Exception:
                    pass
            found.append(Board(company=company, ats=adapter.name, slug=slug, job_count=count))
            break  # first verified candidate per ATS is enough
        return found

    if not verify:
        return [
            Board(company=company, ats=a.name, slug=candidates[0], job_count=0)
            for a in adapters
        ]

    boards: list[Board] = []
    with cf.ThreadPoolExecutor(max_workers=max_workers) as pool:
        for result in pool.map(probe, adapters):
            boards.extend(result)

    boards.sort(key=lambda b: b.job_count, reverse=True)
    return boards
