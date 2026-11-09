"""ATS (Applicant Tracking System) job-board adapters.

Each adapter maps a company slug to that company's public board API and
normalizes the vendor payload into `Job` objects. Endpoint shapes were verified
against live responses (see references/ats-endpoints.md).

Validity signals differ per vendor and matter for slug discovery:
  * greenhouse / lever / ashby  -> HTTP 404 for an unknown slug
  * smartrecruiters             -> HTTP 200 with totalFound == 0 for unknown slug
"""

from __future__ import annotations

from typing import Any

from ..http import HttpError, get_json
from ..models import Job

# ATS platforms that CANNOT be addressed with a bare shared-domain `site:` query
# or a single-slug API, because they are per-tenant subdomains. Intentionally
# excluded from the site: query list (an icims/workday `site:` returns ~nothing).
PER_TENANT_ATS = {
    "icims": "careers-<company>.icims.com",
    "workday": "<company>.wd1.myworkdayjobs.com",
}


class ATSAdapter:
    name = "base"
    # Whether a non-empty board is enough to trust the slug. False means the
    # vendor exposes a company name we can cross-check against the query.
    trusts_slug = True

    #: Seconds an ATS response may be reused from cache; 0 disables caching.
    cache_ttl: float = 0.0
    #: Directory for the on-disk cache.
    cache_dir: str = ""

    def __init__(self, timeout: float = 20.0, cache_ttl: float = 0.0, cache_dir: str = "") -> None:
        self.timeout = timeout
        self.cache_ttl = cache_ttl
        self.cache_dir = cache_dir

    def get(self, url: str) -> Any:
        """GET as JSON, honouring this adapter's cache settings."""
        return get_json(url, timeout=self.timeout, cache_ttl=self.cache_ttl, cache_dir=self.cache_dir)

    def fetch(self, slug: str) -> list[Job]:  # pragma: no cover
        raise NotImplementedError

    def board_company(self, slug: str) -> str | None:
        """Authoritative company name for this board, if the vendor exposes one.

        Returns None when unavailable, in which case verification falls back to
        slug (or 404) semantics.
        """
        return None

    def is_valid_slug(self, slug: str) -> bool:
        try:
            return len(self.fetch(slug)) > 0
        except HttpError:
            return False


class GreenhouseAdapter(ATSAdapter):
    name = "greenhouse"
    # Greenhouse exposes company_name per posting, so we can reject look-alike
    # boards (slug "general" -> "General Interest", not General Motors).
    trusts_slug = False
    TEMPLATE = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
    DEPARTMENTS = "https://boards-api.greenhouse.io/v1/boards/{slug}/departments"

    def department_map(self, slug: str) -> dict[str, str]:
        """Map job id -> top-level department name, in ONE request.

        Greenhouse's `/jobs` list carries no department field, so without this
        every role falls into "unspecified" (Stripe: all 767). Departments are
        only available per-job (`/jobs/{id}`, an N+1 storm) or via this tree.

        The tree is deeply nested with micro-buckets ("1120 Training &
        Certification"), which is useless as a "top areas" signal. We roll each
        job up to its root department, which yielded clean, fully-accounted
        groups on real data (Stripe: GTM 319, Tech 244, Core 186 = 767).

        Returns {} on any failure; callers then fall back to "unspecified".
        """
        try:
            data = self.get(self.DEPARTMENTS.format(slug=slug))
        except Exception:
            return {}

        nodes = {d.get("id"): d for d in data.get("departments", []) if d.get("id")}

        def root_name(dept: dict[str, Any]) -> str:
            seen: set[Any] = set()
            current = dept
            while True:
                parent_id = current.get("parent_id")
                if parent_id not in nodes or parent_id in seen:
                    return (current.get("name") or "").strip()
                seen.add(parent_id)
                current = nodes[parent_id]

        mapping: dict[str, str] = {}
        for dept in nodes.values():
            name = root_name(dept)
            if not name:
                continue
            for job in dept.get("jobs") or []:
                job_id = job.get("id")
                if job_id is not None:
                    mapping[str(job_id)] = name
        return mapping

    def board_company(self, slug: str) -> str | None:
        data = self.get(self.TEMPLATE.format(slug=slug))
        for raw in data.get("jobs", []):
            name = (raw.get("company_name") or "").strip()
            if name:
                return name
        return None

    def fetch(self, slug: str) -> list[Job]:
        data = self.get(self.TEMPLATE.format(slug=slug))
        raw_jobs = data.get("jobs", [])
        # Only pay for the departments request when there is something to label.
        departments = self.department_map(slug) if raw_jobs else {}

        jobs: list[Job] = []
        for raw in raw_jobs:
            location = (raw.get("location") or {}).get("name", "") or ""
            job_id = str(raw.get("id", ""))
            jobs.append(
                Job(
                    title=raw.get("title", "").strip(),
                    company=(raw.get("company_name") or slug).strip(),
                    url=raw.get("absolute_url", ""),
                    source=self.name,
                    location=location,
                    remote=_infer_remote(location),
                    department=departments.get(job_id, ""),
                    posted_at=raw.get("first_published") or raw.get("updated_at"),
                    identifier=job_id,
                )
            )
        return jobs


