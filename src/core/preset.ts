/**
 * The core preset — every built-in feature, expressed through the SAME plugin
 * API third parties use. This is deliberate dogfooding: the registry code path
 * runs on every keystroke of every user, so it cannot bit-rot, and this file
 * is living documentation of the API.
 *
 * Remove pieces with `new EdodoWrite(host, { exclude: ["taskList", …] })`.
 * The structural editing engine (Enter/Backspace/Tab, history, clipboard,
 * sanitizer floor) is NOT here — see keymap.ts / editor.ts — because those
 * are invariants, not features.
 */

import type { EdodoPlugin, EditorContext } from "./types.js";
import { coreCommands } from "./commands.js";
import { openLinkEditor } from "./link-ui.js";
import { buildFieldForm } from "./ui.js";
import type { EditorUIImpl } from "./ui.js";
import { placeCaretAtStart, placeCaretAtEnd, selectionRect, currentBlock } from "./dom.js";

/** Turn the hovered block into `cmd`. The caret is already inside the block
 *  (the block menu places it before running items), so exec targets it.
 *  Hidden for tables/figures — moving their children into a heading would
 *  destroy the structure. */
function turnInto(id: string, title: string, cmd: string): NonNullable<EdodoPlugin["blockMenuItems"]>[number] {
  return {
    id: `turn-${id}`,
    title,
    group: "Turn into",
    when: (_ctx, block) => block.tagName !== "TABLE" && block.tagName !== "FIGURE",
    run: (ctx, block) => {
      placeCaretAtStart(block);
      ctx.exec(cmd as string);
    },
  };
}

function openImageForm(ctx: EditorContext): void {
  const anchor = selectionRect() ?? currentBlock(ctx.root)?.getBoundingClientRect();
  if (!anchor) return;
  const ui = ctx.ui as EditorUIImpl;
  ctx.ui.popover({
    anchor,
    placement: "below",
    render(el, close) {
      // Hidden file input backing the "Upload…" action. The editor's
      // `insertImages` handles placeholders + the configured uploader.
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.multiple = true;
      fileInput.style.display = "none";
      fileInput.setAttribute("data-testid", "ew-image-file");
      fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files ?? []);
        const alt = (el.querySelector('input[name="alt"]') as HTMLInputElement | null)?.value.trim();
        close();
        if (!files.length) return;
        ui.restoreSelection();
        void ctx.editor.insertImages(files, { alt: alt || undefined });
      });

      buildFieldForm(el, {
        fields: [
          { name: "src", label: "Image URL", placeholder: "Paste an image URL…" },
          { name: "alt", label: "Alt text", placeholder: "Describe the image (alt text)" },
        ],
        submitLabel: "Insert image",
        actions: [{ label: "Upload…", onPick: () => fileInput.click() }],
        onSubmit(values) {
          close();
          if (!values.src) return;
          ui.restoreSelection();
          ctx.exec("image", { src: values.src, alt: values.alt || undefined });
        },
      });
      el.appendChild(fileInput);
    },
  });
}

