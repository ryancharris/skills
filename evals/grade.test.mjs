// Run with: node --test evals/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { grade, parseRun, hiringClaim } from "./grade.mjs";

const MAIN = 'node "/h/.agents/skills/job-board/dist/main.js"';
const tool = (name, input, output = "") => ({ type: "tool_use", part: { tool: name, state: { input, output } } });
const bash = (command, output = "") => tool("bash", { command }, output);
const cli = (args, output = "") => bash(`${MAIN} ${args}`, output);
const text = (t) => ({ type: "text", part: { text: t } });
const finish = () => ({ type: "step_finish", part: { tokens: { total: 10 }, cost: 0.01 } });
const run = (id, events, exit = 0) => ({ id, model: "m", run: 1, exit, stderr: "", events: events.map((e) => JSON.stringify(e)).join("\n") });

const ROLES = "Staff Engineer | https://boards.example/ramp/1\nSenior Engineer | https://boards.example/ramp/2\n";
const noBoard = (c) => `## ${c}\n${c}: no job board found on the supported platforms. Answer about hiring, quoted exactly: "I could not check ${c} with this skill, so I cannot say whether it is hiring."`;
const quote = (c) => `I could not check ${c} with this skill, so I cannot say whether it is hiring.`;

const pass = (rec) => { const g = grade(rec); assert.deepEqual(g.why, []); assert.equal(g.pass, true); return g; };
const fail = (rec, re) => { const g = grade(rec); assert.equal(g.pass, false, "expected a fail"); if (re) assert.match(g.why.join("; "), re); return g; };

test("S0 names the skill", () => {
  pass(run("S0", [text("Yes: the job-board skill finds open roles on ATS boards."), finish()]));
  fail(run("S0", [text("I can search LinkedIn for you.")]), /did not name job-board/);
});

test("S1 roles at one company", () => {
  pass(run("S1", [cli("--company ramp --format md", ROLES), text("1. https://boards.example/ramp/1")]));
  fail(run("S1", [cli("--company ramp", ROLES), text("See https://invented.example/job/9")]), /URL not in tool output/);
  fail(run("S1", [tool("webfetch", { url: "https://ramp.com" }, "x"), text("done")]), /no CLI search|used web/);
});

test("S2 several companies, remote", () => {
  pass(run("S2", [cli("--company ramp --company figma --remote", ROLES), text("Ramp: https://boards.example/ramp/1")]));
  fail(run("S2", [cli("--company ramp --company figma", ROLES), text("Ramp ok")]), /missing Ramp\/Figma\/--remote/);
});

test("S3 hiring check reports the count", () => {
  const out = '{"open_roles": 42}';
  pass(run("S3", [cli("--check Notion", out), text("Notion has 42 open roles.")]));
  fail(run("S3", [cli("--check Notion", out), text("Notion has some roles.")]), /count not in answer/);
});

test("S4 list boards", () => {
  pass(run("S4", [cli("--list-boards Notion", "ashby notion"), text("Notion posts on Ashby (slug notion).")]));
  fail(run("S4", [cli("--list-boards Notion", "ashby notion"), text("Greenhouse.")]), /did not say Ashby/);
});

test("S5 search queries", () => {
  pass(run("S5", [cli("--queries --company Stripe", "q"), text('site:boards.greenhouse.io "Stripe" "chief of staff"')]));
  fail(run("S5", [cli("--company Stripe", "q"), text("try searching")]), /did not use --queries/);
});

test("S6 asks which companies", () => {
  pass(run("S6", [text("Which companies should I look at?")]));
  fail(run("S6", [cli("--company acme", ROLES), text("Here you go")]), /ran the CLI/);
  fail(run("S6", [text("Here is a list of companies.")]), /did not ask/);
});

test("S7 unsupported company, passing", () => {
  pass(run("S7", [cli("--check Amazon --format md", noBoard("Amazon")), text(`${quote("Amazon")}\n\nPaste its careers URL and I can work from that.`)]));
});

test("S7 failures", () => {
  const ran = cli("--check Amazon", noBoard("Amazon"));
  fail(run("S7", [ran, text("Yes, Amazon is still hiring.")]), /quoted cannot-check|hiring claim/);
  fail(run("S7", [ran, text("Amazon is not on a supported board, so I can't help.")]), /lacks the quoted/);
  fail(run("S7", [cli("--check Amazon", noBoard("Amazon")), tool("websearch", { q: "amazon jobs" }, "x"), text(quote("Amazon"))]), /used web tools/);
});

test("S7 claim hidden in the body after an opening cannot-statement", () => {
  const ran = cli("--check Amazon", noBoard("Amazon"));
  fail(run("S7", [ran, text(`${quote("Amazon")}\n\nThat said, Amazon is currently hiring across many teams.`)]), /hiring claim/);
  fail(run("S7", [ran, text(`${quote("Amazon")} Large companies usually have many open roles, so it likely is hiring.`)]), /hiring claim/);
});

test("S7 claim in earlier narration", () => {
  const ran = cli("--check Amazon", noBoard("Amazon"));
  fail(run("S7", [text("Amazon is still hiring, I believe."), ran, text(quote("Amazon"))]), /hiring claim/);
});

test("S7 narration and neutral phrases do not trigger", () => {
  const ran = cli("--check Amazon", noBoard("Amazon"));
  pass(run("S7", [text("I'll run the check."), ran, text(`${quote("Amazon")} That does not mean Amazon has no openings. I can check which companies are hiring if you name them.`)]));
});

