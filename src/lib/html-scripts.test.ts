import { test } from "node:test";
import assert from "node:assert/strict";
import { hasScriptTag } from "./html-scripts.ts";

test("hasScriptTag", () => {
  for (const yes of ["<script>x</script>", "<SCRIPT src='a.js'></SCRIPT>", "<p></p><script\n type=module>"]) assert.ok(hasScriptTag(yes));
  for (const no of ["<p>no</p>", "<scripted>", "&lt;script&gt;", ""]) assert.ok(!hasScriptTag(no));
});
