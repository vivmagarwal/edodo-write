# Embed in your app (API)

Two layers: a framework-free `EdodoWrite` class (`edodo-write`) and a thin React
wrapper (`edodo-write/react`). Both read/write Markdown as the source of truth.
The stylesheet is shipped separately: `import "edodo-write/styles.css"`.

## Core: `new EdodoWrite(host, options)`

```js
import { EdodoWrite } from "edodo-write";
const editor = new EdodoWrite(hostEl, options);
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | `""` | Initial Markdown. |
| `placeholder` | `string` | `"Write something, or type “/” for commands…"` | Shown when empty. |
| `autofocus` | `boolean` | `false` | Focus after mount. |
| `readOnly` | `boolean` | `false` | Render-only; no editing or toolbars. |
| `toolbar` | `boolean` | `true` | Floating selection toolbar. |
| `slashMenu` | `boolean` | `true` | `/` slash command menu. |
| `spellcheck` | `boolean` | `true` | Native browser spellcheck. |
| `className` | `string` | — | Extra class(es) on the host. |
| `ariaLabel` | `string` | — | ARIA label for the editable region. |
| `onChange` | `(md: string) => void` | — | Convenience `change` listener. |

### Methods

| Method | Returns | Description |
|---|---|---|
| `getMarkdown()` | `string` | Serialise the current document to Markdown. |
| `setMarkdown(md, { silent? })` | `void` | Replace the document. `silent` suppresses the `change` event. |
| `getHTML()` | `string` | Current editor HTML (rarely needed). |
| `isEmpty()` | `boolean` | Whether the document has no meaningful content. |
| `focus()` / `blur()` | `void` | Focus control. |
| `exec(cmd, payload?)` | `void` | Apply a formatting command (see below). |
| `setReadOnly(bool)` | `void` | Toggle editing at runtime. |
| `on(event, handler)` | `() => void` | Subscribe; returns an unsubscribe fn. |
| `off(event, handler)` | `void` | Unsubscribe. |
| `destroy()` | `void` | Remove all DOM, listeners and floating UI. |

### Events

- `change: (markdown: string) => void` — debounced (~120 ms) after edits.
- `selection: (info | null) => void` — active marks + block kind + rect; `null`
  when the selection leaves the editor.
- `focus: () => void`, `blur: () => void`.

### Commands (`editor.exec(cmd)`)

`bold`, `italic`, `strike`, `code`, `link` (`exec("link", { href })`), `clear`,
`paragraph`, `heading1`–`heading3`, `bulletList`, `orderedList`, `taskList`,
`blockquote`, `codeBlock`, `divider`.

```js
editor.exec("heading2");
editor.exec("link", { href: "https://example.com" });
```

## React: `<EdodoWriteEditor />`

```jsx
import { EdodoWriteEditor } from "edodo-write/react";

<EdodoWriteEditor
  value={md}
  onChange={setMd}
  placeholder="Write…"
  readOnly={false}
  toolbar
  slashMenu
  className="my-editor"
  onReady={(editor) => { /* imperative handle */ }}
  onSelection={(info) => { /* build your own toolbar */ }}
/>;
```

`value` is treated as "initial + controlled": an external change that differs
from the last value the editor emitted re-hydrates the document. Echoing the
`onChange` value straight back (the usual controlled pattern) never clobbers the
caret.

### `<Markdown value={md} />`

A read-only renderer that shares the editor's stylesheet. Use it to display
stored Markdown.

## Functional helpers (no editor instance)

```js
import { toHTML, toMarkdown, renderMarkdown, sanitizeHtml } from "edodo-write";

toHTML("# Hi");                 // Markdown → sanitised HTML
toMarkdown("<h1>Hi</h1>");      // HTML → Markdown
renderMarkdown(md, targetEl);   // render read-only into an element
sanitizeHtml(untrustedHtml);    // allow-list sanitiser
```

`toHTML(md, { sanitize: false })` returns raw `marked` HTML for a DOM-free,
trusted-input SSR path.

## Styling & theming

The stylesheet is theme-aware:

- Default light; automatic dark via `prefers-color-scheme`.
- Force a theme with `:root[data-theme="dark"|"light"]` on the document, or a
  `.ew--dark` / `.ew--light` class on the host.
- Every color is a CSS variable (`--ew-fg`, `--ew-bg`, `--ew-accent`, …) you can
  override in your own CSS. The default accent is teal (`--ew-accent`).
