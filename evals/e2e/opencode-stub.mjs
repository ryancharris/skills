#!/usr/bin/env node
// Model-free stand-in for `opencode`, used by evals/e2e/run-e2e.sh. Behaviour is chosen by a word in the prompt:
//   LEAK   print every env var whose name looks secret into a tool_use output (what `env` would do)
//   SLEEP  hang (with a grandchild holding stdout) until killed
//   TOOL401  a non-error event that carries "statusCode":401 unescaped (a tool metadata object), plus tool output text containing it
//   ERR401   a real error event with statusCode 401
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("stub-1.0.0"); process.exit(0); }
if (argv[0] === "models") process.exit(0);
const prompt = argv.join(" ");
const out = (o) => console.log(JSON.stringify(o));
if (prompt.includes("SLEEP")) {
  spawn("sleep", ["60"], { stdio: ["ignore", "inherit", "inherit"] });
  setTimeout(() => {}, 60000);
} else {
  let output = "ok";
  if (prompt.includes("LEAK")) output = Object.entries(process.env).filter(([k]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k)).map(([k, v]) => `${k}=${v}`).join("\n");
  if (prompt.includes("TOOL401")) output = 'curl said {"statusCode":401,"message":"nope"}';
  out({ type: "tool_use", part: { tool: "bash", state: { input: { command: "env" }, output, ...(prompt.includes("TOOL401") ? { metadata: { statusCode: 401 } } : {}) } } });
  if (prompt.includes("ERR401")) out({ type: "error", error: { name: "APIError", data: { message: "bad key", statusCode: 401 } } });
  out({ type: "text", part: { text: "done" } });
  out({ type: "step_finish", part: { tokens: { total: 1 }, cost: 0 } });
}
