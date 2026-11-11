/**
 * ATS (Applicant Tracking System) job-board adapters.
 *
 * Ported from jobsearch/ats/__init__.py. Every quirk below was discovered by
 * calling the live APIs; none of them are guesswork:
 *
 *  - Greenhouse `/jobs` carries NO department field. Departments come from a
 *    separate `/departments` tree, rolled up to the root.
 *  - Greenhouse exposes `company_name`, used to reject look-alike boards.
 *  - Lever returns a bare array; `createdAt` is epoch MILLISECONDS.
 *  - Ashby REQUIRES a User-Agent (403 without one) and exposes no company name.
 *    Its `compensationTierSummary` quotes only the FIRST tier, usually US.
 *  - SmartRecruiters returns HTTP 200 + `totalFound: 0` for an unknown slug, so
 *    the status code is not a validity signal. It paginates at 100.
 *  - BambooHR is per-tenant and answers an unknown tenant with HTML, not JSON.
 */

import { getJson, HttpError } from "./http.js";
import { makeJob, type Job, type JobSource } from "./models.js";

/** Every posting on a board, plus the total the board itself reports (if any). */
export interface BoardRead {
  jobs: Job[];
  /** The vendor's own count; null when the vendor does not report one. */
  reported: number | null;
}

/** ATS platforms that cannot be addressed with a bare shared-domain site: query. */
export const PER_TENANT_ATS: Record<string, string> = {
  icims: "careers-<company>.icims.com",
  workday: "<company>.wd1.myworkdayjobs.com",
};

export abstract class ATSAdapter {
  abstract readonly name: string;
  /** Whether a non-empty board alone is enough to trust the slug. */
  readonly trustsSlug: boolean = true;

  readonly timeout: number;
  readonly cacheTtl: number;
  readonly cacheDir: string;

  constructor(timeout = 20_000, cacheTtl = 0, cacheDir = "") {
    this.timeout = timeout;
    this.cacheTtl = cacheTtl;
    this.cacheDir = cacheDir;
  }

  /** GET as JSON, honouring this adapter's cache settings. */
  protected async get(url: string): Promise<Record<string, unknown>> {
    const data = await getJson(url, {
      timeout: this.timeout,
      cacheTtl: this.cacheTtl,
      cacheDir: this.cacheDir,
    });
    return (data ?? {}) as Record<string, unknown>;
  }

  abstract fetch(slug: string): Promise<Job[]>;

  /**
   * Fetch the postings and the vendor's own total from the same request(s).
   * Reading the total in a second call could skew the comparison if postings
   * change in between, so adapters that report one override this.
   */
  async fetchRead(slug: string): Promise<BoardRead> {
    return { jobs: await this.fetch(slug), reported: null };
  }

  /** Authoritative company name for this board, if the vendor exposes one. */
  boardCompany(_slug: string): string | null {
    return null;
  }

  /** Optional: SmartRecruiters reports its true size separately. */
  totalCount?(_slug: string): Promise<number>;

  async isValidSlug(slug: string): Promise<boolean> {
    try {
      return (await this.fetch(slug)).length > 0;
    } catch {
      return false;
    }
  }
}

function inferRemote(location: string): boolean | null {
  if (!location) return null;
  const low = location.toLowerCase();
  if (low.includes("remote") || low.includes("anywhere") || low.includes("distributed")) {
    return true;
  }
  return null;
}

interface RawJob {
  [key: string]: unknown;
}

