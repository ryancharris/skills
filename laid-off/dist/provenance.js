/**
 * Where the ATS responses behind one run came from: the on-disk cache or the
 * network. An agent quoting a cached board as "just checked" is a silent error,
 * so the run reports it.
 *
 * Tracking uses AsyncLocalStorage, so a run is measured without threading a
 * context object through every adapter. Reads outside a tracked run are ignored.
 * Only ATS board responses are recorded; search-API calls are not.
 */
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
/** Run `fn` and report where the responses it used came from. */
export async function trackProvenance(fn) {
    const collector = { cached: false, oldest: null, startedAt: Date.now() };
    const value = await store.run(collector, fn);
    return { value, provenance: { cached: collector.cached, oldest: collector.oldest } };
}
/**
 * Record one ATS response: whether it came from the cache, and when it was fetched.
 *
 * A cache entry written during this same run is a fresh fetch, not a cached
 * one: the run fetched it seconds ago. Only entries stored before the run began
 * count as cached.
 */
export function recordRead(read) {
    const collector = store.getStore();
    if (!collector)
        return;
    const fromPreviousRun = read.cached && read.at < collector.startedAt;
    collector.cached = collector.cached || fromPreviousRun;
    collector.oldest = collector.oldest === null ? read.at : Math.min(collector.oldest, read.at);
}
/** The oldest fetch time as ISO 8601, or null when no response was recorded. */
export function fetchedAtIso(provenance) {
    return provenance.oldest === null ? null : new Date(provenance.oldest).toISOString();
}
/** Output fields for JSON: whether cached, and the oldest fetch time. */
export function cacheFields(provenance) {
    if (!provenance)
        return { cached: false, fetchedAt: null };
    return { cached: provenance.cached, fetchedAt: fetchedAtIso(provenance) };
}
