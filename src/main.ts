/// <reference types="vite/client" />

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, ViewUpdate } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import mermaid from "mermaid";
import panzoom from "panzoom";
import katex from "katex";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
// Vite bundles the worker as a local asset so PDF viewing works offline.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import "katex/dist/katex.min.css";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// One-time migration of legacy "mx-*" localStorage keys to "kaelio-*".
// Safe to ship indefinitely — does nothing once `kaelio-migrated` is set.
(function migrateLegacyMxKeys() {
  const LEGACY_PREFIX = "m" + "x-";
  if (localStorage.getItem("kaelio-migrated") === "1") return;
  const legacyKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LEGACY_PREFIX)) legacyKeys.push(k);
  }
  for (const k of legacyKeys) {
    const newKey = "kaelio-" + k.slice(LEGACY_PREFIX.length);
    if (localStorage.getItem(newKey) === null) {
      const v = localStorage.getItem(k);
      if (v !== null) localStorage.setItem(newKey, v);
    }
    localStorage.removeItem(k);
  }
  localStorage.setItem("kaelio-migrated", "1");
})();

const windowLabel = getCurrentWindow().label;
const isMainWindow = windowLabel === "main";

// --- Tab state ---

interface Tab {
  id: string;
  filePath: string | null;
  title: string;
  editorState: EditorState;
  scrollTop: number;
  previewScrollTop: number;
  isModified: boolean;
}

interface BinaryFileInfo {
  path: string;
  data_base64: string;
  mime_type: string;
  size: number;
  modified_ms: number;
}

let tabs: Tab[] = [];
let activeTabId: string | null = null;

function getActiveTab(): Tab | null {
  return tabs.find(t => t.id === activeTabId) ?? null;
}

// --- State ---

let currentFilePath: string | null = null;
let splitOpen = false;
let subFilePath: string | null = null;
let editorSub: EditorView | null = null;
let subTabs: Tab[] = [];
let subActiveTabId: string | null = null;
let subMode: "edit" | "preview" = "preview";
let activePane: "main" | "sub" = "main";
let splitTabLayoutFrame: number | null = null;
let subZoomLevel = 100;
let subShowLineNumbers = localStorage.getItem("kaelio-line-numbers") !== "false";
let restoreLastSession = localStorage.getItem("kaelio-restore-session") !== "false";
let currentFolderPath: string | null = null;

interface SessionData {
  openTabs?: { filePath: string | null; isActive: boolean; scrollTop?: number; previewScrollTop?: number; cursorOffset?: number }[];
  lastFile?: string | null;
  currentFolder?: string | null;
  savedAt?: number;
}
let sessionData: SessionData = {};
let editor: EditorView;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let zoomLevel = Number(localStorage.getItem("kaelio-zoom-level")) || 100;
const MAX_RECENT = 10;

// Auto-save state
let autoSaveEnabled = localStorage.getItem("kaelio-autosave") === "true";
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY = 3000;

// Recovery state
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

// Git state
interface GitFileStatus { path: string; status: string; }
interface GitRepoInfo { is_repo: boolean; branch: string; remote_url: string | null; ahead: number; behind: number; }
interface GitLogEntry { id: string; message: string; author: string; timestamp: number; }
interface GitSyncResult { committed: boolean; pushed: boolean; pulled: boolean; message: string; conflicts: string[]; }

let gitStatusMap: Map<string, string> = new Map();
let gitRepoInfo: GitRepoInfo | null = null;
let autoSyncEnabled = localStorage.getItem("kaelio-auto-sync") === "true";
let gitRefreshDebounce: ReturnType<typeof setTimeout> | null = null;
const RECOVERY_INTERVAL = 30000;

// Line numbers state
let showLineNumbers = localStorage.getItem("kaelio-line-numbers") !== "false";
const lineNumbersCompartment = new Compartment();
const subLineNumbersCompartment = new Compartment();
const keymapCompartment = new Compartment();

type WrapMode = "off" | "window" | "column";
let wrapMode: WrapMode = (localStorage.getItem("kaelio-wrap-mode") as WrapMode) || "window";
let wrapColumn = parseInt(localStorage.getItem("kaelio-wrap-column") || "80", 10) || 80;
const lineWrapCompartment = new Compartment();
const subLineWrapCompartment = new Compartment();

// Typography state
const FONT_OPTIONS = ["System", "Inter", "Georgia", "Merriweather", "JetBrains Mono", "Custom..."] as const;
const TEXT_SIZE_OPTIONS = ["12", "14", "16", "18", "20", "24", "Custom..."] as const;
const EXPLORER_SIZE_OPTIONS = ["12", "13", "14", "15", "16", "18"] as const;
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const JSON_EXTENSIONS = new Set(["json"]);
const CSV_EXTENSIONS = new Set(["csv"]);
const SVG_EXTENSIONS = new Set(["svg"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
let currentFont: string = localStorage.getItem("kaelio-font") || "System";
let currentTextSize = Number(localStorage.getItem("kaelio-text-size")) || 16;
let currentExplorerTextSize = Number(localStorage.getItem("kaelio-explorer-text-size")) || 12;

// Scroll sync state
let scrollSyncEnabled = true;
let isScrollSyncing = false;

// Context menu state
let contextMenuTarget: { path: string; isDir: boolean; parentPath: string } | null = null;
let compareSelected: string | null = null;
let activeSidebarDir: string | null = null; // last clicked/expanded directory in sidebar

// --- Keybinding registry ---

interface ShortcutDef {
  id: string;
  label: string;
  group: string;
  defaultKey: string;
  action: () => void;
  global?: boolean; // handled via document keydown, not CM6
}

// Action map - functions are assigned after they're defined
const actions: Record<string, () => void> = {};

function getDefaultBindings(): ShortcutDef[] {
  return [
    { id: "file.new", label: "New File", group: "File", defaultKey: "Mod-n", action: actions["file.new"] },
    { id: "file.open", label: "Open File", group: "File", defaultKey: "Mod-o", action: actions["file.open"] },
    { id: "file.save", label: "Save", group: "File", defaultKey: "Mod-s", action: actions["file.save"] },
    { id: "file.close-tab", label: "Close Tab", group: "File", defaultKey: "Mod-w", action: actions["file.close-tab"] },
    { id: "file.new-window", label: "New Window", group: "File", defaultKey: "Mod-Shift-N", action: actions["file.new-window"], global: true },
    { id: "view.toggle-preview", label: "Show/Hide Preview", group: "View", defaultKey: "Mod-p", action: actions["view.toggle-preview"] },
    { id: "view.read-mode", label: "Reading View", group: "View", defaultKey: "Mod-e", action: actions["view.read-mode"] },
    { id: "view.toggle-sidebar", label: "Show/Hide Explorer", group: "View", defaultKey: "Mod-b", action: actions["view.toggle-sidebar"] },
    { id: "view.zoom-in", label: "Zoom In", group: "View", defaultKey: "Mod-=", action: actions["view.zoom-in"] },
    { id: "view.zoom-out", label: "Zoom Out", group: "View", defaultKey: "Mod--", action: actions["view.zoom-out"] },
    { id: "view.zoom-reset", label: "Zoom Reset", group: "View", defaultKey: "Mod-0", action: actions["view.zoom-reset"] },
    { id: "edit.copy-formatted", label: "Copy Formatted", group: "Edit", defaultKey: "Mod-Shift-c", action: actions["edit.copy-formatted"] },
    { id: "search.command-palette", label: "Command Palette", group: "Search", defaultKey: "Mod-Shift-p", action: actions["search.command-palette"] },
    { id: "search.file-search", label: "File Search", group: "Search", defaultKey: "Mod-Shift-f", action: actions["search.file-search"] },
    { id: "search.content-search", label: "Content Search", group: "Search", defaultKey: "Mod-Alt-f", action: actions["search.content-search"] },
    { id: "help.shortcuts", label: "Keyboard Shortcuts", group: "Help", defaultKey: "Mod-/", action: actions["help.shortcuts"] },
  ];
}

function getCustomBindings(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("kaelio-keybindings") || "{}"); }
  catch { return {}; }
}

function getBinding(id: string): string {
  const custom = getCustomBindings();
  if (id in custom) return custom[id];
  const def = getDefaultBindings().find(d => d.id === id);
  return def?.defaultKey ?? "";
}

function setCustomBinding(id: string, key: string) {
  const custom = getCustomBindings();
  const def = getDefaultBindings().find(d => d.id === id);
  if (def && key === def.defaultKey) {
    delete custom[id]; // back to default, no need to store
  } else {
    custom[id] = key;
  }
  localStorage.setItem("kaelio-keybindings", JSON.stringify(custom));
  applyBindings();
}

function resetAllBindings() {
  localStorage.removeItem("kaelio-keybindings");
  applyBindings();
}

function findConflict(key: string, excludeId: string): ShortcutDef | null {
  if (!key) return null;
  const bindings = getDefaultBindings();
  for (const def of bindings) {
    if (def.id === excludeId) continue;
    if (getBinding(def.id).toLowerCase() === key.toLowerCase()) return def;
  }
  return null;
}

const OS_RESERVED = new Set(["mod-q", "mod-h", "mod-m", "mod-,", "mod-tab"]);

function isOSReserved(key: string): boolean {
  return OS_RESERVED.has(key.toLowerCase());
}

function keyEventToCM6(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  let key = e.key;
  // Normalize key names
  if (key === " ") key = "Space";
  else if (key === "ArrowUp") key = "Up";
  else if (key === "ArrowDown") key = "Down";
  else if (key === "ArrowLeft") key = "Left";
  else if (key === "ArrowRight") key = "Right";
  // Don't include modifier keys alone
  if (["Control", "Meta", "Shift", "Alt"].includes(key)) return "";
  parts.push(key.length === 1 ? key.toLowerCase() : key);
  return parts.join("-");
}

function cm6KeyToDisplay(key: string): string {
  if (!key) return "";
  return key
    .replace(/Mod/g, "\u2318")
    .replace(/Shift/g, "\u21E7")
    .replace(/Alt/g, "\u2325")
    .replace(/-/g, "")
    .replace(/\b([a-z])\b/g, (_, c) => c.toUpperCase());
}

function cm6KeyMatchesEvent(cm6Key: string, e: KeyboardEvent): boolean {
  if (!cm6Key) return false;
  const parts = cm6Key.split("-");
  const needMod = parts.includes("Mod");
  const needShift = parts.includes("Shift");
  const needAlt = parts.includes("Alt");
  const keyPart = parts.filter(p => p !== "Mod" && p !== "Shift" && p !== "Alt").join("-");

  if (needMod !== (e.metaKey || e.ctrlKey)) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;

  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return eventKey === keyPart || eventKey.toLowerCase() === keyPart.toLowerCase();
}

function buildKeymap() {
  const bindings = getDefaultBindings().filter(d => !d.global);
  const km: { key: string; run: () => boolean }[] = [];
  for (const def of bindings) {
    const key = getBinding(def.id);
    if (key && def.action) {
      km.push({ key, run: () => { def.action(); return true; } });
    }
  }
  return keymap.of(km);
}

let globalKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function applyBindings() {
  // Reconfigure CM6 keymap
  if (editor) {
    editor.dispatch({ effects: keymapCompartment.reconfigure(buildKeymap()) });
  }

  // Replace global keydown handler
  if (globalKeyHandler) {
    document.removeEventListener("keydown", globalKeyHandler);
  }
  const globalBindings = getDefaultBindings().filter(d => d.global);
  globalKeyHandler = (e: KeyboardEvent) => {
    for (const def of globalBindings) {
      const key = getBinding(def.id);
      if (key && cm6KeyMatchesEvent(key, e) && def.action) {
        e.preventDefault();
        def.action();
        return;
      }
    }
  };
  document.addEventListener("keydown", globalKeyHandler);

  // Re-render shortcuts modal if open
  renderShortcutsContent();
}

// --- Recent files ---

function getRecentFiles(): string[] {
  try { return JSON.parse(localStorage.getItem("kaelio-recent-files") || "[]"); }
  catch { return []; }
}

function addRecentFile(path: string) {
  let recent = getRecentFiles().filter(p => p !== path);
  recent.unshift(path);
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  localStorage.setItem("kaelio-recent-files", JSON.stringify(recent));
  renderRecentFiles();
}

function renderRecentFiles() {
  const list = document.getElementById("recent-list");
  if (!list) return;
  const recent = getRecentFiles();
  if (recent.length === 0) {
    list.innerHTML = '<div class="recent-empty">No recent files</div>';
    return;
  }
  list.innerHTML = recent.map(p => {
    const name = p.split("/").pop()!;
    const dir = p.split("/").slice(0, -1).join("/");
    return `<div class="recent-item" data-path="${p.replace(/"/g, "&quot;")}"><span class="recent-name">${name}</span><span class="recent-path">${dir}</span></div>`;
  }).join("");
  list.querySelectorAll(".recent-item").forEach(el => {
    el.addEventListener("click", () => {
      openFile((el as HTMLElement).dataset.path!);
      toggleRecentPanel();
    });
  });
}

function toggleRecentPanel() {
  const panel = document.getElementById("recent-panel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) renderRecentFiles();
}

// --- Typography and zoom ---

function applyZoom() {
  localStorage.setItem("kaelio-zoom-level", String(zoomLevel));
  applyTypography();
  const el = document.getElementById("status-zoom");
  if (el) el.textContent = `${zoomLevel}%`;
}

function applySubZoom() {
  subZoomLevel = Math.round(Math.min(200, Math.max(50, subZoomLevel)));
  applySubTypography();
}

function zoomIn() {
  if (activePane === "sub" && splitOpen) {
    subZoomLevel = Math.min(200, subZoomLevel + 10);
    applySubZoom();
    return;
  }
  zoomLevel = Math.min(200, zoomLevel + 10);
  applyZoom();
}

function zoomOut() {
  if (activePane === "sub" && splitOpen) {
    subZoomLevel = Math.max(50, subZoomLevel - 10);
    applySubZoom();
    return;
  }
  zoomLevel = Math.max(50, zoomLevel - 10);
  applyZoom();
}

function zoomReset() {
  if (activePane === "sub" && splitOpen) {
    subZoomLevel = 100;
    applySubZoom();
    return;
  }
  zoomLevel = 100;
  applyZoom();
}

function subZoomIn() {
  activePane = "sub";
  subZoomLevel = Math.min(200, subZoomLevel + 10);
  applySubZoom();
}

function subZoomOut() {
  activePane = "sub";
  subZoomLevel = Math.max(50, subZoomLevel - 10);
  applySubZoom();
}

function getFontStack(fontName: string) {
  if (fontName === "System") return "var(--font-reading)";
  return `"${fontName}", var(--font-reading)`;
}

function editorTypographyTheme() {
  const scaledSize = currentTextSize * (zoomLevel / 100);
  return EditorView.theme({
    "&": {
      fontSize: `${scaledSize}px`,
      backgroundColor: "var(--editor-bg)",
    },
    ".cm-scroller, .cm-content": {
      fontFamily: getFontStack(currentFont),
    },
    ".cm-content": {
      color: "var(--editor-text)",
      caretColor: "var(--editor-text)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--surface)",
      borderRight: "1px solid var(--border)",
      color: "var(--muted)",
    },
    ".cm-activeLineGutter, .cm-activeLine": {
      backgroundColor: "var(--hover-bg)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--editor-text)",
    },
  });
}

function subEditorTypographyTheme() {
  const scaledSize = currentTextSize * (subZoomLevel / 100);
  return EditorView.theme({
    "&": {
      fontSize: `${scaledSize}px`,
      backgroundColor: "var(--editor-bg)",
    },
    ".cm-scroller, .cm-content": {
      fontFamily: getFontStack(currentFont),
    },
    ".cm-content": {
      color: "var(--editor-text)",
      caretColor: "var(--editor-text)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--surface)",
      borderRight: "1px solid var(--border)",
      color: "var(--muted)",
    },
    ".cm-activeLineGutter, .cm-activeLine": {
      backgroundColor: "var(--hover-bg)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--editor-text)",
    },
  });
}

function applySubTypography() {
  const subPane = document.getElementById("sub-pane");
  if (subPane) subPane.style.fontSize = `${currentTextSize * (subZoomLevel / 100)}px`;
  if (editorSub) {
    editorSub.dispatch({
      effects: subEditorTypographyCompartment.reconfigure(subEditorTypographyTheme()),
    });
  }
}

function applyTypography() {
  const root = document.documentElement;
  const scaledSize = currentTextSize * (zoomLevel / 100);
  root.style.setProperty("--font-ui", getFontStack(currentFont));
  root.style.setProperty("--kaelio-reading-font", getFontStack(currentFont));
  root.style.setProperty("--kaelio-reading-font-size", `${scaledSize}px`);
  localStorage.setItem("kaelio-font", currentFont);
  localStorage.setItem("kaelio-text-size", String(currentTextSize));

  if (editor) {
    editor.dispatch({
      effects: editorTypographyCompartment.reconfigure(editorTypographyTheme()),
    });
  }
  applySubTypography();

  const label = document.getElementById("font-label");
  if (label) label.textContent = currentFont;
  const fontSelect = document.getElementById("font-select") as HTMLSelectElement | null;
  if (fontSelect) fontSelect.value = FONT_OPTIONS.includes(currentFont as typeof FONT_OPTIONS[number]) ? currentFont : "Custom...";

  const textSizeLabel = document.getElementById("text-size-label");
  if (textSizeLabel) textSizeLabel.textContent = `${currentTextSize}px`;
  const textSizeSelect = document.getElementById("text-size-select") as HTMLSelectElement | null;
  if (textSizeSelect) {
    const value = String(currentTextSize);
    textSizeSelect.value = TEXT_SIZE_OPTIONS.includes(value as typeof TEXT_SIZE_OPTIONS[number]) ? value : "Custom...";
  }
}

function applyExplorerTypography() {
  const root = document.documentElement;
  const size = Math.round(Math.min(22, Math.max(11, currentExplorerTextSize)));
  currentExplorerTextSize = size;
  root.style.setProperty("--explorer-font-size", `${size}px`);
  root.style.setProperty("--explorer-row-height", `${Math.max(22, size + 10)}px`);
  localStorage.setItem("kaelio-explorer-text-size", String(size));
}

async function setExplorerTextSize(size: string) {
  let next = Number(size);
  if (!Number.isFinite(next)) {
    const custom = await showInputDialog("Explorer text size in pixels:", String(currentExplorerTextSize));
    if (!custom) {
      applyExplorerTypography();
      return;
    }
    next = Number(custom);
  }
  if (!Number.isFinite(next)) {
    flashStatus("Invalid explorer size", "var(--error)");
    return;
  }
  currentExplorerTextSize = next;
  applyExplorerTypography();
}

async function setFont(fontName: string) {
  if (fontName === "Custom...") {
    const custom = await showInputDialog("Font family:", currentFont === "System" ? "" : currentFont);
    if (!custom) {
      applyTypography();
      return;
    }
    currentFont = custom;
  } else {
    currentFont = fontName;
  }
  applyTypography();
}

function cycleFont() {
  const available = FONT_OPTIONS.filter(font => font !== "Custom...");
  const idx = available.indexOf(currentFont as typeof available[number]);
  currentFont = available[(idx + 1) % available.length];
  applyTypography();
}

async function setTextSize(size: string) {
  let next = Number(size);
  if (size === "Custom...") {
    const custom = await showInputDialog("Text size in pixels:", String(currentTextSize));
    if (!custom) {
      applyTypography();
      return;
    }
    next = Number(custom);
  }
  if (!Number.isFinite(next)) {
    flashStatus("Invalid text size", "var(--error)");
    applyTypography();
    return;
  }
  currentTextSize = Math.round(Math.min(48, Math.max(10, next)));
  applyTypography();
}

// --- Theme ---

type ThemeMode = "auto" | "light" | "dark" | "catppuccin-mocha" | "everforest-dark" | "nord" | "custom";
const THEME_OPTIONS: ThemeMode[] = ["auto", "light", "dark", "catppuccin-mocha", "everforest-dark", "nord", "custom"];
const THEME_LABELS: Record<ThemeMode, string> = {
  auto: "System",
  light: "Light",
  dark: "Dark",
  "catppuccin-mocha": "Catppuccin Mocha",
  "everforest-dark": "Everforest Dark",
  nord: "Nord",
  custom: "Custom",
};
const vscodeColorMap: Record<string, string> = {
  "workbench.background": "--bg",
  "workbench.foreground": "--text",
  "sideBar.background": "--sidebar-bg",
  "sideBar.border": "--sidebar-border",
  "editor.background": "--editor-bg",
  "editor.foreground": "--editor-text",
  "preview.background": "--preview-bg",
  "preview.foreground": "--preview-text",
  "activityBar.background": "--surface",
  "panel.border": "--border",
  "focusBorder": "--accent",
};
const savedTheme = localStorage.getItem("kaelio-theme") as ThemeMode | null;
let currentThemeMode: ThemeMode = savedTheme && THEME_OPTIONS.includes(savedTheme) ? savedTheme : "auto";
const themeCompartment = new Compartment();
const editorTypographyCompartment = new Compartment();
const subEditorTypographyCompartment = new Compartment();

function getEffectiveTheme(): "light" | "dark" {
  if (currentThemeMode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return currentThemeMode === "light" ? "light" : "dark";
}

function getCustomColorSettings(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem("kaelio-color-customizations") || "{}");
    const colors = raw["workbench.colorCustomizations"] || raw;
    if (!colors || typeof colors !== "object") return {};
    return colors as Record<string, string>;
  } catch {
    return {};
  }
}

function applyCustomColors() {
  const root = document.documentElement;
  Object.values(vscodeColorMap).forEach(variable => root.style.removeProperty(variable));
  if (currentThemeMode !== "custom") return;

  const colors = getCustomColorSettings();
  Object.entries(colors).forEach(([key, value]) => {
    const variable = vscodeColorMap[key] || (key.startsWith("--") ? key : "");
    if (variable && typeof value === "string") root.style.setProperty(variable, value);
  });
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", currentThemeMode);
  localStorage.setItem("kaelio-theme", currentThemeMode);
  applyCustomColors();

  if (editor) {
    const isDark = getEffectiveTheme() === "dark";
    editor.dispatch({
      effects: themeCompartment.reconfigure(isDark ? oneDark : editorLightTheme),
    });
  }

  mermaid.initialize({ startOnLoad: false, theme: "default" });

  if (editor) {
    mermaidCounter = 0;
    updatePreview(editor.state.doc.toString());
  }

  const label = document.getElementById("btn-theme-label");
  if (label) label.textContent = `Theme: ${THEME_LABELS[currentThemeMode]}`;
  const themeSelect = document.getElementById("theme-select") as HTMLSelectElement | null;
  if (themeSelect) themeSelect.value = currentThemeMode;
}

function cycleTheme() {
  const idx = THEME_OPTIONS.indexOf(currentThemeMode);
  currentThemeMode = THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length];
  applyTheme();
}

async function setTheme(theme: ThemeMode) {
  if (theme === "custom") {
    const defaultValue = localStorage.getItem("kaelio-color-customizations") || '{"workbench.colorCustomizations":{"sideBar.background":"#2d353b","sideBar.border":"#555","editor.background":"#1e2326","preview.background":"#1e2326"}}';
    const custom = await showInputDialog("Custom theme JSON:", defaultValue);
    if (!custom) {
      applyTheme();
      return;
    }
    try {
      JSON.parse(custom);
      localStorage.setItem("kaelio-color-customizations", custom);
    } catch {
      flashStatus("Invalid theme JSON", "var(--error)");
      applyTheme();
      return;
    }
  }
  currentThemeMode = theme;
  applyTheme();
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentThemeMode === "auto") applyTheme();
});

// --- DOM refs ---

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

// --- Markdown-it with KaTeX ---

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true }).use(footnote);

// Tag block-level rendered elements with their source line number so the preview
// can be mapped back to editor positions for scroll-sync and click-to-cursor.
md.core.ruler.push("inject_source_line", (state) => {
  const offset = (state.env && (state.env as any).lineOffset) || 0;
  for (const tok of state.tokens) {
    if (tok.map && tok.nesting !== -1) {
      tok.attrSet("data-source-line", String(tok.map[0] + offset));
    }
  }
});

// Attach id attributes to headings for anchor navigation.
// Uses Unicode property escapes (\p{L}\p{N}) to preserve accented/Vietnamese characters.
md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const contentToken = tokens[idx + 1];
  const text = contentToken?.children
    ?.filter((t: any) => t.type === "text" || t.type === "code_inline")
    .map((t: any) => t.content)
    .join("") ?? "";
  // Strip punctuation but keep Unicode letters/numbers (incl. Vietnamese diacritics)
  const id = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
  if (id) tokens[idx].attrSet("id", id);
  return self.renderToken(tokens, idx, options);
};

// Inject copy-link button inside each heading (visible on hover)
md.renderer.rules.heading_close = (tokens, idx, _options, _env, _self) => {
  // heading_open is always 2 positions before heading_close in markdown-it's token stream
  const openToken = tokens[idx - 2];
  const id = openToken?.attrGet("id") ?? "";
  const safeId = id.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const btn = id
    ? `<button class="heading-copy-link" data-anchor="${safeId}" title="Copy link to heading">¶</button>`
    : "";
  return `${btn}</${tokens[idx].tag}>\n`;
};

// Wrap tables in a horizontally-scrollable container so wide tables don't break layout
md.renderer.rules.table_open = () => '<div class="table-scroll">\n<table>\n';
md.renderer.rules.table_close = () => '</table>\n</div>\n';

// --- Wikilinks support ---

md.inline.ruler.push("wikilink", (state, silent) => {
  if (state.src.charAt(state.pos) !== "[" || state.src.charAt(state.pos + 1) !== "[") return false;
  const start = state.pos + 2;
  const end = state.src.indexOf("]]", start);
  if (end === -1) return false;
  if (!silent) {
    const content = state.src.slice(start, end);
    const token = state.push("wikilink_open", "a", 1);
    token.attrSet("href", content.replace(/\s+/g, "-") + ".md");
    token.attrSet("class", "wikilink");
    const text = state.push("text", "", 0);
    text.content = content;
    state.push("wikilink_close", "a", -1);
  }
  state.pos = end + 2;
  return true;
});

// --- Obsidian-style callouts ---
// Transforms blockquotes starting with [!type] into styled callout boxes

const CALLOUT_ICONS: Record<string, string> = {
  note: "📝", info: "ℹ️", tip: "💡", hint: "💡", important: "❗",
  success: "✅", check: "✅", done: "✅", question: "❓", help: "❓",
  warning: "⚠️", caution: "⚠️", attention: "⚠️",
  danger: "🔴", failure: "❌", fail: "❌", error: "❌",
  bug: "🐛", example: "📋", quote: "💬", cite: "💬", abstract: "📄",
  summary: "📄", tldr: "📄",
};

function renderCallouts(html: string): string {
  // markdown-it renders blockquotes as <blockquote>\n<p>[!type] title\ncontent</p>\n</blockquote>
  // With breaks:true, newlines become <br>\n
  return html.replace(
    /<blockquote([^>]*)>\s*<p[^>]*>\[!([\w-]+)\]\s*(.*?)(?:<br>|\n)([\s\S]*?)<\/p>([\s\S]*?)<\/blockquote>/g,
    (_match, bqAttrs: string, type: string, title: string, firstContent: string, rest: string) => {
      const t = type.toLowerCase();
      const icon = CALLOUT_ICONS[t] || "📌";
      const displayTitle = title.trim() || type.charAt(0).toUpperCase() + type.slice(1);
      const content = (firstContent + rest).trim();
      return `<div class="callout callout-${t}"${bqAttrs}><div class="callout-title">${icon} ${displayTitle}</div><div class="callout-content"><p>${content}</p></div></div>`;
    }
  );
}

// --- Interactive checklists ---

function renderChecklists(html: string): string {
  let idx = 0;
  return html.replace(
    /<li([^>]*)>([\s\S]*?)<\/li>/g,
    (_match, liAttrs: string, inner: string) => {
      const checkedMatch = inner.match(/^\s*\[([ xX])\]\s*/);
      if (!checkedMatch) return `<li${liAttrs}>${inner}</li>`;
      const checked = checkedMatch[1] !== " ";
      const content = inner.replace(/^\s*\[[ xX]\]\s*/, "");
      const id = idx++;
      return `<li class="task-item"${liAttrs}><input type="checkbox" class="task-check" data-idx="${id}" ${checked ? "checked" : ""} /><span>${content}</span></li>`;
    }
  );
}

function renderKaTeX(html: string): string {
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch { return `<pre class="katex-error">${tex}</pre>`; }
  });
  html = html.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch { return `<code class="katex-error">${tex}</code>`; }
  });
  return html;
}

// --- Mermaid ---

mermaid.initialize({ startOnLoad: false, theme: "default" });

let mermaidCounter = 0;

function processMermaidBlocks(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  template.content.querySelectorAll("pre > code.language-mermaid").forEach((code) => {
    const pre = code.parentElement;
    if (!pre) return;

    const div = document.createElement("div");
    div.className = "mermaid";
    div.id = `mermaid-${++mermaidCounter}`;

    [...pre.attributes, ...code.attributes].forEach((attr) => {
      if (attr.name === "class" || attr.name === "id") return;
      if (!div.hasAttribute(attr.name)) div.setAttribute(attr.name, attr.value);
    });
    div.textContent = code.textContent ?? "";
    pre.replaceWith(div);
  });

  return template.innerHTML;
}

async function renderMermaidDivs() {
  const divs = document.querySelectorAll("#preview-pane .mermaid");
  if (divs.length === 0) return;
  try {
    await mermaid.run({ nodes: divs as unknown as ArrayLike<HTMLElement> });
  } catch { /* mermaid render errors are non-fatal */ }
  // Add click-to-open-fullscreen on each mermaid diagram
  divs.forEach((div) => {
    const el = div as HTMLElement;
    if (el.dataset.zoomReady) return;
    el.dataset.zoomReady = "1";
    el.style.cursor = "pointer";

    el.addEventListener("click", () => openMermaidOverlay(el));
  });
}

function openMermaidOverlay(source: HTMLElement) {
  const svg = source.querySelector("svg");
  if (!svg) return;

  // Clone via outerHTML to preserve all attributes, styles, defs
  const tmpDiv = document.createElement("div");
  tmpDiv.innerHTML = svg.outerHTML;
  const newSvg = tmpDiv.querySelector("svg")!;

  // Ensure it has a viewBox so it scales properly
  if (!newSvg.getAttribute("viewBox")) {
    const bbox = svg.getBBox();
    newSvg.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
  }

  // outerHTML preserves Mermaid's internal <style> block — no need to copy computed styles
  // since we always use "default" (light) theme which has good contrast

  newSvg.removeAttribute("width");
  newSvg.removeAttribute("height");

  // Create overlay
  const overlay = document.createElement("div");
  overlay.className = "mermaid-zoom-overlay";

  const closeBtn = document.createElement("button");
  closeBtn.className = "mermaid-zoom-close";
  closeBtn.innerHTML = "✕";
  closeBtn.title = "Close (Esc)";
  overlay.appendChild(closeBtn);

  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-zoom-wrapper";
  wrapper.appendChild(newSvg);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);

  // Size wrapper to SVG's natural dimensions and center via panzoom
  const vb = newSvg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  const svgW = vb ? vb[2] : svg.getBBox().width;
  const svgH = vb ? vb[3] : svg.getBBox().height;
  wrapper.style.width = svgW + "px";
  wrapper.style.height = svgH + "px";
  newSvg.style.width = "100%";
  newSvg.style.height = "100%";

  // Fit diagram to screen with padding, then center
  const pad = 60;
  const scaleX = (window.innerWidth - pad * 2) / svgW;
  const scaleY = (window.innerHeight - pad * 2) / svgH;
  const fitScale = Math.min(scaleX, scaleY, 1); // don't upscale past 1
  const cx = (window.innerWidth - svgW * fitScale) / 2;
  const cy = (window.innerHeight - svgH * fitScale) / 2;

  const pz = panzoom(wrapper, {
    smoothScroll: true,
    minZoom: 0.1,
    maxZoom: 10,
    pinchSpeed: 1.5,
    zoomDoubleClickSpeed: 2,
  });

  pz.zoomAbs(0, 0, fitScale);
  pz.moveTo(cx, cy);

  function close() {
    pz.dispose();
    overlay.remove();
  }

  closeBtn.addEventListener("click", close);
  const escHandler = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  };
  document.addEventListener("keydown", escHandler);
  overlay.tabIndex = 0;
  overlay.focus();
}

