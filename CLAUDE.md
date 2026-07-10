# CLAUDE.md

Guidance for AI agents working in this repo.

## What this is

**edodo-write** — a Notion / Medium-style WYSIWYG editor whose single source of
truth is Markdown. Framework-free `EdodoWrite` core + optional React wrapper.
Built ground-up over native `contentEditable`; 3 runtime deps (`marked`,
`turndown`, `@joplin/turndown-plugin-gfm`).

## Golden rules

- **Markdown is the contract.** Parse (marked+sanitize) on load, serialise
  (turndown+gfm) on every change. Never introduce a competing document model.
- **Core is framework-free.** `src/core/**` never imports React. React lives
  only in `src/lib/react.tsx`. Imports use `.js` extensions (bundler resolves to
  `.ts`).
- **Block transforms are manual DOM, never `execCommand`.** `execCommand`
  block ops (`formatBlock`, `insertUnorderedList`) are silently dropped when
  called inside an `input` event — exactly where input rules run. Inline marks
  may use `execCommand` from the toolbar/keymap (outside `input`).
- **Round-trip stability is sacred.** Any change to parse/serialize must keep
  `tests/roundtrip.test.ts` green.
- **Two-stage verification:** `npm test` + `npm run typecheck`, then `npm run
  dev` and drive the playground in a real browser for anything touching
  `execCommand` or selection (jsdom implements neither).

## contentEditable gotchas already handled (don't regress)

- Trailing space → `U+00A0` (input rules normalise before matching).
- Empty block = unplaceable caret (normalise to `<br>`; anchor caret after a
  task checkbox with a zero-width text node).
- Trigger deletion anchored to the first *text* node so the task checkbox isn't
  deleted with it.
- Zero-width spaces park the caret out of a new inline mark; stripped on
  serialise.

## Fast orientation

- **New here? Read `docs/DEVELOPMENT.md` first** (layout, dev loop, the
  contentEditable rules, testing, release).
- Pipeline + module table + decisions: `docs/ARCHITECTURE.md`. Behavioural spec
  vs Notion: `docs/NOTION_UX_STUDY.md`.
- Public API: `docs/INTEGRATION_GUIDE.md`. What you can type:
  `docs/MARKDOWN_AND_SHORTCUTS.md`.
- Orchestrator + undo history: `src/core/editor.ts`. Transforms:
  `src/core/commands.ts`. Type-to-format: `src/core/input-rules.ts`.
  Enter/Backspace/Tab: `src/core/keymap.ts`. Clipboard: `src/core/clipboard.ts`.
  Drag: `src/core/block-handles.ts`. Shared DOM: `src/core/dom.ts`.
- Build: `vite.lib.config.ts` (→ `dist-lib/`, published) + `vite.config.ts`
  (→ `dist/`, GitHub Pages). Publish via `scripts/publish.sh` (token from
  `../edodo-draw/.env`). Deploy the site via `scripts/deploy-pages.sh`.

## Documentation Pointers

Single source of truth: `docs/*.md` (also concatenated into `public/llms-full.txt`
by `scripts/gen-llms-txt.mjs` on every build). Update the docs in the same change
as the code. README and this file only point here.
