# Reading JavaScript-rendered boards with a headless browser

**Rejected.** The skill does not drive a browser to read a board. Workable is the
known case, along with JS-rendered custom career sites.

## Why

- **It breaks the zero-dependency rule.** A headless browser is a third-party
  runtime dependency. The root README's rule 4 says a skill that needs one at
  runtime stops being copyable on its own, which is the point of `dist/`.
- **Workable has no usable endpoint.** Its careers pages are JS-rendered, and the
  widget API returned an empty job list for every account tested, with no public
  jobs endpoint. Recorded in `README.md` for every account the maintainer tested.
  Not re-tested for this file.

## What the repo does instead

The skill reports the company as unreadable, names the platform, and hands over a
discovery query. It never reports "not hiring" from a board it could not read.
