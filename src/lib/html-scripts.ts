// Opt-in scripts in HTML view (spec I3): does a page have any script to run?

/** True for an opening <script> tag in any case, followed by whitespace, ">" or "/". */
export function hasScriptTag(html: string): boolean {
  return /<script[\s>/]/i.test(html);
}