// --- YAML Frontmatter ---

function extractFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}

function parseYamlFrontmatter(yaml: string): { key: string; value: string }[] {
  const lines = yaml.split("\n");
  const entries: { key: string; value: string }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\w[\w\s-]*):\s*(.*)/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if (val === ">" || val === "|" || val === ">-" || val === "|-") {
        val = "";
        i++;
        while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
          val += (val ? " " : "") + lines[i].trim();
          i++;
        }
        val = val.trim();
      } else if (val === "") {
        i++;
        const listItems: string[] = [];
        while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
          const item = lines[i].trim();
          if (item.startsWith("- ")) listItems.push(item.slice(2));
          else listItems.push(item);
          i++;
        }
        val = listItems.join(", ");
      } else {
        val = val.replace(/^["']|["']$/g, "");
        i++;
      }
      entries.push({ key, value: val });
    } else {
      i++;
    }
  }
  return entries;
}

function renderFrontmatter(yaml: string): string {
  const entries = parseYamlFrontmatter(yaml);
  if (entries.length === 0) return "";
  const rows = entries.map(({ key, value }) => {
    const lk = key.toLowerCase();
    // Render tags/categories/keywords as styled labels
    if ((lk === "tags" || lk === "tag" || lk === "categories" || lk === "keywords") && value) {
      const tags = value.split(",").map(t => t.trim()).filter(Boolean);
      const tagHtml = tags.map(t =>
        `<span class="fm-tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}<button class="fm-tag-remove" data-tag="${escapeHtml(t)}">×</button></span>`
      ).join("");
      return `<div class="fm-row"><span class="fm-key">${escapeHtml(key)}</span><span class="fm-val fm-tags">${tagHtml}</span></div>`;
    }
    const displayVal = value.length > 200 ? value.slice(0, 200) + "..." : value;
    return `<div class="fm-row"><span class="fm-key">${escapeHtml(key)}</span><span class="fm-val">${escapeHtml(displayVal)}</span></div>`;
  }).join("");
  return `<div class="frontmatter">${rows}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getPathExtension(path: string | null): string {
  const filename = (path || "").split("/").pop() || "";
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function isMarkdownPath(path: string | null): boolean {
  return MARKDOWN_EXTENSIONS.has(getPathExtension(path));
}

function isHtmlPath(path: string | null): boolean {
  return HTML_EXTENSIONS.has(getPathExtension(path));
}

function isJsonPath(path: string | null): boolean {
  return JSON_EXTENSIONS.has(getPathExtension(path));
}

function isCsvPath(path: string | null): boolean {
  return CSV_EXTENSIONS.has(getPathExtension(path));
}

function isSvgPath(path: string | null): boolean {
  return SVG_EXTENSIONS.has(getPathExtension(path));
}

function isImagePath(path: string | null): boolean {
  return IMAGE_EXTENSIONS.has(getPathExtension(path));
}

function isPdfPath(path: string | null): boolean {
  return PDF_EXTENSIONS.has(getPathExtension(path));
}

function isPreviewOnlyPath(path: string | null): boolean {
  return isImagePath(path) || isSvgPath(path) || isPdfPath(path);
}

function updatePreviewOrRevealPreviewOnly(content: string) {
  if (currentFilePath && isPreviewOnlyPath(currentFilePath) && currentViewMode !== "preview") {
    setViewMode("preview");
    return;
  }
  updatePreview(content);
}

// --- Preview rendering ---

const IMAGE_PREVIEW_MIN_ZOOM = 0.25;
const IMAGE_PREVIEW_MAX_ZOOM = 5;
const IMAGE_PREVIEW_ZOOM_STEP = 0.25;
const imagePreviewZooms = new Map<string, number>();
const PDF_ZOOM_MIN = 0.25;
const PDF_ZOOM_MAX = 4;
const PDF_ZOOM_STEP = 0.2;
const PDF_ZOOM_KEY = "kaelio-pdf-zoom";
const pdfPageText = new Map<number, string>();
interface PdfAnnotation {
  page: number;
  type: "highlight" | "note";
  rectPct: { x: number; y: number; w: number; h: number };
  color?: string;
  text?: string;
}
let pdfAnnotations: PdfAnnotation[] = [];
let pdfAnnotationsDirty = false;
let pdfHighlightMode = false;
let pdfSearchMatches: HTMLElement[] = [];
let pdfSearchIndex = -1;
let pdfSearchToken = 0;
let renderCurrentPdfPagesForSearch: (() => Promise<void>) | null = null;
let currentPdfDoc: any = null;

function clampImagePreviewZoom(zoom: number): number {
  return Math.min(IMAGE_PREVIEW_MAX_ZOOM, Math.max(IMAGE_PREVIEW_MIN_ZOOM, zoom));
}

function loadPdfZoom(): number {
  const raw = Number(localStorage.getItem(PDF_ZOOM_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, raw));
}

function savePdfZoom(zoom: number) {
  localStorage.setItem(PDF_ZOOM_KEY, String(zoom));
}

function openUntitledMarkdownTab(content: string, title = "Extracted PDF.md") {
  saveActiveTabState();
  const tab = createTab(null, content);
  tab.title = title;
  tab.isModified = true;
  tabs.push(tab);
  activeTabId = tab.id;
  currentFilePath = null;
  editor.setState(tab.editorState);
  const filename = document.getElementById("filename");
  if (filename) filename.textContent = title;
  sessionData.lastFile = null;
  renderTabs();
  persistOpenTabs();
  updateBreadcrumb();
  startFileWatch(null);
  setModified(true);
  updatePreview(content);
  updateWordCount(content);
  updateCursorPosition(editor);
}

// Heuristic, lossy: paragraphs from line grouping, blank lines between blocks.
// No tables, columns, or OCR.
async function extractPdfToMarkdown(doc: any): Promise<string> {
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = "";
    let lastY: number | null = null;
    const lines: string[] = [];

    for (const item of content.items as any[]) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
      line += item.str + (item.hasEOL ? "" : " ");
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    out.push(lines.join("\n"));
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function extractCurrentPdfToMarkdown() {
  if (!currentFilePath || !isPdfPath(currentFilePath)) {
    flashStatus("Open a PDF first", "var(--error)", 3000);
    return;
  }
  if (!currentPdfDoc) {
    await updatePreview(editor.state.doc.toString());
  }
  if (!currentPdfDoc) {
    flashStatus("Could not load PDF text for extraction", "var(--error)", 3000);
    return;
  }

  const sourcePath = currentFilePath;
  try {
    flashStatus("Extracting PDF text...", "var(--accent)", 3000);
    const markdown = await extractPdfToMarkdown(currentPdfDoc);
    const sourceName = sourcePath.split("/").pop()?.replace(/\.pdf$/i, "") || "PDF";
    openUntitledMarkdownTab(markdown, `${sourceName}.md`);
    flashStatus(markdown.trim() ? "Extracted PDF text to Markdown" : "No selectable text found in PDF", "var(--success)", 4000);
  } catch (err) {
    flashStatus(`PDF extraction failed: ${err}`, "var(--error)", 5000);
  }
}

function renderPdfAnnotationLayer(pageNumber: number, layer: HTMLElement) {
  layer.replaceChildren();
  const pageAnnotations = pdfAnnotations.filter((annotation) => annotation.page === pageNumber);
  for (const annotation of pageAnnotations) {
    const marker = document.createElement("div");
    marker.className = annotation.type === "note" ? "pdf-annot-note" : "pdf-annot-highlight";
    marker.style.left = `${annotation.rectPct.x}%`;
    marker.style.top = `${annotation.rectPct.y}%`;
    marker.style.width = `${annotation.rectPct.w}%`;
    marker.style.height = `${annotation.rectPct.h}%`;
    if (annotation.color && annotation.type === "highlight") marker.style.background = annotation.color;
    if (annotation.text) marker.title = annotation.text;
    layer.appendChild(marker);
  }
}

async function savePdfAnnotations() {
  if (!currentFilePath || !isPdfPath(currentFilePath) || !pdfAnnotationsDirty) return;
  await invoke("write_annotations", {
    pdfPath: currentFilePath,
    json: JSON.stringify(pdfAnnotations, null, 2),
  });
  pdfAnnotationsDirty = false;
  flashStatus("Annotations saved", "var(--success)", 2500);
}

function selectionIntersectsPage(rect: DOMRect, pageRect: DOMRect): boolean {
  return rect.right > pageRect.left && rect.left < pageRect.right && rect.bottom > pageRect.top && rect.top < pageRect.bottom;
}

function addPdfHighlightFromSelection(container: HTMLElement) {
  if (!pdfHighlightMode) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim() || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const selectionRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!selectionRects.length) return;

  const pageInners = Array.from(container.querySelectorAll(".pdf-page-inner")) as HTMLElement[];
  let added = false;
  for (const pageInner of pageInners) {
    const page = Number(pageInner.closest<HTMLElement>(".pdf-page")?.dataset.page);
    if (!page) continue;
    const pageRect = pageInner.getBoundingClientRect();
    const pageRects = selectionRects.filter((rect) => selectionIntersectsPage(rect, pageRect));
    if (!pageRects.length) continue;

    const left = Math.max(0, Math.min(...pageRects.map((rect) => rect.left)) - pageRect.left);
    const top = Math.max(0, Math.min(...pageRects.map((rect) => rect.top)) - pageRect.top);
    const right = Math.min(pageRect.width, Math.max(...pageRects.map((rect) => rect.right)) - pageRect.left);
    const bottom = Math.min(pageRect.height, Math.max(...pageRects.map((rect) => rect.bottom)) - pageRect.top);
    if (right <= left || bottom <= top) continue;

    const annotation: PdfAnnotation = {
      page,
      type: "highlight",
      rectPct: {
        x: (left / pageRect.width) * 100,
        y: (top / pageRect.height) * 100,
        w: ((right - left) / pageRect.width) * 100,
        h: ((bottom - top) / pageRect.height) * 100,
      },
      color: "rgba(249,226,175,0.4)",
    };
    pdfAnnotations.push(annotation);
    const layer = pageInner.querySelector<HTMLElement>(".pdf-annot-layer");
    if (layer) renderPdfAnnotationLayer(page, layer);
    added = true;
  }

  if (added) {
    pdfAnnotationsDirty = true;
    selection.removeAllRanges();
    flashStatus("Highlight added", "var(--accent)", 1800);
  }
}

function applyImagePreviewZoom(
  previewPane: HTMLElement,
  stage: HTMLElement,
  image: HTMLImageElement,
  zoomLabel: HTMLElement,
  zoom: number,
) {
  const naturalWidth = image.naturalWidth || 1;
  const naturalHeight = image.naturalHeight || 1;
  const availableWidth = Math.max(previewPane.clientWidth - 56, 1);
  const availableHeight = Math.max(previewPane.clientHeight - 112, 1);
  const fitScale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
  const displayScale = fitScale * zoom;

  image.style.width = `${Math.max(1, Math.round(naturalWidth * displayScale))}px`;
  image.style.height = "auto";
  stage.classList.toggle("is-zoomed", zoom > 1);
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function renderHtmlPreview(previewPane: HTMLElement, content: string) {
  previewPane.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.className = "html-preview-frame";
  // allow-same-origin lets the export pipeline read contentDocument; no allow-scripts so untrusted HTML still can't execute.
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.srcdoc = content;
  previewPane.appendChild(frame);
}

async function renderImagePreview(previewPane: HTMLElement, path: string) {
  const filename = path.split("/").pop() || "Image";
  previewPane.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "asset-preview";
  const toolbar = document.createElement("div");
  toolbar.className = "asset-preview-toolbar";
  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "asset-preview-tool";
  zoomOut.textContent = "-";
  zoomOut.title = "Zoom out";
  zoomOut.setAttribute("aria-label", "Zoom out");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "asset-preview-zoom-label";
  zoomLabel.textContent = `${Math.round((imagePreviewZooms.get(path) || 1) * 100)}%`;
  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "asset-preview-tool";
  zoomIn.textContent = "+";
  zoomIn.title = "Zoom in";
  zoomIn.setAttribute("aria-label", "Zoom in");
  toolbar.append(zoomOut, zoomLabel, zoomIn);

  const stage = document.createElement("div");
  stage.className = "asset-preview-stage";
  const loading = document.createElement("div");
  loading.className = "asset-preview-message";
  loading.textContent = "Loading image...";
  stage.appendChild(loading);
  wrap.append(toolbar, stage);
  previewPane.appendChild(wrap);

  try {
    const file = await invoke<BinaryFileInfo>("read_binary_file", { path });
    if (currentFilePath !== path) return;

    const image = document.createElement("img");
    image.className = "asset-preview-image";
    image.alt = filename;
    let currentZoom = clampImagePreviewZoom(imagePreviewZooms.get(path) ?? 1);
    const setZoom = (nextZoom: number) => {
      const zoom = clampImagePreviewZoom(nextZoom);
      currentZoom = zoom;
      imagePreviewZooms.set(path, zoom);
      applyImagePreviewZoom(previewPane, stage, image, zoomLabel, zoom);
    };
    zoomOut.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setZoom(currentZoom - IMAGE_PREVIEW_ZOOM_STEP);
    });
    zoomIn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setZoom(currentZoom + IMAGE_PREVIEW_ZOOM_STEP);
    });
    image.addEventListener("load", () => setZoom(currentZoom), { once: true });
    image.src = `data:${file.mime_type};base64,${file.data_base64}`;
    stage.replaceChildren(image);
  } catch (err) {
    if (currentFilePath !== path) return;
    loading.classList.add("error");
    loading.textContent = `Could not load image: ${err}`;
  }
}

async function renderPdfPreview(previewPane: HTMLElement, path: string) {
  previewPane.innerHTML = "";
  pdfPageText.clear();
  clearPdfSearch();
  renderCurrentPdfPagesForSearch = null;
  currentPdfDoc = null;
  pdfAnnotations = [];
  pdfAnnotationsDirty = false;
  pdfHighlightMode = false;

  const wrap = document.createElement("div");
  wrap.className = "asset-preview pdf-preview-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "asset-preview-toolbar";
  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "asset-preview-tool";
  zoomOut.textContent = "-";
  zoomOut.title = "Zoom out";
  zoomOut.setAttribute("aria-label", "Zoom out");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "asset-preview-zoom-label";
  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "asset-preview-tool";
  zoomIn.textContent = "+";
  zoomIn.title = "Zoom in";
  zoomIn.setAttribute("aria-label", "Zoom in");
  const highlightToggle = document.createElement("button");
  highlightToggle.type = "button";
  highlightToggle.className = "asset-preview-tool";
  highlightToggle.textContent = "H";
  highlightToggle.title = "Highlight selected PDF text";
  highlightToggle.setAttribute("aria-label", "Highlight selected PDF text");
  const saveAnnots = document.createElement("button");
  saveAnnots.type = "button";
  saveAnnots.className = "asset-preview-tool pdf-annotation-save";
  saveAnnots.textContent = "Save";
  saveAnnots.title = "Save annotations";
  saveAnnots.setAttribute("aria-label", "Save annotations");
  const pageLabel = document.createElement("span");
  pageLabel.className = "pdf-page-label";
  toolbar.append(zoomOut, zoomLabel, zoomIn, highlightToggle, saveAnnots, pageLabel);

  const stage = document.createElement("div");
  stage.className = "asset-preview-stage pdf-stage";
  const loading = document.createElement("div");
  loading.className = "asset-preview-message";
  loading.textContent = "Loading PDF...";
  stage.appendChild(loading);
  wrap.append(toolbar, stage);
  previewPane.appendChild(wrap);

  let zoom = loadPdfZoom();
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;

  try {
    const file = await invoke<BinaryFileInfo>("read_binary_file", { path });
    if (currentFilePath !== path) return;

    const bytes = Uint8Array.from(atob(file.data_base64), (c) => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    if (currentFilePath !== path) return;
    currentPdfDoc = doc;
    try {
      const rawAnnotations = await invoke<string>("read_annotations", { pdfPath: path });
      if (currentFilePath !== path) return;
      const parsedAnnotations = JSON.parse(rawAnnotations);
      pdfAnnotations = Array.isArray(parsedAnnotations) ? parsedAnnotations as PdfAnnotation[] : [];
      pdfAnnotationsDirty = false;
    } catch (err) {
      console.warn("Could not load PDF annotations", err);
      pdfAnnotations = [];
      pdfAnnotationsDirty = false;
    }

    const pageCount = doc.numPages;
    pageLabel.textContent = `1 / ${pageCount}`;

    type PageSlot = { el: HTMLDivElement; rendered: boolean; rendering: boolean; renderPromise: Promise<void> | null };
    const slots: PageSlot[] = [];
    const container = document.createElement("div");
    container.className = "pdf-pages";
    stage.replaceChildren(container);

    for (let n = 1; n <= pageCount; n++) {
      const el = document.createElement("div");
      el.className = "pdf-page";
      el.dataset.page = String(n);
      container.appendChild(el);
      slots.push({ el, rendered: false, rendering: false, renderPromise: null });
    }

    async function sizePlaceholders() {
      for (let n = 1; n <= pageCount; n++) {
        const page = await doc.getPage(n);
        if (currentFilePath !== path) return;
        const viewport = page.getViewport({ scale: zoom });
        const slot = slots[n - 1];
        slot.el.style.width = `${Math.floor(viewport.width)}px`;
        slot.el.style.height = `${Math.floor(viewport.height)}px`;
      }
    }

    async function renderPage(n: number) {
      if (n < 1 || n > pageCount) return;
      const slot = slots[n - 1];
      if (slot.rendered) return;
      if (slot.renderPromise) {
        await slot.renderPromise;
        return;
      }
      slot.rendering = true;

      slot.renderPromise = (async () => {
        const page = await doc.getPage(n);
        if (currentFilePath !== path) return;
        const viewport = page.getViewport({ scale: zoom });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
        canvas.className = "pdf-canvas";
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create PDF canvas context");
        await page.render({ canvasContext: context, viewport }).promise;
        if (currentFilePath !== path) return;

        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer pdf-text-layer";
        textLayerDiv.style.width = `${canvas.width}px`;
        textLayerDiv.style.height = `${canvas.height}px`;

        const textContent = await page.getTextContent();
        if (currentFilePath !== path) return;
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
        if (currentFilePath !== path) return;

        pdfPageText.set(n, textContent.items.map((item: any) => ("str" in item ? item.str : "")).join(" "));

        const pageInner = document.createElement("div");
        pageInner.className = "pdf-page-inner";
        const annotLayer = document.createElement("div");
        annotLayer.className = "pdf-annot-layer";
        annotLayer.style.width = `${canvas.width}px`;
        annotLayer.style.height = `${canvas.height}px`;
        renderPdfAnnotationLayer(n, annotLayer);
        pageInner.append(canvas, textLayerDiv, annotLayer);
        slot.el.replaceChildren(pageInner);
        slot.rendered = true;
      })();

      try {
        await slot.renderPromise;
      } finally {
        slot.rendering = false;
        slot.renderPromise = null;
      }
    }

    async function renderAllPagesForSearch() {
      await Promise.all(slots.map((_slot, index) => renderPage(index + 1)));
    }
    renderCurrentPdfPagesForSearch = renderAllPagesForSearch;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.page);
          void renderPage(page);
        }
      },
      { root: stage, rootMargin: "400px 0px" },
    );
    slots.forEach((slot) => observer.observe(slot.el));

    stage.addEventListener("scroll", () => {
      const mid = stage.scrollTop + stage.clientHeight / 2;
      let current = 1;
      for (let n = 1; n <= pageCount; n++) {
        if (slots[n - 1].el.offsetTop <= mid) current = n;
      }
      pageLabel.textContent = `${current} / ${pageCount}`;
    });

    async function applyZoom(next: number) {
      zoom = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, Number(next.toFixed(2))));
      savePdfZoom(zoom);
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      slots.forEach((slot) => {
        slot.rendered = false;
        slot.renderPromise = null;
        slot.el.replaceChildren();
      });
      await sizePlaceholders();

      const stageRect = stage.getBoundingClientRect();
      slots.forEach((slot) => {
        const rect = slot.el.getBoundingClientRect();
        if (rect.bottom >= stageRect.top - 400 && rect.top <= stageRect.bottom + 400) {
          void renderPage(Number(slot.el.dataset.page));
        }
      });
    }

    zoomOut.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void applyZoom(zoom - PDF_ZOOM_STEP);
    });
    zoomIn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void applyZoom(zoom + PDF_ZOOM_STEP);
    });
    highlightToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      pdfHighlightMode = !pdfHighlightMode;
      highlightToggle.classList.toggle("active", pdfHighlightMode);
      flashStatus(pdfHighlightMode ? "PDF highlight mode on" : "PDF highlight mode off", "var(--accent)", 1800);
    });
    saveAnnots.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void savePdfAnnotations();
    });
    stage.addEventListener("mouseup", () => addPdfHighlightFromSelection(container));

    await sizePlaceholders();
    void renderPage(1);
    void renderPage(2);
  } catch (err) {
    if (currentFilePath !== path) return;
    loading.classList.add("error");
    const msg = String(err);
    loading.textContent = /password|encrypt/i.test(msg)
      ? "Password-protected PDFs are not supported yet."
      : `Could not load PDF: ${msg}`;
  }
}

function renderJsonPreview(previewPane: HTMLElement, content: string) {
  try {
    const parsed = JSON.parse(content);
    previewPane.innerHTML = `<pre class="structured-preview json-preview">${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
  } catch {
    previewPane.innerHTML = `<pre class="plain-text-preview">${escapeHtml(content)}</pre>`;
  }
}

function parseCsvRows(content: string, maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      if (rows.length >= maxRows) return rows;
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function renderCsvPreview(previewPane: HTMLElement, content: string) {
  const rows = parseCsvRows(content);
  if (!rows.length) {
    previewPane.innerHTML = `<pre class="plain-text-preview"></pre>`;
    return;
  }
  const [header, ...body] = rows;
  const head = header.map(cell => `<th>${escapeHtml(cell)}</th>`).join("");
  const bodyHtml = body.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  previewPane.innerHTML = `
    <div class="table-preview-wrap">
      <table class="table-preview">
        <thead><tr>${head}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>`;
}

async function updatePreview(content: string) {
  const previewPane = $("#preview-pane");
  const previewWrapper = $("#preview-pane-wrapper");
  if (!previewPane || (previewWrapper && previewWrapper.style.display === "none")) return;

  if (!currentFilePath || !isPdfPath(currentFilePath)) {
    pdfPageText.clear();
    clearPdfSearch();
    renderCurrentPdfPagesForSearch = null;
    currentPdfDoc = null;
    pdfAnnotations = [];
    pdfAnnotationsDirty = false;
    pdfHighlightMode = false;
  }

  if (currentFilePath && (isImagePath(currentFilePath) || isSvgPath(currentFilePath))) {
    await renderImagePreview(previewPane, currentFilePath);
    return;
  }

  if (currentFilePath && isPdfPath(currentFilePath)) {
    await renderPdfPreview(previewPane, currentFilePath);
    return;
  }

  if (currentFilePath && isHtmlPath(currentFilePath)) {
    renderHtmlPreview(previewPane, content);
    return;
  }

  if (currentFilePath && isJsonPath(currentFilePath)) {
    renderJsonPreview(previewPane, content);
    return;
  }

  if (currentFilePath && isCsvPath(currentFilePath)) {
    renderCsvPreview(previewPane, content);
    return;
  }

  if (currentFilePath && !isMarkdownPath(currentFilePath)) {
    previewPane.innerHTML = `<pre class="plain-text-preview">${escapeHtml(content)}</pre>`;
    return;
  }

  const { frontmatter, body } = extractFrontmatter(content);
  let html = "";
  let lineOffset = 0;
  if (frontmatter) {
    html += renderFrontmatter(frontmatter);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fmMatch) lineOffset = (fmMatch[0].match(/\n/g) || []).length;
  }
  html += md.render(body, { lineOffset });
  html = renderCallouts(html);
  html = renderChecklists(html);
  html = renderKaTeX(html);
  html = processMermaidBlocks(html);
  html = sanitizeHtmlString(html);
  previewPane.innerHTML = html;
  await renderMermaidDivs();
  // Wire up interactive checklists
  previewPane.querySelectorAll(".task-check").forEach(cb => {
    cb.addEventListener("change", () => {
      const input = cb as HTMLInputElement;
      const checked = input.checked;
      // Find the nth checkbox in source and toggle it
      const doc = editor.state.doc.toString();
      let idx = 0;
      const targetIdx = parseInt(input.dataset.idx || "0");
      const regex = /- \[( |x|X)\]/g;
      let match;
      while ((match = regex.exec(doc)) !== null) {
        if (idx === targetIdx) {
          const from = match.index + 3;
          const to = from + 1;
          const replacement = checked ? "x" : " ";
          editor.dispatch({ changes: { from, to, insert: replacement } });
          break;
        }
        idx++;
      }
    });
  });
  // Wire up tag remove buttons
  previewPane.querySelectorAll(".fm-tag-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tag = (btn as HTMLElement).dataset.tag;
      if (!tag) return;
      const doc = editor.state.doc.toString();
      // Find and remove the tag line "  - tagname" in frontmatter
      const tagLineRegex = new RegExp(`^([ \\t]+- ${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*$`, "m");
      const match = tagLineRegex.exec(doc);
      if (match) {
        const from = match.index;
        const to = from + match[0].length + 1; // +1 for newline
        editor.dispatch({ changes: { from, to: Math.min(to, doc.length), insert: "" } });
      }
    });
  });
  reapplyPreviewSearch();
}

function renderSubPreview(content: string) {
  const pane = document.getElementById("sub-pane");
  if (!pane) return;
  if (subFilePath && !isMarkdownPath(subFilePath)) {
    pane.innerHTML = `<pre class="plain-text-preview">${escapeHtml(content)}</pre>`;
    return;
  }
  const { frontmatter, body } = extractFrontmatter(content);
  let html = "";
  if (frontmatter) html += renderFrontmatter(frontmatter);
  html += md.render(body, { lineOffset: 0 });
  html = renderCallouts(html);
  html = renderChecklists(html);
  html = renderKaTeX(html);
  html = sanitizeHtmlString(html);
  pane.innerHTML = html;
  applySubTypography();
}

function renderSubTabs() {
  const container = document.getElementById("sub-tabs");
  if (!container) return;
  container.classList.toggle("hidden", !splitOpen);
  const tabHtml = subTabs.map(tab => {
    const activeClass = tab.id === subActiveTabId ? " active" : "";
    const dot = tab.isModified ? ' <span class="tab-modified">●</span>' : "";
    return `<div class="tab sub-tab${activeClass}" data-sub-tab-id="${tab.id}">
      <span class="tab-title sub-tab-title">${escapeHtml(tab.title)}</span>${dot}
      <span class="tab-close sub-tab-close" data-sub-tab-id="${tab.id}">✕</span>
    </div>`;
  }).join("");
  container.innerHTML = tabHtml ? `${tabHtml}<button class="tab-overflow-btn hidden" data-pane="sub" title="More split tabs" aria-label="More split tabs">▾</button>` : "";
  updateTabBarVisibility();
  scheduleSplitTabLayout();
  container.querySelectorAll(".sub-tab").forEach(el => {
    const id = (el as HTMLElement).dataset.subTabId!;
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("sub-tab-close")) return;
      switchSubTab(id);
    });
  });
  container.querySelectorAll(".sub-tab-close").forEach(el => {
    const id = (el as HTMLElement).dataset.subTabId!;
    el.addEventListener("click", (e) => { e.stopPropagation(); closeSubTab(id); });
  });
  container.querySelector(".tab-overflow-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    showTabOverflowMenu("sub", e.currentTarget as HTMLElement);
  });
}

function scheduleSplitTabLayout() {
  if (splitTabLayoutFrame !== null) cancelAnimationFrame(splitTabLayoutFrame);
  splitTabLayoutFrame = requestAnimationFrame(() => {
    splitTabLayoutFrame = null;
    syncSplitTabWidths();
  });
}

function syncSplitTabWidths() {
  const tabBar = document.getElementById("tab-bar");
  const leading = document.getElementById("tab-bar-leading") as HTMLElement | null;
  const mainTabs = document.getElementById("main-tabs") as HTMLElement | null;
  const subTabsEl = document.getElementById("sub-tabs") as HTMLElement | null;
  const seam = document.getElementById("tab-bar-seam");
  if (!tabBar || !leading || !mainTabs || !subTabsEl || !seam) return;

  if (!splitOpen || tabBar.classList.contains("hidden")) {
    leading.style.flexBasis = "0px";
    mainTabs.style.width = "";
    mainTabs.style.flex = "";
    subTabsEl.style.width = "";
    subTabsEl.style.flex = "";
    seam.classList.add("hidden");
    applyTabOverflow(mainTabs);
    return;
  }

  const mainRegion = document.getElementById("main-region");
  const subWrapper = document.getElementById("sub-pane-wrapper");
  if (!mainRegion || !subWrapper) return;

  const tabBarRect = tabBar.getBoundingClientRect();
  const mainRect = mainRegion.getBoundingClientRect();
  const leadingWidth = Math.max(0, mainRect.left - tabBarRect.left);
  leading.style.flexBasis = `${leadingWidth}px`;
  mainTabs.style.flex = "0 0 auto";
  mainTabs.style.width = `${mainRegion.offsetWidth}px`;
  subTabsEl.style.flex = "0 0 auto";
  subTabsEl.style.width = `${subWrapper.offsetWidth}px`;
  seam.classList.remove("hidden");

  applyTabOverflow(mainTabs);
  applyTabOverflow(subTabsEl);
}

