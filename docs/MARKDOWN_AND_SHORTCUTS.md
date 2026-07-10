# Markdown support & shortcuts

Markdown is the source of truth. Everything you type is rendered live and
serialised back to GFM Markdown on every change.

## Type-to-format (input rules)

Type these at the **start of a line** — the trigger text is removed as the
block transforms. Most fire on the trailing space; `` ``` `` and `---` convert
**instantly** on the third character (Notion parity):

| Type | Becomes |
|---|---|
| `# ` … `###### ` | Heading 1–6 |
| `- ` or `* ` | Bulleted list |
| `1. ` (any number) | Numbered list |
| `[ ] ` | To-do item (unchecked) |
| `[x] ` | To-do item (checked) |
| `> ` | Blockquote |
| `` ``` `` | Code block — instant on the third backtick (`` ``` `` + space still works) |
| `---` | Divider — instant on the third dash |
| `___ ` or `*** ` | Divider — space-triggered, so `***bold italic***` stays typeable |

Pressing `Enter` on a paragraph that is exactly `---`, `___` or `***` (three
or more of the same character) also converts it to a divider.

Inline marks fire as you close the delimiter, mid-line:

| Type | Becomes |
|---|---|
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `` `code` `` | `code` |
| `~~strike~~` | ~~strike~~ |
| `==highlight==` | highlighted `<mark>` — via the `highlight()` plugin, not core |
| `$x^2$` | inline TeX chip — via the `math()` plugin, not core |

Input rules never fire inside code blocks, and never mid-IME-composition
(CJK/dead-key input is safe). With the `callout()` plugin, typing `[!note] `
(or `tip`/`important`/`warning`/`caution`) at the start of a quote turns it
into a callout.

## Plugin-provided syntax (opt-in)

These lines only mean something when the corresponding first-party plugin is
installed — and every one of them stays valid, lossless Markdown without it.
Details, options and worked examples:
[First-party plugins](FIRST_PARTY_PLUGINS.md).

| Syntax | Plugin | Stored as |
|---|---|---|
| `==highlight==` | `highlight()` | `==…==` (extension flavour — plain viewers show the markers) |
| `> [!NOTE]` … `[!CAUTION]` | `callout()` | a GitHub alert — an ordinary blockquote elsewhere |
| `$x^2$` and `$$…$$` blocks | `math()` | TeX between dollars — GitHub renders both natively |
| ` ```edd ` / ` ```mermaid ` fences | `edodoDraw()` / `diagrams()` | a plain fenced code block — GitHub renders mermaid natively |
| `#tag` → suggestion menu | `tags()` | a plain GFM link `[#tag](href)`, or plain text — zero new syntax |
| a paragraph that is one bare URL | `embeds()` | the bare URL line — a clickable autolink everywhere else |

## Slash menu

Press `/` at the start of an empty paragraph — or an empty list item — to open
the block picker. Type to filter (multi-word queries like `/heading 1` work),
`↑`/`↓` to move, `Enter` or `Tab` to insert, `Esc` to dismiss; a query with no
matches closes the menu.

Items are grouped: **Basic blocks** (Text, Heading 1–3, Bulleted list, Numbered
list, To-do list, Quote, Code, Divider), **Media** (Image — a popover with an
**Upload…** button that sends files through your `uploadImage`, plus a URL +
alt form; inserts `![alt](src)` — see [Image hosting](IMAGE_HOSTING.md); and
Table — a 3×3 GFM table), **Advanced** (Heading 4–6). Plugins add their own
items: `callout()` adds Callout and Warning callout under Media, `math()` adds
Math block under Advanced, and `edodoDraw()` / `diagrams()` add Diagram /
Mermaid diagram under Media.

## Floating toolbar

Select text to reveal a toolbar with Bold, Italic, Strikethrough, Inline code,
Link (opens the link popover), Heading 1/2 and Quote. Plugins can add buttons
(`highlight()` adds one).

## Links

The link popover replaces any prompt-based flow:

- **⌘/Ctrl+K** or the toolbar `🔗` button with text selected → enter a URL.
- **Click an existing link** while editing → edit the URL, Open, or Remove.
- **Paste a URL over selected text** → the selection becomes a link.

## Tables

`/table` inserts a 3×3 GFM table (or run the `table` command with
`{ rows?, cols? }` — clamped to 50 rows × 12 columns). The caret lands in the
first header cell; just type. Tables are GFM-shaped by construction: a header
row (`thead th`) plus body rows.

Keys inside a table:

