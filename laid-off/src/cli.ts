/**
 * Command-line interface.
 *
 * Ported from jobsearch/cli.py. Flags, exit codes and defaults must match.
 *
 * NOTE ON `%`: Python's argparse crashed on a literal '%' in help text. Node has
 * no such trap, but `--help` is still covered by a test because an outage there
 * breaks every invocation, not just the help path.
 */

import { configFromEnv, type Config } from "./config.js";
import { buildSiteQuery, expandTitles } from "./filtering.js";
import { sharedDomainSiteTargets } from "./ats.js";
import { emptyProfile, type SearchProfile } from "./models.js";
import { toHiringJson, toHiringMarkdown, toJson, toMarkdown } from "./output.js";
import { checkHiring, meta, runSearch } from "./pipeline.js";
import { clear as clearCache } from "./cache.js";

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;

const HELP = `usage: jobsearch [options]

Find jobs on company ATS boards, and check whether a company is still hiring.

Targets (at least one required):
  --company NAME        Company to search for roles (repeatable)
  --check COMPANY       Report whether a company is hiring (repeatable)

Role filters:
  --title TITLE         Job title; expands to synonyms (repeatable)
  --location LOC         Location filter (repeatable)
  --remote              Remote roles only
  --seniority S         intern|junior|mid|senior|director (repeatable)
  --keyword K           Required keyword, AND-ed (repeatable)
  --exclude-keyword K   Excluded keyword (repeatable)
  --exclude-company C   Excluded company (repeatable)
  --max-age-days N      Only postings newer than N days
  --recent-days N       Window for --check "hiring recently" (default 30)
  --max-companies N     Cap companies probed (default 40)

Output:
  --format F            json (default), json-compact, or md
  --limit N             Max results to print (default 50)
  --queries             Print only the generated site: queries
  --list-boards         Print only resolved boards

Cache:
  --cache-ttl SECONDS   Reuse ATS responses for N seconds (default 0 = off)
  --clear-cache         Delete cached responses, then exit

  -h, --help            Show this help
  -V, --version         Show version
`;

interface Options {
  company: string[];
  check: string[];
  title: string[];
  location: string[];
  remote: boolean;
  seniority: string[];
  keyword: string[];
  excludeKeyword: string[];
  excludeCompany: string[];
  maxAgeDays: number | null;
  recentDays: number;
  maxCompanies: number;
  format: string;
  limit: number;
  queries: boolean;
  listBoards: boolean;
  cacheTtl: number | null;
  clearCache: boolean;
  help: boolean;
  version: boolean;
}

/** Parse argv. Returns null on a usage error (already reported to stderr). */
export function parseArgs(argv: string[]): Options | null {
  const opts: Options = {
    company: [],
    check: [],
    title: [],
    location: [],
    remote: false,
    seniority: [],
    keyword: [],
    excludeKeyword: [],
    excludeCompany: [],
    maxAgeDays: null,
    recentDays: 30,
    maxCompanies: 40,
    format: "json",
    limit: 50,
    queries: false,
    listBoards: false,
    cacheTtl: null,
    clearCache: false,
    help: false,
    version: false,
  };

  const takeValue = (name: string, i: number): string | null => {
    const value = argv[i];
    if (value === undefined || value.startsWith("--")) {
      process.stderr.write(`error: ${name} requires a value\n`);
      return null;
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-V":
      case "--version":
        opts.version = true;
        break;
      case "--remote":
        opts.remote = true;
        break;
      case "--queries":
        opts.queries = true;
        break;
      case "--list-boards":
        opts.listBoards = true;
        break;
      case "--clear-cache":
        opts.clearCache = true;
        break;
      default: {
        const valueFlag = arg.split("=")[0] as string;
        const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : null;
        const read = (): string | null => (inline !== null ? inline : takeValue(valueFlag, ++i));

        if (valueFlag === "--company") {
          const v = read();
          if (v === null) return null;
          opts.company.push(v);
        } else if (valueFlag === "--check") {
          const v = read();
          if (v === null) return null;
          opts.check.push(v);
        } else if (valueFlag === "--title") {
          const v = read();
          if (v === null) return null;
          opts.title.push(v);
        } else if (valueFlag === "--location") {
          const v = read();
          if (v === null) return null;
          opts.location.push(v);
        } else if (valueFlag === "--seniority") {
          const v = read();
          if (v === null) return null;
          opts.seniority.push(v);
        } else if (valueFlag === "--keyword") {
          const v = read();
          if (v === null) return null;
          opts.keyword.push(v);
        } else if (valueFlag === "--exclude-keyword") {
          const v = read();
          if (v === null) return null;
          opts.excludeKeyword.push(v);
        } else if (valueFlag === "--exclude-company") {
          const v = read();
          if (v === null) return null;
          opts.excludeCompany.push(v);
        } else if (valueFlag === "--max-age-days") {
          const v = read();
          if (v === null) return null;
          opts.maxAgeDays = Number(v);
        } else if (valueFlag === "--recent-days") {
          const v = read();
          if (v === null) return null;
          opts.recentDays = Number(v);
        } else if (valueFlag === "--max-companies") {
          const v = read();
          if (v === null) return null;
          opts.maxCompanies = Number(v);
        } else if (valueFlag === "--limit") {
          const v = read();
          if (v === null) return null;
          opts.limit = Number(v);
        } else if (valueFlag === "--cache-ttl") {
          const v = read();
          if (v === null) return null;
          opts.cacheTtl = Number(v);
        } else if (valueFlag === "--format") {
          const v = read();
          if (v === null) return null;
          if (!["json", "json-compact", "md"].includes(v)) {
            process.stderr.write(
              `error: --format must be json, json-compact or md (got '${v}')\n`,
            );
            return null;
          }
          opts.format = v;
        } else {
          process.stderr.write(`error: unrecognised argument '${arg}'\n`);
          return null;
        }
      }
    }
  }

  return opts;
}

