# Architecture

edodo-write is a thin controller over a native `contentEditable` surface. The
guiding model (the "façade over Markdown"): the surface is the **view**,
**Markdown is the state**, and parse/serialize is the **reconciler**. There is no
bespoke document model to learn or store — the bytes you persist are Markdown.

## Pipeline

```
Markdown ──parse (marked + sanitize)──▶ HTML in contentEditable
   ▲                                            │
   └───────── serialize (turndown + gfm) ◀──────┘  (on every edit)
```

- **Parse** (`src/core/parse.ts`) — `marked` (GFM) → `sanitizeHtml` → task-list
  decoration. A `{ sanitize: false }` path returns raw `marked` HTML for trusted
  DOM-free SSR.
- **Serialize** (`src/core/serialize.ts`) — `turndown` + the GFM plugin (tables,
  strikethrough, task lists), plus escaping/normalising rules: escape `<` so
  prose like `<script>` survives; escape entity-forming `&`; one-space list
  markers; strip caret-parking zero-width spaces.
- **Sanitize** (`src/core/sanitize.ts`) — dependency-free allow-list scrubber:
  strips scripts, event handlers, `javascript:` URLs.

## Modules

| File | Responsibility |
|---|---|
| `src/core/editor.ts` | `EdodoWrite` — mounts the surface, owns events + undo history, wires everything together. |
| `src/core/parse.ts` | Markdown → sanitised HTML. |
| `src/core/serialize.ts` | HTML → Markdown (with escaping rules). |
| `src/core/sanitize.ts` | HTML allow-list sanitiser. |
| `src/core/commands.ts` | `applyCommand` — inline + block transforms (manual DOM). |
| `src/core/input-rules.ts` | Markdown "type-to-format" transforms. |
| `src/core/keymap.ts` | Enter/Backspace/Tab + shortcuts; clean block splits/merges. |
| `src/core/clipboard.ts` | Copy/cut → Markdown; paste Markdown/HTML → blocks. |
| `src/core/block-handles.ts` | Hover gutter (`+` / `⣿`) + pointer drag-to-reorder. |
| `src/core/toolbar.ts` | Floating selection toolbar. |
| `src/core/slash-menu.ts` | `/` block picker. |
| `src/core/dom.ts` | Selection/caret/DOM helpers (shared toolbox). |
| `src/core/types.ts` | Shared types. |
| `src/lib/index.ts` | Public core entry (`edodo-write`). |
| `src/lib/react.tsx` | React wrapper (`edodo-write/react`). |
| `src/styles.css` | Editor + toolbar + slash + drag styles, themed. |

## Undo / redo

A stack of **Markdown snapshots** (`editor.ts`). Because Markdown is the state,
undo/redo just restores a previous snapshot (`setMarkdown` + a caret-offset
restore so the cursor lands near where it was). Snapshots are recorded on every
structural change and, debounced, on typing pauses — so a burst of typing is one
undo step. This is uniform across *all* operations (typing, formatting, paste,
drag), unlike native `execCommand` undo which can't see manual DOM changes.

## Editing: how a keystroke becomes clean Markdown

1. `input` fires → `runInputRules` may transform the line (`# ` → heading, etc.),
   then a debounced `change` re-serialises to Markdown.
2. Enter/Backspace/Tab are intercepted in `keymap.ts` and performed as manual DOM
   splits/merges, guaranteeing proper block elements (never a stray `<div>`) and
   Notion-like semantics (heading→paragraph on Enter, empty-list-item exits, …).
3. Block/inline commands go through `applyCommand` (`commands.ts`); the toolbar,
   slash menu, keymap and public `exec()` all funnel through it.
4. Clipboard and drag mutate the DOM, then the editor re-serialises.

## Key decisions (and the contentEditable gotchas behind them)

- **Block transforms are hand-rolled DOM, not `execCommand`.** Chrome silently
  drops `execCommand` block ops called inside an `input` event — exactly where
  input rules run. Manual DOM is reliable there and in tests. Inline marks still
  use `execCommand` from the toolbar/keymap (outside `input`) for free undo.
- **Enter/Backspace are intercepted** so the block model stays clean. Left to the
  browser, Enter at the end of a heading inserts a `<div>`; we split into a clean
  `<p>` instead.
- **Empty blocks need a `<br>` caret anchor.** An element with no child — or only
  *empty* text nodes (what `extractContents` leaves at a text-node boundary) —
  isn't a placeable caret; Chrome types before it. `ensureNotEmpty()` normalises.
- **A typed trailing space becomes `U+00A0`**; input rules normalise it.
- **Zero-width spaces park the caret** out of a new inline mark; stripped on
  serialize.
- **Single contentEditable, Markdown state** (the Medium model) rather than
  Notion's per-block editors + JSON — simpler and Markdown-native, at the cost of
  doing block splits/merges ourselves. See [NOTION_UX_STUDY.md](NOTION_UX_STUDY.md).

## Build

Vite, dual output:
- `vite.lib.config.ts` → `dist-lib/` — two ESM entries (`index`, `react`), all
  dependencies externalised, one CSS file (`edodo-write.css`). Types via
  `tsc -p tsconfig.lib.json`.
- `vite.config.ts` → `dist/` — the playground/docs SPA for GitHub Pages.

Tests are Vitest (jsdom). The pure Markdown engine and the execCommand-free DOM
paths are unit-tested; interactive `execCommand`/selection/drag/clipboard
behaviour is verified in a real browser (see [DEVELOPMENT.md](DEVELOPMENT.md)).
