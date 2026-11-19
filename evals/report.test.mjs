import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactRecord, secretValues } from "./redact.mjs";

const KEY = "sk-or-v1-abcdef0123456789";
const ev = (...o) => o.map((e) => JSON.stringify(e)).join("\n");
const ok = (text) => ev({ type: "text", part: { text } }, { type: "step_finish", part: { tokens: { total: 5 }, cost: 0.01 } });
const rec = (over) => ({ id: "S1", title: "T <b>", prompt: "p", expect: "e", model: "openrouter/a|b/model", run: 1, exit: 0, seconds: 1, events: ok("hello"), stderr: "", ...over });

function build(records, versions) {
  const dir = mkdtempSync(join(tmpdir(), "rep-"));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ date: "2026-01-01", ref: "HEAD", commit: "abc1234", name: "t|`x`" }));
  writeFileSync(join(dir, "order.json"), JSON.stringify({ seed: 1, order: records.map((r) => [r.model, r.id, r.run]) }));
  writeFileSync(join(dir, "results.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (versions) writeFileSync(join(dir, "versions.json"), JSON.stringify(versions));
  return dir;
}
const node = (script, dir) => spawnSync(process.execPath, [new URL(script, import.meta.url).pathname, dir], { encoding: "utf8" });

test("report: all runs invalid does not print -Infinity and lists the invalid runs", () => {
  // exit null without timedOut is a process killed from outside (for example out of memory): invalid, not a failure
  const dir = build([rec({ exit: 1, events: "" }), rec({ run: 2, exit: null, events: "" })]);
  const r = node("./report.mjs", dir);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(join(dir, "report.html"), "utf8");
  assert.ok(!/Infinity|NaN/.test(html), "no Infinity or NaN");
  assert.match(html, /No valid runs/);
  assert.match(html, /Invalid runs/);
  assert.match(html, /process exited 1/);
  assert.match(html, /a\|b\/model/);
  assert.match(html, /process exited null/);
});

test("report: a run killed by the runner's own time limit is a valid failure, not an invalid run", () => {
  const dir = build([rec({ exit: null, timedOut: true, events: "" }), rec({ run: 2 })]);
  assert.equal(node("./report.mjs", dir).status, 0);
  const html = readFileSync(join(dir, "report.html"), "utf8");
  assert.ok(!/Invalid runs/.test(html), "a timeout is not listed as invalid");
  assert.match(html, /timed out/);
  assert.match(html, /0 of 2 valid runs passed/);
});

test("report: a mix lists invalid runs next to the valid ones and escapes every dynamic value", () => {
  const dir = build([rec({ model: "m<script>alert(1)</script>", exit: 2, events: "" }), rec({ run: 2 })], { opencode: "1.19.6<i>", node: "22" });
  assert.equal(node("./report.mjs", dir).status, 0);
  const html = readFileSync(join(dir, "report.html"), "utf8");
  assert.match(html, /Invalid runs/);
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("1.19.6<i>"));
  assert.match(html, /opencode 1\.19\.6&lt;i&gt;/);
});

test("report and summary: a record that went through redactRecord never puts the key in the output", () => {
  const raw = rec({ events: ok(`OPENROUTER_API_KEY=${KEY}`) + "\n" + ev({ type: "tool_use", part: { tool: "bash", state: { input: { command: "env" }, output: `OPENROUTER_API_KEY=${KEY}` } } }), stderr: `warn ${KEY}` });
  const dir = build([redactRecord(raw, secretValues({ OPENROUTER_API_KEY: KEY }))]);
  assert.equal(node("./report.mjs", dir).status, 0);
  assert.equal(node("./summary.mjs", dir).status, 0);
  for (const f of ["results.jsonl", "report.html", "summary.md", "summary.json"]) {
    const t = readFileSync(join(dir, f), "utf8");
    assert.ok(!t.includes(KEY), `${f} must not contain the key`);
  }
  assert.match(readFileSync(join(dir, "report.html"), "utf8"), /\[REDACTED\]/);
});

test("summary: versions go into summary.json meta and the markdown header, and table cells are escaped", () => {
  const dir = build([rec(), rec({ run: 2, events: ev({ type: "error", error: { data: { message: "bad | `thing`\nsecond line" } } }) })], { opencode: "1.19.6", node: "22.1.0" });
  const r = node("./summary.mjs", dir);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  assert.deepEqual(j.meta.versions, { opencode: "1.19.6", node: "22.1.0" });
  const md = readFileSync(join(dir, "summary.md"), "utf8");
  assert.match(md, /Agent versions: opencode 1\.19\.6, node 22\.1\.0/);
  const row = md.split("\n").find((l) => l.startsWith("| a"));
  assert.ok(row, md);
  assert.ok(row.includes("a\\|b/model"));
  assert.ok(!/[^\\]\|b\/model/.test(md));
  assert.ok(md.includes("First error: bad \\| 'thing' second line"), md);
  assert.match(md, /# Agent eval: t\\\|'x'/);
});

test("summary: without versions.json the header says not recorded", () => {
  const dir = build([rec()]);
  assert.equal(node("./summary.mjs", dir).status, 0);
  assert.match(readFileSync(join(dir, "summary.md"), "utf8"), /Agent versions: not recorded/);
  assert.equal(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).meta.versions, undefined);
});
