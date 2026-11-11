/**
 * Search-profile expansion and job filtering.
 *
 * Ported from the earlier Python implementation (removed; see CHANGELOG). The word-boundary matching is load-bearing:
 * plain substring tests made the synonym "PM" match the "pm" inside
 * "Develo**pm**ent", so a search for "product manager" returned Business
 * Development roles, and keyword "go" matched "MongoDB".
 */

import type { Job, SearchProfile } from "./models.js";
import { daysSince, parseIso } from "./models.js";

/** Common title synonyms, keyed by a matching stem. */
export const TITLE_SYNONYMS: Record<string, string[]> = {
  "chief of staff": ["chief of staff", "CoS", "chief of staff to CEO"],
  "software engineer": ["software engineer", "SWE", "software developer"],
  "site reliability": ["site reliability engineer", "SRE"],
  "product manager": ["product manager", "PM"],
  "data scientist": ["data scientist", "DS"],
  "machine learning": ["machine learning engineer", "ML engineer", "MLE"],
  "engineering manager": ["engineering manager", "EM", "manager, engineering"],
  designer: ["product designer", "UX designer", "UI designer"],
  devops: ["devops engineer", "platform engineer"],
};

export const SENIORITY_TERMS: Record<string, string[]> = {
  intern: ["intern", "internship"],
  junior: ["junior", "jr", "entry level", "associate"],
  mid: ["mid", "intermediate", "ii"],
  senior: ["senior", "sr", "staff", "lead", "principal"],
  director: ["director", "vp", "head of", "chief"],
};

// Word boundaries so short terms match as words, not substrings. Multi-word
// phrases still work: their space is a boundary.
const WORD_START = "(?<![a-z0-9])";
const WORD_END = "(?![a-z0-9])";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive word-boundary containment, used by every text filter. */
function containsTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  const pattern = new RegExp(WORD_START + escapeRegExp(term.toLowerCase()) + WORD_END);
  return pattern.test(haystack.toLowerCase());
}

export function titleContains(title: string, term: string): boolean {
  return containsTerm(title, term);
}

/** Expand each title into a synonym group (each group is OR-ed). */
export function expandTitles(titles: string[]): string[][] {
  return titles.map((title) => {
    const low = title.toLowerCase().trim();
    const group: string[] = [title];
    const seen = new Set([title.toLowerCase()]);
    for (const [stem, syns] of Object.entries(TITLE_SYNONYMS)) {
      if (!low.includes(stem)) continue;
      for (const syn of syns) {
        if (!seen.has(syn.toLowerCase())) {
          group.push(syn);
          seen.add(syn.toLowerCase());
        }
      }
    }
    return group;
  });
}

/** Build a boolean `site:` query, e.g. `site:x.com ("chief of staff" OR "CoS")`. */
export function buildSiteQuery(
  domain: string,
  titleGroups: string[][],
  extras: string[] = [],
): string {
  const parts = [`site:${domain}`];
  for (const group of titleGroups) {
    const terms = group.map((t) => `"${t}"`).join(" OR ");
    parts.push(`(${terms})`);
  }
  for (const extra of extras) {
    parts.push(extra.includes(" ") ? `"${extra}"` : extra);
  }
  return parts.join(" ");
}

/** Query to find which ATS a company uses when API probing fails. */
export function buildDiscoveryQuery(company: string): string {
  return `"${company}" (careers OR jobs) (greenhouse OR lever OR ashby OR workday)`;
}

function matchesLocation(job: Job, locations: string[]): boolean {
  if (locations.length === 0) return true;
  const hay = job.location.toLowerCase();
  return locations.some((loc) => hay.includes(loc.toLowerCase()));
}

function matchesText(haystack: string, needles: string[]): boolean {
  return needles.every((n) => containsTerm(haystack, n));
}

/** True if the job satisfies every active constraint in the profile. */
export function matches(job: Job, profile: SearchProfile, now: Date = new Date()): boolean {
  if (profile.remote_only && !(job.remote || job.location.toLowerCase().includes("remote"))) {
    return false;
  }

  if (!matchesLocation(job, profile.locations)) return false;

  if (profile.titles.length > 0) {
    const groups = expandTitles(profile.titles);
    if (!groups.some((group) => group.some((t) => titleContains(job.title, t)))) {
      return false;
    }
  }

  if (profile.seniority.length > 0) {
    const terms = profile.seniority.flatMap(
      (s) => SENIORITY_TERMS[s.toLowerCase()] ?? [s.toLowerCase()],
    );
    if (!terms.some((t) => titleContains(job.title, t))) return false;
  }

  if (profile.include_keywords.length > 0) {
    const blob = `${job.title} ${job.department} ${job.location} ${job.snippet}`;
    if (!matchesText(blob, profile.include_keywords)) return false;
  }

  if (profile.exclude_keywords.length > 0) {
    const blob = `${job.title} ${job.department} ${job.snippet}`;
    if (profile.exclude_keywords.some((k) => containsTerm(blob, k))) return false;
  }

  if (profile.exclude_companies.length > 0) {
    const comp = job.company.toLowerCase();
    if (profile.exclude_companies.some((c) => comp.includes(c.toLowerCase()))) return false;
  }

  if (profile.max_age_days !== null && job.posted_at) {
    const posted = parseIso(job.posted_at);
    if (posted && daysSince(posted, now) > profile.max_age_days) return false;
  }

  return true;
}

export function filterJobs(jobs: Job[], profile: SearchProfile, now: Date = new Date()): Job[] {
  return jobs.filter((j) => matches(j, profile, now));
}

export function keywordHits(job: Job, profile: SearchProfile): number {
  const blob = `${job.title} ${job.department}`;
  return profile.include_keywords.filter((k) => containsTerm(blob, k)).length;
}

/**
 * Order jobs by relevance: title/keyword hits first, freshness as tie-breaker.
 *
 * Freshness is a separate axis so a perfect title match with no date still ranks
 * above an unrelated fresh posting.
 */
export function rankJobs(jobs: Job[], profile: SearchProfile, now: Date = new Date()): Job[] {
  const groups = profile.titles.length > 0 ? expandTitles(profile.titles) : [];

  const titleHits = (job: Job): number =>
    groups.filter((g) => g.some((t) => titleContains(job.title, t))).length;

  const ageDays = (job: Job): number => {
    const posted = parseIso(job.posted_at);
    if (!posted) return 3650;
    return Math.max(0, (now.getTime() - posted.getTime()) / 86_400_000);
  };

  // Decorate with the original index so ordering is deterministic even if the
  // engine's sort is not stable.
  const scored = jobs.map((job, index) => ({
    job,
    index,
    score: [titleHits(job) + keywordHits(job, profile), job.snippet ? 1 : 0, -ageDays(job)] as const,
  }));

  scored.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const diff = (b.score[i] as number) - (a.score[i] as number);
      if (diff !== 0) return diff;
    }
    return a.index - b.index;
  });

  return scored.map((s) => s.job);
}
