// Test-only preload for the end-to-end suite. Loaded with `node --import` into
// the CLI's child process, it replaces global fetch so the CLI sees a synthetic
// SmartRecruiters board of FAKE_SR_TOTAL postings. When FAKE_ASHBY_SLUG is set it
// also serves a three-posting Ashby board under that slug, which, like the real
// Ashby API, carries no company name. When FAKE_KAGI_EMPTY is set, Kagi answers
// every search with no search results. Every other host gets a 404.
//
// Nothing here reaches the network. If this file fails to load, Node aborts the
// child process, so the CLI cannot fall through to a real request either.

const total = Number(process.env.FAKE_SR_TOTAL ?? "800");

const ashbySlug = process.env.FAKE_ASHBY_SLUG ?? "";

globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (
    ashbySlug &&
    url.hostname === "api.ashbyhq.com" &&
    url.pathname === `/posting-api/job-board/${ashbySlug}`
  ) {
    const jobs = [0, 1, 2].map((i) => ({
      id: `ashby-${i}`,
      title: `Engineer ${i}`,
      location: "Toronto, Canada",
      jobUrl: `https://jobs.ashbyhq.com/${ashbySlug}/ashby-${i}`,
      publishedAt: "2026-01-01T00:00:00.000+00:00",
      isRemote: false,
      department: "Engineering",
      employmentType: "FullTime",
    }));
    return new Response(JSON.stringify({ apiVersion: "1", jobs }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (process.env.FAKE_KAGI_EMPTY && url.hostname === "kagi.com") {
    return new Response(JSON.stringify({ meta: {}, data: { search: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.hostname !== "api.smartrecruiters.com") {
    return new Response("not found", { status: 404 });
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const n = Math.max(0, Math.min(limit, total - offset));
  const content = Array.from({ length: n }, (_, i) => ({
    id: String(offset + i),
    name: `Engineer ${offset + i}`,
    location: { city: "Austin", country: "us", remote: false },
    company: { name: "Acme" },
    releasedDate: "2026-01-01T00:00:00Z",
    typeOfEmployment: { label: "Full-time" },
  }));
  return new Response(JSON.stringify({ totalFound: total, content }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
