# CLAUDE.md

Guidance for AI agents working in this repo.

## What this is

**edodo-write** — a Notion / Medium-style WYSIWYG editor whose single source of
truth is Markdown. Framework-free `EdodoWrite` core + optional React wrapper +
a first-class plugin system. Built ground-up over native `contentEditable`;
3 runtime deps (`marked`, `turndown`, `@joplin/turndown-plugin-gfm`).

## Golden rules

- **Markdown is the contract.** Parse (marked+sanitize) on load, serialise
  (turndown+gfm) on every change. Never introduce a competing document model.
- **Core is framework-free.** `src/core/**` and `src/plugins/**` never import
  React. React lives only in `src/lib/react.tsx`. Imports use `.js` extensions
  (bundler resolves to `.ts`).
- **Block transforms are manual DOM, never `execCommand`.** `execCommand`
  block ops (`formatBlock`, `insertUnorderedList`) are silently dropped when
  called inside an `input` event — exactly where input rules run. Inline marks
  may use `execCommand` from the toolbar/keymap (outside `input`).
- **Round-trip stability is sacred.** Any change to parse/serialize must keep
  `tests/roundtrip*.test.ts` green. Plugin markdown extensions must be PAIRED
  (marked tokenizer + turndown rule) and proven with `assertRoundTrip`
  (`edodo-write/testing`).
- **Engine vs features.** Structural Enter/Backspace/Tab, undo history, the
  clipboard contract, the sanitizer denial floor, the document normalizer and
  drag mechanics are the ENGINE — not pluggable, and their "redundant-looking"
  caret lines are load-bearing fixes ("move, don't improve"). Everything else
  (commands, input rules, shortcuts, slash/toolbar/block-menu items, markdown
  syntax) flows through the plugin registries; built-ins are dogfooded via
  `src/core/preset.ts`.
- **Three-stage verification:** `npx vitest run` + `npm run typecheck`, then
  `npx playwright test` (real browser — jsdom implements neither `execCommand`
  nor real selection). Docs examples are executed by
  `tests/docs-examples.test.ts` — docs are tests.

## contentEditable gotchas already handled (don't regress)

- Trailing space → `U+00A0` (input rules normalise before matching).
- Empty block = unplaceable caret (normalise to `<br>`; task items anchor with
  a zero-width text node after the checkbox; `<pre><code>` anchors with a ZWSP
  because a `<br>` there would mean a newline).
- Trigger deletion anchored to the first *text* node so a task checkbox isn't
  deleted with it; block conversion happens BEFORE trigger deletion.
- Zero-width spaces park the caret outside a new inline mark; stripped on
  serialise (globally, including the clipboard flavors).
- A trailing `"\n"` in `<pre>` is a line TERMINATOR — Enter inserts `"\n"+ZWSP`.
- `execCommand("unlink")` no-ops on a collapsed caret — select the link first.
- Native select-all + delete/type/cut leaves corrupt shells — `normalize.ts`
  plus the `beforeinput` full-selection intercept reset to a clean paragraph.
- Input rules never run during IME composition (`isComposing`).
- Menus that open under the resting mouse must not take hover highlight until
  the pointer actually moves.

## Fast orientation

- **New here? Read `docs/DEVELOPMENT.md` first** (layout, dev loop, the
  contentEditable rules, testing, release). Architecture + module table:
  `docs/ARCHITECTURE.md`. Plugin authoring: `docs/PLUGIN_GUIDE.md`.
  Behavioural spec vs Notion: `docs/NOTION_UX_STUDY.md`. Public API:
  `docs/INTEGRATION_GUIDE.md`. What you can type: `docs/MARKDOWN_AND_SHORTCUTS.md`.
- Orchestrator + undo history + plugin wiring: `src/core/editor.ts`. Public
  types incl. the whole plugin surface: `src/core/types.ts`. Plugin resolution:
  `src/core/plugin.ts`. Built-ins as a plugin: `src/core/preset.ts`. Transforms:
  `src/core/commands.ts`. Type-to-format runner: `src/core/input-rules.ts`.
  Enter/Backspace/Tab engine + key dispatch: `src/core/keymap.ts`. Schema
  repair: `src/core/normalize.ts`. Floating-UI primitives: `src/core/ui.ts`.
  Link popover: `src/core/link-ui.ts`. Clipboard: `src/core/clipboard.ts`.
  Drag + block menu trigger: `src/core/block-handles.ts`. Shared DOM helpers:
  `src/core/dom.ts`. First-party plugins: `src/plugins/`.
- Tests: `tests/*.test.ts` (vitest/jsdom), `tests/e2e/*.spec.ts` (Playwright
  against `/e2e.html` — fixture accepts `?value=…&plugins=highlight,callout&exclude=…`
  and exposes `window.editor`). E2E asserts on `getMarkdown()` (the contract),
  never pixels; no `waitForTimeout` for the change debounce — poll.
- Build: `vite.lib.config.ts` (→ `dist-lib/`: `index`, `react`, `plugins`,
  `testing` + `edodo-write.css`; published) + `vite.config.ts` (→ `dist/`,
  GitHub Pages). Publish via `scripts/publish.sh` (token from
  `../edodo-draw/.env`). Deploy the site via `scripts/deploy-pages.sh`.

## Documentation Pointers

Single source of truth: `docs/*.md` (also concatenated into `public/llms-full.txt`
by `scripts/gen-llms-txt.mjs` on every build). Update the docs in the same change
as the code — `tests/docs-examples.test.ts` executes the docs' code blocks, so
stale examples FAIL CI. README and this file only point here.
