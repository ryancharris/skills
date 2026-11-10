# Layoffs: why the WARN feed was removed

There is no layoff *feed* in this skill any more. This file records why, so the
decision is not silently reversed later.

## What was removed

An earlier version fetched `kadoa-org/layoffs-tracker`
(`public/data/companies.json`, ~30,430 companies, 4.8 MB) and used it to seed
searches: `--layoffs --since YYYY-MM-DD --min-workers N`. Three flags, a download,
a 24 h cache, and a `layoffs.py` module.

## Why

Measured against the live dataset and live ATS endpoints.

### 1. WARN cannot express "tech"

The schema is:

```json
{"canon": "amazon", "name": "Amazon", "notices": 118, "workers": 17612,
 "states": 14, "last_filed": "2026-11-03", "first_filed": "2009-03-25"}
```

There is no industry, sector, or occupation field. Under the WARN Act, any
employer above a size threshold files — so the seed set was whatever filed
notice, not what the user asked for. A live run (`--since 2026-06-01
--min-workers 500`) produced:

```
Amazon, Walmart, Intel, Microsoft, Sodexo, Tyson Foods, Jabil,
Cisco Systems, First Student, General Motors, Gebbers Farms, MV Transportation
```

Agriculture, food service, school-bus operators. "Recent tech layoffs" is not
expressible with this data.

### 2. The seed and the searchable pool are anti-correlated

The largest filers are large enterprises, and enterprises run bespoke career
sites rather than a supported ATS. Measured: Amazon, Microsoft, Meta, Intel,
Walmart and Google resolve on **0** of Greenhouse/Lever/Ashby/SmartRecruiters.

So the companies most worth investigating were precisely the ones the skill
could not query. Seeding and searchability worked against each other.

### 3. Low yield

Of 60 recent filers, **8** resolved to any board (~13%), and several of those
were look-alike boards (`general motors` → "General Interest") later rejected
by identity verification. After that fix, the practical yield per run was a
single usable board.

## What replaced it

The useful inversion, exposed as `--check COMPANY`:

> A company just cut staff. Is it still hiring, and for what?

That starts from a name the user already cares about, works with the data we
have, and produces an actionable read — a company cutting costs while still
posting in a particular department is signalling where it is re-investing.

`src/hiring-signal.ts` holds the interpretation (`summarizeHiring`); `checkHiring` in
`src/pipeline.ts` does the fetching.

Output per company: board count, open roles, roles posted within
`--recent-days`, and the top departments by open roles. For a company with no
supported board it returns `unknown: true` plus a discovery query — never a
misleading `0 open roles`.

## If you want layoff data anyway

It is still a decent *name generator* — it tells you which companies are under
pressure. But pair it with a search API key, because most of those names will
not resolve to a supported board:

```bash
# find names, then check each one
curl -s https://raw.githubusercontent.com/kadoa-org/layoffs-tracker/main/public/data/companies.json \
  | python3 -c 'import json,sys; [print(c["name"]) for c in json.load(sys.stdin) if (c["last_filed"] or "") >= "2026-01-01"]'

node "<skill-dir>/dist/main.js" --check "Company Name"
```

Caveats if you do: `last_filed` is nullable (2,826 of 30,430 records), `workers`
is cumulative across all filings rather than per-notice, and the same employer
appears under variants (`boeing` / `the boeing`).
