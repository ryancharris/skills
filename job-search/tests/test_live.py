"""Live network tests against real ATS endpoints.

Gated: run with JOBSEARCH_LIVE_TESTS=1 python -m pytest tests/test_live.py

These exist because the vendor quirks that actually broke this skill (identity
collisions, Ashby's 403-without-User-Agent, SmartRecruiters' 200-on-missing-slug
and paged counts) are invisible to mocked tests.
"""

from __future__ import annotations

import pytest

from jobsearch.ats import (
    AshbyAdapter,
    GreenhouseAdapter,
    LeverAdapter,
    SmartRecruitersAdapter,
)
from jobsearch.discovery import discover_boards
from jobsearch.models import SearchProfile
from jobsearch.output import dedupe_jobs

pytestmark = pytest.mark.live

TIMEOUT = 30.0


# ---------------------------------------------------------------- adapters

def test_greenhouse_department_map_covers_all_jobs():
    """Regression: Greenhouse's /jobs has no department, so every role used to
    fall into 'unspecified' (Stripe: all 767). The departments tree fixes it in
    one request and must account for every posting."""
    from collections import Counter

    jobs = GreenhouseAdapter(TIMEOUT).fetch("stripe")
    labels = Counter(j.department or "unspecified" for j in jobs)
    assert labels.get("unspecified", 0) == 0, f"unlabeled roles: {labels}"
    assert len(labels) >= 2
    assert sum(labels.values()) == len(jobs)


def test_smartrecruiters_paging_is_capped():
    """A pathological board must not make one run unbounded."""
    adapter = SmartRecruitersAdapter(TIMEOUT)
    assert adapter.MAX_PAGES * adapter.PAGE_SIZE >= 600


def test_smartrecruiters_uses_function_label_fallback():
    """Regression: `department` is often {} but `function.label` is populated."""
    from collections import Counter

    jobs = SmartRecruitersAdapter(TIMEOUT).fetch("sodexo")
    labels = Counter(j.department or "unspecified" for j in jobs)
    assert labels.get("unspecified", 0) == 0, f"unlabeled roles: {labels}"


def test_greenhouse_live_shape():
    jobs = GreenhouseAdapter(TIMEOUT).fetch("stripe")
    assert len(jobs) > 100
    first = jobs[0]
    assert first.source == "greenhouse"
    assert first.title and first.url.startswith("http")
    assert first.identifier
    # Greenhouse returns company_name; it must not remain the raw slug.
    assert any(j.company == "Stripe" for j in jobs)


def test_greenhouse_unknown_slug_is_empty():
    with pytest.raises(Exception):
        GreenhouseAdapter(TIMEOUT).fetch("zzzznotarealcompany123456")


def test_ashby_live_shape_and_user_agent_requirement():
    # Ashby returns 403 with no User-Agent; our client always sets one.
    jobs = AshbyAdapter(TIMEOUT).fetch("ramp")
    assert len(jobs) > 50
    first = jobs[0]
    assert first.source == "ashby"
    assert first.url.startswith("https://jobs.ashbyhq.com/")
    assert any(j.compensation for j in jobs), "compensation should be populated"


def test_lever_live_shape():
    jobs = LeverAdapter(TIMEOUT).fetch("palantir")
    assert len(jobs) > 10
    assert all(j.url.startswith("https://jobs.lever.co/") for j in jobs)


def test_bamboohr_live_shape():
    """BambooHR is per-tenant (<company>.bamboohr.com/careers/list) and returns
    a real JSON payload with departments and locations."""
    from jobsearch.ats import BambooHRAdapter

    jobs = BambooHRAdapter(TIMEOUT).fetch("test")
    assert jobs, "this tenant has postings and should be usable as a fixture"
    first = jobs[0]
    assert first.source == "bamboohr"
    assert first.title and first.url.startswith("https://test.bamboohr.com/")
    assert any(j.department for j in jobs)


def test_bamboohr_unknown_tenant_returns_html_not_json():
    """Regression: an unknown tenant answers with an HTML page, which used to
    raise an uncaught JSONDecodeError and crash the whole run."""
    from jobsearch.ats import BambooHRAdapter
    from jobsearch.http import HttpError

    adapter = BambooHRAdapter(TIMEOUT)
    with pytest.raises(HttpError):
        adapter.fetch("definitelynotatenant123")
    assert adapter.is_valid_slug("definitelynotatenant123") is False


def test_smartrecruiters_pages_past_the_first_100():
    """Regression (B6): a single request truncated boards. Aramark reports 603;
    fetching must page until totalFound is reached, with no duplicate ids."""
    adapter = SmartRecruitersAdapter(TIMEOUT)
    jobs = adapter.fetch("aramark")
    total = adapter.total_count("aramark")
    assert total > 100, "this board must span multiple pages to be a useful test"
    assert len(jobs) == total
    ids = [j.identifier for j in jobs]
    assert len(set(ids)) == len(ids), "paging must not duplicate postings"


