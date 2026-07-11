# Embed in your app (API)

Two layers: a framework-free `EdodoWrite` class (`edodo-write`) and a thin React
wrapper (`edodo-write/react`). Both read and write Markdown as the source of
truth. The stylesheet is shipped separately — `import "edodo-write/styles.css"`.
First-party plugins live at `edodo-write/plugins`; round-trip test helpers at
`edodo-write/testing`.

## Core: `new EdodoWrite(host, options)`

```ts
import { EdodoWrite } from "edodo-write";
import { highlight, callout } from "edodo-write/plugins";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

const editor = new EdodoWrite(host, {
  value: "Some ==highlighted== words.",
  plugins: [highlight(), callout()],
  exclude: ["taskList"],
});

// Plugin markdown extensions are part of this editor's own pipeline.
assert.equal(editor.getMarkdown(), "Some ==highlighted== words.");
// Excluded core features are fully removed: exec warns and returns false.
assert.equal(editor.exec("taskList"), false);
editor.destroy();
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | `""` | Initial Markdown. |
| `placeholder` | `string` | `"Write something, or type “/” for commands…"` | Shown when the document is empty. |
| `autofocus` | `boolean` | `false` | Focus after mount (ignored when read-only). |
| `readOnly` | `boolean` | `false` | Render-only; no editing UI. Toggleable at runtime via `setReadOnly`. |
| `toolbar` | `boolean` | `true` | Floating selection toolbar. |
| `slashMenu` | `boolean` | `true` | `/` slash command menu. |
| `spellcheck` | `boolean` | `true` | Native browser spellcheck. |
| `className` | `string` | — | Extra class(es) on the host. |
| `ariaLabel` | `string` | — | ARIA label for the editable region. |
| `onChange` | `(md: string) => void` | — | Convenience `change` listener. |
| `uploadImage` | `ImageUploader` | data-URL embed | Where pasted / dropped / picked image files go: `(file, editor) => Promise<url \| { src, alt? }>`; the resolved URL is what lands in the Markdown. Omitted, images embed as `data:` URLs. See **[Image hosting](IMAGE_HOSTING.md)**. |
| `plugins` | `EdodoPlugin[]` | `[]` | Plugins, applied in order after the core preset. Resolved **once at construction** — create a new editor to change the set. Name/command/item-id collisions throw. |
| `exclude` | `string[]` | `[]` | Core-preset feature keys (command names / item ids) to remove, e.g. `["taskList", "codeBlock"]`. Only affects the core preset, never plugins. |

### Methods

| Method | Returns | Description |
|---|---|---|
| `getMarkdown()` | `string` | Serialise the current document to Markdown. |
| `setMarkdown(md, { silent? })` | `void` | Replace the document. `silent: true` skips the history snapshot and the `change` event. |
| `getHTML()` | `string` | Current editor HTML (rarely needed). |
| `isEmpty()` | `boolean` | No visible text and no image/divider/checkbox/code block. |
| `focus()` / `blur()` | `void` | Focus control. |
| `exec(cmd, payload?)` | `boolean` | Run a registered command. `false` when read-only, unregistered (warns), or the command refused. |
| `insertImages(files, { alt? })` | `Promise<void>` | Insert image files at the caret through `uploadImage` (or the data-URL fallback); pending placeholders stay out of the Markdown until each upload resolves. Resolves when every upload settles; non-image files are ignored. |
| `transact(fn)` | `T` | Batch DOM mutations into **one** undo step and **one** change event. Re-entrant. |
| `undo()` / `redo()` | `void` | Step the Markdown-snapshot history (also ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z, ⌘/Ctrl+Y). |
| `setReadOnly(bool)` | `void` | Toggle editing at runtime — works in both directions. |
| `on(event, handler)` | `() => void` | Subscribe; returns an unsubscribe function. |
| `off(event, handler)` | `void` | Unsubscribe. |
| `destroy()` | `void` | Run plugin cleanups, remove all DOM, listeners and floating UI. |

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "# One" });

editor.setMarkdown("# Two"); // records history, schedules a change event
assert.equal(editor.getMarkdown(), "# Two");
assert.ok(editor.getHTML().includes("<h1>Two</h1>"));
assert.equal(editor.isEmpty(), false);

editor.undo();
assert.equal(editor.getMarkdown(), "# One");
editor.redo();
assert.equal(editor.getMarkdown(), "# Two");
editor.destroy();
```

### Events

| Event | Payload | When |
|---|---|---|
| `change` | `(markdown: string)` | Debounced (~120 ms) after edits; `undo`/`redo` deliver it synchronously. |
| `selection` | `(info: SelectionInfo \| null)` | Selection moved; `null` when it leaves the editor. |
| `focus` / `blur` | — | The editable region gained/lost focus. |

