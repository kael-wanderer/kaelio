import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function vendorChunkName(id: string): string {
  const [, packageName = "misc"] =
    id.match(/node_modules\/(?:\.vite\/deps\/)?((?:@[^/]+\/)?[^/]+)/) || [];
  return `vendor-${packageName.replace("@", "").replace("/", "-")}`;
}

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // One generated @mermaid-js/parser core module is ~594 kB after minification
    // and cannot be split further by manualChunks. Keep the warning threshold
    // above that while still low enough to catch accidental multi-megabyte chunks.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (id.includes("/@tauri-apps/")) return "vendor-tauri";
          if (id.includes("/@codemirror/legacy-modes/mode/")) {
            const mode = id.match(/\/@codemirror\/legacy-modes\/mode\/([^/.]+)/)?.[1] || "misc";
            const first = mode[0]?.toLowerCase() || "misc";
            if (first >= "a" && first <= "c") return "vendor-editor-legacy-a-c";
            if (first >= "d" && first <= "h") return "vendor-editor-legacy-d-h";
            if (first >= "i" && first <= "p") return "vendor-editor-legacy-i-p";
            return "vendor-editor-legacy-q-z";
          }
          if (id.includes("/@codemirror/lang-")) return vendorChunkName(id);
          if (id.includes("/@codemirror/language-data/")) return "vendor-editor-language-data";
          if (id.includes("/@codemirror/") || id.includes("/codemirror/")) return "vendor-editor";
          if (id.includes("/@lezer/")) return vendorChunkName(id);

          if (id.includes("/mermaid/") || id.includes("/@mermaid-js/")) return;
          if (id.includes("/markdown-it") || id.includes("/katex/")) return "vendor-markdown";
          if (id.includes("/jspdf/")) return "vendor-jspdf";
          if (id.includes("/html-to-image/") || id.includes("/html2canvas/")) return "vendor-capture";
          if (id.includes("/docx/")) return "vendor-docx";
          if (id.includes("/cytoscape/")) return "vendor-cytoscape";
          if (id.includes("/d3") || id.includes("/dagre") || id.includes("/elkjs/")) return "vendor-graphs";
          if (id.includes("/lodash-es/")) return "vendor-lodash";
          if (id.includes("/core-js/")) return "vendor-core-js";
          if (
            id.includes("/robust-predicates/") ||
            id.includes("/delaunator/") ||
            id.includes("/@chevrotain/cst-dts-gen/")
          ) return;
          if (
            id.includes("/langium/") ||
            id.includes("/chevrotain") ||
            id.includes("/vscode-jsonrpc/") ||
            id.includes("/vscode-languageserver")
          ) return "vendor-parser";

          return vendorChunkName(id);
        },
      },
    },
  },
}));
