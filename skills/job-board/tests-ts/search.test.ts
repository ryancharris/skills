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

  it("reads JOB_BOARD_SEARCH_API_KEY without a warning", () => {
    const cfg = configFromEnv({ JOB_BOARD_SEARCH_API_KEY: "k" });
    expect(cfg.search_api_key).toBe("k");
    expect(cfg.warnings).toEqual([]);
  });

  it("still accepts LAID_OFF_SEARCH_API_KEY and SEARCH_API_KEY, with a warning each", () => {
    // Real keys were configured under these names before the renames. Dropping one
    // silently would look identical to "no key set".
    const former = configFromEnv({ LAID_OFF_SEARCH_API_KEY: "a" });
    expect(former.search_api_key).toBe("a");
    expect(former.warnings).toEqual([
      "LAID_OFF_SEARCH_API_KEY is deprecated and will be removed; rename it to JOB_BOARD_SEARCH_API_KEY.",
    ]);

    const legacy = configFromEnv({ SEARCH_API_KEY: "legacy" });
    expect(legacy.search_api_key).toBe("legacy");
    expect(legacy.warnings[0]).toContain("SEARCH_API_KEY is deprecated");
    expect(legacy.warnings[0]).toContain("JOB_BOARD_SEARCH_API_KEY");
  });

  it("prefers the current name and warns about every former name that is set", () => {
    const cfg = configFromEnv({
      JOB_BOARD_SEARCH_API_KEY: "new",
      LAID_OFF_SEARCH_API_KEY: "new",
    });
    expect(cfg.search_api_key).toBe("new");
    expect(cfg.warnings).toHaveLength(1);
    expect(cfg.error).toBeNull();
  });

  it("is a fatal error when two key names disagree, and never prints either key", () => {
    const cfg = configFromEnv({
      JOB_BOARD_SEARCH_API_KEY: "secret-one",
      LAID_OFF_SEARCH_API_KEY: "secret-two",
    });
    expect(cfg.error).toContain("different values");
    expect(cfg.error).toContain("JOB_BOARD_SEARCH_API_KEY");
    expect(cfg.error).toContain("LAID_OFF_SEARCH_API_KEY");
    expect(cfg.error).not.toContain("secret-one");
    expect(cfg.error).not.toContain("secret-two");
  });

  it("has no key and no warning when neither is set", () => {
    const cfg = configFromEnv({});
    expect(cfg.search_api_key).toBeNull();
    expect(cfg.warnings).toEqual([]);
  });

  it("ignores provider-specific key names", () => {
    const cfg = configFromEnv({ KAGI_API_KEY: "k", BRAVE_API_KEY: "b" });
    expect(cfg.search_api_key).toBeNull();
  });
});

