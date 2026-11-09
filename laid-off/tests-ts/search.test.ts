/**
 * Search-provider tests with the network mocked.
 *
 * Ported from tests/test_search.py. The Kagi fixtures reproduce the LIVE v1
 * envelope: `data` is an OBJECT with a `search` list, not the legacy list of
 * typed objects. Assuming otherwise made the provider non-functional in
 * production while its own mocks happily agreed with the bug.
 */

import { describe, expect, it, vi } from "vitest";

import { configFromEnv } from "../src/config.js";
import { HttpError, getJson, request } from "../src/http.js";
import * as search from "../src/search.js";

const LIVE_KAGI_PAYLOAD = {
  meta: { trace: "014fb", ms: 786, node: "us-central1" },
  data: {
    search: [
      {
        url: "https://jobs.ashbyhq.com/middesk/0a706e5b",
        title: "Chief of Staff @ Middesk",
        snippet:
          "As <strong>Chief</strong> of <strong>Staff</strong>, you&#39;ll work directly with our CEO",
        time: "2026-11-08T14:20:48Z",
        props: { language: "en", group_id: "jobs.ashbyhq.com" },
      },
      {
        url: "https://jobs.ashbyhq.com/haydenai/1629ef11",
        title: "Chief of Staff @ Hayden AI",
        snippet: "Lead strategy.",
        time: "2026-11-01T00:00:00Z",
        props: { group_id: "jobs.ashbyhq.com" },
      },
    ],
  },
};

const mockPost = (payload: unknown, status = 200) =>
  vi.spyOn(search as unknown as Record<string, never>, "postJson" as never).mockResolvedValue({
    status,
    payload,
  } as never);

describe("config", () => {
  it("defaults to kagi with no key", () => {
    const cfg = configFromEnv({});
    expect(cfg.search_provider).toBe("kagi");
    expect(cfg.search_api_key).toBeNull();
  });

  it("reads LAID_OFF_SEARCH_API_KEY", () => {
    const cfg = configFromEnv({ LAID_OFF_SEARCH_API_KEY: "k" });
    expect(cfg.search_api_key).toBe("k");
    expect(cfg.warnings).toEqual([]);
  });

  it("still accepts the legacy SEARCH_API_KEY but warns", () => {
    // A real key was configured under this name before the rename. Dropping it
    // silently would look identical to "no key set".
    const cfg = configFromEnv({ SEARCH_API_KEY: "legacy" });
    expect(cfg.search_api_key).toBe("legacy");
    expect(cfg.warnings).toHaveLength(1);
    expect(cfg.warnings[0]).toContain("SEARCH_API_KEY is deprecated");
    expect(cfg.warnings[0]).toContain("LAID_OFF_SEARCH_API_KEY");
  });

  it("prefers the new name when both are set, without warning", () => {
    const cfg = configFromEnv({
      LAID_OFF_SEARCH_API_KEY: "new",
      SEARCH_API_KEY: "legacy",
    });
    expect(cfg.search_api_key).toBe("new");
    expect(cfg.warnings).toEqual([]);
  });

  it("has no key and no warning when neither is set", () => {
    const cfg = configFromEnv({});
    expect(cfg.search_api_key).toBeNull();
    expect(cfg.warnings).toEqual([]);
  });

  it("ignores legacy provider key vars", () => {
    const cfg = configFromEnv({ KAGI_API_KEY: "k", BRAVE_API_KEY: "b" });
    expect(cfg.search_api_key).toBeNull();
  });

  it("meters timeouts and cache settings", () => {
    const cfg = configFromEnv({
      JOBSEARCH_HTTP_TIMEOUT: "5",
      JOBSEARCH_CACHE_TTL: "300",
      JOBSEARCH_CACHE_DIR: "/tmp/x",
    });
    expect(cfg.http_timeout).toBe(5);
    expect(cfg.cache_ttl).toBe(300);
    expect(cfg.cache_dir).toBe("/tmp/x");
  });
});

