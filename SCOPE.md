# Scope

This repo is a set of Agent Skills: self-contained directories that coding agents
(pi, Claude Code, opencode, and other harnesses that read the Agent Skills format)
load on demand. Each skill must be useful on its own. The repo holds the skills and
changes that meet the bar below.

## Repo-wide constraints

Every skill in this repo must:

1. **Be self-contained.** One directory with a `SKILL.md`, as described in the
   [Agent Skills specification](https://agentskills.io/specification), plus the
   scripts, references and assets it needs.
2. **Run with zero runtime dependencies.** Dev tooling is fine. Anything needed at
   runtime ships inside the skill, so the skill can be copied anywhere.
3. **Work three ways:** copied into a skills directory, symlinked into one, and
   run from its own directory. The root README shows each.
4. **Follow the conventions in the root README:** package name after the directory,
   a description under 200 characters, test file names unique across the repo.

## The bar for a change

An issue or pull request is accepted when it clears both parts:

1. **Observed failure.** It describes something that went wrong in a real session:
   what was run, what the skill did, and what was expected. A hypothetical
   improvement ("it would be better if...") does not clear this part.
2. **Fits the constraints.** It does not repeat an idea in
   [`.out-of-scope/`](.out-of-scope/README.md), it is not a configuration option or a
   branch for one harness, and it is not a tweak to suit one person's workflow. Those
   belong in the user's own `AGENTS.md` or `CLAUDE.md`, or in a fork.

Size does not matter. A one-word fix faces the same bar as a rewrite.

## New skills

New skills are welcome and face the same bar. A proposal must name the observed need
in a real session, say why an existing skill cannot meet it, and meet the constraints
above.

## Already decided

Each file in [`.out-of-scope/`](.out-of-scope/README.md) records one rejected idea and
why. Read the relevant ones before proposing something similar.

Each skill also states its own boundary in its `SKILL.md`, under "what this can and
cannot do".
