# Search providers

The search engine is only used for the **fallback** path: generating and
executing `site:<ats-domain> ("title" OR "synonym")` queries when a company has
no supported ATS board. Query *generation* needs no key — only execution does.

## Configuration

A single `LAID_OFF_SEARCH_API_KEY` serves whichever provider is selected, so
switching backends is a one-variable change:

```bash
export LAID_OFF_SEARCH_API_KEY=...      # your key, for whichever provider
export LAID_OFF_SEARCH_PROVIDER=kagi    # kagi (default) or brave
```

An unknown provider fails with exit 2 rather than falling back to kagi: a silent
fallback would send searches to the wrong engine and bill the wrong account.

## Kagi (default)

The **v1** API. The legacy **v0** API is deprecated — do not use it.

```
POST https://kagi.com/api/v1/search
Authorization: Bearer $LAID_OFF_SEARCH_API_KEY
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

Billed per query (~$25 / 1000 searches). The fallback only runs for companies
that resolve to no ATS board, and it stops at the first fatal error rather than
retrying per domain, so cost stays bounded. Prefer ATS API discovery (free).

## Brave

Secondary implementation:

```
GET https://api.search.brave.com/res/v1/web/search?q=...&count=20
X-Subscription-Token: $LAID_OFF_SEARCH_API_KEY
Accept: application/json
```

Results at `web.results[]` with `url`, `title`, `description`.

## Adding a provider

Implement `SearchProvider` in `jobsearch/search/__init__.py`:

```python
class MyProvider(SearchProvider):
    name = "myprovider"
    def search(self, query: str, limit: int = 20) -> list[SearchResult]: ...
```

Then register it in `build_provider()`. Keep the `SearchError` contract: raise
on failure, never return a silent empty list.
