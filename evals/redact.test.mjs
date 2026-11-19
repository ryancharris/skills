import { test } from "node:test";
import assert from "node:assert/strict";
import { secretValues, redact, redactRecord, extraNamesFromEnv, MARK } from "./redact.mjs";

const KEY = "sk-or-v1-abcdef0123456789";

test("values of secret-looking variables are found, short ones and other names are not", () => {
  const v = secretValues({ OPENROUTER_API_KEY: KEY, GH_TOKEN: "ghp_12345678", DB_PASSWORD: "hunter2hunter2", MY_SECRET: "short", HOME: "/home/tester", PATH: "/usr/bin" });
  assert.ok(v.includes(KEY) && v.includes("ghp_12345678") && v.includes("hunter2hunter2"));
  assert.ok(!v.includes("short") && !v.includes("/home/tester"));
});

test("name matching is case-insensitive", () => {
  assert.ok(secretValues({ api_key: KEY }).includes(KEY));
});

test("variables named in the extra list are redacted whatever they are called", () => {
  assert.ok(!secretValues({ ORG_ID: "org-123456789" }).includes("org-123456789"));
  assert.ok(secretValues({ ORG_ID: "org-123456789" }, ["ORG_ID"]).includes("org-123456789"));
  assert.deepEqual(extraNamesFromEnv({ REDACT_ENV: " A, B ,," }), ["A", "B"]);
  assert.deepEqual(extraNamesFromEnv({}), []);
});

test("redact replaces every occurrence, including inside JSON and repeated", () => {
  const text = `{"output":"OPENROUTER_API_KEY=${KEY}\\nagain ${KEY}"}`;
  const out = redact(text, secretValues({ OPENROUTER_API_KEY: KEY }));
  assert.ok(!out.includes(KEY));
  assert.equal(out.split(MARK).length - 1, 2);
});

test("a value with quotes or backslashes is also caught in its JSON-escaped form", () => {
  const key = 'ab"cd\\efgh12';
  const events = JSON.stringify({ output: `K=${key}` });
  assert.ok(!events.includes(key));
  const out = redact(events, secretValues({ X_KEY: key }));
  assert.ok(!out.includes("ab\\\"cd"));
  assert.ok(out.includes(MARK));
});

test("docker --env-file keeps quotes: the unquoted value is redacted as well", () => {
  const out = redact(`OPENROUTER_API_KEY=${KEY}`, secretValues({ OPENROUTER_API_KEY: `"${KEY}"` }));
  assert.ok(!out.includes(KEY));
});

test("longer values win over shorter ones that are a prefix of them", () => {
  const out = redact("sk-or-v1-abcdef0123456789-extra", secretValues({ A_KEY: "sk-or-v1-abcdef0123456789", B_KEY: "sk-or-v1-abcdef0123456789-extra" }));
  assert.equal(out, MARK);
});

test("nothing to redact leaves text alone, and non-strings are handled", () => {
  assert.equal(redact("plain", []), "plain");
  assert.equal(redact(undefined, [KEY]), "");
});

test("redactRecord scrubs events and stderr, and truncates stderr only after redacting", () => {
  const values = secretValues({ OPENROUTER_API_KEY: KEY });
  const stderr = "x".repeat(1990) + KEY;
  const rec = redactRecord({ id: "S1", exit: 0, events: `line ${KEY}`, stderr }, values);
  assert.ok(!rec.events.includes(KEY) && !rec.stderr.includes(KEY));
  assert.ok(!JSON.stringify(rec).includes(KEY.slice(0, 12)));
  assert.equal(rec.id, "S1");
  assert.ok(rec.stderr.length <= 2000);
});