function profileFrom(opts: Options): SearchProfile {
  return {
    ...emptyProfile(),
    titles: opts.title,
    locations: opts.location,
    remote_only: opts.remote,
    seniority: opts.seniority,
    include_keywords: opts.keyword,
    exclude_keywords: opts.excludeKeyword,
    exclude_companies: opts.excludeCompany,
    max_age_days: opts.maxAgeDays,
  };
}

async function resolveBoardsOnly(companies: string[], config: Config) {
  const result = await checkHiring(companies, { config });
  return result.boards.filter((b) => b.job_count > 0);
}

/** Run the CLI. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts === null) return EXIT_USAGE;

  if (opts.help) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  if (opts.version) {
    process.stdout.write("laid-off 2.0.0\n");
    return EXIT_OK;
  }

  // Load config first: cache maintenance must work without a search target.
  let config = configFromEnv();
  if (opts.cacheTtl !== null) config = { ...config, cache_ttl: opts.cacheTtl };

  // Deprecation notices from the environment (e.g. a legacy API key variable).
  for (const warning of config.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  if (opts.clearCache) {
    const removed = await clearCache(config.cache_dir);
    process.stdout.write(`Cleared ${removed} cached response(s) from ${config.cache_dir}\n`);
    return EXIT_OK;
  }

  if (opts.company.length === 0 && opts.check.length === 0) {
    process.stderr.write(
      "error: nothing to search. Pass --company NAME (repeatable) to find " +
        "matching roles, or --check COMPANY to see whether a company is hiring.\n",
    );
    return EXIT_USAGE;
  }

  // Generated queries are pure string building: never touch the network.
  if (opts.queries) {
    if (opts.title.length === 0) {
      process.stderr.write("error: --queries needs at least one --title.\n");
      return EXIT_USAGE;
    }
    process.stdout.write("Boolean site: queries (export LAID_OFF_SEARCH_API_KEY to execute):\n\n");
    for (const domain of sharedDomainSiteTargets()) {
      process.stdout.write(buildSiteQuery(domain, expandTitles(opts.title), opts.location) + "\n");
    }
    return EXIT_OK;
  }

  if (opts.check.length > 0) {
    const ignored: string[] = [];
    if (opts.title.length) ignored.push("--title");
    if (opts.location.length) ignored.push("--location");
    if (opts.keyword.length) ignored.push("--keyword");
    if (opts.excludeKeyword.length) ignored.push("--exclude-keyword");
    if (opts.excludeCompany.length) ignored.push("--exclude-company");
    if (opts.seniority.length) ignored.push("--seniority");
    if (opts.maxAgeDays !== null) ignored.push("--max-age-days");
    if (opts.remote) ignored.push("--remote");
    if (ignored.length > 0) {
      process.stderr.write(
        `warning: --check ignores role filters (${ignored.join(", ")}); it reports ` +
          `whole-board hiring. Use --company for filtered roles.\n`,
      );
    }

    if (opts.listBoards) {
      const boards = await resolveBoardsOnly(opts.check, config);
      if (boards.length === 0) {
        process.stdout.write("No live ATS boards resolved.\n");
        return EXIT_OK;
      }
      for (const b of boards) {
        process.stdout.write(`${b.company}\t${b.ats}\t${b.slug}\t${b.job_count}\n`);
      }
      return EXIT_OK;
    }

    const result = await checkHiring(opts.check, {
      recentDays: opts.recentDays,
      maxCompanies: opts.maxCompanies,
      config,
    });
    for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);

    process.stdout.write(
      opts.format === "md"
        ? toHiringMarkdown(result.signals, result.queries) + "\n"
        : toHiringJson(result.signals, {
            queries: result.queries,
            warnings: result.warnings,
          }) + "\n",
    );
    return EXIT_OK;
  }

  const result = await runSearch(profileFrom(opts), {
    companies: opts.company,
    maxCompanies: opts.maxCompanies,
    config,
  });
  for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);

  if (opts.listBoards) {
    const boards = result.boards.filter((b) => b.job_count > 0);
    if (boards.length === 0) {
      process.stdout.write("No live ATS boards resolved.\n");
      return EXIT_OK;
    }
    for (const b of boards) {
      process.stdout.write(`${b.company}\t${b.ats}\t${b.slug}\t${b.job_count}\n`);
    }
    return EXIT_OK;
  }

  const shown = result.jobs.slice(0, opts.limit);
  if (opts.format === "md") {
    process.stdout.write(
      toMarkdown(result.jobs, {
        boards: result.boards,
        meta: meta(result),
        limit: opts.limit,
      }) + "\n",
    );
  } else {
    process.stdout.write(
      toJson(shown, {
        boards: result.boards,
        meta: meta(result),
        queries: result.queries,
        warnings: result.warnings,
        total: result.jobs.length,
        compact: opts.format === "json-compact",
      }) + "\n",
    );
  }
  return EXIT_OK;
}
