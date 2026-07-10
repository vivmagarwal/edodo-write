# Architecture

edodo-write is a thin controller over a single native `contentEditable`
surface. The guiding model — the **façade over Markdown** — is: the surface is
the *view*, **Markdown is the state**, and parse/serialize is the *reconciler*.
There is no bespoke document model to learn, migrate, or store; the bytes you
persist are Markdown, and everything else exists to keep that contract honest.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "# Title\n\nHello **world**" });

// The view is HTML; the state is Markdown.
assert.ok(editor.getHTML().includes("<h1>Title</h1>"));
assert.equal(editor.getMarkdown(), "# Title\n\nHello **world**");
editor.destroy();
```

## Pipeline

```
Markdown ──parse (marked + plugin extensions + sanitize + task decoration)──▶ HTML view
   ▲                                                                             │
   └────────── serialize (turndown + gfm + plugin rules + fence-aware tidy) ◀────┘
                                (on every edit)
```

- **Parse** (`src/core/parse.ts`) — a per-editor `new Marked({ gfm: true })`
  with any plugin `marked` extensions applied, then `sanitizeHtml`, then
  task-list decoration (interactive checkboxes + the conventional
  `task-list-item` classes). `{ sanitize: false }` returns raw marked HTML for
  trusted, DOM-free SSR; `{ decorateTasks: false }` keeps GFM's disabled
  checkboxes for export paths (the clipboard's HTML flavour).
- **Serialize** (`src/core/serialize.ts`) — a per-editor `TurndownService`
  (ATX headings, `-` bullets, fenced code, `*`/`**` delimiters, inlined links)
  plus the GFM plugin (tables, strikethrough, task lists) and plugin rules.
  Notable choices: hard breaks serialize as **backslash breaks** (turndown's
  default two-space break is invisible and destroyed by whitespace trims);
  `<` and entity-forming `&` are escaped so prose like `a<b>c` survives a
  round-trip; empty paragraphs are dropped. The output then passes through a
  **fence-aware tidy**: NBSP → space, one-space list markers, trailing-space
  trim, blank-line collapsing, ZWSP stripping — none of which ever touches the
  inside of a code fence (pasted code keeps its bytes).
- **Sanitize** (`src/core/sanitize.ts`) — a dependency-free allow-list
  scrubber. Unknown tags are unwrapped (children kept); scripts, iframes,
  event handlers and script-scheme URLs are removed; only checkbox `<input>`s
  survive; `target="_blank"` links get `rel="noopener noreferrer"`. Plugins may
  *widen* the allow-list, never lower the denial floor (see below).

## Per-instance pipeline (why the singletons had to die)

Earlier versions called the global `marked` singleton and one module-level
`TurndownService`. That breaks in three ways once plugins exist:

1. `marked.use(extension)` mutates **global** state — a plugin's tokenizer
   would leak into every other editor on the page and into any other consumer
   of marked in the application.
2. Two editors with different plugin sets need two different codecs.
3. The clipboard must encode/decode with the **same** codec the editor renders
   with, or plugin content silently corrupts on the way through copy/paste.

So each `EdodoWrite` now builds its own pipeline at construction:
`createMarkdownParser(markedExtensions, sanitizeOptions)` (a fresh `new
Marked()`), `createMarkdownSerializer(turndownExtensions)` (a fresh
`TurndownService`), and that pipeline object is threaded through the clipboard
handlers and exposed to plugins as `ctx.markdown`. The module-level
`parseMarkdown` / `htmlToMarkdown` remain, bound to default instances, for
standalone conversion. `createCodec` from `edodo-write/testing` builds the
exact codec an editor with a given plugin set would use, so tests and SSR
previews can match it byte-for-byte.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { highlight } from "edodo-write/plugins";

const a = new EdodoWrite(document.createElement("div"), {
  value: "some ==marked== text",
  plugins: [highlight()],
});
const b = new EdodoWrite(document.createElement("div"), {
  value: "some ==marked== text",
});

// Same page, same input, two different codecs — neither leaks into the other.
assert.ok(a.getHTML().includes("<mark>marked</mark>"));
assert.ok(!b.getHTML().includes("<mark>"));
assert.equal(a.getMarkdown(), "some ==marked== text"); // and it round-trips
a.destroy();
b.destroy();
```

