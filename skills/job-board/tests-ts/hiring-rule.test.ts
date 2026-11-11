/**
 * The pi extension that carries the hiring rule. Offline: exercised with a fake pi object.
 * Whether the model then holds to the rule is measured separately, not here.
 */
import { describe, expect, it } from "vitest";

import hiringRule, { HIRING_RULE, ranJobBoard, type PiLike } from "../pi/hiring-rule.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** A fake pi: records handlers so a test can fire events in order. */
function fakePi() {
  const handlers = new Map<string, (e: any) => unknown>();
  const api: PiLike = { on: (name, handler) => void handlers.set(name, handler) };
  return { api, fire: (name: string, e: any) => handlers.get(name)?.(e) };
}

const SKILL_CMD = 'node "/Users/x/.agents/skills/job-board/dist/main.js" --company Amazon --format md';

describe("ranJobBoard", () => {
  it("recognises the skill's role search and company check", () => {
    expect(ranJobBoard(SKILL_CMD)).toBe(true);
    expect(ranJobBoard('node "/x/dist/main.js" --check Stripe --format json')).toBe(true);
  });

  it("ignores other commands, including ones that name the file without the skill's flags", () => {
    expect(ranJobBoard("ls dist/main.js")).toBe(false);
    expect(ranJobBoard("node other.js --company Amazon")).toBe(false);
    expect(ranJobBoard("grep -n company README.md")).toBe(false);
    expect(ranJobBoard("")).toBe(false);
  });
});

describe("pi extension", () => {
  const msgs = [{ role: "user", content: "Is Amazon still hiring?" }];

  it("adds nothing before the skill has run in the session", () => {
    const pi = fakePi();
    hiringRule(pi.api);
    expect(pi.fire("context", { messages: msgs })).toBeUndefined();
  });

  it("adds the rule as a system message at the end once the skill's bash call returns", () => {
    const pi = fakePi();
    hiringRule(pi.api);
    pi.fire("tool_result", { toolName: "bash", input: { command: SKILL_CMD } });
    const out = pi.fire("context", { messages: msgs }) as { messages: any[] };
    expect(out.messages.slice(0, 1)).toEqual(msgs);
    const last = out.messages.at(-1);
    expect(last.role).toBe("system");
    expect(last.content).toBe(HIRING_RULE);
  });

  it("does not count a bash call that is not the skill", () => {
    const pi = fakePi();
    hiringRule(pi.api);
    pi.fire("tool_result", { toolName: "bash", input: { command: "ls -la" } });
    expect(pi.fire("context", { messages: msgs })).toBeUndefined();
  });

  it("does not count a non-bash tool result that mentions the skill", () => {
    const pi = fakePi();
    hiringRule(pi.api);
    pi.fire("tool_result", { toolName: "read", input: { command: SKILL_CMD } });
    expect(pi.fire("context", { messages: msgs })).toBeUndefined();
  });

  it("forgets the skill run when a new session starts", () => {
    const pi = fakePi();
    hiringRule(pi.api);
    pi.fire("tool_result", { toolName: "bash", input: { command: SKILL_CMD } });
    pi.fire("session_start", {});
    expect(pi.fire("context", { messages: msgs })).toBeUndefined();
  });
});

describe("pi package manifest", () => {
  it("lists the extension file, and the file exists", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8"));
    const entries: string[] = manifest.pi?.extensions ?? [];
    expect(entries).toContain("./skills/job-board/pi/hiring-rule.ts");
    for (const entry of entries) {
      expect(readFileSync(resolve(__dirname, "../../..", entry), "utf8").length).toBeGreaterThan(0);
    }
  });
});
