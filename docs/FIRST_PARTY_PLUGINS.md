# First-party plugins

Everything optional ships as a plugin. Each one is a **factory** exported from
`edodo-write/plugins` — call it (with options where it takes them) and pass the
result to the constructor. Each plugin lives in its own module, so bundlers
drop the ones you don't use.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { highlight, callout, math, edodoDraw, tags, embeds } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "The ==full== set, one editor.",
  plugins: [
    highlight(),
    callout(),
    math(),
    edodoDraw(),
    tags({ source: () => [] }),
    embeds(),
  ],
});
assert.equal(editor.getMarkdown(), "The ==full== set, one editor.");
editor.destroy();
```

| Plugin | What it adds | The Markdown it stores | Optional peer |
|---|---|---|---|
| [`highlight()`](#highlight) | `==text==` highlighting | `==text==` | — |
| [`callout()`](#callout) | Notion-style callouts | `> [!NOTE]` (GitHub alerts) | — |
| [`math()`](#math) | TeX equations, inline + block | `$x^2$` / `$$…$$` | `katex` |
| [`diagrams()` / `edodoDraw()`](#diagrams-and-edododraw) | live diagram widgets | fenced code blocks | `edododraw` |
| [`tags()`](#tags) | `#tag` / `@mention` chips from *your* source | plain GFM links / text | — |
| [`embeds()`](#embeds) | video / audio / bookmark embeds | a bare URL line | — |

Every syntax here obeys the project's **degradation contract**: a document
written with a plugin stays valid, lossless Markdown in editors, renderers and
LLMs that don't have it. Each section below states exactly what the un-plugged
reading is. (The contract itself, and how to honour it in your own plugins, is
in the [Plugin guide](PLUGIN_GUIDE.md).)

Every `ts` code block on this page is executed by the test suite
(`tests/docs-examples.test.ts`) — what you read is what runs.

## highlight()

`==text==` ↔ `<mark>`. Adds the `highlight` command, an input rule (the
closing `==` converts as you type), a `Mod-Shift-H` keybinding, and a toolbar
button. No options.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { highlight } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "mark ==this== word", plugins: [highlight()] });
assert.ok(editor.getHTML().includes("<mark>this</mark>"));
assert.equal(editor.getMarkdown(), "mark ==this== word");
editor.destroy();
```

**Degradation.** `==…==` is not CommonMark or GFM — it is an extension
flavour (Obsidian et al.). Plain-GFM viewers show the literal `==` markers:
visible, lossless text. Opt in knowing your Markdown consumers.

This plugin doubles as the canonical source example — the
[Plugin guide](PLUGIN_GUIDE.md#your-first-plugin-highlight) walks through its
~50 lines extension point by extension point.

## callout()

Notion-style callout blocks stored as **GitHub alert syntax** — plain Markdown
that GitHub renders natively:

```markdown
> [!NOTE]
> Useful information users should know.
```

In the editor a callout is `<blockquote data-callout="note">`, styled with a
coloured border and label. Five kinds: `note`, `tip`, `important`, `warning`,
`caution`. Type `[!note] ` (any kind) at the start of a quote to upgrade it,
use the slash items (*Callout*, *Warning callout* — under Media), or run the
`callout` command with `{ kind?: "note" | "tip" | "important" | "warning" | "caution" }`.
No options.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { callout } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "> [!TIP]\n> Callouts are just GitHub alerts.",
  plugins: [callout()],
});
assert.ok(editor.getHTML().includes('data-callout="tip"'));
assert.equal(editor.getMarkdown(), "> [!TIP]\n> Callouts are just GitHub alerts.");
editor.destroy();
```

