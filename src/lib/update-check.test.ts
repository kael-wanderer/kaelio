import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UPDATE_INTERVAL_MS, isDue, shouldOffer, parseAutoCheck, releaseUrl, releaseNotesText,
} from "./update-check.ts";

const DAY = 24 * 60 * 60 * 1000;

test("interval is one day", () => {
  assert.equal(UPDATE_INTERVAL_MS, DAY);
});

test("due when never checked", () => {
  assert.equal(isDue(1_000_000, null), true);
});
test("not due within a day of the last check", () => {
  assert.equal(isDue(10 * DAY, String(10 * DAY - DAY + 1)), false);
});
test("due a day or more after the last check", () => {
  assert.equal(isDue(10 * DAY, String(9 * DAY)), true);
});
test("unparsable or future timestamp counts as due, so a bad value never blocks checks", () => {
  assert.equal(isDue(10 * DAY, "garbage"), true);
  assert.equal(isDue(10 * DAY, String(20 * DAY)), true);
});

test("a manual check always offers", () => {
  assert.equal(shouldOffer("1.0.0", "1.0.0", true), true);
});
test("an automatic check skips the version the user skipped", () => {
  assert.equal(shouldOffer("1.0.0", null, false), true);
  assert.equal(shouldOffer("1.0.0", "0.9.9", false), true);
  assert.equal(shouldOffer("1.0.0", "1.0.0", false), false);
});

test("automatic checks are on unless switched off", () => {
  assert.equal(parseAutoCheck(null), true);
  assert.equal(parseAutoCheck("1"), true);
  assert.equal(parseAutoCheck("0"), false);
  assert.equal(parseAutoCheck("weird"), true);
});

test("release url for a plain version", () => {
  assert.equal(releaseUrl("0.9.6"), "https://github.com/kael-wanderer/kaelio/releases/tag/v0.9.6");
  assert.equal(releaseUrl("v1.2.3-beta.1"), "https://github.com/kael-wanderer/kaelio/releases/tag/v1.2.3-beta.1");
});
test("a version that is not semver gives the releases list, never a crafted path", () => {
  const list = "https://github.com/kael-wanderer/kaelio/releases";
  assert.equal(releaseUrl("../../evil"), list);
  assert.equal(releaseUrl("1.0.0/../x"), list);
  assert.equal(releaseUrl(""), list);
  assert.equal(releaseUrl("1.0.0?x=1"), list);
});

test("release notes: trimmed, capped, empty when missing", () => {
  assert.equal(releaseNotesText(undefined), "");
  assert.equal(releaseNotesText("  hi \n"), "hi");
  const long = "x".repeat(5000);
  const out = releaseNotesText(long);
  assert.ok(out.length <= 2001);
  assert.ok(out.endsWith("…"));
});
