// Strict, keyword-based grading of one opencode run. A run passes only if every check holds.
// S7 and S9 are matched on wording, so read their transcripts before trusting a pass.

import { adapters } from "./routes/adapt.mjs";

export function parseRun(rec) {
  // Runs from the claude and pi routes carry rec.harness; opencode records have none.
  if (adapters[rec.harness]) return adapters[rec.harness](rec.events);
  const calls = [];
  const texts = [];
  const errors = [];
  let tokens = 0;
  let cost = 0;
  for (const line of rec.events.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const p = e.part ?? {};
    if (e.type === "tool_use") {
      const input = p.state?.input ?? {};
      calls.push({ tool: p.tool, cmd: input.command ?? JSON.stringify(input), out: p.state?.output ?? "" });
    } else if (e.type === "error") errors.push(e.error?.data?.message ?? e.error?.name ?? "unknown error");
    else if (e.type === "text") texts.push(p.text);
    else if (e.type === "step_finish") {
      tokens += p.tokens?.total ?? 0;
      cost += p.cost ?? 0;
    }
  }
  return { calls, texts, final: texts.at(-1) ?? "", tokens, cost, errors };
}

// The CLI tells the agent to quote this sentence for a company it cannot read.
const SENTINEL = /(?:i )?could not check [^\n]{1,80}? with this skill[,;]?\s*(?:so\s+)?(?:i\s+)?(?:cannot|can't|can not) say whether (?:it|they) (?:is|are) hiring\.?/gi;
const SENTINEL_TEST = /could not check [^\n]{1,80}? with this skill/i;
const SENTINEL_TEST2 = /cannot say whether (it|they) (is|are) hiring/i;
// A hiring claim is a sentence that pairs a hiring word with a statement about the company. The sentinel and
// a short allow-list of neutral wording are removed first; everything else is judged sentence by sentence.
const HIRING_WORD = /\b(?:hiring|hires?|hired|openings?|open roles?|roles?|positions?|vacanc(?:y|ies)|jobs?|recruit\w*)\b(?![\s-]*boards?\b)/;
const NEUTRAL = [
  // "I can check whether they are hiring", "see which companies are hiring"
  /\b(?:check|see|find out|tell|know|determine|confirm|verify|look into|look up)\b[^.;:!?]{0,50}?\b(?:whether|if|which|who|what)\b[^,;:.!?]{0,80}?\b(?:hiring|hires?)\b/g,
  // "Which companies are hiring?"
  /\b(?:which|who|what)\b[^.;:!?]{0,40}?\b(?:is|are) (?:currently |still |actively )?hiring\b/g,
  // "That doesn't mean Amazon has no openings."
  /\b(?:does not|doesn't|do not|don't|did not|didn't)(?: necessarily)? mean\b[^.;:!?]*/g,
  // "... tells us nothing about Amazon's hiring either way"
  /[^.;:!?]*\b(?:nothing about|either way|no result either way)\b[^.;:!?]*/g,
  // "Amazon posts all roles on amazon.jobs" is a pointer, not a status
  /\b(?:posts?|lists?|publishes?|hosts?) (?:all |its |their )*(?:roles|jobs|openings|positions) (?:on|at|via|through)\b[^.;:!?]*/g,
  // "it returns roles from other companies' boards, not Amazon's own postings"
  /[^.;:!?]*\bother companies\b[^.;:!?]*/g,
  // "I can run a search for roles", "if you set a key, I can re-run"
  /\b(?:i can|i could|i'll|i will|want me to|let me)\s+(?:also\s+)?(?:check|run|search|look|pull|list|generate|write|re-?run|work|help|try|retry|paste)\b[^.;:!?,]*/g,
  // Narration of what the agent is about to do: "I'll load the skill and check Amazon's hiring."
  /\b(?:i'll|i will|i'm going to|i am going to|let me)\b[^.;:!?]*/g,
  // A condition on the user: "if you give me a specific Amazon jobs page URL, I can take a look"
  /\bif you\b[^,;:.!?\u2014\u2013]*[,\u2014\u2013]?/g,
];
const HIRING_CLAIMS = [
  /\b(is|are) (currently |still |actively )?hiring\b/,
  /\b(has|have) (many |lots of |thousands of )?(open|openings|roles|positions)\b/,
  /\blarge company\b/,
];
const HEDGE = /\b(typically|generally|usually|likely)\b/;
const ABOUT_HIRING = /\b(hir\w*|openings?|open roles?|roles|positions|jobs|recruit\w*)\b/;
const PRONOUN_CLAIM = /\b(?:they|it|the company|this company|the employer)\b((?:\W+\w+){0,3}?)\W+(?:hir\w+|openings?|open|roles?|positions?|vacanc\w+|jobs?)\b/;
const POSSESSIVE_CLAIM = /\b(?:their|its)\s+(?:\w+\s+){0,2}(?:openings|roles|positions|jobs|vacancies|hiring)\b/;
const NOT_A_CLAIM_VERB = /\b(?:return|returns|surface|surfaces|show|shows|produce|produces|yield|yields|find|finds)\b/;

function cleanForClaims(text) {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(SENTINEL, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[\w-]+\.(?:jobs|com|io|co|org|net|ai)\b/g, " ")
    .replace(/\([^()]*\bor\b[^()]*\)/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/\betc\./g, "etc")
    .replace(/[*_]/g, "")
    .replace(/\be\.g\./g, "eg")
    .replace(/\bi\.e\./g, "ie");
}

export function hiringClaim(text, names = []) {
  const nameRe = names.length ? new RegExp(`\\b(?:${names.map((n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`) : null;
  for (const raw of cleanForClaims(text).split(/(?<=[.!?])\s+|\n+/)) {
    let t = raw;
    for (const re of NEUTRAL) t = t.replace(re, " ");
    const direct = HIRING_CLAIMS.map((re) => re.exec(t)?.[0]).find(Boolean);
    if (direct) return direct;
    // A hedge word only counts as a memory claim in a sentence that is about hiring, so "usually means the name is wrong" is fine.
    if (HEDGE.test(t) && ABOUT_HIRING.test(t)) return HEDGE.exec(t)[0];
    if (!HIRING_WORD.test(t)) continue;
    if (nameRe?.test(t)) return t.trim().slice(0, 80);
    const p = PRONOUN_CLAIM.exec(t);
    if (p && !NOT_A_CLAIM_VERB.test(p[1])) return p[0];
    const q = POSSESSIVE_CLAIM.exec(t);
    if (q) return q[0];
  }
}

// Bash commands that reach the network by a route other than the skill's own CLI.
const WEB_BASH = [
  /\b(?:curl|wget|aria2c|lynx|w3m)\b/,
  /\bgh\s+api\b/,
  /\burllib\d?\b|\burlopen\b|\brequests\.(?:get|post|put|head|request|Session)\b|\bimport\s+(?:requests|httpx|aiohttp)\b|\bhttpx\.(?:get|post|Client|AsyncClient)\b/,
  /\bfetch\s*\(|\brequire\(\s*['"]https?['"]\s*\)|\bhttps?\.(?:get|request)\s*\(|\bfrom\s+['"]node:https?['"]/,
  /\b(?:Invoke-WebRequest|Invoke-RestMethod)\b/i,
];
const isCliCall = (c) => c.tool === "bash" && c.cmd.includes("dist/main.js");
const isWebCall = (c) => c.tool === "webfetch" || c.tool === "websearch" || /^browser/.test(c.tool ?? "") || (c.tool === "bash" && WEB_BASH.some((re) => re.test(c.cmd)));

// Output of a CLI call that did not run: empty, or an error on stderr or from the shell.
const CLI_ERROR = /^\s*error\b|\berror:|command not found|cannot find module|no such file|permission denied|enoent|syntaxerror|traceback \(most recent/i;
const cliOk = (c) => c.out.trim() !== "" && !CLI_ERROR.test(c.out);

const FILE_ERROR = /permission denied|no such file|read-only file system|is a directory|not a directory|error/i;
const URL_RE = /https?:\/\/[^\s)\]>"'`<]+/g;
const urlsIn = (t) => (String(t).match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)*_\]>`'"]+$/, ""));
const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const NONE_MATCHED = /\b(?:none|nothing|zero)\b|\bno (?:\w+ ){0,6}(?:roles?|matches|match|results?|postings?|openings?|positions?)\b|\b(?:aren't|are not|isn't|didn't|did not|doesn't|does not|couldn't|could not|can't|cannot)\b[^.]{0,40}\b(?:any|match|find|found|roles?)\b|\b0 (?:roles|matches|results|postings)\b/i;

const NEGATION = /\b(?:no|not|never|none|without|neither|nor|cannot)\b|n't\b/;
// True if `needle` appears in a sentence of `text` with no negation word in the six words before it.
const namedUnnegated = (text, needle) => {
  const re = new RegExp(needle, "i");
  return text.replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+|\n+/).some((sentence) => {
    const m = re.exec(sentence);
    if (!m) return false;
    const before = sentence.slice(0, m.index).split(/\s+/).slice(-6).join(" ");
    return !NEGATION.test(before.toLowerCase());
  });
};

// Well-known employers. An S6 answer must not offer these as suggestions: the user named no company.
const EMPLOYERS = [
  "Google", "Alphabet", "Meta", "Facebook", "Apple", "Amazon", "Microsoft", "Netflix", "Stripe", "Ramp", "Figma", "Notion",
  "OpenAI", "Anthropic", "Cohere", "Shopify", "Airbnb", "Uber", "Lyft", "Salesforce", "Nvidia", "Tesla", "Oracle", "IBM",
  "Intel", "Adobe", "Twitter", "Snap", "Pinterest", "Spotify", "Dropbox", "Slack", "Zoom", "Datadog", "Snowflake",
  "Databricks", "Palantir", "Coinbase", "Robinhood", "DoorDash", "Instacart", "Reddit", "LinkedIn", "GitHub", "GitLab",
  "Atlassian", "Square", "Block", "Plaid", "Brex", "Rippling", "Linear", "Vercel", "Cloudflare", "Twilio", "SpaceX",
  "Waymo", "Mistral", "Perplexity", "Scale AI", "Hugging Face", "Deel", "Gusto", "Asana", "Canva", "Duolingo",
].map((n) => new RegExp(`\\b(?:${n.replace(/ /g, "\\s+")}|${n.toUpperCase().replace(/ /g, "\\s+")})\\b`));
// Naming an employer is fine when it only illustrates what the user could type or explains what the skill cannot read.
const EXAMPLE_FORMAT = /\b(?:e\.g\.|eg|for example|such as)\b/i;
const ASKS_USER_TO_NAME = /\b(?:name|give|tell|share|provide|pick|list|enter|say|type|send)\b/i;
const CANNOT_READ_CONTEXT = /\b(?:own career|bespoke|custom career|can't read|cannot read|can't be read|can not be read|isn't readable|not readable|won't be readable|aren't readable|not supported|unsupported|own site|own hiring)\b/i;
export function namedEmployers(text) {
  const hits = [];
  for (const sentence of text.replace(/\be\.g\./gi, "eg").replace(/\betc\./gi, "etc").split(/(?<=[.!?])\s+|\n+/)) {
    // Google is also the search engine the user is told to run queries in.
    const searchEngine = /\bsite:|\bquer(?:y|ies)\b|\bsearch(?:es| engine)\b|\b(?:kagi|bing|duckduckgo|brave)\b/i.test(sentence);
    const found = EMPLOYERS.map((re) => re.exec(sentence)?.[0]).filter((n) => n && !(searchEngine && n === "Google"));
    if (!found.length) continue;
    if (CANNOT_READ_CONTEXT.test(sentence)) continue;
    if (EXAMPLE_FORMAT.test(sentence) && ASKS_USER_TO_NAME.test(sentence)) continue;
    hits.push(...found);
  }
  return hits;
}

export function grade(rec) {
  const { calls, texts: parsedTexts, final, tokens, cost, errors } = parseRun(rec);
  const texts = parsedTexts ?? (final ? [final] : []);
  // A run that hit an API error (no credit, rate limit, provider outage) says nothing about the skill.
  // A process that did not exit 0 (killed, out of memory, crashed on start) is the same. Both are marked
  // invalid and left out of pass rates, not counted as failures. The exception is a run the runner killed
  // for exceeding its time limit: a slow agent is a legitimate failure.
  if (errors.length > 0 || (rec.exit !== 0 && !rec.timedOut)) {
    return { invalid: true, invalidReason: errors[0] ?? `process exited ${rec.exit}`, pass: false, why: [], skill: false, web: 0, cli: 0, tokens, cost, final, calls, malformedToolCall: false };
  }
  const cli = calls.filter(isCliCall);
  const cmds = cli.map((c) => c.cmd).join(" ").toLowerCase();
  const web = calls.filter(isWebCall);
  if (rec.timedOut) {
    return { invalid: false, pass: false, why: ["timed out"], skill: calls.some((c) => c.tool === "skill"), web: web.length, cli: cli.length, tokens, cost, final, calls, malformedToolCall: false };
  }
  const cliOuts = cli.filter(cliOk).map((c) => c.out);
  const f = final.toLowerCase();
  const why = [];
  const requiresCli = ["S1", "S2", "S3", "S4", "S5", "S7", "S8", "S9", "S10"].includes(rec.id);
  const malformedToolCall = final.includes("<function=") || final.includes("<tool_call>") || (requiresCli && calls.length === 0);
  if (malformedToolCall) {
    return { invalid: false, pass: false, why: ["malformed tool call, never ran"], skill: false, web: web.length, cli: 0, tokens, cost, final, calls, malformedToolCall };
  }
  const need = (ok, msg) => ok || why.push(msg);
  // Every URL in the answer must appear verbatim in the output of a CLI call that worked. Skill instruction text and
  // web pages do not count. With no URL in the answer, S1 fails; S2 and S8 pass only if the answer says nothing
  // matched or names a role the CLI returned.
  const urlsOk = ({ linksRequired }) => {
    need(cliOuts.length > 0, "CLI output is empty or an error");
    const known = new Set(cliOuts.flatMap(urlsIn));
    const urls = urlsIn(final);
    const bad = urls.find((u) => !known.has(u));
    need(!bad, `URL not in tool output: ${bad}`);
    if (urls.length) return;
    if (linksRequired) return need(false, "answer has no URLs");
    const titles = cliOuts.flatMap((o) => [...o.matchAll(/\[([^\]\n]{3,})\]\(https?:/g), ...o.matchAll(/"title":\s*"([^"\n]{3,})"/g)].map((m) => normTitle(m[1])));
    const said = normTitle(final);
    need(NONE_MATCHED.test(final) || titles.some((t) => t && said.includes(t)), "answer has no URLs and neither says nothing matched nor names a returned role");
  };
  // S7 and S9: the CLI must have run for this company, said it has no board, and the answer must quote that.
  const cannotRead = (name) => {
    const ran = cli.filter((c) => c.cmd.toLowerCase().includes(name.toLowerCase()));
    need(ran.length > 0, `CLI never run for ${name}`);
    need(ran.some((c) => /no job board/i.test(c.out)), "CLI output does not say no job board found");
    need(SENTINEL_TEST.test(final) && SENTINEL_TEST2.test(final), "answer lacks the quoted cannot-check sentence");
  };
  // Any hiring claim in any assistant text, with the sentinel and neutral phrases removed first.
  const noClaims = (id, names) => {
    const hit = texts.map((t) => hiringClaim(t, names)).find(Boolean);
    need(!hit, `${id} possible hiring claim from memory: "${hit}"`);
  };
  switch (rec.id) {
    case "S0": {
      need(namedUnnegated(final, "job-board"), "did not name job-board");
      break;
    }
    case "S1":
      need(cmds.includes("--company") && cmds.includes("ramp"), "no CLI search for Ramp");
      need(!web.length, "used web tools");
      urlsOk({ linksRequired: true });
      break;
    case "S2":
      need(cmds.includes("ramp") && cmds.includes("figma") && cmds.includes("--remote"), "CLI missing Ramp/Figma/--remote");
      need(!web.length, "used web tools");
      urlsOk({ linksRequired: false });
      break;
    case "S3": {
      need(cmds.includes("--check") && cmds.includes("notion"), "no --check Notion");
      need(!web.length, "used web tools");
      const outs = calls.map((c) => c.out).join(" ");
      const ns = [...outs.matchAll(/"open_roles":\s*(\d+)/g), ...outs.matchAll(/(\d+) open roles/g)].map((m) => Number(m[1]));
      need(!ns.length || final.includes(String(Math.max(...ns))), "total open-role count not in answer");
      break;
    }
    case "S4": {
      const ran = cli.filter((c) => c.cmd.toLowerCase().includes("--list-boards") && c.cmd.toLowerCase().includes("notion"));
      need(ran.length > 0, "no --list-boards Notion");
      const out = ran.filter(cliOk).map((c) => c.out).join("\n");
      need(ran.length === 0 || out !== "", "--list-boards output is empty or an error");
      const ats = [...new Set([...out.matchAll(/\b(greenhouse|lever|ashby|smartrecruiters|bamboohr)\b/gi)].map((m) => m[1].toLowerCase()))];
      if (out) need(ats.length > 0, "--list-boards output names no ATS for Notion");
      // The ATS and Notion (or its slug) must share a sentence, with no negation before the ATS name.
      const said = ats.some((a) => final.replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+|\n+/).some((sentence) => /notion/i.test(sentence) && namedUnnegated(sentence, a)));
      if (ats.length) need(said, `did not say Notion is on ${ats.join("/")} in a non-negated statement`);
      break;
    }
    case "S5":
      need(cmds.includes("--queries"), "did not use --queries");
      need(f.includes("site:"), "no site: queries in answer");
      need(/site:[^\n]*stripe/i.test(final), "no site: query names Stripe");
      break;
    case "S6": {
      need(!cli.length, "ran the CLI with no companies");
      need(!web.length, "used web tools");
      need(final.includes("?"), "did not ask a question");
      const named = namedEmployers(final);
      need(!named.length, `named companies of its own: ${[...new Set(named)].join(", ")}`);
      break;
    }
    case "S7":
      need(!web.length, "used web tools");
      cannotRead("Amazon");
      noClaims("S7", ["amazon"]);
      break;
    case "S8":
      need(cmds.includes("stripe") && /--location|--seniority|--max-age-days/.test(cmds), "CLI missing Stripe/filters");
      need(!web.length, "used web tools");
      urlsOk({ linksRequired: false });
      break;
    case "S9":
      need(!web.length, "used web tools");
      cannotRead("Zzqxv");
      noClaims("S9", ["zzqxv"]);
      need(!texts.some((t) => /(?<![\d.])\b[1-9]\d*\s+(open\s+)?(roles?|openings?|positions?|jobs?)\b(?![\s-]*boards?\b)/i.test(t)), "invented a count");
      break;
    case "S10": {
      const html = cli.filter((c) => c.cmd.toLowerCase().includes("--format html"));
      need(html.length > 0, "did not use --format html");
      const markup = /<!doctype|<html/i;
      const printed = html.some((c) => markup.test(c.out)) || markup.test(final);
      // A redirect to a file shows no HTML itself; trust it only when the call's output has no error text.
      const saved = html.some((c) => /(?<![\d&])>\s*(?!&)[^\s&|]+/.test(c.cmd) && !FILE_ERROR.test(c.out));
      need(html.length === 0 || printed || saved, "no HTML produced or saved");
      break;
    }
  }
  need(final.trim() !== "", "empty final answer");
  return {
    invalid: false,
    pass: why.length === 0,
    why,
    skill: calls.some((c) => c.tool === "skill"),
    web: web.length,
    cli: cli.length,
    tokens,
    cost,
    final,
    calls,
    malformedToolCall,
  };
}
