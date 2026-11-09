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
| [`job-search`](job-search/) | Find live job postings by querying company ATS boards (Greenhouse, Lever, Ashby, SmartRecruiters) directly, and check whether a company is still hiring after a layoff. |

## Layout

```
skills/
├── .venv/                 # shared DEV environment only (gitignored)
├── pytest.ini             # registers markers for every skill's tests
├── .gitignore             # repo-wide
├── job-search/            # one skill per directory; self-contained
│   ├── SKILL.md           # required: frontmatter + instructions
│   ├── jobsearch.py       # entrypoint
│   ├── jobsearch/         # importable package
│   ├── references/        # detailed docs loaded on demand
│   ├── tests/
│   ├── pytest.ini         # for running this skill's tests in isolation
│   └── README.md
└── <next-skill>/
    └── SKILL.md
```

Skills are discovered recursively, so nesting is fine.

## Conventions for new skills

Four rules keep skills independent. They exist because the alternative was
measured to break: a shared package name lets one skill shadow another's
imports, and same-named test files collide in pytest's flat namespace.

1. **Name the package after the directory.** `job-search/` ships
   `job-search/jobsearch/`; skill `pdf-tools` ships `pdf-tools/pdftools/`.
   Never import a sibling skill's package — copy the helper instead.
2. **Keep `description` under 200 characters.** It is paid on every model turn
   that considers loading the skill, so it must be tight: what it does, plus
   the trigger. Do not put caveats there; put them in the body.
3. **Make test file names unique across the repo** (`test_jobsearch_cli.py`, not
   `test_cli.py`). `pytest` from the root collects everything into one namespace.
4. **Run stdlib-only at runtime.** The shared `.venv` is for *development* tools
   (pytest, pyflakes) only. A skill that needs a third-party package at runtime
   stops being copyable on its own — declare it in that skill's README instead.

A skill must work three ways, and `job-search` is tested all three:

```bash
python3 skill-name/entry.py                          # copied anywhere, no venv
ln -s "$PWD/skill-name" ~/.agents/skills/skill-name  # symlinked into a harness
cd skill-name && ../.venv/bin/python -m pytest       # tests in isolation
```

## Testing

From the repo root:

```bash
.venv/bin/python -m pytest            # every skill's tests
.venv/bin/python -m pyflakes .        # lint everything
```

To run one skill on its own, `cd` into it and use its local `pytest.ini`.

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