function applyTabOverflow(strip: HTMLElement) {
  const overflowButton = strip.querySelector(".tab-overflow-btn") as HTMLButtonElement | null;
  const tabEls = Array.from(strip.querySelectorAll<HTMLElement>(".tab"));
  if (!overflowButton || tabEls.length === 0) return;

  tabEls.forEach(tab => tab.classList.remove("overflow-hidden-tab"));
  overflowButton.classList.add("hidden");

  const stripWidth = strip.clientWidth;
  if (stripWidth <= 0) return;

  const totalWidth = tabEls.reduce((sum, tab) => sum + tab.offsetWidth, 0);
  if (totalWidth <= stripWidth) return;

  overflowButton.classList.remove("hidden");
  const availableWidth = Math.max(0, stripWidth - overflowButton.offsetWidth);
  const activeTab = strip.querySelector<HTMLElement>(".tab.active");
  let usedWidth = totalWidth;

  for (let i = tabEls.length - 1; i >= 0 && usedWidth > availableWidth; i -= 1) {
    const tab = tabEls[i];
    if (tab === activeTab && tabEls.length > 1) continue;
    usedWidth -= tab.offsetWidth;
    tab.classList.add("overflow-hidden-tab");
  }

  if (usedWidth > availableWidth && activeTab) {
    usedWidth -= activeTab.offsetWidth;
    activeTab.classList.add("overflow-hidden-tab");
  }
}

function showTabOverflowMenu(pane: "main" | "sub", button: HTMLElement) {
  const menu = getTabOverflowMenu();
  const paneTabs = pane === "main" ? tabs : subTabs;
  const activeId = pane === "main" ? activeTabId : subActiveTabId;
  menu.innerHTML = paneTabs.map(tab => {
    const activeClass = tab.id === activeId ? " active" : "";
    const dot = tab.isModified ? '<span class="tab-modified">●</span>' : "";
    const title = escapeHtml(tab.title || "Untitled");
    return `<div class="overflow-tab-item${activeClass}" data-pane="${pane}" data-tab-id="${tab.id}">
      <span class="overflow-tab-title">${title}</span>${dot}
    </div>`;
  }).join("");

  menu.querySelectorAll<HTMLElement>(".overflow-tab-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = item.dataset.tabId;
      const targetPane = item.dataset.pane as "main" | "sub";
      hideTabOverflowMenu();
      if (!tabId) return;
      if (targetPane === "main") switchToTab(tabId);
      else switchSubTab(tabId);
    });
  });

  const rect = button.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - 280))}px`;
  menu.style.top = `${rect.bottom + 2}px`;
  menu.classList.remove("hidden");
}

function getTabOverflowMenu(): HTMLElement {
  let menu = document.getElementById("tab-overflow-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "tab-overflow-menu";
    menu.className = "hidden";
    document.body.appendChild(menu);
  }
  return menu;
}

function hideTabOverflowMenu() {
  document.getElementById("tab-overflow-menu")?.classList.add("hidden");
}

function renderActiveSubTab() {
  const tab = getActiveSubTab();
  if (!tab) return;
  subFilePath = tab.filePath;
  if (subMode === "edit") {
    const view = ensureSubEditor();
    view.setState(tab.editorState);
    view.dispatch({
      effects: [
        subLineNumbersCompartment.reconfigure(subShowLineNumbers ? lineNumbers() : []),
        subLineWrapCompartment.reconfigure(wrapExtension()),
        subEditorTypographyCompartment.reconfigure(subEditorTypographyTheme()),
      ],
    });
  } else {
    renderSubPreview(tab.editorState.doc.toString());
  }
}

function switchSubTab(id: string) {
  if (id === subActiveTabId) return;
  if (subMode === "edit") saveActiveSubTabState();
  activePane = "sub";
  subActiveTabId = id;
  renderActiveSubTab();
  renderSubTabs();
}

async function closeSubTab(id: string) {
  const tab = subTabs.find(t => t.id === id);
  if (!tab) return;
  if (tab.isModified) {
    if (id !== subActiveTabId) { subActiveTabId = id; renderActiveSubTab(); }
    const shouldSave = await showConfirmDialog(`Save changes to ${tab.title}?`);
    if (shouldSave) await saveSubFile();
  }
  const idx = subTabs.findIndex(t => t.id === id);
  subTabs.splice(idx, 1);
  if (subTabs.length === 0) {
    subActiveTabId = null;
    subFilePath = null;
    setSplit(false);
    renderSubTabs();
    return;
  }
  if (id === subActiveTabId) {
    subActiveTabId = subTabs[Math.min(idx, subTabs.length - 1)].id;
    renderActiveSubTab();
  }
  renderSubTabs();
}

async function openInSubPane(path: string) {
  const existing = subTabs.find(t => t.filePath === path);
  if (existing) {
    subActiveTabId = existing.id;
    setSplit(true);
    renderActiveSubTab();
    renderSubTabs();
    return;
  }
  try {
    const result = await invoke<{ path: string; content: string }>("read_file", { path });
    const tab = createSubTab(result.path, result.content);
    subTabs.push(tab);
    subActiveTabId = tab.id;
    setSplit(true);
    renderActiveSubTab();
    renderSubTabs();
  } catch (e) {
    flashStatus(`Could not open: ${path}`, "var(--red, #f38ba8)");
  }
}

function updateSubModeIcon() {
  const btn = document.getElementById("btn-sub-mode");
  if (btn) btn.textContent = subMode === "edit" ? "👁" : "✎";
  updateSubControlsUI();
}

function setSubMode(mode: "edit" | "preview") {
  const editPane = document.getElementById("sub-editor-pane");
  const prevPane = document.getElementById("sub-pane");
  if (mode === "edit") {
    subMode = "edit";
    const view = ensureSubEditor();
    const tab = getActiveSubTab();
    if (tab) view.setState(tab.editorState);
    view.dispatch({
      effects: [
        subLineNumbersCompartment.reconfigure(subShowLineNumbers ? lineNumbers() : []),
        subLineWrapCompartment.reconfigure(wrapExtension()),
        subEditorTypographyCompartment.reconfigure(subEditorTypographyTheme()),
      ],
    });
    editPane?.classList.remove("hidden");
    prevPane?.classList.add("hidden");
    view.focus();
    activePane = "sub";
  } else {
    if (subMode === "edit") saveActiveSubTabState();
    subMode = "preview";
    const tab = getActiveSubTab();
    if (tab) renderSubPreview(tab.editorState.doc.toString());
    prevPane?.classList.remove("hidden");
    editPane?.classList.add("hidden");
  }
  updateSubModeIcon();
}

function toggleSubMode() {
  setSubMode(subMode === "edit" ? "preview" : "edit");
}

function setSplit(open: boolean) {
  splitOpen = open;
  const wrapper = document.getElementById("sub-pane-wrapper");
  const divider = document.getElementById("sub-divider");
  const bar = document.getElementById("sub-activity-bar");
  const btn = document.getElementById("btn-split");
  wrapper?.classList.toggle("hidden", !open);
  divider?.classList.toggle("hidden", !open);
  bar?.classList.toggle("hidden", !open);
  btn?.classList.toggle("active", open);
  if (!open && activePane === "sub") activePane = "main";
  updateSubControlsUI();
  updateTabBarVisibility();
}

async function toggleSplit() {
  if (!splitOpen) {
    if (subTabs.length === 0 && currentFilePath) { await openInSubPane(currentFilePath); return; }
    setSplit(true);
    renderSubTabs();
    return;
  }
  // Turning split OFF — guard unsaved sub tabs
  const dirty = subTabs.filter(t => t.isModified);
  if (dirty.length > 0) {
    const shouldSave = await showConfirmDialog(`Save ${dirty.length} unsaved sub-pane file(s)?`);
    if (shouldSave) {
      for (const t of dirty) { subActiveTabId = t.id; if (subMode === "edit") saveActiveSubTabState(); await saveSubFile(); }
    }
  }
  setSplit(false);
}

function reapplyPreviewSearch() {
  const bar = document.getElementById("preview-search-bar");
  const input = document.getElementById("preview-search-input") as HTMLInputElement | null;
  if (!bar || bar.classList.contains("hidden") || !input || !input.value) {
    previewSearchMatches = [];
    previewSearchIndex = -1;
    return;
  }
  performPreviewSearch(input.value);
}

// --- Editor ↔ Preview scroll sync ---

let syncScrollEnabled = false;
let isSyncingScroll = false;

function getPreviewLineElements(previewPane: HTMLElement): { line: number; el: HTMLElement }[] {
  const nodes = previewPane.querySelectorAll<HTMLElement>("[data-source-line]");
  const items: { line: number; el: HTMLElement }[] = [];
  nodes.forEach(el => {
    const l = parseInt(el.dataset.sourceLine || "", 10);
    if (!isNaN(l)) items.push({ line: l, el });
  });
  items.sort((a, b) => a.line - b.line);
  return items;
}

function syncPreviewToEditor() {
  const previewPane = document.getElementById("preview-pane");
  const previewWrapper = document.getElementById("preview-pane-wrapper");
  if (!previewPane || !editor || (previewWrapper && previewWrapper.style.display === "none")) return;
  const items = getPreviewLineElements(previewPane);
  if (items.length === 0) return;
  const topY = editor.scrollDOM.getBoundingClientRect().top + 1;
  const pos = editor.posAtCoords({ x: 10, y: topY }, false);
  if (pos == null) return;
  const topLine = editor.state.doc.lineAt(pos).number - 1;
  let target = items[0];
  for (const it of items) {
    if (it.line <= topLine) target = it;
    else break;
  }
  const previewTop = previewPane.getBoundingClientRect().top;
  const elTop = target.el.getBoundingClientRect().top;
  isSyncingScroll = true;
  previewPane.scrollTop += (elTop - previewTop);
  setTimeout(() => { isSyncingScroll = false; }, 60);
}

function syncEditorToPreview() {
  const previewPane = document.getElementById("preview-pane");
  if (!previewPane || !editor) return;
  const previewTop = previewPane.getBoundingClientRect().top;
  const items = getPreviewLineElements(previewPane);
  let topItem = items[0];
  for (const it of items) {
    const r = it.el.getBoundingClientRect();
    if (r.bottom > previewTop) { topItem = it; break; }
  }
  if (!topItem) return;
  const totalLines = editor.state.doc.lines;
  const lineNum = Math.min(Math.max(topItem.line + 1, 1), totalLines);
  const pos = editor.state.doc.line(lineNum).from;
  isSyncingScroll = true;
  editor.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
  setTimeout(() => { isSyncingScroll = false; }, 60);
}

function jumpEditorToPreviewClick(target: EventTarget | null) {
  if (!editor) return;
  let el = target as HTMLElement | null;
  while (el && el !== document.body && !el.dataset?.sourceLine) {
    el = el.parentElement;
  }
  if (!el || !el.dataset.sourceLine) return;
  const line = parseInt(el.dataset.sourceLine, 10);
  if (isNaN(line)) return;
  const totalLines = editor.state.doc.lines;
  const lineNum = Math.min(Math.max(line + 1, 1), totalLines);
  const pos = editor.state.doc.line(lineNum).from;
  editor.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
  editor.focus();
}

function updateSyncScrollButton() {
  const btn = document.getElementById("btn-sync-scroll");
  if (btn) btn.classList.toggle("active", syncScrollEnabled);
}

function toggleSyncScroll() {
  syncScrollEnabled = !syncScrollEnabled;
  updateSyncScrollButton();
}

// Scroll the preview pane to the element matching the given anchor fragment.
// Matches on id attribute (headings) or name attribute (<a name="..."> in table cells).
function scrollPreviewToAnchor(fragment: string) {
  const previewPane = document.getElementById("preview-pane");
  if (!previewPane || !fragment) return;
  const target = previewPane.querySelector(`[id="${CSS.escape(fragment)}"], [name="${CSS.escape(fragment)}"]`) as HTMLElement | null;
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- Word counting ---

async function updateWordCount(content: string) {
  try {
    const result = await invoke<{
      chars: number;
      words: number;
      lines: number;
    }>("word_count", { text: content });

    const el = (id: string) => document.getElementById(id);
    if (el("status-words")) el("status-words")!.textContent = `${result.words} words`;
    if (el("status-tokens")) el("status-tokens")!.textContent = `${result.chars} chars`;
    if (el("token-count")) el("token-count")!.textContent = `${result.words} words`;
    if (el("cost-estimate")) el("cost-estimate")!.textContent = `${result.lines} lines`;
  } catch { /* backend not ready yet */ }
}

// --- Cursor position ---

function updateCursorPosition(view: EditorView) {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const col = pos - line.from + 1;
  const el = document.getElementById("status-position");
  if (el) el.textContent = `Ln ${line.number}, Col ${col}`;
}

// --- File watcher (external changes) ---

let fileWatchSuppressed = false; // suppress events right after we save
let externalReload = false; // suppress onContentChange during external reload
let fileChangeDebounce: ReturnType<typeof setTimeout> | null = null;
let diskChangeCheckInFlight = false;

interface FileSnapshot {
  path: string;
  size: number;
  modified_ms: number;
}

const fileSnapshots = new Map<string, FileSnapshot>();

function rememberFileSnapshot(info: FileSnapshot) {
  const snapshot = {
    path: info.path,
    size: info.size,
    modified_ms: info.modified_ms,
  };
  fileSnapshots.set(snapshot.path, snapshot);
}

async function refreshCurrentFileSnapshot(path = currentFilePath) {
  if (!path) {
    return;
  }
  try {
    const metadata = await invoke<FileSnapshot>("file_metadata", { path });
    if (metadata.path === currentFilePath) rememberFileSnapshot(metadata);
  } catch {
    if (path) fileSnapshots.delete(path);
  }
}

async function startFileWatch(path: string | null) {
  try { await invoke("unwatch_file"); } catch { /* ok */ }
  if (path) {
    try {
      await invoke("watch_file", { path });
    } catch (e) {
      console.warn("watch_file failed:", e);
    }
  }
}

function isEditorDirty(): boolean {
  const indicator = document.getElementById("modified-indicator");
  return indicator ? !indicator.classList.contains("hidden") : false;
}

async function reloadCurrentFile() {
  if (!currentFilePath) return;
  try {
    const result = await invoke<{ path: string; content: string; size: number; modified_ms: number }>("read_file", { path: currentFilePath });
    externalReload = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: result.content },
    });
    externalReload = false;
    rememberFileSnapshot(result);
    setModified(false);
    updatePreview(result.content);
    updateWordCount(result.content);
    updateOutline(result.content);
  } catch { /* file may have been deleted */ }
}

async function handleCurrentFileChangedOnDisk() {
  if (!currentFilePath || isPreviewOnlyPath(currentFilePath)) return;
  if (isEditorDirty()) {
    showFileChangedBanner();
  } else {
    await reloadCurrentFile();
  }
}

async function checkCurrentFileForDiskChanges() {
  if (!currentFilePath || isPreviewOnlyPath(currentFilePath) || diskChangeCheckInFlight) return;
  diskChangeCheckInFlight = true;
  try {
    const metadata = await invoke<FileSnapshot>("file_metadata", { path: currentFilePath });
    const previous = fileSnapshots.get(metadata.path);
    if (!previous) {
      rememberFileSnapshot(metadata);
      return;
    }
    const changed = metadata.size !== previous.size
      || metadata.modified_ms !== previous.modified_ms;
    if (changed) {
      await handleCurrentFileChangedOnDisk();
    }
  } catch {
    if (currentFilePath) fileSnapshots.delete(currentFilePath);
  } finally {
    diskChangeCheckInFlight = false;
  }
}

let fileChangeBanner: HTMLElement | null = null;

function showFileChangedBanner() {
  if (fileChangeBanner && document.body.contains(fileChangeBanner)) return; // already showing

  fileChangeBanner = document.createElement("div");
  fileChangeBanner.className = "file-changed-banner";
  fileChangeBanner.innerHTML = `
    <span>File changed on disk.</span>
    <button id="file-changed-reload">Reload</button>
    <button id="file-changed-dismiss">Keep mine</button>
  `;
  document.body.appendChild(fileChangeBanner);

  document.getElementById("file-changed-reload")?.addEventListener("click", () => {
    reloadCurrentFile();
    fileChangeBanner?.remove();
  }, { once: true });

  document.getElementById("file-changed-dismiss")?.addEventListener("click", () => {
    fileChangeBanner?.remove();
  }, { once: true });
}

listen<string>("file-changed", async (event) => {
  if (fileWatchSuppressed) return;
  if (event.payload !== currentFilePath) return;

  if (fileChangeDebounce) clearTimeout(fileChangeDebounce);
  fileChangeDebounce = setTimeout(async () => {
    await handleCurrentFileChangedOnDisk();
  }, 200);
});

// Folder watcher: refresh sidebar when files are added/removed/renamed externally
let folderWatchDebounce: ReturnType<typeof setTimeout> | null = null;

async function startFolderWatch(path: string | null) {
  try { await invoke("unwatch_folder"); } catch (e) { console.warn("unwatch_folder failed:", e); }
  if (path) {
    try { await invoke("watch_folder", { path }); } catch (e) { console.warn("watch_folder failed:", e); }
  }
}

listen("folder-changed", () => {
  // Debounce to avoid rapid-fire refreshes
  if (folderWatchDebounce) clearTimeout(folderWatchDebounce);
  folderWatchDebounce = setTimeout(() => {
    if (currentFolderPath) refreshSidebar();
  }, 500);
});

function checkDiskChangesOnFocus() {
  if (currentFolderPath) refreshSidebar();
  checkCurrentFileForDiskChanges();
}

window.addEventListener("focus", checkDiskChangesOnFocus);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkDiskChangesOnFocus();
});

// --- Modified state ---

function setModified(value: boolean) {
  const indicator = document.getElementById("modified-indicator");
  if (indicator) indicator.classList.toggle("hidden", !value);
  const tab = getActiveTab();
  if (tab && tab.isModified !== value) {
    tab.isModified = value;
    renderTabs();
  }
}

// --- File operations ---

function setFilename(path: string | null) {
  currentFilePath = path;
  const el = document.getElementById("filename");
  if (el) el.textContent = path ? path.split("/").pop()! : "No file open";
  sessionData.lastFile = path;
  const tab = getActiveTab();
  if (tab) {
    tab.filePath = path;
    tab.title = path ? path.split("/").pop()! : "Untitled";
    renderTabs();
  }
  updateBreadcrumb();
  startFileWatch(path);
}

async function saveFile() {
  const content = editor.state.doc.toString();
  if (currentFilePath && isPreviewOnlyPath(currentFilePath)) {
    flashStatus("Preview-only file. Images, SVG, and PDF are not editable in Kaelio.", "var(--warning)", 4000);
    return;
  }

  if (!currentFilePath) {
    const path = await save({
      filters: [{ name: "Markdown", extensions: ["md"] }],
      defaultPath: "untitled.md",
    });
    if (!path) return;
    try {
      await invoke("save_file", { path, content });
      setFilename(path);
      await refreshCurrentFileSnapshot(path);
      setModified(false);
      deleteRecoveryForCurrent();
      persistOpenTabs();
      if (autoSyncEnabled && currentFolderPath) gitAutoSync(path);
    } catch (e) {
      console.error("Save failed:", e);
    }
    return;
  }
  try {
    fileWatchSuppressed = true;
    await invoke("save_file", { path: currentFilePath, content });
    await refreshCurrentFileSnapshot(currentFilePath);
    setModified(false);
    deleteRecoveryForCurrent();
    persistOpenTabs();
    if (autoSyncEnabled && currentFolderPath) gitAutoSync(currentFilePath);
    setTimeout(() => { fileWatchSuppressed = false; }, 1000);
  } catch (e) {
    fileWatchSuppressed = false;
    console.error("Save failed:", e);
  }
}

async function saveSubFile() {
  const tab = getActiveSubTab();
  if (!tab) return;
  if (subMode === "edit") saveActiveSubTabState();
  if (!tab.filePath) { flashStatus("Sub pane file has no path.", "var(--warning)"); return; }
  const content = tab.editorState.doc.toString();
  try {
    await invoke("save_file", { path: tab.filePath, content });
    tab.isModified = false;
    renderSubTabs();
    if (subMode === "preview") renderSubPreview(content);
    if (autoSyncEnabled && currentFolderPath) gitAutoSync(tab.filePath);
  } catch (e) {
    console.error("Sub save failed:", e);
  }
}

function saveActivePane() {
  if (activePane === "sub" && splitOpen) { saveSubFile(); return; }
  saveFile();
}

async function openFileDialog() {
  const path = await open({
    filters: [
      { name: "Markdown", extensions: ["md", "markdown"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg"] },
      { name: "Text and Code", extensions: ["txt", "yaml", "yml", "json", "toml", "xml", "csv", "log", "html", "htm", "css", "scss", "js", "jsx", "ts", "tsx", "rs", "py", "sh", "bash", "zsh", "sql", "svg", "ini", "conf"] },
      { name: "All Files", extensions: ["*"] },
    ],
    multiple: false,
  });
  if (path) openFile(path as string);
}

async function openFile(path: string, skipScrollRestore = false) {
  // Check if file is already open in a tab
  const existingTab = tabs.find(t => t.filePath === path);
  if (existingTab) {
    switchToTab(existingTab.id);
    return;
  }
  if (currentFilePath && isPdfPath(currentFilePath) && pdfAnnotationsDirty) {
    try {
      await savePdfAnnotations();
    } catch (err) {
      flashStatus(`Annotation save failed: ${err}`, "var(--error)", 5000);
    }
  }

  if (isPreviewOnlyPath(path)) {
    saveScrollPosition();
    saveActiveTabState();

    const tab = createTab(path, `Preview-only file:\n${path}`);
    tabs.push(tab);
    activeTabId = tab.id;
    currentFilePath = path;

    editor.setState(tab.editorState);
    setFilename(path);
    setModified(false);
    addRecentFile(path);
    renderTabs();
    persistOpenTabs();
    updatePreviewOrRevealPreviewOnly("");
    updateWordCount("");
    updateCursorPosition(editor);
    startFileWatch(path);
    refreshCurrentFileSnapshot(path);
    if (!skipScrollRestore) restoreScrollPosition(path);
    return;
  }

  try {
    saveScrollPosition();
    const result = await invoke<{ path: string; content: string; size: number; modified_ms: number }>("read_file", { path });

    // Check again after async (race condition guard)
    const existingAfter = tabs.find(t => t.filePath === result.path);
    if (existingAfter) {
      switchToTab(existingAfter.id);
      return;
    }

    // Save current tab state before switching
    saveActiveTabState();

    const tab = createTab(result.path, result.content);
    tabs.push(tab);
    activeTabId = tab.id;
    currentFilePath = result.path;

    editor.setState(tab.editorState);
    setFilename(result.path);
    setModified(false);
    addRecentFile(result.path);
    deleteRecoveryForCurrent(); // clean up stale recovery for this file
    renderTabs();
    persistOpenTabs();
    rememberFileSnapshot(result);
    // Use result.content directly to avoid stale editor state on Windows
    updatePreview(result.content);
    updateWordCount(result.content);
    updateCursorPosition(editor);
    startFileWatch(result.path);
    if (!skipScrollRestore) restoreScrollPosition(result.path);
  } catch (e) {
    console.error("Open failed:", e);
    flashStatus("Could not open this file. Kaelio supports text files; binary files are not editable.", "var(--error)", 5000);
  }
}

// --- New file ---

async function newFile() {
  if (currentFilePath && isPdfPath(currentFilePath) && pdfAnnotationsDirty) {
    try {
      await savePdfAnnotations();
    } catch (err) {
      flashStatus(`Annotation save failed: ${err}`, "var(--error)", 5000);
    }
  }

  if (currentFolderPath) {
    // Create in current folder
    let name = "untitled.md";
    let counter = 1;
    while (true) {
      try {
        await invoke("create_file", { path: `${currentFolderPath}/${name}` });
        await openFile(`${currentFolderPath}/${name}`);
        refreshSidebar();
        return;
      } catch {
        counter++;
        name = `untitled-${counter}.md`;
      }
    }
  } else {
    // No folder — create a new untitled tab
    saveActiveTabState();
    const tab = createTab(null, "");
    tabs.push(tab);
    activeTabId = tab.id;
    currentFilePath = null;
    editor.setState(tab.editorState);
    setFilename(null);
    setModified(false);
    renderTabs();
    persistOpenTabs();
    updatePreview(editor.state.doc.toString());
  }
}

// --- Auto-save ---

function toggleAutoSave() {
  autoSaveEnabled = !autoSaveEnabled;
  localStorage.setItem("kaelio-autosave", String(autoSaveEnabled));
  updateAutoSaveUI();
}

function updateAutoSaveUI() {
  const label = document.getElementById("autosave-label");
  if (label) label.textContent = autoSaveEnabled ? "On" : "Off";
  const indicator = document.getElementById("autosave-indicator");
  if (indicator) indicator.classList.toggle("hidden", !autoSaveEnabled);
}

function scheduleAutoSave() {
  if (!autoSaveEnabled || !currentFilePath) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (currentFilePath) {
      await saveFile();
      flashStatus("Auto-saved", "var(--success)");
    }
  }, AUTO_SAVE_DELAY);
}

// --- Git integration ---

async function refreshGitStatus() {
  if (!currentFolderPath) return;
  try {
    const info = await invoke<GitRepoInfo>("git_repo_info", { folderPath: currentFolderPath });
    gitRepoInfo = info;
    if (!info.is_repo) { gitStatusMap.clear(); updateGitUI(); return; }
    const statuses = await invoke<GitFileStatus[]>("git_status", { folderPath: currentFolderPath });
    gitStatusMap.clear();
    for (const s of statuses) gitStatusMap.set(s.path, s.status);
    updateGitUI();
    updateTreeGitDots();
  } catch { /* ignore non-git folders */ }
}

function debounceGitRefresh() {
  if (gitRefreshDebounce) clearTimeout(gitRefreshDebounce);
  gitRefreshDebounce = setTimeout(() => refreshGitStatus(), 500);
}

function updateTreeGitDots() {
  if (!currentFolderPath) return;
  const repoRoot = gitRepoInfo ? currentFolderPath : null;
  if (!repoRoot) return;
  document.querySelectorAll("#sidebar-tree .tree-item").forEach(el => {
    const itemEl = el as HTMLElement;
    const filePath = itemEl.dataset.path;
    if (!filePath) return;
    // Remove existing dot
    itemEl.querySelector(".git-dot")?.remove();
    // Compute relative path from folder root
    const rel = filePath.startsWith(repoRoot + "/") ? filePath.slice(repoRoot.length + 1) : filePath;
    const status = gitStatusMap.get(rel);
    if (status) {
      const dot = document.createElement("span");
      dot.className = `git-dot git-${status}`;
      itemEl.appendChild(dot);
    }
  });
}

function updateGitUI() {
  // Status bar branch
  const branchEl = document.getElementById("status-branch");
  if (branchEl) {
    if (gitRepoInfo?.is_repo) {
      branchEl.classList.remove("hidden");
      if (gitRepoInfo.remote_url) {
        // Connected to remote — show sync status
        if (gitRepoInfo.ahead > 0) {
          branchEl.textContent = `⟳ ${gitRepoInfo.ahead} unsaved`;
        } else {
          branchEl.textContent = "✓ Synced";
        }
      } else {
        branchEl.textContent = "Local only";
      }
    } else {
      branchEl.classList.add("hidden");
    }
  }

  // Git panel
  const gitPanel = document.getElementById("git-panel");
  const syncSetup = document.getElementById("sync-setup");
  const syncStatus = document.getElementById("sync-status");
  const changedFiles = document.getElementById("git-changed-files");
  const commitArea = document.getElementById("git-commit-area");
  const panelHeader = document.getElementById("git-panel-header");

  if (gitPanel) {
    if (!gitRepoInfo?.is_repo) {
      // Not a repo — show setup prompt
      if (syncSetup) syncSetup.classList.remove("hidden");
      if (changedFiles) changedFiles.innerHTML = "";
      if (commitArea) commitArea.style.display = "none";
      if (panelHeader) panelHeader.style.display = "none";
      if (syncStatus) syncStatus.textContent = "";
    } else if (!gitRepoInfo.remote_url) {
      // Repo but no remote — show setup
      if (syncSetup) syncSetup.classList.remove("hidden");
      if (commitArea) commitArea.style.display = "";
      if (panelHeader) panelHeader.style.display = "none";
      if (syncStatus) { syncStatus.textContent = "Not connected to cloud"; syncStatus.className = ""; }
      populateChangedFiles(changedFiles);
    } else {
      // Connected — show full panel
      if (syncSetup) syncSetup.classList.add("hidden");
      if (commitArea) commitArea.style.display = "";
      if (panelHeader) panelHeader.style.display = "";
      const branchName = document.getElementById("git-branch-name");
      if (branchName) branchName.textContent = gitRepoInfo.branch;
      if (syncStatus) {
        if (gitStatusMap.size === 0 && gitRepoInfo.ahead === 0) {
          syncStatus.textContent = "✓ All synced";
          syncStatus.className = "synced";
        } else if (gitRepoInfo.ahead > 0) {
          syncStatus.textContent = `${gitRepoInfo.ahead} changes waiting to sync`;
          syncStatus.className = "";
        } else {
          syncStatus.textContent = `${gitStatusMap.size} unsaved changes`;
          syncStatus.className = "";
        }
      }
      populateChangedFiles(changedFiles);
    }
  }

  // Auto-sync label
  const syncLabel = document.getElementById("autosync-git-label");
  if (syncLabel) syncLabel.textContent = autoSyncEnabled ? "On" : "Off";
}

function populateChangedFiles(container: HTMLElement | null) {
  if (!container) return;
  container.innerHTML = "";
  gitStatusMap.forEach((status, path) => {
    const item = document.createElement("div");
    item.className = "git-file-item";
    const dot = document.createElement("span");
    dot.className = `git-dot git-${status}`;
    const name = document.createElement("span");
    name.className = "git-file-name";
    name.textContent = path;
    name.title = path;
    item.appendChild(dot);
    item.appendChild(name);
    item.addEventListener("click", () => {
      if (currentFolderPath) openFile(currentFolderPath + "/" + path);
    });
    container.appendChild(item);
  });
  if (gitStatusMap.size === 0) {
    container.innerHTML = '<div class="git-empty">No changes</div>';
  }
}

function toggleAutoSync() {
  autoSyncEnabled = !autoSyncEnabled;
  localStorage.setItem("kaelio-auto-sync", String(autoSyncEnabled));
  updateGitUI();
  flashStatus(`Auto-sync ${autoSyncEnabled ? "enabled" : "disabled"}`, "var(--accent)");
}

function gitAutoSync(filePath: string) {
  if (!filePath || !currentFolderPath) return;
  // Fire-and-forget — don't block the editor
  invoke<GitSyncResult>("git_auto_sync", {
    folderPath: currentFolderPath,
    filePath: filePath,
  }).then(result => {
    if (result.conflicts.length > 0) {
      flashStatus(`${result.conflicts.length} files need attention`, "var(--error)", 5000);
      if (currentFolderPath) showConflictResolver(currentFolderPath + "/" + result.conflicts[0]);
    } else if (result.pushed) {
      flashStatus("✓ Synced", "var(--success)");
    }
    debounceGitRefresh();
  }).catch(() => { /* silent — don't interrupt typing */ });
}

async function gitManualCommit() {
  if (!currentFolderPath) return;
  const input = document.getElementById("git-commit-input") as HTMLInputElement | null;
  const userMsg = input?.value?.trim();
  // Auto-generate message from changed files if empty
  const message = userMsg || (() => {
    const count = gitStatusMap.size;
    if (count === 0) return "Update files";
    if (count === 1) {
      const [path, status] = [...gitStatusMap.entries()][0];
      const name = path.split("/").pop() || path;
      return status === "new" ? `Add ${name}` : `Update ${name}`;
    }
    return `Update ${count} files`;
  })();
  try {
    await invoke<string>("git_commit", { folderPath: currentFolderPath, files: [], message });
    if (input) input.value = "";
    flashStatus("✓ Saved", "var(--success)");
    // Push in background
    invoke<string>("git_push", { folderPath: currentFolderPath })
      .then(() => { flashStatus("✓ Synced", "var(--success)"); debounceGitRefresh(); })
      .catch(() => debounceGitRefresh());
  } catch (e) {
    flashStatus(`Save failed: ${e}`, "var(--error)", 3000);
  }
}

function gitSync() {
  if (!currentFolderPath) return;
  const folder = currentFolderPath;
  flashStatus("Syncing...", "var(--accent)");
  invoke<GitSyncResult>("git_pull", { folderPath: folder }).then(pullResult => {
    if (pullResult.conflicts.length > 0) {
      flashStatus(`${pullResult.conflicts.length} files need attention`, "var(--error)", 5000);
      showConflictResolver(folder + "/" + pullResult.conflicts[0]);
      debounceGitRefresh();
      return;
    }
    invoke<string>("git_push", { folderPath: folder })
      .then(() => flashStatus("✓ All synced", "var(--success)"))
      .catch(() => flashStatus("✓ Up to date", "var(--success)"))
      .finally(() => { debounceGitRefresh(); refreshSidebar(); });
  }).catch(e => {
    flashStatus(`Sync: ${e}`, "var(--error)", 3000);
  });
}

function timeAgo(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

function showSyncSetup() {
  const modal = document.getElementById("sync-setup-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  // Check auth status
  checkSyncAuth();
}

function hideSyncSetup() {
  document.getElementById("sync-setup-modal")?.classList.add("hidden");
}

async function checkSyncAuth() {
  const statusEl = document.getElementById("sync-auth-status");
  if (!statusEl) return;
  try {
    const hasAuth = await invoke<boolean>("git_check_auth", { remoteUrl: "https://github.com" });
    if (hasAuth) {
      statusEl.textContent = "✓ GitHub connection found";
      statusEl.className = "ok";
    } else {
      statusEl.textContent = "No GitHub credentials found. Run \"gh auth login\" in terminal, or add an SSH key.";
      statusEl.className = "fail";
    }
  } catch {
    statusEl.className = "";
    statusEl.style.display = "none";
  }
}

async function connectSync() {
  if (!currentFolderPath) return;
  const urlInput = document.getElementById("sync-repo-url") as HTMLInputElement;
  const errorEl = document.getElementById("sync-setup-error");
  const btn = document.getElementById("btn-sync-connect") as HTMLButtonElement;
  let url = urlInput?.value?.trim();
  if (!url) { if (errorEl) { errorEl.textContent = "Paste a repository URL"; errorEl.classList.remove("hidden"); } return; }

  // Auto-fix common URL patterns
  if (url.match(/^[\w-]+\/[\w.-]+$/) && !url.includes("://")) {
    url = `https://github.com/${url}.git`; // "user/repo" → full URL
  }
  if (url.startsWith("https://github.com/") && !url.endsWith(".git")) {
    url += ".git";
  }

  if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
  if (errorEl) errorEl.classList.add("hidden");

  try {
    const info = await invoke<GitRepoInfo>("git_setup_sync", { folderPath: currentFolderPath, remoteUrl: url });
    gitRepoInfo = info;
    autoSyncEnabled = true;
    localStorage.setItem("kaelio-auto-sync", "true");
    hideSyncSetup();
    flashStatus("Sync connected!", "var(--success)");
    debounceGitRefresh();
  } catch (e) {
    if (errorEl) {
      errorEl.textContent = `${e}`;
      errorEl.classList.remove("hidden");
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Connect & Sync"; }
  }
}

