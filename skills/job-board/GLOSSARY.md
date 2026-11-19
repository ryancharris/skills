# Job board

Reads the open postings on named companies' applicant-tracking-system boards, so a person or agent can see what a company is hiring for without a job aggregator. It needs company names; it does not find companies.

## Language

### Companies and boards

**Board**:
A company's public list of open postings on a supported applicant tracking system (Greenhouse, Lever, Ashby, SmartRecruiters or BambooHR), read as structured data.
_Avoid_: job site, careers page (a careers page is the company's own website, which the skill cannot read)

**Posting**:
One open position listed on a board. Prose and users say "role" for the same thing.
_Avoid_: job, listing, opening

**Unreadable company**:
A company the user named for which the skill found no board with postings on any supported system, so nothing about its hiring can be said from it. A board with no postings cannot be told apart from a name that has no board, so it counts as unreadable too. An unreadable company never has "zero roles"; its roles were never read.
_Avoid_: unsupported company, company with no roles

### What the skill does

**Role search**:
Listing the postings that match a person's titles, places and other filters at the companies they named.
_Avoid_: job search, job hunt

**Hiring check**:
Reporting whether a named company is hiring, how recently, and in which areas, from its board.
_Avoid_: layoff check, hiring signal

### Finding a company's board

**Board discovery**:
Working out which board, if any, a company has, by trying the names it is likely to use on each supported system.
_Avoid_: discovery (alone)

**Careers query**:
The single search a person can run to learn which applicant tracking system an unreadable company uses.
_Avoid_: discovery query

**Company discovery**:
Finding which companies to look at. The skill does not do this; the user supplies the companies.
_Avoid_: seeding, sourcing

### Searching beyond boards

**Site query**:
A boolean search, limited to the domains of the supported systems, that a person pastes into a search engine to look for postings themselves. It needs no key.
_Avoid_: search query, boolean query

**Search fallback**:
An optional add-on. When no named company yields a posting, it runs a general search of the supported systems' sites and returns search results. It works only with a search key and is never needed for the skill to be useful.
_Avoid_: search-engine fallback, search mode, peer search

**Search key**:
The optional credential that lets the search fallback run.
_Avoid_: API key (alone), search token

**Search provider**:
The search service the search key belongs to (Kagi, Brave or Exa).
_Avoid_: search engine, search backend

**Search result**:
One hit from the search fallback: a title, a link and a snippet. It may belong to a different company than the one searched for, so it is not a posting from that company.
_Avoid_: job, posting, role, peer
