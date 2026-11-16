// Negative tests for scripts/check-guide.mjs: each broken fixture must fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checker = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-guide.mjs");

const page = (title, summary, body = "Body.\n") => `---\ntitle: ${title}\nsummary: ${summary}\n---\n\n${body}`;

function fixture(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guide-"));
  fs.mkdirSync(path.join(root, "start-here"));
  const manifest = {
    version: 1,
    product: "kaelio",
    title: "Kaelio Guide",
    groups: [{ title: "Start Here", pages: [{ slug: "start-here/one", title: "One", summary: "First page." }] }]
  };
  const files = { "start-here/one.md": page("One", "First page.") };
  mutate?.({ manifest, files, root });
  fs.writeFileSync(path.join(root, "guide.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const run = (root) => spawnSync(process.execPath, [checker, root], { encoding: "utf8" });

test("valid guide passes", () => {
  assert.equal(run(fixture()).status, 0);
});

const broken = {
  missingFile: ({ files }) => delete files["start-here/one.md"],
  orphan: ({ files }) => (files["start-here/extra.md"] = page("Extra", "Unlisted.")),
  brokenLink: ({ files }) => (files["start-here/one.md"] = page("One", "First page.", "[x](../nope/gone.md)\n")),
  scriptTag: ({ files }) => (files["start-here/one.md"] = page("One", "First page.", "<script>alert(1)</script>\n")),
  javascriptUrl: ({ files }) => (files["start-here/one.md"] = page("One", "First page.", "[x](javascript:alert(1))\n")),
  missingImage: ({ files }) => (files["start-here/one.md"] = page("One", "First page.", "![a](../images/x/y.png)\n")),
  frontmatterMismatch: ({ files }) => (files["start-here/one.md"] = page("Other", "First page.")),
  badSlug: ({ manifest }) => (manifest.groups[0].pages[0].slug = "Start Here/One"),
  deadPublishedSlug: ({ files }) => (files["published-slugs.txt"] = "start-here/removed\n"),
  badVersion: ({ manifest }) => (manifest.version = 2)
};

for (const [kind, mutate] of Object.entries(broken)) {
  test(`${kind} fails`, () => {
    const result = run(fixture(mutate));
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
}

test("<kbd> is allowed", () => {
  const root = fixture(({ files }) => (files["start-here/one.md"] = page("One", "First page.", "Press <kbd>⌘</kbd>.\n")));
  assert.equal(run(root).status, 0);
});
