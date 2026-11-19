// Records which agent builds produced a run, so two runs are only compared knowing whether the agent changed.
import { spawnSync } from "node:child_process";

export function cliVersion(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20000 });
  if (r.error || r.status !== 0) return "unknown";
  return (r.stdout.trim().split("\n").pop() ?? "").trim() || "unknown";
}

// agents: { name: command }, e.g. { opencode: "opencode" }. node's version is always included.
export function collectVersions(agents) {
  const v = Object.fromEntries(Object.entries(agents).map(([name, cmd]) => [name, cliVersion(cmd)]));
  return { ...v, node: process.version.replace(/^v/, "") };
}
