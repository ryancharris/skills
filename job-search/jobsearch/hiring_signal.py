"""Post-layoff hiring-signal check: "they cut staff -- are they still hiring?"

Why this exists, and why it is not a layoff *feed*
--------------------------------------------------
An earlier design seeded searches directly from WARN Act filings. Measured on
the live dataset (kadoa-org/layoffs-tracker, 30,430 companies), that failed for
three reasons and was removed:

1. **WARN cannot express "tech".** The fields are canon/name/notices/workers/
   states/last_filed/first_filed -- no industry, sector, or occupation. Seeding
   returned Boeing, Walmart, Sodexo, Tyson Foods, Gebbers Farms and a school-bus
   operator, not tech companies.
2. **The seed and the searchable pool are anti-correlated.** The largest filers
   (Amazon, Meta, Google, Intel, Microsoft, Walmart) resolve on 0 of the 4
   supported ATSes, so the companies most worth investigating are exactly the
   ones we cannot query.
3. **Resolution rate was ~13%** (8 of 60 recent filers), and several of those
   were look-alike boards later rejected by identity verification.

What *is* genuinely useful is the inverse framing. Given a company the user
already cares about, answer: is this company hiring right now, and for what?
A company that just cut staff but is still posting roles tells you where it is
re-investing -- that is actionable, and it works with the data we have because
it starts from a name rather than from a filing feed.

So this module holds the *interpretation* of a board snapshot, not a feed
client. The fetching lives in the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .models import Board, Job


# Vendor department names that read as insider jargon to a job seeker.
_DEPARTMENT_ALIASES = {
    "gtm": "Sales & Marketing",
    "go-to-market": "Sales & Marketing",
    "unspecified": "Other / unlabelled",
}


def display_company(name: str) -> str:
    """Present a company name the way a person writes it.

    Some vendors (Ashby) expose no company name, so the ATS slug is used and
    arrives lowercase ("notion"). Title-case it for display only; the
    underlying value is left untouched.
    """
    text = (name or "").strip()
    if not text or not text.islower():
        return text
    return " ".join(word[:1].upper() + word[1:] for word in text.split())


def friendly_department(department: str) -> str:
    """Expand department names a normal reader would not recognise."""
    return _DEPARTMENT_ALIASES.get(department.strip().lower(), department)


@dataclass
class HiringSignal:
    """What a company's live board says about its current hiring."""

    company: str
    board_count: int = 0
    open_roles: int = 0
    #: Departments with the most open roles, biggest first.
    top_departments: list[tuple[str, int]] = field(default_factory=list)
    #: Boards found for this company (ats, slug, size).
    boards: list[Board] = field(default_factory=list)
    #: Whether an open role was posted in the last `recent_days`.
    hiring_recently: bool = False
    recent_roles: int = 0
    #: True when the company resolved to no supported ATS board at all.
    unknown: bool = False
    #: Window used for the "hiring recently" test.
    recent_days: int = 30
    #: Roles the board reports, which can exceed what we fetched (pagination).
    board_reported_roles: int = 0

    @property
    def partial(self) -> bool:
        """True when we saw fewer roles than the board claims to have.

        SmartRecruiters is fetched one 100-job page, so a 155-job board would
        otherwise read as 100 -- understating hiring without saying so.
        """
        return self.board_reported_roles > self.open_roles

    def verdict(self) -> str:
        """One-line human-readable read of the signal."""
        if self.unknown:
            # Two very different causes: a real enterprise on a bespoke career
            # site, or a name that does not exist. Say both, don't guess.
            return (
                f"{self.company}: no job board found. Most likely a large company "
                "with its own careers site, or the name didn't match. Check the "
                "spelling, or search for its careers page."
            )
        if self.open_roles == 0:
            return f"{self.company}: board is live but currently has no open roles."

        top = ", ".join(
            f"{friendly_department(name)} - {n}" for name, n in self.top_departments[:3]
        )
        recency = (
            f"{self.recent_roles} posted in the last {self.recent_days} days"
            if self.hiring_recently
            else "nothing posted recently"
        )

        # "100+" reads as a competent handling of an API page limit, whereas
        # "partial" made it look like something broke.
        plural = "s" if self.open_roles != 1 else ""
        if self.partial:
            count = (
                f"at least {self.open_roles} open role{plural} "
                f"({self.board_reported_roles} total; first page read)"
            )
        else:
            count = f"{self.open_roles} open role{plural}"

        return f"{self.company}: {count} -- {recency}. Top areas: {top or 'n/a'}."

    def to_dict(self) -> dict:
        return {
            "company": self.company,
            "open_roles": self.open_roles,
            "board_count": self.board_count,
            "recent_roles": self.recent_roles,
            "recent_days": self.recent_days,
            "hiring_recently": self.hiring_recently,
            "top_departments": [
                {"department": name, "open_roles": n} for name, n in self.top_departments
            ],
            "boards": [b.to_dict() for b in self.boards],
            "unknown": self.unknown,
            "partial": self.partial,
            "board_reported_roles": self.board_reported_roles,
            "verdict": self.verdict(),
        }


def summarize_hiring(
    company: str,
    boards: list[Board],
    jobs: list[Job],
    *,
    recent_days: int = 30,
    now=None,
) -> HiringSignal:
    """Build a HiringSignal from an already-fetched board snapshot.

    Department is used as the proxy for "what are they investing in". Postings
    without a department are grouped under "unspecified" rather than dropped, so
    the totals always reconcile with `open_roles`.
    """
    from .models import parse_iso, utc_now

    now = now or utc_now()

    live_boards = [b for b in boards if b.job_count]
    signal = HiringSignal(
        company=company,
        boards=live_boards,
        board_count=len(live_boards),
        open_roles=len(jobs),
        recent_days=recent_days,
        board_reported_roles=sum(b.job_count for b in live_boards),
    )

    # "Unknown" means we found no usable board at all. A live board that is
    # simply empty is a real, reportable answer (0 open roles), not unknown.
    if not live_boards:
        signal.unknown = True
        return signal

    counts: dict[str, int] = {}
    for job in jobs:
        dept = (job.department or "").strip() or "unspecified"
        counts[dept] = counts.get(dept, 0) + 1
    signal.top_departments = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))

    for job in jobs:
        posted = parse_iso(job.posted_at)
        if posted and (now - posted).days <= recent_days:
            signal.recent_roles += 1
    signal.hiring_recently = signal.recent_roles > 0

    return signal