## Modules

| File | Responsibility |
|---|---|
| `src/core/editor.ts` | `EdodoWrite` — mounts the surface, resolves plugins, owns events, undo history, the select-all reset, and all wiring. The only orchestrator. |
| `src/core/types.ts` | The public type surface: `EdodoPlugin`, `EditorContext`, `CommandPayloads` (module-augmentable), options, events. |
| `src/core/plugin.ts` | Plugin **resolution**: registries, collision detection (throws), key-string parsing, priority ordering, and `guard` (runtime error isolation). |
| `src/core/preset.ts` | The **core preset** — every built-in feature expressed through the same plugin API third parties use. |
| `src/core/commands.ts` | Built-in command implementations (manual-DOM block transforms, inline marks, link/image/divider). |
| `src/core/input-rules.ts` | The type-to-format **runner** — owns the contentEditable gotchas so rule authors never see them. Rule *sets* live in preset/plugins. |
| `src/core/keymap.ts` | Two tiers: registered bindings (pluggable) and the structural engine — Enter/Backspace/Tab splits and merges, undo routing, Mod-U swallow. |
| `src/core/normalize.ts` | The **document normalizer** — re-establishes the schema after every mutation (see below). |
| `src/core/clipboard.ts` | Copy/cut → Markdown + regenerated HTML; paste (Markdown, rich HTML, bare URL over selection) → real blocks. Pipeline-threaded. |
| `src/core/parse.ts` | Markdown → sanitised HTML (per-instance `Marked`). |
| `src/core/serialize.ts` | HTML → Markdown (per-instance `TurndownService` + fence-aware tidy). |
| `src/core/sanitize.ts` | Allow-list HTML sanitiser with a non-negotiable denial floor. |
| `src/core/slash-menu.ts` | The `/` picker: grouped items, word-wise multi-word filtering, works in empty list items. |
| `src/core/toolbar.ts` | Floating selection toolbar (items from the registry). |
| `src/core/block-handles.ts` | Left-gutter `+` / grip; pointer-based drag-to-reorder; grip *click* opens the block menu. |
| `src/core/ui.ts` | Editor-owned floating-UI primitives (`popover` / `menu` / `notify`) with selection preservation, clamping, dismissal, teardown. |
| `src/core/link-ui.ts` | The link popover (Mod-K, toolbar, click-a-link) built on `ui.ts`. |
| `src/core/dom.ts` | Stateless selection/caret/DOM helpers — the shared toolbox, exposed to plugins as `ctx.dom`. |
| `src/lib/index.ts` | Public core entry → `edodo-write`. |
| `src/lib/react.tsx` | React wrapper → `edodo-write/react` (core never imports React). |
| `src/lib/testing.ts` | `createCodec` / `assertRoundTrip` → `edodo-write/testing`. |
| `src/plugins/highlight.ts` | First-party plugin: `==text==` ↔ `<mark>` → `edodo-write/plugins`. |
| `src/plugins/callout.ts` | First-party plugin: GitHub alert callouts ↔ `<blockquote data-callout>`. |
| `src/plugins/index.ts` | Plugin barrel (one module per plugin so bundlers tree-shake). |
| `src/styles.css` | All editor/toolbar/slash/popover/drag styles, themed via CSS variables. |

## The plugin registry (engine vs. features)

Everything above the engine is a **feature** and flows through `EdodoPlugin`:
commands, input rules, keybindings, slash items, toolbar buttons, block-menu
items, paired markdown extensions, sanitizer widening, `setup`, lifecycle
hooks. The built-ins are no exception — `corePreset()` in `preset.ts` registers
them through the exact same API (deliberate dogfooding: the registry code path
runs on every keystroke, so it cannot bit-rot). `options.exclude` removes core
preset keys.

