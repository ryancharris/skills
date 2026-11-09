"""Unit tests for pure logic: models, hiring signal, discovery, filtering, output."""

from __future__ import annotations

from datetime import timedelta, timezone

import pytest

from jobsearch.discovery import _board_belongs_to, slug_candidates
from jobsearch.filtering import (
    build_discovery_query,
    build_site_query,
    expand_titles,
    filter_jobs,
    matches,
    rank_jobs,
)
from jobsearch.ats import AshbyAdapter
from jobsearch.hiring_signal import summarize_hiring
from jobsearch.models import Board, Job, SearchProfile, parse_iso, utc_now
from jobsearch.output import (
    dedupe_jobs,
    to_hiring_json,
    to_hiring_markdown,
    to_json,
    to_markdown,
)


# ---------------------------------------------------------------- models

def test_parse_iso_date_only_lands_at_utc_midnight():
    parsed = parse_iso("2026-11-03")
    assert parsed.isoformat() == "2026-11-03T00:00:00+00:00"


def test_parse_iso_zulu_becomes_utc():
    assert parse_iso("2026-11-03T10:42:09Z").isoformat() == "2026-11-03T10:42:09+00:00"


def test_parse_iso_preserves_source_offset():
    parsed = parse_iso("2026-11-03T10:42:09-04:00")
    # The instant must be correct even though the written offset is preserved.
    assert parsed.astimezone(timezone.utc).isoformat() == "2026-11-03T14:42:09+00:00"


@pytest.mark.parametrize("value", [None, "", "not-a-date", "2026-13-45"])
def test_parse_iso_never_raises(value):
    assert parse_iso(value) is None


def test_job_dedupe_key_prefers_identifier():
    a = Job(title="Eng", company="Stripe", url="https://x/1", source="greenhouse", identifier="42")
    b = Job(title="Eng", company="Stripe", url="https://y/2", source="greenhouse", identifier="42")
    assert a.dedupe_key() == b.dedupe_key()


# ---------------------------------------------------------------- hiring signal

def _jobs(*specs):
    """(title, department, posted_at) -> list[Job]."""
    return [
        Job(
            title=title, company="Acme", url=f"https://x/{i}", source="greenhouse",
            department=dept, posted_at=posted,
        )
        for i, (title, dept, posted) in enumerate(specs)
    ]


def test_hiring_signal_counts_roles_and_departments():
    now = utc_now()
    fresh = (now - timedelta(days=1)).isoformat()
    jobs = _jobs(
        ("Eng 1", "Engineering", fresh),
        ("Eng 2", "Engineering", fresh),
        ("Sales 1", "Sales", fresh),
    )
    boards = [Board("Acme", "greenhouse", "acme", 3)]
    sig = summarize_hiring("Acme", boards, jobs, now=now)

    assert sig.open_roles == 3
    assert sig.board_count == 1
    assert sig.top_departments == [("Engineering", 2), ("Sales", 1)]
    assert sig.hiring_recently is True


def test_hiring_signal_groups_missing_department():
    """Totals must reconcile even when a board omits department."""
    jobs = _jobs(("Unknown 1", "", None), ("Unknown 2", "", None))
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 2)], jobs)
    assert sig.open_roles == 2
    assert sig.top_departments == [("unspecified", 2)]


def test_hiring_signal_marks_stale_boards():
    now = utc_now()
    old = (now - timedelta(days=400)).isoformat()
    sig = summarize_hiring(
        "Acme", [Board("Acme", "greenhouse", "acme", 1)], _jobs(("Eng", "Eng", old)), now=now
    )
    assert sig.hiring_recently is False
    assert sig.recent_roles == 0


def test_hiring_signal_unknown_when_no_board():
    """Enterprise case: no supported board means we cannot read hiring."""
    sig = summarize_hiring("Amazon", [], [])
    assert sig.unknown is True
    assert sig.open_roles == 0
    assert "no job board found" in sig.verdict()


