# ATS endpoints (verified against live responses)

All endpoints are public and unauthenticated. Verified 2026-11-08.

A **User-Agent header is mandatory** for Ashby (403 without one). The skill's
`src/http.ts` always sends one.

## Greenhouse

```
GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
```

- Unknown slug → **HTTP 404** `{"status":404,"error":"Job not found"}`
- Public board host moved: `boards.greenhouse.io` → **`job-boards.greenhouse.io`** (301)
- Payload:

```json
{"jobs": [{
  "id": 8172487,
  "title": "Abuse Investigator",
  "company_name": "Stripe",
  "absolute_url": "https://stripe.com/jobs/search?gh_jid=8172487",
  "location": {"name": "Dublin"},
  "updated_at": "2026-10-29T10:42:09-04:00",
  "first_published": "2026-09-03T13:30:34-04:00"
}]}
```

- `company_name` is the identity signal used to reject look-alike boards.

## Lever

```
GET https://api.lever.co/v0/postings/{slug}?mode=json
```

- Unknown slug → **HTTP 404**; some malformed slugs → `200 {"ok": false}`
- Payload is a **top-level array**:

```json
[{
  "id": "6ed76ce8-...",
  "text": "Administrative Business Partner",
  "hostedUrl": "https://jobs.lever.co/palantir/6ed76ce8-...",
  "createdAt": 1786469891368,
  "workplaceType": "remote",
  "categories": {
    "location": "Singapore, Singapore",
    "team": "Administrative",
    "commitment": "Full-time",
    "allLocations": ["Singapore, Singapore"]
  }
}]
```

- `createdAt` is epoch **milliseconds**.

## Ashby

```
GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
```

- Unknown slug → **HTTP 404**
- **403 without a User-Agent**
- Payload:

```json
{"apiVersion": "...",
 "jobs": [{
   "id": "34413f8d-...",
   "title": " Security Engineer, Cloud",
   "location": "New York, NY (HQ)",
   "jobUrl": "https://jobs.ashbyhq.com/ramp/34413f8d-...",
   "publishedAt": "2026-04-07T17:12:35.753+00:00",
   "isRemote": true,
   "department": "Engineering",
   "employmentType": "FullTime",
   "compensation": {
     "compensationTierSummary": "$211.4K – $290.6K • Offers Equity",
     "scrapeableCompensationSalarySummary": "$211.4K - $290.6K",
     "compensationTiers": [{"components": [{
       "compensationType": "Salary", "interval": "1 YEAR",
       "currencyCode": "USD", "minValue": 211400, "maxValue": 290600}]}]
   }
 }]}
```

- Exposes **no company name** — slug validity relies on the 404 alone.

## SmartRecruiters

```
GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100
```

- Unknown slug → **HTTP 200 with `totalFound: 0`** — the status code is *not* a
  validity signal. Use `totalFound > 0`.
- Paginated: `limit` caps the page (100), `totalFound` is the true size. The skill
  reads at most 10 pages (1,000 postings); a larger board is flagged `partial`.
- Hosts differ by page type (checked 2026-11-10):
  - Board root: `jobs.smartrecruiters.com/<slug>` → **301** to `careers.smartrecruiters.com/<slug>`.
  - Job link: `jobs.smartrecruiters.com/<slug>/<id>` → **200**, with the job. The same path on
    `careers.` → **302** back to the board, so the job is lost. The skill emits the `jobs.` job link.
  - The vendor's detail API (`/v1/companies/<slug>/postings/<id>`) uses `jobs.` in its
    `postingUrl`, `applyUrl` and `referralUrl` fields. Do not switch job links to `careers.`.
- Slugs are often suffixed (`Ubisoft2`, not `Ubisoft`).
- Payload:

```json
{"offset": 0, "limit": 100, "totalFound": 298,
 "content": [{
   "id": "744000160228509",
   "name": "Superviseur·e Texture & LookDev",
   "releasedDate": "2026-11-06T15:01:26.091Z",
   "company": {"identifier": "Sodexo", "name": "Sodexo"},
   "location": {"city": "Montreal", "region": "QC", "country": "ca",
                "remote": false, "hybrid": false,
                "fullLocation": "Montreal, QC, Canada"},
   "department": {"label": "..."},
   "typeOfEmployment": "..."
 }]}
```

## BambooHR

```
GET https://{slug}.bamboohr.com/careers/list
```

- Per-tenant host — reachable only by slug probing, never by a bare `site:` query.
- Unknown tenant → **an HTML error page, not JSON**. `http.get_json` converts a
  non-JSON body into `HttpError`, so probing treats it as "no board" instead of
  crashing (this was a real bug: it raised an uncaught `JSONDecodeError`).
- Payload:

```json
{"meta": {"totalCount": 4},
 "result": [{
   "id": "15",
   "jobOpeningName": "IT Security Engineer",
   "departmentLabel": "IT",
   "employmentStatusLabel": "Full-Time",
   "location": {"city": "Mayfair", "state": "London, City of"},
   "isRemote": null,
   "locationType": "0"
 }]}
```

## Deliberately unsupported

| ATS | Why |
|---|---|
| **iCIMS** | Per-tenant: `careers-<company>.icims.com` |
| **Workday** | Per-tenant: `<company>.wd1.myworkdayjobs.com` |
| **Workable** | No usable public jobs API. Careers pages are JS-rendered with no embedded data; `apply.workable.com/api/v1/widget/accounts/{slug}` returns `jobs: []` for every account tested (coinbase, hotjar, groupon, typeform, 11x). The earlier "Cloudflare 1015" was transient and is not the blocker. Supporting it would need a headless browser, breaking the stdlib-only rule. |

A `site:` query on the bare iCIMS/Workday domain returns almost nothing, which is
why the upstream advice to use them is misleading.

## Measured reliability

Probing 26 modern tech companies (Stripe, Ramp, Notion, Figma, Databricks,
Anthropic, OpenAI, …):

- **22/26 (85%)** resolved to a live board.
- Greenhouse 16, Ashby 7, **Lever 0**, SmartRecruiters 0.
- Some companies have a stale board on one ATS shadowing the real one
  (`ramp`: greenhouse 1 job vs ashby 169). Rank boards by posting count.