// --- Conflict resolution (#98) ---

interface GitConflictInfo { path: string; local_content: string; remote_content: string; base_content: string; }
let conflictFilePath: string | null = null;

async function showConflictResolver(filePath: string) {
  if (!currentFolderPath) return;
  conflictFilePath = filePath;
  try {
    const info = await invoke<GitConflictInfo>("git_conflict_info", { folderPath: currentFolderPath, filePath });
    const modal = document.getElementById("conflict-modal");
    const title = document.getElementById("conflict-title");
    const localEl = document.getElementById("conflict-local");
    const remoteEl = document.getElementById("conflict-remote");
    if (!modal || !localEl || !remoteEl) return;
    if (title) title.textContent = `Resolve: ${info.path}`;
    localEl.textContent = info.local_content;
    remoteEl.textContent = info.remote_content;
    modal.classList.remove("hidden");
  } catch (e) {
    flashStatus(`${e}`, "var(--error)", 3000);
  }
}

async function resolveConflict(choice: "local" | "remote" | "both") {
  if (!conflictFilePath || !currentFolderPath) return;
  const localEl = document.getElementById("conflict-local");
  const remoteEl = document.getElementById("conflict-remote");
  if (!localEl || !remoteEl) return;
  let content: string;
  if (choice === "local") content = localEl.textContent || "";
  else if (choice === "remote") content = remoteEl.textContent || "";
  else content = (localEl.textContent || "") + "\n" + (remoteEl.textContent || "");

  try {
    await invoke("git_resolve_conflict", { folderPath: currentFolderPath, filePath: conflictFilePath, content });
    document.getElementById("conflict-modal")?.classList.add("hidden");
    flashStatus("✓ Conflict resolved", "var(--success)");
    // Reload file if open
    if (currentFilePath === conflictFilePath) {
      const info = await invoke<{ content: string }>("read_file", { path: conflictFilePath });
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: info.content } });
      setModified(false);
    }
    debounceGitRefresh();
  } catch (e) {
    flashStatus(`Resolve failed: ${e}`, "var(--error)", 3000);
  }
}

// --- Version history & snapshots (#111) ---

interface SnapshotInfo { file_path: string; timestamp: number; snap_path: string; }
let historyDiffFilePath: string | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
const SNAPSHOT_INTERVAL = 60000; // auto-snapshot every 60s if changed
let lastSnapshotContent: string = "";

function scheduleSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    if (!currentFilePath) return;
    const content = editor.state.doc.toString();
    if (content !== lastSnapshotContent && content.length > 0) {
      lastSnapshotContent = content;
      invoke("save_snapshot", { filePath: currentFilePath, content }).catch(() => {});
    }
  }, SNAPSHOT_INTERVAL);
}

async function showFileHistory() {
  if (!currentFilePath || !currentFolderPath) return;
  historyDiffFilePath = currentFilePath;
  const modal = document.getElementById("history-modal");
  const list = document.getElementById("history-list");
  const diffView = document.getElementById("history-diff");
  if (!modal || !list || !diffView) return;
  list.classList.remove("hidden");
  diffView.classList.add("hidden");
  // Activate commits tab by default
  document.getElementById("history-tab-commits")?.classList.add("active");
  document.getElementById("history-tab-snapshots")?.classList.remove("active");
  await loadHistoryCommits();
  modal.classList.remove("hidden");
}

async function loadHistoryCommits() {
  if (!historyDiffFilePath || !currentFolderPath) return;
  const list = document.getElementById("history-list");
  if (!list) return;
  list.innerHTML = "";
  try {
    const entries = await invoke<GitLogEntry[]>("git_log", {
      folderPath: currentFolderPath, filePath: historyDiffFilePath, limit: 50
    });
    if (entries.length === 0) {
      list.innerHTML = '<div class="history-empty">No commits for this file</div>';
      return;
    }
    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "history-item";
      const ago = timeAgo(entry.timestamp);
      item.innerHTML = `<span class="history-actions"><button data-action="view" data-id="${entry.id}">View</button><button data-action="restore" data-id="${entry.id}">Restore</button></span><span class="history-sha">${entry.id}</span> <span class="history-msg">${escapeHtml(entry.message)}</span><br><span class="history-meta">${escapeHtml(entry.author)} · ${ago}</span>`;
      item.querySelector('[data-action="view"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        showHistoryDiff(entry.id, entry.message, "commit");
      });
      item.querySelector('[data-action="restore"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        restoreFromCommit(entry.id);
      });
      list.appendChild(item);
    }
  } catch (e) {
    list.innerHTML = `<div class="history-empty">Error: ${e}</div>`;
  }
}

async function loadHistorySnapshots() {
  if (!historyDiffFilePath) return;
  const list = document.getElementById("history-list");
  if (!list) return;
  list.innerHTML = "";
  try {
    const snaps = await invoke<SnapshotInfo[]>("list_snapshots", { filePath: historyDiffFilePath });
    if (snaps.length === 0) {
      list.innerHTML = '<div class="history-empty">No snapshots yet. Snapshots are saved automatically as you edit.</div>';
      return;
    }
    for (const snap of snaps) {
      const item = document.createElement("div");
      item.className = "history-item";
      const ago = timeAgo(snap.timestamp);
      const date = new Date(snap.timestamp * 1000).toLocaleString();
      item.innerHTML = `<span class="history-actions"><button data-action="view">View</button><button data-action="restore">Restore</button></span><span class="history-sha">snapshot</span> <span class="history-msg">${date}</span><br><span class="history-meta">${ago}</span>`;
      item.querySelector('[data-action="view"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        showSnapshotDiff(snap.snap_path, date);
      });
      item.querySelector('[data-action="restore"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        restoreFromSnapshot(snap.snap_path);
      });
      list.appendChild(item);
    }
  } catch (e) {
    list.innerHTML = `<div class="history-empty">Error: ${e}</div>`;
  }
}

async function showHistoryDiff(commitId: string, label: string, _type: string) {
  if (!historyDiffFilePath || !currentFolderPath) return;
  try {
    const oldContent = await invoke<string>("git_file_at_commit", {
      folderPath: currentFolderPath, filePath: historyDiffFilePath, commitId
    });
    const newContent = editor.state.doc.toString();
    displayHistoryDiff(oldContent, newContent, `${commitId} — ${label}`);
  } catch (e) {
    flashStatus(`${e}`, "var(--error)", 3000);
  }
}

async function showSnapshotDiff(snapPath: string, label: string) {
  try {
    const oldContent = await invoke<string>("read_snapshot", { snapPath });
    const newContent = editor.state.doc.toString();
    displayHistoryDiff(oldContent, newContent, label);
  } catch (e) {
    flashStatus(`${e}`, "var(--error)", 3000);
  }
}

function displayHistoryDiff(oldContent: string, newContent: string, title: string) {
  const list = document.getElementById("history-list");
  const diffView = document.getElementById("history-diff");
  const diffTitle = document.getElementById("history-diff-title");
  const diffOld = document.getElementById("history-diff-old");
  const diffNew = document.getElementById("history-diff-new");
  if (!list || !diffView || !diffOld || !diffNew) return;
  list.classList.add("hidden");
  diffView.classList.remove("hidden");
  if (diffTitle) diffTitle.textContent = title;
  diffOld.textContent = oldContent;
  diffNew.textContent = newContent;
}

function hideHistoryDiff() {
  document.getElementById("history-list")?.classList.remove("hidden");
  document.getElementById("history-diff")?.classList.add("hidden");
}

async function restoreFromCommit(commitId: string) {
  if (!historyDiffFilePath || !currentFolderPath) return;
  try {
    await invoke("git_restore_file", { folderPath: currentFolderPath, filePath: historyDiffFilePath, commitId });
    if (currentFilePath === historyDiffFilePath) {
      const info = await invoke<{ content: string }>("read_file", { path: historyDiffFilePath });
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: info.content } });
      setModified(false);
    }
    flashStatus("✓ File restored", "var(--success)");
    document.getElementById("history-modal")?.classList.add("hidden");
    debounceGitRefresh();
  } catch (e) {
    flashStatus(`Restore failed: ${e}`, "var(--error)", 3000);
  }
}

async function restoreFromSnapshot(snapPath: string) {
  if (!historyDiffFilePath) return;
  try {
    const content = await invoke<string>("read_snapshot", { snapPath });
    if (currentFilePath === historyDiffFilePath) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
      setModified(true);
    } else {
      await invoke("save_file", { path: historyDiffFilePath, content });
    }
    flashStatus("✓ Snapshot restored", "var(--success)");
    document.getElementById("history-modal")?.classList.add("hidden");
  } catch (e) {
    flashStatus(`Restore failed: ${e}`, "var(--error)", 3000);
  }
}

async function gitDiscardFile(filePath: string) {
  if (!currentFolderPath) return;
  try {
    await invoke("git_discard_file", { folderPath: currentFolderPath, filePath });
    flashStatus("Discarded changes", "var(--success)");
    // Reload the file if it's currently open
    if (currentFilePath === filePath) {
      const info = await invoke<{ content: string }>("read_file", { path: filePath });
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: info.content } });
      setModified(false);
    }
    debounceGitRefresh();
  } catch (e) {
    flashStatus(`Discard: ${e}`, "var(--error)", 3000);
  }
}

// --- Crash recovery ---

function scheduleRecovery() {
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(async () => {
    if (currentFilePath && isEditorDirty()) {
      try {
        await invoke("save_recovery", {
          originalPath: currentFilePath,
          content: editor.state.doc.toString(),
        });
      } catch { /* ignore */ }
    }
    scheduleRecovery();
  }, RECOVERY_INTERVAL);
}

async function deleteRecoveryForCurrent() {
  if (!currentFilePath) return;
  try {
    const files = await invoke<{ original_path: string; recovery_path: string; timestamp: number }[]>("get_recovery_files");
    for (const f of files) {
      if (f.original_path === currentFilePath) {
        await invoke("delete_recovery", { recoveryPath: f.recovery_path });
      }
    }
  } catch { /* ignore */ }
}

async function checkRecovery() {
  try {
    const files = await invoke<{ original_path: string; recovery_path: string; timestamp: number }[]>("get_recovery_files");
    if (files.length === 0) return;

    const banner = document.getElementById("recovery-banner");
    const msg = document.getElementById("recovery-message");
    if (!banner || !msg) return;

    const latest = files.sort((a, b) => b.timestamp - a.timestamp)[0];
    msg.textContent = `Recovered unsaved changes for ${latest.original_path.split("/").pop()}`;
    banner.classList.remove("hidden");

    document.getElementById("recovery-restore")?.addEventListener("click", async () => {
      try {
        const content = await invoke<string>("read_recovery_content", { recoveryPath: latest.recovery_path });
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: content },
        });
        setFilename(latest.original_path);
        setModified(true);
        // Clean up all recovery files
        for (const f of files) {
          await invoke("delete_recovery", { recoveryPath: f.recovery_path });
        }
      } catch { /* ignore */ }
      banner.classList.add("hidden");
    }, { once: true });

    document.getElementById("recovery-dismiss")?.addEventListener("click", async () => {
      for (const f of files) {
        await invoke("delete_recovery", { recoveryPath: f.recovery_path });
      }
      banner.classList.add("hidden");
    }, { once: true });
  } catch { /* ignore */ }
}

// --- Line numbers toggle ---

function toggleLineNumbers() {
  showLineNumbers = !showLineNumbers;
  localStorage.setItem("kaelio-line-numbers", String(showLineNumbers));
  editor.dispatch({
    effects: lineNumbersCompartment.reconfigure(showLineNumbers ? lineNumbers() : []),
  });
  updateLineNumbersUI();
}

function toggleSubLineNumbers() {
  subShowLineNumbers = !subShowLineNumbers;
  if (editorSub) {
    editorSub.dispatch({
      effects: subLineNumbersCompartment.reconfigure(subShowLineNumbers ? lineNumbers() : []),
    });
  }
  updateSubControlsUI();
}

function updateLineNumbersUI() {
  const label = document.getElementById("linenumbers-label");
  if (label) label.textContent = showLineNumbers ? "On" : "Off";
  updateActivityBarUI();
}

function updateSubControlsUI() {
  document.getElementById("btn-sub-mode")?.classList.toggle("active", subMode === "edit");
  document.getElementById("btn-sub-linenumbers")?.classList.toggle("active", subShowLineNumbers);
}

function setWrapMode(mode: WrapMode) {
  wrapMode = mode;
  localStorage.setItem("kaelio-wrap-mode", mode);
  reconfigureWrapEditors();
  applyWrapColumnStyle();
  updateWrapModeUI();
}

function setWrapColumn(value: number) {
  wrapColumn = Math.max(20, Math.min(200, Math.round(value) || 80));
  localStorage.setItem("kaelio-wrap-column", String(wrapColumn));
  reconfigureWrapEditors();
  applyWrapColumnStyle();
  updateWrapModeUI();
}

function reconfigureWrapEditors() {
  editor.dispatch({
    effects: lineWrapCompartment.reconfigure(wrapExtension()),
  });
  if (editorSub) {
    editorSub.dispatch({
      effects: subLineWrapCompartment.reconfigure(wrapExtension()),
    });
  }
}

function applyWrapColumnStyle() {
  const wrapper = document.getElementById("editor-wrapper");
  const subWrapper = document.getElementById("sub-editor-pane");
  [wrapper, subWrapper].forEach(el => {
    if (!el) return;
    el.style.setProperty("--wrap-col", `${wrapColumn}ch`);
    el.classList.toggle("wrap-column", wrapMode === "column");
  });
}

function updateWrapModeUI() {
  const select = document.getElementById("wrap-mode-select") as HTMLSelectElement | null;
  if (select) select.value = wrapMode;
  const control = document.getElementById("wrap-column-control");
  control?.classList.toggle("hidden", wrapMode !== "column");
  const input = document.getElementById("wrap-column-input") as HTMLInputElement | null;
  if (input) input.value = String(wrapColumn);
}

// --- Status flash ---

function flashStatus(text: string, color: string, duration = 2000) {
  const statusWords = document.getElementById("status-words");
  if (!statusWords) return;
  const prevText = statusWords.textContent || "";
  statusWords.textContent = text;
  statusWords.style.color = color;
  setTimeout(() => {
    statusWords.textContent = prevText;
    statusWords.style.color = "";
  }, duration);
}

// --- Custom dialogs (prompt/confirm don't work in Tauri webview) ---

function showInputDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const palette = document.getElementById("command-palette");
    const input = document.getElementById("palette-input") as HTMLInputElement;
    const results = document.getElementById("palette-results");
    if (!palette || !input || !results) { resolve(null); return; }

    palette.classList.remove("hidden");
    input.value = defaultValue;
    input.placeholder = message;
    input.focus();
    if (defaultValue) {
      const dotIdx = defaultValue.lastIndexOf(".");
      input.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultValue.length);
    }
    results.innerHTML = `<div class="palette-item" style="color:var(--muted);pointer-events:none">${escapeHtml(message)} — press Enter to confirm, Esc to cancel</div>`;

    const cleanup = () => {
      palette.classList.add("hidden");
      input.placeholder = "Type a command…";
      input.removeEventListener("keydown", handler);
      document.getElementById("palette-backdrop")?.removeEventListener("click", cancel);
    };
    const cancel = () => { cleanup(); resolve(null); };
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); const v = input.value.trim(); cleanup(); resolve(v || null); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    };
    input.addEventListener("keydown", handler);
    document.getElementById("palette-backdrop")?.addEventListener("click", cancel, { once: true });
  });
}

interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  defaultButton?: "confirm" | "cancel";
}

interface DeleteResult {
  destination: string;
  used_system_trash: boolean;
}

function showConfirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { confirmLabel = "Confirm", cancelLabel = "Cancel", defaultButton = "confirm" } = options;
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "confirm-modal-backdrop";

    const box = document.createElement("div");
    box.className = "confirm-modal";

    const msg = document.createElement("div");
    msg.className = "confirm-modal-message";
    msg.textContent = message;

    const actions = document.createElement("div");
    actions.className = "confirm-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "confirm-modal-btn confirm-modal-cancel";
    cancelBtn.textContent = cancelLabel;

    const okBtn = document.createElement("button");
    okBtn.className = "confirm-modal-btn confirm-modal-confirm";
    okBtn.textContent = confirmLabel;

    actions.append(okBtn, cancelBtn);
    box.append(msg, actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    const primary = defaultButton === "cancel" ? cancelBtn : okBtn;
    primary.classList.add("confirm-modal-default");
    primary.focus();

    const cleanup = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    const done = (v: boolean) => { cleanup(); resolve(v); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(defaultButton === "confirm"); }
    };
    document.addEventListener("keydown", onKey, true);
    cancelBtn.addEventListener("click", () => done(false));
    okBtn.addEventListener("click", () => done(true));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(false); });
  });
}

// --- Debounced content change handler ---

function onContentChange(view: EditorView) {
  if (externalReload) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const content = view.state.doc.toString();
    updatePreview(content);
    updateWordCount(content);
    updateOutline(content);
  }, 300);
  updateCursorPosition(view);
  setModified(true);
  scheduleAutoSave();
  scheduleSnapshot();
}

// --- Divider drag to resize ---

function initDividerDrag() {
  const divider = $("#divider");
  const editorWrapper = $("#editor-wrapper");
  const previewPane = $("#preview-pane-wrapper");
  const container = $("#main-region");
  if (!divider || !editorWrapper || !previewPane || !container) return;

  let dragging = false;

  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    const offset = e.clientX - rect.left;
    const pct = Math.max(20, Math.min(80, (offset / rect.width) * 100));
    editorWrapper.style.flexBasis = `${pct}%`;
    previewPane.style.flexBasis = `${100 - pct}%`;
  });

  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}

function initSubDividerDrag() {
  const divider = document.getElementById("sub-divider");
  const subWrapper = document.getElementById("sub-pane-wrapper");
  const previewPane = document.getElementById("preview-pane-wrapper");
  const container = document.getElementById("editor-container");
  if (!divider || !subWrapper || !previewPane || !container) return;

  let dragging = false;
  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = subWrapper.getBoundingClientRect();
    const right = rect.right;
    const newWidth = Math.max(200, Math.min(right - 200, right - e.clientX));
    subWrapper.style.flexBasis = `${newWidth}px`;
    scheduleSplitTabLayout();
  });
  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}

// --- Sidebar resize ---

function initSidebarResize() {
  const resizer = document.getElementById("sidebar-resizer");
  const sidebar = document.getElementById("sidebar");
  if (!resizer || !sidebar) return;

  let dragging = false;

  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const width = Math.max(140, Math.min(500, e.clientX));
    sidebar.style.width = `${width}px`;
  });

  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("kaelio-sidebar-width", sidebar!.style.width);
    }
  });

  // Restore saved width
  const savedWidth = localStorage.getItem("kaelio-sidebar-width");
  if (savedWidth) sidebar.style.width = savedWidth;
}

// --- View modes: "split" | "editor" | "preview" ---

type ViewMode = "split" | "editor" | "preview";
let currentViewMode: ViewMode = (localStorage.getItem("kaelio-view-mode") as ViewMode) || "split";

function setViewMode(mode: ViewMode) {
  const previewWrapper = $("#preview-pane-wrapper");
  const divider = $("#divider");
  const editorWrapper = $("#editor-wrapper");
  if (!previewWrapper || !divider || !editorWrapper) return;

  currentViewMode = mode;
  localStorage.setItem("kaelio-view-mode", mode);

  if (mode === "split") {
    editorWrapper.style.display = "";
    editorWrapper.style.flexBasis = "";
    divider.style.display = "";
    previewWrapper.style.display = "";
    previewWrapper.style.flexBasis = "";
    updatePreview(editor.state.doc.toString());
  } else if (mode === "editor") {
    editorWrapper.style.display = "";
    editorWrapper.style.flexBasis = "100%";
    divider.style.display = "none";
    previewWrapper.style.display = "none";
    closePreviewSearch();
  } else if (mode === "preview") {
    editorWrapper.style.display = "none";
    divider.style.display = "none";
    previewWrapper.style.display = "";
    previewWrapper.style.flexBasis = "100%";
    updatePreview(editor.state.doc.toString());
  }
  updateActivityBarUI();
}

function togglePreview() {
  setViewMode(currentViewMode === "split" ? "editor" : "split");
}

function toggleReadMode() {
  setViewMode(currentViewMode === "preview" ? "split" : "preview");
}

// --- Drag & drop via Tauri ---

type DropPoint = { x: number; y: number };

function clearTreeDragOver() {
  document.querySelectorAll(".tree-item.drag-over, .tree-item.drop-copy-target").forEach(el => {
    el.classList.remove("drag-over", "drop-copy-target");
  });
}

function dragDropPointFromPayload(payload: unknown): DropPoint | null {
  const position = (payload as { position?: { x: number; y: number } }).position;
  if (!position) return null;
  const raw = { x: position.x, y: position.y };
  if (raw.x >= 0 && raw.y >= 0 && raw.x <= window.innerWidth && raw.y <= window.innerHeight) {
    return raw;
  }
  const ratio = window.devicePixelRatio || 1;
  return { x: position.x / ratio, y: position.y / ratio };
}

function resolveSidebarCopyDestination(point: DropPoint): { destDir: string; targetEl: HTMLElement | null } | null {
  const hit = document.elementFromPoint(point.x, point.y);
  const tree = hit?.closest("#sidebar-tree") as HTMLElement | null;
  if (!tree || !currentFolderPath) return null;

  const row = hit?.closest("#sidebar-tree .tree-item") as HTMLElement | null;
  if (!row) return { destDir: currentFolderPath, targetEl: null };

  const path = row.dataset.path;
  if (!path) return { destDir: currentFolderPath, targetEl: null };
  if (row.classList.contains("directory") || row.dataset.isDir === "true") {
    return { destDir: path, targetEl: row };
  }

  const parent = row.dataset.parentPath || path.substring(0, path.lastIndexOf("/"));
  if (!parent) return { destDir: currentFolderPath, targetEl: null };
  return { destDir: parent, targetEl: row };
}

let sidebarDropExpandTimer: ReturnType<typeof setTimeout> | null = null;
let sidebarDropExpandPath: string | null = null;

function clearSidebarDropExpandTimer() {
  if (sidebarDropExpandTimer) clearTimeout(sidebarDropExpandTimer);
  sidebarDropExpandTimer = null;
  sidebarDropExpandPath = null;
}

function treeDepthFromRow(row: HTMLElement): number {
  const indent = row.querySelector(".tree-indent") as HTMLElement | null;
  const width = parseFloat(indent?.style.width || "0");
  return Number.isFinite(width) ? Math.round(width / 14) : 0;
}

async function expandSidebarDirectoryRow(row: HTMLElement) {
  const path = row.dataset.path;
  if (!path || expandedDirs.has(path)) return;
  const childContainer = row.nextElementSibling as HTMLElement | null;
  if (!childContainer?.classList.contains("tree-children")) return;

  expandedDirs.add(path);
  childContainer.classList.remove("hidden");
  row.querySelector(".tree-chevron")?.classList.add("expanded");
  if (childContainer.children.length === 0) {
    const children = await invoke<DirEntry[]>("list_directory", { path });
    await renderTreeEntries(children, childContainer, treeDepthFromRow(row) + 1);
  }
}

function scheduleSidebarDirectoryExpand(row: HTMLElement) {
  const path = row.dataset.path;
  if (!path || expandedDirs.has(path) || sidebarDropExpandPath === path) return;
  clearSidebarDropExpandTimer();
  sidebarDropExpandPath = path;
  sidebarDropExpandTimer = setTimeout(() => {
    expandSidebarDirectoryRow(row).catch(err => console.warn("drop folder expand failed:", err));
    sidebarDropExpandTimer = null;
    sidebarDropExpandPath = null;
  }, 650);
}

function highlightSidebarCopyDestination(point: DropPoint | null) {
  clearTreeDragOver();
  if (!point) {
    clearSidebarDropExpandTimer();
    return;
  }
  const destination = resolveSidebarCopyDestination(point);
  const target = destination?.targetEl;
  if (!target) {
    clearSidebarDropExpandTimer();
    return;
  }

  const isDirectory = target.classList.contains("directory") || target.dataset.isDir === "true";
  const path = target.dataset.path;
  if (isDirectory && path && !expandedDirs.has(path)) {
    scheduleSidebarDirectoryExpand(target);
    return;
  }

  clearSidebarDropExpandTimer();
  target.classList.add("drop-copy-target");
}

async function copyDroppedPathsIntoFolder(paths: string[], destDir: string) {
  const copied: string[] = [];
  const failures: string[] = [];

  for (const source of paths) {
    try {
      const newPath = await invoke<string>("copy_into_folder", { source, destDir });
      copied.push(newPath);
    } catch (err) {
      failures.push(`${source.split("/").pop() || source}: ${err}`);
    }
  }

  if (copied.length > 0) refreshSidebar();
  if (failures.length === 0) {
    const label = copied.length === 1 ? "item" : "items";
    flashStatus(`Copied ${copied.length} ${label}`, "var(--success)", 3000);
    return;
  }

  console.warn("[kaelio] drop copy failures", failures);
  if (copied.length > 0) {
    flashStatus(`Copied ${copied.length}; ${failures.length} failed`, "var(--warning)", 5000);
  } else {
    flashStatus(`Copy failed: ${failures[0]}`, "var(--error)", 6000);
  }
}

async function initDragDrop() {
  const appWindow = getCurrentWindow();
  await appWindow.onDragDropEvent(async (event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      highlightSidebarCopyDestination(dragDropPointFromPayload(event.payload));
      return;
    }
    if (event.payload.type === "leave") {
      clearTreeDragOver();
      clearSidebarDropExpandTimer();
      return;
    }
    if (event.payload.type === "drop") {
      const paths = event.payload.paths;
      const point = dragDropPointFromPayload(event.payload);
      const destination = point ? resolveSidebarCopyDestination(point) : null;
      clearTreeDragOver();
      clearSidebarDropExpandTimer();
      if (destination && paths.length > 0) {
        await copyDroppedPathsIntoFolder(paths, destination.destDir);
        return;
      }

      const first = paths[0];
      if (first) {
        try {
          await invoke<unknown[]>("list_directory", { path: first });
          openFolder(first);
          return;
        } catch { /* not a directory, continue */ }
        openFile(first);
        return;
      }

      const textFile = paths[0];
      if (textFile) openFile(textFile);
    }
  });
}

// --- Editor fill container theme ---

const editorFillTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
});

const editorLightTheme = EditorView.theme({
  "&": { backgroundColor: "var(--bg)" },
  ".cm-gutters": {
    backgroundColor: "var(--surface)",
    borderRight: "1px solid var(--border)",
    color: "var(--muted)",
  },
  ".cm-activeLineGutter, .cm-activeLine": {
    backgroundColor: "var(--hover-bg)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text)",
  },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--active-bg)",
  },
  ".cm-content": {
    color: "var(--text)",
    caretColor: "var(--text)",
  },
});

// --- Sample content ---

const SAMPLE_CONTENT = `# About Kaelio

**Kaelio** is a lightweight project file viewer and markdown/document reader. Open Markdown, HTML, JSON, CSV, images, SVG, and PDFs from a project folder with a clean preview-first workflow.

## Features

- **Live split preview** with resizable pane
- **Mermaid diagrams** rendered inline
- **KaTeX math** — inline \`$...$\` and display \`$$...$$\`
- **YAML frontmatter** rendered as metadata table
- **Copy formatted** — paste rich HTML into Substack, WordPress, Notion
- **PDF export** via Pandoc with Mermaid support
- **File sidebar** — browse directories
- **Drag & drop** any .md, .yaml, .json, .txt file

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Cmd+O\` | Open file |
| \`Cmd+S\` | Save file |
| \`Cmd+N\` | New file |
| \`Cmd+P\` | Toggle preview |
| \`Cmd+E\` | Read mode (preview only) |
| \`Cmd+B\` | Toggle file sidebar |
| \`Cmd+F\` | Search in file |
| \`Cmd+H\` | Search & replace |
| \`Cmd+Shift+P\` | Command palette |
| \`Cmd+Shift+F\` | File search |
| \`Cmd+Shift+C\` | Copy formatted HTML |

## Mermaid Diagrams

\`\`\`mermaid
graph TD
    A[Open .md file] --> B[CodeMirror Editor]
    B --> C{Content Changed}
    C -->|debounce| D[markdown-it]
    D --> E[KaTeX + Mermaid]
    E --> F[Live Preview]
\`\`\`

## Math Support

Inline: $E = mc^2$ and $\\sum_{i=1}^{n} x_i$

Display:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

## YAML Frontmatter

Files with YAML frontmatter (\`---\` blocks) are rendered as a styled metadata table in the preview pane.

---

**GitHub:** https://github.com/kael-wanderer/kaelio
Forked from [vibery-studio/mx](https://github.com/vibery-studio/mx) under GPL-3.0.

> **Drop a .md file to get started, or just start typing!**
`;

