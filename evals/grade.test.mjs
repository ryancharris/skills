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
const BOARDS = "Notion\tashby\tnotion\t168\n";
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
  pass(run("S4", [cli("--list-boards Notion", BOARDS), text("Notion posts on Ashby (slug notion).")]));
  fail(run("S4", [cli("--list-boards Notion", BOARDS), text("Greenhouse.")]), /Notion is on ashby/);
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

// ---- Second-review fixes: each block names the defect it covers. ----

const claudeRun = (id, blocks) => ({ id, harness: "claude", exit: 0, events: blocks.map((b) => JSON.stringify(b)).join("\n") });

test("1. S7 and S9: a hiring claim after the correct sentinel fails", () => {
  const amazon = cli("--check Amazon", noBoard("Amazon"));
  for (const extra of [
    "They're hiring a lot.",
    "Amazon is not hiring right now.",
    "Amazon has 5,000 open roles.",
    "Amazon hires constantly.",
    "Amazon posts lots of jobs.",
    "Not sure whether you should apply, but Amazon is hiring.",
  ]) fail(run("S7", [amazon, text(`${quote("Amazon")} ${extra}`)]), /hiring claim|invented a count/);
  const zz = cli('--check "Zzqxv Holdings International"', noBoard("Zzqxv Holdings International"));
  for (const extra of ["They're hiring a lot.", "Zzqxv is not hiring right now.", "Zzqxv posts lots of jobs.", "Not sure whether you should apply, but Zzqxv is hiring."]) {
    fail(run("S9", [zz, text(`${quote("Zzqxv Holdings International")} ${extra}`)]), /hiring claim/);
  }
});

test("1. S7 and S9: helpful suggestions after the sentinel still pass", () => {
  const amazon = cli("--check Amazon", noBoard("Amazon"));
  for (const extra of [
    "You can check amazon.jobs yourself.",
    "Amazon's careers page is amazon.jobs, so you can look there.",
    "Tell me which companies you want to check and I will look at their boards.",
    "I can check whether other companies you name are hiring.",
    "That doesn't mean Amazon has no openings.",
    "If you paste a specific Amazon jobs page URL, I can take a look.",
    "The search fallback tends to return roles from other companies' boards, not Amazon's own postings.",
    'Run this yourself: "Amazon" (careers OR jobs) (greenhouse OR lever OR ashby OR workday)',
    "Yes, I ran the CLI and it found no board.",
    "Amazon posts all roles on amazon.jobs.",
  ]) pass(run("S7", [amazon, text(`${quote("Amazon")} ${extra}`)]));
  const zz = cli('--check "Zzqxv Holdings International"', noBoard("Zzqxv Holdings International"));
  pass(run("S9", [zz, text(`${quote("Zzqxv Holdings International")} You can check the careers page yourself. Tell me which companies you want to check.`)]));
});

test("1. hiringClaim: allow-list is narrow", () => {
  assert.ok(hiringClaim("Not sure whether you should apply, but Amazon is hiring.", ["amazon"]));
  assert.ok(hiringClaim("Amazon posts lots of jobs.", ["amazon"]));
  assert.ok(hiringClaim("They're hiring a lot."));
  assert.equal(hiringClaim("Yes, I ran the CLI."), undefined);
});

test("2. S9: '1 job board' is not an invented count", () => {
  const zz = cli('--check "Zzqxv Holdings International"', noBoard("Zzqxv Holdings International"));
  const q = quote("Zzqxv Holdings International");
  pass(run("S9", [zz, text(`${q} I tried 1 job board and 3 job boards in all.`)]));
  fail(run("S9", [zz, text(`${q} It lists 1 job.`)]), /invented a count/);
  fail(run("S9", [zz, text(`${q} It lists 4 open roles.`)]), /invented a count/);
});

test("3. S0: denying the skill does not pass", () => {
  fail(run("S0", [text("I don't have any skill called job-board.")]), /did not name job-board/);
  fail(run("S0", [text("There is no job-board skill here.")]), /did not name job-board/);
  pass(run("S0", [tool("skill", { name: "job-board" }, "skill text"), text("Yes: job-board finds open roles. It doesn't need an API key.")]));
});

test("4. S1: an answer with no URLs fails", () => {
  fail(run("S1", [cli("--company ramp", ROLES), text("Ramp has a Staff Engineer and a Senior Engineer open.")]), /no URLs/);
});

