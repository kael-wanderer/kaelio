import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GUIDE_BASE, GUIDE_PAGES, guideUrl } from "./guide-link.ts";

const published = new Set(
  readFileSync(new URL("../../docs/guide/published-slugs.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(Boolean),
);

test("home is the guide base on kael.io.vn over https", () => {
  assert.equal(guideUrl("home"), GUIDE_BASE);
  const u = new URL(GUIDE_BASE);
  assert.equal(u.protocol, "https:");
  assert.equal(u.host, "kael.io.vn");
  assert.equal(u.pathname, "/projects/kaelio/docs");
});

test("a page is base plus its slug", () => {
  assert.equal(guideUrl("keyboardShortcuts"), `${GUIDE_BASE}/reference/keyboard-shortcuts`);
  assert.equal(guideUrl("install"), `${GUIDE_BASE}/start-here/install`);
});

test("every linked page is a published slug, so no link leads to a missing page", () => {
  for (const [name, slug] of Object.entries(GUIDE_PAGES)) {
    if (name === "home") continue;
    assert.ok(published.has(slug), `${name} -> ${slug} is not in published-slugs.txt`);
  }
});

test("every url stays on the guide host", () => {
  for (const name of Object.keys(GUIDE_PAGES) as (keyof typeof GUIDE_PAGES)[]) {
    const u = new URL(guideUrl(name));
    assert.equal(u.origin, "https://kael.io.vn");
    assert.ok(u.pathname.startsWith("/projects/kaelio/docs"));
  }
});