function asArray(value: unknown): RawJob[] {
  return Array.isArray(value) ? (value as RawJob[]) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// ----------------------------------------------------------------- Greenhouse

export class GreenhouseAdapter extends ATSAdapter {
  override readonly name = "greenhouse";
  override readonly trustsSlug = false;

  private readonly jobsUrl = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs";
  private readonly deptUrl = "https://boards-api.greenhouse.io/v1/boards/{slug}/departments";

  /**
   * Map job id -> top-level department name, in ONE request.
   *
   * The departments tree is deeply nested with micro-buckets ("1120 Training &
   * Certification"), useless as a "top areas" signal, so each job is rolled up
   * to its root department.
   */
  async departmentMap(slug: string): Promise<Map<string, string>> {
    const mapping = new Map<string, string>();
    let data: Record<string, unknown>;
    try {
      data = await this.get(this.deptUrl.replace("{slug}", slug));
    } catch {
      return mapping;
    }

    const nodes = new Map<unknown, RawJob>();
    for (const dept of asArray(data.departments)) {
      if (dept.id !== undefined && dept.id !== null) nodes.set(dept.id, dept);
    }

    const rootName = (dept: RawJob): string => {
      const seen = new Set<unknown>();
      let current = dept;
      for (;;) {
        const parentId = current.parent_id;
        if (parentId === undefined || parentId === null || !nodes.has(parentId) || seen.has(parentId)) {
          return str(current.name).trim();
        }
        seen.add(parentId);
        current = nodes.get(parentId) as RawJob;
      }
    };

    for (const dept of nodes.values()) {
      const name = rootName(dept);
      if (!name) continue;
      for (const job of asArray(dept.jobs)) {
        if (job.id !== undefined && job.id !== null) mapping.set(String(job.id), name);
      }
    }
    return mapping;
  }

  override boardCompany(slug: string): string | null {
    // Synchronous by contract; discovery calls fetch() first, so use the cache
    // of the last fetch instead of re-requesting.
    const cached = this.lastCompany.get(slug);
    return cached ?? null;
  }

  /** Populated during fetch(), so boardCompany() need not refetch. */
  private readonly lastCompany = new Map<string, string>();

  async fetch(slug: string): Promise<Job[]> {
    const data = await this.get(this.jobsUrl.replace("{slug}", slug));
    const rawJobs = asArray(data.jobs);
    const departments = rawJobs.length > 0 ? await this.departmentMap(slug) : new Map<string, string>();

    const jobs: Job[] = [];
    for (const raw of rawJobs) {
      const location = str((raw.location as RawJob | undefined)?.name);
      const jobId = String(raw.id ?? "");
      const companyName = str(raw.company_name).trim();
      if (companyName) this.lastCompany.set(slug, companyName);

      jobs.push(
        makeJob({
          title: str(raw.title).trim(),
          company: companyName || slug,
          url: str(raw.absolute_url),
          source: "greenhouse",
          location,
          remote: inferRemote(location),
          department: departments.get(jobId) ?? "",
          posted_at: str(raw.first_published) || str(raw.updated_at) || null,
          identifier: jobId,
        }),
      );
    }
    return jobs;
  }
}

// ----------------------------------------------------------------------- Lever

export class LeverAdapter extends ATSAdapter {
  override readonly name = "lever";
  private readonly TEMPLATE = "https://api.lever.co/v0/postings/{slug}?mode=json";

  async fetch(slug: string): Promise<Job[]> {
    const data = await this.get(this.TEMPLATE.replace("{slug}", slug));
    // Lever returns 200 + {"ok": false} for some malformed slugs.
    if (!Array.isArray(data)) return [];

    const jobs: Job[] = [];
    for (const raw of data as RawJob[]) {
      const cats = (raw.categories ?? {}) as RawJob;
      const location = str(cats.location);
      const createdAt = raw.createdAt;
      const posted =
        typeof createdAt === "number" ? new Date(createdAt).toISOString() : null;

      jobs.push(
        makeJob({
          title: str(raw.text).trim(),
          company: slug,
          url: str(raw.hostedUrl),
          source: "lever",
          location,
          remote: inferRemote(location) ?? (raw.workplaceType === "remote" ? true : null),
          department: str(cats.team),
          employment_type: str(cats.commitment),
          posted_at: posted,
          identifier: String(raw.id ?? ""),
        }),
      );
    }
    return jobs;
  }
}

// ----------------------------------------------------------------------- Ashby

/** Location keyword -> currency whose pay tier applies there. */
const CURRENCY_BY_LOCATION: Array<[string[], string]> = [
  [
    ["canada", "ontario", "toronto", "vancouver", "montreal", "quebec", "ottawa", "calgary", "waterloo"],
    "CAD",
  ],
  [
    [
      "united states", "san francisco", "new york", "seattle", "boston",
      "washington", "california", "usa", "u.s.", "remote-friendly, us",
    ],
    "USD",
  ],
  [["korea"], "KRW"],
  [["japan", "tokyo"], "JPY"],
  [["united kingdom", "london", "uk"], "GBP"],
  [["europe", "germany", "munich", "paris", "france", "netherlands"], "EUR"],
];

/**
 * Pick the pay tier that applies to this role's location.
 *
 * Ashby publishes pay per geography and `compensationTierSummary` quotes only
 * the FIRST tier, usually the US one. Reporting it for a Canada role understates
 * pay by ~40% and in the wrong currency: "Software Engineer, ML Workload
 * Platform" (Canada) summarises as "$175K - $325K" while its CAD tier is
 * CA$250K - CA$400K. The inverse matters too: Cohere publishes BOTH a CAD and a
 * USD tier for the same San Francisco role.
 */
export function ashbyPayForLocation(compensation: unknown, location: string): string | null {
  if (!compensation || typeof compensation !== "object") return null;
  const comp = compensation as Record<string, unknown>;
  const summary = typeof comp.compensationTierSummary === "string" ? comp.compensationTierSummary : null;
  const tiers = Array.isArray(comp.compensationTiers) ? (comp.compensationTiers as RawJob[]) : [];
  if (tiers.length === 0) return summary;

  const lowLoc = (location ?? "").toLowerCase();
  let wanted: string | null = null;
  for (const [keys, currency] of CURRENCY_BY_LOCATION) {
    if (keys.some((k) => lowLoc.includes(k))) {
      wanted = currency;
      break;
    }
  }
  if (!wanted) return summary;

  for (const tier of tiers) {
    for (const component of asArray(tier.components)) {
      if (component.compensationType !== "Salary") continue;
      if (component.currencyCode === wanted) {
        return str(tier.tierSummary) || summary;
      }
    }
  }
  return summary;
}

export class AshbyAdapter extends ATSAdapter {
  override readonly name = "ashby";
  private readonly TEMPLATE =
    "https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true";

  async fetch(slug: string): Promise<Job[]> {
    const data = await this.get(this.TEMPLATE.replace("{slug}", slug));
    const jobs: Job[] = [];
    for (const raw of asArray(data.jobs)) {
      const location = str(raw.location);
      jobs.push(
        makeJob({
          title: str(raw.title).trim(),
          company: slug,
          url: str(raw.jobUrl),
          source: "ashby",
          location,
          remote: raw.isRemote === true || inferRemote(location) === true,
          department: str(raw.department),
          employment_type: str(raw.employmentType),
          posted_at: str(raw.publishedAt) || null,
          compensation: ashbyPayForLocation(raw.compensation, location),
          identifier: String(raw.id ?? ""),
        }),
      );
    }
    return jobs;
  }
}

// ------------------------------------------------------------ SmartRecruiters

function srDepartment(raw: RawJob): string {
  const dept = str((raw.department as RawJob | undefined)?.label).trim();
  if (dept) return dept;
  return str((raw.function as RawJob | undefined)?.label).trim();
}

function joinLoc(loc: RawJob): string {
  return [loc.city, loc.region, loc.country].filter((p) => typeof p === "string" && p).join(", ");
}

export class SmartRecruitersAdapter extends ATSAdapter {
  override readonly name = "smartrecruiters";
  override readonly trustsSlug = false;
  private readonly TEMPLATE = "https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100";
  private readonly PAGE_SIZE = 100;
  private readonly MAX_PAGES = 10;

  private readonly lastCompany = new Map<string, string>();

  override boardCompany(slug: string): string | null {
    return this.lastCompany.get(slug) ?? null;
  }

  /** True board size. The status code is NOT a validity signal. */
  override async totalCount(slug: string): Promise<number> {
    const data = await this.get(
      `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
    );
    return num(data.totalFound) ?? 0;
  }

  override async fetch(slug: string): Promise<Job[]> {
    return (await this.fetchRead(slug)).jobs;
  }

  /**
   * Fetch the whole board, paging past the 100-per-request limit.
   *
   * A single request silently truncated boards (Aramark reports 603). Past
   * MAX_PAGES * PAGE_SIZE (1,000) postings the read stops, so `reported` (the
   * board's totalFound) can exceed the number of jobs returned.
   */
  override async fetchRead(slug: string): Promise<BoardRead> {
    const jobs: Job[] = [];
    let total: number | null = null;

    for (let page = 0; page < this.MAX_PAGES; page++) {
      const data = await this.get(
        this.TEMPLATE.replace("{slug}", slug) + `&offset=${page * this.PAGE_SIZE}`,
      );
      const content = asArray(data.content);
      if (total === null) total = num(data.totalFound) ?? 0;
      if (content.length === 0) break;
      jobs.push(...this.toJobs(content, slug));
      if (jobs.length >= (total ?? 0)) break;
    }
    return { jobs, reported: total };
  }

  private toJobs(content: RawJob[], slug: string): Job[] {
    const jobs: Job[] = [];
    for (const raw of content) {
      const loc = (raw.location ?? {}) as RawJob;
      const location = str(loc.fullLocation) || joinLoc(loc);
      const companyName = str((raw.company as RawJob | undefined)?.name);
      if (companyName) this.lastCompany.set(slug, companyName);

      jobs.push(
        makeJob({
          title: str(raw.name).trim(),
          company: companyName || slug,
          url: `https://jobs.smartrecruiters.com/${slug}/${String(raw.id ?? "")}`,
          source: "smartrecruiters",
          location,
          remote: loc.remote === true,
          department: srDepartment(raw),
          employment_type: str(raw.typeOfEmployment),
          posted_at: str(raw.releasedDate) || null,
          identifier: String(raw.id ?? ""),
        }),
      );
    }
    return jobs;
  }

  override async isValidSlug(slug: string): Promise<boolean> {
    try {
      return (await this.totalCount(slug)) > 0;
    } catch {
      return false;
    }
  }
}