**Degradation.** Without the plugin, `> [!NOTE]` is an ordinary blockquote
whose first line reads `[!NOTE]` — visible text, zero data loss. An editor
*with* the plugin re-hydrates even a re-saved, escaped form back into a
decorated callout (proven in the
[Plugin guide](PLUGIN_GUIDE.md#the-degradation-story)).

## math()

TeX math with GitHub-native syntax:

- **Inline:** `$x^2$` — a non-editable chip in the editor
  (`<span class="ew-math" data-math="…">`). The content never starts or ends
  with whitespace, never contains `$` or a newline, and the closing `$` must
  not be followed by a digit — so prose like *"costs $5 and $10 total"* is
  never hijacked.
- **Block:** `$$` lines around a (possibly multiline) body — a widget figure
  (`figure[data-widget="math"][data-source]`). A one-line `$$E=mc^2$$`
  normalises to the canonical multiline form on save.

Typing the closing `$` converts inline math as you type (same edges as the
parser). The slash menu gains **Math block** (under Advanced), which inserts a
`$$` widget and opens its source editor. Click an inline chip to edit or
**Remove** it (Remove unwraps to the bare TeX text, without `$` delimiters, so
it won't re-hydrate); click a block widget for the shared source popover.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `render` | `(tex, el, displayMode) => void` | KaTeX if installed, else styled plain TeX | Custom renderer for chips (`displayMode: false`) and blocks (`true`). |

Rendering resolves in this order: `options.render` → a lazy
`import("katex")` (**optional peer dependency** — install it and rendering is
automatic; also import `katex/dist/katex.min.css`) → styled plain TeX text.
A throwing renderer falls back to plain TeX; rendering never touches the
Markdown value.

```ts no-run
import { math } from "edodo-write/plugins";
import katex from "katex";
import "katex/dist/katex.min.css";

// Explicit wiring — e.g. to pin the KaTeX version or set options. Without
// options.render the plugin lazy-imports "katex" automatically when it is
// installed, and falls back to styled plain TeX when it is not.
const plugin = math({
  render: (tex, el, displayMode) =>
    katex.render(tex, el, { displayMode, throwOnError: false }),
});
```

Both forms in a live editor — the TeX source lives in data attributes, and
the Markdown round-trips byte-for-byte:

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { math } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "inline $x^2$ and\n\n$$\nE = mc^2\n$$",
  plugins: [math()],
});
assert.ok(editor.getHTML().includes('data-math="x^2"'));      // the chip
assert.ok(editor.getHTML().includes('data-widget="math"'));   // the block widget
assert.equal(editor.getMarkdown(), "inline $x^2$ and\n\n$$\nE = mc^2\n$$");
editor.destroy();
```

Currency safety and the degradation story:

```ts
import { strict as assert } from "node:assert";
import { createCodec, assertRoundTrip } from "edodo-write/testing";
import { math } from "edodo-write/plugins";

const codec = createCodec([math()]);

// Currency is never hijacked: no whitespace edges, and the closing $ must
// not be followed by a digit.
assert.ok(!codec.parse("costs $5 and $10 total").includes("data-math"));
assertRoundTrip(codec, "costs $5 and $10 total");
// A legitimate formula right next to currency still converts.
assert.ok(codec.parse("pay $5 for $x^2$").includes('data-math="x^2"'));

// Degradation: without the plugin the syntax is visible, lossless text —
// and GitHub renders $…$ / $$…$$ natively anyway.
const plain = createCodec([]);
assert.ok(plain.parse("inline $x^2$ math").includes("$x^2$"));
assertRoundTrip(plain, "inline $x^2$ math");
```

## diagrams() and edodoDraw()

Fenced code blocks whose language has a registered renderer become live,
non-editable diagram widgets
(`figure[data-widget="diagram"][data-lang][data-source]`). Click a widget to
edit its source (Save re-renders); a renderer error shows a readable error box,
never a broken editor. **Every other fence is untouched** — ` ```js ` stays an
ordinary code block (regression-pinned in the test suite).

`diagrams({ renderers })` is the general form: you map fence languages to
renderers.

| Option | Type | Description |
|---|---|---|
| `renderers` | `Record<string, (source, el, ctx) => void \| Promise<void>>` | Fence language → renderer. May be async; render into `el`. |

`edodoDraw({ languages? })` is `diagrams()` preconfigured for the
[edodo-draw](https://github.com/vivmagarwal/edododraw) engine (**optional peer
dependency**, lazy-imported on first render). The engine's native language is
the EDD text-to-diagram DSL, and it imports raw Mermaid through the DSL — so
one renderer serves both ` ```edd ` and ` ```mermaid ` fences (the default
`languages: ["edd", "mermaid"]`).

Both factories register the `diagram` command
(`{ lang: string; source?: string }`) and one slash item per language
(*Diagram*, *Mermaid diagram* — under Media; picking one inserts a starter and
opens the source editor). Because they share the command, **installing both
throws at construction** — pick one and give it all your languages.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { diagrams } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "```pipeline\nbuild -> test -> ship\n```",
  plugins: [diagrams({
    renderers: {
      pipeline: (source, el) => {
        const div = document.createElement("div");
        div.textContent = `rendered: ${source}`;
        el.appendChild(div);
      },
    },
  })],
});