def test_smartrecruiters_unknown_slug_is_empty_not_error():
    # Verified quirk: HTTP 200 with totalFound 0 rather than 404.
    assert SmartRecruitersAdapter(TIMEOUT).is_valid_slug("zzzznotarealcompany123456") is False


# ---------------------------------------------------------------- discovery

@pytest.mark.parametrize(
    "company,expected_ats",
    [
        ("Stripe", "greenhouse"),
        ("Notion", "ashby"),
        ("Sodexo", "smartrecruiters"),
    ],
)
def test_discovery_finds_live_board(company, expected_ats):
    boards = discover_boards(company)
    assert boards, f"{company} should resolve to at least one board"
    assert expected_ats in {b.ats for b in boards}


@pytest.mark.parametrize(
    "company",
    ["General Motors", "International Paper"],
)
def test_discovery_rejects_lookalike_boards(company):
    """Regression: these used to match unrelated 'General Interest' / 'UpWork' boards."""
    assert discover_boards(company) == []


def test_discovery_prefers_larger_board_on_tie():
    """Ramp has a 1-job greenhouse board shadowing a 169-job ashby board."""
    boards = discover_boards("Ramp")
    assert boards[0].ats == "ashby"
    assert boards[0].job_count > boards[-1].job_count


def test_enterprise_has_no_shared_ats_board():
    """Documented limitation: enterprises use bespoke career sites."""
    assert discover_boards("Amazon") == []


# ---------------------------------------------------------------- end to end

def test_kagi_live_contract():
    """Regression (#10): only a real API call could reveal that v1 returns
    `data: {"search": [...]}`. Mocks built from my own assumption agreed with
    my own bug. Skipped when SEARCH_API_KEY is unset.
    """
    import os

    key = os.environ.get("SEARCH_API_KEY")
    if not key:
        pytest.skip("SEARCH_API_KEY not set")

    from jobsearch.search import KagiProvider

    results = KagiProvider(key, timeout=30).search('site:jobs.ashbyhq.com "chief of staff"')
    assert results, "a real query against the live API must return results"
    first = results[0]
    assert first.url.startswith("http")
    assert first.title
    assert "<strong>" not in first.snippet, "highlight markup must be stripped"


def test_search_fallback_resolves_an_enterprise():
    """The fallback is what makes enterprises usable at all. Amazon has no
    supported board, so results can only come from the search engine."""
    import os

    if not os.environ.get("SEARCH_API_KEY"):
        pytest.skip("SEARCH_API_KEY not set")

    from jobsearch.pipeline import run_search
    from jobsearch.models import SearchProfile

    result = run_search(SearchProfile(titles=["chief of staff"]), companies=["Amazon"])
    assert result.boards == []
    assert result.jobs, "fallback should surface roles for a board-less company"
    assert result.jobs[0].source == "search"


def test_e2e_company_search_filters_and_ranks():
    from jobsearch.pipeline import run_search

    profile = SearchProfile(titles=["software engineer"], remote_only=True)
    result = run_search(profile, companies=["Stripe"], max_companies=1)

    assert result.boards, "should resolve Stripe's board"
    assert result.jobs, "should return postings"
    # Every returned job must satisfy the profile.
    assert all(j.remote or "remote" in j.location.lower() for j in result.jobs)
    assert all("engineer" in j.title.lower() for j in result.jobs)
    # No duplicate postings.
    assert len(dedupe_jobs(result.jobs)) == len(result.jobs)


def test_e2e_offers_boolean_site_queries():
    from jobsearch.pipeline import run_search

    result = run_search(SearchProfile(titles=["chief of staff"]), companies=["Stripe"])
    matches = [q for q in result.queries if q.startswith("site:jobs.ashbyhq.com")]
    assert matches, "should offer ashby site: queries"
    assert '"CoS"' in matches[0]


def test_e2e_check_hiring_reads_a_live_board():
    """`--check` should report real open roles and departments."""
    from jobsearch.pipeline import check_hiring

    result = check_hiring(["Stripe"])
    assert len(result.signals) == 1
    signal = result.signals[0]
    assert signal.unknown is False
    assert signal.open_roles > 100
    assert signal.board_count >= 1
    assert signal.top_departments
    assert "Stripe" in signal.verdict()


def test_e2e_check_hiring_marks_enterprise_unknown():
    """Amazon has no supported board, so the signal must say so, not imply 0 jobs."""
    from jobsearch.pipeline import check_hiring

    result = check_hiring(["Amazon"])
    signal = result.signals[0]
    assert signal.unknown is True
    # Must hand back a discovery query so the agent can still make progress.
    assert any("Amazon" in q for q in result.queries)
