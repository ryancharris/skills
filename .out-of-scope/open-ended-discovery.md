# Open-ended discovery ("who is hiring?")

**Rejected.** The skill needs company names. It does not produce a list of
companies to search.

## Why

- **It is an inspector, not a finder.** Each result is a complete read of one
  company's board. A discovered list would be a ranking of companies, and nothing
  in ATS data supports a ranking.
- **A curated list goes stale and becomes an endorsement.** Someone has to decide
  which companies belong, and keep that decision current. That is editorial work
  the tool cannot do honestly.
- **Discovery quietly fails on enterprises.** The companies people most want to
  find are the ones on bespoke career sites this skill cannot read. A discovery
  list would hide that.

## What the repo does instead

The skill tells the user this up front, then offers three routes: names the user
already has, `--queries` for boolean `site:` searches they can run themselves, or
the layoff data as a name generator (see `layoff-filing-seeding.md`). The agent must
not present an improvised list as comprehensive.