The **engine** is deliberately *not* pluggable: structural Enter/Backspace/Tab
semantics, the undo history, the clipboard contract, the sanitizer's denial
floor, drag mechanics, and the document normalizer. These implement the
contentEditable invariants whose violation corrupts documents. Plugins can
*pre-empt* engine keys (a registered binding for `Enter` runs first) but never
remove them.

**Resolution** happens once, at construction: `resolvePlugins([corePreset(),
...options.plugins])` flattens everything into per-instance registries. There
is no runtime (un)registration — dynamic plugin churn is where stale-menu and
half-torn-down-rule bugs live; re-create the editor to change the set (the
React wrapper captures `plugins` on mount for the same reason).

**Failure philosophy**, two-sided:

- *Configuration mistakes throw at construction*, naming both offenders:
  duplicate plugin names, duplicate command names, duplicate slash/toolbar/
  block-menu item ids, malformed key strings. Never silent last-wins.
- *Runtime mistakes are isolated*: every plugin contribution — command bodies,
  rule callbacks, key handlers, menu actions, `isActive` probes, lifecycle
  hooks — runs inside `guard()` (a try/catch). A throwing plugin logs and is
  skipped for that event; one bad plugin must not kill typing.

**Ordering**: the core preset registers at priority 0; plugins default to 100.
Keybindings are sorted by priority (descending), then registration order — so
a plugin can shadow `Mod-B`, and the structural key engine still runs last.
Input rules run in registration order (core preset first, then plugins in
array order).

**Markdown extensions are paired** (`markdown: { marked, turndown }`): a parse
extension without its serialize twin is a round-trip bug by construction. The
formats are marked's and turndown's own — deliberately unwrapped. Prove
stability with `assertRoundTrip` from `edodo-write/testing`.

## The document normalizer

`contentEditable` happily leaves the document in states the editor cannot work
with:

- **Select-all corruption** — select-all + Delete keeps the first block's
  emptied shell, so the next keystroke lands inside a stale `<h1>`.
- **Styled-span merges** — a native cross-block delete splices
  `<span style="…">` runs into the surviving block.
- **Unplaceable carets** — a cut can leave a block with no caret anchor, after
  which typing goes into the *previous* block.
- **Schema drift** — native edits drop bare text nodes or `<div>`s at the
  root, after which input rules and the slash menu (which assume "root
  children are blocks") silently die.

Instead of patching each symptom at its call site, `normalizeDocument`
(`src/core/normalize.ts`) re-establishes the schema invariants **after every
mutation** — the `input` handler runs it *before* matching input rules, and
`afterMutation` runs it after commands, paste, cut, drag, and block-menu
actions:

1. Root children are block elements only — stray inline/text runs are wrapped
   into `<p>`, `<div>`s become paragraphs (or are unwrapped when they contain
   blocks).
2. Browser styling artifacts are removed (`span[style]`/`font` unwrapped,
   stray `style` attributes dropped).
3. Structural shells are repaired: lists with no `<li>` are removed, `<pre>`
   always wraps a `<code>`, task items keep checkbox-first + a caret anchor.
4. Every empty block gets a placeable caret (`<br>`, or a zero-width text node
   inside `<pre><code>` where a `<br>` would mean a newline).
5. A childless root gets its single empty paragraph back.

The pass is cheap (one walk of the top-level children plus two targeted
queries) and idempotent. It deliberately does **not** reset "empty-looking"
documents — a freshly inserted empty heading is a legitimate state; the
select-all replace/delete reset lives in the editor's `beforeinput` handler,
where intent is known.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "" });

// Simulate what a native edit can leave behind: a styled span spliced into
// a heading by a cross-block delete, and a bare <div> from a native Enter.
editor.content.innerHTML =
  '<h1><span style="font-weight:400">merged</span></h1><div>typed</div>';
editor.content.dispatchEvent(new Event("input", { bubbles: true }));

