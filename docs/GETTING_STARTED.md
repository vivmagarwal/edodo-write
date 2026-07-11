# Getting started

`edodo-write` is a Notion / Medium-style WYSIWYG editor whose **single source of
truth is Markdown**. You edit rich text; you read and store Markdown.

## Install

```bash
npm i edodo-write
```

`react` / `react-dom` are optional peers — you only need them for the React
wrapper. The core is framework-free (3 runtime dependencies: `marked`,
`turndown`, and the turndown GFM plugin).

The package ships five entry points:

| Import | Contents |
|---|---|
| `edodo-write` | `EdodoWrite` core + functional helpers (framework-free) |
| `edodo-write/react` | `<EdodoWriteEditor />` + `<Markdown />` |
| `edodo-write/plugins` | First-party plugins: `highlight()`, `callout()`, `math()`, `diagrams()` / `edodoDraw()`, `tags()`, `embeds()` + the widget helpers |
| `edodo-write/testing` | `createCodec` / `assertRoundTrip` for plugin authors |
| `edodo-write/styles.css` | The stylesheet — import it explicitly |

## Vanilla (no framework)

```ts
import { EdodoWrite } from "edodo-write";
import "edodo-write/styles.css";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

const editor = new EdodoWrite(host, {
  value: "# Hello\n\nType **markdown** and watch it render.",
  placeholder: "Write something…",
  onChange: (markdown) => console.log(markdown),
});

// Markdown is the value — read or replace it at any time.
assert.equal(editor.getMarkdown(), "# Hello\n\nType **markdown** and watch it render.");

editor.setMarkdown("# A new document");
assert.equal(editor.getMarkdown(), "# A new document");

editor.destroy();
```

## React

```tsx
import { useState } from "react";
import { EdodoWriteEditor, Markdown } from "edodo-write/react";
import "edodo-write/styles.css";

export function Notes() {
  const [md, setMd] = useState("# Hello\n\nStart writing…");
  return (
    <div>
      <EdodoWriteEditor value={md} onChange={setMd} placeholder="Write…" />
      {/* read-only render of stored Markdown, sharing the editor's stylesheet */}
      <Markdown value={md} />
    </div>
  );
}
```

## Plugins in one minute

Optional features ship as plugins; pass them at construction. Six are
first-party: `highlight()` (`==text==` ↔ `<mark>`, with a `Mod-Shift-H`
shortcut and a toolbar button), `callout()` (Notion-style callouts stored as
GitHub alert syntax, `> [!NOTE]`), `math()` (`$x^2$` / `$$…$$` TeX — KaTeX
when installed), `diagrams()` / `edodoDraw()` (fenced ` ```edd ` and
` ```mermaid ` blocks rendered as live diagrams), `tags({ source })`
(`#tag`/`@mention` chips fed by your own suggestion source), and `embeds()`
(a bare URL line becomes a video / audio / bookmark widget). Every one stores
plain, degradable Markdown — the full guide is
**[First-party plugins](FIRST_PARTY_PLUGINS.md)**.

```ts
import { EdodoWrite } from "edodo-write";
import { highlight, callout } from "edodo-write/plugins";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

const editor = new EdodoWrite(host, {
  value: "Some ==highlighted== words.",
  plugins: [highlight(), callout()],
  exclude: ["taskList"], // remove core features you don't want
});

// The plugin's markdown extension round-trips ==…== byte-for-byte.
assert.equal(editor.getMarkdown(), "Some ==highlighted== words.");
// Excluded features are gone: exec refuses and returns false.
assert.equal(editor.exec("taskList"), false);
editor.destroy();
```

## Static HTML / CDN (no build step)

Two supported routes for plain HTML pages:

**Self-contained bundle** (no import map, no third-party rewriting — one
stylesheet, one module; ~52 KB gzipped with all first-party plugins):

