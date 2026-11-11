# Scope

This repo is a set of Agent Skills: self-contained directories that coding agents
(pi, Claude Code, opencode, and other harnesses that read the Agent Skills format)
load on demand. Each skill must be useful on its own. The repo holds the skills and
changes that meet the bar below.

## Repo-wide constraints

Every skill in this repo must:

1. **Be self-contained.** One directory with a `SKILL.md`, as described in the
   [Agent Skills specification](https://agentskills.io/specification), plus the
   scripts, references and assets it needs.
2. **Run with zero runtime dependencies.** Dev tooling is fine. Anything needed at
   runtime ships inside the skill, so the skill can be copied anywhere.
3. **Work three ways:** copied into a skills directory, symlinked into one, and
   run from its own directory. The root README shows each.
4. **Follow the conventions in the root README:** package name after the directory,
   a description under 200 characters, test file names unique across the repo.

## The bar for a change

An issue or pull request is accepted when it clears both parts:

1. **Observed failure.** It describes something that went wrong in a real session:
   what was run, what the skill did, and what was expected. A hypothetical
   improvement ("it would be better if...") does not clear this part.
2. **Fits the constraints.** It does not repeat an idea listed under
   "Already decided" below, it is not a configuration option or a
   branch for one harness, and it is not a tweak to suit one person's workflow. Those
   belong in the user's own `AGENTS.md` or `CLAUDE.md`, or in a fork.

Size does not matter. A one-word fix faces the same bar as a rewrite.

## New skills

New skills are welcome and face the same bar. A proposal must name the observed need
in a real session, say why an existing skill cannot meet it, and meet the constraints
above.

## Already decided

Each entry below records one rejected idea and why. A proposal that repeats one needs
new evidence, not a restatement.

### Reading JavaScript-rendered boards with a headless browser

**Rejected.** The skill does not drive a browser to read a board. Workable is the
known case, along with JS-rendered custom career sites.

- **It breaks the zero-dependency rule.** A headless browser is a third-party runtime
  dependency. Rule 4 in the root README says a skill that needs one at runtime stops
  being copyable on its own, which is why `skills/job-board/dist/` exists.
- **Workable has no usable endpoint.** Its careers pages are JS-rendered, and the
  widget API returned an empty job list for every account tested, with no public jobs
  endpoint. The accounts are listed in
  [`skills/job-board/references/ats-endpoints.md`](skills/job-board/references/ats-endpoints.md).

The skill reports the company as unreadable, names the platform, and hands over a
discovery query. It never reports "not hiring" from a board it could not read.

### Seeding searches from layoff filings

**Rejected.** `job-board` does not build its company list from WARN Act filings or a
layoff tracker.

An earlier version seeded searches from `kadoa-org/layoffs-tracker` (about 30,430
companies). It was removed after measurement:

1. **WARN cannot express "tech".** The fields are company, workers, states and dates,
   with no industry or occupation. The seed returned Boeing, Walmart, Sodexo, Tyson
   Foods and a school-bus operator.
2. **The seed and the searchable pool are anti-correlated.** The largest filers
   (Amazon, Meta, Google, Intel, Microsoft) resolve on none of the supported ATSes, so
   the most interesting companies were the least searchable.
3. **Low yield.** 8 of 60 recent filers resolved to any board, several of them
   look-alikes that identity verification later rejected.

`--check` starts from a company the user cares about and asks whether it is still
hiring, and for what. `skills/job-board/references/layoff-data.md` documents the filing data
as a name generator only, with the caveats.

The removed behaviour is described in the history of `skills/job-board/CHANGELOG.md`.

### Scraping LinkedIn or job aggregators

**Rejected.** `job-board` reads ATS job boards directly. It does not scrape LinkedIn,
Indeed, or other aggregators.

- **The ATS is the source of truth.** Aggregators repost listings later, after the
  first wave of applicants. A board shows the role when it opens.
- **ATS data is structured.** Locations, departments, compensation and post dates come
  from the vendor's API. Aggregator pages need HTML scraping that breaks when the site
  changes.
- **Complete.** A board lists every open role at a company, not a ranked subset.

These are product reasons. Any legal or terms-of-service question about scraping those
sites has not been assessed, and this section does not claim it has been.

### Open-ended discovery ("who is hiring?")

**Rejected.** The skill needs company names. It does not produce a list of companies to
search.

- **It is an inspector, not a finder.** Each result is a complete read of one company's
  board. A discovered list would be a ranking of companies, and nothing in ATS data
  supports a ranking.
- **A curated list goes stale and becomes an endorsement.** Someone has to decide which
  companies belong, and keep that decision current. That is editorial work the tool
  cannot do honestly.
- **Discovery quietly fails on enterprises.** The companies people most want to find are
  the ones on bespoke career sites this skill cannot read. A discovery list would hide
  that.

The skill tells the user this up front, then offers three routes: names the user already
has, `--queries` for boolean `site:` searches they can run themselves, or the layoff
filings as a name generator (see "Seeding searches from layoff filings" above). The
agent must not present an improvised list as comprehensive.

Each skill also states its own boundary in its `SKILL.md`, under "what this can and
cannot do".
