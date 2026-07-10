# Development guide

The first thing to read if you're joining edodo-write. It explains how the
code is laid out, how to run and test it, the non-obvious rules that keep a
`contentEditable` editor sane, and how to release. Pair it with
[ARCHITECTURE.md](ARCHITECTURE.md) (how it works) and
[PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) (how to extend it).

## The one idea

edodo-write is a **façade over Markdown**. The `contentEditable` surface is
the *view*; **Markdown is the state**; parse/serialize is the reconciler.

```
Markdown ──parse (marked + sanitize)──▶ HTML in a contentEditable  ─┐
   ▲                                                                │ user edits
   └───────────── serialize (turndown + gfm) ◀──────────────────────┘ (every change)
```

Consequences that shape everything:

- `getMarkdown()` serialises the live DOM; `setMarkdown()` re-hydrates it.
- Undo/redo is a stack of **Markdown snapshots** — undo literally restores
  prior state (`editor.ts`).
- Correctness means: *the Markdown we emit must faithfully represent the view*
  and round-trip back (guarded by `tests/roundtrip.test.ts`,
  `tests/edge-cases.test.ts`, and `tests/plugins.test.ts`).

## Repo layout

```
src/
  core/                 framework-free engine (never imports React)
    editor.ts           EdodoWrite — mounts, resolves plugins, owns events/undo/wiring
    types.ts            the public type surface (EdodoPlugin, EditorContext, …)
    plugin.ts           plugin resolution: registries, collisions throw, guard()
    preset.ts           the core preset — built-ins via the same plugin API
    commands.ts         built-in command bodies (manual-DOM block transforms)
    input-rules.ts      the type-to-format RUNNER (rule sets live in preset/plugins)
    keymap.ts           registered bindings + the Enter/Backspace/Tab engine
    normalize.ts        document normalizer — schema invariants after every mutation
    clipboard.ts        copy/cut → Markdown; paste Markdown/HTML/URL → blocks
    parse.ts            Markdown → sanitised HTML (per-instance Marked)
    serialize.ts        HTML → Markdown (per-instance turndown + fence-aware tidy)
    sanitize.ts         allow-list HTML sanitiser (denial floor)
    slash-menu.ts       "/" block picker (groups, multi-word queries)
    toolbar.ts          floating selection toolbar
    block-handles.ts    hover gutter: + / drag grip / grip-click block menu
    ui.ts               floating-UI primitives (popover, menu, toast)
    link-ui.ts          the link popover (Mod-K / toolbar / click-a-link)
    dom.ts              selection/caret/DOM helpers (the shared toolbox)
  lib/
    index.ts            public core entry  → `edodo-write`
    react.tsx           React wrapper      → `edodo-write/react`
    testing.ts          createCodec/assertRoundTrip → `edodo-write/testing`
  plugins/              first-party plugins → `edodo-write/plugins`
    highlight.ts        ==text== ↔ <mark>   (the canonical plugin example)
    callout.ts          GitHub alerts ↔ <blockquote data-callout>
  e2e/main.ts           fixture entry for the Playwright suite (see below)
  styles.css            all styles, themed via CSS variables on .ew
  site/, main.tsx       the playground / docs SPA (GitHub Pages)
tests/                  Vitest (jsdom) — the fast suite
tests/e2e/              Playwright specs + helpers (real browser)
e2e.html                the bare fixture page Playwright drives
docs/                   the guides (single source of truth; also → public/llms*.txt)
scripts/                gen-llms-txt.mjs, deploy-pages.sh, publish.sh
```

Data flows **view → services → nothing**; there is no store. Every module in
`core/` is small and single-purpose; `dom.ts` is the shared toolbox they all
lean on; `editor.ts` is the only orchestrator.

## Setup & dev loop

```bash
npm install
npm run dev        # playground at http://localhost:5283 — editor + live Markdown
npm run typecheck  # tsc -b --noEmit   (keep at zero errors)
npx vitest run     # fast suite (~2 s)
npm run test:e2e   # Playwright (~12 s; starts the dev server itself)
```

The playground's right panel prints `getMarkdown()` live — the fastest way to
see whether an edit produced correct Markdown. The dev server also serves
`/e2e.html`, a chrome-free fixture that mounts a bare editor and exposes it as
`window.editor`.

## Three-stage testing

jsdom implements neither `document.execCommand` nor real selection/typing/
layout, so verification is split into three layers. All three must be green.

### Stage 1 — Vitest (jsdom): the Markdown engine and DOM-only paths

Run: `npx vitest run` (or `npm test`). Target: the whole suite in under ~3 s,
so it can run on every save.

