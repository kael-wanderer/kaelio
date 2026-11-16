import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalImageCache } from "./image-cache.ts";

const url = (n: number) => "x".repeat(n);

test("stores and returns a data URL by path", () => {
  const c = new LocalImageCache(100);
  const gen = c.generation;
  c.set("/n/a.png", url(10), gen);
  assert.equal(c.get("/n/a.png"), url(10));
  assert.equal(c.totalSize, 10);
});

test("evicts oldest entries first when over the size budget", () => {
  const c = new LocalImageCache(25);
  const gen = c.generation;
  c.set("/a", url(10), gen);
  c.set("/b", url(10), gen);
  c.set("/c", url(10), gen);
  assert.equal(c.get("/a"), undefined);
  assert.equal(c.get("/b"), url(10));
  assert.equal(c.get("/c"), url(10));
  assert.equal(c.totalSize, 20);
});

test("an entry larger than the whole budget is not stored and evicts nothing", () => {
  const c = new LocalImageCache(25);
  const gen = c.generation;
  c.set("/a", url(10), gen);
  c.set("/big", url(26), gen);
  assert.equal(c.get("/big"), undefined);
  assert.equal(c.get("/a"), url(10));
});

test("replacing a path updates its size", () => {
  const c = new LocalImageCache(100);
  const gen = c.generation;
  c.set("/a", url(10), gen);
  c.set("/a", url(30), gen);
  assert.equal(c.totalSize, 30);
  assert.equal(c.size, 1);
});

test("invalidate drops exact paths and reports whether anything was dropped", () => {
  const c = new LocalImageCache(100);
  const gen = c.generation;
  c.set("/n/a.png", url(5), gen);
  c.set("/n/b.png", url(5), gen);
  assert.equal(c.invalidate(["/n/a.png"]), true);
  assert.equal(c.get("/n/a.png"), undefined);
  assert.equal(c.get("/n/b.png"), url(5));
  assert.equal(c.totalSize, 5);
  assert.equal(c.invalidate(["/elsewhere.png"]), false);
});

test("invalidating a folder drops everything under it, not siblings with the same prefix", () => {
  const c = new LocalImageCache(100);
  const gen = c.generation;
  c.set("/n/assets/a.png", url(5), gen);
  c.set("/n/assets-old/b.png", url(5), gen);
  assert.equal(c.invalidate(["/n/assets"]), true);
  assert.equal(c.get("/n/assets/a.png"), undefined);
  assert.equal(c.get("/n/assets-old/b.png"), url(5));
});

test("a read started before an invalidation is not stored", () => {
  const c = new LocalImageCache(100);
  const gen = c.generation;
  c.invalidate(["/n/a.png"]);
  c.set("/n/a.png", url(5), gen);
  assert.equal(c.get("/n/a.png"), undefined);
});

test("clear empties the cache and rejects reads started before it", () => {
  const c = new LocalImageCache(100);
  const gen = c.generation;
  c.set("/a", url(5), gen);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.totalSize, 0);
  c.set("/b", url(5), gen);
  assert.equal(c.get("/b"), undefined);
});

test("empty or invalid paths in an invalidation are ignored", () => {
  const c = new LocalImageCache(100);
  const gen = c.generation;
  c.set("/a", url(5), gen);
  assert.equal(c.invalidate(["", "/"]), true); // "/" covers everything
  assert.equal(c.size, 0);
  c.set("/b", url(5), c.generation);
  assert.equal(c.invalidate([""]), false);
  assert.equal(c.get("/b"), url(5));
});