class LeverAdapter(ATSAdapter):
    name = "lever"
    TEMPLATE = "https://api.lever.co/v0/postings/{slug}?mode=json"

    def fetch(self, slug: str) -> list[Job]:
        data = self.get(self.TEMPLATE.format(slug=slug))
        if not isinstance(data, list):
            # Lever returns 200 + {"ok": false} for some malformed slugs.
            return []
        jobs: list[Job] = []
        for raw in data:
            cats = raw.get("categories") or {}
            location = cats.get("location", "") or ""
            created = raw.get("createdAt")
            posted = None
            if isinstance(created, (int, float)):
                from datetime import datetime, timezone

                posted = datetime.fromtimestamp(created / 1000, tz=timezone.utc).isoformat()
            jobs.append(
                Job(
                    title=(raw.get("text") or "").strip(),
                    company=slug,
                    url=raw.get("hostedUrl", ""),
                    source=self.name,
                    location=location,
                    remote=_infer_remote(location) or (raw.get("workplaceType") == "remote"),
                    department=cats.get("team", "") or "",
                    employment_type=cats.get("commitment", "") or "",
                    posted_at=posted,
                    identifier=str(raw.get("id", "")),
                )
            )
        return jobs


# Location keyword -> currency whose pay tier applies there.
#
# Order matters only for overlapping keywords; regions are otherwise disjoint.
# The US entry is essential: Cohere publishes BOTH a CAD and a USD tier for the
# same San Francisco role, so without an explicit "prefer USD here" rule the
# first CAD tier wins and a US salary is reported in Canadian dollars.
_CURRENCY_BY_LOCATION: list[tuple[tuple[str, ...], str]] = [
    (
        (
            "canada", "ontario", "toronto", "vancouver", "montreal",
            "quebec", "ottawa", "calgary", "waterloo",
        ),
        "CAD",
    ),
    (
        (
            "united states", "san francisco", "new york", "seattle", "boston",
            "washington", "california", "usa", "u.s.", "remote-friendly, us",
        ),
        "USD",
    ),
    (("korea",), "KRW"),
    (("japan", "tokyo"), "JPY"),
    (("united kingdom", "london", "uk"), "GBP"),
    (("europe", "germany", "munich", "paris", "france", "netherlands"), "EUR"),
]


def _ashby_pay_for_location(compensation: Any, location: str) -> str | None:
    """Pick the pay tier that applies to this role's location.

    Ashby publishes pay *per geography* and `compensationTierSummary` quotes only
    the FIRST tier, which is usually the US one. Reporting it for a Canada role
    understates pay by ~40% and in the wrong currency: "Software Engineer, ML
    Workload Platform" (Canada) summarises as "$175K – $325K" while its CAD tier
    is CA$250K – CA$400K.

    Match the role's location to a currency, then prefer a tier whose component
    currency matches. Fall back to the summary when nothing matches, so this can
    only ever improve on the old behaviour.
    """
    if not isinstance(compensation, dict):
        return None

    summary = compensation.get("compensationTierSummary")
    tiers = compensation.get("compensationTiers") or []
    if not tiers:
        return summary

    low_loc = (location or "").lower()
    wanted = next(
        (cur for keys, cur in _CURRENCY_BY_LOCATION if any(k in low_loc for k in keys)),
        None,
    )

    if wanted:
        for tier in tiers:
            for component in tier.get("components") or []:
                if component.get("compensationType") != "Salary":
                    continue
                if component.get("currencyCode") == wanted:
                    return tier.get("tierSummary") or summary

    # No location/currency match: the summary quotes the first tier, which is
    # the previous behaviour. Never worse than before.
    return summary


