/**
 * HTTP client with retries, built on Node's native fetch.
 *
 * Ported from jobsearch/http.py. Node 20+ supplies `fetch` and
 * `AbortSignal.timeout`, so this stays dependency-free -- the property that lets
 * the skill run with no `npm install`.
 */

import { DEFAULT_UA } from "./config.js";
import * as cache from "./cache.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * "guard" is raised when a test network guard blocks a request. It is never
 * transient, so the HTTP layer fails fast instead of backing off.
 */
export type HttpErrorKind = "status" | "parse" | "network" | "guard";

/**
 * A request failed, or returned something we could not use.
 *
 * `kind` distinguishes the two, because reporting a JSON parse failure as
 * "HTTP 200" is actively misleading -- 200 means the request succeeded.
 * Per-tenant hosts (BambooHR) answer an unknown tenant with an HTML page.
 */
export class HttpError extends Error {
  readonly url: string;
  readonly status: number;
  readonly body: string;
  readonly kind: HttpErrorKind;

  constructor(
    url: string,
    status: number,
    body: string,
    kind: HttpErrorKind = "status",
  ) {
    super(
      kind === "parse"
        ? `unexpected non-JSON response from ${url} (HTTP ${status})`
        : kind === "guard"
          ? body
          : kind === "network"
            ? `network error for ${url}: ${body}`
            : `HTTP ${status} for ${url}: ${body.slice(0, 200)}`,
    );
    this.name = "HttpError";
    this.url = url;
    this.status = status;
    this.body = body;
    this.kind = kind;
  }

  /** True when this most likely means 'this company has no board here'. */
  get isMissingBoard(): boolean {
    return this.status === 404 || this.kind === "parse";
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  retries?: number;
  backoff?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Perform an HTTP request, retrying transient failures. */
export async function request(
  url: string,
  options: RequestOptions = {},
): Promise<{ status: number; body: string }> {
  const {
    method = "GET",
    headers = {},
    body,
    timeout = 20_000,
    retries = 3,
    backoff = 500,
  } = options;

  const hdrs: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "application/json",
    ...headers,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: hdrs,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(timeout),
      });

      const text = await response.text();
      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries - 1) {
          lastError = new HttpError(url, response.status, text);
          await sleep(backoff * 2 ** attempt);
          continue;
        }
        throw new HttpError(url, response.status, text);
      }
      return { status: response.status, body: text };
    } catch (err) {
      if (err instanceof HttpError) {
        // Retryable statuses already handled above; anything else is final.
        if (RETRYABLE_STATUS.has(err.status) && attempt < retries - 1) {
          lastError = err;
          await sleep(backoff * 2 ** attempt);
          continue;
        }
        throw err;
      }
      // A test network guard is not a transient failure: retrying would add
      // seconds of backoff and bury the actionable message. Fail immediately.
      if ((err as { isNetworkGuard?: boolean })?.isNetworkGuard) {
        throw new HttpError(url, 0, (err as Error).message, "guard");
      }

      // Network / timeout / DNS.
      lastError = err as Error;
      if (attempt < retries - 1) {
        await sleep(backoff * 2 ** attempt);
        continue;
      }
      throw new HttpError(url, 0, (err as Error)?.message ?? String(err), "network");
    }
  }

  throw lastError ?? new HttpError(url, 0, "exhausted retries", "network");
}

export interface GetJsonOptions {
  timeout?: number;
  retries?: number;
  cacheTtl?: number;
  cacheDir?: string;
  headers?: Record<string, string>;
}

/**
 * GET and parse JSON, optionally through a short-lived on-disk cache.
 *
 * Caching is opt-in via cacheTtl > 0 and is read-through only: a miss or any
 * cache error falls back to a normal request. Only GETs are cached -- POSTs
 * (the search API) are billed per call and must never be replayed silently.
 */
export async function getJson(url: string, options: GetJsonOptions = {}): Promise<unknown> {
  const { cacheTtl = 0, cacheDir = "", ...rest } = options;

  if (cacheTtl > 0) {
    const hit = await cache.get(url, { ttl: cacheTtl, cacheDir });
    if (hit !== null) return hit;
  }

  const { status, body } = await request(url, rest);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(url, status, body.slice(0, 200), "parse");
  }

  if (cacheTtl > 0) {
    await cache.put(url, parsed, { cacheDir });
  }
  return parsed;
}

/** POST JSON and return the parsed response alongside the status. */
export async function postJson(
  url: string,
  data: unknown,
  options: Omit<RequestOptions, "method" | "body"> = {},
): Promise<{ status: number; payload: unknown }> {
  const headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };
  const { status, body } = await request(url, {
    ...options,
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  try {
    return { status, payload: JSON.parse(body) };
  } catch {
    return { status, payload: body };
  }
}