describe("search provider variable", () => {
  it("reads LAID_OFF_SEARCH_PROVIDER", () => {
    const cfg = configFromEnv({ LAID_OFF_SEARCH_PROVIDER: "brave" });
    expect(cfg.search_provider).toBe("brave");
    expect(cfg.warnings).toEqual([]);
    expect(cfg.error).toBeNull();
  });

  it("defaults to kagi when unset", () => {
    expect(configFromEnv({}).search_provider).toBe("kagi");
  });

  it("is case-insensitive", () => {
    expect(configFromEnv({ LAID_OFF_SEARCH_PROVIDER: "Brave" }).search_provider).toBe("brave");
  });

  it("still accepts the legacy JOBSEARCH_SEARCH_PROVIDER but warns", () => {
    // It lived under a different prefix from the API key, so remembering one
    // gave no hint of the other.
    const cfg = configFromEnv({ JOBSEARCH_SEARCH_PROVIDER: "brave" });
    expect(cfg.search_provider).toBe("brave");
    expect(cfg.warnings).toHaveLength(1);
    expect(cfg.warnings[0]).toContain("JOBSEARCH_SEARCH_PROVIDER is deprecated");
    expect(cfg.warnings[0]).toContain("LAID_OFF_SEARCH_PROVIDER");
  });

  it("prefers the new name when both agree, without warning", () => {
    const cfg = configFromEnv({
      LAID_OFF_SEARCH_PROVIDER: "brave",
      JOBSEARCH_SEARCH_PROVIDER: "brave",
    });
    expect(cfg.search_provider).toBe("brave");
    expect(cfg.warnings).toEqual([]);
    expect(cfg.error).toBeNull();
  });

  it("is a fatal error when both are set and disagree", () => {
    const cfg = configFromEnv({
      LAID_OFF_SEARCH_PROVIDER: "brave",
      JOBSEARCH_SEARCH_PROVIDER: "kagi",
    });
    expect(cfg.error).toContain("disagree");
    expect(cfg.error).toContain("kagi");
    expect(cfg.error).toContain("brave");
  });

  it("rejects an unknown provider instead of silently falling back", () => {
    // Falling back would send searches to the wrong engine and bill the wrong
    // account, so this must be an error, not a default.
    const cfg = configFromEnv({ LAID_OFF_SEARCH_PROVIDER: "nonsense" });
    expect(cfg.error).toContain("Unknown search provider");
    expect(cfg.error).toContain("LAID_OFF_SEARCH_PROVIDER");
    expect(cfg.error).toContain("kagi, brave");
  });

  it("collects warnings from both key and provider together", () => {
    const cfg = configFromEnv({
      SEARCH_API_KEY: "k",
      JOBSEARCH_SEARCH_PROVIDER: "brave",
    });
    expect(cfg.warnings).toHaveLength(2);
  });
});

describe("buildProvider", () => {
  it("rejects an unknown provider", () => {
    expect(() => search.buildProvider({ ...configFromEnv({}), search_provider: "nope" })).toThrow(
      /Unknown search provider/,
    );
  });

  it("selects brave", () => {
    const provider = search.buildProvider({ ...configFromEnv({ LAID_OFF_SEARCH_API_KEY: "b" }), search_provider: "brave" });
    expect(provider.name).toBe("brave");
  });

  it("one key reaches either provider", () => {
    const kagi = search.buildProvider(configFromEnv({ LAID_OFF_SEARCH_API_KEY: "test-key" }));
    expect(kagi.name).toBe("kagi");
    const brave = search.buildProvider({
      ...configFromEnv({ LAID_OFF_SEARCH_API_KEY: "test-key" }),
      search_provider: "brave",
    });
    expect(brave.name).toBe("brave");
  });
});