class AshbyAdapter(ATSAdapter):
    name = "ashby"
    # Ashby exposes no company name in the posting API; unknown slugs 404, and
    # this API REQUIRES a User-Agent (403 without one), which http.py supplies.
    TEMPLATE = "https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"

    @staticmethod
    def pay_for_location(compensation: Any, location: str) -> str | None:
        return _ashby_pay_for_location(compensation, location)

    def fetch(self, slug: str) -> list[Job]:
        data = self.get(self.TEMPLATE.format(slug=slug))
        jobs: list[Job] = []
        for raw in data.get("jobs", []):
            location = raw.get("location", "") or ""
            comp = _ashby_pay_for_location(raw.get("compensation"), location)
            jobs.append(
                Job(
                    title=(raw.get("title") or "").strip(),
                    company=slug,
                    url=raw.get("jobUrl", ""),
                    source=self.name,
                    location=location,
                    remote=bool(raw.get("isRemote")) or _infer_remote(location),
                    department=raw.get("department", "") or "",
                    employment_type=raw.get("employmentType", "") or "",
                    posted_at=raw.get("publishedAt"),
                    compensation=comp,
                    identifier=str(raw.get("id", "")),
                )
            )
        return jobs

    def is_valid_slug(self, slug: str) -> bool:
        # Ashby returns HTTP 200 with an empty/absent job list for unknown slugs
        # in some cases and 404 in others; treat "has postings" as the signal.
        try:
            return len(self.fetch(slug)) > 0
        except HttpError:
            return False


class BambooHRAdapter(ATSAdapter):
    name = "bamboohr"
    #: Per-tenant host: <company>.bamboohr.com. Not a shared-domain board, so a
    #: `site:jobs.bamboohr.com` search is useless -- only slug probing works.
    TEMPLATE = "https://{slug}.bamboohr.com/careers/list"

    #: Verified live against real tenants:
    #:   {"meta": {"totalCount": 4},
    #:    "result": [{"id": "15", "jobOpeningName": "IT Security Engineer",
    #:      "departmentLabel": "IT", "location": {"city": ..., "state": ...},
    #:      "isRemote": null, ...}]}
    def fetch(self, slug: str) -> list[Job]:
        data = self.get(self.TEMPLATE.format(slug=slug))
        jobs: list[Job] = []
        for raw in data.get("result") or []:
            loc = raw.get("location") or {}
            location = ", ".join(
                p for p in (loc.get("city"), loc.get("state")) if p
            )
            job_id = str(raw.get("id", ""))
            jobs.append(
                Job(
                    title=(raw.get("jobOpeningName") or "").strip(),
                    company=slug,
                    url=f"https://{slug}.bamboohr.com/careers/{job_id}",
                    source=self.name,
                    location=location,
                    remote=(
                        True
                        if raw.get("isRemote") is True
                        else _infer_remote(location)
                    ),
                    department=(raw.get("departmentLabel") or "").strip(),
                    employment_type=(
                        raw.get("employmentStatusLabel")
                        or raw.get("employmentType")
                        or ""
                    ),
                    identifier=job_id,
                )
            )
        return jobs

    def is_valid_slug(self, slug: str) -> bool:
        try:
            return len(self.fetch(slug)) > 0
        except HttpError:
            return False