// --- Copy formatted HTML ---

async function copyFormattedHTML() {
  const previewPane = $("#preview-pane");
  if (!previewPane) return;

  const html = previewPane.innerHTML;
  const text = previewPane.innerText;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    flashStatus("Copied!", "var(--success)");
  } catch (e) {
    console.error("Copy failed:", e);
  }
}

// --- Export rendered preview / source documents ---

// --- Sidebar / File tree ---

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
}

function getFileIcon(entry: DirEntry): string {
  if (entry.is_dir) return "";
  const ext = entry.extension;
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "json") return "json";
  if (ext === "ts" || ext === "tsx") return "ts";
  if (ext === "js" || ext === "jsx") return "js";
  if (ext === "rs") return "rs";
  if (ext === "py") return "py";
  if (ext === "sh" || ext === "bash" || ext === "zsh") return "sh";
  if (ext === "sql") return "sql";
  if (ext === "toml") return "toml";
  if (ext === "ini" || ext === "conf") return "cfg";
  if (ext === "yaml" || ext === "yml") return "yml";
  if (ext === "css" || ext === "scss") return "css";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "svg") return "svg";
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "img";
  return "text";
}

const expandedDirs = new Set<string>();

async function loadDirectory(path: string) {
  try {
    const entries = await invoke<DirEntry[]>("list_directory", { path });
    const tree = document.getElementById("sidebar-tree");
    if (!tree) return;
    tree.innerHTML = "";
    await renderTreeEntries(entries, tree, 0);
    debounceGitRefresh();
  } catch (e) {
    console.error("Failed to load directory:", e);
  }
}

// --- Mouse-based drag to move (Tauri intercepts HTML5 drag events) ---

let dragState: { srcPath: string; srcEl: HTMLElement; ghost: HTMLElement } | null = null;
let dragStartPos: { x: number; y: number } | null = null;
const DRAG_THRESHOLD = 5;

function initTreeDrag(item: HTMLElement, entry: DirEntry) {
  item.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // left click only
    dragStartPos = { x: e.clientX, y: e.clientY };

    const onMouseMove = (me: MouseEvent) => {
      if (!dragStartPos) return;

      // Only start drag after threshold
      if (!dragState) {
        const dx = me.clientX - dragStartPos.x;
        const dy = me.clientY - dragStartPos.y;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

        // Start dragging
        item.classList.add("dragging");
        const ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.textContent = entry.name;
        document.body.appendChild(ghost);
        dragState = { srcPath: entry.path, srcEl: item, ghost };
      }

      dragState.ghost.style.left = `${me.clientX + 12}px`;
      dragState.ghost.style.top = `${me.clientY - 10}px`;

      // Highlight drop target
      document.querySelectorAll(".tree-item.drag-over").forEach(el => el.classList.remove("drag-over"));
      const target = document.elementFromPoint(me.clientX, me.clientY)?.closest(".tree-item.directory") as HTMLElement | null;
      if (target && target !== item && target.dataset.path !== entry.path) {
        target.classList.add("drag-over");
      }
    };

    const onMouseUp = async (me: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      if (!dragState) {
        dragStartPos = null;
        return; // Was a click, not a drag
      }

      item.classList.remove("dragging");
      dragState.ghost.remove();
      document.querySelectorAll(".tree-item.drag-over").forEach(el => el.classList.remove("drag-over"));

      // Find drop target
      const targetEl = document.elementFromPoint(me.clientX, me.clientY)?.closest(".tree-item.directory") as HTMLElement | null;
      const srcPath = dragState.srcPath;
      dragState = null;
      dragStartPos = null;

      let destDir: string | null = null;
      if (targetEl && targetEl.dataset.path && targetEl.dataset.path !== srcPath) {
        destDir = targetEl.dataset.path;
      } else {
        // Check if dropped on sidebar-tree empty area (move to root)
        const treeEl = document.elementFromPoint(me.clientX, me.clientY)?.closest("#sidebar-tree");
        if (treeEl && currentFolderPath) {
          destDir = currentFolderPath;
        }
      }

      if (!destDir) return;
      const srcParent = srcPath.substring(0, srcPath.lastIndexOf("/"));
      if (srcParent === destDir) return; // already there
      // Prevent moving a folder into itself
      if (destDir.startsWith(srcPath + "/")) return;

      const srcName = srcPath.split("/").pop()!;
      const destPath = `${destDir}/${srcName}`;
      try {
        await invoke("rename_entry", { oldPath: srcPath, newPath: destPath });
        if (srcPath === currentFilePath) setFilename(destPath);
        refreshSidebar();
      } catch (err) {
        flashStatus(`Move failed: ${err}`, "var(--error)", 3000);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

async function renderTreeEntries(entries: DirEntry[], container: HTMLElement, depth: number) {
  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = `tree-item${entry.is_dir ? " directory" : ""}`;
    if (entry.path === currentFilePath) item.classList.add("active");
    item.dataset.path = entry.path;
    item.dataset.isDir = String(entry.is_dir);
    item.dataset.parentPath = entry.path.substring(0, entry.path.lastIndexOf("/"));

    const indent = `<span class="tree-indent" style="width:${depth * 14}px"></span>`;
    const chevron = entry.is_dir
      ? `<span class="tree-chevron${expandedDirs.has(entry.path) ? " expanded" : ""}">&gt;</span>`
      : '<span class="tree-chevron-placeholder"></span>';

    const badge = entry.is_dir ? "" : `<span class="file-badge file-badge-${getFileIcon(entry)}">${getFileIcon(entry)}</span>`;
    item.innerHTML = `${indent}${chevron}${badge}<span class="name">${entry.name}</span>`;

    // Mouse-based drag to move
    initTreeDrag(item, entry);

    // Context menu on right-click
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, {
        path: entry.path,
        isDir: entry.is_dir,
        parentPath: entry.path.substring(0, entry.path.lastIndexOf("/")),
      });
    });

    if (entry.is_dir) {
      const childContainer = document.createElement("div");
      childContainer.className = "tree-children";
      childContainer.dataset.path = entry.path;
      if (!expandedDirs.has(entry.path)) childContainer.classList.add("hidden");

      item.addEventListener("click", async () => {
        activeSidebarDir = entry.path;
        const isExpanded = expandedDirs.has(entry.path);
        if (isExpanded) {
          expandedDirs.delete(entry.path);
          childContainer.classList.add("hidden");
          item.querySelector(".tree-chevron")?.classList.remove("expanded");
        } else {
          expandedDirs.add(entry.path);
          childContainer.classList.remove("hidden");
          item.querySelector(".tree-chevron")?.classList.add("expanded");
          if (childContainer.children.length === 0) {
            try {
              const children = await invoke<DirEntry[]>("list_directory", { path: entry.path });
              await renderTreeEntries(children, childContainer, depth + 1);
            } catch { /* ignore */ }
          }
        }
      });

      container.appendChild(item);
      container.appendChild(childContainer);

      if (expandedDirs.has(entry.path) && childContainer.children.length === 0) {
        try {
          const children = await invoke<DirEntry[]>("list_directory", { path: entry.path });
          await renderTreeEntries(children, childContainer, depth + 1);
        } catch { /* ignore */ }
      }
    } else {
      item.addEventListener("click", () => {
        activeSidebarDir = entry.path.substring(0, entry.path.lastIndexOf("/"));
        openFile(entry.path);
        document.querySelectorAll("#sidebar-tree .tree-item").forEach(el => el.classList.remove("active"));
        item.classList.add("active");
      });
      container.appendChild(item);
    }
  }
}

function updateSidebarTitle(path: string) {
  const title = document.getElementById("sidebar-title");
  if (title) title.textContent = path.split("/").pop() || "Explorer";
}

function setSidebarVisible(visible: boolean) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("hidden", !visible);
  localStorage.setItem("kaelio-sidebar", sidebar.classList.contains("hidden") ? "false" : "true");
  updateActivityBarUI();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  setSidebarVisible(sidebar.classList.contains("hidden"));
}

async function openFolder(folderPath?: string) {
  let path = folderPath;
  if (!path) {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    path = selected as string;
  }
  currentFolderPath = path;
  sessionData.currentFolder = path;
  sessionData.savedAt = Date.now();
  const json = JSON.stringify(sessionData);
  localStorage.setItem("kaelio-session", json);
  invoke("save_session", { data: json }).catch(() => {});
  expandedDirs.clear();
  const sidebar = document.getElementById("sidebar");
  if (sidebar?.classList.contains("hidden")) {
    setSidebarVisible(true);
  }
  // Pull before loading if auto-sync is on
  if (autoSyncEnabled) {
    try { await invoke("git_pull", { folderPath: path }); } catch { /* no remote or not a repo */ }
  }
  loadDirectory(path);
  updateSidebarTitle(path);
  startFolderWatch(path);
}

function refreshSidebar() {
  if (!currentFolderPath) return;
  // Reset activeSidebarDir if it's outside the current folder
  if (activeSidebarDir && !activeSidebarDir.startsWith(currentFolderPath)) {
    activeSidebarDir = null;
  }
  loadDirectory(currentFolderPath);
}

// --- Context menu ---

function showContextMenu(x: number, y: number, target: { path: string; isDir: boolean; parentPath: string }) {
  const menu = document.getElementById("context-menu");
  if (!menu) return;
  contextMenuTarget = target;

  const isFile = !target.isDir;
  const isPdfFile = isFile && isPdfPath(target.path);
  const hasCompare = !!compareSelected && compareSelected !== target.path;
  document.getElementById("ctx-split-divider")?.classList.toggle("hidden", !isFile);
  document.getElementById("ctx-open-split")?.classList.toggle("hidden", !isFile);
  document.getElementById("ctx-pdf-divider")?.classList.toggle("hidden", !isPdfFile);
  document.getElementById("ctx-extract-pdf-md")?.classList.toggle("hidden", !isPdfFile);
  document.getElementById("ctx-compare-divider")?.classList.toggle("hidden", !isFile);
  document.getElementById("ctx-select-compare")?.classList.toggle("hidden", !isFile);
  document.getElementById("ctx-compare-with")?.classList.toggle("hidden", !(isFile && hasCompare));

  // Always show New File/Folder (for files, uses parent directory)

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");

  // Ensure menu stays within viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  });
}

function hideContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu) menu.classList.add("hidden");
  contextMenuTarget = null;
}

async function ctxNewFile() {
  if (!contextMenuTarget) return;
  const dir = contextMenuTarget.isDir ? contextMenuTarget.path : contextMenuTarget.parentPath;
  hideContextMenu();

  const name = await showInputDialog("File name:", "untitled.md");
  if (!name) return;

  try {
    await invoke("create_file", { path: `${dir}/${name}` });
    refreshSidebar();
    await openFile(`${dir}/${name}`);
  } catch (e) {
    flashStatus(`Error: ${e}`, "var(--error)", 3000);
  }
}

async function ctxNewFolder() {
  if (!contextMenuTarget) return;
  const dir = contextMenuTarget.isDir ? contextMenuTarget.path : contextMenuTarget.parentPath;
  hideContextMenu();

  const name = await showInputDialog("Folder name:");
  if (!name) return;

  try {
    await invoke("create_directory", { path: `${dir}/${name}` });
    refreshSidebar();
  } catch (e) {
    flashStatus(`Error: ${e}`, "var(--error)", 3000);
  }
}

async function ctxDelete() {
  if (!contextMenuTarget) return;
  const target = contextMenuTarget;
  hideContextMenu();

  const name = target.path.split("/").pop()!;
  if (!(await showConfirmDialog(`Are you sure to delete "${name}"?`, { confirmLabel: "Confirm", defaultButton: "cancel" }))) return;

  try {
    console.info("[kaelio] delete_entry invoked", { path: target.path, isDir: target.isDir });
    const result = await invoke<DeleteResult>("delete_entry", { path: target.path });
    console.info("[kaelio] delete_entry moved", result);
    if (target.path === currentFilePath) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "" } });
      setFilename(null);
      setModified(false);
    }
    refreshSidebar();
    const destination = result.used_system_trash ? "System Trash" : result.destination;
    flashStatus(`Moved "${name}" to ${destination}`, "var(--success)", 5000);
  } catch (e) {
    console.error("[kaelio] delete_entry failed", { path: target.path, error: e });
    flashStatus(`Delete failed: ${e}`, "var(--error)", 10000);
  }
}

async function ctxExtractPdfToMarkdown() {
  if (!contextMenuTarget || contextMenuTarget.isDir || !isPdfPath(contextMenuTarget.path)) return;
  const target = contextMenuTarget;
  hideContextMenu();

  try {
    if (currentFilePath !== target.path) {
      await openFile(target.path);
    }
    await extractCurrentPdfToMarkdown();
  } catch (err) {
    flashStatus(`PDF extraction failed: ${err}`, "var(--error)", 5000);
  }
}

async function ctxRename() {
  if (!contextMenuTarget) return;
  const target = contextMenuTarget;
  hideContextMenu();

  const oldName = target.path.split("/").pop()!;
  const treeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(target.path)}"]`);
  if (!treeItem) return;

  const nameSpan = treeItem.querySelector(".name") as HTMLElement;
  if (!nameSpan) return;

  const input = document.createElement("input");
  input.className = "tree-rename-input";
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus();
  // Select name without extension for files
  if (!target.isDir) {
    const dotIdx = oldName.lastIndexOf(".");
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : oldName.length);
  } else {
    input.select();
  }

  const doRename = async () => {
    const newName = input.value.trim();
    if (!newName || newName === oldName) {
      // Cancel — restore original name
      const span = document.createElement("span");
      span.className = "name";
      span.textContent = oldName;
      input.replaceWith(span);
      return;
    }
    const dir = target.path.substring(0, target.path.lastIndexOf("/"));
    const newPath = `${dir}/${newName}`;
    try {
      await invoke("rename_entry", { oldPath: target.path, newPath });
      if (target.path === currentFilePath) {
        setFilename(newPath);
      }
      refreshSidebar();
    } catch (e) {
      flashStatus(`Rename failed: ${e}`, "var(--error)", 3000);
      const span = document.createElement("span");
      span.className = "name";
      span.textContent = oldName;
      input.replaceWith(span);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doRename(); }
    if (e.key === "Escape") {
      const span = document.createElement("span");
      span.className = "name";
      span.textContent = oldName;
      input.replaceWith(span);
    }
  });
  input.addEventListener("blur", doRename);
}

// --- Outline panel ---

let outlineVisible = false;

function toggleOutline() {
  const panel = document.getElementById("outline-panel");
  if (!panel) return;
  outlineVisible = !outlineVisible;
  panel.classList.toggle("hidden", !outlineVisible);
  localStorage.setItem("kaelio-outline", outlineVisible ? "true" : "false");
  if (outlineVisible) updateOutline(editor.state.doc.toString());
}

function updateOutline(content: string) {
  if (!outlineVisible) return;
  const list = document.getElementById("outline-list");
  if (!list) return;

  const headings: { level: number; text: string; line: number }[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
    }
  }

  if (headings.length === 0) {
    list.innerHTML = '<div style="padding: 8px 12px; color: var(--muted); font-size: 11px;">No headings</div>';
    return;
  }

  list.innerHTML = headings.map(h => {
    return `<div class="outline-item outline-h${h.level}" data-line="${h.line}">${escapeHtml(h.text)}</div>`;
  }).join("");

  list.querySelectorAll(".outline-item").forEach(el => {
    el.addEventListener("click", () => {
      const lineNum = parseInt((el as HTMLElement).dataset.line || "1");
      const line = editor.state.doc.line(lineNum);
      editor.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      });
      editor.focus();
    });
  });
}

// --- Command palette ---

interface PaletteCommand {
  label: string;
  shortcut?: string;
  action: () => void;
}

function getCommands(): PaletteCommand[] {
  // Helper to get display shortcut from registry
  const sk = (id: string) => cm6KeyToDisplay(getBinding(id)) || undefined;
  const commands: PaletteCommand[] = [
    { label: "New File", shortcut: sk("file.new"), action: newFile },
    { label: "Open File", shortcut: sk("file.open"), action: openFileDialog },
    { label: "Open Folder", action: () => openFolder() },
    { label: "New Window", shortcut: sk("file.new-window"), action: () => invoke("create_window", { filePath: null }) },
    { label: "Save", shortcut: sk("file.save"), action: saveActivePane },
    { label: "Close Tab", shortcut: sk("file.close-tab"), action: closeActiveTab },
    { label: "Show/Hide Preview", shortcut: sk("view.toggle-preview"), action: togglePreview },
    { label: "Show/Hide Explorer", shortcut: sk("view.toggle-sidebar"), action: toggleSidebar },
    { label: "Reading View", shortcut: sk("view.read-mode"), action: toggleReadMode },
    { label: "Copy Formatted HTML", shortcut: sk("edit.copy-formatted"), action: copyFormattedHTML },
    { label: "Export HTML PDF", action: exportHtmlPdf },
    { label: "Export HTML PNG", action: exportHtmlPng },
    { label: "Export HTML JPG", action: exportHtmlJpg },
    { label: "Export Markdown PDF", action: exportMarkdownPdf },
    { label: "Export Markdown DOCX", action: exportMarkdownDocx },
    { label: "Copy Raw Markdown", action: copyRawMarkdown },
    { label: "Copy Plain Text", action: copyPlainText },
    { label: "Toggle Outline", action: toggleOutline },
    { label: "Show/Hide Line Numbers", action: toggleLineNumbers },
    { label: "Toggle Auto-save", action: toggleAutoSave },
    { label: "Cycle Theme", action: cycleTheme },
    { label: "Zoom In", shortcut: sk("view.zoom-in"), action: zoomIn },
    { label: "Zoom Out", shortcut: sk("view.zoom-out"), action: zoomOut },
    { label: "Zoom Reset", shortcut: sk("view.zoom-reset"), action: zoomReset },
    { label: "File Search", shortcut: sk("search.file-search"), action: openFileSearch },
    { label: "Search in Files", shortcut: sk("search.content-search"), action: () => { sidebarSearchMode ? deactivateSidebarSearch() : activateSidebarSearch(); } },
    { label: "Customize Shortcuts", action: toggleShortcutsModal },
    { label: "Cycle Font", action: cycleFont },
    { label: "Appearance Settings", action: toggleAppearancePopover },
    { label: "Reload Custom CSS", action: loadCustomCSS },
    { label: "Check for Updates", action: () => doUpdateCheck(true) },
    { label: "Keyboard Shortcuts", shortcut: "⌘/", action: toggleHelp },
    { label: "About Kaelio", action: () => invoke("plugin:opener|open_url", { url: "https://github.com/kael-wanderer/kaelio" }) },
  ];
  if (currentFilePath && isPdfPath(currentFilePath)) {
    commands.splice(14, 0, {
      label: "Extract PDF to Markdown",
      action: () => { void extractCurrentPdfToMarkdown(); },
    });
  }
  return commands;
}

let paletteSelectedIndex = 0;

function toggleCommandPalette() {
  const palette = document.getElementById("command-palette");
  if (!palette) return;

  if (!palette.classList.contains("hidden")) {
    palette.classList.add("hidden");
    return;
  }

  palette.classList.remove("hidden");
  const input = document.getElementById("palette-input") as HTMLInputElement;
  input.value = "";
  input.focus();
  paletteSelectedIndex = 0;
  renderPaletteResults("");
}

function renderPaletteResults(query: string) {
  const results = document.getElementById("palette-results");
  if (!results) return;

  const commands = getCommands();
  const q = query.toLowerCase();
  const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands;

  if (paletteSelectedIndex >= filtered.length) paletteSelectedIndex = 0;

  results.innerHTML = filtered.map((cmd, i) => {
    const active = i === paletteSelectedIndex ? " active" : "";
    const shortcut = cmd.shortcut ? `<span class="shortcut">${cmd.shortcut}</span>` : "";
    return `<div class="palette-item${active}" data-index="${i}"><span>${escapeHtml(cmd.label)}</span>${shortcut}</div>`;
  }).join("");

  results.querySelectorAll(".palette-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt((el as HTMLElement).dataset.index || "0");
      const cmd = filtered[idx];
      toggleCommandPalette();
      cmd.action();
    });
  });
}

function handlePaletteKey(e: KeyboardEvent) {
  const palette = document.getElementById("command-palette");
  if (!palette || palette.classList.contains("hidden")) return;

  const input = document.getElementById("palette-input") as HTMLInputElement;
  const q = input.value.toLowerCase();
  const commands = getCommands();
  const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    paletteSelectedIndex = Math.min(paletteSelectedIndex + 1, filtered.length - 1);
    renderPaletteResults(input.value);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    paletteSelectedIndex = Math.max(paletteSelectedIndex - 1, 0);
    renderPaletteResults(input.value);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (filtered[paletteSelectedIndex]) {
      const cmd = filtered[paletteSelectedIndex];
      toggleCommandPalette();
      cmd.action();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    toggleCommandPalette();
  }
}

// --- File search ---

let fileSearchCache: string[] = [];
let fileSearchSelectedIndex = 0;

async function openFileSearch() {
  if (!currentFolderPath) {
    flashStatus("Open a folder first", "var(--warning)");
    return;
  }

  const dialog = document.getElementById("file-search");
  if (!dialog) return;

  if (!dialog.classList.contains("hidden")) {
    dialog.classList.add("hidden");
    return;
  }

  dialog.classList.remove("hidden");
  const input = document.getElementById("filesearch-input") as HTMLInputElement;
  input.value = "";
  input.focus();
  fileSearchSelectedIndex = 0;

  try {
    fileSearchCache = await invoke<string[]>("list_files_recursive", { path: currentFolderPath, maxDepth: 5 });
  } catch {
    fileSearchCache = [];
  }

  renderFileSearchResults("");
}

function closeFileSearch() {
  const dialog = document.getElementById("file-search");
  if (dialog) dialog.classList.add("hidden");
}

function renderFileSearchResults(query: string) {
  const results = document.getElementById("filesearch-results");
  if (!results) return;

  const q = query.toLowerCase();
  const filtered = q
    ? fileSearchCache.filter(f => f.toLowerCase().includes(q)).slice(0, 50)
    : fileSearchCache.slice(0, 50);

  if (fileSearchSelectedIndex >= filtered.length) fileSearchSelectedIndex = 0;

  const prefix = currentFolderPath ? currentFolderPath + "/" : "";

  results.innerHTML = filtered.map((f, i) => {
    const active = i === fileSearchSelectedIndex ? " active" : "";
    const name = f.split("/").pop()!;
    const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
    const dir = rel.substring(0, rel.lastIndexOf("/"));
    return `<div class="filesearch-item${active}" data-index="${i}" data-path="${f.replace(/"/g, "&quot;")}"><span>${escapeHtml(name)}</span><span class="filesearch-path">${escapeHtml(dir)}</span></div>`;
  }).join("");

  results.querySelectorAll(".filesearch-item").forEach(el => {
    el.addEventListener("click", () => {
      const path = (el as HTMLElement).dataset.path!;
      closeFileSearch();
      openFile(path);
    });
  });
}

function handleFileSearchKey(e: KeyboardEvent) {
  const dialog = document.getElementById("file-search");
  if (!dialog || dialog.classList.contains("hidden")) return;

  const input = document.getElementById("filesearch-input") as HTMLInputElement;
  const q = input.value.toLowerCase();
  const filtered = q
    ? fileSearchCache.filter(f => f.toLowerCase().includes(q)).slice(0, 50)
    : fileSearchCache.slice(0, 50);

  if (e.key === "ArrowDown") {
    e.preventDefault();
    fileSearchSelectedIndex = Math.min(fileSearchSelectedIndex + 1, filtered.length - 1);
    renderFileSearchResults(input.value);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    fileSearchSelectedIndex = Math.max(fileSearchSelectedIndex - 1, 0);
    renderFileSearchResults(input.value);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (filtered[fileSearchSelectedIndex]) {
      closeFileSearch();
      openFile(filtered[fileSearchSelectedIndex]);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeFileSearch();
  }
}

// --- Preview search (Cmd+F in preview pane) ---

let previewSearchMatches: HTMLElement[] = [];
let previewSearchIndex = -1;

function openPreviewSearch() {
  const bar = document.getElementById("preview-search-bar");
  if (!bar) return;
  bar.classList.remove("hidden");
  const input = document.getElementById("preview-search-input") as HTMLInputElement;
  input.value = "";
  document.getElementById("preview-search-count")!.textContent = "";
  clearPreviewSearchHighlights();
  clearPdfSearch();
  input.focus();
}

function closePreviewSearch() {
  const bar = document.getElementById("preview-search-bar");
  if (!bar) return;
  bar.classList.add("hidden");
  clearPreviewSearchHighlights();
  clearPdfSearch();
}

function isCurrentPdfPreview(): boolean {
  return Boolean(currentFilePath && isPdfPath(currentFilePath));
}

function clearPdfSearch() {
  document.querySelectorAll("mark.pdf-search-hit").forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
    parent?.normalize();
  });
  pdfSearchMatches = [];
  pdfSearchIndex = -1;
}

function searchPdf(query: string) {
  clearPdfSearch();
  const countEl = document.getElementById("preview-search-count");
  const trimmed = query.trim();
  if (!trimmed) {
    if (countEl) countEl.textContent = "";
    return;
  }

  const lowerQuery = trimmed.toLowerCase();
  const spans = Array.from(document.querySelectorAll(".pdf-text-layer span")) as HTMLElement[];
  for (const span of spans) {
    const text = span.textContent || "";
    const lowerText = text.toLowerCase();
    let index = lowerText.indexOf(lowerQuery);
    if (index === -1) continue;

    const fragment = document.createDocumentFragment();
    let last = 0;
    while (index !== -1) {
      if (index > last) fragment.appendChild(document.createTextNode(text.slice(last, index)));
      const hit = document.createElement("mark");
      hit.className = "pdf-search-hit";
      hit.textContent = text.slice(index, index + trimmed.length);
      fragment.appendChild(hit);
      pdfSearchMatches.push(hit);
      last = index + trimmed.length;
      index = lowerText.indexOf(lowerQuery, last);
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    span.replaceChildren(fragment);
  }

  if (pdfSearchMatches.length) {
    gotoPdfMatch(0);
  } else if (countEl) {
    pdfSearchIndex = -1;
    countEl.textContent = "No results";
  }
}

async function performPdfSearch(query: string) {
  const token = ++pdfSearchToken;
  clearPdfSearch();
  const countEl = document.getElementById("preview-search-count");
  if (!query.trim()) {
    if (countEl) countEl.textContent = "";
    return;
  }
  if (countEl) countEl.textContent = "Searching...";

  await renderCurrentPdfPagesForSearch?.();
  if (token !== pdfSearchToken || !isCurrentPdfPreview()) return;
  searchPdf(query);
}

function gotoPdfMatch(index: number) {
  if (!pdfSearchMatches.length) return;
  pdfSearchMatches[pdfSearchIndex]?.classList.remove("active");
  pdfSearchIndex = (index + pdfSearchMatches.length) % pdfSearchMatches.length;
  const active = pdfSearchMatches[pdfSearchIndex];
  active.classList.add("active");
  active.scrollIntoView({ block: "center" });
  const countEl = document.getElementById("preview-search-count");
  if (countEl) countEl.textContent = `${pdfSearchIndex + 1} / ${pdfSearchMatches.length}`;
}

function clearPreviewSearchHighlights() {
  const pane = document.getElementById("preview-pane");
  if (!pane) return;
  pane.querySelectorAll("mark.preview-search-match").forEach(m => {
    const parent = m.parentNode!;
    parent.replaceChild(document.createTextNode(m.textContent || ""), m);
    parent.normalize();
  });
  previewSearchMatches = [];
  previewSearchIndex = -1;
}

function performPreviewSearch(query: string) {
  if (isCurrentPdfPreview()) {
    void performPdfSearch(query);
    return;
  }

  clearPreviewSearchHighlights();
  const countEl = document.getElementById("preview-search-count")!;
  if (!query) { countEl.textContent = ""; return; }

  const pane = document.getElementById("preview-pane");
  if (!pane) return;

  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const text = node.textContent || "";
    const lower = text.toLowerCase();
    let idx = lower.indexOf(lowerQuery);
    if (idx === -1) continue;

    const parts: (string | HTMLElement)[] = [];
    let last = 0;
    while (idx !== -1) {
      if (idx > last) parts.push(text.slice(last, idx));
      const mark = document.createElement("mark");
      mark.className = "preview-search-match";
      mark.textContent = text.slice(idx, idx + query.length);
      parts.push(mark);
      last = idx + query.length;
      idx = lower.indexOf(lowerQuery, last);
    }
    if (last < text.length) parts.push(text.slice(last));

    const frag = document.createDocumentFragment();
    for (const p of parts) {
      frag.appendChild(typeof p === "string" ? document.createTextNode(p) : p);
    }
    node.parentNode!.replaceChild(frag, node);
  }

  previewSearchMatches = Array.from(pane.querySelectorAll("mark.preview-search-match"));
  if (previewSearchMatches.length > 0) {
    previewSearchIndex = 0;
    previewSearchMatches[0].classList.add("active");
    previewSearchMatches[0].scrollIntoView({ block: "center" });
    countEl.textContent = `1 / ${previewSearchMatches.length}`;
  } else {
    previewSearchIndex = -1;
    countEl.textContent = "No results";
  }
}

function navigatePreviewSearch(delta: number) {
  if (isCurrentPdfPreview()) {
    gotoPdfMatch(pdfSearchIndex + delta);
    return;
  }

  if (previewSearchMatches.length === 0) return;
  previewSearchMatches[previewSearchIndex]?.classList.remove("active");
  previewSearchIndex = (previewSearchIndex + delta + previewSearchMatches.length) % previewSearchMatches.length;
  previewSearchMatches[previewSearchIndex].classList.add("active");
  previewSearchMatches[previewSearchIndex].scrollIntoView({ block: "center" });
  document.getElementById("preview-search-count")!.textContent =
    `${previewSearchIndex + 1} / ${previewSearchMatches.length}`;
}

// --- Sidebar search ---

