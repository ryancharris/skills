import { test } from "node:test";
import assert from "node:assert/strict";
import { fatalStatus } from "./abort.mjs";

const lines = (...evs) => evs.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n");

test("opencode: an error event with statusCode 401, 402 or 403 aborts", () => {
  for (const code of [401, 402, 403]) {
    assert.equal(fatalStatus(lines({ type: "error", error: { name: "APIError", data: { message: "x", statusCode: code } } })), code);
  }
});

test("opencode: other statuses and error events without a status do not abort", () => {
  assert.equal(fatalStatus(lines({ type: "error", error: { data: { statusCode: 429 } } })), null);
  assert.equal(fatalStatus(lines({ type: "error", error: { name: "UnknownError" } })), null);
});

test("opencode: a statusCode in tool output or a non-error event does not abort", () => {
  assert.equal(fatalStatus(lines({ type: "tool_use", part: { state: { output: 'curl: {"statusCode":401}' } } })), null);
  assert.equal(fatalStatus(lines({ type: "tool_use", part: { state: { metadata: { statusCode: 401 } } } })), null);
  assert.equal(fatalStatus(lines({ type: "text", part: { text: '"statusCode":402 appears in prose' } })), null);
  assert.equal(fatalStatus('{"statusCode":401} not an event with type error'), null);
});

test("garbage lines are skipped and a later error event is still found", () => {
  assert.equal(fatalStatus(lines("not json", "{broken", { type: "error", error: { data: { statusCode: 402 } } })), 402);
  assert.equal(fatalStatus(""), null);
  assert.equal(fatalStatus(undefined), null);
});

test("claude: only the result event's api_error_status counts", () => {
  assert.equal(fatalStatus(lines({ type: "result", is_error: true, api_error_status: 402 }), "claude"), 402);
  assert.equal(fatalStatus(lines({ type: "result", api_error_status: 500 }), "claude"), null);
  assert.equal(fatalStatus(lines({ type: "user", message: { content: '"api_error_status":401' } }), "claude"), null);
  assert.equal(fatalStatus(lines({ type: "assistant", api_error_status: 401 }), "claude"), null);
});

test("pi: a failed message_end whose errorMessage starts with the status counts", () => {
  const mk = (stopReason, errorMessage) => ({ type: "message_end", message: { stopReason, errorMessage } });
  assert.equal(fatalStatus(lines(mk("error", '402: {"code":402}')), "pi"), 402);
  assert.equal(fatalStatus(lines(mk("error", "500: upstream said 401 somewhere")), "pi"), null);
  assert.equal(fatalStatus(lines(mk("stop", "402: not an error stop")), "pi"), null);
  assert.equal(fatalStatus(lines({ type: "tool_execution_end", result: { content: [{ text: '"errorMessage":"401: x"' }] } }), "pi"), null);
});

test("the real route captures: 402 fixtures abort, ok fixtures do not", async () => {
  const { readFileSync } = await import("node:fs");
  const f = (n) => readFileSync(new URL(`./routes/fixtures/${n}`, import.meta.url), "utf8");
  assert.equal(fatalStatus(f("claude-402.jsonl"), "claude"), 402);
  assert.equal(fatalStatus(f("pi-402.jsonl"), "pi"), 402);
  assert.equal(fatalStatus(f("claude-ok.jsonl"), "claude"), null);
  assert.equal(fatalStatus(f("pi-ok.jsonl"), "pi"), null);
});
