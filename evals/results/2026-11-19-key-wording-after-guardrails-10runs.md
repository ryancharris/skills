# Agent eval: key-wording-after-guardrails-10runs (2026-11-19)

- Skill: `docs/search-key-optional` at `4945889`
- Agent versions: opencode 1.19.6, node 22.23.5
- 150 valid runs, 5 models, stories S6, S7, S9, shuffle seed 23
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S6 | S7 | S9 | Total |
|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 10/10 | 10/10 | 30/30 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 9/10 | 10/10 | 29/30 |
| moonshotai/kimi-k3 | 6/10 | 10/10 | 10/10 | 26/30 |
| qwen/qwen3-coder | 10/10 | 10/10 | 10/10 | 30/30 |
| ~deepseek/deepseek-v4-flash-latest | 7/10 | 8/10 | 10/10 | 25/30 |

## Stories

- **S6**: No companies named
- **S7**: Unsupported company (no verdict from memory)
- **S9**: Company that does not exist

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 24/30 | 0 | 0 | 8 | 1125k | $0.48 |
| deepseek/deepseek-v4.1-flash-1017 | 30/30 | 0 | 0 | 7 | 881k | $0.04 |
| moonshotai/kimi-k3 | 27/30 | 0 | 0 | 12 | 799k | $0.45 |
| qwen/qwen3-coder | 30/30 | 0 | 0 | 6 | 845k | $0.10 |
| ~deepseek/deepseek-v4-flash-latest | 30/30 | 0 | 0 | 9 | 888k | $0.03 |

## Failed checks

- S6: named companies of its own (7)
- S7: S7 possible hiring claim from memory (3)
