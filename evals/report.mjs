// Usage: node evals/report.mjs <out-dir>  -> writes <out-dir>/report.html
import { readFileSync, writeFileSync } from "node:fs";
import { grade } from "./grade.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node evals/report.mjs <out-dir>");
  process.exit(2);
}
const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8"));
const order = JSON.parse(readFileSync(`${dir}/order.json`, "utf8"));
const runs = readFileSync(`${dir}/results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
for (const r of runs) r.g = grade(r);

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const short = (m) => m.replace(/^openrouter\//, "");
const slug = (s) => s.replace(/\W/g, "_");
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
const sids = [...new Set(runs.map((r) => r.id))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const titles = Object.fromEntries(runs.map((r) => [r.id, r.title]));
const models = [...new Set(runs.map((r) => r.model))].sort((a, b) => sum(runs.filter((r) => r.model === b), (r) => +r.g.pass) - sum(runs.filter((r) => r.model === a), (r) => +r.g.pass));
const per = (m, s) => runs.filter((r) => r.model === m && r.id === s);
const perRuns = Math.max(...runs.map((r) => r.run));

const heat = models.map((m) => {
  const cells = sids.map((s) => {
    const rs = per(m, s);
    const p = sum(rs, (r) => +r.g.pass);
    return `<td class="c${Math.round((3 * p) / Math.max(rs.length, 1))}"><a href="#g-${slug(m)}-${s}">${p}/${rs.length}</a></td>`;
  });
  const rs = runs.filter((r) => r.model === m);
  return `<tr><th>${esc(short(m))}</th>${cells.join("")}<td class="tot">${sum(rs, (r) => +r.g.pass)}/${rs.length}</td></tr>`;
}).join("");

const GUARD = ["S6", "S7", "S9"];
const rows = models.map((m) => {
  const rs = runs.filter((r) => r.model === m);
  const gr = rs.filter((r) => GUARD.includes(r.id));
  return `<tr><td>${esc(short(m))}</td><td>${sum(rs, (r) => +r.g.pass)}/${rs.length}</td><td>${sum(gr, (r) => +r.g.pass)}/${gr.length}</td><td>${sum(rs, (r) => +r.g.skill)}/${rs.length}</td><td>${sum(rs, (r) => +(r.g.web > 0))}</td><td>${sum(rs, (r) => +r.g.malformedToolCall)}</td><td>${(sum(rs, (r) => r.seconds) / rs.length).toFixed(1)}s</td><td>${Math.round(sum(rs, (r) => r.g.tokens) / 1000)}k</td><td>$${sum(rs, (r) => r.g.cost).toFixed(2)}</td></tr>`;
}).join("");

const why = new Map();
for (const r of runs) for (const w of r.g.why) {
  const k = `${short(r.model)}\t${w.split(": ")[0]}`;
  why.set(k, (why.get(k) ?? 0) + 1);
}
const whyRows = [...why].sort().map(([k, n]) => `<tr><td>${esc(k.split("\t")[0])}</td><td>${esc(k.split("\t")[1])}</td><td>${n}</td></tr>`).join("");

const trans = [...runs].sort((a, b) => models.indexOf(a.model) - models.indexOf(b.model) || Number(a.id.slice(1)) - Number(b.id.slice(1)) || a.run - b.run).map((r) => {
  const g = r.g;
  const steps = g.calls.map((c) => {
    let out = c.out;
    if (c.tool === "skill") out = out.slice(0, 200) + " … (skill loaded)";
    else if (out.length > 1800) out = out.slice(0, 1800) + `\n… (${c.out.length - 1800} more chars)`;
    return `<div class="tool"><b>${esc(c.tool)}</b><pre class="cmd">${esc(c.cmd.slice(0, 1500))}</pre><details><summary>output</summary><pre>${esc(out)}</pre></details></div>`;
  }).join("");
  const v = g.pass ? "pass" : "fail";
  const exec = order.order.findIndex((o) => o[0] === r.model && o[1] === r.id && o[2] === r.run) + 1;
  return `<details class="run ${v}" data-m="${esc(short(r.model))}" data-s="${r.id}" data-v="${v}"${r.run === 1 ? ` id="g-${slug(r.model)}-${r.id}"` : ""}><summary><span class="badge ${v}">${v.toUpperCase()}</span> <b>${r.id}</b> · ${esc(short(r.model))} · run ${r.run} · exec #${exec} · ${r.seconds}s · ${g.calls.length} tools${g.malformedToolCall ? " · <i>malformed tool call</i>" : ""}${g.skill ? " · skill loaded" : ""}</summary><div class="body"><h4>Prompt</h4><pre class="prompt">${esc(r.prompt)}</pre><h4>Expected</h4><p>${esc(r.expect)}</p>${g.why.length ? `<p class="why"><b>Grader:</b> ${esc(g.why.join("; "))}</p>` : ""}<h4>Tool calls</h4>${steps || "<p><i>none</i></p>"}<h4>Final answer</h4><pre class="answer">${esc(g.final || "(none)")}</pre></div></details>`;
}).join("");