`SelectionInfo` carries `empty`, `collapsed`, the five built-in mark flags
(`bold`, `italic`, `strike`, `code`, `link`), an **open-world `marks` record**
(the `isActive()` result of every registered command that defines one — plugin
commands included), the current `block` kind (`"paragraph"`, `"heading1"`…
`"heading6"`, `"bulletList"`, `"orderedList"`, `"taskList"`, `"blockquote"`,
`"codeBlock"`, `"other"`), and a viewport `rect` for positioning your own UI.

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "# One" });

const seen: string[] = [];
const off = editor.on("change", (md) => seen.push(md));

editor.setMarkdown("# Two"); // change is debounced (~120 ms) after edits…
editor.undo();               // …but undo/redo deliver it synchronously
assert.deepEqual(seen, ["# One"]);

off();                       // on() returned an unsubscribe function
editor.redo();
assert.deepEqual(seen, ["# One"]); // no longer listening
editor.destroy();
```

### Commands (`editor.exec`)

Commands are typed through the `CommandPayloads` interface: the payload argument
is **required exactly when the command declares one**, and TypeScript
autocompletes every declared name. Plugins add their own commands via module
augmentation; plain-JS callers can pass any string (`AnyCommand`) — executing an
unregistered name warns in the console and returns `false`, it never throws.

| Command | Payload | Effect |
|---|---|---|
| `bold`, `italic`, `strike` | — | Toggle the inline mark at the selection. |
| `code` | — | Toggle inline `<code>` at the selection. |
| `link` | `{ href: string \| null }` | Set/replace the link at the selection; `null` (or `""`) removes it. |
| `clear` | — | Remove inline formatting at the selection. |
| `paragraph` | — | Turn the caret block into a paragraph. |
| `heading1` … `heading6` | — | Turn the caret block into a heading; running it again toggles back to a paragraph. |
| `bulletList`, `orderedList`, `taskList` | — | Turn the caret block into a list (or toggle the list off; `taskList` upgrades a plain bullet list in place). |
| `blockquote` | — | Toggle a quote. |
| `codeBlock` | — | Toggle a fenced code block. |
| `divider` | — | Insert a `---` divider after the caret block. |
| `image` | `{ src: string; alt?: string }` | Insert an image block followed by an empty paragraph. |
| `table` | `{ rows?: number; cols?: number }` | Insert a GFM table (default 3×3, clamped to 50×12: a `thead` header row + body rows) after the caret block; the caret lands in the first header cell. Editing behaviour: [Tables](MARKDOWN_AND_SHORTCUTS.md#tables). |

Plugins in this repo add `highlight` (no payload),
`callout` (`{ kind?: "note" | "tip" | "important" | "warning" | "caution" }`)
and `diagram` (`{ lang: string; source?: string }`, registered by both
`diagrams()` and `edodoDraw()`) — see
[First-party plugins](FIRST_PARTY_PLUGINS.md).

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "Make me a heading" });

// Block commands act on the block that holds the caret/selection.
const p = editor.content.querySelector("p")!;
const range = document.createRange();
range.selectNodeContents(p);
range.collapse(false);
const sel = window.getSelection()!;
sel.removeAllRanges();
sel.addRange(range);

editor.exec("heading2");
assert.equal(editor.getMarkdown(), "## Make me a heading");

// Payloads are required exactly when the command declares one.
editor.exec("image", { src: "https://example.com/cat.png", alt: "A cat" });
assert.equal(
  editor.getMarkdown(),
  "## Make me a heading\n\n![A cat](https://example.com/cat.png)",
);
editor.destroy();
```

Declaring a payload for your own command (TypeScript):

```ts no-run
declare module "edodo-write" {
  interface CommandPayloads {
    myEmbed: { url: string };
  }
}
// Now editor.exec("myEmbed", { url }) is fully typed — and
// editor.exec("myEmbed") is a compile error.
```

### Transactions

`transact(fn)` batches any number of mutations (including nested `exec` calls)
into a single undo step and a single change event:

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "start" });

editor.transact(() => {
  editor.exec("divider");
  editor.exec("divider");
});
assert.equal(editor.getMarkdown(), "start\n\n---\n\n---");

editor.undo(); // ONE undo reverts the whole transaction
assert.equal(editor.getMarkdown(), "start");
editor.destroy();
```

## React: `<EdodoWriteEditor />`

```tsx
import { useRef, useState } from "react";
import { EdodoWriteEditor, Markdown } from "edodo-write/react";
import type { EdodoWrite, SelectionInfo } from "edodo-write/react";
import { highlight } from "edodo-write/plugins";
import "edodo-write/styles.css";