| Keys | Action |
|---|---|
| `Tab` | Next cell; in the **last** cell, append a new row (and move into it) |
| `Shift + Tab` | Previous cell; in the first cell it is consumed — never escapes the table |
| `Enter` | The cell below (same column); from the **last row**, escape to a paragraph below the table |
| `Shift + Enter` | A line break **inside** the cell — stored as a literal `<br>`, the GFM idiom for multi-line cells |
| `Backspace` | Deletes text only — it never merges cells and never pulls outside content into the table |

Structure editing lives in the block menu — click the `⣿` grip on a table and
a **Table** group appears with *Add row below*, *Add column right*, *Delete
row* and *Delete column*, all relative to the **caret's cell** (click a cell
first). Two rules come from GFM itself:

- **The header row is protected.** GFM tables require one, so *Delete row* on
  the header refuses with a toast ("Markdown tables need their header row").
- **There is no header column.** GFM can't represent one, so none is offered.

*Turn into* entries are hidden for tables (moving cell contents into a heading
would destroy the grid); *Duplicate*, *Copy as Markdown* and *Delete* still
work. Enter and Backspace outside the table keep their guards: a paragraph
never merges into a table, and Enter on the block escapes below it.

Cells serialise **padded** (`| a   |`) — the canonical GFM form, stable from
the first save onwards. An empty cell holds a `<br>` caret anchor in the
editor and serialises empty.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";

const host = document.createElement("div");
document.body.appendChild(host);

// Tables normalise to padded GFM cells on the first save, then stay
// byte-stable.
const editor = new EdodoWrite(host, { value: "| a | b |\n| --- | --- |\n| 1 | 2 |" });
const padded = "| a   | b   |\n| --- | --- |\n| 1   | 2   |";
assert.equal(editor.getMarkdown(), padded);
editor.setMarkdown(padded, { silent: true });
assert.equal(editor.getMarkdown(), padded);

// The `table` command inserts a GFM-shaped table: thead header row + tbody.
editor.setMarkdown("intro", { silent: true });
editor.exec("table", { rows: 2, cols: 2 });
assert.equal(editor.content.querySelectorAll("thead th").length, 2);
assert.equal(editor.content.querySelectorAll("tbody tr").length, 1);
assert.ok(editor.getMarkdown().includes("| --- | --- |"));
editor.destroy();
```

## Block handles (hover gutter)

Hover any block for the left-gutter handle:

- `+` inserts an empty paragraph below the block.
- Drag the `⣿` grip to reorder top-level blocks (drop-indicator line + ghost).
- **Click** the `⣿` grip for the block menu: *Turn into* (Text, Heading 1–3,
  Bulleted list, Numbered list, To-do list, Quote, Code), *Duplicate*, *Copy as
  Markdown*, *Delete*. On a table, *Turn into* is replaced by the **Table**
  group (row/column operations — see [Tables](#tables)).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `⌘/Ctrl + B` | Bold |
| `⌘/Ctrl + I` | Italic |
| `⌘/Ctrl + Shift + E` | Inline code |
| `⌘/Ctrl + K` | Link popover (needs a selection, or the caret on a link) |
| `⌘/Ctrl + Shift + 7` | Numbered list |
| `⌘/Ctrl + Shift + 8` | Bulleted list |
| `⌘/Ctrl + Shift + 9` | To-do list |
| `⌘/Ctrl + Z` | Undo |
| `⌘/Ctrl + Shift + Z` or `⌘/Ctrl + Y` | Redo |
| `⌘/Ctrl + U` | Swallowed — Markdown has no underline |
| `Tab` / `Shift + Tab` | Indent / outdent a list item (implemented by the editor, not the browser; the first item of a list cannot indent). In a table: next / previous cell — see [Tables](#tables) |
| `Shift + Enter` | Soft line break within a block (a backslash hard break in the Markdown); a plain newline inside a code block; a literal `<br>` inside a table cell |
| `Enter` (in/at end of a heading or quote) | New **paragraph** below |
| `Enter` (in a list item) | Split the item; in an **empty** item, exit the list |
| `Enter` (in a code block) | New line, not a new block |
| `Enter` (in a table cell) | The cell below; from the last row, escape to a paragraph below the table |
| `Backspace` (start of heading/quote) | Convert to paragraph |
| `Backspace` (start of a list item) | Outdent; at top level, turn into a paragraph |
| `Backspace` (start of paragraph) | Merge into the previous block; a preceding divider (or widget figure) is deleted; a table is never merged into |

`Mod` shortcuts from plugins run before the built-ins — `highlight()` binds
`⌘/Ctrl + Shift + H`.

## Copy, paste & drag

- **Copy / cut** put the selection on the clipboard as **Markdown**
  (`text/plain`) and as rich HTML (`text/html`, regenerated from that Markdown)
  — pasting into a plain-text field yields Markdown; pasting into Docs/Word
  yields formatting, without editor internals.
- **Paste** accepts both flavours: rich HTML from the web is sanitised and
  converted to Markdown; plain text is treated as Markdown. Either way it is
  inserted as real blocks (headings, lists, quotes…), splitting the current
  block where needed. A single-paragraph paste inserts inline at the caret.
- **Paste a bare URL over a selection** to link it.
- **Paste an image file** (a screenshot, a copied image) and it is uploaded via
  the configured `uploadImage` — or embedded as a `data:` URL — then inserted
  as `![alt](url)`. Image files win over text flavours on the same clipboard.
- **Drop image files** from your file manager to insert them at the drop
  point, through the same upload path. See [Image hosting](IMAGE_HOSTING.md).
- **Drag** a block by the `⣿` grip to reorder; **click** the grip for the block
  menu.

## Serialised Markdown (the output flavour)

Output is **GitHub-Flavored Markdown**: ATX headings (`#`), `-` bullets, `1.`
ordered lists, fenced code blocks, `*italic*` / `**bold**` / `~~strike~~`,
inlined links, task lists (`- [ ]` / `- [x]`), and tables. Specifics worth
knowing:

- **Nested lists indent by 4 spaces.**
- **Soft line breaks (Shift+Enter) serialise as backslash hard breaks**
  (`line\` + newline) — round-trip safe even through editors that trim
  trailing whitespace.
- **Code fences are preserved byte-for-byte** — alignment spaces, trailing
  whitespace and blank-line runs inside a fence are never rewritten.
- Literal `<` in prose is escaped (`\<`) so text like `a<b>c` or a spelled-out
  `<script>` survives; `&` is escaped only when it would form an HTML entity.
- Non-breaking spaces that `contentEditable` produces are normalised to plain
  spaces in prose (never inside code fences).
- Empty paragraphs (a stray `<p><br></p>` left by editing) are dropped; runs
  of 3+ blank lines collapse to one blank line.
- Tables normalise to padded GFM cells (`| a   | b   |`) — stable from the
  second serialisation onwards.

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

// Nested lists: 4-space indentation, round-trip stable.
const editor = new EdodoWrite(host, { value: "- parent\n    - child" });
assert.equal(editor.getMarkdown(), "- parent\n    - child");

// Soft breaks are backslash hard breaks.
editor.setMarkdown("first line\\\nsecond line", { silent: true });
assert.equal(editor.getMarkdown(), "first line\\\nsecond line");

// Task lists.
editor.setMarkdown("- [ ] open\n- [x] done", { silent: true });
assert.equal(editor.getMarkdown(), "- [ ] open\n- [x] done");
editor.destroy();
```

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

// Code fences round-trip byte-for-byte — including trailing spaces and
// blank-line runs that the prose tidy would otherwise rewrite.
const fence = "`".repeat(3);
const value = fence + "\nspaced   out\n\n\nkept verbatim   \n" + fence;
const editor = new EdodoWrite(host, { value });
assert.equal(editor.getMarkdown(), value);
editor.destroy();
```

Task-list checkboxes are interactive in the editor; ticking one updates the
Markdown from `[ ]` to `[x]`.

## Notes & limits

- **Tables are fully editable GFM tables** — typing in cells, Tab/Shift+Tab
  navigation, Enter row-hopping, and block-menu row/column operations (see
  [Tables](#tables)). Two limits come from GFM itself: the header **row** is
  required (deleting it is refused with a toast), and a header **column** is
  not representable, so none is offered.
- **Toggles / `<details>` are deliberately rejected** — they have no clean
  Markdown form, and this editor never stores anything Markdown can't express
  (`details`/`summary` are not in the sanitiser's allow-list).
- **Highlight (`==…==`) is a plugin, not core** — plain-GFM viewers would show
  the raw `==` markers, so you opt in via `highlight()`.
- **Underline is intentionally not offered** (⌘/Ctrl+U is swallowed): Markdown
  has no underline, so it could never survive a save.
- **Undo collapses view states that serialise identically** — the history is a
  stack of Markdown snapshots, so two DOM states with the same Markdown are one
  entry.
- Ordered lists created by commands or the slash menu start at 1; a `start`
  attribute from parsed Markdown (`3.`) is preserved on round-trip.
