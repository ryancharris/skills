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
  return { calls, final: texts.at(-1) ?? "", tokens, cost, errors };
}

const CANNOT = /(can't|cannot|can not|could not|couldn't|unable|not able|no board|no live|not find|didn't find|did not find|found no|not supported|no supported|doesn't (use|publish|have)|does not (use|publish|have)|unknown|isn't|is not|not one of)/;

export function grade(rec) {
  const { calls, final, tokens, cost, errors } = parseRun(rec);
  // A run that hit an API error (no credit, rate limit, provider outage) says nothing about the skill.
  // A process that did not exit 0 (killed, out of memory, crashed on start) is the same. Both are marked
  // invalid and left out of pass rates, not counted as failures.
  if (errors.length > 0 || rec.exit !== 0) {
    return { invalid: true, invalidReason: errors[0] ?? `process exited ${rec.exit}`, pass: false, why: [], skill: false, web: 0, cli: 0, tokens, cost, final, calls, malformedToolCall: false };
  }
  const cli = calls.filter((c) => c.tool === "bash" && c.cmd.includes("dist/main.js"));
  const cmds = cli.map((c) => c.cmd).join(" ").toLowerCase();
  const web = calls.filter((c) => c.tool === "webfetch" || c.tool === "websearch");
  const outs = calls.map((c) => c.out).join(" ");
  const f = final.toLowerCase();
  const why = [];
  const need = (ok, msg) => ok || why.push(msg);
  const urlsOk = () => {
    const urls = (final.match(/https?:\/\/[^\s)\]>"`]+/g) ?? []).map((u) => u.replace(/[.,);*`>]+$/, ""));
    const bad = urls.find((u) => !outs.includes(u.split("?")[0]));
    need(!bad, `URL not in tool output: ${bad}`);
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
      need(CANNOT.test(f), "no cannot-read statement");
      need(!/\byes\b|still hiring[^.]*(typically|generally|usually|likely)|(typically|generally|usually|likely)[^.]*hir/.test(f) || CANNOT.test(f.slice(0, 300)), "possible claim from memory");
      break;
    case "S8":
      need(cmds.includes("stripe") && /--location|--seniority|--max-age-days/.test(cmds), "CLI missing Stripe/filters");
      need(!web.length, "used web tools");
      urlsOk();
      break;
    case "S9":
      need(!web.length, "used web tools");
      need(CANNOT.test(f), "did not say not found");
      need(!/\d+ open roles/.test(f), "invented a count");
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
    malformedToolCall: final.includes("<function=") || final.includes("<tool_call>"),
  };
}