// The fence parsed into a source-carrying widget…
const figure = editor.content.querySelector('figure[data-widget="diagram"]')!;
assert.equal(figure.getAttribute("data-lang"), "pipeline");
assert.equal(figure.getAttribute("data-source"), "build -> test -> ship");

// …the renderer mounts through a microtask — let it settle…
await new Promise((r) => setTimeout(r, 0));
assert.ok(editor.content.textContent!.includes("rendered: build -> test -> ship"));

// …and the Markdown is still exactly the fence.
assert.equal(editor.getMarkdown(), "```pipeline\nbuild -> test -> ship\n```");
editor.destroy();
```

Unregistered languages fall through, and the codec needs no engine at all —
rendering never touches the round-trip:

```ts
import { strict as assert } from "node:assert";
import { createCodec, assertRoundTrip } from "edodo-write/testing";
import { diagrams, edodoDraw } from "edodo-write/plugins";

const codec = createCodec([diagrams({ renderers: { pipeline: () => {} } })]);
assert.ok(codec.parse("```pipeline\na -> b\n```").includes('data-widget="diagram"'));
assert.ok(codec.parse("```js\nconst a = 1;\n```").includes("<pre>")); // untouched
assertRoundTrip(codec, "```pipeline\na -> b\n```");
assertRoundTrip(codec, "```js\nconst a = 1;\n```");

// edodoDraw: both default languages round-trip; `languages` narrows the set.
const draw = createCodec([edodoDraw()]);
assertRoundTrip(draw, "```edd\nscene { a[Start] --> b[Finish] }\n```");
assertRoundTrip(draw, "```mermaid\nflowchart LR\n  a --> b\n```");
const eddOnly = createCodec([edodoDraw({ languages: ["edd"] })]);
assert.ok(eddOnly.parse("```mermaid\nflowchart LR\n```").includes("<pre>"));
```

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { diagrams, edodoDraw } from "edodo-write/plugins";

// Both factories register the `diagram` command — installing both throws at
// construction (deliberate). Pick one and give it all your languages.
const host = document.createElement("div");
document.body.appendChild(host);
assert.throws(
  () => new EdodoWrite(host, {
    plugins: [diagrams({ renderers: { d2: () => {} } }), edodoDraw()],
  }),
  /command "diagram" registered by both/,
);
```

Wiring another engine is just a renderer:

```ts no-run
import { diagrams } from "edodo-write/plugins";
import mermaid from "mermaid";

// Bring your own Mermaid (instead of edodoDraw()'s bundled route):
const plugin = diagrams({
  renderers: {
    mermaid: async (source, el) => {
      const { svg } = await mermaid.render(`d${Date.now()}`, source);
      el.innerHTML = svg;
    },
  },
});
```

**Degradation.** A diagram fence is an ordinary, lossless GFM code block in
any plugin-less editor — and GitHub renders ` ```mermaid ` fences natively.

## tags()

A source-configurable tagging / mention system. Type the trigger (`#` by
default — pass `trigger: "@"` for mentions) mid-line or at a block start and a
suggestion menu opens, fed by **your** `source` function: wire it to your
database, an API, or a static list. The source *is* the configurability.

| Option | Type | Default | Description |
|---|---|---|---|
| `trigger` | `string` | `"#"` | The character that opens the menu. |
| `source` | `(query) => TagItem[] \| Promise<TagItem[]>` | — (required) | Suggestions for the typed query. Sync or async; stale async results are discarded (race-safe). |
| `href` | `(item) => string \| null` | — | Derive an href for items without one (`null` → plain-text tag). |
| `allowCreate` | `boolean` | `true` | Offer *Create #query* when nothing matches. |

A `TagItem` is `{ label, href?, hint?, id? }`. Arrow keys navigate, Enter or
click picks, Escape closes; the menu never opens inside code blocks and is
IME-safe. To run several instances together (`#` tags plus `@` mentions), give each a distinct `name`: `tags({ name: "mentions", trigger: "@", source })`.

