/**
 * What a person can do next for an unreadable company in a role search, before the
 * optional search key is mentioned: its careers query, and where site queries come from.
 * Only the empty-result kinds `no_key` and `no_board` have next steps.
 */
import { buildDiscoveryQuery } from "./filtering.js";
export const CAREERS_STEP_HEADING = "Next step for the user: find the careers page";
export function nextSteps(reason) {
    if (reason?.kind !== "no_key" && reason?.kind !== "no_board")
        return null;
    if (reason.companies.length === 0)
        return null;
    const many = reason.companies.length > 1;
    return {
        careersQueries: reason.companies.map(buildDiscoveryQuery),
        careersIntro: many
            ? "The user can search for each company's board with these queries:"
            : "The user can search for the company's board with this query:",
        siteQueriesHint: reason.kind === "no_board" && reason.search === "no_title"
            ? null
            : "For site queries to paste into a search engine, run the same command with --queries.",
    };
}
