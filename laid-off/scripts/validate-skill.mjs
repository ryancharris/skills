#!/usr/bin/env node
/**
 * Validate SKILL.md against the Agent Skills spec expectations that matter for
 * a harness to load it. Cheap to run, and catches the failures that are silent:
 * a missing description means the skill is never routed to at all.
 *
 * Checked:
 *   - frontmatter block present and parseable YAML-ish key/value
 *   - `name` present, <=64 chars, lowercase a-z0-9 and hyphens, no leading or
 *     trailing hyphen, no consecutive hyphens
 *   - `description` present, non-empty, <=1024 chars (and warn above 200, the
 *     point at which routing cost grows for no benefit)
 *   - directory name matches `name` (portability convention across harnesses)
 */

import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = resolve(here, "..", "SKILL.md");

const errors = [];
const warnings = [];

let text;
try {
  text = readFileSync(skillPath, "utf8");
} catch {
  console.error(`error: cannot read ${skillPath}`);
  process.exit(1);
}

const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
if (!match) {
  errors.push("SKILL.md must start with a YAML frontmatter block delimited by '---'.");
} else {
  const front = match[1];
  const get = (key) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front);
    return m ? m[1].trim() : null;
  };

  const name = get("name");
  const description = get("description");

  if (!name) {
    errors.push("missing 'name' in frontmatter.");
  } else {
    if (name.length > 64) errors.push(`name exceeds 64 characters (${name.length}).`);
    if (!/^[a-z0-9-]+$/.test(name)) {
      errors.push("name must contain only lowercase letters, digits and hyphens.");
    }
    if (name.startsWith("-") || name.endsWith("-")) {
      errors.push("name must not start or end with a hyphen.");
    }
    if (name.includes("--")) errors.push("name must not contain consecutive hyphens.");

    const dir = basename(resolve(here, ".."));
    if (name !== dir) {
      warnings.push(`name '${name}' does not match directory '${dir}' (harness portability).`);
    }
  }

  if (!description) {
    errors.push("missing 'description' — a skill without one is never routed to.");
  } else {
    if (description.length > 1024) {
      errors.push(`description exceeds 1024 characters (${description.length}).`);
    } else if (description.length > 200) {
      warnings.push(
        `description is ${description.length} chars; under 200 keeps routing cheap.`,
      );
    }
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
for (const error of errors) console.error(`::error::${error}`);

if (errors.length > 0) {
  console.error(`\nSKILL.md validation failed (${errors.length} error(s)).`);
  process.exit(1);
}
console.log("SKILL.md is valid.");
