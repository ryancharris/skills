// Keeps secrets out of results.jsonl and report.html. The agent's bash tool inherits the container's environment, so
// a model (or a prompt-injected job posting) that runs `env` would otherwise write the API key into the record.
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const MIN_LENGTH = 8;
export const MARK = "[REDACTED]";

// Every value to hide: variables whose name looks secret, plus the variables named in `extraNames`.
// Each value is also covered in its JSON-escaped form and without a pair of surrounding quotes
// (docker --env-file keeps quotes, so KEY="abc" arrives as the value "abc" with the quotes in it).
export function secretValues(env, extraNames = []) {
  const found = new Set();
  const add = (v) => {
    if (typeof v !== "string" || v.length < MIN_LENGTH) return;
    found.add(v);
    found.add(JSON.stringify(v).slice(1, -1));
    const m = /^(["'])(.*)\1$/s.exec(v);
    if (m && m[2].length >= MIN_LENGTH) {
      found.add(m[2]);
      found.add(JSON.stringify(m[2]).slice(1, -1));
    }
  };
  for (const [k, v] of Object.entries(env)) if (SECRET_NAME.test(k) || extraNames.includes(k)) add(v);
  return [...found].sort((a, b) => b.length - a.length);
}

export function redact(text, values) {
  let out = String(text ?? "");
  for (const v of values) out = out.split(v).join(MARK);
  return out;
}

// Redact first, then truncate: truncating first could cut a secret in half and leave a readable prefix.
export function redactRecord(rec, values, stderrLimit = 2000) {
  return { ...rec, events: redact(rec.events, values), stderr: redact(rec.stderr, values).slice(0, stderrLimit) };
}

// Variable names listed in REDACT_ENV (comma list) are redacted on top of the name pattern.
export const extraNamesFromEnv = (env) => (env.REDACT_ENV ?? "").split(",").map((s) => s.trim()).filter(Boolean);
