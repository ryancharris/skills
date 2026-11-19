/**
 * SKILL.md must load in a strict harness. Lenient loaders accept a frontmatter line that a spec-compliant
 * YAML parser rejects, and then the skill is silently skipped there (pi uses the `yaml` package). So this
 * parses the frontmatter with a real YAML library. `yaml` is a dev dependency only.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = resolve(__dirname, "..");
const repoRoot = resolve(skillDir, "..", "..");
const skillText = readFileSync(resolve(skillDir, "SKILL.md"), "utf8");

function frontmatter(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error("no frontmatter block");
  return m[1] as string;
}

const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

describe("SKILL.md frontmatter", () => {
  it("is valid YAML for a strict parser", () => {
    expect(() => parse(frontmatter(skillText))).not.toThrow();
  });

  it("has the fields a harness needs, with their expected shape", () => {
    const fm = parse(frontmatter(skillText)) as Record<string, any>;
    expect(fm.name).toBe(basename(skillDir));
    expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(typeof fm.description).toBe("string");
    expect(fm.description.length).toBeGreaterThan(0);
    expect(fm.description.length).toBeLessThanOrEqual(1024);
    expect(fm.description.split("\n")).toHaveLength(1);
    expect(typeof fm.license).toBe("string");
    expect(typeof fm.compatibility).toBe("string");
    expect(typeof fm.metadata?.version).toBe("string");
  });

  it("rejects the frontmatter that shipped in 2.1.0 (an unquoted ': ' in the description)", () => {
    const broken = 'name: job-board\ndescription: Use for "is X hiring?", site: queries and pages, on boards.\n';
    expect(() => parse(broken)).toThrow();
  });
});

describe("the version is the same everywhere it is written", () => {
  // Read inside each test, so invalid frontmatter fails the frontmatter test above, not this file's load.
  const skillVersion = () => (parse(frontmatter(skillText)) as Record<string, any>).metadata.version as string;

  it("matches package.json, the plugin manifests and the lockfile", () => {
    const version = skillVersion();
    expect(json(resolve(skillDir, "package.json")).version).toBe(version);
    expect(json(resolve(repoRoot, "package.json")).version).toBe(version);
    expect(json(resolve(repoRoot, ".claude-plugin", "plugin.json")).version).toBe(version);
    const market = json(resolve(repoRoot, ".claude-plugin", "marketplace.json"));
    expect(market.plugins[0].version).toBe(version);
    expect(json(resolve(skillDir, "package-lock.json")).version).toBe(version);
  });

  it("matches what --version prints", async () => {
    const version = skillVersion();
    const { main } = await import("../src/cli.js");
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await main(["--version"]);
    } finally {
      process.stdout.write = original;
    }
    expect(written.join("").trim()).toBe(`job-board ${version}`);
  });
});

describe("the skill ships its own LICENSE", () => {
  it("is a byte-identical copy of the repo-root LICENSE", () => {
    const copy = readFileSync(resolve(skillDir, "LICENSE"));
    expect(copy.equals(readFileSync(resolve(repoRoot, "LICENSE")))).toBe(true);
  });

  it("is listed in package.json files so npm pack includes it", () => {
    expect(json(resolve(skillDir, "package.json")).files).toContain("LICENSE");
  });
});
