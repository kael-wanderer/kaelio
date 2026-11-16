import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLocalImagePath } from "./image-src.ts";

test("relative path resolves against the note folder", () => {
  assert.equal(resolveLocalImagePath("assets/pasted-20261116-073501.png", "/notes"), "/notes/assets/pasted-20261116-073501.png");
  assert.equal(resolveLocalImagePath("./a.png", "/notes/x"), "/notes/x/a.png");
});
test("parent segments are resolved", () => {
  assert.equal(resolveLocalImagePath("../img/a.jpg", "/notes/x"), "/notes/img/a.jpg");
  assert.equal(resolveLocalImagePath("../../../a.png", "/n"), "/a.png");
});
test("percent-encoding is decoded, query and hash dropped", () => {
  assert.equal(resolveLocalImagePath("my%20pic.png?v=2#x", "/n"), "/n/my pic.png");
});
test("absolute file paths are kept", () => {
  assert.equal(resolveLocalImagePath("/Users/me/a.png", "/n"), "/Users/me/a.png");
});
test("URLs with a scheme, data URLs and protocol-relative URLs are left alone", () => {
  for (const src of ["https://x.com/a.png", "http://x/a.png", "data:image/png;base64,AA", "asset://localhost/a.png", "//cdn/a.png", "blob:abc"])
    assert.equal(resolveLocalImagePath(src, "/n"), null);
});
test("only image extensions are loaded", () => {
  assert.equal(resolveLocalImagePath("notes.md", "/n"), null);
  assert.equal(resolveLocalImagePath("secret", "/n"), null);
  assert.equal(resolveLocalImagePath("A.PNG", "/n"), "/n/A.PNG");
});
test("empty src or missing folder gives null", () => {
  assert.equal(resolveLocalImagePath("", "/n"), null);
  assert.equal(resolveLocalImagePath("a.png", ""), null);
});
test("malformed percent-encoding gives null", () => {
  assert.equal(resolveLocalImagePath("a%E0%A4%A.png", "/n"), null);
});