// -------------------------------------------------------------------- BambooHR

export class BambooHRAdapter extends ATSAdapter {
  override readonly name = "bamboohr";
  private readonly TEMPLATE = "https://{slug}.bamboohr.com/careers/list";

  async fetch(slug: string): Promise<Job[]> {
    const data = await this.get(this.TEMPLATE.replace("{slug}", slug));
    const jobs: Job[] = [];
    for (const raw of asArray(data.result)) {
      const loc = (raw.location ?? {}) as RawJob;
      const location = [str(loc.city), str(loc.state)].filter(Boolean).join(", ");
      const jobId = String(raw.id ?? "");
      jobs.push(
        makeJob({
          title: str(raw.jobOpeningName).trim(),
          company: slug,
          url: `https://${slug}.bamboohr.com/careers/${jobId}`,
          source: "bamboohr",
          location,
          remote: raw.isRemote === true ? true : inferRemote(location),
          department: str(raw.departmentLabel).trim(),
          employment_type: str(raw.employmentStatusLabel) || str(raw.employmentType),
          identifier: jobId,
        }),
      );
    }
    return jobs;
  }
}

// ------------------------------------------------------------------- factories

export function allAdapters(
  timeout = 20_000,
  cacheTtl = 0,
  cacheDir = "",
): ATSAdapter[] {
  return [
    new GreenhouseAdapter(timeout, cacheTtl, cacheDir),
    new LeverAdapter(timeout, cacheTtl, cacheDir),
    new AshbyAdapter(timeout, cacheTtl, cacheDir),
    new SmartRecruitersAdapter(timeout, cacheTtl, cacheDir),
    new BambooHRAdapter(timeout, cacheTtl, cacheDir),
  ];
}

/**
 * Hosts that work as `site:` targets because they are path-based.
 *
 * icims and workday are excluded: they are per-tenant subdomains, so a site:
 * query on the bare domain returns almost nothing.
 */
export function sharedDomainSiteTargets(): string[] {
  return [
    "job-boards.greenhouse.io",
    "jobs.lever.co",
    "jobs.ashbyhq.com",
    "careers.smartrecruiters.com",
    "jobs.jobvite.com",
    "jobs.bamboohr.com",
    "apply.jazz.co",
    "careers.workable.com",
  ];
}
