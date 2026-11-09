/**
 * Global test setup: forbid real network access.
 *
 * The default `npm test` run must never touch a live API. Relying on a vitest
 * `exclude` entry was too weak: one stray import or a forgotten gate, and the
 * suite silently starts hitting production endpoints — slow, flaky, and rude to
 * the upstream services this skill depends on.
 *
 * So the network is blocked at the socket level. Any attempt throws a loud,
 * named error that tells the author what to do instead:
 *
 *   - stub the call (`vi.spyOn`), or
 *   - move the test into `tests-ts/live/`, which this file permits only when
 *     JOBSEARCH_LIVE_TESTS=1 is set *and* known hosts are allow-listed.
 */

import { afterAll, beforeAll } from "vitest";

/**
 * Marker so callers can distinguish "the test guard blocked this" from a real
 * network failure. The HTTP layer checks for it and fails fast instead of
 * retrying with backoff -- a guard violation is not transient.
 */
export class NetworkGuardError extends Error {
  readonly isNetworkGuard = true;
  constructor(message: string) {
    super(message);
    this.name = "NetworkGuardError";
  }
}

/** Hosts the live suite is allowed to reach, and only under the live flag. */
const LIVE_HOSTS = [
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.ashbyhq.com",
  "api.smartrecruiters.com",
  "bamboohr.com",
  "kagi.com",
  "api.search.brave.com",
];

/** Hosts that must NEVER be contacted, even in live mode (search engines/ATS UIs). */
const FORBIDDEN_HOSTS = ["linkedin.com", "indeed.com", "glassdoor.com"];

const live = process.env.JOBSEARCH_LIVE_TESTS === "1";

function hostOf(input: unknown): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as { url?: string })?.url ?? "";
  try {
    return new URL(raw).host;
  } catch {
    return "";
  }
}

let realFetch: typeof fetch | null = null;

beforeAll(() => {
  realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input);

    const forbidden = FORBIDDEN_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
    if (forbidden) {
      throw new NetworkGuardError(
        `Network guard: refusing to contact ${forbidden}. Tests must never call ` +
          `search engines or ATS web UIs.`,
      );
    }

    if (live) {
      const allowed = LIVE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
      if (!allowed) {
        throw new NetworkGuardError(
          `Network guard: ${host} is not in LIVE_HOSTS. Add it deliberately if a ` +
            `live test genuinely needs it.`,
        );
      }
      return realFetch!(input, init);
    }

    throw new NetworkGuardError(
      `Network guard: blocked a real request to ${host || "(unknown host)"}.\n` +
        `The default test suite must not touch live APIs.\n` +
        `Fix: stub it with vi.spyOn(...), or move the test under tests-ts/live/ ` +
        `and run it with JOBSEARCH_LIVE_TESTS=1.`,
    );
  }) as typeof fetch;
});

afterAll(() => {
  if (realFetch) globalThis.fetch = realFetch;
});