The Markdown form is **pure GFM — zero new syntax**, which is the whole
degradation story:

- an item *with* an href becomes a standard link whose text is
  trigger + label: `[#alpha](https://example.com/tags/alpha)` — a link stays
  a link everywhere;
- an item *without* one becomes plain text: `#gamma` — text stays text.

In the editor, any link whose text starts with the trigger is chip-styled
(`.ew-tag`) — visual furniture only, never serialized.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { tags } from "edodo-write/plugins";

// jsdom lacks Range.getClientRects — stub so the menu can anchor itself.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "placeholder",
  plugins: [tags({
    source: (query: string) => [
      { label: "alpha", href: "https://example.com/tags/alpha" },
      { label: "gamma" }, // no href → inserts plain text
    ].filter((t) => t.label.startsWith(query.toLowerCase())),
  })],
});

// Simulate having typed "#al": set the text, park the caret at the end of
// the text node (where real typing leaves it), fire `input`.
editor.focus();
const p = editor.content.querySelector("p")!;
p.textContent = "#al";
const node = p.firstChild as Text;
const sel = window.getSelection()!;
const r = document.createRange();
r.setStart(node, node.length);
r.collapse(true);
sel.removeAllRanges();
sel.addRange(r);
editor.content.dispatchEvent(new Event("input", { bubbles: true }));

// The suggestion menu is open; Enter picks the highlighted entry.
assert.ok(document.querySelector(".ew-popover.ew-menu")!.textContent!.includes("#alpha"));
editor.content.dispatchEvent(
  new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
);

// A linked item is a chip in the editor — and a PLAIN GFM link in the value.
assert.ok(editor.getHTML().includes('class="ew-tag"'));
assert.equal(editor.getMarkdown(), "[#alpha](https://example.com/tags/alpha)");
editor.destroy();
```

Stored documents hydrate the chips back, and the round-trip is byte-stable —
there is no markdown extension to pair, because there is no new syntax:

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { tags } from "edodo-write/plugins";
import { createCodec, assertRoundTrip } from "edodo-write/testing";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "tagged [#alpha](https://example.com/tags/alpha) and #gamma mid-line",
  plugins: [tags({ source: () => [] })],
});
assert.ok(editor.getHTML().includes('class="ew-tag"')); // chip styling, editor-only
assert.equal(
  editor.getMarkdown(),
  "tagged [#alpha](https://example.com/tags/alpha) and #gamma mid-line",
);
editor.destroy();

const codec = createCodec([tags({ source: () => [] })]);
assertRoundTrip(codec, "[#alpha](https://example.com/tags/alpha)");
assertRoundTrip(codec, "#gamma");
```

An async source (an API call) works the same — return a promise from
`source`; out-of-order responses are discarded by sequence number, and
`href` centralises link derivation:

```ts no-run
import { tags } from "edodo-write/plugins";

const mentions = tags({
  trigger: "@",
  source: async (query) => {
    const res = await fetch(`/api/users?q=${encodeURIComponent(query)}`);
    return res.json(); // [{ label: "ada", hint: "Ada Lovelace" }, …]
  },
  href: (item) => `https://example.com/u/${item.label}`,
  allowCreate: false,
});
```

## embeds()

Notion-style media embeds whose Markdown form is **nothing but a bare URL
line**:

```markdown
https://youtu.be/dQw4w9WgXcQ
```

A paragraph that is *only* a bare URL (a GFM autolink whose text equals its
href, or plain typed text) becomes a media widget
(`figure[data-widget="embed"][data-source]`) — unless the caret is inside it
(the line you are still typing on is never yanked). What renders depends on
the URL:

| URL | Renders as |
|---|---|
| YouTube (`youtu.be/…`, `youtube.com/watch?v=…`, `/shorts/…`, `/embed/…`) | privacy-friendly iframe (`youtube-nocookie.com`) |
| Vimeo (`vimeo.com/<id>`) | iframe (`player.vimeo.com`) |
| `.mp4` / `.webm` / `.mov` | `<video controls>` |
| `.mp3` / `.wav` / `.ogg` / `.m4a` | `<audio controls>` |
| anything else | bookmark card — title/description via `fetchMetadata`, else the hostname |

Clicking a widget opens **Open / Turn into link / Remove**. *Turn into link*
replaces the widget with a written `[hostname](url)` link — text ≠ href, so
the reconciliation pass never re-embeds it. That is also the authoring
opt-out: **a deliberately written `[title](url)` link is never converted.**

| Option | Type | Default | Description |
|---|---|---|---|
| `fetchMetadata` | `(url) => Promise<{ title?, description?, image? }>` | domain-only cards | Bookmark-card metadata. A rejection falls back to the hostname. |

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { embeds } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "https://youtu.be/dQw4w9WgXcQ",
  plugins: [embeds()],
});

// The lone-URL paragraph hydrated into a widget figure…
const figure = editor.content.querySelector('figure[data-widget="embed"]')!;
assert.equal(figure.getAttribute("data-source"), "https://youtu.be/dQw4w9WgXcQ");
// …and the Markdown is still exactly the bare URL line.
assert.equal(editor.getMarkdown(), "https://youtu.be/dQw4w9WgXcQ");
editor.destroy();

// A written [title](url) link is NEVER converted — that is the opt-out.
const host2 = document.createElement("div");
document.body.appendChild(host2);
const editor2 = new EdodoWrite(host2, {
  value: "[watch this](https://youtu.be/dQw4w9WgXcQ)",
  plugins: [embeds()],
});
assert.equal(editor2.content.querySelector("figure"), null);
assert.equal(editor2.getMarkdown(), "[watch this](https://youtu.be/dQw4w9WgXcQ)");
editor2.destroy();
```

Both editor states — the widget and a not-yet-hydrated autolink paragraph —
serialize to the same bare line, so the round-trip is byte-stable in every
state:

```ts
import { strict as assert } from "node:assert";
import { createCodec, assertRoundTrip } from "edodo-write/testing";
import { embeds } from "edodo-write/plugins";

const codec = createCodec([embeds()]);
assert.equal(
  codec.serialize('<figure data-widget="embed" data-source="https://youtu.be/dQw4w9WgXcQ"></figure>'),
  "https://youtu.be/dQw4w9WgXcQ",
);
assert.equal(
  codec.serialize('<p><a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a></p>'),
  "https://youtu.be/dQw4w9WgXcQ",
);
assertRoundTrip(codec, "intro with a [real link](https://example.com/page)\n\nhttps://example.com/clip.mp4");

// Degradation: without the plugin, a bare URL line is a GFM autolink — a
// clickable link everywhere, zero data loss.
const plain = createCodec([]);
assert.ok(plain.parse("https://youtu.be/dQw4w9WgXcQ").includes("<a href="));
```

Richer bookmark cards come from your metadata endpoint:

```ts no-run
import { embeds } from "edodo-write/plugins";

const plugin = embeds({
  fetchMetadata: async (url) => {
    const res = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`);
    return res.json(); // { title, description, image }
  },
});
```

## Optional peer dependencies

Two plugins can use an engine when one is installed — and stay fully
functional when it is not:

| Package | Used by | Installed | Absent |
|---|---|---|---|
| `katex` (>= 0.16) | `math()` | Equations render automatically (lazy-imported on first use; also import `katex/dist/katex.min.css`). | Chips and blocks show styled plain TeX — readable, editable, lossless. |
| `edododraw` (>= 0.1.4) | `edodoDraw()` | ` ```edd ` and ` ```mermaid ` fences render as live diagrams (lazy-imported on first render). | Widgets show a readable error box; the fence source is untouched and still round-trips. |

Neither is imported at module load — only when something actually needs to
render — so neither affects consumers who don't use these plugins.

## Widget machinery (for plugin authors)

`math()`, `diagrams()` and `embeds()` are built on shared widget machinery —
`createWidget` / `mountWidgets` / `wireWidgetEditing` / `escapeAttr`, exported
from `edodo-write/plugins` — and the engine treats their `<figure>` blocks as
first-class citizens (Enter escapes below, Backspace before one deletes it
whole, drag reorders). To build your own source-carrying block plugin, see
[Widget plugins](PLUGIN_GUIDE.md#widget-plugins-source-carrying-blocks) in the
Plugin guide.
