# job-board

[![CI](https://github.com/ryancharris/skills/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ryancharris/skills/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An agent skill and command-line tool that lists the open roles on the public job boards (Greenhouse, Lever, Ashby, SmartRecruiters and BambooHR) of the companies you name. It needs Node.js 20+, and it cannot find which companies are hiring: you supply the names.

```bash
git clone https://github.com/ryancharris/skills && cd skills
node skills/job-board/dist/main.js --company Stripe --title "software engineer" --format md
# to use it from an agent instead of the command line, see "Get the skill" below
```

It is free to run and needs no account or key: it makes HTTPS requests to the public job-board APIs for the company names you give it, and to nothing else, unless you set the optional search key, in which case job-title search queries also go to the search provider you chose. It has no telemetry. Details are in [What it sends](skills/job-board/README.md#what-it-sends).

## Installation

Requires Node.js 20+. Nothing needs to be built or installed with npm: the compiled
JavaScript is committed in the repo, and the skill has no runtime dependencies.

### 1. Get the skill

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude plugin marketplace add ryancharris/skills
claude plugin install job-board@ryancharris-skills
```

Installs for your user. Works without a GitHub account or SSH key.

</details>

<details>
<summary><strong>pi</strong></summary>

```bash
pi install git:github.com/ryancharris/skills
```

Installs the skill and pi's hiring-claims extension. Works without a GitHub account or SSH key.
Remove with `pi remove git:github.com/ryancharris/skills`.

</details>

<details>
<summary><strong>Any other agent, or editable files</strong> (manual updates)</summary>

```bash
git clone https://github.com/ryancharris/skills
cd skills
mkdir -p ~/.agents/skills
ln -s "$PWD/skills/job-board" ~/.agents/skills/job-board   # or: cp -r skills/job-board ~/.agents/skills/
```

pi and opencode read `~/.agents/skills/`. The symlink keeps the repo as the source of truth:
run `git pull` to update. A symlinked skill does not load pi's extension; install the pi
package for that (see the skill README).

</details>

### 2. Use it

Ask your agent for roles at companies you name, or run the CLI directly from the repo root:

```bash
node skills/job-board/dist/main.js --company Stripe --title "software engineer" --format md
```

## Optional add-on: search key

The skill is fully useful without a search key. Most companies with a supported job
board need nothing. For a company it cannot read (Amazon, Google, Meta and similar), a
role search prints its careers query, and `--queries` with a `--title` prints site queries,
to paste into a search engine.

A search key adds one thing: the search fallback. It runs once per run, only when no
company you named yielded a posting and you gave a `--title`. It makes a general search
of the first three supported systems' sites (not naming the company) through your search
provider and returns search results: a title, a link and a snippet. These may be other companies'
roles, not the one you asked about. It does not add to postings read from a board.

The skill uses one search provider at a time, chosen with `JOB_BOARD_SEARCH_PROVIDER`.

| Provider | `JOB_BOARD_SEARCH_PROVIDER` | Get a key | Verified with a real key |
|---|---|---|---|
| Kagi (default) | `kagi` | https://kagi.com/settings/api | Yes, 2026-11-11 |
| Exa | `exa` | https://dashboard.exa.ai/api-keys | Yes, one live query, 2026-11-11 |
| Brave | `brave` | https://api.search.brave.com/ | Not yet ([issue #60](https://github.com/ryancharris/skills/issues/60)) |

1. Create an account with the provider and create a search key in its dashboard (links above).
2. Put the key and the provider in your shell profile (`~/.zshrc` or `~/.bashrc`), or in the environment your agent runs in:

   ```bash
   export JOB_BOARD_SEARCH_API_KEY="paste-your-key-here"
   export JOB_BOARD_SEARCH_PROVIDER=kagi     # or exa, or brave
   ```

3. Open a new terminal, or run `source ~/.zshrc`, so the variables are set.

To test a key, run one live query from the skill directory (it is billed to that key):

```bash
cd skills/job-board
LIVE_KAGI_API_KEY="$JOB_BOARD_SEARCH_API_KEY" npm run test:live -- tests-ts/live/search.test.ts
```

Use `LIVE_EXA_API_KEY` or `LIVE_BRAVE_API_KEY` in place of `LIVE_KAGI_API_KEY` for the other providers.

- An unknown provider name is an error, not a silent fallback.
- A run that reaches the search fallback makes up to three billed searches on that account. A run that does not reach it makes none.
- Keep the key out of chat, commits and shared files. The CLI never prints it.
- Tuning variables and the rest of the configuration are in the [skill README](skills/job-board/README.md#search-providers).

## Skills

| Skill | What it does | README |
|---|---|---|
| `job-board` | Find live job postings by querying company ATS boards (Greenhouse, Lever, Ashby, SmartRecruiters, BambooHR) directly, and check whether a company is still hiring after a layoff. It needs company names; it cannot find companies that are hiring. | [skills/job-board/README.md](skills/job-board/README.md) |

## Support

This is maintained by one person on a best-effort basis, with no response-time promise.

- Bug reports, feature requests and questions: [GitHub Issues](https://github.com/ryancharris/skills/issues/new/choose), using the issue forms. GitHub Discussions are off.
- Security reports: use GitHub's private vulnerability reporting, not a public issue. See [SECURITY.md](SECURITY.md).

## For contributors

### Layout

```
<repo root>
├── skills/
│   ├── job-board/         # one skill per directory; self-contained
│   │   ├── SKILL.md           # required: frontmatter + instructions
│   │   ├── dist/              # compiled JS -- what actually runs
│   │   ├── src/               # TypeScript source
│   │   ├── tests-ts/          # unit, end-to-end, live (opt-in), golden-vector
│   │   ├── references/        # detailed docs loaded on demand
│   │   ├── package.json       # dev-only deps; zero runtime deps
│   │   ├── tsconfig.json
│   │   └── README.md
│   └── <next-skill>/
│       └── SKILL.md
├── evals/                 # manual test harness (see below)
├── .github/               # CI workflow, repo automation
├── .claude-plugin/        # Claude Code plugin + marketplace manifests
├── package.json           # pi package manifest; declares the skills (no dependencies)
├── README.md              # this file
├── LICENSE                # MIT, covers the whole repo
├── SCOPE.md               # the bar a change must clear; ideas already rejected
├── CONTRIBUTING.md        # how to file issues and pull requests
├── SECURITY.md            # how to report a vulnerability
├── AGENTS.md              # instructions for coding agents working in this repo
├── CLAUDE.md              # symlink to AGENTS.md
├── GLOSSARY-MAP.md        # index of each skill glossary
├── .gitleaks.toml         # secret-scanning config
└── .gitignore             # repo-wide; ignores every skill's toolchain dirs
```

`evals/` is a clean-room harness that runs the skill through real agents in Docker. It is
run by hand, costs money and calls live boards, and is not needed to use the skill. See
[evals/README.md](evals/README.md).

The Claude Code plugin and the pi
package each list skill paths in their manifests (`.claude-plugin/plugin.json` and
`package.json`), so a new skill must be added to both.

### Conventions for new skills

Four rules keep skills independent. They exist because the alternative was
measured to break: a shared package name lets one skill shadow another's
imports, and same-named test files collide in a runner's flat namespace.

1. **Name the package after the directory.** The `job-board` skill's package is
   `job-board-skill`; the skill ships its source in `skills/job-board/src/`. Never import a
   sibling skill's package — copy the helper instead.
2. **Keep `description` under 200 characters.** It is paid on every model turn
   that considers loading the skill, so it must be tight: what it does, plus
   the trigger. Do not put caveats there; put them in the body.
3. **Make test file names unique across the repo** (`cli.test.ts`, not
   `test.ts`). Test runners collect everything into one namespace when run from
   the root.
4. **Ship zero runtime dependencies.** Dev tooling (typescript, vitest)
   is fine and stays in the repo's ignore list. But a skill that needs a
   third-party package at *runtime* stops being copyable on its own. `job-board`
   compiles to dependency-free JavaScript for exactly this reason.

A skill must work three ways, and `job-board` is tested all three:

```bash
node /path/to/skill-name/dist/main.js                 # copied anywhere, no npm install
ln -s "$PWD/skill-name" ~/.agents/skills/skill-name  # symlinked into a harness
cd skill-name && npm test                            # tests in isolation
```

### Runtimes

Skills are independent, so each may choose its own runtime:

| Skill | Runtime | Test |
|---|---|---|
| `job-board` | Node.js 20+ (TypeScript source, compiled) | `npm test` |

There is no shared language requirement — only the rules above. Dev
dependencies are installed per skill inside its own directory, so one skill's
toolchain cannot affect another's.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request. Four jobs:

| Job | What it proves |
|---|---|
| `test (node 20)`, `test (node 22)`, `test (node 24)` | Typecheck + the offline suite passes on the declared minimum and newer runtimes |
| `dist matches src` | Committed `dist/` was rebuilt after the last `src/` change, so shipped code matches source |
| `runs standalone (no node_modules)` | The skill executes with **no `node_modules`** — the property that lets a harness load it without `npm install` |
| `SKILL.md is valid` | Frontmatter has a loadable `name` and a non-empty `description`; a skill missing either is never routed to |

**CI never touches a live API.** Live tests live under `tests-ts/live/` and run only
when `JOBSEARCH_LIVE_TESTS=1` is set (the flag keeps its former name; see [`AGENTS.md`](AGENTS.md)).
The search tests also need their own `LIVE_<PROVIDER>_API_KEY` variable, and none of
these is set in CI. `tests-ts/setup.ts` blocks outbound requests in every non-live run.
Live tests are for deliberate manual runs.

The `dist matches src` job matters because `dist/` is committed: the compiled
JavaScript is what users run, so a stale build would ship code nobody reviewed.

### Testing

Each skill owns its tests:

```bash
cd skills/job-board && npm test       # offline; never touches the network
cd skills/job-board && npm run test:live   # real ATS APIs; opt-in
```

Test counts are not written here: they go stale. Run the commands to see them.

### Contributing

Read [SCOPE.md](SCOPE.md) for the bar a change must clear, and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to file issues and pull requests.

### Adding a skill

Create a directory whose name matches the skill's `name` frontmatter field, then
add a `SKILL.md`:

```markdown
---
name: my-skill
description: What it does, and when to use it. This drives model routing, so
  state both the capability and the trigger conditions.
---

# My skill

Instructions the agent follows once the skill is loaded.
```

Keep `description` specific enough to distinguish the skill from its neighbours —
that string is all the model sees before deciding to load it.