// The normalizer re-established the schema before anything else ran.
assert.equal(editor.getHTML(), "<h1>merged</h1><p>typed</p>");
assert.equal(editor.getMarkdown(), "# merged\n\ntyped");
editor.destroy();
```

## Undo / redo

A stack of **Markdown snapshots** (`{ md, caret }` in `editor.ts`, capped at
300). Because Markdown is the state, undo literally restores previous state:
`setMarkdown` re-hydrates the view and the caret is re-placed by plain-text
offset (zero-width spaces excluded). Snapshots are recorded on every
structural change and — debounced (~120 ms) — on typing pauses, so a burst of
typing is one undo step. `transact()` batches any number of DOM mutations into
one snapshot and one change event, and is re-entrant (nested transactions
commit once, at the outermost level). This history is uniform across *all*
operations — typing, formatting, paste, drag, plugin commands — unlike native
`execCommand` undo, which cannot see manual DOM changes.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "# One" });

editor.setMarkdown("# One\n\ntwo"); // records a history snapshot
editor.undo();
assert.equal(editor.getMarkdown(), "# One");
editor.redo();
assert.equal(editor.getMarkdown(), "# One\n\ntwo");
editor.destroy();
```

**The honest limitation:** history dedupes on the serialized Markdown, so two
view states that serialize identically collapse into one undo step. Anything
Markdown cannot express — a caret move, a selection, transient DOM the
serializer strips — is invisible to history, and the caret restore after undo
is a best-effort text offset, not an exact DOM position. This is the price of
snapshot-as-Markdown, accepted deliberately: the alternative (a DOM-diff or
operation log) would reintroduce exactly the competing document model this
project exists to avoid.

## Key contentEditable decisions

The full invariants catalog (with the bugs each rule prevents) is in
[DEVELOPMENT.md](DEVELOPMENT.md); the load-bearing decisions are:

- **Block transforms are hand-rolled DOM, never `execCommand`.** Chrome
  silently drops `execCommand` block ops (`formatBlock`,
  `insertUnorderedList`, …) called synchronously inside an `input` event —
  exactly where input rules run. Inline marks (bold/italic/strike) still use
  `execCommand` from the toolbar/keymap, which run outside `input`.
- **Enter/Backspace/Tab are intercepted** and performed as manual splits and
  merges so the block model stays clean — real block tags (`<p>`, `<h1>`,
  `<li>`, `<blockquote>`), never the stray `<div>` the browser inserts.
- **Empty blocks get a `<br>` caret anchor** (`ensureNotEmpty`); inside
  `<pre><code>` the anchor is a zero-width text node instead, because a `<br>`
  there would mean a newline.
- **Zero-width spaces park the caret** outside a freshly inserted inline mark
  and after task checkboxes; they are stripped on serialize and never reach
  the Markdown.
- **A typed trailing space arrives as `U+00A0`** — normalized before input
  rules match and mapped back to a plain space by the serializer tidy (never
  inside code fences).
- **One `contentEditable`, Markdown state** (the Medium model) rather than
  Notion's per-block editors over a JSON block tree — simpler and
  Markdown-native, at the cost of doing block splits/merges ourselves. See
  [NOTION_UX_STUDY.md](NOTION_UX_STUDY.md).

## Build

Vite, dual output:

- `vite.lib.config.ts` → `dist-lib/` (what npm ships): four ESM entries —
  `index`, `react`, `plugins`, `testing` — mapping to the package exports
  `"."`, `"./react"`, `"./plugins"`, `"./testing"`, plus one stylesheet
  (`"./styles.css"` → `edodo-write.css`, imported explicitly by consumers).
  All dependencies are externalised; types come from `tsc -p tsconfig.lib.json`.
- `vite.config.ts` → `dist/` — the playground/docs SPA for GitHub Pages.
  `prebuild` regenerates `public/llms*.txt` from `docs/` via
  `scripts/gen-llms-txt.mjs`.

Testing is three-staged (Vitest/jsdom, Playwright, executable doc examples) —
see [DEVELOPMENT.md](DEVELOPMENT.md). The plugin API itself is documented in
[PLUGIN_GUIDE.md](PLUGIN_GUIDE.md).