class SmartRecruitersAdapter(ATSAdapter):
    name = "smartrecruiters"
    # Exposes company.name, and paginates: totalFound is the true board size,
    # not the page length.
    trusts_slug = False
    TEMPLATE = "https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100"

    def board_company(self, slug: str) -> str | None:
        data = self.get(self.TEMPLATE.format(slug=slug))
        for raw in data.get("content", []):
            name = (raw.get("company") or {}).get("name")
            if name:
                return name.strip()
        return None

    def total_count(self, slug: str) -> int:
        data = self.get(
            f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1"
        )
        return int(data.get("totalFound", 0) or 0)

    #: Page size SmartRecruiters accepts; also the max per request.
    PAGE_SIZE = 100
    #: Safety cap on pages, so a huge board cannot make one run unbounded.
    MAX_PAGES = 10

    def fetch(self, slug: str) -> list[Job]:
        """Fetch the whole board, paging past the 100-per-request limit.

        A single request silently truncated boards (Aramark reports 603). Pages
        are read until `totalFound` is reached or MAX_PAGES is hit; the latter
        still yields a `partial` signal upstream rather than pretending to be
        complete.
        """
        jobs: list[Job] = []
        total = None
        for page in range(self.MAX_PAGES):
            data = self.get(
                self.TEMPLATE.format(slug=slug) + f"&offset={page * self.PAGE_SIZE}"
            )
            content = data.get("content") or []
            if total is None:
                total = int(data.get("totalFound", 0) or 0)
            if not content:
                break
            jobs.extend(self._to_jobs(content, slug))
            if len(jobs) >= total:
                break
        return jobs

    def _to_jobs(self, content: list[dict[str, Any]], slug: str) -> list[Job]:
        jobs: list[Job] = []
        for raw in content:
            loc = raw.get("location") or {}
            location = loc.get("fullLocation") or _join_loc(loc)
            jobs.append(
                Job(
                    title=(raw.get("name") or "").strip(),
                    company=(raw.get("company") or {}).get("name") or slug,
                    url=f"https://jobs.smartrecruiters.com/{slug}/{raw.get('id','')}",
                    source=self.name,
                    location=location,
                    remote=bool(loc.get("remote")),
                    department=_sr_department(raw),
                    employment_type=raw.get("typeOfEmployment", "") or "",
                    posted_at=raw.get("releasedDate"),
                    identifier=str(raw.get("id", "")),
                )
            )
        return jobs

    def is_valid_slug(self, slug: str) -> bool:
        # CRITICAL: status code is NOT the signal. Unknown slugs return
        # HTTP 200 with totalFound == 0.
        try:
            data = self.get(
                f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1"
            )
        except HttpError:
            return False
        return int(data.get("totalFound", 0) or 0) > 0


def _sr_department(raw: dict[str, Any]) -> str:
    """SmartRecruiters exposes two label fields; `department` is often empty.

    Verified live: Sodexo returns `department: {}` but `function: {label:
    "Other"}`. Prefer whichever actually has a label so roles are not all
    reported as "unspecified".
    """
    dept = (raw.get("department") or {}).get("label")
    if dept:
        return str(dept).strip()
    func = (raw.get("function") or {}).get("label")
    return str(func).strip() if func else ""


def _join_loc(loc: dict[str, Any]) -> str:
    parts = [loc.get("city"), loc.get("region"), loc.get("country")]
    return ", ".join(p for p in parts if p)


def _infer_remote(location: str) -> bool | None:
    if not location:
        return None
    low = location.lower()
    if "remote" in low or "anywhere" in low or "distributed" in low:
        return True
    return None


def all_adapters(
    timeout: float = 20.0, cache_ttl: float = 0.0, cache_dir: str = ""
) -> list[ATSAdapter]:
    """The ATSes addressable by a single company slug (shared-domain APIs)."""
    kwargs = {"cache_ttl": cache_ttl, "cache_dir": cache_dir}
    return [
        GreenhouseAdapter(timeout, **kwargs),
        LeverAdapter(timeout, **kwargs),
        AshbyAdapter(timeout, **kwargs),
        SmartRecruitersAdapter(timeout, **kwargs),
        BambooHRAdapter(timeout, **kwargs),
    ]


def shared_domain_site_targets() -> list[str]:
    """Hosts that work as `site:` targets because they are path-based.

    Canonical hosts only (verified live):
      * greenhouse moved boards.greenhouse.io -> job-boards.greenhouse.io (301)
      * smartrecruiters moved jobs.smartrecruiters.com -> careers.smartrecruiters.com (301)

    icims and workday are deliberately excluded: they are per-tenant subdomains
    (careers-<company>.icims.com, <company>.wd1.myworkdayjobs.com), so a `site:`
    query on the bare domain returns almost nothing.
    """
    return [
        "job-boards.greenhouse.io",
        "jobs.lever.co",
        "jobs.ashbyhq.com",
        "careers.smartrecruiters.com",
        "jobs.jobvite.com",
        "jobs.bamboohr.com",
        "apply.jazz.co",
        "careers.workable.com",
    ]
