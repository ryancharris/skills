// Strict, keyword-based grading of one opencode run. A run passes only if every check holds.
// S7 and S9 are matched on wording, so read their transcripts before trusting a pass.

export function parseRun(rec) {
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
// Wording that mentions hiring without claiming a status.
const NEUTRAL = [
  /(?:whether|if) [^.?!\n]{0,60}?(?:is|are) (?:currently |still |actively )?hiring/g,
  /(?:which|who|what)(?: [\w']+){0,3} (?:is|are) (?:currently |still |actively )?hiring/g,
  /(?:does not|doesn't|doesn\u2019t) mean [^.?!\n]{0,80}?(?:no|zero) (?:open |current )?(?:openings|roles|positions|jobs)/g,
];
const HIRING_CLAIMS = [
  /\b(is|are) (currently |still |actively )?hiring\b/,
  /\b(has|have) (many |lots of |thousands of )?(open|openings|roles|positions)\b/,
  /\blarge company\b/,
  /\byes\b/,
];
const HEDGE = /\b(typically|generally|usually|likely)\b/;
const ABOUT_HIRING = /\b(hir\w*|openings?|open roles?|roles|positions|jobs|recruit\w*)\b/;
export function hiringClaim(text) {
  let t = text.toLowerCase().replace(SENTINEL, " ");
  for (const re of NEUTRAL) t = t.replace(re, " ");
  const direct = HIRING_CLAIMS.map((re) => re.exec(t)?.[0]).find(Boolean);
  // A hedge word only counts as a memory claim in a sentence that is about hiring, so "usually means the name is wrong" is fine.
  const hedged = t.split(/[.!?\n]+/).map((sentence) => HEDGE.test(sentence) && ABOUT_HIRING.test(sentence) ? HEDGE.exec(sentence)[0] : null).find(Boolean);
  return direct ?? hedged;
}

export function grade(rec) {
  const { calls, texts, final, tokens, cost, errors } = parseRun(rec);
  // A run that hit an API error (no credit, rate limit, provider outage) says nothing about the skill.
  // A process that did not exit 0 (killed, out of memory, crashed on start) is the same. Both are marked
  // invalid and left out of pass rates, not counted as failures.
  if (errors.length > 0 || rec.exit !== 0) {
    return { invalid: true, invalidReason: errors[0] ?? `process exited ${rec.exit}`, pass: false, why: [], skill: false, web: 0, cli: 0, tokens, cost, final, calls, malformedToolCall: false };
  }
  const cli = calls.filter((c) => c.tool === "bash" && c.cmd.includes("dist/main.js"));
  const cmds = cli.map((c) => c.cmd).join(" ").toLowerCase();
  const web = calls.filter((c) => c.tool === "webfetch" || c.tool === "websearch" || /^browser/.test(c.tool ?? "") || (c.tool === "bash" && /\b(curl|wget)\b/.test(c.cmd)));
  const outs = calls.map((c) => c.out).join(" ");
  const f = final.toLowerCase();
  const why = [];
  const requiresCli = ["S1", "S2", "S3", "S4", "S5", "S7", "S8", "S9", "S10"].includes(rec.id);
  const malformedToolCall = final.includes("<function=") || final.includes("<tool_call>") || (requiresCli && calls.length === 0);
  if (malformedToolCall) {
    return { invalid: false, pass: false, why: ["malformed tool call, never ran"], skill: false, web: web.length, cli: 0, tokens, cost, final, calls, malformedToolCall };
  }
  const need = (ok, msg) => ok || why.push(msg);
  const urlsOk = () => {
    const urls = (final.match(/https?:\/\/[^\s)\]>"`]+/g) ?? []).map((u) => u.replace(/[.,);*`>]+$/, ""));
    const bad = urls.find((u) => !outs.includes(u.split("?")[0]));
    need(!bad, `URL not in tool output: ${bad}`);
  };
  // S7 and S9: the CLI must have run for this company, said it has no board, and the answer must quote that.
  const cannotRead = (name) => {
    const ran = cli.filter((c) => c.cmd.toLowerCase().includes(name.toLowerCase()));
    need(ran.length > 0, `CLI never run for ${name}`);
    need(ran.some((c) => /no job board/i.test(c.out)), "CLI output does not say no job board found");
    need(SENTINEL_TEST.test(final) && SENTINEL_TEST2.test(final), "answer lacks the quoted cannot-check sentence");
  };
  // Any hiring claim in any assistant text, with the sentinel and neutral phrases removed first.
  const noClaims = (id) => {
    const hit = texts.map(hiringClaim).find(Boolean);
    need(!hit, `${id} possible hiring claim from memory: "${hit}"`);
  };
  switch (rec.id) {
    case "S0":
      need(f.includes("job-board"), "did not name job-board");
      break;
    case "S1":
      need(cmds.includes("--company") && cmds.includes("ramp"), "no CLI search for Ramp");
      need(!web.length, "used web tools");
      urlsOk();
      break;
    case "S2":
      need(cmds.includes("ramp") && cmds.includes("figma") && cmds.includes("--remote"), "CLI missing Ramp/Figma/--remote");
      need(!web.length, "used web tools");
      urlsOk();
      break;
    case "S3": {
      need(cmds.includes("--check") && cmds.includes("notion"), "no --check Notion");
      need(!web.length, "used web tools");
      const ns = [...outs.matchAll(/"open_roles":\s*(\d+)/g), ...outs.matchAll(/(\d+) open roles/g)].map((m) => Number(m[1]));
      need(!ns.length || final.includes(String(Math.max(...ns))), "total open-role count not in answer");
      break;
    }
    case "S4":
      need(cmds.includes("--list-boards") && cmds.includes("notion"), "no --list-boards Notion");
      need(f.includes("ashby"), "did not say Ashby");
      break;
    case "S5":
      need(cmds.includes("--queries"), "did not use --queries");
      need(f.includes("site:"), "no site: queries in answer");
      need(/site:[^\n]*stripe/i.test(final), "no site: query names Stripe");
      break;
    case "S6":
      need(!cli.length, "ran the CLI with no companies");
      need(!web.length, "used web tools");
      need(final.includes("?"), "did not ask a question");
      break;
    case "S7":
      need(!web.length, "used web tools");
      cannotRead("Amazon");
      noClaims("S7");
      break;
    case "S8":
      need(cmds.includes("stripe") && /--location|--seniority|--max-age-days/.test(cmds), "CLI missing Stripe/filters");
      need(!web.length, "used web tools");
      urlsOk();
      break;
    case "S9":
      need(!web.length, "used web tools");
      cannotRead("Zzqxv");
      noClaims("S9");
      need(!texts.some((t) => /(?<![\d.])[1-9]\d*\s+(open\s+)?(roles?|openings?|positions?|jobs?)/i.test(t)), "invented a count");
      break;
    case "S10":
      need(cmds.includes("--format html"), "did not use --format html");
      need(f.includes("<html") || f.includes("<!doctype") || calls.some((c) => c.out.toLowerCase().includes("<html") || c.tool === "write") || /\.html/.test(final), "no HTML produced or saved");
      break;
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
