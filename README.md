# Agent skills

A collection of Agent Skills — self-contained directories that give coding
agents (pi, Claude Code, and other harnesses) specialized instructions and
supporting files for a particular kind of work.

Each skill follows the [Agent Skills specification](https://agentskills.io/specification):
a directory containing a `SKILL.md` with YAML frontmatter (`name`, `description`),
plus any scripts, references, and assets it needs.

## Skills

| Skill | Description |
|---|---|
| [`job-board`](job-board/) | Find live job postings by querying company ATS boards (Greenhouse, Lever, Ashby, SmartRecruiters) directly, and check whether a company is still hiring after a layoff. |

## Layout

```
skills/
├── .gitignore             # repo-wide; ignores every skill's toolchain dirs
├── LICENSE                # MIT, covers the whole repo
├── README.md              # this file
├── .github/               # CI: tests, dist matches src, portability, SKILL.md validity
├── job-board/              # one skill per directory; self-contained
│   ├── SKILL.md           # required: frontmatter + instructions
│   ├── dist/              # compiled JS -- what actually runs
│   ├── src/               # TypeScript source
│   ├── tests-ts/          # unit, mocked, live, parity
│   ├── references/        # detailed docs loaded on demand
│   ├── package.json       # dev-only deps; zero runtime deps
│   ├── tsconfig.json
│   └── README.md
└── <next-skill>/
    └── SKILL.md
```

Skills are discovered recursively, so nesting is fine.

## Conventions for new skills

Four rules keep skills independent. They exist because the alternative was
measured to break: a shared package name lets one skill shadow another's
imports, and same-named test files collide in a runner's flat namespace.

1. **Name the package after the directory.** `job-board/` ships
   `job-board/src/`; skill `pdf-tools` ships `pdf-tools/src/`. Never import a
   sibling skill's package — copy the helper instead.
2. **Keep `description` under 200 characters.** It is paid on every model turn
   that considers loading the skill, so it must be tight: what it does, plus
   the trigger. Do not put caveats there; put them in the body.
3. **Make test file names unique across the repo** (`cli.test.ts`, not
   `test.ts`). Test runners collect everything into one namespace when run from
   the root.
4. **Ship zero runtime dependencies.** Dev tooling (typescript, vitest, pytest)
   is fine and stays in the repo's ignore list. But a skill that needs a
   third-party package at *runtime* stops being copyable on its own. `job-board`
   compiles to dependency-free JavaScript for exactly this reason.

A skill must work three ways, and `job-board` is tested all three:

```bash
node /path/to/skill-name/dist/main.js                 # copied anywhere, no npm install
ln -s "$PWD/skill-name" ~/.agents/skills/skill-name  # symlinked into a harness
cd skill-name && npm test                            # tests in isolation
```

## Runtimes

Skills are independent, so each may choose its own runtime:

| Skill | Runtime | Test |
|---|---|---|
| `job-board` | Node.js 20+ (TypeScript source, compiled) | `npm test` |
| (future) | Python 3.10+ | `pytest` |

There is no shared language requirement — only the rules above. Dev
dependencies are installed per skill inside its own directory, so one skill's
toolchain cannot affect another's.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request. Four jobs:

| Job | What it proves |
|---|---|
| `test (node 20)`, `test (node 22)`, `test (node 24)` | Typecheck + the offline suite passes on the declared minimum and newer runtimes |
| `dist matches src` | Committed `dist/` was rebuilt after the last `src/` change, so shipped code matches source |
| `runs standalone (no node_modules)` | The skill executes with **no `node_modules`** — the property that lets a harness load it without `npm install` |
| `SKILL.md is valid` | Frontmatter has a loadable `name` and a non-empty `description`; a skill missing either is never routed to |

**CI never touches a live API.** Live-API tests live under
`tests-ts/live/`, require `JOBSEARCH_LIVE_TESTS=1`, and need `JOB_BOARD_SEARCH_API_KEY`;
none of that is set in CI, and `tests-ts/setup.ts` blocks outbound requests in
every non-live run. Those tests are for deliberate manual runs.

The `dist matches src` job matters because `dist/` is committed: the compiled
JavaScript is what users run, so a stale build would ship code nobody reviewed.

## Testing

Each skill owns its tests:

```bash
cd job-board && npm test            # offline; never touches the network
cd job-board && npm run test:live   # real ATS APIs; opt-in
```

Test counts are not written here: they go stale. Run the commands to see them.

## Contributing

Read [SCOPE.md](SCOPE.md) for the bar a change must clear, and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to file issues and pull requests.

## Adding a skill

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