def test_hiring_signal_verdict_mentions_top_areas():
    now = utc_now()
    fresh = (now - timedelta(days=2)).isoformat()
    sig = summarize_hiring(
        "Acme", [Board("Acme", "ashby", "acme", 1)],
        _jobs(("Eng", "Engineering", fresh)), now=now,
    )
    verdict = sig.verdict()
    assert "1 open role" in verdict
    assert "Engineering" in verdict


def test_hiring_signal_zero_roles_is_unknown_when_board_is_empty():
    """A board with no postings is not evidence of hiring; report unknown."""
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 0)], [])
    assert sig.open_roles == 0
    assert sig.unknown is True
    assert "no job board found" in sig.verdict()


def test_hiring_signal_partial_when_board_exceeds_fetched():
    """Regression: SmartRecruiters returns 100/page from a 155-job board; the
    signal must say so instead of silently reporting 100."""
    sig = summarize_hiring("Sodexo", [Board("Sodexo", "smartrecruiters", "sodexo", 155)], []) 
    # No jobs fetched -> unknown is false because a live board exists.
    assert sig.board_reported_roles == 155
    assert sig.open_roles == 0
    assert sig.partial is True


def test_hiring_signal_not_partial_when_counts_match():
    now = utc_now()
    fresh = (now - timedelta(days=1)).isoformat()
    jobs = _jobs(("A", "Eng", fresh), ("B", "Eng", fresh))
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 2)], jobs, now=now)
    assert sig.open_roles == 2
    assert sig.partial is False
    assert "partial" not in sig.verdict()


def test_hiring_signal_partial_verdict_mentions_board_total():
    now = utc_now()
    fresh = (now - timedelta(days=1)).isoformat()
    jobs = _jobs(("A", "Eng", fresh))
    sig = summarize_hiring("Acme", [Board("Acme", "smartrecruiters", "acme", 155)], jobs, now=now)
    verdict = sig.verdict()
    assert "at least" in verdict
    assert "155" in verdict


def test_hiring_signal_to_dict_includes_partial():
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 3)], [])
    d = sig.to_dict()
    assert d["partial"] is True
    assert d["board_reported_roles"] == 3


def test_hiring_signal_live_board_with_zero_jobs_kept():
    """Guard the counterfactual: if a live board yields 0 fetched jobs, that is
    still 'unknown' rather than a confident 'not hiring'."""
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 5)], [])
    assert sig.board_count == 1
    assert sig.open_roles == 0
    assert sig.verdict()


def test_hiring_signal_to_dict_shape():
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 1)], _jobs(("Eng", "Eng", None)))
    d = sig.to_dict()
    assert d["company"] == "Acme"
    assert d["top_departments"] == [{"department": "Eng", "open_roles": 1}]
    assert "verdict" in d


# ---------------------------------------------------------------- output: hiring

def test_to_hiring_json_shape():
    import json as _json

    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 1)], _jobs(("Eng", "Eng", None)))
    payload = _json.loads(to_hiring_json([sig], queries=["q"], warnings=["w"]))
    assert payload["count"] == 1
    assert payload["signals"][0]["company"] == "Acme"
    assert payload["queries"] == ["q"]
    assert payload["warnings"] == ["w"]


def test_to_hiring_markdown_renders_table_and_verdict():
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 1)], _jobs(("Eng", "Engineering", None)))
    md = to_hiring_markdown([sig], queries=["discover acme"])
    assert "## Acme" in md
    assert "| Engineering | 1 |" in md
    assert "discover acme" in md


def test_to_hiring_markdown_surfaces_first_query_as_next_step():
    """PM review: a dead end must give the user something to act on, not just
    a JSON array of queries they have to interpret."""
    sig = summarize_hiring("Google", [], [])
    md = to_hiring_markdown([sig], queries=["first-query", "second-query"])
    assert "find the careers page yourself" in md
    assert "> first-query" in md, "the primary next step should be prominent"
    assert "second-query" in md


