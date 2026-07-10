<h1 align="center">✎ edodo-write</h1>
<p align="center"><i>A Notion / Medium-style editor whose single source of truth is Markdown.</i></p>

<p align="center">
  <a href="https://www.npmjs.com/package/edodo-write"><img alt="npm" src="https://img.shields.io/npm/v/edodo-write.svg"></a>
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="deps" src="https://img.shields.io/badge/deps-3-brightgreen.svg">
</p>

You edit rich text; you read and store **Markdown**. Type `## `, `- `, `[ ] `,
`> `, `` ``` `` and watch it transform as you go. Select text for a floating
toolbar; press `/` on an empty line for a block menu. Framework-free core, with
an optional React wrapper.

```bash
npm i edodo-write
```

## Why

Most rich editors store bespoke JSON — hard to diff, grep, feed to an LLM, or
move. edodo-write keeps **Markdown** as the value. The rich surface is just a
*view*; the bytes you save are portable, human-readable and version-control
friendly.

## Features

- **Type-to-format** — headings, bullet / numbered / to-do lists, quotes, code
  blocks, dividers, and inline `**bold**` `*italic*` `` `code` `` `~~strike~~`.
- **Floating selection toolbar** (Medium-style) and a **`/` slash menu**
  (Notion-style).
- **Interactive task lists** — tick a checkbox, the Markdown flips `[ ]` → `[x]`.
- **Clean GFM output** — tables, strikethrough, task lists. Round-trip-stable.
- **Light & dark** themes via CSS variables.
- **Tiny** — 3 runtime deps (`marked`, `turndown`, the turndown GFM plugin).
  React is an optional peer.

## Use it

**Vanilla:**

```js
import { EdodoWrite } from "edodo-write";
import "edodo-write/styles.css";

const editor = new EdodoWrite(document.getElementById("app"), {
  value: "# Hello\n\nType **markdown** and see it render.",
  onChange: (md) => console.log(md),
});
```

**React:**

```jsx
import { EdodoWriteEditor, Markdown } from "edodo-write/react";
import "edodo-write/styles.css";

<EdodoWriteEditor value={md} onChange={setMd} placeholder="Write…" />;
// read-only:
<Markdown value={md} />;
```

A pure, framework-free API (`toHTML`, `toMarkdown`, `renderMarkdown`,
`sanitizeHtml`) is exported for Node/SSR. See the
**[embed guide](docs/INTEGRATION_GUIDE.md)** for the full API.

## Run this repo (playground + docs)

```bash
git clone https://github.com/vivmagarwal/edodo-write.git
cd edodo-write && npm install
npm run dev     # http://localhost:5283 — live editor + Markdown output
npm test        # Vitest
```

## Docs

- **[Getting started](docs/GETTING_STARTED.md)**
- **[Embed in your app (API)](docs/INTEGRATION_GUIDE.md)**
- **[Markdown support & shortcuts](docs/MARKDOWN_AND_SHORTCUTS.md)**
- **[Architecture](docs/ARCHITECTURE.md)**
- **[Extending](docs/EXTENDING_GUIDE.md)**

Live site: **https://vivmagarwal.github.io/edodo-write/**

## License

MIT © vivmagarwal
