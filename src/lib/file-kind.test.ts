import { test } from "node:test";
import assert from "node:assert/strict";
import { fileKind } from "./file-kind.ts";

test("markdown", () => { for (const p of ["/a.md", "/a.MARKDOWN", null]) assert.equal(fileKind(p), "markdown"); });
test("html", () => { for (const p of ["/a.html", "/a.HTM"]) assert.equal(fileKind(p), "html"); });
test("external", () => {
  for (const e of ["pdf","png","jpg","jpeg","gif","webp","bmp","ico","avif","svg"]) assert.equal(fileKind(`/x.${e}`), "external");
  assert.equal(fileKind("/x.PDF"), "external");
});
test("everything else is text", () => {
  for (const p of ["/a.json", "/a.csv", "/a.yaml", "/a.txt", "/Makefile", "/.env", "/a.pdf.md.bak"]) assert.equal(fileKind(p), "text");
});
test("extension is taken from the file name, not a folder", () => {
  assert.equal(fileKind("/photos.png/readme"), "text");
});
