"""CLI behaviour tests (no network)."""

from __future__ import annotations

import json

from jobsearch.cli import build_parser, main
from jobsearch.pipeline import RunResult
from jobsearch.models import Job


def test_parser_defaults():
    args = build_parser().parse_args(["--company", "Acme"])
    assert args.company == ["Acme"]
    assert args.format == "json"
    assert args.check == []
    assert args.recent_days == 30


def test_cli_requires_a_seed(capsys):
    assert main([]) == 2
    assert "nothing to search" in capsys.readouterr().err


def test_cli_rejects_removed_layoff_flags(capsys):
    """The WARN-based seeding path was removed; old flags must fail loudly."""
    import pytest as _pytest

    for flag in ("--layoffs", "--since", "--min-workers", "--offline"):
        with _pytest.raises(SystemExit):
            main(["--company", "Acme", flag, "x"])


def test_cli_check_reports_hiring(monkeypatch, capsys):
    from jobsearch.hiring_signal import summarize_hiring
    from jobsearch.models import Board

    captured = {}

    def fake(companies, **kwargs):
        captured["companies"] = companies
        captured.update(kwargs)
        r = RunResult()
        r.signals = [summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 2)], [])]
        return r

    monkeypatch.setattr("jobsearch.cli.check_hiring", fake)
    assert main(["--check", "Acme", "--recent-days", "7"]) == 0
    out = capsys.readouterr().out
    assert captured["companies"] == ["Acme"]
    assert captured["recent_days"] == 7
    assert "Acme" in out


def test_cli_check_markdown(monkeypatch, capsys):
    from jobsearch.hiring_signal import summarize_hiring
    from jobsearch.models import Board

    def fake(companies, **kwargs):
        r = RunResult()
        r.signals = [summarize_hiring("Acme", [Board("Acme", "ashby", "acme", 2)], [])]
        return r

    monkeypatch.setattr("jobsearch.cli.check_hiring", fake)
    assert main(["--check", "Acme", "--format", "md"]) == 0
    out = capsys.readouterr().out
    assert "Is this company hiring" in out


def test_cli_check_list_boards(monkeypatch, capsys):
    """Regression: --list-boards was silently ignored under --check."""
    from jobsearch.models import Board

    monkeypatch.setattr(
        "jobsearch.cli._check_boards",
        lambda c, cfg: [Board("Stripe", "greenhouse", "stripe", 767)],
    )
    assert main(["--check", "Stripe", "--list-boards"]) == 0
    out = capsys.readouterr().out
    assert "Stripe\tgreenhouse\tstripe\t767" in out


def test_cli_check_warns_about_ignored_filters(monkeypatch, capsys):
    """Silently dropping role filters reads like a bug; say so instead."""
    monkeypatch.setattr("jobsearch.cli.check_hiring", lambda c, **k: RunResult())
    main(["--check", "Acme", "--title", "engineer", "--remote"])
    err = capsys.readouterr().err
    assert "--check ignores role filters" in err
    assert "--title" in err
    assert "--remote" in err


def test_cli_check_no_filter_warning_when_clean(monkeypatch, capsys):
    monkeypatch.setattr("jobsearch.cli.check_hiring", lambda c, **k: RunResult())
    main(["--check", "Acme"])
    assert "ignores role filters" not in capsys.readouterr().err


def test_cli_check_dedupes_companies(monkeypatch, capsys):
    captured = {}

    def fake(companies, **kwargs):
        captured["companies"] = companies
        return RunResult()

    monkeypatch.setattr("jobsearch.cli.check_hiring", fake)
    main(["--check", "Stripe", "--check", "stripe"])
    from jobsearch.pipeline import resolve_companies

    r = RunResult()
    resolve_companies(r, companies=captured["companies"], max_companies=40)
    assert [c.lower() for c in r.companies] == ["stripe"]


def test_cli_check_needs_no_company_flag(capsys, monkeypatch):
    monkeypatch.setattr("jobsearch.cli.check_hiring", lambda c, **k: RunResult())
    assert main(["--check", "Acme"]) == 0


