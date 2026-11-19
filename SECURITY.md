# Security policy

## Reporting a vulnerability

Do not open a public issue. Report it privately through this repository's
**Security** tab ("Report a vulnerability"), using GitHub's private vulnerability
reporting. If you are reporting an exposed API key, rotate it first.

## In scope

- Code in `skills/job-board/src/` and the compiled `dist/`.
- Ways untrusted text from ATS boards or search results (titles, companies,
  snippets, URLs) can escape its handling in `makeJob` and reach the agent as
  instructions, or produce a non-http(s) URL.
- Ways the skill can leak a `JOB_BOARD_*` API key, for example in output or logs.

## Out of scope

- Content of third-party job boards and search results themselves.
- Vulnerabilities in dev dependencies that do not ship in `dist/`.

## Supported versions

Only the latest release.
