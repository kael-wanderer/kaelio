// YAML frontmatter for the preview: a small reader for the key/value shapes
// notes use, not a full YAML parser.

export interface FrontmatterEntry {
  key: string;
  value: string;
  /** Set when the value is a list, in flow (`[a, b]`) or block (`- a`) form. */
  items?: string[];
}

export function extractFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Items of a YAML flow sequence such as `[a, "b, c", 'd']`, or null when
 * the value is not one. Commas inside quotes do not split. */
export function parseFlowList(value: string): string[] | null {
  const v = value.trim();
  if (!v.startsWith("[") || !v.endsWith("]")) return null;
  const inner = v.slice(1, -1);
  const items: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      cur += ch;
      quote = ch;
    } else if (ch === ",") {
      items.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  items.push(cur);
  return items.map(unquote).filter(Boolean);
}

export function parseYamlFrontmatter(yaml: string): FrontmatterEntry[] {
  const lines = yaml.split("\n");
  const entries: FrontmatterEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(/^(\w[\w\s-]*):\s*(.*)/);
    if (!match) { i++; continue; }
    const key = match[1].trim();
    let val = match[2].trim();
    if (val === ">" || val === "|" || val === ">-" || val === "|-") {
      val = "";
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
        val += (val ? " " : "") + lines[i].trim();
        i++;
      }
      entries.push({ key, value: val.trim() });
    } else if (val === "") {
      i++;
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        const item = lines[i].trim();
        items.push(unquote(item.startsWith("- ") ? item.slice(2) : item));
        i++;
      }
      entries.push(items.length ? { key, value: items.join(", "), items } : { key, value: "" });
    } else {
      i++;
      const flow = parseFlowList(val);
      if (flow) entries.push({ key, value: flow.join(", "), items: flow });
      else entries.push({ key, value: unquote(val) });
    }
  }
  return entries;
}

const TAG_KEYS = "tags|tag|categories|keywords";

function quoteIfNeeded(item: string): string {
  return /[,\[\]"'#:]/.test(item) || item !== item.trim() ? JSON.stringify(item) : item;
}

/** The edit that removes `tag` from the note's frontmatter tag list, or null.
 * Only the frontmatter block is searched, never the body. */
export function removeFrontmatterTag(doc: string, tag: string): { from: number; to: number; insert: string } | null {
  const fm = doc.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!fm) return null;
  const blockStart = 4; // after "---\n"
  const block = fm[1];

  // Flow form: `tags: [a, b]`
  const flowRe = new RegExp(`^((?:${TAG_KEYS})\\s*:\\s*)(\\[.*\\])\\s*$`, "gmi");
  for (let m = flowRe.exec(block); m; m = flowRe.exec(block)) {
    const items = parseFlowList(m[2]);
    if (!items || !items.includes(tag)) continue;
    const kept = items.filter(t => t !== tag).map(quoteIfNeeded);
    const from = blockStart + m.index;
    return { from, to: from + m[0].length, insert: `${m[1]}[${kept.join(", ")}]` };
  }

  // Block form: an indented `- tag` line under a tag key.
  const lines = block.split("\n");
  let offset = blockStart;
  let inTags = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inTags = new RegExp(`^(?:${TAG_KEYS})\\s*:\\s*$`, "i").test(line);
    else if (inTags) {
      const item = line.trim();
      if (item.startsWith("- ") && unquote(item.slice(2)) === tag) {
        return { from: offset, to: offset + line.length + 1, insert: "" };
      }
    }
    offset += line.length + 1;
  }
  return null;
}
