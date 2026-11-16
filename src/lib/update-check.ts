// Update-check rules, after Bugler's: check at launch and once a day while
// Kaelio runs, stay quiet about a version the user skipped, and never install
// without the user choosing to.

export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const LAST_CHECK_KEY = "kaelio-update-last-check";
export const SKIPPED_KEY = "kaelio-update-skipped";
export const AUTO_CHECK_KEY = "kaelio-update-auto";

const RELEASES = "https://github.com/kael-wanderer/kaelio/releases";
const NOTES_MAX = 2000;

/** Whether an automatic check is due. A missing, unparsable or future stamp
 * counts as due, so a bad stored value never stops checks for good. */
export function isDue(now: number, lastCheck: string | null): boolean {
  if (lastCheck === null) return true;
  const last = Number(lastCheck);
  if (!Number.isFinite(last) || last > now) return true;
  return now - last >= UPDATE_INTERVAL_MS;
}

/** A manual check always shows what it found; an automatic one stays quiet
 * about a version the user chose to skip. */
export function shouldOffer(version: string, skipped: string | null, manual: boolean): boolean {
  return manual || version !== skipped;
}

/** Automatic checks are on unless the user switched them off ("0"). */
export function parseAutoCheck(stored: string | null): boolean {
  return stored !== "0";
}

/** The release page for a version. Anything that is not a plain semver
 * string falls back to the releases list rather than going into the path. */
export function releaseUrl(version: string): string {
  const v = version.startsWith("v") ? version.slice(1) : version;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) return RELEASES;
  return `${RELEASES}/tag/v${v}`;
}

/** Release notes from the feed, as plain text, trimmed and capped. */
export function releaseNotesText(body: string | undefined | null): string {
  const text = (body ?? "").trim();
  return text.length > NOTES_MAX ? text.slice(0, NOTES_MAX) + "…" : text;
}