```html
<link rel="stylesheet" href="https://unpkg.com/edodo-write/dist-lib/edodo-write.css">
<div id="app"></div>
<script type="module">
  import { EdodoWrite, highlight, callout, tags, embeds } from
    "https://unpkg.com/edodo-write/dist-lib/standalone.js";
  const editor = new EdodoWrite(document.getElementById("app"), {
    value: "# Hello from a static page",
    plugins: [highlight(), callout(), embeds()],
    onChange: (md) => console.log(md),
  });
</script>
```

Also on jsDelivr: `https://cdn.jsdelivr.net/npm/edodo-write/dist-lib/standalone.js`.
Bundlers get the same entry as `import … from "edodo-write/standalone"`.

**esm.sh** (resolves the regular entries and their dependencies on the fly —
including the optional `katex`/`edododraw` engines for math and diagrams):

```html
<script type="module">
  import { EdodoWrite } from "https://esm.sh/edodo-write";
  import { math, edodoDraw } from "https://esm.sh/edodo-write/plugins";
</script>
```

In the standalone bundle the optional engines stay external by design:
`math()` falls back to plain TeX and `edodoDraw()` shows a readable error
unless `katex`/`edododraw` are reachable (add an import map, or use esm.sh).

## What you get out of the box

- **Type-to-format** — `# ` … `###### `, `- `, `1. `, `[ ] `, `> `, `` ``` ``,
  `---`, and inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`.
- **Slash menu** — `/` on an empty line (or list item) opens a grouped, filterable
  block picker; multi-word queries like `/heading 1` work.
- **Floating toolbar** on text selection (Medium-style).
- **Link popover** — ⌘/Ctrl+K, the toolbar button, or clicking an existing link
  opens an inline edit/open/remove popover (no `window.prompt`).
- **Block handles** — hover a block for a `+` insert button and a `⣿` grip:
  drag to reorder, click for a block menu (Turn into, Duplicate, Copy as
  Markdown, Delete).
- **Markdown clipboard** — copy puts Markdown on the clipboard; paste accepts
  Markdown *and* rich HTML (converted to Markdown, then rendered as blocks).
- **Undo/redo** — a Markdown-snapshot history (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z or
  ⌘/Ctrl+Y), consistent across every operation.
- **Interactive task lists** — tick a checkbox and the Markdown flips
  `[ ]` → `[x]`.
- **Tables** — `/table` inserts a GFM table; type in cells, Tab/Enter walk
  them (Tab at the end adds a row), and hovering a cell reveals Notion-style
  column/row handles that insert, move, clear, and
  columns — see [Tables](MARKDOWN_AND_SHORTCUTS.md#tables).
- **Images** — paste a screenshot, drag-and-drop files, or use `/image`
  (Upload button or a URL + alt form); hosting is pluggable via `uploadImage`,
  with a zero-config `data:`-URL fallback, and the value is always just
  `![alt](url)` — see [Image hosting](IMAGE_HOSTING.md).
- **A plugin API** — commands, input rules, keymaps, slash/toolbar/block-menu
  items, and paired markdown extensions.
- **Light & dark** themes via CSS variables.

## Where next

- **[Embed in your app (API)](INTEGRATION_GUIDE.md)** — every option, method,
  event and command; React contract; styling.
- **[Markdown support & shortcuts](MARKDOWN_AND_SHORTCUTS.md)** — everything you
  can type, the full keyboard table, and the serialised-Markdown flavour.
- **[Image hosting](IMAGE_HOSTING.md)** — where image bytes go: the
  `uploadImage` contract, worked hosting configs, the data-URL fallback.
- **[First-party plugins](FIRST_PARTY_PLUGINS.md)** — highlight, callout,
  math, diagrams, tags, embeds: options, the exact Markdown each stores, the
  degradation story.
- **[Plugin guide](PLUGIN_GUIDE.md)** — write your own plugin.
- **[Architecture](ARCHITECTURE.md)** — how the Markdown round-trip works.