This stage owns everything pure or execCommand-free: parse / serialize /
round-trip / tidy / sanitize, the **normalizer** (`tests/normalize.test.ts`),
plugin resolution and collision errors, plugin codecs
(`tests/plugins.test.ts`), the editor lifecycle (mount, events, destroy,
readOnly), undo/redo through the public API, `insertMarkdown`, and the
manual-DOM command bodies.

`vitest.config.ts` aliases the public package names — `edodo-write`,
`edodo-write/react`, `edodo-write/plugins`, `edodo-write/testing` — to `src/`,
so tests (and executable doc examples) import exactly what consumers import.

If you touch parse/serialize, `tests/roundtrip.test.ts` and
`tests/edge-cases.test.ts` are the guardrails. For plugin markdown pairs, use
the codec helpers:

```ts
import { strict as assert } from "node:assert";
import { createCodec, assertRoundTrip } from "edodo-write/testing";
import { highlight } from "edodo-write/plugins";

const codec = createCodec([highlight()]);
assertRoundTrip(codec, "some ==highlighted== text"); // throws on divergence
assert.ok(codec.parse("==hi==").includes("<mark>hi</mark>"));
```

### Stage 2 — Playwright E2E: everything interactive

Run: `npm run test:e2e` (144 tests in 15 spec files, Chromium, ~22 s). The Vite
dev server is started automatically by Playwright's `webServer` config (and
reused if one is already running outside CI).

Specs drive the **fixture page** `/e2e.html`, whose entry (`src/e2e/main.ts`)
mounts a bare editor and accepts query params:

```
/e2e.html?value=<markdown>&plugins=highlight,callout&exclude=taskList
```

The instance is exposed as `window.editor`, so specs assert on
`editor.getMarkdown()` — the value an application would store — rather than on
screenshots. Shared helpers live in `tests/e2e/helpers.ts` (`openEditor`,
`markdown`, `html`, `caretToEnd`, `selectBlockText`, `paste`, `interceptCopy`).

This stage owns input rules driven by real typing, Enter/Backspace/Tab
semantics, the slash menu, toolbar, link popover, block menu, drag, clipboard,
select-all reset, read-only toggling, and undo/redo under real input events.

**Anti-flake rules** (the suite has zero retries locally — keep it that way):

- Assert on `markdown(page)` (the source of truth). When the assertion follows
  an *asynchronous* commit — a task-checkbox click commits in a microtask, the
  `change` event is debounced ~120 ms — **poll on getMarkdown** instead of
  sleeping: `await expect.poll(() => markdown(page)).toBe("- [x] first")`.
- For UI chrome (toolbar visible, menu open), use auto-waiting locator
  assertions: `await expect(page.locator(".ew-toolbar.is-visible"))…` — never
  a bare `page.waitForTimeout`.
- Place the caret with the helpers (`openEditor` clicks the first block;
  `caretToEnd` / `selectBlockText` set ranges directly). Do not click into the
  content's bottom padding — clicking below the last block *appends a
  paragraph* by design.
- Synthesize clipboard flavours with `paste()` / `interceptCopy()` rather than
  touching the OS clipboard.

### Stage 3 — Executable doc examples

Run as part of Stage 1: `tests/docs-examples.test.ts` reads `README.md` and
every `docs/*.md` at runtime, extracts every fenced code block tagged `ts` or
`js`, and executes it under vitest+jsdom (each block is written verbatim to a
temp module and imported, so the public-name aliases apply); blocks tagged
`tsx` are compile-checked — one strict `ts.Program` against the shipped type
declarations. The docs cannot silently rot: an API change that breaks a
documented example fails the build.

The contract for writing examples in `README.md` or any `docs/*.md`:

- Self-contained and runnable: import everything from the **public package
  names** (never `../src`), create your own host element, and end with at
  least one assertion (`import { strict as assert } from "node:assert"`).
- Blocks that cannot run use their proper tag (`bash`, `json`, `css`, `html`)
  — those are not executed. A genuinely non-runnable TypeScript fragment is
  tagged `ts no-run` — use sparingly.
- Show Markdown-in/Markdown-out concretely: construct an editor with a
  `value`, then assert the exact `editor.getMarkdown()` string.

## The contentEditable invariants (learn these once)

These are the hard-won rules. Breaking one silently corrupts documents — each
was earned from a real bug. The normalizer (`normalize.ts`) enforces the
structural ones after every mutation; the helpers in `dom.ts` (exposed to
plugins as `ctx.dom`) encode the caret ones.

1. **Block transforms use manual DOM, never `execCommand`.**
   `execCommand('formatBlock' | 'insertUnorderedList' | …)` is *silently
   dropped* by Chrome when called synchronously inside an `input` event —
   exactly where input rules run. Inline marks (bold/italic/strike) may use
   `execCommand` from the toolbar/keymap, which run outside `input`.
