# Notion UX study (and how edodo-write maps to it)

edodo-write aims for the *feel* of Notion/Medium — a smooth rich surface —
over a **Markdown** source of truth. This document records what we observed in
Notion (studied live on 2026-07-10) and the deliberate decisions edodo-write
makes. It is the behavioural spec: when in doubt about "what should happen
when I press X", this is the reference.

> The mental model (the project's guiding vision): the editor is a *façade*
> over Markdown — a virtual layer, like a UI framework's render tree over its
> state. You interact with rich blocks; the bytes that persist are Markdown.

## Architecture: how Notion does it vs. how we do it

- **Notion** uses a **block model**: each block is its own `contenteditable`
  leaf (`data-content-editable-leaf`), and the document is a tree of block
  records persisted as JSON. Rich by construction; Markdown is an
  import/export format.
- **edodo-write** uses the **Medium model**: one `contenteditable` surface
  whose top-level children are block elements, with **Markdown as the
  persisted state**. Parse hydrates the view; serialize (on every edit)
  produces Markdown. Simpler, dependency-light, and Markdown-native — at the
  cost of doing block splits/merges ourselves (see `keymap.ts`) and repairing
  native damage after every input (see the normalizer in
  [ARCHITECTURE.md](ARCHITECTURE.md)).

## Behaviours observed in Notion → edodo-write parity

### Type-to-format

| Behaviour | Notion | edodo-write |
|---|---|---|
| `#` … `###` + space | Heading 1/2/3 | ✅ same |
| `####` … `######` + space | (n/a — Notion stops at H3) | ✅ headings 4–6 (Markdown has six) |
| `-` / `*` + space | Bulleted list | ✅ same |
| `1.` + space | Numbered list | ✅ same |
| `[]` / `[ ]` + space | To-do checkbox | ✅ same (`[x]` starts checked) |
| ` ``` ` + space | Code block | ✅ same |
| `---` + space | Divider | ✅ same |
| `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` | Inline as you close | ✅ same |

### Keys

| Behaviour | Notion | edodo-write |
|---|---|---|
| **Enter at end of / inside a heading** | New block is a **paragraph** | ✅ same |
| **Enter in a list item** | New item | ✅ same |
| **Enter in an EMPTY list item** | Exits the list to a paragraph | ✅ same |
| **Enter in a code block** | Newline | ✅ same |
| **Enter on a table** | — | ✅ escapes to a paragraph below (guard; see divergences) |
| **Shift+Enter** | Soft line break within the block | ✅ same (serialized as a backslash hard break) |
| **Backspace at start of heading/quote** | Convert to text | ✅ same (→ paragraph) |
| **Backspace at start of list item** | Outdent / unlist to text | ✅ same |
| **Backspace at start of paragraph** | Merge into previous block | ✅ same (deletes a preceding divider outright; never merges into a table or code block) |
| **Tab / Shift+Tab in a list** | Indent / outdent | ✅ same |
| **Mod-U (underline)** | Underlines (block model) | ✅ swallowed — Markdown has no underline, so the `<u>` would silently vanish from the saved value |
| **Select-all, then type or delete** | Document resets to one clean paragraph | ✅ same (natively Chrome keeps the first block's emptied shell — typing would land in a stale heading) |

### Menus, popovers, handles

| Behaviour | Notion | edodo-write |
|---|---|---|
| **Slash menu** on empty line | Block picker, filterable, grouped | ✅ same — group headers, works in empty list items, Escape or a no-match query closes |
| Slash query with spaces (`/heading 1`) | Keeps filtering | ✅ same (word-wise matching; a space no longer kills the menu) |
| **Selection toolbar** | Appears over selected text | ✅ same (Medium-style) |
| **Link editing** | Inline popover | ✅ same — Mod-K / toolbar 🔗 opens a popover (no `window.prompt`); clicking an existing link offers edit / open / remove |
| **Paste a URL over a selection** | Turns the selection into a link | ✅ same |
| **Block handle** (`⋮⋮` on hover) | Drag to reorder; drop indicator | ✅ same (`+` and grip, drop line, translucent ghost) |
| **Block menu** (click the handle) | Turn into / duplicate / delete / … | ✅ same — grip *click* opens: Turn into (Text, H1–3, lists, to-do, quote, code), Duplicate, Copy as Markdown, Delete |
| **Insert below** (`+` on hover) | New empty block | ✅ same |
| **Image** | Picker / embed dialog | ✅ slash item → URL + alt popover → `![alt](src)` |
| **Per-block placeholder** | "Type / for commands…" on the focused empty line | ✅ same (document-level placeholder covers the empty document) |
| **Click below the last block** | Appends a paragraph | ✅ same |

### Data in / data out

| Behaviour | Notion | edodo-write |
|---|---|---|
| **Copy** | Clipboard carries Markdown + rich HTML | ✅ same (`text/plain` is Markdown; `text/html` is regenerated from it so editor internals never leak into Docs/Word) |
| **Paste** Markdown / rich HTML | Renders as blocks | ✅ same (HTML is sanitised → Markdown → real blocks) |
| **Undo / redo** | Full history | ✅ Markdown-snapshot history, caret-preserving (see the honest limitation in [ARCHITECTURE.md](ARCHITECTURE.md)) |
| **Read-only mode** | Page-level toggle | ✅ `setReadOnly(bool)`, runtime-toggleable in both directions |

## Deliberate divergences (Markdown is the contract — policy record)

These are settled decisions. Do not re-litigate them without new facts.

**`>` + space → blockquote, not a toggle.** In Notion `>` creates a *toggle*
(collapsible block). edodo-write follows CommonMark: `>` is a blockquote.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "> quoted, per CommonMark" });
assert.ok(editor.getHTML().includes("<blockquote>"));
assert.equal(editor.getMarkdown(), "> quoted, per CommonMark");
editor.destroy();
```

**Toggles are REJECTED.** A collapsible block has no clean Markdown form:
`<details>/<summary>` is raw HTML that most Markdown pipelines strip or render
inert, and it round-trips badly. The tags were removed from the sanitizer
allow-list; a plugin cannot reintroduce collapsed state as a first-class
block. If content must collapse, that is the host application's concern, not
the stored document's.

**Callouts map to GitHub alert syntax** (via the first-party `callout()`
plugin, not core). Notion's callouts have no Markdown form, so the deliberate
mapping is `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` /
`[!CAUTION]`: plain Markdown that GitHub renders natively and that degrades to
an ordinary blockquote in any other viewer. In the editor a callout is
`<blockquote data-callout="…">`, styled with a coloured border; type `[!note] `
inside a quote or use the slash items.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { callout } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "> [!NOTE]\n> Stored as plain Markdown.",
  plugins: [callout()],
});
assert.ok(editor.getHTML().includes('data-callout="note"'));
assert.equal(editor.getMarkdown(), "> [!NOTE]\n> Stored as plain Markdown.");
editor.destroy();
```

**Highlight is a plugin, not core.** `==text==` is not CommonMark or GFM — it
is an extension flavour (Obsidian et al.), so it ships as the first-party
`highlight()` plugin (`==text==` ↔ `<mark>`, Mod-Shift-H) that integrators opt
into knowing their Markdown consumers support it.

**Tables render and round-trip, but have no editing UX yet.** GFM tables
parse, display, and serialize faithfully; until real table editing lands, two
guards prevent corruption: Enter on a table escapes to a paragraph below it
(splitting would clone the `<table>`), and Backspace never merges a paragraph
into a table.

**No underline** — from the toolbar, a shortcut, or Mod-U (swallowed).
Markdown has no underline; a native `<u>` would silently vanish from the
serialized value, which is worse than refusing.

**No databases, columns, or embeds.** Notion-native structures without a
Markdown equivalent. The block set is exactly what GFM can represent:
headings, paragraphs, lists (bullet/ordered/task), quotes (+ callouts via
plugin), code blocks, dividers, images, links, tables — extendable through
plugins *only* where a paired Markdown form exists.

**Nesting depth**: lists nest via Tab; the common cases are supported. Deeply
nested mixed structures are best authored in Markdown directly.

## Feel details worth copying (and that we did)

- The block handle lives in a quiet **left gutter** and only appears on hover,
  so it never competes with the writing surface. Click and drag are the same
  affordance: press-and-move reorders, press-and-release opens the menu.
- Reordering shows a **drop-indicator line** and a translucent **ghost** of
  the block, so the target is unambiguous.
- Type-to-format happens **as you type** (on the trailing space / closing
  delimiter), never as a separate "apply formatting" step.
- Popovers never destroy the selection they act on — the link editor's input
  can take focus while the text selection is saved and restored around the
  command (`ui.ts`).
- Menus that open under the resting pointer don't let hover steal the keyboard
  highlight until the mouse actually moves.
- Everything the user does is immediately reflected as **clean Markdown** —
  the playground shows this live in a side panel, which is the honest demo of
  "the bytes you'd store."

## What we verified empirically (method)

The original study drove Notion live via Playwright (typed sequences
exercising `#`, `-`, `>`, Enter after a heading, Enter on an empty list item;
hovered blocks to inspect the gutter handles) and inspected the resulting
block DOM. edodo-write's side of the matrix is enforced continuously: the
Playwright suite (99 tests across 9 spec files, `npm run test:e2e`) drives the
same behaviours against the fixture page with real typing and asserts on
`getMarkdown()` — see [DEVELOPMENT.md](DEVELOPMENT.md) → "Three-stage
testing".
