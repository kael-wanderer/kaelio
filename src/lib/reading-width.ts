export type ReadingWidth = "narrow" | "medium" | "wide" | "full";

const ORDER: ReadingWidth[] = ["narrow", "medium", "wide", "full"];
const CSS: Record<ReadingWidth, string> = { narrow: "60ch", medium: "75ch", wide: "90ch", full: "none" };

/** Stored value from localStorage; anything missing or unknown is "medium". */
export function parseReadingWidth(raw: string | null): ReadingWidth {
  return (ORDER as string[]).includes(raw ?? "") ? (raw as ReadingWidth) : "medium";
}

/** CSS `max-width` for the Reading View column. */
export function readingWidthCss(w: ReadingWidth): string {
  return CSS[w];
}

/** Next value for the "Cycle Reading Width" command. */
export function nextReadingWidth(w: ReadingWidth): ReadingWidth {
  return ORDER[(ORDER.indexOf(w) + 1) % ORDER.length];
}
