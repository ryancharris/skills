// Test-only preload for the end-to-end suite. Loaded with `node --import` into
// the CLI's child process, it replaces global fetch so the CLI sees a synthetic
// SmartRecruiters board of FAKE_SR_TOTAL postings. Every other host gets a 404.
//
// Nothing here reaches the network. If this file fails to load, Node aborts the
// child process, so the CLI cannot fall through to a real request either.

const total = Number(process.env.FAKE_SR_TOTAL ?? "800");

globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
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
