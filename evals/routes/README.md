# Install routes: Claude Code plugin and pi package

`evals/run.sh` tests the skill through opencode with the skill copied into `~/.agents/skills/`.
Users can also get the skill through two other routes. This directory tests those, in two stages.

## 1. Does the install route work? (no model, no API key, no cost)

```bash
evals/routes/install-check.sh claude --ref origin/main    # or HEAD, or any ref
evals/routes/install-check.sh pi --ref HEAD
```

It builds an image from `git archive REF` (committed files only), installs the agent CLI at a pinned
version (`CLAUDE_CODE_VERSION`, `PI_VERSION` build args in the Dockerfiles), installs the skill as a
non-root user, then runs `verify.mjs` in a fresh container. It exits non-zero and prints `FAIL:` lines if
any check fails.

| Route | Install command used | Proof, all without a model |
|---|---|---|
| Claude Code | `claude plugin marketplace add <local copy>` then `claude plugin install job-board@ryancharris-skills` | `claude plugin list --json` shows it enabled with no error fields; `claude plugin validate` passes; `claude plugin details` lists `Skills (1) job-board`; `SKILL.md` and `dist/main.js` exist at the install path; the CLI runs from there |
| pi | `pi install <local copy>` | `pi list` shows the package; `pi --mode rpc` starts and its `get_commands` lists `skill:job-board` from the package (a broken extension stops pi from starting, so a start proves the extension module loads); `package.json` `pi.skills` / `pi.extensions` files exist; the CLI runs from there |

The installs use a local copy of the ref, not `ryancharris/skills` on GitHub, because an unmerged ref is
not on GitHub. The install commands are otherwise the ones in `skills/job-board/README.md`. Testing the
GitHub-hosted copy itself (`claude plugin marketplace add ryancharris/skills`, `pi install
git:github.com/ryancharris/skills`) is not covered here.

Where each agent keeps the skill:

- Claude Code copies the whole repo into `~/.claude/plugins/cache/ryancharris-skills/job-board/<version>/`.
  The `Skill` tool's "Base directory" for a marketplace-folder install is the marketplace folder
  (`~/src/skills/skills/job-board`), not the cache copy. Both are intact; the CLI works from either.
- pi loads a local-path package in place, so the skill is at the package path.

`--tar FILE` replaces `--ref` with a ready-made `git archive` tarball. It is how the failure paths were
tested (invalid `plugin.json`, missing skill directory, missing `SKILL.md`, throwing extension, missing `dist/`).

## 2. Does the agent use the skill correctly? (model calls, costs money, manual only)

`run-claude.mjs` and `run-pi.mjs` run inside the images and write the same `results.jsonl` records as
`evals/run.mjs`, with an extra `harness` field. `grade.mjs` picks the adapter in `adapt.mjs` from that field,
so `report.mjs` and `summary.mjs` work on these records unchanged. Neither runner has been run against a
real model. They have been run end to end, and graded, against `mock-model.mjs`, a local script that
answers like a model API without being one.

- Claude Code: `claude -p PROMPT --output-format stream-json --verbose --dangerously-skip-permissions
  --no-session-persistence --model M`, using OpenRouter through `ANTHROPIC_BASE_URL=https://openrouter.ai/api`,
  `ANTHROPIC_AUTH_TOKEN=$OPENROUTER_API_KEY` and an empty `ANTHROPIC_API_KEY`.
- pi: `pi --mode json --no-session --provider openrouter --model M PROMPT`, key from `OPENROUTER_API_KEY`.

Tool names are lowercased so the existing grader checks (`bash`, `webfetch`, `websearch`, `skill`, `write`) work.
pi has no skill tool: the adapter reports a `read` of a `SKILL.md` as a `skill` call.

## Tests

```bash
node --test evals/routes/*.test.mjs
```

(Node 24 does not accept the bare directory form `node --test evals/routes/`; the glob works on 20, 22 and 24.)
The tests use `fixtures/`, real event streams captured from Claude Code 2.1.328 and pi 1.5.2 running against
`mock-model.mjs` (long strings truncated), plus hand-built events for cases the captures do not cover.

## Event shapes the adapters rely on

Verified from the installed code and from real captures (V), or from docs only (D), or not verified (U).

Claude Code stream-json (one object per line):

- V: `assistant` with `message.content[]` blocks `text` / `tool_use {id,name,input}`; `Bash` input has `command`;
  `Skill` input is `{skill}`; tool names include `Bash Read Skill WebFetch WebSearch Write` (typings in
  `@anthropic-ai/claude-agent-sdk` 0.3.328, which pins Claude Code 2.1.328, and a capture).
- V: `user` with `message.content[]` `tool_result {tool_use_id, content: string | blocks[], is_error?}`.
- V: final `result {subtype, is_error, result, usage.input_tokens/output_tokens, total_cost_usd, api_error_status}`.
- V (capture): an API failure arrives as a synthetic `assistant` message with `is_api_error_message: true` and
  text `API Error: 402 ...`, then `result` with `is_error: true` while `subtype` is still `"success"`; exit code 1.
- U: the exact text OpenRouter returns for a real 401/402/403 (the capture used a mock with a 402 body).

pi `--mode json` (one object per line):

- V: `tool_execution_start {toolCallId, toolName, args}`, `tool_execution_end {toolCallId, result.content[], isError}`;
  `message_end {message}` with assistant `content[]` blocks `text` / `thinking` / `toolCall`, `stopReason`
  (`pending stop length toolUse error aborted deferred`), `errorMessage`, `usage.totalTokens`, `usage.cost.total`
  (docs `json.md`, `message-types.md`, typings in `pi-ai` and `pi-agent-core`, and a capture).
- V (capture): a provider failure is `stopReason: "error"` with `errorMessage: "402: {...}"`; pi still exits 0.
- D: `auto_retry_start`, `auto_retry_end {success, finalError}` (docs only; the order relative to the failed `message_end` is not verified).
- U: the exact `errorMessage` text for a real OpenRouter failure.
