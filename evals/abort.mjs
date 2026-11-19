// Decides from a finished run's output whether the provider rejected the key or the credit, so the matrix should stop.
// Only structured error events count. Text elsewhere in the stream (tool output, model prose, web pages) never does.
const FATAL = new Set([401, 402, 403]);

function* events(stdout) {
  for (const line of String(stdout).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

// kind: "opencode" (default), "claude" or "pi". Returns the status code or null.
export function fatalStatus(stdout, kind = "opencode") {
  for (const e of events(stdout)) {
    let code = null;
    if (kind === "opencode") {
      if (e.type === "error") code = e.error?.data?.statusCode;
    } else if (kind === "claude") {
      if (e.type === "result") code = e.api_error_status;
    } else if (kind === "pi") {
      const m = e.type === "message_end" ? e.message : null;
      if (m?.stopReason === "error") code = /^\s*(\d{3})\b/.exec(String(m.errorMessage ?? ""))?.[1];
    }
    if (FATAL.has(Number(code))) return Number(code);
  }
  return null;
}