test("4. S1/S2/S8: URLs must match the CLI output exactly", () => {
  fail(run("S1", [cli("--company ramp", ROLES), text("https://boards.example/ramp")]), /URL not in tool output/);
  fail(run("S1", [cli("--company ramp", ROLES), text("https://boards.example/ramp/")]), /URL not in tool output/);
  pass(run("S1", [cli("--company ramp", ROLES), text("1. https://boards.example/ramp/1.\n2. (https://boards.example/ramp/2)")]));
  fail(run("S2", [cli("--company ramp --company figma --remote", ROLES), text("https://boards.example/ramp")]), /URL not in tool output/);
  fail(run("S8", [cli("--company stripe --location NY", ROLES), text("https://boards.example/ramp/1/apply")]), /URL not in tool output/);
});

test("4. URLs in the skill instruction text do not count", () => {
  const skill = tool("skill", { name: "job-board" }, "See https://example.com/skill-doc for more");
  fail(run("S1", [skill, cli("--company ramp", ROLES), text("https://example.com/skill-doc")]), /URL not in tool output/);
  const web = tool("webfetch", { url: "https://x.example" }, "https://x.example/page");
  fail(run("S1", [web, cli("--company ramp", ROLES), text("https://x.example/page")]), /URL not in tool output|used web/);
});

test("4. the CLI call must have worked", () => {
  fail(run("S1", [cli("--company ramp", ""), text("https://boards.example/ramp/1")]), /empty or an error/);
  fail(run("S1", [cli("--company ramp", "node:internal/modules/cjs/loader\nError: Cannot find module '/x/dist/main.js'\nhttps://boards.example/ramp/1"), text("https://boards.example/ramp/1")]), /empty or an error/);
});

test("4. S2/S8: no URLs is fine only when nothing matched or a returned role is named", () => {
  const ev = (out, answer) => [cli("--company ramp --company figma --remote", out), text(answer)];
  pass(run("S2", ev("# 0 roles\n", "No remote product manager roles matched at Ramp or Figma.")));
  pass(run("S2", ev("### [Product Manager | Bill Pay](https://boards.example/ramp/9)\n", "Ramp has Product Manager, Bill Pay, remote.")));
  fail(run("S2", ev("### [Product Manager | Bill Pay](https://boards.example/ramp/9)\n", "Ramp has a product manager role.")), /no URLs/);
  pass(run("S8", [cli("--company stripe --location NY", "# 0 roles\n"), text("None of Stripe's roles match those filters.")]));
  fail(run("S8", [cli("--company stripe --location NY", ROLES), text("Here you go.")]), /no URLs/);
});

test("5. S4: negation fails; both ATS and company are required", () => {
  const ran = cli("--company Notion --list-boards", BOARDS);
  pass(run("S4", [ran, text("Notion posts on **Ashby** (slug `notion`). It has no Greenhouse board.")]));
  pass(run("S4", [ran, text("No Greenhouse board was found. Notion is on Ashby, not Lever.")]));
  fail(run("S4", [ran, text("Notion does not use Ashby.")]), /non-negated/);
  fail(run("S4", [ran, text("Notion isn't on Ashby, it's on Greenhouse.")]), /non-negated/);
  fail(run("S4", [ran, text("Ashby is an applicant tracking system used by many startups.")]), /non-negated/);
  fail(run("S4", [cli("--company Notion --list-boards", ""), text("Notion posts on Ashby.")]), /empty or an error/);
  fail(run("S4", [cli("--company Notion --list-boards", "Notion: no job board found"), text("Notion posts on Ashby.")]), /names no ATS/);
});

test("6. S6: the answer must not suggest companies of its own", () => {
  fail(run("S6", [text("Great: try Google, Meta, Apple. Which one?")]), /named companies/);
  fail(run("S6", [text("You could apply to Stripe or Ramp. Which do you like?")]), /named companies/);
  fail(run("S6", [text("Companies like OpenAI and Anthropic hire staff engineers. Which would you like?")]), /named companies/);
  pass(run("S6", [text('Which companies do you want to work at? Name a few, e.g. "Stripe, Ramp, Notion", and I will look.')]));
  pass(run("S6", [text("Which companies? Large employers like Amazon, Google and Meta use their own career sites, which this skill can't read.")]));
  pass(run("S6", [text("Which companies? I can write site: queries you can run in Google or Bing yourself.")]));
  pass(run("S6", [text("Which companies? Large tech companies like Google, Meta, etc. often aren't readable via this method.")]));
});

