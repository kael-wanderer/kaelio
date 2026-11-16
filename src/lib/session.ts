export interface SplitSession {
  open: boolean;
  mode: "edit" | "preview";
  tabs: { filePath: string; isActive: boolean }[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates the `split` field of a session file. Returns null for anything
 * malformed; drops tabs without a usable path and keeps at most one active tab.
 */
export function parseSplitSession(raw: unknown): SplitSession | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.open !== "boolean" || !Array.isArray(raw.tabs)) return null;
  const mode = raw.mode === "edit" ? "edit" : "preview";
  let activeSeen = false;
  const tabs: SplitSession["tabs"] = [];
  for (const t of raw.tabs) {
    if (!isRecord(t) || typeof t.filePath !== "string" || t.filePath === "") continue;
    const isActive = t.isActive === true && !activeSeen;
    if (isActive) activeSeen = true;
    tabs.push({ filePath: t.filePath, isActive });
  }
  return { open: raw.open, mode, tabs };
}
