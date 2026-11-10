# Seeding searches from layoff filings

**Rejected.** `laid-off` does not build its company list from WARN Act filings or a
layoff tracker.

## What was tried

An earlier version seeded searches from `kadoa-org/layoffs-tracker` (about 30,430
companies). It was removed after measurement.

1. **WARN cannot express "tech".** The fields are company, workers, states and
   dates, with no industry or occupation. The seed returned Boeing, Walmart,
   Sodexo, Tyson Foods and a school-bus operator.
2. **The seed and the searchable pool are anti-correlated.** The largest filers
   (Amazon, Meta, Google, Intel, Microsoft) resolve on none of the supported ATSes,
   so the most interesting companies were the least searchable.
3. **Low yield.** 8 of 60 recent filers resolved to any board, several of them
   look-alikes that identity verification later rejected.

## What the repo does instead

`--check` starts from a company the user cares about and asks whether it is still
hiring, and for what. `references/layoff-data.md` in the skill documents the
filing data as a name generator only, with the caveats.

Source of the removed behaviour: the "Why not seed from layoff filings" section of
`laid-off/SKILL.md`, and the history in `laid-off/CHANGELOG.md`.
