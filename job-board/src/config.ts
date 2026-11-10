/**
 * Configuration, driven entirely by environment variables so the skill can be
 * dropped into any harness without a config file.
 */

export const DEFAULT_UA = "job-board/2.0 (+https://github.com/)";

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

/** Request timeout in seconds. */
export const HTTP_TIMEOUT_VAR = "LAID_OFF_HTTP_TIMEOUT";
export const LEGACY_HTTP_TIMEOUT_VAR = "JOBSEARCH_HTTP_TIMEOUT";

/** ATS response cache: seconds to reuse, and where to store it. */
export const CACHE_TTL_VAR = "LAID_OFF_CACHE_TTL";
export const LEGACY_CACHE_TTL_VAR = "JOBSEARCH_CACHE_TTL";
export const CACHE_DIR_VAR = "LAID_OFF_CACHE_DIR";
export const LEGACY_CACHE_DIR_VAR = "JOBSEARCH_CACHE_DIR";

/**
 * Read a variable, preferring its current name.
 *
 * Every renamed variable on this skill follows the same rule: the current name
 * wins, the former name still works but warns, and both set to different values
 * is a conflict rather than a guess. One helper keeps the three renames from
 * drifting into three slightly different behaviours.
 */
export function readRenamed(
  env: Record<string, string | undefined>,
  currentName: string,
  legacyName: string,
): { value: string | null; warning: string | null; error: string | null } {
  const current = env[currentName];
  const legacy = env[legacyName];

  if (current !== undefined && current !== "" && legacy !== undefined && legacy !== "" && current !== legacy) {
    return {
      value: current,
      warning: null,
      error:
        `Both ${currentName} (${current}) and ${legacyName} (${legacy}) are set. ` +
        `Remove one -- they disagree.`,
    };
  }

  if (current !== undefined && current !== "") return { value: current, warning: null, error: null };
  if (legacy !== undefined && legacy !== "") {
    return {
      value: legacy,
      warning: `${legacyName} is deprecated and will be removed; rename it to ${currentName}.`,
      error: null,
    };
  }
  return { value: null, warning: null, error: null };
}

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

/**
 * Parse a numeric setting.
 *
 * `Number("abc")` is NaN, which would surface far from its cause as an
 * `AbortSignal.timeout` failure mid-request. Reject it here with a message that
 * names the variable.
 */
function readNumber(
  raw: string | null,
  variable: string,
  fallback: number,
  { allowZero = false } = {},
): { value: number; error: string | null } {
  if (raw === null) return { value: fallback, error: null };
  const parsed = Number(raw);
  const valid = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    return {
      value: fallback,
      error:
        `${variable} must be a ${allowZero ? "non-negative" : "positive"} number, ` +
        `got '${raw}'.`,
    };
  }
  return { value: parsed, error: null };
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  const { key, warning } = readApiKey(env);
  const provider = readProvider(env);
  const timeout = readRenamed(env, HTTP_TIMEOUT_VAR, LEGACY_HTTP_TIMEOUT_VAR);
  const ttl = readRenamed(env, CACHE_TTL_VAR, LEGACY_CACHE_TTL_VAR);
  const dir = readRenamed(env, CACHE_DIR_VAR, LEGACY_CACHE_DIR_VAR);

  const warnings = [warning, provider.warning, timeout.warning, ttl.warning, dir.warning].filter(
    (w): w is string => w !== null,
  );

  // cache_ttl 0 means "disabled", so zero is legitimate there but not for a timeout.
  const httpTimeout = readNumber(timeout.value, HTTP_TIMEOUT_VAR, 20);
  const cacheTtl = readNumber(ttl.value, CACHE_TTL_VAR, 0, { allowZero: true });

  // First fatal problem wins; they are all configuration errors of the same kind.
  const error =
    provider.error ?? timeout.error ?? ttl.error ?? dir.error ?? httpTimeout.error ?? cacheTtl.error;

  return {
    search_provider: provider.provider,
    search_api_key: key,
    http_timeout: httpTimeout.value,
    cache_ttl: cacheTtl.value,
    cache_dir: dir.value ?? defaultCacheDir(),
    warnings,
    error,
  };
}

function defaultCacheDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return `${home}/.cache/job-board`;
}