def test_to_hiring_markdown_empty():
    assert "No companies checked" in to_hiring_markdown([])


def test_to_hiring_markdown_no_queries_section_when_resolved():
    """A fully resolved company must not show a 'next step' block."""
    sig = summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 1)], _jobs(("Eng", "Eng", None)))
    md = to_hiring_markdown([sig], queries=[])
    assert "find the careers page yourself" not in md


# ---------------------------------------------------------------- discovery

@pytest.mark.parametrize(
    "name,expected_first",
    [
        ("Stripe", "stripe"),
        ("Meta Platforms", "metaplatforms"),
        ("Cisco Systems, Inc.", "ciscosystems"),
        ("The Boeing Company", "boeing"),
    ],
)
def test_slug_candidates(name, expected_first):
    cands = slug_candidates(name)
    assert cands[0] == expected_first
    assert len(cands) == len(set(cands)), "candidates must be unique"


def test_slug_candidates_empty():
    assert slug_candidates("   ") == []


# ------------------------------------------------ discovery error reporting (#8)

def _flaky_adapter(exc):
    """An adapter whose fetch always fails, so no network is touched."""
    from jobsearch.ats import GreenhouseAdapter

    class Flaky(GreenhouseAdapter):
        def fetch(self, slug):
            raise exc

    return Flaky(5)


def test_discovery_reports_transient_failures():
    """Regression (#8): a network failure was indistinguishable from 'this
    company has no board', so a DNS blip told the user Stripe had no jobs.

    Deliberately offline: the adapter raises immediately, so this guards the
    critical path in every test run rather than only under JOBSEARCH_LIVE_TESTS.
    """
    import urllib.error

    from jobsearch.discovery import discover_boards

    errors: list[str] = []
    boards = discover_boards(
        "Stripe",
        adapters=[_flaky_adapter(urllib.error.URLError("temporary DNS failure"))],
        errors=errors,
    )
    assert boards == []
    assert errors, "a transient failure must be surfaced, not swallowed"
    assert "Stripe" in errors[0]
    assert "incomplete" in errors[0]


def test_discovery_reports_5xx_as_transient():
    """A 5xx is transient, not 'no such board', so it must be reported."""
    from jobsearch.discovery import discover_boards
    from jobsearch.http import HttpError

    errors: list[str] = []
    discover_boards(
        "Stripe", adapters=[_flaky_adapter(HttpError("u", 503, "busy"))], errors=errors
    )
    assert errors and "incomplete" in errors[0]


def test_discovery_stays_quiet_for_genuine_misses():
    """A company simply not being on an ATS is normal and must not warn.

    Offline: a 404 is the documented 'no such board' signal, so this does not
    need to hit a real endpoint.
    """
    from jobsearch.discovery import discover_boards
    from jobsearch.http import HttpError

    errors: list[str] = []
    discover_boards(
        "Amazon", adapters=[_flaky_adapter(HttpError("u", 404, "not found"))], errors=errors
    )
    assert errors == [], f"genuine misses must stay silent, got {errors}"


def test_discovery_without_error_sink_does_not_crash():
    """Callers that pass no sink must keep working."""
    import urllib.error

    from jobsearch.discovery import discover_boards

    boards = discover_boards(
        "Stripe", adapters=[_flaky_adapter(urllib.error.URLError("boom"))]
    )
    assert boards == []


def test_slug_candidates_fold_diacritics():
    """Regression: accented names must map to real ASCII slugs.

    "Societe Generale" is served from slug `societegenerale`.
    """
    cands = slug_candidates("Société Générale")
    assert cands[0] == "societegenerale"
    assert "societe" in cands
    assert all(c.isascii() for c in cands)


class _FakeAdapter:
    """Adapter stub exposing a board company name."""

    def __init__(self, name, actual):
        self.name = name
        self.actual = actual

    def board_company(self, slug):
        return self.actual


