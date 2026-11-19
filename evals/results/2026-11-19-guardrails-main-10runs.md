# Agent eval: guardrails-main-10runs (2026-11-19)

- Skill: `origin/main` at `fd27223`
- Agent versions: opencode 1.19.6, node 22.23.5
- 180 valid runs, 6 models, stories S6, S7, S9, shuffle seed 13
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S6 | S7 | S9 | Total |
|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 0/10 | 0/10 | 10/30 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 1/10 | 5/10 | 16/30 |
| moonshotai/kimi-k3 | 7/10 | 6/10 | 8/10 | 21/30 |
| qwen/qwen3-coder | 8/10 | 10/10 | 10/10 | 28/30 |
| qwen/qwen3-coder-flash | 2/10 | 0/10 | 1/10 | 3/30 |
| ~deepseek/deepseek-v4-flash-latest | 9/10 | 6/10 | 8/10 | 23/30 |

## Stories

- **S6**: No companies named
- **S7**: Unsupported company (no verdict from memory)
- **S9**: Company that does not exist

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 30/30 | 0 | 0 | 13 | 1206k | $0.69 |
| deepseek/deepseek-v4.1-flash-1017 | 30/30 | 0 | 0 | 9 | 833k | $0.05 |
| moonshotai/kimi-k3 | 28/30 | 0 | 0 | 17 | 788k | $0.48 |
| qwen/qwen3-coder | 29/30 | 0 | 0 | 7 | 819k | $0.12 |
| qwen/qwen3-coder-flash | 4/30 | 0 | 26 | 4 | 300k | $0.02 |
| ~deepseek/deepseek-v4-flash-latest | 30/30 | 0 | 0 | 12 | 848k | $0.03 |

## Failed checks

- S6: did not ask which companies (no question and no request) (1)
- S6: malformed tool call, never ran (8)
- S6: named companies of its own (5)
- S6: ran the CLI with no companies (1)
- S7: CLI never run for Amazon (3)
- S7: CLI output does not say no job board found (3)
- S7: S7 possible hiring claim from memory (2)
- S7: malformed tool call, never ran (10)
- S7: recommends the search key after --check (26)
- S9: CLI never run for Zzqxv (2)
- S9: CLI output does not say no job board found (2)
- S9: answer lacks the quoted cannot-check sentence (2)
- S9: malformed tool call, never ran (8)
- S9: recommends the search key after --check (18)