export function corePreset(): EdodoPlugin {
  return {
    name: "core",
    priority: 0,
    commands: coreCommands,

    inputRules: [
      // Block rules — `apply: command` inherits the convert-first → strip →
      // re-anchor sequence (see input-rules.ts).
      { kind: "block", trigger: /^# $/, apply: "heading1" },
      { kind: "block", trigger: /^## $/, apply: "heading2" },
      { kind: "block", trigger: /^### $/, apply: "heading3" },
      { kind: "block", trigger: /^#### $/, apply: "heading4" },
      { kind: "block", trigger: /^##### $/, apply: "heading5" },
      { kind: "block", trigger: /^###### $/, apply: "heading6" },
      { kind: "block", trigger: /^> $/, apply: "blockquote" },
      { kind: "block", trigger: /^[-*] $/, apply: "bulletList" },
      { kind: "block", trigger: /^\d+\. $/, apply: "orderedList" },
      { kind: "block", trigger: /^\[[ xX]?\] $/, apply: "taskList" },
      {
        // Fenced code — INSTANT on the third backtick (Notion parity); the
        // optional space keeps the old "``` " gesture working. The block must
        // be EMPTIED first: toggleCodeBlock copies the block text into the
        // <code>, and the trigger must not ride in.
        kind: "block",
        trigger: /^``` ?$/,
        apply: (ctx, m, block) => {
          ctx.dom.deleteLeadingChars(block, m[0].length);
          ctx.exec("codeBlock");
          return true;
        },
      },
      {
        // Divider — INSTANT on the third dash (Notion parity). Same
        // delete-first ordering: insertDivider removes the current block only
        // when it is already empty.
        kind: "block",
        trigger: /^-{3}$/,
        apply: (ctx, m, block) => {
          ctx.dom.deleteLeadingChars(block, m[0].length);
          ctx.exec("divider");
          return true;
        },
      },
      {
        // Divider, space-triggered variants. "___ " and "*** " are NOT
        // instant — typing "***bold italic***" must stay possible.
        kind: "block",
        trigger: /^(-{3}|_{3}|\*{3}) $/,
        apply: (ctx, m, block) => {
          ctx.dom.deleteLeadingChars(block, m[0].length);
          ctx.exec("divider");
          return true;
        },
      },
      // Inline rules — the lookbehinds keep guard chars out of the match.
      { kind: "inline", trigger: /\*\*([^*\n]+)\*\*$/, apply: "strong" },
      { kind: "inline", trigger: /~~([^~\n]+)~~$/, apply: "del" },
      { kind: "inline", trigger: /`([^`\n]+)`$/, apply: "code" },
      { kind: "inline", trigger: /(?<![*\\])\*([^*\n]+)\*$/, apply: "em" },
      { kind: "inline", trigger: /(?<![_\w])_([^_\n]+)_$/, apply: "em" },
    ],

    keymap: {
      "Mod-b": "bold",
      "Mod-i": "italic",
      "Mod-Shift-e": "code",
      "Mod-Shift-7": "orderedList",
      "Mod-Shift-8": "bulletList",
      "Mod-Shift-9": "taskList",
      "Mod-k": (ctx) => openLinkEditor(ctx),
      // Notion parity: Enter on a paragraph that is exactly "---"/"___"/"***"
      // converts it to a divider (the space-triggered rule handles "--- ").
      // Returning false falls through to the structural Enter engine.
      Enter: (ctx) => {
        const block = ctx.dom.currentBlock();
        if (!block || block.tagName !== "P") return false;
        const text = (block.textContent ?? "")
          .split(String.fromCharCode(0x200b)).join("")
          .replace(/ /g, " ")
          .trim();
        if (!/^(-{3,}|_{3,}|\*{3,})$/.test(text)) return false;
        ctx.transact(() => {
          ctx.dom.deleteLeadingChars(block, (block.textContent ?? "").length);
          ctx.exec("divider");
        });
        return true;
      },
    },

    slashItems: [
      { id: "paragraph", title: "Text", hint: "Plain paragraph", keywords: ["text", "paragraph", "body"], group: "Basic blocks", command: "paragraph" },
      { id: "heading1", title: "Heading 1", hint: "Large section title", keywords: ["h1", "heading", "title", "big"], group: "Basic blocks", command: "heading1" },
      { id: "heading2", title: "Heading 2", hint: "Medium heading", keywords: ["h2", "heading", "subtitle"], group: "Basic blocks", command: "heading2" },
      { id: "heading3", title: "Heading 3", hint: "Small heading", keywords: ["h3", "heading"], group: "Basic blocks", command: "heading3" },
      { id: "bulletList", title: "Bulleted list", hint: "A simple bullet list", keywords: ["bullet", "unordered", "ul", "list"], group: "Basic blocks", command: "bulletList" },
      { id: "orderedList", title: "Numbered list", hint: "A numbered list", keywords: ["number", "ordered", "ol", "list"], group: "Basic blocks", command: "orderedList" },
      { id: "taskList", title: "To-do list", hint: "Track tasks with checkboxes", keywords: ["todo", "task", "check", "checkbox"], group: "Basic blocks", command: "taskList" },
      { id: "blockquote", title: "Quote", hint: "Capture a quote", keywords: ["quote", "blockquote", "cite"], group: "Basic blocks", command: "blockquote" },
      { id: "codeBlock", title: "Code", hint: "Fenced code block", keywords: ["code", "pre", "fence", "snippet"], group: "Basic blocks", command: "codeBlock" },
      { id: "divider", title: "Divider", hint: "Visual separator", keywords: ["divider", "hr", "rule", "line", "separator"], group: "Basic blocks", command: "divider" },
      { id: "image", title: "Image", hint: "Upload, paste, or embed from a URL", keywords: ["image", "img", "picture", "photo", "media", "upload"], group: "Media", run: openImageForm },
      { id: "table", title: "Table", hint: "3×3 table (Tab to move, Tab at the end adds a row)", keywords: ["table", "grid", "rows", "columns"], group: "Media", command: "table", payload: { rows: 3, cols: 3 } },
      { id: "heading4", title: "Heading 4", hint: "Sub-sub heading", keywords: ["h4", "heading"], group: "Advanced", command: "heading4" },
      { id: "heading5", title: "Heading 5", hint: "Rarely needed", keywords: ["h5", "heading"], group: "Advanced", command: "heading5" },
      { id: "heading6", title: "Heading 6", hint: "The smallest heading", keywords: ["h6", "heading"], group: "Advanced", command: "heading6" },
    ],

    toolbarItems: [
      { id: "bold", label: "B", title: "Bold  (⌘B)", command: "bold" },
      { id: "italic", label: "I", title: "Italic  (⌘I)", command: "italic" },
      { id: "strike", label: "S", title: "Strikethrough", command: "strike" },
      { id: "code", label: "</>", title: "Inline code", command: "code" },
      { id: "link", label: "🔗", title: "Link  (⌘K)", run: (ctx) => { openLinkEditor(ctx); } },
      { id: "heading1", label: "H1", title: "Heading 1", command: "heading1" },
      { id: "heading2", label: "H2", title: "Heading 2", command: "heading2" },
      { id: "blockquote", label: "❝", title: "Quote", command: "blockquote" },
      { id: "bulletList", label: "•–", title: "Bulleted list", command: "bulletList" },
      { id: "orderedList", label: "1.", title: "Numbered list", command: "orderedList" },
      { id: "codeBlock", label: "{ }", title: "Code block", command: "codeBlock" },
    ],

    blockMenuItems: [
      turnInto("paragraph", "Text", "paragraph"),
      turnInto("heading1", "Heading 1", "heading1"),
      turnInto("heading2", "Heading 2", "heading2"),
      turnInto("heading3", "Heading 3", "heading3"),
      turnInto("bulletList", "Bulleted list", "bulletList"),
      turnInto("orderedList", "Numbered list", "orderedList"),
      turnInto("taskList", "To-do list", "taskList"),
      turnInto("blockquote", "Quote", "blockquote"),
      turnInto("codeBlock", "Code", "codeBlock"),
      {
        id: "duplicate",
        title: "Duplicate",
        group: "Actions",
        run: (ctx, block) => {
          // Round-trip the block through Markdown so the copy is exactly what
          // would be stored — never a raw DOM clone with editor internals.
          const md = ctx.markdown.serialize(block.outerHTML);
          const holder = document.createElement("div");
          holder.innerHTML = ctx.markdown.parse(md);
          const clone = holder.firstElementChild as HTMLElement | null;
          if (!clone) return;
          block.after(clone);
          placeCaretAtEnd(clone);
        },
      },
      {
        id: "copy-markdown",
        title: "Copy as Markdown",
        group: "Actions",
        run: (ctx, block) => {
          const md = ctx.markdown.serialize(block.outerHTML);
          void navigator.clipboard?.writeText(md).then(
            () => ctx.ui.notify("Copied as Markdown"),
            () => ctx.ui.notify("Copy failed"),
          );
        },
      },
      {
        id: "delete",
        title: "Delete",
        group: "Actions",
        danger: true,
        run: (ctx, block) => {
          const next = (block.nextElementSibling ?? block.previousElementSibling) as HTMLElement | null;
          block.remove();
          if (next) placeCaretAtStart(next);
        },
      },
    ],
  };
}
