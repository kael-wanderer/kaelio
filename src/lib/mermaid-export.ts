/** A fenced ```mermaid block. Lines are 0-based and include both fence lines. */
export interface MermaidBlock { startLine: number; endLine: number; source: string }

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** Finds top-level ```mermaid blocks, following CommonMark fence rules (a longer outer fence hides inner ones). */
export function findMermaidBlocks(markdown: string): MermaidBlock[] {
  const lines = markdown.split("\n");
  const blocks: MermaidBlock[] = [];
  let open: { char: string; len: number; start: number; mermaid: boolean } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (!m) continue;
    const marker = m[2];
    const info = m[3].trim();
    if (!open) {
      if (marker[0] === "`" && info.includes("`")) continue; // not a fence per CommonMark
      open = { char: marker[0], len: marker.length, start: i, mermaid: info.split(/\s+/)[0] === "mermaid" };
    } else if (marker[0] === open.char && marker.length >= open.len && info === "") {
      if (open.mermaid) {
        blocks.push({ startLine: open.start, endLine: i, source: lines.slice(open.start + 1, i).join("\n") });
      }
      open = null;
    }
  }
  return blocks;
}

export function diagramName(nonce: string, index: number): string {
  return `kaelio-diagram-${nonce}-${index}.png`;
}

/**
 * Rendered blocks become one image line pointing at their diagram file; blocks that failed
 * keep their source but lose the `mermaid` language so they print as plain code.
 */
export function applyDiagramPlaceholders(markdown: string, blocks: MermaidBlock[], rendered: boolean[], nonce: string): string {
  const lines = markdown.split("\n");
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (rendered[i]) {
      lines.splice(b.startLine, b.endLine - b.startLine + 1, `![diagram](${diagramName(nonce, i)})`);
    } else {
      const m = FENCE.exec(lines[b.startLine]);
      if (m) lines[b.startLine] = m[1] + m[2];
    }
  }
  return lines.join("\n");
}
