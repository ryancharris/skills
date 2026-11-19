# Search providers

## What the search key is for

The search key is an **optional add-on**. The skill is fully useful without it, because
the user can paste queries into a search engine, and none of these need a key:

- site queries: `--queries --title T` prints them. They name each `--company` you pass;
- the careers query for an unreadable company: `--check` prints it in every format, a
  role search of unreadable companies prints it in md, detail and html, and the JSON
  `queries` array of both holds it.

The key enables the search fallback, and nothing else. The search fallback:

- runs **once per run**, only when no named company yielded a posting and a `--title`
  was given;
- makes a general search of the supported systems' sites through the search provider,
  one search for each of the first three systems (Greenhouse, Lever, Ashby), in the form
  `site:<ats-domain> ("title" OR "synonym")`. The searches do not name the company;
- returns search results (title, link, snippet, and a company name guessed from the
  title or link). They may be other companies' roles, not the one you named, and the
  output says so;
- never adds to postings read from a board, and never follows a link.

`--check` never reads the key.

The output links to this page when it offers the key. Setup follows.

## Configuration

A single `JOB_BOARD_SEARCH_API_KEY` serves whichever provider is selected, so
switching search providers is a one-variable change:

```bash
export JOB_BOARD_SEARCH_API_KEY=...      # your key, for whichever provider
export JOB_BOARD_SEARCH_PROVIDER=kagi    # kagi (default), brave, or exa
```

Keys are created at: Kagi https://kagi.com/settings/api · Brave
https://api.search.brave.com/ · Exa https://dashboard.exa.ai/api-keys

An unknown provider fails with exit 2 rather than falling back to kagi: a silent
fallback would send searches to the wrong search provider and bill the wrong account. The
same applies if two names for one setting are set to *different* values. The error
names the variables and never prints a key.

### Tuning

All settings share the `JOB_BOARD_` prefix:

```bash
export JOB_BOARD_HTTP_TIMEOUT=20         # seconds, must be positive (default 20)
export JOB_BOARD_CACHE_TTL=300           # seconds to reuse ATS responses; 0 = off (default 0)
export JOB_BOARD_CACHE_DIR=~/.cache/job-board   # default: $HOME/.cache/job-board
```

An invalid value (for example a non-numeric or non-positive timeout, or a negative
TTL) is a hard error (exit 2) rather than a silent default.

### Deprecated names

The former names still work, but each one that is set prints a deprecation warning.
They will be removed in a future release:

| Setting | Former names |
|---|---|
| `JOB_BOARD_SEARCH_API_KEY` | `LAID_OFF_SEARCH_API_KEY`, `SEARCH_API_KEY` |
| `JOB_BOARD_SEARCH_PROVIDER` | `LAID_OFF_SEARCH_PROVIDER`, `JOBSEARCH_SEARCH_PROVIDER` |
| `JOB_BOARD_HTTP_TIMEOUT` | `LAID_OFF_HTTP_TIMEOUT`, `JOBSEARCH_HTTP_TIMEOUT` |
| `JOB_BOARD_CACHE_TTL` | `LAID_OFF_CACHE_TTL`, `JOBSEARCH_CACHE_TTL` |
| `JOB_BOARD_CACHE_DIR` | `LAID_OFF_CACHE_DIR`, `JOBSEARCH_CACHE_DIR` |

`LAID_OFF_` is the skill's former name. The current name wins over a former one.

## Kagi (default)

The **v1** API. The legacy **v0** API is deprecated — do not use it.

```
POST https://kagi.com/api/v1/search
Authorization: Bearer $JOB_BOARD_SEARCH_API_KEY
Content-Type: application/json

{"query": "site:jobs.ashbyhq.com (\"chief of staff\" OR \"CoS\")"}
```

Response envelope — **captured from the live API**, not inferred:

```json
{
  "meta": {"trace": "014fb...", "ms": 786, "node": "us-central1"},
  "data": {
    "search": [
      {
        "url": "https://jobs.ashbyhq.com/middesk/0a70...",
        "title": "Chief of Staff @ Middesk",
        "snippet": "As <strong>Chief</strong> of <strong>Staff</strong>, you&#39;ll ...",
        "time": "2026-11-08T14:20:48Z",
        "props": {"language": "en", "group_id": "jobs.ashbyhq.com"}
      }
    ]
  }
}
```

- `data` is an **object** with a `search` list — *not* a list of typed objects.
  This cost a full session: an earlier implementation assumed the legacy v0
  shape (`data: [{"t": 0, ...}]`), passed its own hand-written mocks, and
  returned nothing against production. Only a live call revealed it.
- `snippet` contains inline `<strong>` highlight tags and HTML entities
  (`&#39;`). The provider strips both.
- `data` may be `{}` or `null` for a query with no results — treat as empty.
- On failure the payload carries `errors: [{"code", "message"}]`.

### Error codes (observed live)

| HTTP | `errors[].code` | Meaning |
|---|---|---|
| 401 | `general.no_authorization_provided` | Missing header. Must be `Bearer TOKEN`. |
| 400 | `general.invalid_token` | Token failed signature verification. |

The skill raises `SearchError` on any `errors[]` entry rather than silently
returning zero results.

### Pricing

Billed per query (~$25 / 1000 searches). A run makes at most three searches, and only
when the search fallback runs (see above). It stops at the first fatal error rather than
retrying per domain, so cost stays bounded. Board discovery is free; prefer it.

## Brave

Secondary implementation:

```
GET https://api.search.brave.com/res/v1/web/search?q=...&count=20
X-Subscription-Token: $JOB_BOARD_SEARCH_API_KEY
Accept: application/json
```

Results at `web.results[]` with `url`, `title`, `description`.

A bad token is answered with HTTP 422 and code `SUBSCRIPTION_TOKEN_INVALID` (observed
with a made-up key). The provider maps that to "Brave rejected the API key".

## Exa

Documented at https://docs.exa.ai (search endpoint):

```
POST https://api.exa.ai/search
x-api-key: $JOB_BOARD_SEARCH_API_KEY
Content-Type: application/json

{"query": "...", "type": "auto", "numResults": 20, "contents": {"highlights": true}}
```

Results at `results[]` with `url`, `title`, and `highlights` (an array of strings); the
snippet is the first highlight, else `summary`, else the start of `text`. `numResults`
is capped at 20 here; the documented maximum is 100.

Observed with made-up keys: a bad key gets HTTP 401 with `tag: INVALID_API_KEY`; no key
gets HTTP 402 with `tag: X402_PAYMENT_REQUIRED`, which asks the caller to pay per request.
The provider never sends a request without a key, so the 402 path is not reachable
through the skill.

## Adding a provider

Extend `SearchProvider` in `src/search.ts`:

```ts
export class MyProvider extends SearchProvider {
  readonly name = "myprovider";
  async search(query: string, limit = 20): Promise<SearchResult[]> { /* ... */ }
}
```

Then add the name to `SUPPORTED_PROVIDERS` in `src/config.ts`, and add a branch to
`buildProvider()` in `src/search.ts`. Keep the `SearchError` contract: throw on failure,
never return a silent empty list.
