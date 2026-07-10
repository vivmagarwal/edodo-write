# Notion UX study (and how edodo-write maps to it)

edodo-write aims for the *feel* of Notion/Medium — a smooth rich surface — over a
**Markdown** source of truth. This document records what we observed in Notion
(tested live on 2026-07-10) and the deliberate decisions edodo-write makes.
It's the behavioural spec: when in doubt about "what should happen when I press
X", this is the reference.

> The mental model (the project's guiding vision): the editor is a *façade* over
> Markdown — a virtual layer, like a UI framework's render tree over its state.
> You interact with rich blocks; the bytes that persist are Markdown.

## Architecture: how Notion does it vs. how we do it

- **Notion** uses a **block model**: each block is its own `contenteditable`
  leaf (`data-content-editable-leaf`), and the document is a tree of block
  records persisted as JSON. Rich by construction; Markdown is an import/export
  format.
- **edodo-write** uses the **Medium model**: one `contenteditable` surface whose
  top-level children are block elements, with **Markdown as the persisted
  state**. Parse hydrates the view; serialize (on every edit) produces Markdown.
  Simpler, dependency-light, and Markdown-native — at the cost of doing block
  splits/merges ourselves (see `keymap.ts`).

## Behaviours observed in Notion → edodo-write parity

| Behaviour | Notion | edodo-write |
|---|---|---|
| `#`/`##`/`###` + space | Heading 1/2/3 | ✅ same |
| `-` / `*` + space | Bulleted list | ✅ same |
| `1.` + space | Numbered list | ✅ same |
| `[]` / `[ ]` + space | To-do checkbox | ✅ same (`[x]` starts checked) |
| ` ``` ` | Code block | ✅ same |
| `---` | Divider | ✅ same |
| `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` | Inline as you close | ✅ same |
| **Enter at end of a heading** | New **paragraph** (not a heading) | ✅ same |
| **Enter inside a heading** | Splits; the new block is a paragraph | ✅ same |
| **Enter in a list item** | New item | ✅ same |
| **Enter in an EMPTY list item** | Exits the list to a paragraph | ✅ same |
| **Enter in a code block** | Newline | ✅ same |
| **Shift+Enter** | Soft line break within the block | ✅ same (`<br>`) |
| **Backspace at start of heading/quote** | Convert to text | ✅ same (→ paragraph) |
| **Backspace at start of list item** | Outdent / unlist to text | ✅ same |
| **Backspace at start of paragraph** | Merge into previous block | ✅ same |
| **Tab / Shift+Tab in a list** | Indent / outdent | ✅ same |
| **Selection toolbar** | Appears over selected text | ✅ same (Medium-style) |
| **Slash menu** on empty line | Block picker, filterable | ✅ same |
| **Block drag handle** (`⋮⋮` on hover) | Drag to reorder; drop indicator | ✅ same (`+` and `⣿` grip, drop line, ghost) |
| **Copy** | Clipboard carries Markdown + rich HTML | ✅ same |
| **Paste** Markdown / rich HTML | Renders as blocks | ✅ same |
| **Undo / redo** | Full history | ✅ Markdown-snapshot history (caret-preserving) |

## Deliberate divergences (Markdown is the contract)

- **`>` + space → blockquote**, not a toggle. In Notion `>` creates a *toggle*
  (a collapsible block, which has no Markdown representation). edodo-write
  follows **CommonMark**: `>` is a blockquote. Toggles are intentionally omitted
  because they can't round-trip to standard Markdown.
- **No block database / columns / callouts / embeds.** Those are Notion-native
  structures without a Markdown equivalent. edodo-write's block set is exactly
  what GFM Markdown can represent: headings, paragraphs, lists (bullet/ordered/
  task), blockquotes, code blocks, dividers, images, links, tables.
- **Underline** is offered by neither the toolbar nor a shortcut — Markdown has
  no underline. (Typed `<u>` survives as literal text.)
- **Nesting depth**: lists nest via Tab; edodo-write supports the common cases.
  Deeply nested mixed structures are best authored in Markdown directly.

## Feel details worth copying (and that we did)

- The drag handle lives in a quiet **left gutter** and only appears on hover, so
  it never competes with the writing surface.
- Reordering shows a **drop-indicator line** and a translucent **ghost** of the
  block, so the target is unambiguous.
- Type-to-format happens **as you type** (on the trailing space / closing
  delimiter), never as a separate "apply formatting" step.
- Everything the user does is immediately reflected as **clean Markdown** — the
  playground shows this live in a side panel, which is the honest demo of "the
  bytes you'd store."

## What we verified empirically (method)

Driven live in Notion via Playwright: typed sequences exercising `#`, `-`, `>`,
Enter after a heading, Enter on an empty list item, and inspected the resulting
blocks; hovered a block to confirm the `+`/`⋮⋮` gutter handle. edodo-write's own
behaviour was verified the same way against its running playground (see
`docs/DEVELOPMENT.md` → "Two-stage testing").
