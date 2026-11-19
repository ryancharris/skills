import { test } from "node:test";
import assert from "node:assert/strict";
import { cliVersion, collectVersions } from "./versions.mjs";

test("cliVersion reads the last line of --version and reports unknown for a missing or failing command", () => {
  assert.equal(cliVersion(process.execPath, ["-e", "console.log('banner\\n1.2.3')"]), "1.2.3");
  assert.equal(cliVersion("definitely-not-a-command-xyz"), "unknown");
  assert.equal(cliVersion(process.execPath, ["-e", "process.exit(3)"]), "unknown");
});

test("collectVersions always includes node", () => {
  const v = collectVersions({ tool: "definitely-not-a-command-xyz" });
  assert.equal(v.tool, "unknown");
  assert.equal(v.node, process.version.slice(1));
});
