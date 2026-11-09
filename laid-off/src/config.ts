/**
 * Configuration, driven entirely by environment variables so the skill can be
 * dropped into any harness without a config file.
 */

export const DEFAULT_UA = "laid-off-skill/2.0 (+https://github.com/)";

/** The search API key variable. */
export const API_KEY_VAR = "LAID_OFF_SEARCH_API_KEY";

/**
 * Name accepted for backwards compatibility.
 *
 * A real key was in use under this name before the rename. Reading it silently
 * would hide the migration, so it is accepted but warns -- an unannounced
 * rename shows up as "no API key" for someone who already configured it, which
 * is indistinguishable from a bug.
 */
export const LEGACY_API_KEY_VAR = "SEARCH_API_KEY";

/** The search provider variable. */
export const PROVIDER_VAR = "LAID_OFF_SEARCH_PROVIDER";

/**
 * Former provider variable.
 *
 * It lived under a different prefix from the API key, so remembering one gave no
 * hint of the other. Accepted for compatibility, with a warning like the key.
 */
export const LEGACY_PROVIDER_VAR = "JOBSEARCH_SEARCH_PROVIDER";

export const SUPPORTED_PROVIDERS = ["kagi", "brave"] as const;

export interface Config {
  search_provider: string;
  search_api_key: string | null;
  http_timeout: number;
  /** Seconds to cache ATS responses; 0 disables caching entirely. */
  cache_ttl: number;
  cache_dir: string;
  /** Non-fatal messages collected while reading the environment. */
  warnings: string[];
  /** Fatal configuration problem (e.g. an unknown provider), or null. */
  error: string | null;
}

/**
 * Read the search API key, preferring the current variable name.
 *
 * Returns the key plus a deprecation warning when only the legacy name is set.
 */
export function readApiKey(env: Record<string, string | undefined> = process.env): {
  key: string | null;
  warning: string | null;
} {
  const current = env[API_KEY_VAR];
  if (current) return { key: current, warning: null };

  const legacy = env[LEGACY_API_KEY_VAR];
  if (legacy) {
    return {
      key: legacy,
      warning:
        `${LEGACY_API_KEY_VAR} is deprecated and will be removed; rename it to ` +
        `${API_KEY_VAR}.`,
    };
  }
  return { key: null, warning: null };
}

/**
 * Read the search provider, preferring the current variable name.
 *
 * An unrecognised value is a usage error the caller must report: silently
 * falling back to kagi would send searches to the wrong engine and bill the
 * wrong account.
 */
export function readProvider(env: Record<string, string | undefined> = process.env): {
  provider: string;
  warning: string | null;
  error: string | null;
} {
  const current = env[PROVIDER_VAR];
  const legacy = env[LEGACY_PROVIDER_VAR];
  const raw = current ?? legacy;

  if (current && legacy && current.toLowerCase() !== legacy.toLowerCase()) {
    return {
      provider: current.toLowerCase(),
      warning: null,
      error:
        `Both ${PROVIDER_VAR} (${current}) and ${LEGACY_PROVIDER_VAR} (${legacy}) ` +
        `are set. Remove one -- they disagree.`,
    };
  }

  if (!raw) {
    return { provider: "kagi", warning: null, error: null };
  }

  const provider = raw.toLowerCase();
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      provider,
      warning: null,
      error:
        `Unknown search provider '${raw}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}. ` +
        `Set ${PROVIDER_VAR}.`,
    };
  }

  const warning =
    !current && legacy
      ? `${LEGACY_PROVIDER_VAR} is deprecated and will be removed; rename it to ` +
        `${PROVIDER_VAR}.`
      : null;

  return { provider, warning, error: null };
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  const { key, warning } = readApiKey(env);
  const provider = readProvider(env);
  const warnings = [warning, provider.warning].filter((w): w is string => w !== null);
  return {
    search_provider: provider.provider,
    search_api_key: key,
    http_timeout: Number(env.JOBSEARCH_HTTP_TIMEOUT ?? "20"),
    cache_ttl: Number(env.JOBSEARCH_CACHE_TTL ?? "0"),
    cache_dir: env.JOBSEARCH_CACHE_DIR ?? defaultCacheDir(),
    warnings,
    error: provider.error,
  };
}

function defaultCacheDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return `${home}/.cache/jobsearch`;
}