@pytest.mark.parametrize(
    "query,actual,expected",
    [
        # true positives
        ("Stripe", "Stripe", True),
        ("Meta Platforms", "Meta", True),  # abbreviation shortens the query, not the board
        ("Cisco Systems, Inc.", "Cisco", True),
        ("Sodexo", "Sodexo", True),
        # measured false positives from live data
        ("General Motors", "General Interest", False),
        ("International Paper", "UpWork International", False),
        # vendor exposes no identity -> trust slug semantics
        ("Anything", None, True),
    ],
)
def test_board_identity_verification(query, actual, expected):
    adapter = _FakeAdapter("fake", actual)
    assert _board_belongs_to(query, adapter, "slug") is expected


# ---------------------------------------------------------------- filtering

def _job(title="Software Engineer", **kw):
    kw.setdefault("company", "Acme")
    kw.setdefault("url", "https://x")
    kw.setdefault("source", "greenhouse")
    return Job(title=title, **kw)


def test_expand_titles_adds_synonyms():
    groups = expand_titles(["chief of staff"])
    assert groups[0][0] == "chief of staff"
    assert "CoS" in groups[0]


def test_build_site_query_matches_source_post_example():
    groups = expand_titles(["chief of staff"])
    q = build_site_query("jobs.ashbyhq.com", groups)
    assert q == 'site:jobs.ashbyhq.com ("chief of staff" OR "CoS" OR "chief of staff to CEO")'


def test_build_site_query_multiple_titles_are_or_groups():
    groups = expand_titles(["data scientist", "software engineer"])
    q = build_site_query("boards.greenhouse.io", groups)
    assert q.count("site:") == 1
    assert q.count("(") >= 2


def test_build_discovery_query():
    assert "greenhouse" in build_discovery_query("Acme")


def test_filter_title_match_and_synonym():
    jobs = [_job("Chief of Staff to CEO"), _job("Accountant")]
    got = filter_jobs(jobs, SearchProfile(titles=["chief of staff"]))
    assert [j.title for j in got] == ["Chief of Staff to CEO"]


def test_title_acronym_matches_on_word_boundary_only():
    """Regression: the synonym "PM" matched the 'pm' inside "Develo**pm**ent",
    so a search for "product manager" returned Business Development roles."""
    from jobsearch.filtering import title_contains

    assert title_contains("Senior PM", "PM") is True
    assert title_contains("PM, Growth", "PM") is True
    assert title_contains("Business Development Representative", "PM") is False
    assert title_contains("Partner Development Manager", "PM") is False


def test_product_manager_search_excludes_development_roles():
    jobs = [
        _job("Business Development Representative"),
        _job("Partner Development Manager"),
        _job("Product Manager, Terminal Payments"),
        _job("Senior PM"),
    ]
    got = filter_jobs(jobs, SearchProfile(titles=["product manager"]))
    titles = [j.title for j in got]
    assert "Product Manager, Terminal Payments" in titles
    assert "Senior PM" in titles
    assert "Business Development Representative" not in titles
    assert "Partner Development Manager" not in titles


def test_seniority_uses_word_boundaries():
    """"director" must not match inside an unrelated word."""
    jobs = [_job("Director of Engineering"), _job("Monitoring Engineer")]
    got = filter_jobs(jobs, SearchProfile(seniority=["director"]))
    assert [j.title for j in got] == ["Director of Engineering"]


def test_filter_remote_only():
    jobs = [_job(location="Remote - US"), _job(location="Dublin")]
    got = filter_jobs(jobs, SearchProfile(remote_only=True))
    assert len(got) == 1


def test_filter_location():
    jobs = [_job(location="New York, NY"), _job(location="Dublin")]
    got = filter_jobs(jobs, SearchProfile(locations=["new york"]))
    assert [j.location for j in got] == ["New York, NY"]