describe("KagiProvider", () => {
  it("requires a key", () => {
    expect(() => new search.KagiProvider(null)).toThrow(/LAID_OFF_SEARCH_API_KEY/);
  });

  it("parses the live v1 shape", async () => {
    const postJson = vi.fn().mockResolvedValue({ status: 200, payload: LIVE_KAGI_PAYLOAD });
    const provider = new search.KagiProvider("test-key");
    // Inject the mock at module boundary.
    vi.spyOn(await import("../src/http.js"), "postJson").mockImplementation(postJson);

    const results = await provider.search('site:jobs.ashbyhq.com ("chief of staff" OR "CoS")');
    expect(postJson).toHaveBeenCalledOnce();
    expect(results).toHaveLength(2);
    expect(results[0]?.title).toBe("Chief of Staff @ Middesk");
    expect(results[0]?.url).toContain("ashbyhq.com/middesk");
    vi.restoreAllMocks();
  });

  it("strips highlight markup and entities from snippets", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({
      status: 200,
      payload: LIVE_KAGI_PAYLOAD,
    });
    const results = await new search.KagiProvider("k").search("q");
    const snippet = results[0]?.snippet ?? "";
    expect(snippet).not.toContain("<strong>");
    expect(snippet).not.toContain("&#39;");
    expect(snippet).toContain("you'll");
    vi.restoreAllMocks();
  });

  it("respects the limit", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({
      status: 200,
      payload: LIVE_KAGI_PAYLOAD,
    });
    expect(await new search.KagiProvider("k").search("q", 1)).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("tolerates empty and odd payload shapes", async () => {
    for (const payload of [
      { data: {} },
      { data: { search: [] } },
      { data: null },
      { data: { search: ["not a dict", { no_url: 1 }] } },
      {},
    ]) {
      vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({ status: 200, payload });
      expect(await new search.KagiProvider("k").search("q")).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  it("accepts the legacy list shape without depending on it", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({
      status: 200,
      payload: { data: [{ url: "https://x/1", title: "T", snippet: "s" }] },
    });
    expect((await new search.KagiProvider("k").search("q")).map((r) => r.url)).toEqual(["https://x/1"]);
    vi.restoreAllMocks();
  });

  it("surfaces API errors instead of returning empty", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({
      status: 400,
      payload: { meta: {}, data: null, errors: [{ code: "general.invalid_token", message: "Token signature failed" }] },
    });
    await expect(new search.KagiProvider("bad").search("q")).rejects.toThrow(/invalid_token|Token signature/);
    vi.restoreAllMocks();
  });

  it("reports a missing key without leaking the raw body", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockRejectedValue(
      new HttpError("u", 401, ""),
    );
    await expect(new search.KagiProvider("k").search("q")).rejects.toThrow(/no API key sent.*LAID_OFF_SEARCH_API_KEY/);
    vi.restoreAllMocks();
  });

  it("maps invalid_token to an actionable message with no JSON leak", async () => {
    const body = JSON.stringify({
      meta: { trace: "x" },
      data: null,
      errors: [{ code: "general.invalid_token", message: "Token signature failed to verify." }],
    });
    vi.spyOn(await import("../src/http.js"), "postJson").mockRejectedValue(new HttpError("u", 400, body));
    const err = await new search.KagiProvider("k").search("q").catch((e: Error) => e);
    expect(err.message).toContain("LAID_OFF_SEARCH_API_KEY");
    expect(err.message).not.toContain("{");
    vi.restoreAllMocks();
  });

  it("maps 402 to billing and 429 to rate limit", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockRejectedValue(
      new HttpError("u", 402, "insufficient balance"),
    );
    await expect(new search.KagiProvider("k").search("q")).rejects.toThrow(/balance exhausted/);
    vi.restoreAllMocks();

    vi.spyOn(await import("../src/http.js"), "postJson").mockRejectedValue(new HttpError("u", 429, ""));
    await expect(new search.KagiProvider("k").search("q")).rejects.toThrow(/rate limit/);
    vi.restoreAllMocks();
  });
});

describe("BraveProvider", () => {
  it("requires a key", () => {
    expect(() => new search.BraveProvider(null)).toThrow(/LAID_OFF_SEARCH_API_KEY/);
  });

  it("rejects an unauthorised key clearly", async () => {
    vi.spyOn(await import("../src/http.js"), "getJson").mockRejectedValue(new HttpError("u", 401, ""));
    await expect(new search.BraveProvider("k").search("q")).rejects.toThrow(/Brave rejected the API key/);
    vi.restoreAllMocks();
  });

  it("parses web results", async () => {
    vi.spyOn(await import("../src/http.js"), "getJson").mockResolvedValue({
      web: { results: [{ url: "https://x/1", title: "T", description: "D" }] },
    });
    const results = await new search.BraveProvider("k").search("q");
    expect(results).toEqual([{ url: "https://x/1", title: "T", snippet: "D" }]);
    vi.restoreAllMocks();
  });
});
