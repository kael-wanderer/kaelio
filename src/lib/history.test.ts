import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHistory } from "./history.ts";

test("newest first across both sources", () => {
  const out = mergeHistory(
    [{ id: "a1", message: "m1", timestamp: 100 }, { id: "a2", message: "m2", timestamp: 300 }],
    [{ snap_path: "/s1", timestamp: 200 }],
  );
  assert.deepEqual(out.map(e => e.timestamp), [300, 200, 100]);
  assert.deepEqual(out.map(e => e.kind), ["commit", "snapshot", "commit"]);
});
test("same second: snapshot is listed before commit", () => {
  const out = mergeHistory([{ id: "a", message: "m", timestamp: 5 }], [{ snap_path: "/s", timestamp: 5 }]);
  assert.deepEqual(out.map(e => e.kind), ["snapshot", "commit"]);
});
test("either side may be empty", () => {
  assert.deepEqual(mergeHistory([], []), []);
  assert.equal(mergeHistory([], [{ snap_path: "/s", timestamp: 1 }]).length, 1);
});
test("fields are carried over", () => {
  assert.deepEqual(mergeHistory([], [{ snap_path: "/s", timestamp: 1 }]), [{ kind: "snapshot", snapPath: "/s", timestamp: 1 }]);
});
