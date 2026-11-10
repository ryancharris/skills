/**
 * Configuration, driven entirely by environment variables so the skill can be
 * dropped into any harness without a config file.
 *
 * Every setting has one current name, `JOB_BOARD_*`, and any number of former
 * names that are still accepted with a deprecation warning. One reader applies
 * the same rules to every setting, so the renames cannot drift apart.
 */
export const DEFAULT_UA = "job-board/2.0 (+https://github.com/)";
export const SETTINGS = {
    apiKey: {
        current: "JOB_BOARD_SEARCH_API_KEY",
        // SEARCH_API_KEY predates the prefix; a real key was configured under it.
        former: ["LAID_OFF_SEARCH_API_KEY", "SEARCH_API_KEY"],
    },
    provider: {
        current: "JOB_BOARD_SEARCH_PROVIDER",
        former: ["LAID_OFF_SEARCH_PROVIDER", "JOBSEARCH_SEARCH_PROVIDER"],
    },
    httpTimeout: {
        current: "JOB_BOARD_HTTP_TIMEOUT",
        former: ["LAID_OFF_HTTP_TIMEOUT", "JOBSEARCH_HTTP_TIMEOUT"],
    },
    cacheTtl: {
        current: "JOB_BOARD_CACHE_TTL",
        former: ["LAID_OFF_CACHE_TTL", "JOBSEARCH_CACHE_TTL"],
    },
    cacheDir: {
        current: "JOB_BOARD_CACHE_DIR",
        former: ["LAID_OFF_CACHE_DIR", "JOBSEARCH_CACHE_DIR"],
    },
};
export const SUPPORTED_PROVIDERS = ["kagi", "brave"];
/**
 * Read one setting.
 *
 * The current name wins, then the former names in order. Each former name that
 * is set produces a warning, because an unannounced rename looks identical to
 * "no value set". Two names set to different values is an error rather than a
 * guess. The error names the variables but never prints a value: one of them may
 * be a secret.
 */
export function readSetting(env, setting, normalise = (value) => value) {
    const names = [setting.current, ...setting.former];
    const set = names.filter((name) => env[name] !== undefined && env[name] !== "");
    if (set.length === 0)
        return { value: null, warnings: [], error: null };
    const distinct = new Set(set.map((name) => normalise(env[name])));
    if (distinct.size > 1) {
        return {
            value: null,
            warnings: [],
            error: `${set.join(" and ")} are set to different values. ` +
                `Keep only ${setting.current}.`,
        };
    }
    const warnings = set
        .filter((name) => name !== setting.current)
        .map((name) => `${name} is deprecated and will be removed; rename it to ${setting.current}.`);
    // `set` is non-empty here, and all of its names agree, so the first one is the value.
    const first = set[0];
    return { value: env[first], warnings, error: null };
}
/**
 * Parse a numeric setting.
 *
 * `Number("abc")` is NaN, which would surface far from its cause as an
 * `AbortSignal.timeout` failure mid-request. Reject it here with a message that
 * names the variable.
 */
function readNumber(raw, variable, fallback, { allowZero = false } = {}) {
    if (raw === null)
        return { value: fallback, error: null };
    const parsed = Number(raw);
    const valid = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
    if (!valid) {
        return {
            value: fallback,
            error: `${variable} must be a ${allowZero ? "non-negative" : "positive"} number, ` +
                `got '${raw}'.`,
        };
    }
    return { value: parsed, error: null };
}
export function configFromEnv(env = process.env) {
    const key = readSetting(env, SETTINGS.apiKey);
    const provider = readSetting(env, SETTINGS.provider, (value) => value.toLowerCase());
    const timeout = readSetting(env, SETTINGS.httpTimeout);
    const ttl = readSetting(env, SETTINGS.cacheTtl);
    const dir = readSetting(env, SETTINGS.cacheDir);
    const reads = [key, provider, timeout, ttl, dir];
    const warnings = reads.flatMap((read) => read.warnings);
    // The provider is the one setting with a fixed set of valid values.
    let providerName = "kagi";
    let providerError = provider.error;
    if (provider.value !== null) {
        const raw = provider.value;
        providerName = raw.toLowerCase();
        if (!SUPPORTED_PROVIDERS.includes(providerName)) {
            providerError =
                `Unknown search provider '${raw}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}. ` +
                    `Set ${SETTINGS.provider.current}.`;
        }
    }
    // cache_ttl 0 means "disabled", so zero is legitimate there but not for a timeout.
    const httpTimeout = readNumber(timeout.value, SETTINGS.httpTimeout.current, 20);
    const cacheTtl = readNumber(ttl.value, SETTINGS.cacheTtl.current, 0, { allowZero: true });
    // First fatal problem wins; they are all configuration errors of the same kind.
    const error = providerError ??
        timeout.error ??
        ttl.error ??
        dir.error ??
        key.error ??
        httpTimeout.error ??
        cacheTtl.error;
    return {
        search_provider: providerName,
        search_api_key: key.value,
        http_timeout: httpTimeout.value,
        cache_ttl: cacheTtl.value,
        cache_dir: dir.value ?? defaultCacheDir(),
        warnings,
        error,
    };
}
function defaultCacheDir() {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return `${home}/.cache/job-board`;
}
