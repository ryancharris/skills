// Turn the event streams of other agents into what evals/grade.mjs's parseRun returns for opencode:
// { calls: [{ tool, cmd, out }], final, tokens, cost, errors }.
//
// Claude Code: `claude -p ... --output-format stream-json --verbose` (one JSON object per line, SDKMessage shapes).
// pi:          `pi --mode json ...` (one JSON object per line, session events).
// Field shapes are listed in evals/routes/README.md with how each was verified.

function lines(events) {
  const out = [];
  for (const line of String(events).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

const blocksText = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("") : "");

export function parseClaude(events) {
  const calls = [];
  const byId = new Map();
  const texts = [];
  const errors = [];
  let tokens = 0;
  let cost = 0;
  let resultText = null;
  const addError = (m) => errors.includes(m) || errors.push(m);
  for (const e of lines(events)) {
    if (e.type === "assistant") {
      const content = e.message?.content ?? [];
      // A synthetic assistant message carries the API failure text; it is an error, not an answer.
      if (e.is_api_error_message || e.error) {
        addError(blocksText(content) || String(e.error));
        continue;
      }
      for (const b of content) {
        if (b.type === "text") texts.push(b.text);
        else if (b.type === "tool_use" && !byId.has(b.id)) {
          const call = { tool: String(b.name).toLowerCase(), cmd: b.input?.command ?? JSON.stringify(b.input ?? {}), out: "" };
          byId.set(b.id, call);
          calls.push(call);
        }
      }
    } else if (e.type === "user") {
      for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (b.type === "tool_result" && byId.has(b.tool_use_id)) byId.get(b.tool_use_id).out = blocksText(b.content);
      }
    } else if (e.type === "result") {
      tokens += (e.usage?.input_tokens ?? 0) + (e.usage?.output_tokens ?? 0);
      cost += e.total_cost_usd ?? 0;
      if (typeof e.result === "string") resultText = e.result;
      if (e.is_error) addError(e.result || `api_error_status ${e.api_error_status}`);
    }
  }
  return { calls, texts, final: texts.at(-1) ?? (errors.length ? "" : resultText ?? ""), tokens, cost, errors };
}

export function parsePi(events) {
  const calls = [];
  const byId = new Map();
  const texts = [];
  let errors = [];
  let tokens = 0;
  let cost = 0;
  for (const e of lines(events)) {
    if (e.type === "tool_execution_start") {
      const args = e.args ?? {};
      // pi has no skill tool: the skill is "loaded" when the model reads its SKILL.md, so report that read as a skill call.
      const isSkill = e.toolName === "read" && /SKILL\.md$/.test(String(args.path ?? ""));
      const call = { tool: isSkill ? "skill" : e.toolName, cmd: args.command ?? JSON.stringify(args), out: "" };
      byId.set(e.toolCallId, call);
      calls.push(call);
    } else if (e.type === "tool_execution_end") {
      const call = byId.get(e.toolCallId);
      if (call) call.out = blocksText(e.result?.content);
    } else if (e.type === "message_end" && e.message?.role === "assistant") {
      const m = e.message;
      tokens += m.usage?.totalTokens ?? 0;
      cost += m.usage?.cost?.total ?? 0;
      if (m.stopReason === "error" || m.stopReason === "aborted") errors.push(m.errorMessage ?? `stopReason ${m.stopReason}`);
      else {
        const t = blocksText(m.content);
        if (t) texts.push(t);
      }
    } else if (e.type === "auto_retry_end") {
      if (e.success) errors = [];
      else errors.push(e.finalError ?? "auto retry failed");
    }
  }
  return { calls, texts, final: texts.at(-1) ?? "", tokens, cost, errors };
}

export const adapters = { claude: parseClaude, pi: parsePi };