2. **NBSP: a typed trailing space arrives as `U+00A0`.** The input-rule runner
   normalises it before matching `"# "`, `"- "`, `"> "` …, and
   `ctx.dom.textBeforeCaret` hands plugins pre-normalised text. The serializer
   tidy maps NBSP back to a plain space in prose — never inside code fences.
3. **ZWSP: zero-width spaces are editor-internal caret furniture.** They park
   the caret outside a freshly inserted inline mark (Chrome would otherwise
   keep typing inside the `<strong>`), anchor the caret after a task checkbox,
   and anchor empty `<pre><code>` blocks. They are stripped on serialize and
   excluded from every text/offset helper — they must never reach the Markdown.
4. **`<br>` caret anchors: an empty element is not a placeable caret.** A block
   with no child — or whose only children are *empty text nodes* (what
   `Range.extractContents` leaves at a text-node boundary) — makes Chrome
   insert typed text *before* it ("my typing goes into the previous block").
   Normalise to a single `<br>` via `ensureNotEmpty` — except inside
   `<pre><code>`, where a `<br>` would mean a newline, so the anchor is a ZWSP
   text node instead.
5. **Checkbox anchoring: task items are checkbox-first, then a text node.**
   `deleteLeadingChars` anchors its range to the first *text* node — never
   `(block, 0)` — so a leading checkbox is not swept into a trigger deletion,
   and the normalizer keeps a text node after the box for the caret.
6. **Convert before strip.** A block input rule must convert the still
   non-empty block *first*, then delete the trigger text, then re-anchor the
   caret — commands no-op on empty blocks. The whole sequence runs in one
   `transact()` so no half-done state hits history. (Two deliberate
   exceptions, `codeBlock` and `divider`, empty the block first so the trigger
   text doesn't ride into the new block — see `preset.ts`.)
7. **PRE newline terminator.** A trailing `"\n"` at the end of a `<pre>` is a
   line *terminator* to the browser, not a new line — Chrome types the next
   character before it. Enter in a code block inserts `"\n" + ZWSP` and places
   the caret between them, making the new line real and placeable.
8. **Unlink needs a selection.** `execCommand("unlink")` silently no-ops on a
   collapsed caret — select the link's contents first (`applyLink` in
   `commands.ts`). Similarly, `createLink` no-ops when collapsed and splits
   the link on a partial selection, so editing an existing link updates its
   `href` in place instead.
9. **Always emit real block tags** (`<p>`, `<h1>`, `<li>`, `<blockquote>`),
   never a `<div>` — that's why Enter/Backspace are intercepted in
   `keymap.ts`, and why the normalizer converts any `<div>` that sneaks in.
10. **Never transform mid-IME-composition.** Input rules skip while
    `isComposing`; `compositionend` re-runs them. Firing on a partial
    composition string corrupts CJK and dead-key input.

## Build

Vite, dual output:

- `vite.lib.config.ts` → `dist-lib/` — four ESM entries (`index`, `react`,
  `plugins`, `testing`), all dependencies externalised, one CSS file
  (`edodo-write.css`); types via `tsc -p tsconfig.lib.json`. This is what npm
  ships (`npm run build:pkg`).
- `vite.config.ts` → `dist/` — the playground SPA for GitHub Pages
  (`npm run build`). `prebuild` regenerates `public/llms*.txt` from `docs/`
  (`node scripts/gen-llms-txt.mjs`).

## Release

```bash
# 1. bump "version" in package.json (semver)
# 2. update docs in the same change if behaviour changed
npm run typecheck && npm test && npm run test:e2e   # must be green
bash scripts/publish.sh --dry-run    # inspect the tarball
bash scripts/publish.sh              # publish (token from ../edodo-draw/.env)
git commit -am "…" && git push
bash scripts/deploy-pages.sh         # redeploy the live playground/docs
```

`scripts/publish.sh` reads `NPM_ACCESS_TOKEN` from `../edodo-draw/.env`, writes
a temporary gitignored `.npmrc`, runs `npm publish --access public`, and
removes the token file on exit. `prepublishOnly` builds the package first.

## Conventions

- **Core is React-free.** React lives only in `src/lib/react.tsx`.
- Imports use `.js` extensions (the bundler resolves them to `.ts`).
- Keep modules small and single-purpose; shared DOM logic goes in `dom.ts`.
- Built-in features go through the plugin API (`preset.ts`) — if the API can't
  express your feature, improve the API rather than special-casing the core.
- Update the relevant `docs/*.md` in the same change as the code — the docs
  are the single source of truth, their examples are executed by the test
  suite, and they are concatenated into `public/llms-full.txt` on every build.
- Prefer adding a round-trip/edge-case test over a comment when fixing a
  serialization bug.
