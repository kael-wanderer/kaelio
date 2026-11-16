#!/usr/bin/env node
// Validates docs/guide/ against the contract kael.io.vn (BugApps) enforces on
// import (src/lib/docs/validate.ts there). Run: npm run guide:check
// Exit 1 on any problem. Usage: node scripts/check-guide.mjs [guideRoot]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, "..", "docs", "guide"));

const PAGE_SLUG = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const IMAGE_PATH = /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:png|jpe?g|webp|gif)$/;
const LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g;
const IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const TAG = /<\/?([A-Za-z][A-Za-z0-9]*)/g;

const problems = [];
const report = (problem) => problems.push(problem);

function splitFrontmatter(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return { front: {}, body: text };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { front: {}, body: text };
  const front = {};
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(": ");
    if (colon > 0) front[line.slice(0, colon)] = line.slice(colon + 2);
  }
  return { front, body: lines.slice(end + 1).join("\n") };
}

function resolveRelative(target, fromFolder) {
  const parts = [...fromFolder];
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

const isRelative = (target) => !target.startsWith("/") && !target.startsWith("#") && !target.includes(":");
const captures = (pattern, text) => [...text.matchAll(pattern)].map((match) => match[1]);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "guide.json"), "utf8"));
} catch (error) {
  console.error(`guide.json unreadable: ${error.message}`);
  process.exit(1);
}
if (manifest.version !== 1) report({ kind: "unsupportedVersion", version: manifest.version });
if (!nonEmpty(manifest.product) || !nonEmpty(manifest.title)) report({ kind: "badManifest", field: "product/title" });
if (!Array.isArray(manifest.groups)) {
  console.error("guide.json: groups must be an array");
  process.exit(1);
}

const pages = manifest.groups.flatMap((group, index) => {
  if (!nonEmpty(group?.title) || !Array.isArray(group?.pages)) report({ kind: "badManifest", field: `groups[${index}]` });
  return Array.isArray(group?.pages) ? group.pages : [];
});
const allSlugs = new Set(pages.map((page) => page.slug));
const listed = new Set();

for (const page of pages) {
  if (!nonEmpty(page.title) || !nonEmpty(page.summary)) report({ kind: "badManifest", field: `page ${page.slug}` });
  if (!PAGE_SLUG.test(page.slug ?? "") || page.slug.startsWith("images/")) {
    report({ kind: "badSlug", slug: page.slug });
    continue;
  }
  if (listed.has(page.slug)) {
    report({ kind: "duplicateSlug", slug: page.slug });
    continue;
  }
  listed.add(page.slug);
  const file = path.join(root, `${page.slug}.md`);
  if (!fs.existsSync(file)) {
    report({ kind: "missingFile", slug: page.slug });
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  const { front, body } = splitFrontmatter(text);
  if (front.title !== page.title || front.summary !== page.summary) report({ kind: "frontmatterMismatch", slug: page.slug });
  const folder = page.slug.split("/").slice(0, -1);
  for (const target of captures(LINK, body)) {
    if (!isRelative(target)) continue;
    const linkPath = target.split("#")[0];
    if (!linkPath.endsWith(".md")) continue;
    const resolved = resolveRelative(linkPath, folder);
    if (!resolved || !allSlugs.has(resolved.slice(0, -3))) report({ kind: "brokenLink", page: page.slug, target });
  }
  for (const target of captures(IMAGE, body)) {
    if (!isRelative(target)) continue;
    const resolved = resolveRelative(target.split("#")[0], folder);
    const underImages = resolved?.startsWith("images/") ? resolved.slice("images/".length) : null;
    if (!underImages || !IMAGE_PATH.test(underImages) || !fs.existsSync(path.join(root, resolved)))
      report({ kind: "missingImage", page: page.slug, path: target });
  }
  const seenTags = new Set();
  for (const name of captures(TAG, text).map((tag) => tag.toLowerCase())) {
    if (name === "kbd" || seenTags.has(name)) continue;
    seenTags.add(name);
    report({ kind: "forbiddenHTML", page: page.slug, snippet: `<${name}` });
  }
  if (/javascript:/i.test(text)) report({ kind: "forbiddenHTML", page: page.slug, snippet: "javascript:" });
}

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".md")) {
      const slug = path.relative(root, full).split(path.sep).join("/").slice(0, -3);
      if (!listed.has(slug)) report({ kind: "orphan", slug });
    }
  }
};
walk(root);

const redirects = manifest.redirects ?? {};
for (const [from, to] of Object.entries(redirects)) {
  if (!PAGE_SLUG.test(from) || !listed.has(to) || listed.has(from)) report({ kind: "badRedirect", from, to });
}

const alive = new Set([...listed, ...Object.keys(redirects)]);
const publishedFile = path.join(root, "published-slugs.txt");
if (fs.existsSync(publishedFile)) {
  for (const slug of fs.readFileSync(publishedFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    if (!alive.has(slug)) report({ kind: "deadPublishedSlug", slug });
  }
}

if (problems.length) {
  console.error(`docs/guide: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${JSON.stringify(problem)}`);
  process.exit(1);
}
console.log(`docs/guide: ok (${listed.size} pages)`);
