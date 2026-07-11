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
| **Enter in a table cell** | Moves down a row | ✅ same — the cell below; from the last row it escapes to a paragraph below the table |
| **Tab / Shift+Tab in a table** | Next / previous cell | ✅ same — Tab in the last cell appends a row; Shift+Tab never escapes the table |
| **Shift+Enter** | Soft line break within the block | ✅ same (serialized as a backslash hard break; a literal `<br>` inside a table cell) |
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

### Rich blocks (tables, equations, mentions, embeds)

| Behaviour | Notion | edodo-write |
|---|---|---|
| **Tables** | Full grid: type in cells; hover handles per column/row with Insert/Move/Clear/Delete; + buttons on the edges | ✅ same pattern: hover a cell for the column pill (Insert left/right, Move, Clear contents, Delete column) and row pill (Insert above/below, Move, Clear, Delete row), plus + buttons on the right/bottom edges; Tab/Enter navigation. The header **row** is required by GFM (its destructive actions are disabled in the menu); a header **column** has no GFM form (see divergences) |
| **Equations** (inline + block) | KaTeX inline `$…$`-style and block equations | ✅ via the `math()` plugin — `$x^2$` chips and `$$…$$` widgets, KaTeX rendering when installed, styled plain TeX otherwise; stored as GitHub-native math syntax |
| **@-mentions** | People/pages via `@` | ✅ via the `tags()` plugin — a configurable trigger (`#`, `@`, …) and *your* suggestion source; stored as plain GFM links (`[#tag](href)`) or plain text — zero invented syntax |
| **Media embeds** (video/audio/bookmark) | Paste a URL → embed block | ✅ via the `embeds()` plugin — a paragraph that is one bare URL becomes a player/bookmark widget; stored as the bare URL line; a written `[title](url)` link is the opt-out |

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

**Toggles are opt-in only — never core.** A collapsible block has no clean
Markdown form: `<details>/<summary>` is raw HTML in the stored document. Core
keeps both tags out of its sanitizer allow-list and `>` keeps meaning
blockquote. The v0.5 stance was "rejected outright"; RFC 0001
(markdown-composer parity) superseded it in v0.8.0 with the first-party
[`detailsToggle()` plugin](FIRST_PARTY_PLUGINS.md#detailstoggle) — a
deliberate, narrow exception that stores
`<details data-md-open><summary>…</summary>…</details>` verbatim (GitHub and
most renderers show a working toggle with no plugin at all) and widens the
sanitizer for its own tags only. Hosts that don't register the plugin get
exactly the old behaviour: the sanitizer strips the unknown tags on parse
(the inner text survives as plain content).

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

**Tables are editable, with two GFM-imposed rules.** Typing, Tab/Enter
navigation and block-menu row/column operations are full parity (see the
rich-blocks table above). The divergences are GFM's, not ours: the header
**row** is required — *Delete row* on it refuses with a toast ("Markdown
tables need their header row") — and a header **column** is not representable
in GFM, so unlike Notion none is offered. The old guards still hold: Enter
never splits the `<table>` element, and Backspace never merges a paragraph
into one.

**No underline** — from the toolbar, a shortcut, or Mod-U (swallowed).
Markdown has no underline; a native `<u>` would silently vanish from the
serialized value, which is worse than refusing.

**Columns are deliberately NOT shipped.** GFM has no columns; raw-HTML layout
wrappers are rejected policy (the `detailsToggle()` exception is one narrow
semantic token, not a precedent for layout); Pandoc-style `:::` fenced divs
degrade to visible clutter; and the editing engine's document model is
deliberately a FLAT list of top-level blocks — that flatness is why
Enter/Backspace/drag/select-all are reliable. Columns require an engine
milestone (nested block scopes) before a plugin can exist. Roadmap item, not a
hack.

**No databases.** Notion-native structures without a Markdown equivalent stay
out. The block set is exactly what GFM can represent: headings, paragraphs,
lists (bullet/ordered/task), quotes (+ callouts via plugin), code blocks,
dividers, images, links, tables — plus plugin blocks with a paired, degradable
Markdown form (math, diagram fences, tag links, bare-URL embeds — see
[First-party plugins](FIRST_PARTY_PLUGINS.md)). Extendable through plugins
*only* where such a form exists.

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
Playwright suite (144 tests across 15 spec files, `npm run test:e2e`) drives the
same behaviours against the fixture page with real typing and asserts on
`getMarkdown()` — see [DEVELOPMENT.md](DEVELOPMENT.md) → "Three-stage
testing".