export function Notes() {
  const [md, setMd] = useState("# Hello");
  const editorRef = useRef<EdodoWrite | null>(null);
  return (
    <div>
      <EdodoWriteEditor
        value={md}
        onChange={setMd}
        placeholder="Write…"
        plugins={[highlight()]}
        onReady={(editor) => { editorRef.current = editor; }}
        onSelection={(info: SelectionInfo | null) => console.log(info?.block)}
      />
      <Markdown value={md} />
    </div>
  );
}
```

The wrapper's contract:

- **`value` is "initial + controlled".** An external `value` that differs from
  the last Markdown the editor emitted re-hydrates the document. Echoing the
  `onChange` value straight back (the usual controlled pattern) never clobbers
  the caret while typing.
- **Options are captured on mount.** `plugins`, `exclude`, `toolbar`,
  `slashMenu`, etc. are read once when the editor is constructed. To change
  them, remount the component (e.g. with a different `key`).
- `onReady(editor)` hands you the underlying `EdodoWrite` instance for
  imperative calls (`exec`, `undo`, `setReadOnly`, …).
- `onSelection(info)` mirrors the `selection` event — build your own toolbar
  from it if you disable the built-in one.
- `<Markdown value />` renders Markdown read-only with the editor's stylesheet
  (no plugin extensions — for plugin content, render through `createCodec` or a
  read-only editor constructed with the same plugins).

## Functional helpers (no editor instance)

```ts
import { toHTML, toMarkdown, renderMarkdown, sanitizeHtml } from "edodo-write";
import { strict as assert } from "node:assert";

assert.equal(toHTML("# Hi").trim(), "<h1>Hi</h1>");   // Markdown → sanitised HTML
assert.equal(toMarkdown("<h1>Hi</h1>"), "# Hi");      // HTML → Markdown

const target = document.createElement("div");
renderMarkdown("**bold** text", target);              // read-only render into an element
assert.ok(target.innerHTML.includes("<strong>bold</strong>"));

// Allow-list sanitiser: scripts, event handlers and script-scheme URLs go.
assert.equal(sanitizeHtml('<p onclick="x()">hi<script>evil()</script></p>'), "<p>hi</p>");
```

`toHTML(md, { sanitize: false })` returns raw `marked` output for a DOM-free,
trusted-input SSR path. These helpers use the **plain GFM pipeline** — for the
exact codec of an editor constructed with plugins, build one with `createCodec`
from `edodo-write/testing`:

```ts
import { createCodec, assertRoundTrip } from "edodo-write/testing";
import { highlight } from "edodo-write/plugins";
import { strict as assert } from "node:assert";

const codec = createCodec([highlight()]);
assertRoundTrip(codec, "some ==highlighted== words"); // throws on divergence
assert.equal(codec.serialize(codec.parse("==hi==")), "==hi==");
```

## Plugins

Plugins are plain objects created with `definePlugin({ name, … })` and passed to
the constructor. They can contribute commands, input rules, keybindings,
slash/toolbar/block-menu items, paired markdown (marked + turndown) extensions,
additive sanitizer allowances, a `setup` hook, and event hooks. Collisions
(duplicate plugin names, command names, item ids) **throw at construction**;
runtime errors in a plugin are isolated so they never break typing. Plugin
keybindings (priority 100) run before the core preset (priority 0), so a plugin
can shadow `Mod-B` — but the structural engine (Enter/Backspace/Tab semantics,
undo history, the clipboard contract, the sanitizer's denial floor, drag
mechanics) is deliberately not pluggable.

See the **[Plugin guide](PLUGIN_GUIDE.md)** for the full plugin API, and
`src/plugins/highlight.ts` for the canonical ~50-line example.

**First-party plugins.** Six ship with the package, importable from
`edodo-write/plugins`: `highlight()` (`==text==`), `callout()` (GitHub
alerts), `math()` (`$…$` / `$$…$$` TeX, KaTeX when installed), `diagrams()` /
`edodoDraw()` (fenced code → live diagram widgets, mermaid included),
`tags({ source })` (`#tag`/`@mention` chips fed by your own suggestion
source, stored as plain GFM), and `embeds()` (a bare URL line → video / audio
/ bookmark widget). Each one's options, exact stored Markdown, and degradation
story are documented in **[First-party plugins](FIRST_PARTY_PLUGINS.md)**.

## Built-in behaviours (no configuration)

On by default whenever the editor is editable:

