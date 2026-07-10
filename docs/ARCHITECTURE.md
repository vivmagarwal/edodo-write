# Architecture

edodo-write is a thin controller over a native `contentEditable` surface.
Markdown is the contract: it is parsed to HTML on load and serialised back to
Markdown on every change. There is no bespoke document model to learn or store.

## Pipeline

```
Markdown ──parse (marked + sanitize)──▶ HTML in contentEditable
   ▲                                            │
   └───────── serialize (turndown + gfm) ◀──────┘  (on every edit)
```

- **Parse** (`src/core/parse.ts`) — `marked` in GFM mode → `sanitizeHtml` →
  task-list decoration. Sanitising needs a DOM (browser / jsdom); a
  `{ sanitize: false }` path returns raw `marked` HTML for trusted SSR.
- **Serialize** (`src/core/serialize.ts`) — `turndown` + the GFM plugin
  (tables, strikethrough, task lists), plus small normalisers (list-marker
  spacing, zero-width-space stripping).
- **Sanitize** (`src/core/sanitize.ts`) — a dependency-free allow-list scrubber:
  strips scripts, event handlers and `javascript:` URLs.

## Modules

| File | Responsibility |
|---|---|
| `src/core/editor.ts` | `EdodoWrite` — mounts the surface, owns events, wires everything together. |
| `src/core/parse.ts` | Markdown → sanitised HTML. |
| `src/core/serialize.ts` | HTML → Markdown. |
| `src/core/sanitize.ts` | HTML allow-list sanitiser. |
| `src/core/commands.ts` | `applyCommand` — inline + block transforms. |
| `src/core/input-rules.ts` | Markdown "type-to-format" transforms. |
| `src/core/keymap.ts` | Keyboard shortcuts + Enter/Backspace edge cases. |
| `src/core/toolbar.ts` | Floating selection toolbar. |
| `src/core/slash-menu.ts` | `/` block picker. |
| `src/core/dom.ts` | Selection/caret/DOM helpers. |
| `src/core/types.ts` | Shared types. |
| `src/lib/index.ts` | Public core entry (`edodo-write`). |
| `src/lib/react.tsx` | React wrapper (`edodo-write/react`). |
| `src/styles.css` | Editor + toolbar + slash-menu styles, themed. |

## Key decisions (and the contentEditable gotchas behind them)

- **Block transforms are hand-rolled DOM, not `execCommand`.**
  `document.execCommand('formatBlock' | 'insertUnorderedList' | …)` is silently
  dropped by Chrome when called synchronously inside an `input` event — which is
  exactly where the Markdown input rules run. Manual DOM is reliable there and
  in tests. Inline marks (bold/italic/strike) still use `execCommand` from the
  toolbar/keymap (invoked outside `input`) for free native undo.
- **A trailing space becomes `U+00A0`.** contentEditable renders a typed
  trailing space as a non-breaking space, so input rules normalise it before
  matching `"# "`, `"> "`, etc.
- **Empty blocks need a caret anchor.** An element with no child node is not a
  placeable caret position (Chrome types *before* it), so a just-emptied block
  is normalised to a single `<br>`; task items get a text node after the
  checkbox. The trigger deletion is anchored to the first *text* node so leading
  non-text children (the checkbox) are never swept up.
- **Zero-width spaces park the caret** outside a freshly inserted inline mark
  (so typing after `**bold**` isn't bold); they are stripped on serialise and
  never reach the Markdown.

## Build

Vite, dual output:

- `vite.lib.config.ts` → `dist-lib/` — two ESM entries (`index`, `react`), all
  dependencies externalised, one CSS file (`edodo-write.css`). Types via
  `tsc -p tsconfig.lib.json`.
- `vite.config.ts` → `dist/` — the playground/docs SPA for GitHub Pages.

Tests are Vitest (jsdom). The pure Markdown engine (parse/serialize/round-trip/
sanitize) and the execCommand-free DOM paths are unit-tested; the interactive
`execCommand`/selection behaviour is verified in a real browser.
