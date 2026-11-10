/**
 * Text and URLs from ATS boards and search results are untrusted. These tests
 * pin the rules that keep them from breaking a line, a link, or a page:
 *
 *   - whitespace (newlines included) collapses, so a title stays on one line;
 *   - titles and snippets have a length cap;
 *   - only http(s) URLs are kept, so no javascript: link can be emitted;
 *   - Markdown link text and destinations are escaped.
 */

import { describe, expect, it } from "vitest";

import { toDetail } from "../src/format-detail.js";
import { toHtml } from "../src/format-html.js";
import { httpUrl, makeJob, oneLine, SNIPPET_MAX, TITLE_MAX } from "../src/models.js";
import { mdEscapeText, mdUrl, toMarkdown } from "../src/output.js";

const job = (extra: { title?: string; url?: string; snippet?: string } = {}) =>
  makeJob({
    title: extra.title ?? "Engineer",
    company: "Acme",
    url: extra.url ?? "https://jobs.example/1",
    source: "greenhouse",
    identifier: "1",
    snippet: extra.snippet,
  });

describe("oneLine", () => {
  it("collapses newlines, tabs and runs of spaces", () => {
    expect(oneLine("a\n\n  b\tc")).toBe("a b c");
  });

  it("caps length in characters and ends the cut with an ellipsis", () => {
    expect(oneLine("🌍".repeat(5), 3)).toBe("🌍🌍…");
    expect([...oneLine("x".repeat(500), 10)]).toHaveLength(10);
  });
});

describe("makeJob caps and cleans what it stores", () => {
  it("caps a long title at TITLE_MAX", () => {
    const title = makeJob({
      title: "T".repeat(400),
      company: "Acme",
      url: "https://x/1",
      source: "lever",
    }).title;
    expect([...title]).toHaveLength(TITLE_MAX);
    expect(title.endsWith("…")).toBe(true);
  });

  it("caps a long snippet at SNIPPET_MAX", () => {
    expect([...job({ snippet: "s".repeat(900) }).snippet]).toHaveLength(SNIPPET_MAX);
  });

  it("keeps a title with a newline on one line", () => {
    expect(job({ title: "Engineer\n# INJECTED" }).title).toBe("Engineer # INJECTED");
  });
});

describe("only http(s) URLs are kept", () => {
  it("keeps https and http", () => {
    expect(httpUrl("https://jobs.example/1")).toBe("https://jobs.example/1");
    expect(httpUrl("http://jobs.example/1")).toBe("http://jobs.example/1");
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>x</script>", "/relative", ""])(
    "drops %s",
    (url) => {
      expect(httpUrl(url)).toBe("");
      expect(job({ url }).url).toBe("");
    },
  );
});

describe("Markdown output", () => {
  it("keeps a multi-line title as one heading line", () => {
    const md = toMarkdown([job({ title: "Engineer\n# INJECTED" })], {});
    const headings = md.split("\n").filter((line) => line.startsWith("#"));
    expect(headings.some((line) => line === "# INJECTED")).toBe(false);
    expect(headings.some((line) => line.startsWith("### ") && line.includes("Engineer # INJECTED"))).toBe(true);
  });

  it("escapes brackets in the link text", () => {
    const md = toMarkdown([job({ title: "Engineer [Platform" })], {});
    expect(md).toContain("### [Engineer \\[Platform](https://jobs.example/1)");
  });

  it("encodes parentheses in the link destination", () => {
    const md = toMarkdown([job({ url: "https://jobs.example/a)b" })], {});
    expect(md).toContain("](https://jobs.example/a%29b)");
  });

  it("shows a role with no usable URL as plain text, not a link", () => {
    const md = toMarkdown([job({ url: "javascript:alert(1)" })], {});
    const heading = md.split("\n").find((line) => line.startsWith("### "));
    expect(heading).toBe("### Engineer");
  });

  it("escapes the helpers' special characters", () => {
    expect(mdEscapeText("a[b]\\c")).toBe("a\\[b\\]\\\\c");
    expect(mdUrl("https://x/a (b)")).toBe("https://x/a%20%28b%29");
  });
});

describe("HTML and detail output", () => {
  it("never emits a javascript: href", () => {
    const html = toHtml([job({ url: "javascript:alert(1)" })], {});
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="');
  });

  it("still links an https role", () => {
    expect(toHtml([job()], {})).toContain('href="https://jobs.example/1"');
  });

  it("omits the link line in detail when there is no usable URL", () => {
    expect(toDetail([job({ url: "javascript:alert(1)" })], {})).not.toContain("🔗");
    expect(toDetail([job()], {})).toContain("🔗 https://jobs.example/1");
  });
});
