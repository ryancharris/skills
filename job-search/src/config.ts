/**
 * Configuration, driven entirely by environment variables so the skill can be
 * dropped into any harness without a config file.
 *
 * Ported from jobsearch/config.py. Variable names and defaults must match.
 */

export const DEFAULT_UA = "job-search-skill/2.0 (+https://github.com/)";

export interface Config {
  search_provider: string;
  search_api_key: string | null;
  http_timeout: number;
  /** Seconds to cache ATS responses; 0 disables caching entirely. */
  cache_ttl: number;
  cache_dir: string;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  return {
    search_provider: (env.JOBSEARCH_SEARCH_PROVIDER ?? "kagi").toLowerCase(),
    search_api_key: env.SEARCH_API_KEY || null,
    http_timeout: Number(env.JOBSEARCH_HTTP_TIMEOUT ?? "20"),
    cache_ttl: Number(env.JOBSEARCH_CACHE_TTL ?? "0"),
    cache_dir: env.JOBSEARCH_CACHE_DIR ?? defaultCacheDir(),
  };
}

function defaultCacheDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return `${home}/.cache/jobsearch`;
}
