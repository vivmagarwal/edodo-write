/**
 * `edodo-write` — public npm entry point (framework-free core).
 *
 *   import { EdodoWrite } from "edodo-write";
 *   import "edodo-write/styles.css";
 *
 *   const editor = new EdodoWrite(document.getElementById("app"), {
 *     value: "# Hello\n\nType **markdown** and see it render.",
 *     onChange: (md) => console.log(md),
 *   });
 *
 * A React wrapper (`<EdodoWriteEditor value onChange />` + `<Markdown />`) is
 * available at `edodo-write/react`. Everything here is DOM/Markdown only — no
 * React import.
 */

// This import makes Vite EMIT dist-lib/edodo-write.css in the library build
// (lib mode strips the import from the output JS — consumers load the
// stylesheet explicitly via `import "edodo-write/styles.css"`).
import "../styles.css";

import { parseMarkdown, createMarkdownParser, type ParseOptions } from "../core/parse.js";
import { htmlToMarkdown } from "../core/serialize.js";
import { corePreset } from "../core/preset.js";
import { resolvePlugins } from "../core/plugin.js";
import type { EdodoPlugin } from "../core/types.js";

export { EdodoWrite } from "../core/editor.js";
export { parseMarkdown, createMarkdownParser, decorateTaskLists } from "../core/parse.js";
export { htmlToMarkdown, createMarkdownSerializer, tidyMarkdown } from "../core/serialize.js";
export { sanitizeHtml } from "../core/sanitize.js";
export { applyCommand, isInlineActive } from "../core/commands.js";
export { definePlugin } from "../core/plugin.js";
export { corePreset } from "../core/preset.js";
export { insertMarkdown } from "../core/clipboard.js";
export {
  dataUrlUploader, isImageFile, DATA_URL_MAX_BYTES, DOWNSCALE_MAX_DIMENSION,
} from "../core/image-upload.js";

export type {
  EditorOptions,
  EditorEvents,
  EditorEventName,
  SelectionInfo,
  BlockKind,
  Command,
  AnyCommand,
  CommandPayloads,
  CommandSpec,
  PayloadArgs,
  EdodoPlugin,
  EditorContext,
  EditorDom,
  EditorUI,
  PopoverOptions,
  MenuOptions,
  PopoverHandle,
  InputRule,
  BlockInputRule,
  InlineInputRule,
  KeyBinding,
  SlashItem,
  ToolbarItem,
  BlockMenuItem,
  MarkdownExtensionSpec,
  SanitizeOptions,
  ImageUploader,
  ImageUploadResult,
} from "../core/types.js";
export type { ParseOptions } from "../core/parse.js";
export type { SerializerExtension } from "../core/serialize.js";
export type { MarkdownPipeline } from "../core/clipboard.js";

export { toPlainText } from "./plain-text.js";
export type { PlainTextOptions } from "./plain-text.js";

/** Markdown → sanitised HTML. Alias of `parseMarkdown` for symmetry. */
export function toHTML(markdown: string, opts?: ParseOptions): string {
  return parseMarkdown(markdown, opts);
}

/** A reusable, plugin-aware render codec (see `createRenderCodec`). */
export interface RenderCodec {
  /** Markdown → sanitised, plugin-aware HTML. */
  render(md: string, opts?: ParseOptions): string;
}

/**
 * Build a plugin-aware render codec ONCE and reuse it across renders (SSR
 * loops, hot read paths). This is the *same* parse half an editor built with
 * these plugins uses (`resolvePlugins([corePreset(), ...plugins])` →
 * `createMarkdownParser(registry.markedExtensions, registry.sanitize)`), so
 * read-only render output matches what the editor would round-trip — the RFC's
 * "render codec === editor codec" invariant. Node-safe: the sanitiser is
 * DOM-free, so this runs in Next.js server components / edge just as well as in
 * the browser.
 */
export function createRenderCodec(plugins: EdodoPlugin[] = [], exclude?: string[]): RenderCodec {
  const registry = resolvePlugins([corePreset(), ...plugins], exclude);
  const parse = createMarkdownParser(registry.markedExtensions, registry.sanitize);
  return { render: (md, opts) => parse(md, opts) };
}

/**
 * Markdown → sanitised, plugin-aware HTML in one call. Builds the codec fresh
 * each call; for hot paths build a `createRenderCodec` once and reuse it.
 */
export function renderMarkdownWithPlugins(
  md: string,
  plugins?: EdodoPlugin[],
  opts?: ParseOptions & { exclude?: string[] },
): string {
  const { exclude, ...parseOpts } = opts ?? {};
  return createRenderCodec(plugins, exclude).render(md, parseOpts);
}

/** HTML → Markdown. Alias of `htmlToMarkdown`. */
export function toMarkdown(html: string): string {
  return htmlToMarkdown(html);
}

/**
 * Render Markdown read-only. If `target` is given, its `innerHTML` is set (and
 * `ew`/`ew-content` classes are applied so the shared stylesheet styles it);
 * always returns the sanitised HTML string.
 */
export function renderMarkdown(markdown: string, target?: HTMLElement): string {
  const html = parseMarkdown(markdown);
  if (target) {
    target.classList.add("ew");
    target.innerHTML = `<div class="ew-content ew-content--readonly">${html}</div>`;
  }
  return html;
}
