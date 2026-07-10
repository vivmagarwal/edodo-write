# Getting started

`edodo-write` is a Notion / Medium-style WYSIWYG editor whose **single source of
truth is Markdown**. You edit rich text; you read and store Markdown.

## Install

```bash
npm i edodo-write
```

`react` / `react-dom` are optional peers — you only need them for the React
wrapper. The core is framework-free.

## Vanilla (no framework)

```js
import { EdodoWrite } from "edodo-write";
import "edodo-write/styles.css";

const editor = new EdodoWrite(document.getElementById("app"), {
  value: "# Hello\n\nType **markdown** and watch it render.",
  placeholder: "Write something…",
  onChange: (markdown) => console.log(markdown),
});

// Read / write Markdown at any time:
editor.getMarkdown();          // → "# Hello\n\n…"
editor.setMarkdown("# New");
```

## React

```jsx
import { useState } from "react";
import { EdodoWriteEditor } from "edodo-write/react";
import "edodo-write/styles.css";

export function Notes() {
  const [md, setMd] = useState("# Hello\n\nStart writing…");
  return <EdodoWriteEditor value={md} onChange={setMd} placeholder="Write…" />;
}
```

Read-only rendering of stored Markdown:

```jsx
import { Markdown } from "edodo-write/react";
import "edodo-write/styles.css";

<Markdown value={savedMarkdown} />;
```

## What you get

- **Type-to-format** — `# `, `## `, `- `, `1. `, `[ ] `, `> `, `` ``` ``, `--- `,
  and inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`.
- **Floating toolbar** on text selection (Medium-style).
- **Slash menu** — press `/` on an empty line for a block picker (Notion-style).
- **Task lists** with clickable checkboxes.
- **Clean Markdown out** — GFM, including tables, strikethrough and task lists.
- **Light & dark** themes out of the box.

Next: **[Embed in your app](INTEGRATION_GUIDE.md)** for the full API, or
**[Markdown support & shortcuts](MARKDOWN_AND_SHORTCUTS.md)** for the complete
list of what you can type.
