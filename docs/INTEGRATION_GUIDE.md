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
| `undo()` / `redo()` | `void` | Step the Markdown-snapshot history (also bound to ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z). |
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

## Built-in behaviours (no configuration)

These are on by default whenever the editor is editable:

- **Markdown clipboard.** Copy/cut place the selection on the clipboard as
  Markdown (`text/plain`) *and* rich HTML (`text/html`). Paste accepts either:
  rich HTML is converted to Markdown, plain text is treated as Markdown — then
  rendered as blocks, splitting the current block as needed.
- **Block drag-and-drop.** Hovering a block shows a left-gutter handle
  (`+` inserts a block below, `⣿` is the drag grip); dragging reorders top-level
  blocks with a drop-indicator line and a translucent ghost. Give the editor a
  little left room — the stylesheet reserves a `2.75rem` gutter on `.ew-content`.
- **Undo/redo** via ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z (Markdown-snapshot history).
- **List indent/outdent** with Tab / Shift+Tab; **soft line break** with
  Shift+Enter.

Disable the toolbar or slash menu with `toolbar: false` / `slashMenu: false`.
Drag/clipboard/undo are intrinsic to a good editing experience and are always on
in edit mode.

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
