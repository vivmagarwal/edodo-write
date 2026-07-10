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
| `edodo-write/plugins` | First-party plugins: `highlight()`, `callout()` |
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

Optional features ship as plugins; pass them at construction. The first-party
`highlight()` plugin adds `==text==` ↔ `<mark>` (with a `Mod-Shift-H` shortcut
and a toolbar button), and `callout()` adds Notion-style callouts stored as
GitHub alert syntax (`> [!NOTE]`).

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
- **[Plugin guide](PLUGIN_GUIDE.md)** — write your own plugin.
- **[Architecture](ARCHITECTURE.md)** — how the Markdown round-trip works.
