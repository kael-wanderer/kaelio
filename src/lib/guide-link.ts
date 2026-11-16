// Where the app points a person at the user guide.
//
// The guide's pages live in `docs/guide/` and are published under GUIDE_BASE.
// A slug is permanent once published (`docs/guide/published-slugs.txt`), so a
// link in an installed build keeps working after the guide is edited. The test
// beside this file fails if a page here is not a published slug.

export const GUIDE_BASE = "https://kael.io.vn/projects/kaelio/docs";

export const GUIDE_PAGES = {
  home: "",
  install: "start-here/install",
  keyboardShortcuts: "reference/keyboard-shortcuts",
  troubleshooting: "reference/troubleshooting",
} as const;

export type GuidePage = keyof typeof GUIDE_PAGES;

export function guideUrl(page: GuidePage): string {
  const slug = GUIDE_PAGES[page];
  return slug ? `${GUIDE_BASE}/${slug}` : GUIDE_BASE;
}
