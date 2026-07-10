<h1 align="center">✎ edodo-write</h1>
<p align="center"><i>A Notion / Medium-style editor whose single source of truth is Markdown.</i></p>

<p align="center">
  <a href="https://www.npmjs.com/package/edodo-write"><img alt="npm" src="https://img.shields.io/npm/v/edodo-write.svg"></a>
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="deps" src="https://img.shields.io/badge/deps-3-brightgreen.svg">
</p>

You edit rich text; you read and store **Markdown**. Type `## `, `- `, `[ ] `,
`> `, `` ``` `` and watch it transform as you go. Select text for a floating
toolbar; press `/` for a grouped block menu; hover a block to drag it or open
its menu; ⌘K opens a link popover. Framework-free core, optional React wrapper,
and a plugin API for everything above the editing engine.

```bash
npm i edodo-write
```

## Why

Most rich editors store bespoke JSON — hard to diff, grep, feed to an LLM, or
move between systems. edodo-write keeps **Markdown as the value**. The rich
surface is just a *view*: Markdown is parsed to HTML on load and every edit is
serialised straight back, so the bytes you save are portable, human-readable
and version-control friendly. Anything Markdown can't express (underline,
toggles) is deliberately not offered — nothing you see can silently vanish
from the saved value.

## Features

- **Type-to-format** — headings 1–6, bullet / numbered / to-do lists, quotes,
  code blocks, dividers, and inline `**bold**` `*italic*` `` `code` ``
  `~~strike~~`.
- **Slash menu** (Notion-style) — grouped, filterable, works in empty list
  items, `/heading 1` with spaces works.
- **Images** — paste a screenshot, drop a file, or upload / paste a URL from
  the `/image` popover; hosting is pluggable (`uploadImage`) with a
  zero-config data-URL fallback, and the saved Markdown is just `![alt](url)`.
- **Floating selection toolbar** (Medium-style).
- **Link popover** — ⌘/Ctrl+K, toolbar, or click a link to edit / open /
  remove; paste a URL over a selection to link it.
- **Block handles** — drag the `⣿` grip to reorder; click it for a block menu
  (Turn into, Duplicate, Copy as Markdown, Delete).
- **Markdown clipboard** — copy puts Markdown on your clipboard; paste accepts
  Markdown *or* rich HTML (converted to Markdown, inserted as real blocks).
- **Undo / redo** — a Markdown-snapshot history (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z,
  ⌘/Ctrl+Y), consistent across typing, commands, paste and drag.
- **Plugins** — commands, input rules, keymaps, menu items, and *paired*
  markdown extensions per editor instance; collisions throw, runtime errors
  are isolated. First-party: `highlight()` (`==text==`) and `callout()`
  (GitHub alert syntax).
- **Robust editing** — Enter/Backspace/Tab do the Notion-like thing; a
  document normaliser repairs native `contentEditable` damage after every
  input; IME-safe input rules.
- **Clean GFM output** — tables, task lists, strikethrough; fence contents
  preserved byte-for-byte; literal `<` escaped so prose like `a<b>c`
  round-trips. Round-trip stability is enforced by tests.
- **Interactive task lists** — tick a checkbox, the Markdown flips `[ ]` → `[x]`.
- **Light & dark** themes via CSS variables; runtime `setReadOnly` toggle.
- **Tiny** — 3 runtime deps (`marked`, `turndown`, the turndown GFM plugin).
  React is an optional peer.

## Use it

**Vanilla:**

```ts
import { EdodoWrite } from "edodo-write";
import "edodo-write/styles.css";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

const editor = new EdodoWrite(host, {
  value: "# Hello\n\nType **markdown** and watch it render.",
  onChange: (md) => console.log(md),
});

assert.equal(editor.getMarkdown(), "# Hello\n\nType **markdown** and watch it render.");
editor.destroy();
```

**React:**

```tsx
import { useState } from "react";
import { EdodoWriteEditor, Markdown } from "edodo-write/react";
import "edodo-write/styles.css";

export function Notes() {
  const [md, setMd] = useState("# Hello");
  return (
    <div>
      <EdodoWriteEditor value={md} onChange={setMd} placeholder="Write…" />
      <Markdown value={md} /> {/* read-only render */}
    </div>
  );
}
```

**Plugins** — opt-in features with paired parse/serialise extensions, so plugin
syntax round-trips like everything else:

```ts
import { EdodoWrite } from "edodo-write";
import { highlight } from "edodo-write/plugins";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

const editor = new EdodoWrite(host, {
  value: "Ship ==highlighted== prose.",
  plugins: [highlight()], // ==text== ↔ <mark>, Mod-Shift-H, toolbar button
});

assert.ok(editor.getHTML().includes("<mark>highlighted</mark>"));
assert.equal(editor.getMarkdown(), "Ship ==highlighted== prose."); // byte-for-byte
editor.destroy();
```

Writing your own is a plain object via `definePlugin({ name, commands,
inputRules, keymap, slashItems, markdown, … })` — the `highlight()` source is
the ~50-line canonical example. A pure functional API (`toHTML`, `toMarkdown`,
`renderMarkdown`, `sanitizeHtml`) is exported for SSR and headless use, and
`edodo-write/testing` ships `createCodec` / `assertRoundTrip` so you can prove
your plugin's round-trip in one line.

## Run this repo (playground + docs)

```bash
git clone https://github.com/vivmagarwal/edodo-write.git
cd edodo-write && npm install
npm run dev       # http://localhost:5283 — live editor + Markdown output
npm test          # Vitest (unit + round-trip)
npm run test:e2e  # Playwright (real-browser behaviour)
```

## Docs

- **[Getting started](docs/GETTING_STARTED.md)** — install + first editor
- **[Embed in your app (API)](docs/INTEGRATION_GUIDE.md)** — options, methods,
  events, commands, React contract, theming
- **[Markdown support & shortcuts](docs/MARKDOWN_AND_SHORTCUTS.md)** — what you
  can type, the full keyboard table, the output flavour
- **[Image hosting](docs/IMAGE_HOSTING.md)** — the `uploadImage` contract,
  worked hosting configs, the data-URL fallback
- **[Plugin guide](docs/PLUGIN_GUIDE.md)** — write a plugin
- **[Architecture](docs/ARCHITECTURE.md)** — how the round-trip works
- **[Development guide](docs/DEVELOPMENT.md)** — contributing
- **[Notion UX study](docs/NOTION_UX_STUDY.md)** — the behavioural spec

Live site: **https://vivmagarwal.github.io/edodo-write/**

## License

MIT © vivmagarwal