interface SearchResult {
  result_type: "filename" | "content";
  file_path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

// Navigate editor to exact keyword position and sync preview scroll.
// Uses double-rAF so all pending rAFs (CodeMirror scroll, restoreScrollPosition)
// have already fired before we read scrollTop and sync the preview.
async function navigateToSearchResult(result: SearchResult) {
  const line = Math.max(1, result.line_number);
  const lineInfo = editor.state.doc.line(Math.min(line, editor.state.doc.lines));
  const anchor = Math.min(lineInfo.from + result.match_start, lineInfo.to);
  const head = Math.min(lineInfo.from + result.match_end, lineInfo.to);
  editor.dispatch({ selection: { anchor, head }, scrollIntoView: true });
  editor.focus();
  // Double-rAF: wait for all pending animation frames (scroll ops) to settle
  requestAnimationFrame(() => {
    requestAnimationFrame(async () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      await updatePreview(editor.state.doc.toString());
      const previewPane = document.getElementById("preview-pane");
      const editorScroll = editor.scrollDOM;
      if (!previewPane || !editorScroll) return;
      const pct = editorScroll.scrollTop / Math.max(1, editorScroll.scrollHeight - editorScroll.clientHeight);
      previewPane.scrollTop = pct * Math.max(0, previewPane.scrollHeight - previewPane.clientHeight);
    });
  });
}

let sidebarSearchMode = false;
let sidebarSearchDebounce: ReturnType<typeof setTimeout> | null = null;
let sidebarSearchResults: SearchResult[] = [];
let sidebarSearchSelectedIndex = 0;

function activateSidebarSearch() {
  if (!currentFolderPath) {
    flashStatus("Open a folder first", "var(--warning)");
    return;
  }
  sidebarSearchMode = true;
  sidebarSearchResults = [];
  sidebarSearchSelectedIndex = 0;

  // Show search panel, hide tree and outline
  document.getElementById("sidebar-search-panel")?.classList.remove("hidden");
  document.getElementById("sidebar-tree")?.classList.add("hidden");
  document.getElementById("outline-panel")?.classList.add("hidden");

  // Make folder title clickable to exit search
  const title = document.getElementById("sidebar-title");
  if (title) title.classList.add("clickable");

  // Clear and focus input
  const input = document.getElementById("sidebar-search-input") as HTMLInputElement;
  if (input) { input.value = ""; input.focus(); }

  renderSidebarSearchResults();
}

function deactivateSidebarSearch() {
  sidebarSearchMode = false;
  if (sidebarSearchDebounce) clearTimeout(sidebarSearchDebounce);

  // Hide search panel, show tree
  document.getElementById("sidebar-search-panel")?.classList.add("hidden");
  document.getElementById("sidebar-tree")?.classList.remove("hidden");

  // Remove clickable style from title
  const title = document.getElementById("sidebar-title");
  if (title) title.classList.remove("clickable");
}

async function doSidebarSearch(query: string) {
  if (!query.trim() || !currentFolderPath) {
    sidebarSearchResults = [];
    renderSidebarSearchResults();
    return;
  }
  try {
    sidebarSearchResults = await invoke<SearchResult[]>("search_in_files", {
      folderPath: currentFolderPath,
      query: query.trim(),
    });
  } catch {
    sidebarSearchResults = [];
  }
  sidebarSearchSelectedIndex = 0;
  renderSidebarSearchResults();
}

function renderSidebarSearchResults() {
  const container = document.getElementById("sidebar-search-results");
  if (!container) return;

  if (sidebarSearchResults.length === 0) {
    const input = document.getElementById("sidebar-search-input") as HTMLInputElement;
    const hasQuery = input?.value.trim();
    container.innerHTML = hasQuery
      ? `<div class="sidebar-search-empty">No results</div>`
      : "";
    return;
  }

  const prefix = currentFolderPath ? currentFolderPath + "/" : "";
  container.innerHTML = sidebarSearchResults.map((r, i) => {
    const active = i === sidebarSearchSelectedIndex ? " active" : "";
    const relPath = r.file_path.startsWith(prefix) ? r.file_path.slice(prefix.length) : r.file_path;
    const fileName = relPath.split("/").pop()!;
    const dir = relPath.substring(0, relPath.lastIndexOf("/"));
    if (r.result_type === "filename") {
      const before = escapeHtml(fileName.substring(0, r.match_start));
      const match = escapeHtml(fileName.substring(r.match_start, r.match_end));
      const after = escapeHtml(fileName.substring(r.match_end));
      return `<div class="sidebar-search-item filename-result${active}" data-index="${i}">
        <div><span class="ss-file">${before}<span class="ss-match">${match}</span>${after}</span></div>
        ${dir ? `<span class="ss-content">${escapeHtml(dir)}</span>` : ""}
      </div>`;
    }
    const before = escapeHtml(r.line_content.substring(0, r.match_start));
    const match = escapeHtml(r.line_content.substring(r.match_start, r.match_end));
    const after = escapeHtml(r.line_content.substring(r.match_end));
    return `<div class="sidebar-search-item${active}" data-index="${i}">
      <div><span class="ss-file">${escapeHtml(fileName)}</span>${dir ? `<span class="ss-meta">${escapeHtml(dir)}</span>` : ""}<span class="ss-meta">:${r.line_number}</span></div>
      <span class="ss-content">${before}<span class="ss-match">${match}</span>${after}</span>
    </div>`;
  }).join("");

  container.querySelectorAll(".sidebar-search-item").forEach((el, i) => {
    el.addEventListener("click", () => openSidebarSearchResult(i));
  });
}

async function openSidebarSearchResult(index: number) {
  const result = sidebarSearchResults[index];
  if (!result) return;
  if (result.result_type === "filename") {
    await openFile(result.file_path);
    return;
  }
  await openFile(result.file_path, true);
  navigateToSearchResult(result);
}

// --- Scroll position memory (#9) ---

const scrollPositions = new Map<string, number>();

function saveScrollPosition() {
  if (!currentFilePath) return;
  const scroller = editor.scrollDOM;
  if (scroller) scrollPositions.set(currentFilePath, scroller.scrollTop);
}

function restoreScrollPosition(path: string) {
  const pos = scrollPositions.get(path);
  if (pos !== undefined) {
    requestAnimationFrame(() => {
      editor.scrollDOM.scrollTop = pos;
    });
  }
}

// --- Tab management ---

function wrapExtension() {
  return wrapMode === "off" ? [] : EditorView.lineWrapping;
}

function createEditorExtensions() {
  return [
    lineNumbersCompartment.of(showLineNumbers ? lineNumbers() : []),
    lineWrapCompartment.of(wrapExtension()),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    bracketMatching(),
    closeBrackets(),
    foldGutter(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    search(),
    themeCompartment.of(getEffectiveTheme() === "dark" ? oneDark : editorLightTheme),
    editorTypographyCompartment.of(editorTypographyTheme()),
    editorFillTheme,
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    keymapCompartment.of(buildKeymap()),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged || update.selectionSet) {
        if (update.docChanged) onContentChange(update.view);
        updateCursorPosition(update.view);
        updateSelectionCount(update.view);
      }
    }),
  ];
}

function createTab(filePath: string | null, content: string): Tab {
  return {
    id: crypto.randomUUID(),
    filePath,
    title: filePath ? filePath.split("/").pop()! : "Untitled",
    editorState: EditorState.create({ doc: content, extensions: createEditorExtensions() }),
    scrollTop: 0,
    previewScrollTop: 0,
    isModified: false,
  };
}

function createSubEditorExtensions() {
  return [
    subLineNumbersCompartment.of(subShowLineNumbers ? lineNumbers() : []),
    subLineWrapCompartment.of(wrapExtension()),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    bracketMatching(),
    closeBrackets(),
    foldGutter(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    search(),
    getEffectiveTheme() === "dark" ? oneDark : editorLightTheme,
    subEditorTypographyCompartment.of(subEditorTypographyTheme()),
    editorFillTheme,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
    buildKeymap(),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      const tab = subTabs.find(t => t.id === subActiveTabId);
      if (tab && !tab.isModified) { tab.isModified = true; renderSubTabs(); }
    }),
  ];
}

function createSubTab(filePath: string | null, content: string): Tab {
  return {
    id: crypto.randomUUID(),
    filePath,
    title: filePath ? filePath.split("/").pop()! : "Untitled",
    editorState: EditorState.create({ doc: content, extensions: createSubEditorExtensions() }),
    scrollTop: 0,
    previewScrollTop: 0,
    isModified: false,
  };
}

function getActiveSubTab(): Tab | null {
  return subTabs.find(t => t.id === subActiveTabId) ?? null;
}

function ensureSubEditor(): EditorView {
  if (editorSub) return editorSub;
  const parent = document.getElementById("sub-editor-pane")!;
  const active = getActiveSubTab();
  editorSub = new EditorView({
    state: active ? active.editorState : EditorState.create({ doc: "", extensions: createSubEditorExtensions() }),
    parent,
  });
  editorSub.dom.addEventListener("focusin", () => { activePane = "sub"; });
  return editorSub;
}

function saveActiveSubTabState() {
  const tab = getActiveSubTab();
  if (!tab || !editorSub) return;
  tab.editorState = editorSub.state;
}

function saveActiveTabState() {
  const tab = getActiveTab();
  if (!tab || !editor) return;
  tab.editorState = editor.state;
  tab.scrollTop = editor.scrollDOM.scrollTop;
  const previewPane = document.getElementById("preview-pane");
  if (previewPane) tab.previewScrollTop = previewPane.scrollTop;
}

function switchToTab(tabId: string) {
  if (tabId === activeTabId) return;
  if (currentFilePath && isPdfPath(currentFilePath) && pdfAnnotationsDirty) {
    void savePdfAnnotations();
  }

  // Save current tab state
  saveActiveTabState();

  const newTab = tabs.find(t => t.id === tabId);
  if (!newTab) return;

  activeTabId = tabId;
  currentFilePath = newTab.filePath;

  // Restore editor state
  editor.setState(newTab.editorState);
  // Get content from new tab state before any async operations
  const tabContent = newTab.editorState.doc.toString();

  // Restore scroll positions after layout
  requestAnimationFrame(() => {
    editor.scrollDOM.scrollTop = newTab.scrollTop;
    const previewPane = document.getElementById("preview-pane");
    if (previewPane) previewPane.scrollTop = newTab.previewScrollTop;
  });

  // Update UI
  const el = document.getElementById("filename");
  if (el) el.textContent = newTab.filePath ? newTab.filePath.split("/").pop()! : "No file open";
  if (newTab.filePath) sessionData.lastFile = newTab.filePath;

  const indicator = document.getElementById("modified-indicator");
  if (indicator) indicator.classList.toggle("hidden", !newTab.isModified);

  updateBreadcrumb();
  startFileWatch(newTab.filePath);
  checkCurrentFileForDiskChanges();
  updatePreviewOrRevealPreviewOnly(tabContent);
  updateWordCount(tabContent);
  updateCursorPosition(editor);
  renderTabs();
  persistOpenTabs();
}

function renderTabs() {
  const tabBar = document.getElementById("main-tabs");
  if (!tabBar) return;

  // Hide tab bar if 0 or 1 tabs
  if (tabs.length <= 1) {
    tabBar.innerHTML = "";
    updateTabBarVisibility();
    return;
  }

  const tabHtml = tabs.map(tab => {
    const activeClass = tab.id === activeTabId ? " active" : "";
    const modifiedDot = tab.isModified ? '<span class="tab-modified">●</span>' : "";
    const title = tab.title || "Untitled";
    return `<div class="tab${activeClass}" data-tab-id="${tab.id}">
      <span class="tab-title">${escapeHtml(title)}</span>
      ${modifiedDot}
      <span class="tab-close" data-tab-id="${tab.id}">✕</span>
    </div>`;
  }).join("");
  tabBar.innerHTML = `${tabHtml}<button class="tab-overflow-btn hidden" data-pane="main" title="More tabs" aria-label="More tabs">▾</button>`;

  // Event listeners
  tabBar.querySelectorAll(".tab").forEach(el => {
    const tabId = (el as HTMLElement).dataset.tabId!;

    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("tab-close")) return;
      switchToTab(tabId);
    });

    // Middle-click to close
    el.addEventListener("mousedown", (e) => {
      if ((e as MouseEvent).button === 1) {
        e.preventDefault();
        closeTab(tabId);
      }
    });

    // Right-click context menu
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showTabContextMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, tabId);
    });
  });

  tabBar.querySelectorAll(".tab-close").forEach(el => {
    const tabId = (el as HTMLElement).dataset.tabId!;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tabId);
    });
  });
  tabBar.querySelector(".tab-overflow-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    showTabOverflowMenu("main", e.currentTarget as HTMLElement);
  });
  updateTabBarVisibility();
  scheduleSplitTabLayout();
}

function updateTabBarVisibility() {
  const tabBar = document.getElementById("tab-bar");
  const mainTabs = document.getElementById("main-tabs");
  const subTabsEl = document.getElementById("sub-tabs");
  if (!tabBar || !mainTabs || !subTabsEl) return;
  const hasMainTabs = !!mainTabs.querySelector(".tab");
  const hasSubTabs = splitOpen && subTabs.length > 0;
  tabBar.classList.toggle("hidden", !hasMainTabs && !hasSubTabs);
  tabBar.classList.toggle("split-tabs", splitOpen);
  subTabsEl.classList.toggle("hidden", !splitOpen);
  scheduleSplitTabLayout();
}

async function closeTab(tabId: string) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  if (tab.filePath && tab.filePath === currentFilePath && isPdfPath(tab.filePath) && pdfAnnotationsDirty) {
    try {
      await savePdfAnnotations();
    } catch (err) {
      flashStatus(`Annotation save failed: ${err}`, "var(--error)", 5000);
    }
  }

  // Check for unsaved changes
  if (tab.isModified) {
    // If not active, switch to it first so user can see the content
    if (tabId !== activeTabId) switchToTab(tabId);
    const shouldSave = await showConfirmDialog(`Save changes to ${tab.title}?`);
    if (shouldSave) {
      await saveFile();
    }
    // If user chose not to save, proceed to close. There's no cancel path with showConfirmDialog.
  }

  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // Create a new untitled tab
    const newTab = createTab(null, "");
    tabs.push(newTab);
    activeTabId = newTab.id;
    currentFilePath = null;
    editor.setState(newTab.editorState);
    setFilename(null);
    setModified(false);
    renderTabs();
    persistOpenTabs();
    return;
  }

  if (tabId === activeTabId) {
    // Switch to adjacent tab
    const newIdx = Math.min(idx, tabs.length - 1);
    activeTabId = tabs[newIdx].id;
    const newTab = tabs[newIdx];
    currentFilePath = newTab.filePath;
    editor.setState(newTab.editorState);

    requestAnimationFrame(() => {
      editor.scrollDOM.scrollTop = newTab.scrollTop;
      const previewPane = document.getElementById("preview-pane");
      if (previewPane) previewPane.scrollTop = newTab.previewScrollTop;
    });

    const el = document.getElementById("filename");
    if (el) el.textContent = newTab.filePath ? newTab.filePath.split("/").pop()! : "No file open";
    if (newTab.filePath) sessionData.lastFile = newTab.filePath;

    const indicator = document.getElementById("modified-indicator");
    if (indicator) indicator.classList.toggle("hidden", !newTab.isModified);

    updateBreadcrumb();
    startFileWatch(newTab.filePath);
    checkCurrentFileForDiskChanges();
    const content = editor.state.doc.toString();
    updatePreviewOrRevealPreviewOnly(content);
    updateWordCount(content);
    updateCursorPosition(editor);
  }

  renderTabs();
  persistOpenTabs();
}

function closeActiveTab() {
  if (activeTabId) closeTab(activeTabId);
}

// --- Tab context menu ---

let tabContextTarget: string | null = null;

function showTabContextMenu(x: number, y: number, tabId: string) {
  const menu = document.getElementById("tab-context-menu");
  if (!menu) return;
  tabContextTarget = tabId;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  });
}

function hideTabContextMenu() {
  const menu = document.getElementById("tab-context-menu");
  if (menu) menu.classList.add("hidden");
  tabContextTarget = null;
}

async function closeOtherTabs(tabId: string) {
  const toClose = tabs.filter(t => t.id !== tabId).map(t => t.id);
  for (const id of toClose) await closeTab(id);
}

async function closeTabsToRight(tabId: string) {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  const toClose = tabs.slice(idx + 1).map(t => t.id);
  for (const id of toClose) await closeTab(id);
}

async function closeAllTabs() {
  const toClose = tabs.map(t => t.id);
  for (const id of toClose) await closeTab(id);
}

function persistOpenTabs() {
  if (!isMainWindow) return;
  const active = getActiveTab();
  if (active && editor) {
    active.scrollTop = editor.scrollDOM.scrollTop;
    const pp = document.getElementById("preview-pane");
    if (pp) active.previewScrollTop = pp.scrollTop;
  }
  const tabData = tabs.map(t => ({
    filePath: t.filePath,
    isActive: t.id === activeTabId,
    scrollTop: t.scrollTop,
    previewScrollTop: t.previewScrollTop,
    cursorOffset: t.editorState.selection.main.head,
  }));
  sessionData.openTabs = tabData;
  sessionData.currentFolder = currentFolderPath;
  sessionData.lastFile = currentFilePath;
  sessionData.savedAt = Date.now();
  const json = JSON.stringify(sessionData);
  localStorage.setItem("kaelio-session", json);
  invoke("save_session", { data: json }).catch(() => {});
}

// --- Selection count (#6) ---

function updateSelectionCount(view: EditorView) {
  const sel = view.state.selection.main;
  const el = document.getElementById("status-selection");
  if (!el) return;
  if (sel.empty) {
    el.textContent = "";
    return;
  }
  const text = view.state.sliceDoc(sel.from, sel.to);
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  el.textContent = `(${words} words, ${chars} chars selected)`;
}

function updateActivityBarUI() {
  const sidebar = document.getElementById("sidebar");
  document.getElementById("activity-explorer")?.classList.toggle("active", !!sidebar && !sidebar.classList.contains("hidden"));
  document.getElementById("activity-preview")?.classList.toggle("active", currentViewMode === "split");
  document.getElementById("activity-reading")?.classList.toggle("active", currentViewMode === "preview");
  document.getElementById("activity-linenumbers")?.classList.toggle("active", showLineNumbers);
}

type AppearancePanel = "theme" | "font" | "size" | "session";
let activeAppearancePanel: AppearancePanel = "theme";

function toggleAppearancePopover() {
  const popover = document.getElementById("appearance-popover");
  if (!popover) return;
  const isHidden = popover.classList.toggle("hidden");
  document.getElementById("activity-settings")?.classList.toggle("active", !isHidden);
  if (!isHidden) renderAppearancePanel(activeAppearancePanel);
}

function closeAppearancePopover() {
  document.getElementById("appearance-popover")?.classList.add("hidden");
  document.getElementById("activity-settings")?.classList.remove("active");
}

function appearanceItem(label: string, value: string, isActive: boolean) {
  return `<button class="appearance-option${isActive ? " active" : ""}" data-value="${escapeHtml(value)}"><span>${escapeHtml(label)}</span>${isActive ? "<span>✓</span>" : ""}</button>`;
}

function sizeAppearanceItem(scope: "editor" | "explorer", label: string, value: string, isActive: boolean) {
  return `<button class="appearance-option${isActive ? " active" : ""}" data-scope="${scope}" data-value="${escapeHtml(value)}"><span>${escapeHtml(label)}</span>${isActive ? "<span>✓</span>" : ""}</button>`;
}

function setRestoreLastSession(enabled: boolean) {
  restoreLastSession = enabled;
  localStorage.setItem("kaelio-restore-session", enabled ? "true" : "false");
}

function renderAppearancePanel(panel: AppearancePanel) {
  activeAppearancePanel = panel;
  document.querySelectorAll(".appearance-tab").forEach(tab => {
    tab.classList.toggle("active", (tab as HTMLElement).dataset.panel === panel);
  });
  const container = document.getElementById("appearance-panel");
  if (!container) return;

  if (panel === "theme") {
    const items: { label: string; value: ThemeMode }[] = [
      { label: "System", value: "auto" },
      { label: "Light", value: "light" },
      { label: "Dark", value: "dark" },
      { label: "Catppuccin Mocha", value: "catppuccin-mocha" },
      { label: "Everforest Dark", value: "everforest-dark" },
      { label: "Nord", value: "nord" },
      { label: "Custom...", value: "custom" },
    ];
    container.innerHTML = items.map(item => appearanceItem(item.label, item.value, currentThemeMode === item.value)).join("");
  } else if (panel === "font") {
    const items = ["System", "Inter", "Georgia", "Merriweather", "JetBrains Mono", "Custom..."];
    container.innerHTML = items.map(item => {
      const active = item === "Custom..." ? !FONT_OPTIONS.includes(currentFont as typeof FONT_OPTIONS[number]) : currentFont === item;
      return appearanceItem(item, item, active);
    }).join("");
  } else if (panel === "size") {
    const editorItems = ["12", "14", "16", "18", "20", "24", "Custom..."];
    const explorerItems = ["12", "13", "14", "15", "16", "18", "Custom..."];
    const editorHtml = editorItems.map(item => {
      const active = item === "Custom..." ? !TEXT_SIZE_OPTIONS.includes(String(currentTextSize) as typeof TEXT_SIZE_OPTIONS[number]) : currentTextSize === Number(item);
      return sizeAppearanceItem("editor", item === "Custom..." ? item : `${item}px`, item, active);
    }).join("");
    const explorerHtml = explorerItems.map(item => {
      const active = item === "Custom..." ? !EXPLORER_SIZE_OPTIONS.includes(String(currentExplorerTextSize) as typeof EXPLORER_SIZE_OPTIONS[number]) : currentExplorerTextSize === Number(item);
      return sizeAppearanceItem("explorer", item === "Custom..." ? item : `${item}px`, item, active);
    }).join("");
    container.innerHTML = `
      <div class="appearance-section">
        <div class="appearance-section-title">Editor and Preview</div>
        ${editorHtml}
      </div>
      <div class="appearance-section">
        <div class="appearance-section-title">Explorer</div>
        ${explorerHtml}
      </div>
    `;
  } else if (panel === "session") {
    container.innerHTML = `
      <label class="appearance-toggle">
        <input id="restore-session-toggle" type="checkbox" ${restoreLastSession ? "checked" : ""} />
        <span>
          <strong>Restore last session</strong>
          <small>Reopen the last project folder and file when Kaelio starts.</small>
        </span>
      </label>
    `;
  }

  container.querySelectorAll(".appearance-option").forEach(option => {
    option.addEventListener("click", async () => {
      const value = (option as HTMLElement).dataset.value || "";
      if (activeAppearancePanel === "theme") await setTheme(value as ThemeMode);
      if (activeAppearancePanel === "font") await setFont(value);
      if (activeAppearancePanel === "size") {
        const scope = (option as HTMLElement).dataset.scope;
        if (scope === "explorer") await setExplorerTextSize(value);
        else await setTextSize(value);
      }
      renderAppearancePanel(activeAppearancePanel);
    });
  });

  const restoreToggle = document.getElementById("restore-session-toggle") as HTMLInputElement | null;
  restoreToggle?.addEventListener("change", () => {
    setRestoreLastSession(restoreToggle.checked);
  });
}

// --- Help cheatsheet modal ---

function toggleHelp() {
  const modal = document.getElementById("help-modal");
  if (!modal) return;
  if (!modal.classList.contains("hidden")) {
    modal.classList.add("hidden");
    return;
  }
  const content = document.getElementById("help-content");
  if (content) {
    // Build from registry + some fixed entries
    const registryBindings = getDefaultBindings();
    const groups = new Map<string, [string, string][]>();
    for (const def of registryBindings) {
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group)!.push([cm6KeyToDisplay(getBinding(def.id)), def.label]);
    }
    // Add fixed shortcuts not in registry
    if (!groups.has("Search")) groups.set("Search", []);
    groups.get("Search")!.push(["⌘F", "Find in file"], ["⌘H", "Find & replace"]);
    if (!groups.has("Edit")) groups.set("Edit", []);
    groups.get("Edit")!.push(["⌘Z/⌘⇧Z", "Undo/redo"], ["Tab/⇧Tab", "Indent/outdent"]);

    content.innerHTML = Array.from(groups.entries()).map(([group, keys]) =>
      `<div class="help-group"><h3>${group}</h3>${keys.map(([k, d]) =>
        `<div class="help-row"><kbd>${k || "—"}</kbd><span>${d}</span></div>`
      ).join("")}</div>`
    ).join("") + `<div class="help-customize"><button id="help-customize-btn">Customize Shortcuts...</button></div>`;

    document.getElementById("help-customize-btn")?.addEventListener("click", () => {
      modal.classList.add("hidden");
      toggleShortcutsModal();
    });
  }
  modal.classList.remove("hidden");
}

// --- Copy modes (#4) ---

async function copyRawMarkdown() {
  const content = editor.state.doc.toString();
  await navigator.clipboard.writeText(content);
  flashStatus("Copied raw markdown!", "var(--success)");
}

async function copyPlainText() {
  const previewPane = $("#preview-pane");
  if (!previewPane) return;
  await navigator.clipboard.writeText(previewPane.innerText);
  flashStatus("Copied plain text!", "var(--success)");
}

// --- Duplicate file (#16) ---

async function ctxDuplicate() {
  if (!contextMenuTarget) return;
  const target = contextMenuTarget;
  hideContextMenu();
  try {
    const newPath = await invoke<string>("duplicate_entry", { path: target.path });
    refreshSidebar();
    if (!target.isDir) await openFile(newPath);
    flashStatus("Duplicated!", "var(--success)");
  } catch (e) {
    flashStatus(`Duplicate failed: ${e}`, "var(--error)", 3000);
  }
}

// --- Copy file path (#10) ---

async function ctxCopyAbsolutePath() {
  if (!contextMenuTarget) return;
  const target = contextMenuTarget;
  hideContextMenu();
  await navigator.clipboard.writeText(target.path);
  flashStatus("Absolute path copied!", "var(--success)");
}

async function ctxCopyRelativePath() {
  if (!contextMenuTarget) return;
  const target = contextMenuTarget;
  hideContextMenu();
  const relative = currentFolderPath
    ? target.path.replace(currentFolderPath + "/", "")
    : target.path;
  await navigator.clipboard.writeText(relative);
  flashStatus("Relative path copied!", "var(--success)");
}

// --- Reveal in Finder (#20) ---

async function ctxReveal() {
  if (!contextMenuTarget) return;
  const target = contextMenuTarget;
  hideContextMenu();
  try {
    await invoke("reveal_in_finder", { path: target.path });
  } catch (e) {
    flashStatus(`Failed: ${e}`, "var(--error)", 3000);
  }
}

function ctxOpenSplit() {
  if (!contextMenuTarget) return;
  const path = contextMenuTarget.path;
  hideContextMenu();
  openInSubPane(path);
}

function ctxSelectCompare() {
  if (!contextMenuTarget) return;
  compareSelected = contextMenuTarget.path;
  flashStatus(`Selected for compare: ${compareSelected.split("/").pop()}`, "var(--accent)");
  hideContextMenu();
}

async function ctxCompareWith() {
  if (!contextMenuTarget || !compareSelected) return;
  const a = compareSelected;
  const b = contextMenuTarget.path;
  hideContextMenu();
  await openFile(a);
  await openInSubPane(b);
  compareSelected = null;
}

const EXPORT_CAPTURE_WIDTH = 1200;
const EXPORT_MAX_CANVAS_DIMENSION = 16000;
const EXPORT_MAX_CANVAS_AREA = 16_000_000;
const EXPORT_SOURCE_SLICE_HEIGHT = 4096;

function getCaptureWidth(sourceWidth: number) {
  return Math.max(EXPORT_CAPTURE_WIDTH, Math.min(Math.max(sourceWidth, 1), 1800));
}

function getExportPixelRatio(width: number, height: number) {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  return Math.max(0.2, Math.min(
    2,
    EXPORT_MAX_CANVAS_DIMENSION / safeWidth,
    EXPORT_MAX_CANVAS_DIMENSION / safeHeight,
    Math.sqrt(EXPORT_MAX_CANVAS_AREA / (safeWidth * safeHeight)),
  ));
}

// html-to-image sizes its canvas to the node's CSS width, so content wider than
// that width (tables, code blocks, Mermaid) gets clipped on the right. Widen the
// node to its full content width before capture so nothing overflows.
async function fitNodeToContentWidth(node: HTMLElement): Promise<void> {
  const contentWidth = Math.max(node.scrollWidth, node.clientWidth, 1);
  if (contentWidth > node.clientWidth) {
    node.style.width = `${contentWidth}px`;
    node.style.maxWidth = "none";
    await nextPaint();
  }
}

