import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseClaude, parsePi } from "./adapt.mjs";
import { parseRun, grade } from "../grade.mjs";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}.jsonl`, import.meta.url), "utf8");
const jl = (...evs) => evs.map((e) => JSON.stringify(e)).join("\n");

test("claude: real captured run (Skill, then Bash, then text)", () => {
  const r = parseClaude(fx("claude-ok"));
  assert.deepEqual(r.calls.map((c) => c.tool), ["skill", "bash"]);
  assert.equal(r.calls[0].cmd, '{"skill":"job-board"}');
  assert.match(r.calls[1].cmd, /dist\/main\.js --version$/);
  assert.equal(r.calls[1].out, "job-board 2.0.0");
  assert.equal(r.final, "The job-board CLI reported version 2.0.0.");
  assert.deepEqual(r.errors, []);
  assert.equal(r.tokens, 45);
  assert.ok(r.cost > 0);
});

test("claude: real captured API 402 is an error and not an answer", () => {
  const r = parseClaude(fx("claude-402"));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /402/);
  assert.equal(r.final, "");
});

test("claude: tool_result content as block array, other tools lowercased, unknown id ignored", () => {
  const r = parseClaude(jl(
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebFetch", input: { url: "https://x" } }, { type: "tool_use", id: "t2", name: "Write", input: { file_path: "/a.html", content: "<html>" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "page" }, { type: "text", text: " body" }] }, { type: "tool_result", tool_use_id: "nope", content: "x" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "first" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "last" }] } },
    { type: "result", subtype: "success", is_error: false, result: "last", usage: { input_tokens: 1, output_tokens: 2 }, total_cost_usd: 0.5 },
  ));
  assert.deepEqual(r.calls.map((c) => [c.tool, c.out]), [["webfetch", "page body"], ["write", ""]]);
  assert.equal(r.final, "last");
});

test("claude: is_error result is an error even with subtype success; duplicate tool_use ids collapse; junk lines skipped", () => {
  const r = parseClaude("not json\n" + jl(
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
    { type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "API Error: 429", usage: {} },
  ));
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.errors, ["API Error: 429"]);
});

test("pi: real captured run (read SKILL.md, bash, text)", () => {
  const r = parsePi(fx("pi-ok"));
  assert.deepEqual(r.calls.map((c) => c.tool), ["skill", "bash"]);
  assert.match(r.calls[0].cmd, /SKILL\.md/);
  assert.match(r.calls[0].out, /^---\nname: job-board/);
  assert.equal(r.calls[1].out, "job-board 2.0.0\n");
  assert.equal(r.final, "The job-board CLI reported version 2.0.0.");
  assert.deepEqual(r.errors, []);
  assert.equal(r.tokens, 45);
  assert.ok(r.cost > 0);
});

test("pi: real captured provider error (402) is an error, no final text", () => {
  const r = parsePi(fx("pi-402"));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^402/);
  assert.equal(r.final, "");
});

test("pi: reading another file is not a skill load; non-bash args are JSON; retry that succeeds clears the error", () => {
  const r = parsePi(jl(
    { type: "tool_execution_start", toolCallId: "a", toolName: "read", args: { path: "/x/README.md" } },
    { type: "tool_execution_end", toolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: "hi" }] }, isError: false },
    { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "529 overloaded", usage: { totalTokens: 0, cost: { total: 0 } } } },
    { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 1, errorMessage: "529 overloaded" },
    { type: "auto_retry_end", success: true, attempt: 2 },
    { type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "done" }], stopReason: "stop", usage: { totalTokens: 7, cost: { total: 0.1 } } } },
  ));
  assert.deepEqual(r.calls, [{ tool: "read", cmd: '{"path":"/x/README.md"}', out: "hi" }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.final, "done");
  assert.equal(r.tokens, 7);
});

test("pi: a retry that fails for good is an error", () => {
  const r = parsePi(jl({ type: "auto_retry_end", success: false, attempt: 3, finalError: "429 rate limited" }));
  assert.deepEqual(r.errors, ["429 rate limited"]);
});

test("grade.mjs: parseRun dispatches on rec.harness and grades a claude run", () => {
  const events = jl(
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "job-board" } }, { type: "text", text: "I have the job-board skill: it finds open roles." }] } },
    { type: "result", subtype: "success", is_error: false, result: "x", usage: {} },
  );
  const rec = { id: "S0", harness: "claude", exit: 0, events };
  assert.equal(parseRun(rec).calls[0].tool, "skill");
  const g = grade(rec);
  assert.equal(g.pass, true);
  assert.equal(g.skill, true);
});

test("grade.mjs: an API error in a pi run is invalid, not a failure", () => {
  const g = grade({ id: "S1", harness: "pi", exit: 0, events: fx("pi-402") });
  assert.equal(g.invalid, true);
  assert.match(g.invalidReason, /^402/);
});

test("grade.mjs: a pi run that used the CLI passes S1 end to end", () => {
  const url = "https://job-boards.greenhouse.io/ramp/jobs/1";
  const events = jl(
    { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: { command: "node /p/skills/job-board/dist/main.js --company Ramp --title engineer" } },
    { type: "tool_execution_end", toolCallId: "a", toolName: "bash", result: { content: [{ type: "text", text: `{"url":"${url}"}` }] }, isError: false },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `Ramp: ${url}` }], stopReason: "stop", usage: { totalTokens: 1, cost: { total: 0 } } } },
  );
  const g = grade({ id: "S1", harness: "pi", exit: 0, events });
  assert.equal(g.pass, true, g.why.join("; "));
});

test("opencode records (no harness) still parse the old way", () => {
  const ev = jl({ type: "tool_use", part: { tool: "bash", state: { input: { command: "ls" }, output: "a" } } }, { type: "text", part: { text: "t" } });
  const r = parseRun({ events: ev });
  assert.deepEqual(r.calls, [{ tool: "bash", cmd: "ls", out: "a" }]);
  assert.equal(r.final, "t");
});
