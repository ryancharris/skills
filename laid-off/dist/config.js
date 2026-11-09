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
/**
 * Read the search API key, preferring the current variable name.
 *
 * Returns the key plus a deprecation warning when only the legacy name is set.
 */
export function readApiKey(env = process.env) {
    const current = env[API_KEY_VAR];
    if (current)
        return { key: current, warning: null };
    const legacy = env[LEGACY_API_KEY_VAR];
    if (legacy) {
        return {
            key: legacy,
            warning: `${LEGACY_API_KEY_VAR} is deprecated and will be removed; rename it to ` +
                `${API_KEY_VAR}.`,
        };
    }
    return { key: null, warning: null };
}
export function configFromEnv(env = process.env) {
    const { key, warning } = readApiKey(env);
    return {
        search_provider: (env.JOBSEARCH_SEARCH_PROVIDER ?? "kagi").toLowerCase(),
        search_api_key: key,
        http_timeout: Number(env.JOBSEARCH_HTTP_TIMEOUT ?? "20"),
        cache_ttl: Number(env.JOBSEARCH_CACHE_TTL ?? "0"),
        cache_dir: env.JOBSEARCH_CACHE_DIR ?? defaultCacheDir(),
        warnings: warning ? [warning] : [],
    };
}
function defaultCacheDir() {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return `${home}/.cache/jobsearch`;
}
