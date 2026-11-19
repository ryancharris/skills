import { test } from "node:test";
import assert from "node:assert/strict";
import { mdText } from "./md.mjs";

test("mdText keeps table cells on one line without pipes or backticks", () => {
  const out = mdText("a|b `c`\nd\r\ne\\f");
  assert.ok(!/[\r\n`]/.test(out));
  assert.ok(!/(?<!\\)\|/.test(out));
  assert.equal(mdText(undefined), "");
});
