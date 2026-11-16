// Merge Git commits and local snapshots into one newest-first history list.
// Timestamps are Unix seconds on both sides. On a tie the snapshot comes
// first: it was taken from the editor, so it is at least as new as the commit.

export type HistoryEntry =
  | { kind: "commit"; id: string; message: string; timestamp: number }
  | { kind: "snapshot"; snapPath: string; timestamp: number };

export function mergeHistory(
  commits: { id: string; message: string; timestamp: number }[],
  snapshots: { snap_path: string; timestamp: number }[],
): HistoryEntry[] {
  const out: HistoryEntry[] = [
    ...snapshots.map((s): HistoryEntry => ({ kind: "snapshot", snapPath: s.snap_path, timestamp: s.timestamp })),
    ...commits.map((c): HistoryEntry => ({ kind: "commit", id: c.id, message: c.message, timestamp: c.timestamp })),
  ];
  // Array.prototype.sort is stable, so snapshots (listed first) win ties.
  return out.sort((a, b) => b.timestamp - a.timestamp);
}
