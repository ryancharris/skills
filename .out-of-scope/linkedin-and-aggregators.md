# Scraping LinkedIn or job aggregators

**Rejected.** `job-board` reads ATS job boards directly. It does not scrape LinkedIn,
Indeed, or other aggregators.

## Why

- **The ATS is the source of truth.** Aggregators repost listings later, after the
  first wave of applicants. A board shows the role when it opens.
- **ATS data is structured.** Locations, departments, compensation and post dates
  come from the vendor's API. Aggregator pages need HTML scraping that breaks when
  the site changes.
- **Complete.** A board lists every open role at a company, not a ranked subset.

## Scope of the claim

These reasons are product reasons. Any legal or terms-of-service question about
scraping those sites has not been assessed here, and this file does not claim it
has been.
