import { fileKind } from "./file-kind.ts";

export interface ExportAvailability { pdf: boolean; docx: boolean; png: boolean }

/** PDF and DOCX go through Pandoc and need Markdown source; PNG captures any preview. */
export function exportAvailability(path: string | null): ExportAvailability {
  const markdownSource = fileKind(path) !== "html";
  return { pdf: markdownSource, docx: markdownSource, png: true };
}
