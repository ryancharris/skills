# Contributing

Read [SCOPE.md](SCOPE.md) first. Every issue and pull request is judged against the
bar there. Agents working in this repo should read [AGENTS.md](AGENTS.md).

## Where things go

| You have | Go to |
|---|---|
| A bug in a skill | An issue, using the checklist below |
| A change to an existing skill | An issue that describes the observed failure first |
| A new skill | An issue that describes the observed need first |
| A security problem | Not a public issue. See [Security](#security) |

## Pull requests

- Open an issue and agree on the change before writing code. A pull request with no
  agreed issue may be closed.
- One change per pull request. Split unrelated fixes.
- Every pull request passes CI: typecheck, the offline suite, `dist/` rebuilt from
  `src/`, the standalone run, and `SKILL.md` validity.
- `dist/` is generated. Edit `src/`, run `npm run build` in the skill's directory,
  and commit both.
- Add user-visible changes to the skill's `CHANGELOG.md` under "Unreleased".
- Update the docs the change affects. `SKILL.md` is read by agents, so it must stay
  true to the code.
- Never put a live API call in the offline suite. Live tests stay in `tests-ts/live/`.

## Bug report checklist

- The skill and version (`node dist/main.js --version`).
- The harness (pi, Claude Code, opencode, or other) and the model.
- The exact command run, with `<skill-dir>` standing for the skill's path.
- The relevant part of the output. For JSON, the fields matter.
- What you expected, and why.

Keep it short. One problem per issue. Put the steps that reproduce the problem before
any analysis.

## Issues written with AI

Agents may help, but you post the issue, so you own it:

- **One problem per issue.** Several findings from one session are several issues,
  or none.
- **Short.** If it does not fit on one screen, cut it.
- **Repro first.** The steps that show the problem come before any analysis.
- **No pasted specs.** No full proposals, plans, or rewritten `SKILL.md` files.
  Describe the problem. The maintainers design the fix.

These rules are adapted from [mattpocock/skills](https://github.com/mattpocock/skills),
MIT licensed.

## Security

Do not open a public issue for a leaked credential or a vulnerability. Report it
privately through the repository's **Security** tab, using GitHub's private
vulnerability reporting. Rotate any exposed key first.

## Licence

Contributions are accepted under the MIT licence in [LICENSE](LICENSE).
