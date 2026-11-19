// Runs inside a route image: node /evals/verify.mjs <claude|pi>
// Proves the skill was installed through that agent's own install route, with no model call and no API key.
// Exits 0 only if every check holds; otherwise prints one "FAIL:" line per broken check and exits 1.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const route = process.argv[2];
const failures = [];
const ok = (msg) => console.log(`ok    ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL: ${msg}`);
};
const check = (cond, good, bad) => (cond ? ok(good) : fail(bad));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts });

function skillFacts(skillDir) {
  const md = join(skillDir, "SKILL.md");
  check(existsSync(md), `SKILL.md exists at ${md}`, `SKILL.md missing at ${md}`);
  if (existsSync(md)) {
    const fm = readFileSync(md, "utf8").split("---")[1] ?? "";
    check(/^name:\s*job-board\s*$/m.test(fm), "SKILL.md frontmatter name is job-board", "SKILL.md frontmatter does not say name: job-board");
    check(/^description:\s*\S/m.test(fm), "SKILL.md frontmatter has a description", "SKILL.md frontmatter has no description");
  }
  const main = join(skillDir, "dist", "main.js");
  check(existsSync(main), `dist/main.js exists at ${main}`, `dist/main.js missing at ${main}`);
  if (!existsSync(main)) return;
  const v = sh("node", [main, "--version"]);
  check(v.status === 0 && /^job-board \d/.test(v.stdout), `CLI from install location: ${v.stdout.trim()}`, `CLI --version failed from ${main}: ${(v.stderr || v.stdout).trim()}`);
  const q = sh("node", [main, "--queries", "--company", "Stripe", "--title", "software engineer"]);
  check(q.status === 0 && q.stdout.includes("site:"), "CLI --queries prints site: queries (no network, no model)", `CLI --queries failed from ${main}: ${(q.stderr || q.stdout).trim()}`);
}

function claude() {
  const env = { ...process.env, DISABLE_AUTOUPDATER: "1" };
  const ver = sh("claude", ["--version"], { env });
  check(ver.status === 0, `claude --version: ${ver.stdout.trim()}`, `claude --version failed: ${ver.stderr.trim()}`);

  const list = sh("claude", ["plugin", "list", "--json"], { env });
  let plugins = [];
  try {
    plugins = JSON.parse(list.stdout);
  } catch {
    fail(`claude plugin list --json did not print JSON: ${(list.stdout + list.stderr).slice(0, 300)}`);
  }
  const p = plugins.find((x) => x.id === "job-board@ryancharris-skills");
  check(p, "claude plugin list shows job-board@ryancharris-skills", "claude plugin list does not show job-board@ryancharris-skills");
  if (!p) return;
  check(p.enabled === true, "plugin is enabled", `plugin is not enabled (enabled=${p.enabled})`);
  const errKeys = Object.keys(p).filter((k) => /error/i.test(k) && p[k] && (!Array.isArray(p[k]) || p[k].length));
  check(errKeys.length === 0, "plugin list entry has no error fields", `plugin list entry reports errors: ${errKeys.map((k) => `${k}=${JSON.stringify(p[k])}`).join("; ")}`);
  check(p.installPath && existsSync(p.installPath), `installPath exists: ${p.installPath}`, `installPath missing: ${p.installPath}`);
  if (!p.installPath) return;

  const val = sh("claude", ["plugin", "validate", p.installPath], { env });
  check(val.status === 0 && /Validation passed/.test(val.stdout), "claude plugin validate passed", `claude plugin validate failed:\n${(val.stdout + val.stderr).trim().slice(0, 800)}`);

  const det = sh("claude", ["plugin", "details", "job-board@ryancharris-skills"], { env });
  const m = det.stdout.match(/Skills \((\d+)\)\s+(.*)/);
  check(det.status === 0 && m && Number(m[1]) >= 1 && /job-board/.test(m[2]), `claude plugin details: Skills (${m?.[1]}) ${m?.[2]}`, `claude plugin details does not list the job-board skill:\n${(det.stdout + det.stderr).trim().slice(0, 600)}`);

  skillFacts(join(p.installPath, "skills", "job-board"));
}

async function rpcCommands(env) {
  return new Promise((res) => {
    const p = spawn("pi", ["--mode", "rpc", "--no-session"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      p.kill("SIGKILL");
      res(v);
    };
    const timer = setTimeout(() => done({ error: `timeout waiting for get_commands. stderr: ${err.slice(0, 400)}` }), 60000);
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", (d) => {
      out += d;
      for (const line of out.split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const e = JSON.parse(line);
          if (e.type === "response" && e.id === "1") return done(e.success ? { commands: e.data.commands } : { error: JSON.stringify(e) });
        } catch {}
      }
    });
    p.on("close", () => done({ error: `pi exited before answering. stderr: ${err.trim().slice(0, 600)}` }));
    p.stdin.write(JSON.stringify({ id: "1", type: "get_commands" }) + "\n");
  });
}

async function pi() {
  const env = { ...process.env, PI_OFFLINE: "1" };
  const ver = sh("pi", ["--version"], { env });
  check(ver.status === 0, `pi --version: ${(ver.stdout || ver.stderr).trim()}`, `pi --version failed: ${ver.stderr.trim()}`);

  const list = sh("pi", ["list"], { env });
  const lines = list.stdout.split("\n");
  const i = lines.findIndex((l) => /^\s+\S/.test(l) && !/^\s{4}/.test(l));
  const pkgDir = i >= 0 ? lines[i + 1]?.trim() : undefined;
  check(list.status === 0 && pkgDir, `pi list shows a user package at ${pkgDir}`, `pi list shows no package:\n${list.stdout.trim()}${list.stderr.trim()}`);
  if (!pkgDir) return;

  const pj = join(pkgDir, "package.json");
  check(existsSync(pj), `package.json exists in ${pkgDir}`, `package.json missing in ${pkgDir}`);
  if (!existsSync(pj)) return;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(pj, "utf8")).pi ?? {};
  } catch (e) {
    return fail(`package.json is not valid JSON: ${e.message}`);
  }
  const skills = manifest.skills ?? [];
  const exts = manifest.extensions ?? [];
  check(skills.length > 0, `package.json pi.skills = ${JSON.stringify(skills)}`, "package.json has no pi.skills");
  check(exts.length > 0, `package.json pi.extensions = ${JSON.stringify(exts)}`, "package.json has no pi.extensions");
  for (const e of exts) check(existsSync(resolve(pkgDir, e)), `extension file exists: ${resolve(pkgDir, e)}`, `extension file missing: ${resolve(pkgDir, e)}`);

  const r = await rpcCommands(env);
  if (r.error) fail(`pi did not start with the package loaded (a broken extension or manifest stops it): ${r.error}`);
  else {
    ok("pi --mode rpc started with the package loaded (extension modules loaded without error)");
    const sk = r.commands.find((c) => c.name === "skill:job-board");
    check(sk, `pi loaded the skill as /skill:job-board from ${sk?.sourceInfo?.path}`, `pi did not load skill:job-board; commands: ${r.commands.map((c) => c.name).join(", ")}`);
    if (sk) {
      check(sk.sourceInfo.path.startsWith(pkgDir), "the loaded skill comes from the installed package", `the loaded skill comes from ${sk.sourceInfo.path}, not the package ${pkgDir}`);
      skillFacts(dirname(sk.sourceInfo.path));
    }
  }
}

if (route === "claude") claude();
else if (route === "pi") await pi();
else {
  console.error("usage: verify.mjs <claude|pi>");
  process.exit(2);
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