def test_filter_seniority():
    jobs = [_job("Senior Engineer"), _job("Engineer II"), _job("Intern")]
    got = filter_jobs(jobs, SearchProfile(seniority=["senior"]))
    assert "Senior Engineer" in [j.title for j in got]
    assert "Intern" not in [j.title for j in got]


def test_filter_exclude_keywords_and_companies():
    jobs = [_job("Engineer", company="Meta"), _job("Engineer (Contract)", company="Acme")]
    got = filter_jobs(jobs, SearchProfile(exclude_keywords=["contract"]))
    assert len(got) == 1
    got = filter_jobs(jobs, SearchProfile(exclude_companies=["meta"]))
    assert got[0].company == "Acme"


def test_filter_max_age_days():
    now = utc_now()
    fresh = _job(posted_at=(now - timedelta(days=2)).isoformat())
    stale = _job(posted_at=(now - timedelta(days=400)).isoformat())
    got = filter_jobs([fresh, stale], SearchProfile(max_age_days=30), now=now)
    assert got == [fresh]


def test_keyword_matches_on_word_boundaries():
    """Regression: keyword "go" matched "MongoDB" and "ai" matched "Retail"."""
    mongo = _job("Backend Engineer", department="MongoDB")
    retail = _job("Engineer", department="Retail")
    golang = _job("Backend Engineer, Go")

    assert matches(mongo, SearchProfile(include_keywords=["go"])) is False
    assert matches(retail, SearchProfile(include_keywords=["ai"])) is False
    assert matches(golang, SearchProfile(include_keywords=["go"])) is True


def test_keyword_multiword_phrase_still_matches():
    job = _job("Machine Learning Engineer")
    assert matches(job, SearchProfile(include_keywords=["machine learning"])) is True


def test_exclude_keyword_uses_word_boundaries():
    """Excluding "ai" must not drop a role because its department is "Retail"."""
    retail = _job("Engineer", department="Retail")
    ai_role = _job("AI Engineer")
    got = filter_jobs([retail, ai_role], SearchProfile(exclude_keywords=["ai"]))
    assert [j.title for j in got] == ["Engineer"]


def test_filter_include_keywords_requires_all():
    jobs = [_job("Backend Engineer, Go"), _job("Backend Engineer, Python")]
    got = filter_jobs(jobs, SearchProfile(include_keywords=["backend", "go"]))
    assert len(got) == 1


def test_matches_no_constraints_keeps_everything():
    assert matches(_job(), SearchProfile())


def test_rank_prefers_title_match_then_freshness():
    now = utc_now()
    strong_old = _job("Software Engineer", posted_at=(now - timedelta(days=50)).isoformat())
    weak_new = _job("Accountant", posted_at=(now - timedelta(days=1)).isoformat())
    ranked = rank_jobs([weak_new, strong_old], SearchProfile(titles=["software engineer"]), now=now)
    assert ranked[0].title == "Software Engineer"


def test_rank_tie_broken_by_recency():
    now = utc_now()
    old = _job("Software Engineer", posted_at=(now - timedelta(days=90)).isoformat())
    new = _job("Software Engineer", posted_at=(now - timedelta(days=1)).isoformat())
    assert rank_jobs([old, new], SearchProfile(), now=now)[0] is new


# ---------------------------------------------------------------- output

def test_dedupe_collapses_cross_source_reposts():
    a = _job("Engineer", company="Acme", location="NYC", url="https://a")
    b = _job("engineer", company="acme", location="nyc", url="https://b")
    assert len(dedupe_jobs([a, b])) == 1


def test_dedupe_keeps_distinct_requisitions_on_same_board():
    """Regression: two Stripe "Software Engineer" Seattle requisitions are
    separate jobs; collapsing them silently hid a real posting."""
    a = _job("Software Engineer", location="Seattle, WA", identifier="8267736", url="https://x/1")
    b = _job("Software Engineer", location="Seattle, WA", identifier="8249901", url="https://x/2")
    assert len(dedupe_jobs([a, b])) == 2