const total = sum(runs, (r) => +r.g.pass);
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>job-board agent evals</title><style>
body{font:15px/1.5 system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1b1f23}table{border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #ddd;padding:5px 9px;text-align:center}th:first-child,td:first-child{text-align:left}
td.c3{background:#c8f0d2}td.c2{background:#fff3b8}td.c1{background:#ffd9b0}td.c0{background:#ffc4c4}td a{color:inherit;text-decoration:none;display:block}.tot{font-weight:700}
pre{background:#f6f8fa;padding:.6rem;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12.5px}.cmd{background:#0d1117;color:#e6edf3}.answer{background:#fffdf5;border:1px solid #eee}.prompt{background:#eef6ff}
details.run{border:1px solid #ddd;border-left:6px solid #2da44e;border-radius:6px;margin:.4rem 0;padding:.3rem .8rem}details.run.fail{border-left-color:#cf222e}.badge{font-size:11px;padding:1px 7px;border-radius:99px;color:#fff;background:#2da44e}.badge.fail{background:#cf222e}
.why{background:#ffebe9;padding:.4rem .7rem;border-radius:6px}h4{margin:.8rem 0 .2rem;font-size:12px;text-transform:uppercase;color:#555}.tool{margin:.4rem 0}#f button{margin:2px;padding:3px 10px;border:1px solid #bbb;border-radius:99px;background:#fff;cursor:pointer}.note{background:#f6f8fa;padding:.6rem 1rem;border-radius:6px}
</style><h1>job-board agent evals</h1>
<p>${esc(meta.date)} · skill from <code>${esc(meta.ref)}</code> (${esc(meta.commit)}) · opencode in Docker (node:22-slim)</p>
<p><b>${total} of ${runs.length} runs passed</b> (${models.length} models × ${sids.length} stories × up to ${perRuns} runs). Order shuffled with seed <code>${order.seed}</code>; each run is a fresh session in its own directory.</p>
<h2>Pass rate by model and story</h2><table><tr><th></th>${sids.map((s) => `<th title="${esc(titles[s])}">${s}</th>`).join("")}<th>total</th></tr>${heat}</table>
<h2>Per model</h2><table><tr><th>Model</th><th>Pass</th><th>Guardrails S6/S7/S9</th><th>Loaded the skill</th><th>Runs using web tools</th><th>Malformed tool calls</th><th>Avg time</th><th>Tokens</th><th>Cost</th></tr>${rows}</table>
<h2>Grading</h2><div class="note">Automatic and strict (see <code>evals/grade.mjs</code>): a run passes only if every check holds. S7 and S9 are matched on wording, so read those transcripts before trusting a pass. The grader is project code and can be wrong.</div>
<h2>Failure reasons</h2><table><tr><th>Model</th><th>Check that failed</th><th>Runs</th></tr>${whyRows}</table>
<h2>Transcripts</h2><p id="f">Filter: <button data-k="v" data-x="">all</button><button data-k="v" data-x="fail">failures</button><button data-k="v" data-x="pass">passes</button> ${models.map((m) => `<button data-k="m" data-x="${esc(short(m))}">${esc(short(m).split("/").pop())}</button>`).join("")} ${sids.map((s) => `<button data-k="s" data-x="${s}">${s}</button>`).join("")}</p>${trans}
<script>const st={v:'',m:'',s:''};const ap=()=>document.querySelectorAll('details.run').forEach(d=>{d.style.display=(!st.v||d.dataset.v==st.v)&&(!st.m||d.dataset.m==st.m)&&(!st.s||d.dataset.s==st.s)?'':'none'});
document.querySelectorAll('#f button').forEach(b=>b.onclick=()=>{st[b.dataset.k]=st[b.dataset.k]==b.dataset.x?'':b.dataset.x;ap()});
document.querySelectorAll('td a').forEach(a=>a.onclick=()=>{const d=document.querySelector(a.getAttribute('href'));if(d){d.open=true;document.querySelectorAll('details.run').forEach(x=>x.style.display='')}})</script></html>`;
writeFileSync(`${dir}/report.html`, page);
console.log(`${total}/${runs.length} passed -> ${dir}/report.html`);
