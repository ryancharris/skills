# Agent eval: key-wording-before-guardrails-10runs (2026-11-19)

- Skill: `origin/main` at `f864a02`
- Agent versions: opencode 1.19.6, node 22.23.5
- 150 valid runs, 5 models, stories S6, S7, S9, shuffle seed 23
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S6 | S7 | S9 | Total |
|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 0/10 | 0/10 | 10/30 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 1/10 | 6/10 | 17/30 |
| moonshotai/kimi-k3 | 6/10 | 3/10 | 8/10 | 17/30 |
| qwen/qwen3-coder | 10/10 | 10/10 | 8/10 | 28/30 |
| ~deepseek/deepseek-v4-flash-latest | 6/10 | 9/10 | 9/10 | 24/30 |

## Stories

- **S6**: No companies named
- **S7**: Unsupported company (no verdict from memory)
- **S9**: Company that does not exist

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 27/30 | 0 | 0 | 10 | 1162k | $0.59 |
| deepseek/deepseek-v4.1-flash-1017 | 30/30 | 0 | 0 | 9 | 857k | $0.04 |
| moonshotai/kimi-k3 | 29/30 | 0 | 0 | 12 | 789k | $0.55 |
| qwen/qwen3-coder | 30/30 | 0 | 0 | 6 | 802k | $0.09 |
| ~deepseek/deepseek-v4-flash-latest | 30/30 | 0 | 0 | 10 | 872k | $0.02 |

## Failed checks

- S6: named companies of its own (8)
- S7: CLI never run for Amazon (4)
- S7: CLI output does not say no job board found (4)
- S7: answer lacks the quoted cannot-check sentence (1)
- S7: recommends the search key after --check (23)
- S9: CLI never run for Zzqxv (2)
- S9: CLI output does not say no job board found (2)
- S9: answer lacks the quoted cannot-check sentence (2)
- S9: recommends the search key after --check (17)
