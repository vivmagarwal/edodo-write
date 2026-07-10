# Development guide

The first thing to read if you're joining edodo-write. It explains how the code
is laid out, how to run and test it, the non-obvious rules that keep a
`contentEditable` editor sane, and how to release. Pair it with
[ARCHITECTURE.md](ARCHITECTURE.md) (how it works) and
[EXTENDING_GUIDE.md](EXTENDING_GUIDE.md) (how to add to it).

## The one idea

edodo-write is a **façade over Markdown**. The `contentEditable` surface is the
*view*; **Markdown is the state**; parse/serialize is the reconciler.

```
Markdown ──parse (marked + sanitize)──▶ HTML in a contentEditable  ─┐
   ▲                                                                │ user edits
   └───────────── serialize (turndown + gfm) ◀──────────────────────┘ (every change)
```

Consequences that shape everything:
- `getMarkdown()` serialises the live DOM; `setMarkdown()` re-hydrates it.
- Undo/redo is a stack of **Markdown snapshots** — undo literally restores prior
  state (see `editor.ts`).
- Correctness means: *the Markdown we emit must faithfully represent the view*
  and round-trip back (guarded by `tests/roundtrip.test.ts` + `edge-cases.test.ts`).

## Repo layout

```
src/
  core/                 framework-free engine (never imports React)
    editor.ts           EdodoWrite — mounts the surface, owns events, undo, wiring
    parse.ts            Markdown → sanitised HTML (marked)
    serialize.ts        HTML → Markdown (turndown + gfm, with escaping rules)
    sanitize.ts         dependency-free allow-list HTML sanitiser
    commands.ts         applyCommand — inline + block transforms (manual DOM)
    input-rules.ts      Markdown "type-to-format" (# , - , **bold**, …)
    keymap.ts           Enter/Backspace/Tab/shortcuts (clean block splits/merges)
    clipboard.ts        copy/cut → Markdown; paste Markdown/HTML → blocks
    block-handles.ts    hover gutter (+ / ⣿) and pointer-based drag-to-reorder
    toolbar.ts          floating selection toolbar
    slash-menu.ts       "/" block picker
    dom.ts              selection/caret/DOM helpers (the shared toolbox)
    types.ts            shared types
  lib/
    index.ts            public core entry  → `edodo-write`
    react.tsx           React wrapper      → `edodo-write/react`
  styles.css            editor + toolbar + slash + drag styles (themed)
  site/, app/, main.tsx the playground / docs SPA (GitHub Pages)
tests/                  Vitest (jsdom)
docs/                   the guides (single source of truth; also → public/llms*.txt)
scripts/                gen-llms-txt.mjs, deploy-pages.sh, publish.sh
```

Data flows **view → services → nothing**; there is no store. Every module in
`core/` is small and single-purpose; `dom.ts` is the shared toolbox they all lean
on. `editor.ts` is the only orchestrator.

## Setup & dev loop

```bash
npm install
npm run dev        # playground at http://localhost:5283 — editor + live Markdown
npm test           # Vitest
npm run typecheck  # tsc -b --noEmit  (keep at zero errors)
```

The playground's right panel prints `getMarkdown()` live — the fastest way to see
whether an edit produced correct Markdown.

## Two-stage testing (important)

jsdom implements neither `document.execCommand` **nor** real selection/typing
behaviour, so tests split into two layers:

1. **Automated (Vitest / jsdom)** — everything pure or execCommand-free:
   parse / serialize / round-trip / sanitize / edge-cases, the editor lifecycle,
   `insertMarkdown`, undo/redo, and the DOM-only commands (divider, code block,
   task decoration, block input-rules). Run: `npm test`.
2. **Manual / browser** — anything touching `execCommand`, real Enter/Backspace,
   the toolbar, drag, or clipboard. Run `npm run dev` and drive the playground
   (we use Playwright) — type a realistic document and read the Markdown panel.
   The behaviours to spot-check after editor changes: heading/list/quote via
   type-to-format, Enter at end of a heading (must stay a clean `<p>`), empty
   list-item Enter (exits), Backspace merges, undo/redo, paste Markdown, copy →
   Markdown, and drag-to-reorder.

If you change parse/serialize, `tests/roundtrip.test.ts` and
`tests/edge-cases.test.ts` are your guardrails — keep them green.

## The contentEditable rules (learn these once)

These are the hard-won invariants. Breaking one silently corrupts the document.

1. **Block transforms use manual DOM, never `execCommand`.**
   `execCommand('formatBlock' | 'insertUnorderedList' | …)` is *silently
   dropped* by Chrome when called synchronously inside an `input` event — which
   is exactly where input rules run. Inline marks (bold/italic/strike) may use
   `execCommand` from the toolbar/keymap (outside `input`) for free native undo.
2. **A typed trailing space becomes `U+00A0`.** Input rules normalise it before
   matching `"# "`, `"> "`, `"- "`, etc. (`input-rules.ts`).
3. **An empty element is not a placeable caret.** A block with no child — or
   whose only children are *empty text nodes* (what `Range.extractContents`
   leaves at a text-node boundary) — makes Chrome insert typed text *before* it.
   Always normalise to a single `<br>` via `ensureNotEmpty()` (`dom.ts`), which
   checks for real content, not just `firstChild`. This one bug manifests as
   "my typing goes into the previous block."
4. **Anchor deletions to the first text node.** `deleteLeadingChars` starts its
   range at the first text node, not `(block, 0)`, so leading non-text children
   (a task checkbox) are never swept into the deletion.
5. **Zero-width spaces park the caret** out of a freshly inserted inline mark and
   are stripped on serialize — they must never reach the Markdown.
6. **Always emit real block tags** (`<p>`, `<h1>`, `<li>`, `<blockquote>`),
   never a `<div>`. That's why Enter/Backspace are intercepted in `keymap.ts`.

## Build

Vite, dual output:
- `vite.lib.config.ts` → `dist-lib/` — two ESM entries (`index`, `react`), deps
  externalised, one CSS file (`edodo-write.css`); types via
  `tsc -p tsconfig.lib.json`. This is what npm ships (`npm run build:pkg`).
- `vite.config.ts` → `dist/` — the playground SPA for GitHub Pages
  (`npm run build`). `prebuild` regenerates `public/llms*.txt` from `docs/`.

## Release

```bash
# 1. bump "version" in package.json (semver)
# 2. update docs in the same change if behaviour changed
npm run typecheck && npm test        # must be green
bash scripts/publish.sh --dry-run    # inspect the tarball
bash scripts/publish.sh              # publish (token from ../edodo-draw/.env)
git commit -am "…" && git push
bash scripts/deploy-pages.sh         # redeploy the live playground/docs
```

`scripts/publish.sh` reads `NPM_ACCESS_TOKEN` from `../edodo-draw/.env`, writes a
temporary gitignored `.npmrc`, runs `npm publish --access public`, and removes
the token file on exit. `prepublishOnly` builds the package first.

## Conventions

- **Core is React-free.** React lives only in `src/lib/react.tsx`.
- Imports use `.js` extensions (the bundler resolves them to `.ts`).
- Keep modules small and single-purpose; put shared DOM logic in `dom.ts`.
- Update the relevant `docs/*.md` in the same change as the code — the docs are
  the single source of truth and are concatenated into `public/llms-full.txt`.
- Prefer adding a round-trip/edge-case test over a comment when fixing a
  serialization bug.