- **Markdown clipboard.** Copy/cut put the selection on the clipboard as
  Markdown (`text/plain`) *and* rich HTML (`text/html`, regenerated from that
  Markdown so no editor internals leak into Docs/Word). Paste accepts either:
  rich HTML is sanitised and converted to Markdown, plain text is treated as
  Markdown — then parsed and inserted as real blocks, splitting the current
  block as needed. Pasting a bare URL over a selection turns it into a link.
- **Images.** Pasting an image file (screenshots included — image files beat
  text flavours on the same clipboard), dropping files onto the document
  (inserted at the drop point), and the `/image` popover's **Upload…** button
  all funnel through `insertImages` and your `uploadImage`. A pending
  placeholder renders immediately but stays out of `getMarkdown()` until its
  upload resolves; deleting it mid-upload cancels; a failed upload removes it
  and shows a toast. Without an uploader, images embed as `data:` URLs (5 MB
  cap). Details: **[Image hosting](IMAGE_HOSTING.md)**.
- **Block handles.** Hovering a block shows a left-gutter handle: `+` inserts a
  paragraph below; the `⣿` grip **drags to reorder** (pointer-based, with a
  drop-indicator line and a translucent ghost) and **clicks to open the block
  menu** — Turn into (Text, Heading 1–3, lists, To-do, Quote, Code), Duplicate,
  Copy as Markdown, Delete. The stylesheet reserves a `2.75rem` left gutter on
  `.ew-content` for the handle.
- **Link popover.** ⌘/Ctrl+K, the toolbar `🔗` button, or clicking an existing
  link opens an inline popover to edit, open, or remove the link. Clicking a
  link never navigates while editing (read-only editors keep native
  navigation).
- **Undo/redo.** A Markdown-snapshot history (up to 300 entries) behind
  ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z and ⌘/Ctrl+Y. Note: states that serialise to
  identical Markdown collapse into one history entry.
- **Select-all replace.** Typing or deleting over a select-all resets the
  document to a single clean paragraph instead of leaving a stale emptied
  heading (Chrome's native behaviour).
- **Click below the last block** appends a new paragraph — the content's bottom
  padding is clickable, Notion-style.
- **Per-block placeholder.** A focused empty paragraph in a non-empty document
  shows a "Type “/” for commands…" hint.
- **Table editing.** Tables are editable in place: Tab/Shift+Tab walk cells
  (Tab in the last cell appends a row), Enter moves down a row (and escapes
  below from the last row), and hovering a cell reveals Notion-style handles —
  a column pill (Insert left/right, Move, Clear contents, Delete column), a row
  pill (Insert above/below, Move, Clear, Delete row), and + buttons on the
  table's right/bottom edges. The old block-menu entries are replaced by these
  hover controls; the block menu keeps whole-table actions
  with the GFM-required header row protected. Guards still hold: Backspace
  never merges a paragraph into a table. Details:
  [Tables](MARKDOWN_AND_SHORTCUTS.md#tables).
- **Document normaliser.** After every input, native `contentEditable` damage
  (stray root text nodes, emptied block shells, styled spans) is repaired
  before input rules run.
- **⌘/Ctrl+U is swallowed** — Markdown has no underline, so the `<u>` the
  browser would insert would silently vanish from the serialised value.

Disable the toolbar or slash menu with `toolbar: false` / `slashMenu: false`,
or remove individual features with `exclude`. Clipboard, drag, undo and the
normaliser are intrinsic to the editing model and always on in edit mode.

## Read-only

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "Locked.", readOnly: true });

assert.equal(editor.content.getAttribute("contenteditable"), "false");
assert.equal(editor.exec("bold"), false); // commands are refused

editor.setReadOnly(false);                // fully re-enables editing
assert.equal(editor.content.getAttribute("contenteditable"), "true");
editor.destroy();
```

Read-only hides the toolbar, slash menu and block handles, closes any open
popovers, refuses commands and checkbox clicks, and restores native link
navigation. `setReadOnly` works in **both** directions at runtime — the editing
chrome is constructed unconditionally and gated on the live flag.

## Styling & theming

The stylesheet is theme-aware:

- Light by default; automatic dark via `prefers-color-scheme`.
- Force a theme with `:root[data-theme="dark"|"light"]` on the document, or an
  `ew--dark` / `ew--light` class on the host element.
- Every colour is a CSS variable on `.ew` (`--ew-fg`, `--ew-bg`, `--ew-accent`,
  `--ew-border`, `--ew-code-bg`, …) that you can override in your own CSS. The
  reading width is `--ew-content-width` (default `46rem`).
- `.ew-content` reserves a `2.75rem` left gutter for the block handles and tall
  bottom padding for click-to-append; the read-only variant drops the gutter.