def test_dedupe_collapses_identical_same_source_record():
    a = _job(location="NYC", identifier="1", url="https://x/1")
    b = _job(location="NYC", identifier="1", url="https://x/1")
    assert len(dedupe_jobs([a, b])) == 1


def test_dedupe_across_sources_keeps_one():
    gh = _job("Engineer", company="Acme", location="NYC", source="greenhouse", url="https://x/1")
    sr = _job("Engineer", company="Acme", location="NYC", source="search", url="https://y/2")
    out = dedupe_jobs([gh, sr])
    assert len(out) == 1
    assert out[0].source == "greenhouse", "prefer the origin board over a repost"


def test_dedupe_prefers_dated_record_across_sources():
    """When a repost collapses with an origin board, keep the dated one."""
    no_date = _job("Engineer", location="NYC", source="search", url="https://a")
    with_date = _job(
        "Engineer", location="NYC", source="greenhouse", url="https://b",
        posted_at="2026-01-01T00:00:00Z",
    )
    out = dedupe_jobs([no_date, with_date])
    assert len(out) == 1
    assert out[0].posted_at == "2026-01-01T00:00:00Z"
    assert out[0].source == "greenhouse"


def test_dedupe_same_source_without_ids_collapses():
    a = _job("Engineer", location="NYC", url="https://a")
    b = _job("Engineer", location="NYC", url="https://b")
    assert len(dedupe_jobs([a, b])) == 1


def test_to_json_shape():
    import json

    payload = json.loads(to_json([_job()], [Board("Acme", "greenhouse", "acme", 3)], {"k": "v"}))
    assert payload["count"] == 1
    assert payload["meta"] == {"k": "v"}
    assert payload["boards"][0]["slug"] == "acme"
    assert payload["jobs"][0]["title"] == "Software Engineer"
    # Always present so consumers can rely on the shape.
    assert payload["queries"] == []
    assert payload["warnings"] == []


def test_to_json_includes_queries_and_warnings():
    import json

    payload = json.loads(
        to_json([], queries=['site:jobs.ashbyhq.com ("CoS")'], warnings=["thin result"])
    )
    assert payload["queries"] == ['site:jobs.ashbyhq.com ("CoS")']
    assert payload["warnings"] == ["thin result"]


def test_to_markdown_renders_links_and_empty_state():
    md = to_markdown([_job(url="https://x/1")], [Board("Acme", "greenhouse", "acme", 3)])
    assert "[Software Engineer](https://x/1)" in md
    assert "# 1 role at Acme" in md
    assert "Diagnostics" in md
    assert "No postings matched" in to_markdown([], [])


def test_site_targets_exclude_per_tenant_ats():
    from jobsearch.ats import shared_domain_site_targets

    targets = shared_domain_site_targets()
    joined = " ".join(targets)
    assert "icims" not in joined, "icims is per-tenant; excluded by design"
    assert "myworkdayjobs" not in joined, "workday is per-tenant; excluded by design"
    assert "job-boards.greenhouse.io" in targets


# ------------------------------------------- Ashby pay-tier selection (offline)

def test_ashby_tier_selection_is_pure_and_safe():
    """Unknown/absent compensation must not raise, and must not regress."""
    assert AshbyAdapter.pay_for_location(None, "Canada") is None
    assert AshbyAdapter.pay_for_location({}, "Canada") is None
    # No tiers -> summary passthrough (old behaviour).
    assert (
        AshbyAdapter.pay_for_location({"compensationTierSummary": "X"}, "Canada")
        == "X"
    )
    # No location match -> summary passthrough.
    tiers = {
        "compensationTierSummary": "S",
        "compensationTiers": [
            {"components": [{"compensationType": "Salary", "currencyCode": "USD"}]}
        ],
    }
    assert AshbyAdapter.pay_for_location(tiers, "Atlantis") == "S"