function captureRect(rect: DOMRect) {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function logCaptureDiagnostics(label: string, node: HTMLElement, width: number, height: number, pixelRatio: number) {
  const nodeRect = node.getBoundingClientRect();
  let widestChild: {
    tag: string;
    id: string;
    className: string;
    text: string;
    rect: ReturnType<typeof captureRect>;
    rightFromNode: number;
  } | null = null;

  Array.from(node.querySelectorAll("*")).forEach(child => {
    const rect = child.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return;
    if (!widestChild || rect.width > widestChild.rect.width) {
      const className = typeof (child as HTMLElement).className === "string"
        ? (child as HTMLElement).className
        : "";
      widestChild = {
        tag: child.tagName.toLowerCase(),
        id: child.id || "",
        className,
        text: (child.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        rect: captureRect(rect),
        rightFromNode: Math.round(rect.right - nodeRect.left),
      };
    }
  });

  const style = getComputedStyle(node);
  console.info("[kaelio] export capture diagnostics", {
    label,
    nodeRect: captureRect(nodeRect),
    scrollWidth: node.scrollWidth,
    scrollHeight: node.scrollHeight,
    clientWidth: node.clientWidth,
    clientHeight: node.clientHeight,
    offsetWidth: node.offsetWidth,
    offsetHeight: node.offsetHeight,
    toImage: { width, height, pixelRatio },
    style: {
      position: style.position,
      left: style.left,
      top: style.top,
      margin: style.margin,
      transform: style.transform,
      boxSizing: style.boxSizing,
    },
    widestChild,
  });
}

function renderMarkdownPreviewHtml(content: string): string {
  const { frontmatter, body } = extractFrontmatter(content);
  let html = "";
  let lineOffset = 0;
  if (frontmatter) {
    html += renderFrontmatter(frontmatter);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fmMatch) lineOffset = (fmMatch[0].match(/\n/g) || []).length;
  }
  html += md.render(body, { lineOffset });
  html = renderCallouts(html);
  html = renderChecklists(html);
  html = renderKaTeX(html);
  html = processMermaidBlocks(html);
  return sanitizeHtmlString(html);
}

function numericAttribute(el: Element, name: string): number {
  const value = el.getAttribute(name);
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function svgViewBoxSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  return {
    width: numericAttribute(svg, "width"),
    height: numericAttribute(svg, "height"),
  };
}

function detectHtmlArtboard(doc: Document): { width: number; height: number } | null {
  const explicitFrame = doc.getElementById("frame") as HTMLElement | null;
  if (explicitFrame) {
    const width = Math.max(explicitFrame.offsetWidth, numericAttribute(explicitFrame, "width"));
    const height = Math.max(explicitFrame.offsetHeight, numericAttribute(explicitFrame, "height"));
    if (width > 0 && height > 0) return { width, height };
  }

  let best: { width: number; height: number } | null = null;
  doc.querySelectorAll("svg").forEach(svg => {
    const size = svgViewBoxSize(svg as SVGSVGElement);
    if (size.width <= 0 || size.height <= 0) return;
    if (!best || size.width * size.height > best.width * best.height) best = size;
  });
  return best;
}

function preparePreviewCaptureNode(): { node: HTMLElement; cleanup: () => void } {
  const previewPane = document.getElementById("preview-pane");
  if (!previewPane) throw new Error("Preview pane is not available");

  const frame = previewPane.querySelector(".html-preview-frame") as HTMLIFrameElement | null;
  const doc = frame?.contentDocument;
  if (frame && doc?.body) {
    const artboard = detectHtmlArtboard(doc);
    const width = artboard?.width ?? getCaptureWidth(Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth, frame?.clientWidth || 1));
    const host = document.createElement("div");
    host.className = "export-capture-host export-print-theme";
    host.style.width = `${width}px`;
    if (artboard) host.style.height = `${artboard.height}px`;
    applyLightExportTheme(host);

    const base = doc.createElement("base");
    if (currentFilePath) {
      const parent = currentFilePath.split("/").slice(0, -1).join("/");
      base.href = convertFileSrc(`${parent}/`);
    }

    const styles = Array.from(doc.querySelectorAll("style"))
      .map(style => style.textContent || "")
      .join("\n");
    host.appendChild(base);
    Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).forEach(link => {
      const href = (link as HTMLLinkElement).href;
      if (!href) return;
      const clone = document.createElement("link");
      clone.rel = "stylesheet";
      clone.href = href;
      host.appendChild(clone);
    });
    const style = document.createElement("style");
    const artboardCss = artboard ? `
      .export-capture-host #stage {
        position: relative !important;
        inset: auto !important;
        display: block !important;
        width: ${artboard.width}px !important;
        height: ${artboard.height}px !important;
        overflow: visible !important;
        place-items: initial !important;
      }
      .export-capture-host #frame {
        position: relative !important;
        width: ${artboard.width}px !important;
        height: ${artboard.height}px !important;
        transform: none !important;
        transform-origin: top left !important;
      }
      .export-capture-host svg {
        max-width: none !important;
      }
    ` : "";
    style.textContent = `${styles}\n${artboardCss}\n${EXPORT_LIGHT_THEME_CSS}`;
    host.appendChild(style);
    appendSanitizedHtml(host, doc.body.innerHTML);
    document.body.appendChild(host);
    const height = artboard?.height ?? Math.max(host.scrollHeight, host.clientHeight, doc.documentElement.scrollHeight, doc.body.scrollHeight, 1);
    host.style.height = `${height}px`;
    return {
      node: host,
      cleanup: () => host.remove(),
    };
  }

  // Markdown / structured / plain preview: render into an off-flow host so the
  // capture isn't clipped by `#preview-pane`'s overflow, flex sizing, or split width.
  const fullWidth = getCaptureWidth(Math.max(previewPane.scrollWidth, previewPane.clientWidth, 1));
  const host = document.createElement("div");
  host.id = "preview-pane";
  host.className = `${previewPane.className} export-capture-host export-print-theme`.trim();
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = `${fullWidth}px`;
  host.style.maxWidth = "none";
  host.style.overflow = "visible";
  host.style.flex = "none";
  applyLightExportTheme(host);
  if (!currentFilePath || isMarkdownPath(currentFilePath)) {
    appendSanitizedHtml(host, renderMarkdownPreviewHtml(editor.state.doc.toString()));
  } else {
    appendSanitizedHtml(host, previewPane.innerHTML);
  }
  document.body.appendChild(host);
  const fullHeight = Math.max(host.scrollHeight, host.clientHeight, previewPane.scrollHeight, previewPane.clientHeight, 1);
  host.style.height = `${fullHeight}px`;
  return {
    node: host,
    cleanup: () => host.remove(),
  };
}

const EXPORT_LIGHT_THEME_CSS = `
  .export-print-theme {
    margin: 0 !important;
    transform: none !important;
    box-sizing: border-box !important;
  }
  .export-print-theme > *:first-child { margin-top: 0 !important; }
  .export-print-theme > *:last-child { margin-bottom: 0 !important; }
  .export-print-theme,
  #preview-pane.export-print-theme {
    --bg: #ffffff;
    --surface: #f8fafc;
    --border: #d1d5db;
    --text: #111827;
    --accent: #2563eb;
    --warning: #b45309;
    --muted: #6b7280;
    --heading-color: #111827;
    --strong-color: #111827;
    --code-bg: #f3f4f6;
    --code-color: #9f1239;
    --preview-bg: #ffffff;
    --preview-text: #111827;
    background: #ffffff !important;
    color: #111827 !important;
  }
  .export-print-theme *,
  #preview-pane.export-print-theme * {
    text-shadow: none !important;
  }
  .export-print-theme h1,
  .export-print-theme h2,
  .export-print-theme h3,
  .export-print-theme h4,
  .export-print-theme h5,
  .export-print-theme h6,
  .export-print-theme strong,
  #preview-pane.export-print-theme h1,
  #preview-pane.export-print-theme h2,
  #preview-pane.export-print-theme h3,
  #preview-pane.export-print-theme h4,
  #preview-pane.export-print-theme h5,
  #preview-pane.export-print-theme h6,
  #preview-pane.export-print-theme strong {
    color: #111827 !important;
  }
  .export-print-theme a,
  #preview-pane.export-print-theme a {
    color: #1d4ed8 !important;
  }
  .export-print-theme blockquote,
  #preview-pane.export-print-theme blockquote {
    color: #374151 !important;
    background: #f9fafb !important;
    border-color: #d1d5db !important;
  }
  .export-print-theme code,
  #preview-pane.export-print-theme code {
    color: #9f1239 !important;
    background: #f3f4f6 !important;
  }
  .export-print-theme pre,
  #preview-pane.export-print-theme pre,
  .export-print-theme th,
  #preview-pane.export-print-theme th {
    color: #111827 !important;
    background: #f3f4f6 !important;
  }
  .export-print-theme pre code,
  #preview-pane.export-print-theme pre code {
    color: #111827 !important;
    background: transparent !important;
  }
  .export-print-theme td,
  #preview-pane.export-print-theme td,
  .export-print-theme li,
  #preview-pane.export-print-theme li,
  .export-print-theme p,
  #preview-pane.export-print-theme p {
    color: #111827 !important;
  }
  .export-print-theme th,
  .export-print-theme td,
  #preview-pane.export-print-theme th,
  #preview-pane.export-print-theme td {
    border-color: #d1d5db !important;
  }
  .export-print-theme .callout,
  #preview-pane.export-print-theme .callout {
    color: #111827 !important;
    background: #eff6ff !important;
  }
  .export-print-theme .mermaid,
  #preview-pane.export-print-theme .mermaid {
    background: #ffffff !important;
    border-color: #d1d5db !important;
  }
`;

function applyLightExportTheme(node: HTMLElement) {
  node.style.setProperty("--bg", "#ffffff");
  node.style.setProperty("--surface", "#f8fafc");
  node.style.setProperty("--border", "#d1d5db");
  node.style.setProperty("--text", "#111827");
  node.style.setProperty("--accent", "#2563eb");
  node.style.setProperty("--warning", "#b45309");
  node.style.setProperty("--muted", "#6b7280");
  node.style.setProperty("--heading-color", "#111827");
  node.style.setProperty("--strong-color", "#111827");
  node.style.setProperty("--code-bg", "#f3f4f6");
  node.style.setProperty("--code-color", "#9f1239");
  node.style.setProperty("--preview-bg", "#ffffff");
  node.style.setProperty("--preview-text", "#111827");
  node.style.background = "#ffffff";
  node.style.color = "#111827";
}

function appendSanitizedHtml(target: HTMLElement, html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeDetachedHtml(template.content);
  target.appendChild(template.content);
}

function sanitizeHtmlString(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  sanitizeDetachedHtml(container);
  return container.innerHTML;
}

function sanitizeDetachedHtml(root: ParentNode) {
  root.querySelectorAll("script, iframe[srcdoc]").forEach(el => el.remove());
  root.querySelectorAll("*").forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if ((name === "href" || name === "src" || name === "xlink:href") && value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  });
}

function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid image data");
  return dataUrl.slice(comma + 1);
}

function nextPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function waitForPreviewAssets(node: HTMLElement) {
  const mermaidNodes = node.querySelectorAll(".mermaid");
  if (mermaidNodes.length > 0) {
    try {
      await mermaid.run({ nodes: mermaidNodes as unknown as ArrayLike<HTMLElement> });
    } catch { /* mermaid render errors are non-fatal for export */ }
  }
  await (document as globalThis.Document & { fonts?: FontFaceSet }).fonts?.ready.catch(() => undefined);
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(images.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }));
  await nextPaint();
  node.style.height = `${Math.max(node.scrollHeight, node.clientHeight, 1)}px`;
  await nextPaint();
}

async function waitForCaptureSliceAssets(node: HTMLElement) {
  await (document as globalThis.Document & { fonts?: FontFaceSet }).fonts?.ready.catch(() => undefined);
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(images.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }));
  await nextPaint();
}

async function withPreviewAvailable<T>(work: () => Promise<T>): Promise<T> {
  const previousViewMode = currentViewMode;
  if (previousViewMode !== "preview") {
    setViewMode("preview");
    await nextPaint();
  }
  try {
    return await work();
  } finally {
    if (previousViewMode !== "preview") setViewMode(previousViewMode);
  }
}

function prepareCaptureSliceFrame(
  node: HTMLElement,
  width: number,
  sourceHeight: number,
  sourceY: number,
  sliceHeight: number,
) {
  const frame = document.createElement("div");
  frame.className = "export-capture-host export-print-theme";
  frame.style.width = `${width}px`;
  frame.style.height = `${sliceHeight}px`;
  frame.style.maxWidth = "none";
  frame.style.overflow = "hidden";
  frame.style.background = "#ffffff";
  frame.style.color = "#111827";
  applyLightExportTheme(frame);

  const clone = node.cloneNode(true) as HTMLElement;
  clone.classList.remove("export-capture-host");
  clone.classList.add("export-print-theme");
  clone.style.position = "relative";
  clone.style.left = "0";
  clone.style.top = `-${sourceY}px`;
  clone.style.width = `${width}px`;
  clone.style.height = `${sourceHeight}px`;
  clone.style.minHeight = `${sourceHeight}px`;
  clone.style.maxWidth = "none";
  clone.style.margin = "0";
  clone.style.overflow = "visible";
  clone.style.transform = "none";
  applyLightExportTheme(clone);

  frame.appendChild(clone);
  document.body.appendChild(frame);
  return {
    frame,
    cleanup: () => frame.remove(),
  };
}

async function stitchImageDataUrls(
  slices: { dataUrl: string; width: number; height: number }[],
  mime: string,
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (slices.length === 0) throw new Error("No image slices were captured");
  const width = Math.max(...slices.map(slice => slice.width));
  const height = slices.reduce((sum, slice) => sum + slice.height, 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare stitched export canvas");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const slice of slices) {
    const image = await loadImageDataUrl(slice.dataUrl);
    ctx.drawImage(image, 0, y);
    y += slice.height;
  }
  return { dataUrl: canvas.toDataURL(mime, quality), width, height };
}

async function captureNodeImage(
  node: HTMLElement,
  label: string,
  mime = "image/png",
  quality = 0.95,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const width = Math.max(node.scrollWidth, node.clientWidth, 1);
  const height = Math.max(node.scrollHeight, node.clientHeight, 1);
  if (width < 10 || height < 10) {
    throw new Error(`Preview is empty or not laid out (size ${width}x${height}). Try switching to preview mode first.`);
  }
  const pixelRatio = getExportPixelRatio(width, height);
  logCaptureDiagnostics(label, node, width, height, pixelRatio);

  let raw: { dataUrl: string; width: number; height: number };
  if (height <= EXPORT_SOURCE_SLICE_HEIGHT) {
    const dataUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio,
      width,
      height,
      backgroundColor: "#ffffff",
    });
    const image = await loadImageDataUrl(dataUrl);
    raw = { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
  } else {
    const slices: { dataUrl: string; width: number; height: number }[] = [];
    for (let sourceY = 0; sourceY < height; sourceY += EXPORT_SOURCE_SLICE_HEIGHT) {
      const sliceHeight = Math.min(EXPORT_SOURCE_SLICE_HEIGHT, height - sourceY);
      const prepared = prepareCaptureSliceFrame(node, width, height, sourceY, sliceHeight);
      try {
        await waitForCaptureSliceAssets(prepared.frame);
        const dataUrl = await toPng(prepared.frame, {
          cacheBust: true,
          pixelRatio,
          width,
          height: sliceHeight,
          backgroundColor: "#ffffff",
        });
        const image = await loadImageDataUrl(dataUrl);
        console.info("[kaelio] export capture slice", {
          label,
          sourceY,
          sliceHeight,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        });
        slices.push({ dataUrl, width: image.naturalWidth, height: image.naturalHeight });
      } finally {
        prepared.cleanup();
      }
    }
    raw = await stitchImageDataUrls(slices, mime, quality);
  }

  console.info("[kaelio] export capture output", {
    label,
    sourceWidth: width,
    sourceHeight: height,
    naturalWidth: raw.width,
    naturalHeight: raw.height,
    sliced: height > EXPORT_SOURCE_SLICE_HEIGHT,
  });
  return autoCropImageDataUrl(raw.dataUrl, { mime, quality });
}

async function capturePreviewPng(): Promise<{ dataUrl: string; width: number; height: number }> {
  return withPreviewAvailable(async () => {
    const prepared = preparePreviewCaptureNode();
    const node = prepared.node;
    try {
      await waitForPreviewAssets(node);
      await fitNodeToContentWidth(node);
      return await captureNodeImage(node, "capturePreviewPng", "image/png");
    } finally {
      prepared.cleanup();
    }
  });
}

function loadImageDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read captured preview image"));
    image.src = dataUrl;
  });
}

// WKWebView's html-to-image capture can leave large blank margins / position the
// content with an offset. Trim the surrounding white so the export is tight,
// regardless of where WebKit placed the content. Keeps a small uniform margin.
async function autoCropImageDataUrl(
  dataUrl: string,
  opts: { mime?: string; quality?: number; pad?: number } = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { mime = "image/png", quality = 0.95, pad = 16 } = opts;
  const image = await loadImageDataUrl(dataUrl);
  const w = image.naturalWidth, h = image.naturalHeight;
  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  const sctx = src.getContext("2d");
  if (!sctx || w < 2 || h < 2) return { dataUrl, width: w, height: h };
  sctx.drawImage(image, 0, 0);
  const data = sctx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // "content" = visibly non-white, non-transparent pixel
      if (data[i + 3] > 8 && (data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { dataUrl, width: w, height: h }; // all blank

  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  if (cw >= w && ch >= h) return { dataUrl, width: w, height: h };

  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  const octx = out.getContext("2d");
  if (!octx) return { dataUrl, width: w, height: h };
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, cw, ch);
  octx.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
  return { dataUrl: out.toDataURL(mime, quality), width: cw, height: ch };
}

async function sliceImageDataUrl(dataUrl: string, maxSliceHeight: number): Promise<{ dataUrl: string; width: number; height: number }[]> {
  const image = await loadImageDataUrl(dataUrl);
  const slices: { dataUrl: string; width: number; height: number }[] = [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image export canvas");

  const sliceHeight = Math.max(1, Math.floor(maxSliceHeight));
  canvas.width = image.naturalWidth;
  for (let sourceY = 0; sourceY < image.naturalHeight; sourceY += sliceHeight) {
    const height = Math.min(sliceHeight, image.naturalHeight - sourceY);
    canvas.height = height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, sourceY, image.naturalWidth, height, 0, 0, image.naturalWidth, height);
    slices.push({
      dataUrl: canvas.toDataURL("image/png"),
      width: image.naturalWidth,
      height,
    });
  }
  return slices;
}

function getActiveMarkdownContent(): string {
  if (activePane === "sub" && splitOpen) {
    if (editorSub) {
      saveActiveSubTabState();
      return editorSub.state.doc.toString();
    }
    const tab = getActiveSubTab();
    return tab ? tab.editorState.doc.toString() : "";
  }
  saveActiveTabState();
  return editor.state.doc.toString();
}

function getActiveExportPath(): string | null {
  if (activePane === "sub" && splitOpen) {
    return getActiveSubTab()?.filePath ?? subFilePath;
  }
  return currentFilePath;
}

function defaultExportName(extension: string): string {
  const path = getActiveExportPath();
  return path ? path.replace(/\.[^.]+$/, `.${extension}`).split("/").pop()! : `export.${extension}`;
}

async function exportHtmlImage(format: "png" | "jpg") {
  const defaultName = defaultExportName(format);
  const outputPath = await save({
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
    defaultPath: defaultName,
  });
  if (!outputPath) return;

  try {
    await withPreviewAvailable(async () => {
      const prepared = preparePreviewCaptureNode();
      const node = prepared.node;
      try {
        flashStatus(`Exporting ${format.toUpperCase()}...`, "var(--accent)");
        await waitForPreviewAssets(node);
        await fitNodeToContentWidth(node);
        const cropped = await captureNodeImage(
          node,
          `exportHtmlImage:${format}`,
          format === "png" ? "image/png" : "image/jpeg",
          0.95,
        );
        await invoke("save_binary_base64", {
          path: outputPath,
          dataBase64: dataUrlBase64(cropped.dataUrl),
        });
      } finally {
        prepared.cleanup();
      }
    });
    flashStatus(`${format.toUpperCase()} saved: ${outputPath.split("/").pop()}`, "var(--success)", 3000);
  } catch (e) {
    console.error("Image export failed:", e);
    flashStatus(`Export failed: ${e}`, "var(--error)", 8000);
  }
}

async function exportHtmlPng() {
  return exportHtmlImage("png");
}

async function exportHtmlJpg() {
  return exportHtmlImage("jpg");
}

async function exportHtmlPdf() {
  const defaultName = defaultExportName("pdf");
  const outputPath = await save({
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    defaultPath: defaultName,
  });
  if (!outputPath) return;

  try {
    flashStatus("Capturing preview as PDF...", "var(--accent)");
    const capture = await capturePreviewPng();
    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const printableWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;
    const maxSliceHeight = capture.width * (printableHeight / printableWidth);
    const slices = await sliceImageDataUrl(capture.dataUrl, maxSliceHeight);

    slices.forEach((slice, index) => {
      if (index > 0) pdf.addPage();
      const renderedHeight = slice.height * (printableWidth / slice.width);
      pdf.addImage(slice.dataUrl, "PNG", margin, margin, printableWidth, renderedHeight);
    });

    await invoke("save_binary_base64", {
      path: outputPath,
      dataBase64: dataUrlBase64(pdf.output("datauristring")),
    });
    flashStatus(`PDF saved: ${outputPath.split("/").pop()}`, "var(--success)", 3000);
  } catch (e) {
    console.error("PDF export failed:", e);
    flashStatus(`Export failed: ${e}`, "var(--error)", 8000);
  }
}

async function exportMarkdownPdf() {
  const outputPath = await save({
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    defaultPath: defaultExportName("pdf"),
  });
  if (!outputPath) return;

  try {
    flashStatus("Exporting Markdown PDF...", "var(--accent)");
    await invoke("export_pdf", {
      markdownContent: getActiveMarkdownContent(),
      outputPath,
      sourceFormat: "markdown",
    });
    flashStatus(`PDF saved: ${outputPath.split("/").pop()}`, "var(--success)", 3000);
  } catch (e) {
    console.error("Markdown PDF export failed:", e);
    flashStatus(`Export failed: ${e}`, "var(--error)", 8000);
  }
}

async function exportMarkdownDocx() {
  const outputPath = await save({
    filters: [{ name: "Word", extensions: ["docx"] }],
    defaultPath: defaultExportName("docx"),
  });
  if (!outputPath) return;

  try {
    flashStatus("Exporting Markdown DOCX...", "var(--accent)");
    await invoke("export_docx", {
      markdownContent: getActiveMarkdownContent(),
      outputPath,
    });
    flashStatus(`DOCX saved: ${outputPath.split("/").pop()}`, "var(--success)", 3000);
  } catch (e) {
    console.error("Markdown DOCX export failed:", e);
    flashStatus(`Export failed: ${e}`, "var(--error)", 8000);
  }
}

// --- Image lightbox (#36) ---

function showImageLightbox(src: string) {
  const lightbox = document.getElementById("image-lightbox");
  if (!lightbox) return;
  lightbox.innerHTML = `<img src="${src.replace(/"/g, "&quot;")}" />`;
  lightbox.classList.remove("hidden");
  lightbox.addEventListener("click", () => {
    lightbox.classList.add("hidden");
    lightbox.innerHTML = "";
  }, { once: true });
}

// --- Image paste from clipboard (#30) ---

async function handleImagePaste(e: ClipboardEvent) {
  if (!e.clipboardData) return;
  const items = Array.from(e.clipboardData.items);
  const imageItem = items.find(item => item.type.startsWith("image/"));
  if (!imageItem) return;

  e.preventDefault();
  const blob = imageItem.getAsFile();
  if (!blob) return;

  // Need a folder to save the image
  const dir = currentFilePath
    ? currentFilePath.substring(0, currentFilePath.lastIndexOf("/"))
    : currentFolderPath;
  if (!dir) {
    flashStatus("Save file first to paste images", "var(--warning)");
    return;
  }

  try {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // For now insert as data URL (works in preview), save actual file if possible
      const insert = `![pasted image](${dataUrl})\n`;
      const pos = editor.state.selection.main.head;
      editor.dispatch({
        changes: { from: pos, insert },
      });
      flashStatus("Image pasted!", "var(--success)");
    };
    reader.readAsDataURL(blob);
  } catch (e) {
    flashStatus(`Paste failed: ${e}`, "var(--error)", 3000);
  }
}

// --- Auto update ---

async function doUpdateCheck(manual: boolean) {
  const statusWords = document.getElementById("status-words");
  try {
    if (manual && statusWords) {
      statusWords.textContent = "Checking for updates...";
      statusWords.style.color = "var(--accent)";
    }

    const update = await check();
    if (!update) {
      if (manual && statusWords) {
        statusWords.textContent = "You're on the latest version";
        statusWords.style.color = "var(--success)";
        setTimeout(() => { statusWords.textContent = ""; statusWords.style.color = ""; }, 3000);
      }
      return;
    }

    if (statusWords) {
      statusWords.textContent = `Update ${update.version} available — downloading...`;
      statusWords.style.color = "var(--accent)";
    }

    let totalSize = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started" && event.data.contentLength) {
        totalSize = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (statusWords && totalSize > 0) {
          const pct = Math.round((downloaded / totalSize) * 100);
          statusWords.textContent = `Downloading update... ${pct}%`;
        }
      }
    });

    if (statusWords) {
      statusWords.textContent = "Update installed — click to restart";
      statusWords.style.color = "var(--success)";
      statusWords.style.cursor = "pointer";
      statusWords.addEventListener("click", () => relaunch(), { once: true });
    }
  } catch (e) {
    console.error("Update check failed:", e);
    if (statusWords) {
      const errMsg = String(e).length > 120 ? String(e).slice(0, 120) + "…" : String(e);
      statusWords.textContent = manual ? `Update failed: ${errMsg}` : "";
      statusWords.style.color = manual ? "var(--error)" : "";
      if (manual) setTimeout(() => { statusWords.textContent = ""; statusWords.style.color = ""; }, 8000);
    }
  }
}

async function checkForUpdates() {
  const lastCheck = localStorage.getItem("kaelio-update-last-check");
  const now = Date.now();
  if (lastCheck && now - Number(lastCheck) < 7 * 24 * 60 * 60 * 1000) return;
  localStorage.setItem("kaelio-update-last-check", String(now));
  await doUpdateCheck(false);
}

// --- Formatting toolbar ---

function applyFormat(fmt: string) {
  const sel = editor.state.selection.main;
  const selected = editor.state.sliceDoc(sel.from, sel.to);
  let insert = "";
  let from = sel.from;
  let to = sel.to;

  switch (fmt) {
    case "bold":
      insert = `**${selected || "bold"}**`;
      break;
    case "italic":
      insert = `*${selected || "italic"}*`;
      break;
    case "heading": {
      const line = editor.state.doc.lineAt(sel.from);
      from = line.from;
      to = line.to;
      insert = `### ${line.text.replace(/^#+\s*/, "")}`;
      break;
    }
    case "link":
      insert = selected ? `[${selected}](url)` : `[link](url)`;
      break;
    case "code":
      insert = `\`${selected || "code"}\``;
      break;
    case "quote": {
      const qline = editor.state.doc.lineAt(sel.from);
      from = qline.from;
      to = qline.to;
      insert = `> ${qline.text}`;
      break;
    }
    case "list": {
      const lline = editor.state.doc.lineAt(sel.from);
      from = lline.from;
      to = lline.to;
      insert = `- ${lline.text}`;
      break;
    }
    case "hr":
      insert = `\n---\n`;
      break;
    default:
      return;
  }

  editor.dispatch({ changes: { from, to, insert } });
  editor.focus();
}

// --- Breadcrumb navigation ---

function updateBreadcrumb() {
  const el = document.getElementById("breadcrumb");
  if (!el) return;
  if (!currentFilePath) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const parts = currentFilePath.split("/").filter(Boolean);
  const display = parts.slice(-4);
  const startIdx = parts.length - display.length;

  el.innerHTML = display.map((seg, i) => {
    const fullPath = "/" + parts.slice(0, startIdx + i + 1).join("/");
    const span = `<span data-path="${fullPath.replace(/"/g, "&quot;")}">${escapeHtml(seg)}</span>`;
    return i < display.length - 1 ? span + '<span class="sep">/</span>' : span;
  }).join("");

  el.querySelectorAll("span:not(.sep)").forEach(span => {
    const s = span as HTMLElement;
    const isLast = !s.nextElementSibling || !s.nextElementSibling.classList.contains("sep");
    if (!isLast) {
      s.addEventListener("click", () => openFolder(s.dataset.path!));
    }
  });
}

// --- Scroll sync ---

let scrollSyncSource: "editor" | "preview" | null = null;
let scrollSyncTimer: ReturnType<typeof setTimeout> | null = null;

function initScrollSync() {
  const previewPane = document.getElementById("preview-pane");
  const editorScroll = editor.scrollDOM;
  if (!previewPane || !editorScroll) return;

  // Track which pane the user is hovering over
  editorScroll.addEventListener("mouseenter", () => { scrollSyncSource = "editor"; });
  previewPane.addEventListener("mouseenter", () => { scrollSyncSource = "preview"; });

  editorScroll.addEventListener("scroll", () => {
    if (!scrollSyncEnabled || isScrollSyncing || currentViewMode !== "split") return;
    if (scrollSyncSource !== "editor") return;
    isScrollSyncing = true;
    const pct = editorScroll.scrollTop / Math.max(1, editorScroll.scrollHeight - editorScroll.clientHeight);
    previewPane.scrollTop = pct * (previewPane.scrollHeight - previewPane.clientHeight);
    if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
    scrollSyncTimer = setTimeout(() => { isScrollSyncing = false; }, 100);
  });

  previewPane.addEventListener("scroll", () => {
    if (!scrollSyncEnabled || isScrollSyncing || currentViewMode !== "split") return;
    if (scrollSyncSource !== "preview") return;
    isScrollSyncing = true;
    const pct = previewPane.scrollTop / Math.max(1, previewPane.scrollHeight - previewPane.clientHeight);
    editorScroll.scrollTop = pct * (editorScroll.scrollHeight - editorScroll.clientHeight);
    if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
    scrollSyncTimer = setTimeout(() => { isScrollSyncing = false; }, 100);
  });
}

// --- Custom preview CSS ---

async function loadCustomCSS() {
  try {
    const css = await invoke<string>("load_custom_css");
    if (!css) return;
    let style = document.getElementById("custom-preview-css") as HTMLStyleElement;
    if (!style) {
      style = document.createElement("style");
      style.id = "custom-preview-css";
      document.head.appendChild(style);
    }
    style.textContent = css;
  } catch { /* ignore */ }
}

// --- Register keybinding actions (must be after function definitions) ---

actions["file.new"] = () => newFile();
actions["file.open"] = () => openFileDialog();
actions["file.save"] = () => saveActivePane();
actions["file.close-tab"] = () => closeActiveTab();
actions["file.new-window"] = () => invoke("create_window", { filePath: null });
actions["view.toggle-preview"] = () => togglePreview();
actions["view.read-mode"] = () => toggleReadMode();
actions["view.toggle-sidebar"] = () => toggleSidebar();
actions["view.zoom-in"] = () => zoomIn();
actions["view.zoom-out"] = () => zoomOut();
actions["view.zoom-reset"] = () => zoomReset();
actions["edit.copy-formatted"] = () => copyFormattedHTML();
actions["search.command-palette"] = () => toggleCommandPalette();
actions["search.file-search"] = () => openFileSearch();
actions["search.content-search"] = () => { sidebarSearchMode ? deactivateSidebarSearch() : activateSidebarSearch(); };
actions["help.shortcuts"] = () => toggleHelp();

async function handleNativeMenuCommand(command: string) {
  switch (command) {
    case "file.new": return newFile();
    case "file.open": return openFileDialog();
    case "file.open-folder": return openFolder();
    case "file.new-window": return void invoke("create_window", { filePath: null });
    case "file.save": return saveActivePane();
    case "file.close-tab": return closeActiveTab();
    case "export.html.png": return exportHtmlPng();
    case "export.html.jpg": return exportHtmlJpg();
    case "export.html.pdf": return exportHtmlPdf();
    case "export.md.pdf": return exportMarkdownPdf();
    case "export.md.docx": return exportMarkdownDocx();
    case "edit.copy-formatted": return copyFormattedHTML();
    case "edit.copy-raw": return copyRawMarkdown();
    case "edit.copy-plain": return copyPlainText();
    case "view.explorer": return toggleSidebar();
    case "view.preview": return togglePreview();
    case "view.reading": return toggleReadMode();
    case "view.line-numbers": return toggleLineNumbers();
    case "view.soft-wrap.off": return setWrapMode("off");
    case "view.soft-wrap.window": return setWrapMode("window");
    case "view.soft-wrap.column": return setWrapMode("column");
    case "view.zoom-in": return zoomIn();
    case "view.zoom-out": return zoomOut();
    case "view.zoom-reset": return zoomReset();
    case "font.system": return setFont("System");
    case "font.inter": return setFont("Inter");
    case "font.georgia": return setFont("Georgia");
    case "font.merriweather": return setFont("Merriweather");
    case "font.jetbrains-mono": return setFont("JetBrains Mono");
    case "font.custom": return setFont("Custom...");
    case "text-size.12": return setTextSize("12");
    case "text-size.14": return setTextSize("14");
    case "text-size.16": return setTextSize("16");
    case "text-size.18": return setTextSize("18");
    case "text-size.20": return setTextSize("20");
    case "text-size.24": return setTextSize("24");
    case "text-size.custom": return setTextSize("Custom...");
    case "explorer-size.12": return setExplorerTextSize("12");
    case "explorer-size.13": return setExplorerTextSize("13");
    case "explorer-size.14": return setExplorerTextSize("14");
    case "explorer-size.15": return setExplorerTextSize("15");
    case "explorer-size.16": return setExplorerTextSize("16");
    case "explorer-size.18": return setExplorerTextSize("18");
    case "explorer-size.custom": return setExplorerTextSize("Custom...");
    case "theme.auto": return setTheme("auto");
    case "theme.light": return setTheme("light");
    case "theme.dark": return setTheme("dark");
    case "theme.catppuccin-mocha": return setTheme("catppuccin-mocha");
    case "theme.everforest-dark": return setTheme("everforest-dark");
    case "theme.nord": return setTheme("nord");
    case "theme.custom": return setTheme("custom");
    case "search.command-palette": return toggleCommandPalette();
    case "search.file-search": return openFileSearch();
    case "search.content-search": return sidebarSearchMode ? deactivateSidebarSearch() : activateSidebarSearch();
    case "help.shortcuts": return toggleHelp();
    case "help.customize-shortcuts": return toggleShortcutsModal();
    case "help.check-updates": return doUpdateCheck(true);
    case "help.about": return void invoke("plugin:opener|open_url", { url: "https://github.com/kael-wanderer/kaelio" });
  }
}