describe("search provider variable", () => {
  it("reads JOB_BOARD_SEARCH_PROVIDER", () => {
    const cfg = configFromEnv({ JOB_BOARD_SEARCH_PROVIDER: "brave" });
    expect(cfg.search_provider).toBe("brave");
    expect(cfg.warnings).toEqual([]);
    expect(cfg.error).toBeNull();
  });

  it("defaults to kagi when unset", () => {
    expect(configFromEnv({}).search_provider).toBe("kagi");
  });

  it("is case-insensitive", () => {
    expect(configFromEnv({ JOB_BOARD_SEARCH_PROVIDER: "Brave" }).search_provider).toBe("brave");
  });

  it("still accepts LAID_OFF_SEARCH_PROVIDER and JOBSEARCH_SEARCH_PROVIDER, with warnings", () => {
    const former = configFromEnv({ LAID_OFF_SEARCH_PROVIDER: "brave" });
    expect(former.search_provider).toBe("brave");
    expect(former.warnings).toHaveLength(1);
    expect(former.warnings[0]).toContain("LAID_OFF_SEARCH_PROVIDER is deprecated");
    expect(former.warnings[0]).toContain("JOB_BOARD_SEARCH_PROVIDER");

    const legacy = configFromEnv({ JOBSEARCH_SEARCH_PROVIDER: "brave" });
    expect(legacy.search_provider).toBe("brave");
    expect(legacy.warnings[0]).toContain("JOBSEARCH_SEARCH_PROVIDER is deprecated");
  });

  it("uses the current name without a warning when a former name agrees with it", () => {
    const cfg = configFromEnv({
      JOB_BOARD_SEARCH_PROVIDER: "brave",
      LAID_OFF_SEARCH_PROVIDER: "brave",
    });
    expect(cfg.search_provider).toBe("brave");
    expect(cfg.warnings).toHaveLength(1);
    expect(cfg.error).toBeNull();
  });

  it("is a fatal error when two provider names disagree", () => {
    const cfg = configFromEnv({
      JOB_BOARD_SEARCH_PROVIDER: "brave",
      LAID_OFF_SEARCH_PROVIDER: "kagi",
    });
    expect(cfg.error).toContain("different values");
    expect(cfg.error).toContain("JOB_BOARD_SEARCH_PROVIDER");
    expect(cfg.error).toContain("LAID_OFF_SEARCH_PROVIDER");
  });

  it("rejects an unknown provider instead of silently falling back", () => {
    // Falling back would send searches to the wrong engine and bill the wrong
    // account, so this must be an error, not a default.
    const cfg = configFromEnv({ JOB_BOARD_SEARCH_PROVIDER: "nonsense" });
    expect(cfg.error).toContain("Unknown search provider");
    expect(cfg.error).toContain("JOB_BOARD_SEARCH_PROVIDER");
    expect(cfg.error).toContain("kagi, brave");
  });

  it("collects warnings from the key and the provider together", () => {
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
    const provider = search.buildProvider({ ...configFromEnv({ JOB_BOARD_SEARCH_API_KEY: "b" }), search_provider: "brave" });
    expect(provider.name).toBe("brave");
  });

  it("one key reaches either provider", () => {
    const kagi = search.buildProvider(configFromEnv({ JOB_BOARD_SEARCH_API_KEY: "test-key" }));
    expect(kagi.name).toBe("kagi");
    const brave = search.buildProvider({
      ...configFromEnv({ JOB_BOARD_SEARCH_API_KEY: "test-key" }),
      search_provider: "brave",
    });
    expect(brave.name).toBe("brave");
  });
});

