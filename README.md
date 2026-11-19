# skills

[![CI](https://github.com/ryancharris/skills/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ryancharris/skills/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A collection of [Agent Skills](https://agentskills.io): self-contained folders of instructions and code that a coding agent loads when a request matches. Maintained by Ryan Harris. Each skill here is tested offline, runs without an `npm install`, and can be copied on its own.

## Skills

| Skill | What it does | Needs | Docs |
|---|---|---|---|
| `job-board` | Lists the open roles on the public job boards of companies you name (Greenhouse, Lever, Ashby, SmartRecruiters and BambooHR), and checks whether a company is still hiring. It cannot find which companies are hiring: you supply the names. | Node.js 20+ | [skills/job-board/README.md](skills/job-board/README.md) |

## Install a skill

Pick the route for your agent and replace `<skill>` with a name from the table. Each skill's README has its requirements and anything specific to it.

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude plugin marketplace add ryancharris/skills
claude plugin install <skill>@ryancharris-skills
```

Installs for your user. Works without a GitHub account or SSH key.

</details>

<details>
<summary><strong>pi</strong></summary>

```bash
pi install git:github.com/ryancharris/skills
```

Installs every skill declared in this repo, and any pi extension a skill ships. Works without a
GitHub account or SSH key. Remove with `pi remove git:github.com/ryancharris/skills`.

</details>

<details>
<summary><strong>Any other agent, or editable files</strong> (manual updates)</summary>

```bash
git clone https://github.com/ryancharris/skills
cd skills
mkdir -p ~/.agents/skills
ln -s "$PWD/skills/<skill>" ~/.agents/skills/<skill>   # or: cp -r skills/<skill> ~/.agents/skills/
```

pi and opencode read `~/.agents/skills/`. The symlink keeps the repo as the source of truth:
run `git pull` to update. A symlinked skill does not load a pi extension; install the pi
package for that.

</details>

Nothing needs to be built or installed with npm to use a skill: each one commits its compiled
code and has no runtime dependencies.

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

Each skill owns its tests and runs them from its own directory. For `job-board`:

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
