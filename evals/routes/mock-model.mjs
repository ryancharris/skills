// Test double for the Anthropic Messages API (/v1/messages) and OpenAI-style /chat/completions (what OpenRouter speaks). No model, no key: it replays a fixed script so the agent's
// own event stream can be captured offline. Usage: node mock-model.mjs <port> <script.json>
// script.json: an array of steps, one per model turn: {"tool":"Bash","input":{...}}, {"text":"..."} or {"error":402} (HTTP status).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 8787);
const script = JSON.parse(readFileSync(process.argv[3], "utf8"));
const countResults = (messages) =>
  messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result").length;

const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  res.end();
};
const head = (stop) => ["message_start", { message: { id: "msg_mock", type: "message", role: "assistant", model: "mock", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }];
const tail = (stop) => [["message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }], ["message_stop", {}]];

createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    console.error(req.method, req.url);
    let j = {};
    try { j = JSON.parse(body); } catch {}
    if (req.url.includes("/chat/completions")) {
      const out = script[Math.min(j.messages.filter((m) => m.role === "tool").length, script.length - 1)];
      if (out.error) {
        res.writeHead(out.error, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "mock: credit limit", code: out.error } }));
      }
      const chunk = (delta, finish = null, extra = {}) =>
        "data: " + JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }], ...extra }) + "\n\n";
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk({ role: "assistant", content: "" }));
      if (out.tool) res.write(chunk({ tool_calls: [{ index: 0, id: "call_" + Math.random().toString(36).slice(2, 10), type: "function", function: { name: out.tool, arguments: JSON.stringify(out.input) } }] }));
      else res.write(chunk({ content: out.text }));
      res.write(chunk({}, out.tool ? "tool_calls" : "stop"));
      res.write(chunk({}, null, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    if (!req.url.includes("/v1/messages") || req.url.includes("count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    const step = script[Math.min(countResults(j.messages ?? []), script.length - 1)];
    // Side requests (titles, classifiers) have no tools; answer them with plain text so they never consume a script step.
    const isMain = Array.isArray(j.tools) && j.tools.length > 0;
    const out = isMain ? step : { text: "ok" };
    if (out.error) {
      res.writeHead(out.error, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "billing_error", message: "mock: credit limit" } }));
    }
    if (!j.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model: "mock", content: [{ type: "text", text: out.text ?? "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
    }
    if (out.tool) {
      sse(res, [head(), ["content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_" + Math.random().toString(36).slice(2, 10), name: out.tool, input: {} } }],
        ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(out.input) } }],
        ["content_block_stop", { index: 0 }], ...tail("tool_use")]);
    } else {
      sse(res, [head(), ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { index: 0, delta: { type: "text_delta", text: out.text } }],
        ["content_block_stop", { index: 0 }], ...tail("end_turn")]);
    }
  });
}).listen(port, "127.0.0.1", () => console.error("mock listening", port));
