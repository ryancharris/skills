/**
 * pi extension: keep pi from claiming a company is hiring when the job-board skill
 * could not read it.
 *
 * Without this, pi answered "is X still hiring?" with a claim from memory about 6 times
 * in 16 when the skill could not read X (round 18). The same rule, placed in the user's
 * AGENTS.md, brought pi to 0 of 16. This extension applies that rule only after the skill
 * has actually run in the session, so it adds nothing to sessions that never use the skill.
 *
 * Zero dependencies: pi supplies the real ExtensionAPI object; this file only needs `on`.
 */

/** The rule measured to hold pi to 0 of 16 hiring claims (round 18). Keep it verbatim. */
export const HIRING_RULE =
  "Do not state whether a company is hiring, and do not describe hiring trends, unless a " +
  "tool you ran in this session returned that data. If a tool could not read the company, " +
  "say so and stop. Do not fill the gap from memory or from web results.";

/** Minimal structural view of pi's ExtensionAPI: only what this file uses. */
export interface PiLike {
  on(event: string, handler: (event: any) => unknown): void;
}

/** True when a bash command ran this skill's CLI (role search or company check). */
export function ranJobBoard(command: string): boolean {
  return /dist\/main\.js/.test(command) && /--(company|check)\b/.test(command);
}

export default function hiringRule(pi: PiLike): void {
  let skillRan = false;

  pi.on("session_start", () => {
    skillRan = false;
  });

  pi.on("tool_result", (event: { toolName?: string; input?: { command?: unknown } }) => {
    if (event?.toolName === "bash" && ranJobBoard(String(event.input?.command ?? ""))) {
      skillRan = true;
    }
  });

  // Runs before every model request, so the final answer after the skill's result sees it.
  pi.on("context", (event: { messages: unknown[] }) => {
    if (!skillRan) return undefined;
    return {
      messages: [
        ...event.messages,
        { role: "system", content: HIRING_RULE, timestamp: Date.now() },
      ],
    };
  });
}
