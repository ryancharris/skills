/**
 * Search-engine providers.
 *
 * Ported from jobsearch/search/__init__.py. The Kagi response shape is captured
 * from the LIVE v1 API, not inferred:
 *
 *   {"meta": {...}, "data": {"search": [{"url","title","snippet","time","props"}]}}
 *
 * `data` is an OBJECT with a `search` list -- not the legacy v0 list of typed
 * objects (`data: [{"t": 0, ...}]`). An earlier implementation assumed the v0
 * shape, passed its own hand-written mocks, and returned nothing against
 * production. Only a real call revealed it.
 */
import { stripHtml } from "./html.js";
import { HttpError, getJson, postJson } from "./http.js";
export class SearchError extends Error {
    constructor(message) {
        super(message);
        this.name = "SearchError";
    }
}
export class SearchProvider {
}
/** Turn a Kagi HTTP failure into one short, actionable sentence. */
function kagiHttpError(err) {
    let code = "";
    let message = "";
    try {
        const payload = JSON.parse(err.body);
        const first = payload.errors?.[0];
        if (first) {
            code = first.code ?? "";
            message = first.message ?? "";
        }
    }
    catch {
        /* body was not JSON */
    }
    if (code === "general.no_authorization_provided" || err.status === 401) {
        return "Kagi rejected the request: no API key sent. Export JOB_BOARD_SEARCH_API_KEY.";
    }
    if (code === "general.invalid_token" || (err.status === 400 && message)) {
        return ("Kagi rejected the API key (invalid_token). Check that JOB_BOARD_SEARCH_API_KEY " +
            "is complete and has no extra spaces.");
    }
    if (err.status === 402 || message.toLowerCase().includes("insufficient")) {
        return "Kagi balance exhausted. Top up at https://kagi.com/api/billing.";
    }
    if (err.status === 429) {
        return "Kagi rate limit hit. Retry shortly.";
    }
    return `Kagi search failed: ${message || `HTTP ${err.status}`}`;
}
export class KagiProvider extends SearchProvider {
    name = "kagi";
    ENDPOINT = "https://kagi.com/api/v1/search";
    apiKey;
    timeout;
    constructor(apiKey, timeout = 20_000) {
        super();
        if (!apiKey) {
            throw new SearchError("JOB_BOARD_SEARCH_API_KEY is not set. Create a Kagi key at " +
                "https://kagi.com/settings/api and export JOB_BOARD_SEARCH_API_KEY=your-key");
        }
        this.apiKey = apiKey;
        this.timeout = timeout;
    }
    async search(query, limit = 20) {
        let payload;
        try {
            ({ payload } = await postJson(this.ENDPOINT, { query }, { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: this.timeout }));
        }
        catch (err) {
            if (err instanceof HttpError)
                throw new SearchError(kagiHttpError(err));
            throw new SearchError(`Kagi search failed: ${err?.message ?? String(err)}`);
        }
        if (!payload || typeof payload !== "object") {
            throw new SearchError(`Unexpected Kagi response: ${JSON.stringify(payload)}`);
        }
        const body = payload;
        const errors = body.errors;
        if (Array.isArray(errors) && errors.length > 0) {
            const msg = errors
                .map((e) => e.message ?? e.code ?? "?")
                .join("; ");
            throw new SearchError(`Kagi API error: ${msg}`);
        }
        const data = body.data;
        let items = [];
        if (data && typeof data === "object" && !Array.isArray(data)) {
            const search = data.search;
            items = Array.isArray(search) ? search : [];
        }
        else if (Array.isArray(data)) {
            // Tolerate the legacy shape without depending on it.
            items = data;
        }
        const results = [];
        for (const item of items) {
            if (!item || typeof item !== "object")
                continue;
            const record = item;
            const url = record.url;
            if (typeof url !== "string" || !url)
                continue;
            results.push({
                url,
                title: typeof record.title === "string" ? record.title : "",
                snippet: stripHtml(typeof record.snippet === "string" ? record.snippet : ""),
            });
            if (results.length >= limit)
                break;
        }
        return results;
    }
}
export class BraveProvider extends SearchProvider {
    name = "brave";
    ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
    apiKey;
    timeout;
    constructor(apiKey, timeout = 20_000) {
        super();
        if (!apiKey) {
            throw new SearchError("JOB_BOARD_SEARCH_API_KEY is not set. Create a Brave key at " +
                "https://api.search.brave.com/ and export JOB_BOARD_SEARCH_API_KEY=your-key");
        }
        this.apiKey = apiKey;
        this.timeout = timeout;
    }
    async search(query, limit = 20) {
        const url = `${this.ENDPOINT}?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
        let payload;
        try {
            payload = await getJson(url, {
                headers: { "X-Subscription-Token": this.apiKey, Accept: "application/json" },
                timeout: this.timeout,
            });
        }
        catch (err) {
            if (err instanceof HttpError) {
                if (err.status === 401 || err.status === 403) {
                    throw new SearchError("Brave rejected the API key. Check JOB_BOARD_SEARCH_API_KEY.");
                }
                if (err.status === 429) {
                    throw new SearchError("Brave rate limit hit. Retry shortly.");
                }
                throw new SearchError(`Brave search failed: HTTP ${err.status}`);
            }
            throw new SearchError(`Brave search failed: ${err?.message ?? String(err)}`);
        }
        const web = payload?.web;
        const items = Array.isArray(web?.results) ? web.results : [];
        return items.slice(0, limit).map((item) => ({
            url: typeof item.url === "string" ? item.url : "",
            title: typeof item.title === "string" ? item.title : "",
            snippet: typeof item.description === "string" ? item.description : "",
        }));
    }
}
/**
 * Instantiate the configured search provider.
 *
 * One key serves whichever backend is selected (JOB_BOARD_SEARCH_API_KEY), so switching
 * providers is a one-variable change.
 */
export function buildProvider(config) {
    const name = config.search_provider;
    if (name === "kagi")
        return new KagiProvider(config.search_api_key, config.http_timeout * 1000);
    if (name === "brave")
        return new BraveProvider(config.search_api_key, config.http_timeout * 1000);
    throw new SearchError(`Unknown search provider '${name}'. Supported: kagi, brave. Set JOB_BOARD_SEARCH_PROVIDER.`);
}
