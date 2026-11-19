# Agent eval: claude-sonnet-all-stories-3runs (2026-11-19)

- Skill: `HEAD` at `79a2c00`
- Agent versions: claude 2.1.328 (Claude Code), node 22.23.5, harness claude
- 36 valid runs, 1 models, stories S0, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, shuffle seed 31
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S0 | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 36/36 |

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
| anthropic/claude-sonnet-5.5 | 30/36 | 0 | 0 | 11 | 24k | $1.14 |

## Failed checks

None.