// --- Shortcuts settings modal ---

function renderShortcutsContent() {
  const content = document.getElementById("shortcuts-content");
  if (!content || document.getElementById("shortcuts-modal")?.classList.contains("hidden")) return;

  const bindings = getDefaultBindings();
  const groups = new Map<string, ShortcutDef[]>();
  for (const def of bindings) {
    if (!groups.has(def.group)) groups.set(def.group, []);
    groups.get(def.group)!.push(def);
  }

  const custom = getCustomBindings();
  content.innerHTML = Array.from(groups.entries()).map(([group, defs]) =>
    `<div class="shortcut-group"><h3>${group}</h3>${defs.map(def => {
      const current = getBinding(def.id);
      const isCustom = def.id in custom;
      const display = cm6KeyToDisplay(current) || "Unbound";
      return `<div class="shortcut-row" data-id="${def.id}">
        <span class="shortcut-label">${def.label}</span>
        <kbd class="shortcut-key${isCustom ? " custom" : ""}">${display}</kbd>
        <button class="shortcut-edit" title="Click to rebind">Edit</button>
      </div>`;
    }).join("")}</div>`
  ).join("");

  // Wire edit buttons
  content.querySelectorAll(".shortcut-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".shortcut-row") as HTMLElement;
      startCapture(row);
    });
  });

  // Wire row clicks too
  content.querySelectorAll(".shortcut-row").forEach(row => {
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("shortcut-edit")) return;
      startCapture(row as HTMLElement);
    });
  });
}

function startCapture(row: HTMLElement) {
  const id = row.dataset.id!;
  // Remove any existing capture
  document.querySelectorAll(".shortcut-row.capturing").forEach(r => r.classList.remove("capturing"));

  row.classList.add("capturing");
  const kbd = row.querySelector(".shortcut-key")!;
  const originalText = kbd.textContent;
  kbd.textContent = "Press shortcut...";

  const handler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      cleanup();
      kbd.textContent = originalText;
      row.classList.remove("capturing");
      return;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      cleanup();
      setCustomBinding(id, "");
      return;
    }

    const cm6Key = keyEventToCM6(e);
    if (!cm6Key) return; // modifier-only press

    const conflict = findConflict(cm6Key, id);
    if (conflict) {
      kbd.textContent = `${cm6KeyToDisplay(cm6Key)} (used by ${conflict.label})`;
      kbd.classList.add("conflict");
      // Wait for Enter to confirm, Escape to cancel
      const confirmHandler = (e2: KeyboardEvent) => {
        e2.preventDefault();
        e2.stopPropagation();
        if (e2.key === "Enter") {
          // Swap: give conflict the old binding
          const oldKey = getBinding(id);
          setCustomBinding(conflict.id, oldKey);
          setCustomBinding(id, cm6Key);
          cleanupConfirm();
        } else if (e2.key === "Escape") {
          cleanupConfirm();
          kbd.textContent = originalText;
          kbd.classList.remove("conflict");
          row.classList.remove("capturing");
        }
      };
      const cleanupConfirm = () => {
        document.removeEventListener("keydown", confirmHandler, true);
        kbd.classList.remove("conflict");
      };
      document.removeEventListener("keydown", handler, true);
      document.addEventListener("keydown", confirmHandler, true);
      return;
    }

    if (isOSReserved(cm6Key)) {
      kbd.textContent = `${cm6KeyToDisplay(cm6Key)} (system shortcut!)`;
    }

    cleanup();
    setCustomBinding(id, cm6Key);
  };

  const cleanup = () => {
    document.removeEventListener("keydown", handler, true);
    row.classList.remove("capturing");
  };

  document.addEventListener("keydown", handler, true);
}

function toggleShortcutsModal() {
  const modal = document.getElementById("shortcuts-modal");
  if (!modal) return;
  if (!modal.classList.contains("hidden")) {
    modal.classList.add("hidden");
    return;
  }
  modal.classList.remove("hidden");
  renderShortcutsContent();
}

// --- Init ---

window.addEventListener("DOMContentLoaded", async () => {
  const editorPane = $("#editor-pane");
  if (!editorPane) return;

  // Load session — compare disk (survives reinstalls) vs localStorage (synchronous, always fresh)
  let diskSession: SessionData = {};
  let lsSession: SessionData = {};
  try {
    const raw = await invoke<string>("load_session");
    diskSession = JSON.parse(raw) as SessionData;
  } catch { /* first launch or corrupt file */ }
  try {
    const lsRaw = localStorage.getItem("kaelio-session");
    if (lsRaw) lsSession = JSON.parse(lsRaw) as SessionData;
  } catch { /* ignore */ }

  // Use whichever source was saved most recently
  if ((lsSession.savedAt ?? 0) > (diskSession.savedAt ?? 0) && lsSession.openTabs) {
    sessionData = lsSession;
  } else if (diskSession.openTabs) {
    sessionData = diskSession;
  } else {
    // Legacy migration from old localStorage keys (one-time)
    try {
      const lsTabs = localStorage.getItem("kaelio-open-tabs");
      if (lsTabs) sessionData.openTabs = JSON.parse(lsTabs);
      sessionData.lastFile = localStorage.getItem("kaelio-last-file") || undefined;
      sessionData.currentFolder = localStorage.getItem("kaelio-current-folder") || undefined;
    } catch { /* ignore */ }
  }

  if (restoreLastSession && sessionData.currentFolder) {
    currentFolderPath = sessionData.currentFolder;
  }

  // Apply theme before creating editor
  document.documentElement.setAttribute("data-theme", currentThemeMode);

  // Create initial tab
  const initialTab = createTab(null, SAMPLE_CONTENT);
  tabs.push(initialTab);
  activeTabId = initialTab.id;

  editor = new EditorView({
    state: initialTab.editorState,
    parent: editorPane,
  });
  editor.dom.addEventListener("focusin", () => { activePane = "main"; });

  // Editor ↔ preview scroll sync wiring
  const previewPaneEl = document.getElementById("preview-pane");
  if (previewPaneEl) {
    let editorScrollRaf = 0;
    editor.scrollDOM.addEventListener("scroll", () => {
      if (!syncScrollEnabled || isSyncingScroll) return;
      if (editorScrollRaf) return;
      editorScrollRaf = requestAnimationFrame(() => {
        editorScrollRaf = 0;
        syncPreviewToEditor();
      });
    });
    let previewScrollRaf = 0;
    previewPaneEl.addEventListener("scroll", () => {
      if (!syncScrollEnabled || isSyncingScroll) return;
      if (previewScrollRaf) return;
      previewScrollRaf = requestAnimationFrame(() => {
        previewScrollRaf = 0;
        syncEditorToPreview();
      });
    });
    previewPaneEl.addEventListener("click", (e) => {
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      const t = e.target as HTMLElement;
      if (t.closest("a, button, input, .task-check, .mermaid, .heading-copy-link, .fm-tag-remove")) return;
      jumpEditorToPreviewClick(t);
    });
  }
  document.getElementById("btn-sync-scroll")?.addEventListener("click", toggleSyncScroll);
  updateSyncScrollButton();

  // Preview search
  document.getElementById("preview-search-close")?.addEventListener("click", closePreviewSearch);
  document.getElementById("preview-search-prev")?.addEventListener("click", () => navigatePreviewSearch(-1));
  document.getElementById("preview-search-next")?.addEventListener("click", () => navigatePreviewSearch(1));
  const previewSearchInput = document.getElementById("preview-search-input") as HTMLInputElement | null;
  if (previewSearchInput) {
    let previewSearchDebounce: ReturnType<typeof setTimeout>;
    previewSearchInput.addEventListener("input", () => {
      clearTimeout(previewSearchDebounce);
      previewSearchDebounce = setTimeout(() => performPreviewSearch(previewSearchInput.value), 150);
    });
    previewSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closePreviewSearch(); }
      else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); navigatePreviewSearch(-1); }
      else if (e.key === "Enter") { e.preventDefault(); navigatePreviewSearch(1); }
    });
  }

  // Intercept Cmd+F for preview search when preview is visible
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey && !e.altKey) {
      const previewWrapper = document.getElementById("preview-pane-wrapper");
      if (!previewWrapper || previewWrapper.style.display === "none") return;
      if (currentFilePath && isPdfPath(currentFilePath)) {
        e.preventDefault();
        e.stopPropagation();
        openPreviewSearch();
        return;
      }
      if (currentViewMode === "preview") {
        e.preventDefault();
        e.stopPropagation();
        openPreviewSearch();
      }
    }
  }, true);

  // Dropdown menus
  document.querySelectorAll(".toolbar-dropdown").forEach(wrapper => {
    const btn = wrapper.querySelector("button");
    const menu = wrapper.querySelector(".dropdown-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".dropdown-menu").forEach(m => {
        if (m !== menu) m.classList.add("hidden");
      });
      menu.classList.toggle("hidden");
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.add("hidden"));
    hideContextMenu();
    hideTabContextMenu();
    hideTabOverflowMenu();
    closeAppearancePopover();
  });
  window.addEventListener("resize", scheduleSplitTabLayout);

  // File menu items
  document.getElementById("btn-new")?.addEventListener("click", () => newFile());
  document.getElementById("btn-open")?.addEventListener("click", () => openFileDialog());
  document.getElementById("btn-open-folder")?.addEventListener("click", () => openFolder());
  document.getElementById("btn-new-window")?.addEventListener("click", () => invoke("create_window", { filePath: null }));
  document.getElementById("btn-recent")?.addEventListener("click", () => toggleRecentPanel());
  document.getElementById("btn-save")?.addEventListener("click", () => saveActivePane());
  document.getElementById("btn-autosave")?.addEventListener("click", () => toggleAutoSave());
  document.getElementById("btn-autosync")?.addEventListener("click", () => toggleAutoSync());
  document.getElementById("btn-export-html-png")?.addEventListener("click", exportHtmlPng);
  document.getElementById("btn-export-html-jpg")?.addEventListener("click", exportHtmlJpg);
  document.getElementById("btn-export-html-pdf")?.addEventListener("click", exportHtmlPdf);
  document.getElementById("btn-export-md-pdf")?.addEventListener("click", exportMarkdownPdf);
  document.getElementById("btn-export-md-docx")?.addEventListener("click", exportMarkdownDocx);

  // View menu items
  document.getElementById("btn-toggle-sidebar")?.addEventListener("click", () => toggleSidebar());
  document.getElementById("btn-toggle-preview")?.addEventListener("click", () => togglePreview());
  document.getElementById("btn-read-mode")?.addEventListener("click", () => toggleReadMode());
  document.getElementById("btn-toggle-outline")?.addEventListener("click", () => toggleOutline());
  document.getElementById("btn-toggle-linenumbers")?.addEventListener("click", () => toggleLineNumbers());
  const wrapModeSelect = document.getElementById("wrap-mode-select") as HTMLSelectElement | null;
  if (wrapModeSelect) {
    wrapModeSelect.value = wrapMode;
    wrapModeSelect.addEventListener("change", () => setWrapMode(wrapModeSelect.value as WrapMode));
  }
  const wrapColumnInput = document.getElementById("wrap-column-input") as HTMLInputElement | null;
  if (wrapColumnInput) {
    wrapColumnInput.value = String(wrapColumn);
    wrapColumnInput.addEventListener("change", () => {
      setWrapColumn(parseInt(wrapColumnInput.value, 10));
    });
  }

  // Appearance controls
  document.getElementById("font-select")?.addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    void setFont(select.value);
  });
  document.getElementById("text-size-select")?.addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    void setTextSize(select.value);
  });

  // Format bar
  document.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const fmt = (btn as HTMLElement).dataset.fmt;
      if (fmt) applyFormat(fmt);
    });
  });

  document.getElementById("theme-select")?.addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    void setTheme(select.value as ThemeMode);
  });
  document.querySelectorAll(".dropdown-control, .dropdown-control select").forEach(el => {
    el.addEventListener("click", (e) => e.stopPropagation());
  });

  // Activity bar
  document.getElementById("activity-explorer")?.addEventListener("click", () => toggleSidebar());
  document.getElementById("activity-preview")?.addEventListener("click", () => togglePreview());
  document.getElementById("activity-reading")?.addEventListener("click", () => toggleReadMode());
  document.getElementById("activity-linenumbers")?.addEventListener("click", () => toggleLineNumbers());
  document.getElementById("activity-settings")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAppearancePopover();
  });
  document.getElementById("appearance-popover")?.addEventListener("click", (e) => e.stopPropagation());
  document.querySelectorAll(".appearance-tab").forEach(tab => {
    tab.addEventListener("click", () => renderAppearancePanel(((tab as HTMLElement).dataset.panel || "theme") as AppearancePanel));
  });

  // Native macOS/menu bar commands
  listen<string>("native-menu-command", (event) => {
    void handleNativeMenuCommand(event.payload);
  });

  // Help menu items
  document.getElementById("btn-keyboard-shortcuts")?.addEventListener("click", toggleHelp);
  document.getElementById("btn-customize-shortcuts")?.addEventListener("click", toggleShortcutsModal);
  document.getElementById("btn-check-updates")?.addEventListener("click", () => doUpdateCheck(true));
  document.getElementById("btn-about")?.addEventListener("click", () => {
    invoke("plugin:opener|open_url", { url: "https://github.com/kael-wanderer/kaelio" });
  });

  // Theme icon button
  document.getElementById("btn-theme-icon")?.addEventListener("click", () => cycleTheme());

  // Copy mode buttons
  document.getElementById("btn-copy-formatted")?.addEventListener("click", () => copyFormattedHTML());
  document.getElementById("btn-copy-raw")?.addEventListener("click", () => copyRawMarkdown());
  document.getElementById("btn-copy-plain")?.addEventListener("click", () => copyPlainText());

  // Primary toolbar buttons
  document.getElementById("btn-copy-html")?.addEventListener("click", copyFormattedHTML);
  document.getElementById("btn-toolbar-export-html-png")?.addEventListener("click", exportHtmlPng);
  document.getElementById("btn-toolbar-export-html-jpg")?.addEventListener("click", exportHtmlJpg);
  document.getElementById("btn-toolbar-export-html-pdf")?.addEventListener("click", exportHtmlPdf);
  document.getElementById("btn-toolbar-export-md-pdf")?.addEventListener("click", exportMarkdownPdf);
  document.getElementById("btn-toolbar-export-md-docx")?.addEventListener("click", exportMarkdownDocx);
  document.getElementById("btn-zoom-in")?.addEventListener("click", zoomIn);
  document.getElementById("btn-split")?.addEventListener("click", () => toggleSplit());
  document.getElementById("btn-sub-mode")?.addEventListener("click", () => toggleSubMode());
  document.getElementById("btn-sub-linenumbers")?.addEventListener("click", () => toggleSubLineNumbers());
  document.getElementById("btn-sub-zoom-out")?.addEventListener("click", () => subZoomOut());
  document.getElementById("btn-sub-zoom-in")?.addEventListener("click", () => subZoomIn());
  document.getElementById("btn-zoom-out")?.addEventListener("click", zoomOut);
  document.getElementById("main-region")?.addEventListener("pointerdown", () => { activePane = "main"; });
  document.getElementById("sub-pane-wrapper")?.addEventListener("pointerdown", () => { activePane = "sub"; });
  document.getElementById("sub-activity-bar")?.addEventListener("pointerdown", () => { activePane = "sub"; });

  // Sidebar action buttons
  document.getElementById("btn-sidebar-new-file")?.addEventListener("click", async () => {
    if (!currentFolderPath) {
      await openFolder();
      if (!currentFolderPath) return;
    }
    const dir = activeSidebarDir || currentFolderPath;
    const name = await showInputDialog("File name:", "untitled.md");
    if (!name) return;
    try {
      await invoke("create_file", { path: `${dir}/${name}` });
      refreshSidebar();
      openFile(`${dir}/${name}`);
    } catch (e) {
      flashStatus(`Error: ${e}`, "var(--error)", 3000);
    }
  });
  document.getElementById("btn-sidebar-new-folder")?.addEventListener("click", async () => {
    if (!currentFolderPath) {
      await openFolder();
      if (!currentFolderPath) return;
    }
    const dir = activeSidebarDir || currentFolderPath;
    const name = await showInputDialog("Folder name:");
    if (!name) return;
    invoke("create_directory", { path: `${dir}/${name}` }).then(() => {
      refreshSidebar();
    }).catch(e => flashStatus(`Error: ${e}`, "var(--error)", 3000));
  });
  document.getElementById("btn-sidebar-refresh")?.addEventListener("click", () => refreshSidebar());
  document.getElementById("btn-sidebar-outline")?.addEventListener("click", () => toggleOutline());
  document.getElementById("btn-sidebar-close")?.addEventListener("click", () => toggleSidebar());

  // Git panel
  document.getElementById("btn-sidebar-git")?.addEventListener("click", () => {
    const panel = document.getElementById("git-panel");
    if (panel) panel.classList.toggle("hidden");
  });
  document.getElementById("btn-git-sync")?.addEventListener("click", () => gitSync());
  document.getElementById("btn-git-commit")?.addEventListener("click", () => gitManualCommit());
  document.getElementById("git-commit-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") gitManualCommit();
  });

  // Sync setup
  document.getElementById("btn-sync-setup")?.addEventListener("click", () => showSyncSetup());
  document.getElementById("btn-sync-connect")?.addEventListener("click", () => connectSync());
  document.getElementById("sync-setup-close")?.addEventListener("click", () => hideSyncSetup());
  document.getElementById("sync-setup-backdrop")?.addEventListener("click", () => hideSyncSetup());
  document.getElementById("sync-repo-url")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectSync();
  });
  document.getElementById("sync-create-repo-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    invoke("plugin:opener|open_url", { url: "https://github.com/new" });
  });

  // History modal
  document.getElementById("history-close")?.addEventListener("click", () => {
    document.getElementById("history-modal")?.classList.add("hidden");
  });
  document.getElementById("history-backdrop")?.addEventListener("click", () => {
    document.getElementById("history-modal")?.classList.add("hidden");
  });
  document.getElementById("history-tab-commits")?.addEventListener("click", () => {
    document.getElementById("history-tab-commits")?.classList.add("active");
    document.getElementById("history-tab-snapshots")?.classList.remove("active");
    hideHistoryDiff();
    loadHistoryCommits();
  });
  document.getElementById("history-tab-snapshots")?.addEventListener("click", () => {
    document.getElementById("history-tab-snapshots")?.classList.add("active");
    document.getElementById("history-tab-commits")?.classList.remove("active");
    hideHistoryDiff();
    loadHistorySnapshots();
  });
  document.getElementById("history-diff-back")?.addEventListener("click", () => hideHistoryDiff());
  document.getElementById("history-diff-restore")?.addEventListener("click", () => {
    // Restore from the currently viewed diff (old content)
    const oldContent = document.getElementById("history-diff-old")?.textContent || "";
    if (currentFilePath) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: oldContent } });
      setModified(true);
      flashStatus("✓ Version restored", "var(--success)");
      document.getElementById("history-modal")?.classList.add("hidden");
    }
  });

  // Conflict resolution
  document.getElementById("conflict-close")?.addEventListener("click", () => {
    document.getElementById("conflict-modal")?.classList.add("hidden");
  });
  document.getElementById("conflict-backdrop")?.addEventListener("click", () => {
    document.getElementById("conflict-modal")?.classList.add("hidden");
  });
  document.getElementById("conflict-accept-local")?.addEventListener("click", () => resolveConflict("local"));
  document.getElementById("conflict-accept-remote")?.addEventListener("click", () => resolveConflict("remote"));
  document.getElementById("conflict-accept-both")?.addEventListener("click", () => resolveConflict("both"));

  // Sidebar search button
  document.getElementById("btn-sidebar-search")?.addEventListener("click", () => {
    if (sidebarSearchMode) deactivateSidebarSearch();
    else activateSidebarSearch();
  });

  // Sidebar search input — debounced
  document.getElementById("sidebar-search-input")?.addEventListener("input", (e) => {
    if (sidebarSearchDebounce) clearTimeout(sidebarSearchDebounce);
    sidebarSearchDebounce = setTimeout(() => {
      doSidebarSearch((e.target as HTMLInputElement).value);
    }, 300);
  });

  // Arrow key nav + Escape in sidebar search
  document.getElementById("sidebar-search-input")?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sidebarSearchSelectedIndex = Math.min(sidebarSearchSelectedIndex + 1, sidebarSearchResults.length - 1);
      renderSidebarSearchResults();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sidebarSearchSelectedIndex = Math.max(sidebarSearchSelectedIndex - 1, 0);
      renderSidebarSearchResults();
    } else if (e.key === "Enter") {
      e.preventDefault();
      openSidebarSearchResult(sidebarSearchSelectedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      deactivateSidebarSearch();
    }
  });

  // Sidebar title click → exit search mode
  document.getElementById("sidebar-title")?.addEventListener("click", () => {
    if (sidebarSearchMode) deactivateSidebarSearch();
  });

  // Context menu items
  document.getElementById("ctx-open-split")?.addEventListener("click", ctxOpenSplit);
  document.getElementById("ctx-extract-pdf-md")?.addEventListener("click", ctxExtractPdfToMarkdown);
  document.getElementById("ctx-select-compare")?.addEventListener("click", ctxSelectCompare);
  document.getElementById("ctx-compare-with")?.addEventListener("click", ctxCompareWith);
  document.getElementById("ctx-new-file")?.addEventListener("click", ctxNewFile);
  document.getElementById("ctx-new-folder")?.addEventListener("click", ctxNewFolder);
  document.getElementById("ctx-rename")?.addEventListener("click", ctxRename);
  document.getElementById("ctx-duplicate")?.addEventListener("click", ctxDuplicate);
  document.getElementById("ctx-copy-absolute")?.addEventListener("click", ctxCopyAbsolutePath);
  document.getElementById("ctx-copy-relative")?.addEventListener("click", ctxCopyRelativePath);
  document.getElementById("ctx-reveal")?.addEventListener("click", ctxReveal);
  document.getElementById("ctx-git-history")?.addEventListener("click", () => {
    const target = contextMenuTarget;
    hideContextMenu();
    if (target && !target.isDir) {
      currentFilePath = target.path;
      showFileHistory();
    }
  });
  document.getElementById("ctx-git-discard")?.addEventListener("click", () => {
    const target = contextMenuTarget;
    hideContextMenu();
    if (target && !target.isDir) {
      gitDiscardFile(target.path);
    }
  });
  document.getElementById("ctx-delete")?.addEventListener("click", ctxDelete);

  // Tab context menu items
  document.getElementById("tab-ctx-close")?.addEventListener("click", () => {
    if (tabContextTarget) closeTab(tabContextTarget);
    hideTabContextMenu();
  });
  document.getElementById("tab-ctx-close-others")?.addEventListener("click", () => {
    if (tabContextTarget) closeOtherTabs(tabContextTarget);
    hideTabContextMenu();
  });
  document.getElementById("tab-ctx-close-right")?.addEventListener("click", () => {
    if (tabContextTarget) closeTabsToRight(tabContextTarget);
    hideTabContextMenu();
  });
  document.getElementById("tab-ctx-close-all")?.addEventListener("click", () => {
    closeAllTabs();
    hideTabContextMenu();
  });

  // Command palette
  document.getElementById("palette-input")?.addEventListener("input", (e) => {
    paletteSelectedIndex = 0;
    renderPaletteResults((e.target as HTMLInputElement).value);
  });
  document.getElementById("palette-input")?.addEventListener("keydown", handlePaletteKey);
  document.getElementById("palette-backdrop")?.addEventListener("click", toggleCommandPalette);

  // File search
  document.getElementById("filesearch-input")?.addEventListener("input", (e) => {
    fileSearchSelectedIndex = 0;
    renderFileSearchResults((e.target as HTMLInputElement).value);
  });
  document.getElementById("filesearch-input")?.addEventListener("keydown", handleFileSearchKey);
  document.getElementById("filesearch-backdrop")?.addEventListener("click", closeFileSearch);

  // Help modal
  document.getElementById("status-help")?.addEventListener("click", toggleHelp);
  document.getElementById("help-close")?.addEventListener("click", toggleHelp);
  document.getElementById("help-backdrop")?.addEventListener("click", toggleHelp);

  // Shortcuts modal
  document.getElementById("shortcuts-close")?.addEventListener("click", toggleShortcutsModal);
  document.getElementById("shortcuts-backdrop")?.addEventListener("click", toggleShortcutsModal);
  document.getElementById("shortcuts-reset")?.addEventListener("click", () => {
    resetAllBindings();
    renderShortcutsContent();
  });

  // Divider drag
  initDividerDrag();
  initSubDividerDrag();

  // Sidebar resize
  initSidebarResize();

  // Tauri drag & drop
  initDragDrop();

  // Listen for file open events (double-click .md in Finder, warm start)
  listen<string>("open-file", (event) => {
    openFile(event.payload);
  });

  // Check for file passed on cold start, then restore tabs (main window only)
  invoke<string | null>("get_initial_file").then(async (path) => {
    if (path) {
      await openFile(path);
    } else if (isMainWindow && restoreLastSession) {
      // Restore tabs from previous session (from disk)
      try {
        const fileTabs = (sessionData.openTabs || []).filter(t => t.filePath);
        if (fileTabs.length > 0) {
          let activeSaved: typeof fileTabs[number] | null = null;
          for (const t of fileTabs) {
            if (t.isActive) activeSaved = t;
          }
          await openFile(fileTabs[0].filePath!, true);
          const sampleTab = tabs.find(t => !t.filePath);
          if (sampleTab) {
            tabs = tabs.filter(t => t.id !== sampleTab.id);
          }
          for (let i = 1; i < fileTabs.length; i++) {
            await openFile(fileTabs[i].filePath!, true);
          }
          for (const st of fileTabs) {
            const tab = tabs.find(t => t.filePath === st.filePath);
            if (!tab) continue;
            tab.scrollTop = st.scrollTop ?? 0;
            tab.previewScrollTop = st.previewScrollTop ?? 0;
            if (st.cursorOffset !== undefined && st.cursorOffset > 0) {
              const docLen = tab.editorState.doc.length;
              const pos = Math.min(st.cursorOffset, docLen);
              tab.editorState = tab.editorState.update({
                selection: { anchor: pos },
              }).state;
            }
          }
          if (activeSaved?.filePath) {
            const active = tabs.find(t => t.filePath === activeSaved!.filePath);
            if (active) {
              switchToTab(active.id);
              requestAnimationFrame(() => {
                editor.scrollDOM.scrollTop = active.scrollTop;
                const pp = document.getElementById("preview-pane");
                if (pp) pp.scrollTop = active.previewScrollTop;
              });
            }
          }
          renderTabs();
        } else if (sessionData.lastFile) {
          openFile(sessionData.lastFile);
        }
      } catch {
        if (sessionData.lastFile) openFile(sessionData.lastFile);
      }
    }
  });

  // Image lightbox — click images in preview to zoom
  $("#preview-pane")?.addEventListener("click", (e) => {
    const img = (e.target as HTMLElement).closest("img");
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      showImageLightbox(img.getAttribute("src") || "");
    }
  });

  // Image paste from clipboard
  editor.dom.addEventListener("paste", (e) => handleImagePaste(e as ClipboardEvent));

  // Apply customizable keybindings (sets up global keydown handler from registry)
  applyBindings();

  // Preview pane link clicks — same-file anchors, cross-file/folder .md links, external URLs
  $("#preview-pane")?.addEventListener("click", (e) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href) return;

    if (/^https?:\/\//.test(href)) {
      invoke("plugin:opener|open_url", { url: href });
      return;
    }

    // Split href into file path and anchor fragment
    const hashIdx = href.indexOf("#");
    const filePart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : "";

    // Same-file anchor navigation (e.g. #heading-name or #table-anchor)
    if (!filePart) {
      scrollPreviewToAnchor(fragment);
      return;
    }

    if (currentFilePath) {
      const dir = currentFilePath.substring(0, currentFilePath.lastIndexOf("/"));
      // Normalize relative paths (handles ../ and cross-folder navigation)
      const resolved = new URL(filePart, "file://" + dir + "/").pathname;
      openFile(resolved).then(async () => {
        if (fragment) {
          // Cancel pending debounce and render immediately so the anchor exists in the DOM
          if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
          await updatePreview(editor.state.doc.toString());
          scrollPreviewToAnchor(fragment);
        }
      });
    }
  });

  // Copy-link buttons on headings — copies #anchor-id to clipboard
  $("#preview-pane")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".heading-copy-link") as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const anchor = btn.dataset.anchor;
    if (!anchor) return;
    navigator.clipboard.writeText("#" + anchor).then(() => {
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1500);
    });
  });

  // GitHub link
  document.getElementById("status-github")?.addEventListener("click", (e) => {
    e.preventDefault();
    invoke("plugin:opener|open_url", { url: "https://github.com/kael-wanderer/kaelio" });
  });

  // Initial render
  updateCursorPosition(editor);
  updatePreview(SAMPLE_CONTENT);
  updateWordCount(SAMPLE_CONTENT);
  updateAutoSaveUI();
  updateLineNumbersUI();
  updateSubControlsUI();
  applyWrapColumnStyle();
  updateWrapModeUI();
  updateGitUI();

  applyTheme();
  applyTypography();

  // Restore last folder in sidebar
  if (currentFolderPath) {
    const sidebar = document.getElementById("sidebar");
    const sidebarSaved = localStorage.getItem("kaelio-sidebar");
    // Show sidebar unless user explicitly closed it
    if (sidebar && sidebarSaved !== "false") {
      sidebar.classList.remove("hidden");
      updateActivityBarUI();
    }
    loadDirectory(currentFolderPath);
    updateSidebarTitle(currentFolderPath);
    startFolderWatch(currentFolderPath);
  }

  // Restore view mode
  if (currentViewMode !== "split") setViewMode(currentViewMode);

  // Restore outline
  if (localStorage.getItem("kaelio-outline") === "true") toggleOutline();

  // Focus mode was removed; clear old saved state so the menu stays visible.
  localStorage.removeItem("kaelio-zen");

  // Start recovery timer
  scheduleRecovery();

  // Check for crash recovery
  setTimeout(checkRecovery, 500);

  // Check for updates after 3s
  setTimeout(checkForUpdates, 3000);

  // Scroll sync
  initScrollSync();

  // Custom preview CSS
  loadCustomCSS();

  // Re-apply appearance after custom CSS loads.
  applyTheme();
  applyTypography();
  applyExplorerTypography();
  updateActivityBarUI();

  // Persist tab state to disk on close, app switch, and periodically
  window.addEventListener("beforeunload", () => persistOpenTabs());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persistOpenTabs();
  });
  setInterval(() => persistOpenTabs(), 30000);
});