def _stub_result():
    return RunResult(
        jobs=[Job(title="Engineer", company="Acme", url="https://x/1", source="greenhouse")],
        boards=[],
        queries=["site:jobs.ashbyhq.com (\"CoS\")"],
    )


def test_cli_json_output(monkeypatch, capsys):
    monkeypatch.setattr("jobsearch.cli.run_search", lambda *a, **k: _stub_result())
    assert main(["--company", "Acme"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["count"] == 1
    assert payload["jobs"][0]["title"] == "Engineer"


def test_cli_markdown_output(monkeypatch, capsys):
    monkeypatch.setattr("jobsearch.cli.run_search", lambda *a, **k: _stub_result())
    assert main(["--company", "Acme", "--format", "md"]) == 0
    assert "[Engineer](https://x/1)" in capsys.readouterr().out


def test_cli_queries_only_never_runs_a_search(monkeypatch, capsys):
    """`--queries` is pure string building; it must not hit the network."""

    def fail(*a, **k):
        raise AssertionError("run_search must not be called for --queries")

    monkeypatch.setattr("jobsearch.cli.run_search", fail)
    assert main(["--company", "Acme", "--title", "CoS", "--queries"]) == 0
    out = capsys.readouterr().out
    assert 'site:jobs.ashbyhq.com ("CoS")' in out


def test_cli_queries_requires_title(capsys):
    assert main(["--company", "Acme", "--queries"]) == 2
    assert "needs at least one --title" in capsys.readouterr().err


def test_cli_generated_queries_exclude_per_tenant_ats(capsys):
    main(["--company", "Acme", "--title", "engineer", "--queries"])
    out = capsys.readouterr().out
    assert "icims" not in out and "myworkdayjobs" not in out
    assert "job-boards.greenhouse.io" in out


def test_cli_passes_profile_through(monkeypatch):
    captured = {}

    def fake(profile, **kwargs):
        captured["profile"] = profile
        captured.update(kwargs)
        return RunResult()

    monkeypatch.setattr("jobsearch.cli.run_search", fake)
    main(
        [
            "--company", "Acme",
            "--title", "Engineer",
            "--location", "NYC",
            "--remote",
            "--seniority", "senior",
            "--keyword", "go",
            "--exclude-company", "Meta",
            "--max-age-days", "14",
        ]
    )
    p = captured["profile"]
    assert p.titles == ["Engineer"]
    assert p.locations == ["NYC"]
    assert p.remote_only is True
    assert p.seniority == ["senior"]
    assert p.include_keywords == ["go"]
    assert p.exclude_companies == ["Meta"]
    assert p.max_age_days == 14
    # Layoff-seeding was removed; no such kwargs should be passed any more.
    assert "use_layoffs" not in captured
    assert "since" not in captured


def test_entrypoint_script_runs_from_unrelated_cwd(tmp_path):
    """Portability guard: the bundled script must not depend on cwd/PYTHONPATH."""
    import os
    import subprocess
    import sys

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script = os.path.join(root, "jobsearch.py")
    proc = subprocess.run(
        [sys.executable, script, "--help"],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "--company" in proc.stdout


def test_fetch_board_reports_failure_instead_of_looking_empty():
    """Regression (#9): a board we know has 767 jobs returned [] on timeout,
    indistinguishable from an empty board -- `--check` could report "not
    hiring" for a company with 767 openings."""
    import urllib.error

    from jobsearch import pipeline as p
    from jobsearch.ats import GreenhouseAdapter
    from jobsearch.models import Board

    class Flaky(GreenhouseAdapter):
        def fetch(self, slug):
            raise urllib.error.URLError("timeout")

    board = Board("Stripe", "greenhouse", "stripe", 767)
    errors: list[str] = []
    assert p._fetch_board(board, [Flaky(5)], 20, errors) == []
    assert errors, "a failed fetch must not be silent"
    assert "understated" in errors[0]


def test_fetch_board_silent_when_no_error_sink_given():
    """Existing callers that pass no sink must keep working."""
    from jobsearch import pipeline as p
    from jobsearch.ats import GreenhouseAdapter
    from jobsearch.models import Board

    class Empty(GreenhouseAdapter):
        def fetch(self, slug):
            return []

    assert p._fetch_board(Board("X", "greenhouse", "x", 0), [Empty(5)], 20) == []


def test_fetch_all_keys_by_ats_too(monkeypatch):
    """Regression: Ramp has `ashby/ramp` (169 jobs) and `greenhouse/ramp` (1).
    Keying boards on (company, slug) made one overwrite the other, so a search
    reported 1 raw posting instead of 169."""
    from jobsearch import pipeline as p
    from jobsearch.models import Board, Job

    ashby_jobs = [
        Job(f"PM {i}", "Ramp", f"https://a/{i}", "ashby", identifier=str(i))
        for i in range(169)
    ]
    boards = [
        Board("Ramp", "ashby", "ramp", 169),
        Board("Ramp", "greenhouse", "ramp", 1),
    ]

    class Adapter:
        def __init__(self, name):
            self.name = name
            self.timeout = 20.0

        def fetch(self, slug):
            return ashby_jobs if self.name == "ashby" else ashby_jobs[:1]

    adapters = [Adapter("ashby"), Adapter("greenhouse")]
    result = p.RunResult()
    fetched = p._fetch_all(boards, adapters, 20.0, result)
    assert not result.warnings

    assert len(fetched) == 2, "both boards must be kept"
    assert sum(len(v) for v in fetched.values()) == 170


def test_run_result_meta_distinguishes_stages():
    """Regression: a 0-result run must be diagnosable (raw vs matched)."""
    from jobsearch.pipeline import RunResult

    r = RunResult(raw_count=100, matched_count=0)
    meta = r.meta()
    assert meta["raw postings"] == 100
    assert meta["matched postings"] == 0
    assert meta["returned"] == 0


def test_pipeline_warns_when_boards_have_jobs_but_none_match(monkeypatch):
    from jobsearch import pipeline as p
    from jobsearch.models import Board, Job, SearchProfile

    job = Job(title="Head Chef", company="Sodexo", url="https://x/1", source="smartrecruiters")
    monkeypatch.setattr(p, "discover_boards", lambda *a, **k: [Board("Sodexo", "smartrecruiters", "sodexo", 1)])
    monkeypatch.setattr(p, "_fetch_board", lambda b, a, t, errors=None: [job])

    result = p.run_search(
        SearchProfile(titles=["engineer"]),
        companies=["Sodexo"],
        provider=_NoKeyProvider(),
    )
    assert result.raw_count == 1
    assert result.matched_count == 0
    assert result.jobs == []
    assert any("none matched your filters" in w for w in result.warnings)


class _NoKeyProvider:
    """Provider stub that fails like an unset/empty result search."""

    name = "stub"

    def search(self, query, limit=20):
        from jobsearch.search import SearchError

        raise SearchError("no key")


def test_pipeline_enterprise_without_board_falls_back_to_search(monkeypatch):
    """Enterprises have no supported ATS board; the search fallback must fill in."""
    from jobsearch import pipeline as p
    from jobsearch.models import SearchProfile
    from jobsearch.search import SearchResult

    monkeypatch.setattr(p, "discover_boards", lambda *a, **k: [])

    class Provider:
        name = "stub"

        def search(self, query, limit=20):
            return [SearchResult(url="https://jobs.ashbyhq.com/acme/9", title="Software Engineer")]

    result = p.run_search(
        SearchProfile(titles=["software engineer"]),
        companies=["Amazon"],
        provider=Provider(),
    )
    assert result.boards == []
    assert result.jobs, "search fallback should return postings when no board resolves"
    assert result.jobs[0].source == "search"
    assert result.jobs[0].company == "Acme", "slug fallback is title-cased for display"


def test_cli_list_boards_empty(monkeypatch, capsys):
    monkeypatch.setattr("jobsearch.cli.run_search", lambda *a, **k: RunResult())
    assert main(["--company", "Acme", "--list-boards"]) == 0
    assert "No live ATS boards" in capsys.readouterr().out