describe("KagiProvider", () => {
  it("requires a key", () => {
    expect(() => new search.KagiProvider(null)).toThrow(/JOB_BOARD_SEARCH_API_KEY/);
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
    await expect(new search.KagiProvider("k").search("q")).rejects.toThrow(/no API key sent.*JOB_BOARD_SEARCH_API_KEY/);
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
    expect(err.message).toContain("JOB_BOARD_SEARCH_API_KEY");
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
    expect(() => new search.BraveProvider(null)).toThrow(/JOB_BOARD_SEARCH_API_KEY/);
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

describe("tunable variables use the JOB_BOARD_ prefix", () => {
  it("reads the current names", () => {
    const cfg = configFromEnv({
      JOB_BOARD_HTTP_TIMEOUT: "7",
      JOB_BOARD_CACHE_TTL: "120",
      JOB_BOARD_CACHE_DIR: "/tmp/c",
    });
    expect(cfg.http_timeout).toBe(7);
    expect(cfg.cache_ttl).toBe(120);
    expect(cfg.cache_dir).toBe("/tmp/c");
    expect(cfg.warnings).toEqual([]);
    expect(cfg.error).toBeNull();
  });

  it("defaults when unset", () => {
    const cfg = configFromEnv({});
    expect(cfg.http_timeout).toBe(20);
    expect(cfg.cache_ttl).toBe(0);
    expect(cfg.cache_dir).toContain(".cache/job-board");
  });

  it("still accepts each former name, with a warning naming both", () => {
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ LAID_OFF_HTTP_TIMEOUT: "7" }, "LAID_OFF_HTTP_TIMEOUT", "JOB_BOARD_HTTP_TIMEOUT"],
      [{ JOBSEARCH_HTTP_TIMEOUT: "7" }, "JOBSEARCH_HTTP_TIMEOUT", "JOB_BOARD_HTTP_TIMEOUT"],
      [{ LAID_OFF_CACHE_TTL: "60" }, "LAID_OFF_CACHE_TTL", "JOB_BOARD_CACHE_TTL"],
      [{ JOBSEARCH_CACHE_TTL: "60" }, "JOBSEARCH_CACHE_TTL", "JOB_BOARD_CACHE_TTL"],
      [{ LAID_OFF_CACHE_DIR: "/tmp/x" }, "LAID_OFF_CACHE_DIR", "JOB_BOARD_CACHE_DIR"],
      [{ JOBSEARCH_CACHE_DIR: "/tmp/x" }, "JOBSEARCH_CACHE_DIR", "JOB_BOARD_CACHE_DIR"],
    ];
    for (const [env, former, current] of cases) {
      const cfg = configFromEnv(env);
      expect(cfg.error).toBeNull();
      expect(cfg.warnings).toEqual([
        `${former} is deprecated and will be removed; rename it to ${current}.`,
      ]);
    }
  });

  it("uses the current name when a former name agrees, and warns about the former", () => {
    const cfg = configFromEnv({ JOB_BOARD_HTTP_TIMEOUT: "9", LAID_OFF_HTTP_TIMEOUT: "9" });
    expect(cfg.http_timeout).toBe(9);
    expect(cfg.warnings).toHaveLength(1);
    expect(cfg.error).toBeNull();
  });

  it("errors when names disagree", () => {
    const cfg = configFromEnv({ JOB_BOARD_CACHE_TTL: "60", LAID_OFF_CACHE_TTL: "30" });
    expect(cfg.error).toContain("different values");
    expect(cfg.error).toContain("JOB_BOARD_CACHE_TTL");
  });

  it("rejects a non-numeric timeout instead of producing NaN", () => {
    // Number("abc") is NaN, which used to surface far from its cause as an
    // AbortSignal failure mid-request.
    const cfg = configFromEnv({ JOB_BOARD_HTTP_TIMEOUT: "abc" });
    expect(cfg.error).toContain("JOB_BOARD_HTTP_TIMEOUT");
    expect(cfg.error).toContain("positive number");
    expect(Number.isNaN(cfg.http_timeout)).toBe(false);
  });

  it("rejects a zero or negative timeout", () => {
    for (const bad of ["0", "-1"]) {
      const cfg = configFromEnv({ JOB_BOARD_HTTP_TIMEOUT: bad });
      expect(cfg.error).toContain("positive number");
    }
  });

  it("allows a zero cache ttl, which means disabled", () => {
    const cfg = configFromEnv({ JOB_BOARD_CACHE_TTL: "0" });
    expect(cfg.cache_ttl).toBe(0);
    expect(cfg.error).toBeNull();
  });

  it("rejects a negative cache ttl", () => {
    const cfg = configFromEnv({ JOB_BOARD_CACHE_TTL: "-5" });
    expect(cfg.error).toContain("non-negative");
  });

  it("collects every deprecation at once", () => {
    const cfg = configFromEnv({
      SEARCH_API_KEY: "k",
      JOBSEARCH_SEARCH_PROVIDER: "brave",
      JOBSEARCH_HTTP_TIMEOUT: "7",
      JOBSEARCH_CACHE_TTL: "60",
      JOBSEARCH_CACHE_DIR: "/tmp/x",
    });
    expect(cfg.warnings).toHaveLength(5);
    expect(cfg.error).toBeNull();
  });
});

/**
 * BraveProvider against the contract in Brave's documentation
 * (api-dashboard.search.brave.com, web search, checked 2026-11-11):
 *   GET https://api.search.brave.com/res/v1/web/search?q=...&count=N   (count: max 20)
 *   header X-Subscription-Token: <key>
 *   response {"web": {"results": [{"title", "url", "description"}]}}
 * No request is sent: getJson is replaced at the module boundary.
 */
describe("BraveProvider contract", () => {
  const DOCS_PAYLOAD = {
    web: {
      results: [
        { title: "Chief of Staff", url: "https://jobs.ashbyhq.com/acme/1", description: "Acme is hiring.", extra_snippets: ["x"] },
        { title: "Platform Engineer", url: "https://boards.greenhouse.io/acme/2", description: "Second." },
      ],
    },
  };

  it("sends the query, the count and the documented key header to the documented endpoint", async () => {
    const http = await import("../src/http.js");
    const spy = vi.spyOn(http, "getJson").mockResolvedValue(DOCS_PAYLOAD);
    await new search.BraveProvider("test-key").search("chief of staff", 5);
    expect(spy).toHaveBeenCalledOnce();
    const [url, opts] = spy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url.startsWith("https://api.search.brave.com/res/v1/web/search?")).toBe(true);
    expect(url).toContain("q=chief%20of%20staff");
    expect(url).toContain("count=5");
    expect(opts.headers["X-Subscription-Token"]).toBe("test-key");
    vi.restoreAllMocks();
  });

  it("caps count at 20, the documented maximum", async () => {
    const http = await import("../src/http.js");
    const spy = vi.spyOn(http, "getJson").mockResolvedValue({ web: { results: [] } });
    await new search.BraveProvider("k").search("q", 50);
    expect((spy.mock.calls[0] as [string])[0]).toContain("count=20");
    vi.restoreAllMocks();
  });

  it("maps web.results to url, title and snippet from description", async () => {
    vi.spyOn(await import("../src/http.js"), "getJson").mockResolvedValue(DOCS_PAYLOAD);
    const out = await new search.BraveProvider("k").search("q");
    expect(out).toEqual([
      { url: "https://jobs.ashbyhq.com/acme/1", title: "Chief of Staff", snippet: "Acme is hiring." },
      { url: "https://boards.greenhouse.io/acme/2", title: "Platform Engineer", snippet: "Second." },
    ]);
    vi.restoreAllMocks();
  });

  it("respects the caller's limit", async () => {
    vi.spyOn(await import("../src/http.js"), "getJson").mockResolvedValue(DOCS_PAYLOAD);
    expect(await new search.BraveProvider("k").search("q", 1)).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("returns no results for a payload without web.results, rather than guessing", async () => {
    vi.spyOn(await import("../src/http.js"), "getJson").mockResolvedValue({ query: { original: "q" } });
    expect(await new search.BraveProvider("k").search("q")).toEqual([]);
    vi.restoreAllMocks();
  });

  it("says the key was rejected for 401 and 403, without echoing the key", async () => {
    for (const status of [401, 403]) {
      vi.spyOn(await import("../src/http.js"), "getJson").mockRejectedValue(
        new HttpError("https://api.search.brave.com/res/v1/web/search", status, "bad token", "status"),
      );
      const err = await new search.BraveProvider("secret-value").search("q").catch((e: Error) => e);
      expect((err as Error).message).toMatch(/Brave rejected the API key/);
      expect((err as Error).message).not.toContain("secret-value");
      vi.restoreAllMocks();
    }
  });

  it("says the key was rejected for Brave's real bad-token reply (422 SUBSCRIPTION_TOKEN_INVALID)", async () => {
    // Observed: https://api.search.brave.com/res/v1/web/search with a made-up key returns
    // HTTP 422 with {"error":{"code":"SUBSCRIPTION_TOKEN_INVALID",...,"meta":{"component":"authentication"}}}
    const body = '{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID","detail":"The provided subscription token is invalid."}}';
    vi.spyOn(await import("../src/http.js"), "getJson").mockRejectedValue(
      new HttpError("https://api.search.brave.com/res/v1/web/search", 422, body, "status"),
    );
    const err = await new search.BraveProvider("secret-value").search("q").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Brave rejected the API key/);
    expect((err as Error).message).not.toContain("secret-value");
    vi.restoreAllMocks();
  });

  it("does not call a different 422 a rejected key", async () => {
    vi.spyOn(await import("../src/http.js"), "getJson").mockRejectedValue(
      new HttpError("https://api.search.brave.com/res/v1/web/search", 422, '{"error":{"code":"VALIDATION"}}', "status"),
    );
    await expect(new search.BraveProvider("k").search("q")).rejects.toThrow(/Brave search failed: HTTP 422/);
    vi.restoreAllMocks();
  });

  it("says a rate limit was hit for 429", async () => {
    vi.spyOn(await import("../src/http.js"), "getJson").mockRejectedValue(
      new HttpError("https://api.search.brave.com/res/v1/web/search", 429, "", "status"),
    );
    await expect(new search.BraveProvider("k").search("q")).rejects.toThrow(/rate limit/);
    vi.restoreAllMocks();
  });
});

/**
 * ExaProvider against the contract in Exa's documentation (docs.exa.ai, search,
 * checked 2026-11-11): POST https://api.exa.ai/search, header x-api-key, body
 * { query, type: "auto", numResults, contents: { highlights: true } }, response
 * { results: [{ title, url, highlights: [string], summary?, text? }] }.
 * No request is sent: postJson is replaced at the module boundary.
 */
describe("ExaProvider contract", () => {
  const DOCS_PAYLOAD = {
    results: [
      { title: "Chief of Staff", url: "https://jobs.ashbyhq.com/acme/1", highlights: ["Acme is hiring a CoS."], id: "x" },
      { title: "Platform Engineer", url: "https://boards.greenhouse.io/acme/2", summary: "Second summary.", text: "x" },
    ],
  };

  it("requires a key, and says where to get one", () => {
    expect(() => new search.ExaProvider(null)).toThrow(/JOB_BOARD_SEARCH_API_KEY.*dashboard\.exa\.ai/);
  });

  it("posts the query to the documented endpoint with the key header and highlights on", async () => {
    const http = await import("../src/http.js");
    const spy = vi.spyOn(http, "postJson").mockResolvedValue({ status: 200, payload: DOCS_PAYLOAD });
    await new search.ExaProvider("test-key").search("chief of staff", 5);
    expect(spy).toHaveBeenCalledOnce();
    const [url, body, opts] = spy.mock.calls[0] as [string, Record<string, unknown>, { headers: Record<string, string> }];
    expect(url).toBe("https://api.exa.ai/search");
    expect(body).toEqual({ query: "chief of staff", type: "auto", numResults: 5, contents: { highlights: true } });
    expect(opts.headers["x-api-key"]).toBe("test-key");
    vi.restoreAllMocks();
  });

  it("caps numResults at 20, below the documented maximum of 100", async () => {
    const http = await import("../src/http.js");
    const spy = vi.spyOn(http, "postJson").mockResolvedValue({ status: 200, payload: { results: [] } });
    await new search.ExaProvider("k").search("q", 50);
    expect((spy.mock.calls[0] as [string, { numResults: number }])[1].numResults).toBe(20);
    vi.restoreAllMocks();
  });

  it("maps results to url, title and a snippet: highlight first, then summary", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({ status: 200, payload: DOCS_PAYLOAD });
    expect(await new search.ExaProvider("k").search("q")).toEqual([
      { url: "https://jobs.ashbyhq.com/acme/1", title: "Chief of Staff", snippet: "Acme is hiring a CoS." },
      { url: "https://boards.greenhouse.io/acme/2", title: "Platform Engineer", snippet: "Second summary." },
    ]);
    vi.restoreAllMocks();
  });

  it("respects the caller's limit and tolerates an empty or odd payload", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({ status: 200, payload: DOCS_PAYLOAD });
    expect(await new search.ExaProvider("k").search("q", 1)).toHaveLength(1);
    vi.restoreAllMocks();
    vi.spyOn(await import("../src/http.js"), "postJson").mockResolvedValue({ status: 200, payload: { nope: 1 } });
    expect(await new search.ExaProvider("k").search("q")).toEqual([]);
    vi.restoreAllMocks();
  });

  it("says the key was rejected for a 401 INVALID_API_KEY, without echoing the key", async () => {
    const body = '{"requestId":"r","error":"Invalid API key.","tag":"INVALID_API_KEY"}';
    vi.spyOn(await import("../src/http.js"), "postJson").mockRejectedValue(
      new HttpError("https://api.exa.ai/search", 401, body, "status"),
    );
    const err = await new search.ExaProvider("secret-value").search("q").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Exa rejected the API key/);
    expect((err as Error).message).not.toContain("secret-value");
    vi.restoreAllMocks();
  });

  it("explains a 402 X402_PAYMENT_REQUIRED reply, rather than reporting a generic failure", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockRejectedValue(
      new HttpError("https://api.exa.ai/search", 402, '{"tag":"X402_PAYMENT_REQUIRED"}', "status"),
    );
    await expect(new search.ExaProvider("k").search("q")).rejects.toThrow(/Exa wants payment/);
    vi.restoreAllMocks();
  });

  it("says a rate limit was hit for 429", async () => {
    vi.spyOn(await import("../src/http.js"), "postJson").mockRejectedValue(
      new HttpError("https://api.exa.ai/search", 429, "", "status"),
    );
    await expect(new search.ExaProvider("k").search("q")).rejects.toThrow(/rate limit/);
    vi.restoreAllMocks();
  });

  it("is selected by JOB_BOARD_SEARCH_PROVIDER=exa and uses the one shared key", () => {
    const provider = search.buildProvider({ ...configFromEnv({ JOB_BOARD_SEARCH_API_KEY: "e" }), search_provider: "exa" });
    expect(provider.name).toBe("exa");
  });
});

