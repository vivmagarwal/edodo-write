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

import { parseMarkdown, type ParseOptions } from "../core/parse.js";
import { htmlToMarkdown } from "../core/serialize.js";

export { EdodoWrite } from "../core/editor.js";
export { parseMarkdown, createMarkdownParser, decorateTaskLists } from "../core/parse.js";
export { htmlToMarkdown, createMarkdownSerializer, tidyMarkdown } from "../core/serialize.js";
export { sanitizeHtml } from "../core/sanitize.js";
export { applyCommand, isInlineActive } from "../core/commands.js";
export { definePlugin } from "../core/plugin.js";
export { corePreset } from "../core/preset.js";
export { insertMarkdown } from "../core/clipboard.js";

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
} from "../core/types.js";
export type { ParseOptions } from "../core/parse.js";
export type { SerializerExtension } from "../core/serialize.js";
export type { MarkdownPipeline } from "../core/clipboard.js";

/** Markdown → sanitised HTML. Alias of `parseMarkdown` for symmetry. */
export function toHTML(markdown: string, opts?: ParseOptions): string {
  return parseMarkdown(markdown, opts);
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