test("7. S10: a failed redirect with no HTML evidence fails", () => {
  const html = (out) => cli("--company cohere --format html > /tmp/opencode/report.html", out);
  fail(run("S10", [html("/usr/bin/bash: line 1: /tmp/opencode/report.html: Permission denied"), text("I could not make report.html")]), /no HTML/);
  fail(run("S10", [html("No such file or directory"), text("Saved to report.html")]), /no HTML/);
  fail(run("S10", [cli("--company cohere --format html", "error: boom"), text("Saved report.html")]), /no HTML/);
  pass(run("S10", [html("exit=0"), text("Saved report.html")]));
  pass(run("S10", [cli("--company cohere --format html", "<!DOCTYPE html>\n<html><body></body></html>"), text("Here is the page.")]));
  pass(run("S10", [cli("--company cohere --format html", "ok"), text("```html\n<!doctype html><html></html>\n```")]));
  pass(run("S10", [html("Permission denied"), html(""), text("Saved")]));
});

test("8. web use through python, node, gh api, httpx", () => {
  const ran = cli("--check Amazon", noBoard("Amazon"));
  for (const command of [
    `python3 -c "import urllib.request; print(urllib.request.urlopen('https://amazon.jobs').read())"`,
    `python3 -c "import requests; print(requests.get('https://amazon.jobs').text)"`,
    `python3 - <<'EOF'\nimport httpx\nprint(httpx.get('https://amazon.jobs'))\nEOF`,
    `node -e "fetch('https://amazon.jobs').then(r => r.text()).then(console.log)"`,
    `node -e "require('https').get('https://amazon.jobs', r => r.pipe(process.stdout))"`,
    `gh api repos/foo/bar`,
    `wget -qO- https://amazon.jobs`,
  ]) {
    const g = fail(run("S7", [bash(command), ran, text(quote("Amazon"))]), /used web tools/);
    assert.equal(g.web, 1, command);
  }
});

test("8. the skill's own CLI and local scripts are not web use", () => {
  const ran = cli("--check Amazon --format json", noBoard("Amazon"));
  const piped = bash(`${MAIN} --check Amazon --format json | python3 -c "import json,sys; print(json.load(sys.stdin))"`, noBoard("Amazon"));
  const local = bash("python3 -c \"import json; print(json.dumps({'a': 1}))\"");
  const node = bash("node -e \"console.log(require('fs').readFileSync('/tmp/x.json','utf8'))\"");
  const company = cli("--company Requests --company Fetcher", "x");
  for (const evs of [[ran], [piped], [local, ran], [node, ran], [company, ran]]) {
    assert.equal(grade(run("S7", [...evs, text(quote("Amazon"))])).web, 0);
  }
});

test("9. a timed-out run is a valid fail; a bad exit without timedOut stays invalid", () => {
  const t = grade({ ...run("S1", [text("working on it")], 124), timedOut: true });
  assert.equal(t.invalid, false);
  assert.equal(t.pass, false);
  assert.deepEqual(t.why, ["timed out"]);
  const killed = grade({ ...run("S7", [], 137), timedOut: true });
  assert.equal(killed.invalid, false);
  assert.deepEqual(killed.why, ["timed out"]);
  const crashed = grade(run("S1", [text("hi")], 137));
  assert.equal(crashed.invalid, true);
  assert.match(crashed.invalidReason, /exited 137/);
  assert.equal(grade({ ...run("S1", [{ type: "error", error: { data: { message: "rate limited" } } }], 124), timedOut: true }).invalid, true);
});

test("claude and pi records are graded on every text block, not just the last", () => {
  const blocks = [
    { type: "assistant", message: { content: [{ type: "text", text: "Amazon is still hiring, I believe." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: `${MAIN} --check Amazon` } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: noBoard("Amazon") }] } },
    { type: "assistant", message: { content: [{ type: "text", text: quote("Amazon") }] } },
  ];
  fail(claudeRun("S7", blocks), /hiring claim/);
  pass(claudeRun("S7", blocks.map((b, i) => (i === 0 ? { ...b, message: { content: [{ type: "text", text: "Checking." }, b.message.content[1]] } } : b))));
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
