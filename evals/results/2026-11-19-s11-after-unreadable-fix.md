# Agent eval: s11-after-unreadable-fix (2026-11-19)

- Skill: `origin/main` at `f864a02`
- Agent versions: opencode 1.19.6, node 22.23.5
- 50 valid runs, 5 models, stories S11, shuffle seed 22
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S11 | Total |
|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 10/10 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 10/10 |
| moonshotai/kimi-k3 | 9/10 | 9/10 |
| qwen/qwen3-coder | 9/10 | 9/10 |
| ~deepseek/deepseek-v4-flash-latest | 9/10 | 9/10 |

## Stories

- **S11**: Roles at a readable and an unreadable company

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 0 | 0 | 20 | 550k | $0.47 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 0 | 0 | 17 | 454k | $0.03 |
| moonshotai/kimi-k3 | 10/10 | 0 | 0 | 22 | 430k | $0.38 |
| qwen/qwen3-coder | 10/10 | 0 | 0 | 8 | 490k | $0.06 |
| ~deepseek/deepseek-v4-flash-latest | 10/10 | 0 | 0 | 16 | 451k | $0.02 |

## Failed checks

- S11: S11 possible hiring claim from memory (1)
- S11: URL not in tool output (1)
- S11: answer does not say Amazon could not be read (1)
- S11: answer has no URLs and neither the CLI's Ramp count nor a returned role (1)