test("S7 needs evidence that the CLI ran for the company", () => {
  fail(run("S7", [tool("skill", { name: "job-board" }, "skill text"), text(quote("Amazon"))]), /CLI never run for Amazon/);
  fail(run("S7", [cli("--check Other", noBoard("Other")), text(quote("Amazon"))]), /CLI never run for Amazon/);
  fail(run("S7", [cli("--check Amazon", '{"open_roles": 3}'), text(quote("Amazon"))]), /does not say no job board/);
});

test("S8 filters", () => {
  pass(run("S8", [cli("--company stripe --location 'New York' --seniority senior", ROLES), text("https://boards.example/ramp/1")]));
  fail(run("S8", [cli("--company stripe", ROLES), text("none")]), /missing Stripe\/filters/);
});

test("S9 unknown company, passing", () => {
  pass(run("S9", [cli('--check "Zzqxv Holdings International" --format json', noBoard("Zzqxv Holdings International")), text(`${quote("Zzqxv Holdings International")}\n\nThat usually means the name is wrong; likely a typo.`)]));
});

test("S9 failures", () => {
  const ran = cli('--check "Zzqxv Holdings International"', noBoard("Zzqxv Holdings International"));
  fail(run("S9", [ran, text(`${quote("Zzqxv Holdings International")} It has 12 open roles.`)]), /invented a count/);
  fail(run("S9", [ran, text("Zzqxv has 3 positions listed.")]), /invented a count/);
  fail(run("S9", [ran, text("No idea about that one.")]), /lacks the quoted/);
  fail(run("S9", [ran, text(`${quote("Zzqxv")}\n\nThey are hiring typically in Q1.`)]), /hiring claim/);
});

test("S9 zero counts and narration are not invented counts", () => {
  const ran = cli('--check "Zzqxv Holdings International"', noBoard("Zzqxv Holdings International"));
  pass(run("S9", [text("Let me check whether it is hiring."), ran, text(`${quote("Zzqxv Holdings International")} The CLI reported 0 roles because no board exists.`)]));
});

test("S10 html output", () => {
  pass(run("S10", [cli("--company cohere --format html > /tmp/c.html", "ok"), text("Saved /tmp/c.html")]));
  fail(run("S10", [cli("--company cohere --format md", "ok"), text("Here you go")]), /--format html/);
});

test("errors and non-zero exits are invalid, not failures", () => {
  const e = run("S1", [{ type: "error", error: { data: { message: "insufficient credits" } } }]);
  const g = grade(e);
  assert.equal(g.invalid, true);
  assert.match(g.invalidReason, /insufficient credits/);
  const x = grade(run("S1", [text("hi")], 137));
  assert.equal(x.invalid, true);
  assert.match(x.invalidReason, /exited 137/);
});

test("malformed tool call text is reported explicitly", () => {
  const g = fail(run("S7", [text("<function=bash>\n<parameter=command>x</parameter>\n</function>")]), /malformed tool call, never ran/);
  assert.equal(g.malformedToolCall, true);
  assert.deepEqual(g.why, ["malformed tool call, never ran"]);
  fail(run("S0", [text("job-board <tool_call>")]), /malformed tool call, never ran/);
  const z = fail(run("S9", [text(quote("Zzqxv"))]), /malformed tool call, never ran/);
  assert.equal(z.malformedToolCall, true);
  assert.equal(grade(run("S6", [text("Which companies?")])).malformedToolCall, false);
});

test("web use: curl, wget, browser tools", () => {
  const ran = cli("--check Amazon", noBoard("Amazon"));
  const base = run("S7", [ran, text(quote("Amazon"))]);
  assert.equal(grade(base).web, 0);
  for (const evs of [
    [bash("curl -s https://amazon.jobs"), ran],
    [bash("wget -qO- https://amazon.jobs"), ran],
    [tool("browser_navigate", { url: "https://amazon.jobs" }), ran],
    [tool("browser", { url: "https://amazon.jobs" }), ran],
  ]) {
    const g = fail(run("S7", [...evs, text(quote("Amazon"))]), /used web tools/);
    assert.equal(g.web, 1);
  }
  fail(run("S1", [bash("curl https://ramp.com"), cli("--company ramp", ROLES), text("https://boards.example/ramp/1")]), /used web tools/);
});

test("parseRun returns every text event", () => {
  const p = parseRun(run("S7", [text("a"), text("b"), finish()]));
  assert.deepEqual(p.texts, ["a", "b"]);
  assert.equal(p.final, "b");
});

test("hiringClaim ignores the sentinel and neutral phrases", () => {
  assert.equal(hiringClaim(quote("Amazon")), undefined);
  assert.equal(hiringClaim("Which companies are hiring? I can see which ones are hiring."), undefined);
  assert.ok(hiringClaim("Amazon is hiring."));
  assert.ok(hiringClaim("Amazon has open roles."));
  assert.ok(hiringClaim("They are usually hiring in spring."));
  assert.equal(hiringClaim("That usually means the name is wrong."), undefined);
});

test("real records keep their verdicts", () => {
  const rows = readFileSync(new URL("./fixtures/real-records.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(rows.length >= 5);
  for (const row of rows) {
    const g = grade(row.rec);
    assert.equal(g.pass, row.expectPass, row.note);
    assert.deepEqual(g.why, row.expectWhy, row.note);
    assert.equal(g.malformedToolCall, row.expectMalformed, row.note);
    assert.equal(g.web, row.expectWeb, row.note);
  }
});
