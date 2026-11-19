# Agent eval: pi-four-models-all-stories-2runs (2026-11-19)

- Skill: `HEAD` at `767de19`
- Agent versions: pi 1.5.2, node 22.23.5, harness pi
- 96 valid runs, 4 models, stories S0, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, shuffle seed 32
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S0 | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 24/24 |
| deepseek/deepseek-v4.1-flash-1017 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 24/24 |
| moonshotai/kimi-k3 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 24/24 |
| qwen/qwen3-coder | 2/2 | 2/2 | 2/2 | 2/2 | 1/2 | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 1/2 | 20/24 |

## Stories

- **S0**: Skill is discovered
- **S1**: Roles at one named company
- **S2**: Several companies, remote only
- **S3**: Hiring check after a layoff
- **S4**: Which ATS boards a company has
- **S5**: Search queries, no API key
- **S6**: No companies named
- **S7**: Unsupported company (no verdict from memory)
- **S8**: Filters and format
- **S9**: Company that does not exist
- **S10**: HTML output
- **S11**: Roles at a readable and an unreadable company

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 20/24 | 0 | 0 | 8 | 510k | $0.93 |
| deepseek/deepseek-v4.1-flash-1017 | 24/24 | 0 | 0 | 14 | 604k | $0.05 |
| moonshotai/kimi-k3 | 23/24 | 0 | 0 | 29 | 385k | $0.61 |
| qwen/qwen3-coder | 19/24 | 1 | 1 | 12 | 428k | $0.10 |

## Failed checks

- S11: CLI output is empty or an error (1)
- S11: S11 possible hiring claim from memory (1)
- S11: URL not in tool output (1)
- S11: no role search (--company) for both Ramp and Amazon (1)
- S11: used web tools (1)
- S4: no --list-boards Notion (1)
- S5: did not use --queries (1)
- S5: malformed tool call, never ran (1)
- S5: no site (2)
