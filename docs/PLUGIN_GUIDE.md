# Plugin guide

Everything above the engine is a plugin. Commands, type-to-format input rules,
keyboard shortcuts, slash-menu items, toolbar buttons, block-menu items,
Markdown syntax — the built-ins ship through the exact same API you are about
to use (`src/core/preset.ts` is the core preset expressed as one big plugin,
and living documentation of every extension point). This guide teaches that
API end to end: the mental model, a first plugin, block plugins, the
`EditorContext` toolbox, plugin UI, and the round-trip contract that keeps
Markdown honest.

Prerequisites: [Architecture](ARCHITECTURE.md) explains the façade-over-Markdown
model and the plugin registry's place in it; the
[Integration guide](INTEGRATION_GUIDE.md) covers the host-app API
(`EdodoWrite`, options, events). This document assumes both and does not repeat
them. Every `ts`/`js` code block below is executed by the test suite
(`tests/docs-examples.test.ts`), so what you read is what runs.

## The mental model

A plugin is a **declarative bag of contributions** — a frozen plain object,
created with `definePlugin({ name, … })` and passed to the constructor:

| Field | What it contributes |
|---|---|
| `name` | Unique kebab-case identifier (an optional `:suffix` is allowed). |
| `priority` | Ordering weight for input rules and keybindings. Core preset: `0`; plugins default to `100` — higher runs earlier. |
| `commands` | Named `CommandSpec`s (`run` + optional `isActive`). |
| `inputRules` | Block ("type `# ` at the start") and inline ("close the `==`") rules. |
| `keymap` | `"Mod-Shift-h"` → command name or handler function. |
| `slashItems` / `toolbarItems` / `blockMenuItems` | Entries for the `/` menu, the floating toolbar, and the block-handle menu. |
| `markdown` | **Paired** marked + turndown extensions (see [the round-trip contract](#the-round-trip-contract)). |
| `sanitize` | Additive allow-list widening so your parsed HTML survives. |
| `setup` | Imperative escape hatch, runs once after mount; may return a cleanup. |
| `on` | Lifecycle hooks: `change`, `selection`, `focus`, `blur`, `destroy`. |

Three rules govern how the bag is consumed:

1. **Registries are resolved once, at construction.**
   `new EdodoWrite(host, { plugins })` flattens `[corePreset(), ...plugins]`
   into per-instance registries and a per-instance Markdown pipeline. There is
   no runtime (un)registration — dynamic plugin churn is where stale-menu and
   half-torn-down-rule bugs live. To change the set, create a new editor (the
   React wrapper captures `plugins` on mount for the same reason).

2. **Configuration mistakes throw; runtime mistakes are isolated.**
   Duplicate plugin names, duplicate command names, duplicate slash/toolbar/
   block-menu item ids, and malformed key strings **throw at construction,
   naming both offenders** — never silent last-wins. At runtime the polarity
   flips: every contribution (command bodies, rule callbacks, key handlers,
   menu actions, `isActive` probes, lifecycle hooks) runs inside a try/catch
   (`guard`); a throwing plugin logs and is skipped for that event. One bad
   plugin must not kill typing.

3. **The engine is not pluggable.** Structural Enter/Backspace/Tab semantics,
   the undo history, the clipboard contract, the sanitizer's denial floor, the
   document normalizer, and drag mechanics implement the contentEditable
   invariants whose violation corrupts documents. Plugins can *intercept*
   engine keys — a registered binding for `"Enter"` runs before the engine,
   and plugin keybindings (priority 100) run before the core preset (priority
   0), so you can even shadow `Mod-b` — but the engine always runs last and
   can never be removed.

Both failure modes, demonstrated:

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin } from "edodo-write";

// A minimal but complete plugin: one command.
const stamp = definePlugin({
  name: "stamp",
  commands: {
    stamp: {
      run: (ctx) => {
        const p = document.createElement("p");
        p.textContent = "stamped";
        ctx.root.appendChild(p);
      },
    },
  },
});

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "hello", plugins: [stamp] });
assert.equal(editor.exec("stamp"), true);
assert.equal(editor.getMarkdown(), "hello\n\nstamped");
editor.destroy();

// Configuration mistakes throw at construction, naming both offenders.
const rival = definePlugin({
  name: "rival",
  commands: { stamp: { run: () => {} } },
});
const host2 = document.createElement("div");
document.body.appendChild(host2);
assert.throws(
  () => new EdodoWrite(host2, { plugins: [stamp, rival] }),
  /command "stamp" registered by both "stamp" and "rival"/,
);
// Same for duplicate plugin names — and definePlugin validates upfront.
assert.throws(
  () => new EdodoWrite(host2, { plugins: [stamp, stamp] }),
  /duplicate plugin name "stamp"/,
);
assert.throws(() => definePlugin({ name: "Bad Name!" }), /kebab-case/);
assert.throws(
  () => definePlugin({ name: "ok", keymap: { "Mod-Fnord-x": "bold" } }),
  /unknown modifier/,
);
```

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin } from "edodo-write";

// Runtime mistakes are isolated: a throwing command logs and is skipped —
// the editor (and typing) survives.
const faulty = definePlugin({
  name: "faulty",
  commands: { boom: { run: () => { throw new Error("kaboom"); } } },
});

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "hello", plugins: [faulty] });

const errors: unknown[] = [];
const origError = console.error;
console.error = (...args: unknown[]) => { errors.push(args); };
editor.exec("boom");
console.error = origError;

assert.ok(errors.length > 0);                    // logged, not thrown
assert.equal(editor.getMarkdown(), "hello");     // document untouched
assert.equal(editor.exec("paragraph"), true);    // editor still works
editor.destroy();
```

From React, pass plugins to the wrapper — they are captured on mount, so
remount (e.g. with a `key`) to change the set:

```tsx
import { EdodoWriteEditor } from "edodo-write/react";
import { highlight, callout } from "edodo-write/plugins";

export function Notes(props: { value: string; onChange: (md: string) => void }) {
  return (
    <EdodoWriteEditor
      value={props.value}
      onChange={props.onChange}
      plugins={[highlight(), callout()]}
    />
  );
}
```

## Your first plugin: highlight

`==text==` ↔ `<mark>` — the canonical example, shipped as
`src/plugins/highlight.ts` and importable from `edodo-write/plugins`. It
exercises every non-UI extension point in ~50 lines. Here it is in full, built
from scratch (only the plugin `name` differs from the shipped one):

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin } from "edodo-write";

// See "Typed commands" for the CommandPayloads augmentation that makes
// editor.exec("highlight") a typed call in your own project.
const myHighlight = definePlugin({
  name: "my-highlight",

  // 1. The command: toggle <mark> at the selection. ctx.dom.toggleInlineTag
  //    is the generalized inline-wrap machinery (the same code path as inline
  //    code) — no execCommand, no hand-rolled ranges.
  commands: {
    highlight: {
      run: (ctx) => ctx.dom.toggleInlineTag("mark"),
      isActive: (ctx) => ctx.dom.isInlineTagActive("mark"),
    },
  },

  // 2. The input rule: typing the closing "==" wraps the inner text.
  //    Inline triggers must be $-anchored; match[1] is the wrapped text.
  inputRules: [
    { kind: "inline", trigger: /==([^=\n]+)==$/, apply: "mark" },
  ],

  // 3. The keybinding: plugin bindings (priority 100) run before core (0).
  keymap: {
    "Mod-Shift-h": "highlight",
  },

  // 4. The toolbar button: highlight state defaults to the command's isActive.
  toolbarItems: [
    { id: "highlight", label: "H", title: "Highlight  (⌘⇧H)", command: "highlight" },
  ],

  // 5. The PAIRED markdown extension: the marked tokenizer that READS ==…==
  //    ships in the same object as the turndown rule that WRITES it back.
  markdown: {
    marked: [{
      extensions: [{
        name: "highlight",
        level: "inline",
        start: (src: string) => src.indexOf("=="),
        tokenizer(src: string) {
          const m = /^==([^=\n]+)==/.exec(src);
          if (!m) return undefined;
          return {
            type: "highlight",
            raw: m[0],
            text: m[1],
            tokens: this.lexer.inlineTokens(m[1]),
          };
        },
        renderer(token) {
          return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
        },
      }],
    }],
    turndown: (td) => {
      td.addRule("highlight", {
        filter: "mark",
        replacement: (content) => `==${content}==`,
      });
    },
  },
  // <mark> is already in the sanitizer allow-list; a tag that isn't would
  // need: sanitize: { tags: ["mark"] }
});

// Loading stored markdown renders the mark; serialising writes it back —
// byte for byte.
const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "some ==highlighted== words",
  plugins: [myHighlight],
});
assert.ok(editor.getHTML().includes("<mark>highlighted</mark>"));
assert.equal(editor.getMarkdown(), "some ==highlighted== words");
editor.destroy();
```

### Watch the input rule fire (and what the runner does for you)

Input rules run on the `input` event. The runner (`src/core/input-rules.ts`)
owns the contentEditable gotchas so your rule never sees them — for an inline
rule that means: after wrapping `match[1]` in the new element, the caret is
parked **after a zero-width space (ZWSP) outside the mark**. Without it,
Chrome keeps typing *inside* the fresh `<mark>` forever. The ZWSP is editor
furniture: it is stripped by the serializer (and the clipboard flavours), so
it never reaches your Markdown.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { highlight } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "placeholder", plugins: [highlight()] });

// Simulate having just typed "watch ==this==": put the text in the block,
// the caret at the end, and fire `input` (what the browser does after a
// keystroke).
const p = editor.content.querySelector("p")!;
p.textContent = "watch ==this==";
const sel = window.getSelection()!;
const r = document.createRange();
r.selectNodeContents(p);
r.collapse(false);
sel.removeAllRanges();
sel.addRange(r);
editor.content.dispatchEvent(new Event("input", { bubbles: true }));

// The rule fired, and the runner parked the caret after a ZWSP outside the
// new mark…
assert.ok(editor.getHTML().includes("<mark>this</mark>"));
assert.ok(editor.getHTML().includes("\u200b"));
// …which the serializer strips: the Markdown is clean.
assert.equal(editor.getMarkdown(), "watch ==this==");
editor.destroy();
```

### The keybinding and the command, live

Keybinding syntax is `[Mod-|Ctrl-|Alt-|Shift-]*Key`, where `Mod` is ⌘ on
macOS and Ctrl elsewhere. A binding is either a command name or a handler
`(ctx, event) => boolean` — return `true` to consume the event. `definePlugin`
validates key strings upfront (unknown modifiers throw).

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { highlight } from "edodo-write/plugins";

// jsdom lacks Range.getClientRects — stub it once for selection-based tests
// (see "Testing your plugin" below). Real browsers never need this.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "glow up", plugins: [highlight()] });

// Focus FIRST, then select (jsdom's focus() resets a selection made before).
editor.focus();
const p = editor.content.querySelector("p")!;
const sel = window.getSelection()!;
const r = document.createRange();
r.selectNodeContents(p);
sel.removeAllRanges();
sel.addRange(r);

// Mod-Shift-H → the plugin's binding → exec("highlight") → <mark>.
editor.content.dispatchEvent(
  new KeyboardEvent("keydown", { key: "h", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }),
);
assert.equal(editor.getMarkdown(), "==glow up==");

// The command toggles: exec-ing it again (caret is inside the mark) unwraps.
assert.equal(editor.exec("highlight"), true);
assert.equal(editor.getMarkdown(), "glow up");
editor.destroy();
```

### Prove the round-trip

If your plugin touches Markdown syntax, this test is not optional — it is the
plugin contract's teeth (details in
[the round-trip contract](#the-round-trip-contract)):

```ts
import { strict as assert } from "node:assert";
import { createCodec, assertRoundTrip } from "edodo-write/testing";
import { highlight } from "edodo-write/plugins";

// The exact parse/serialize codec an editor with these plugins would use.
const codec = createCodec([highlight()]);
assertRoundTrip(codec, "some ==highlighted== words"); // throws on divergence
assert.ok(codec.parse("==hi==").includes("<mark>hi</mark>"));
assert.equal(codec.serialize("<p><mark>hi</mark></p>"), "==hi==");
```

## Typed commands

Command names live in the `CommandPayloads` interface. Because it is an
interface (not a closed union), plugins extend it with TypeScript **module
augmentation**, and their commands become first-class citizens of
`editor.exec` / `ctx.exec`:

```ts no-run
import { definePlugin } from "edodo-write";

declare module "edodo-write" {
  interface CommandPayloads {
    highlight: void;                 // no payload
    myEmbed: { url: string };        // payload required
  }
}

export const myEmbed = definePlugin({
  name: "my-embed",
  commands: {
    myEmbed: {
      run: (ctx, payload: { url: string }) => {
        // …insert the embed at the caret…
        void ctx; void payload;
      },
    },
  },
});

// Now, in any file that sees the augmentation:
//   editor.exec("myEmbed", { url: "https://…" })  — fully typed
//   editor.exec("myEmbed")                        — compile error (payload missing)
//   editor.exec("highlight")                      — ok (void payload = no argument)
```

The mechanics, and their edges:

- **`PayloadArgs`** makes the payload argument *required exactly when the
  declared payload isn't `void`*. `exec("bold")` takes no second argument;
  `exec("link", { href })` demands one.
- **`AnyCommand` is the escape hatch** for dynamic dispatch and plain JS: it
  autocompletes declared names but admits any string, with the payload typed
  `unknown`. Plain-JS plugin authors lose nothing.
- **Augmentation can fail silently.** Under unusual `moduleResolution`
  settings (or when the augmented module specifier doesn't match how you
  import the package), TypeScript quietly ignores the `declare module` block
  and your command name falls back to the `AnyCommand` string case — no error,
  just weaker types. The runtime is the backstop: executing a name that was
  never *registered* warns in the console and returns `false`; it never
  throws.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "hello" });

// The runtime backstop: unknown commands warn and return false — never throw.
const warnings: string[] = [];
const origWarn = console.warn;
console.warn = (msg: string) => { warnings.push(String(msg)); };
const result = editor.exec("not-a-command");
console.warn = origWarn;

assert.equal(result, false);
assert.ok(warnings.some((w) => w.includes('unknown command "not-a-command"')));
assert.equal(editor.getMarkdown(), "hello");
editor.destroy();
```

Note that registration itself is untyped on purpose — `commands` accepts any
string key (validated at runtime, collisions throw), so a JS-only plugin works
identically; the augmentation only adds compile-time safety for callers.

## Block plugins: callout

Inline marks wrap a range; **block plugins restructure the caret's block**.
The shipped example is `src/plugins/callout.ts` — Notion-style callouts stored
as GitHub alert syntax, chosen precisely because it degrades to a plain
blockquote everywhere else (see [the degradation story](#the-degradation-story)):

```markdown
> [!NOTE]
> Useful information users should know.
```

In the editor a callout is `<blockquote data-callout="note">…</blockquote>`.
The pieces, from the real source:

```ts no-run
// The block command: manual DOM via ctx.dom — never execCommand for block
// structure (execCommand block ops are silently dropped inside `input`
// events, exactly where input rules run).
const calloutCommand = {
  run: (ctx, payload?: { kind?: string }) => {
    const block = ctx.dom.currentBlock();
    if (!block) return false;                    // refuse → exec returns false
    const kind = payload?.kind ?? "note";
    if (block.tagName === "BLOCKQUOTE") {        // already a quote: upgrade
      block.setAttribute("data-callout", kind);
      return;
    }
    const bq = document.createElement("blockquote");
    bq.setAttribute("data-callout", kind);
    while (block.firstChild) bq.appendChild(block.firstChild);
    ctx.dom.ensureNotEmpty(bq);                  // empty block = unplaceable caret
    block.replaceWith(bq);
    ctx.dom.placeCaretAtEnd(bq);
  },
  isActive: (ctx) => !!ctx.dom.currentBlock()?.hasAttribute("data-callout"),
};

// The within-scoped input rule: `> ` already became a blockquote (core rule);
// typing `[!note] ` INSIDE one upgrades it. `within` scopes the rule to
// blockquotes (the default is plain paragraphs).
const calloutRule = {
  kind: "block",
  within: ["BLOCKQUOTE"],
  trigger: /^\[!(note|tip|important|warning|caution)\] $/i,
  apply: (ctx, match, block) => {
    block.setAttribute("data-callout", match[1].toLowerCase());
    ctx.dom.deleteLeadingChars(block, match[0].length);
    return true;                                 // "I changed the document"
  },
};

// Slash items carry payloads to one command — one command, many entries.
const calloutSlashItems = [
  { id: "callout-note", title: "Callout", group: "Media", command: "callout", payload: { kind: "note" } },
  { id: "callout-warning", title: "Warning callout", group: "Media", command: "callout", payload: { kind: "warning" } },
];

// The parsed HTML carries data-callout — widen the sanitizer for it.
// Widening is ADDITIVE only: the denial floor (scripts, iframes, event
// handlers, script-scheme URLs) is not negotiable.
const calloutSanitize = { attributes: { blockquote: ["data-callout"] } };
```

The full file adds the paired marked renderer + turndown rule (the same
pairing discipline as highlight). Now the plugin in action:

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { callout } from "edodo-write/plugins";

// Stored GitHub-alert markdown hydrates into a decorated block…
const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, {
  value: "> [!NOTE]\n> Useful information.",
  plugins: [callout()],
});
assert.ok(editor.getHTML().includes('data-callout="note"'));
assert.ok(!editor.getHTML().includes("[!NOTE]")); // the marker is structure, not text
assert.equal(editor.getMarkdown(), "> [!NOTE]\n> Useful information.");
editor.destroy();

// …and the command converts the CARET block (payload picks the kind).
const host2 = document.createElement("div");
document.body.appendChild(host2);
const editor2 = new EdodoWrite(host2, { value: "Ship it", plugins: [callout()] });
const p = editor2.content.querySelector("p")!;
const sel = window.getSelection()!;
const r = document.createRange();
r.selectNodeContents(p);
r.collapse(false);
sel.removeAllRanges();
sel.addRange(r);
editor2.exec("callout", { kind: "warning" }); // typed via the plugin's augmentation
assert.equal(editor2.getMarkdown(), "> [!WARNING]\n> Ship it");
editor2.destroy();
```

The `within`-scoped rule, firing as you type inside a quote:

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";
import { callout } from "edodo-write/plugins";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "> plain quote", plugins: [callout()] });

// Simulate having typed "[!warning] " at the start of the blockquote.
const bq = editor.content.querySelector("blockquote")!;
bq.textContent = "[!warning] plain quote";
const sel = window.getSelection()!;
const r = document.createRange();
r.setStart(bq.firstChild!, "[!warning] ".length);
r.collapse(true);
sel.removeAllRanges();
sel.addRange(r);
editor.content.dispatchEvent(new Event("input", { bubbles: true }));

assert.equal(editor.getMarkdown(), "> [!WARNING]\n> plain quote");
editor.destroy();
```

Two orderings in that rule are load-bearing, and both come from the engine's
hard-won invariants:

- **Convert before strip.** A rule must transform the still-non-empty block
  *first*, then delete the trigger text (commands no-op on empty blocks).
  Rules with `apply: "commandName"` inherit the whole
  convert → strip → re-anchor sequence — plus a single `transact()` around it
  so no half-done state hits undo history. Only function-`apply` rules manage
  the order themselves.
- **`ctx.dom.deleteLeadingChars` is checkbox-safe.** It anchors the deletion
  range to the first *text* node, never `(block, 0)`, so a leading task-list
  checkbox is never swept into a trigger deletion.

### The degradation story

This is the **required degradation policy for all plugin syntax**: a document
written with your plugin must stay valid, lossless Markdown for editors (and
renderers, and LLMs) that don't have it. GitHub alert syntax passes: without
the callout plugin, `> [!NOTE]` is just a blockquote whose first line reads
`[!NOTE]` — visible text, zero data loss. Design your syntax so that the
un-plugged reading is acceptable; if losing the plugin would destroy content
or produce garbage, choose a different mapping (this is why edodo-write maps
callouts to blockquotes and rejects syntaxes with no plain-Markdown form).

```ts
import { strict as assert } from "node:assert";
import { createCodec } from "edodo-write/testing";
import { callout } from "edodo-write/plugins";

const md = "> [!NOTE]\n> Useful information.";

// An editor WITHOUT the plugin: the callout renders as an ordinary
// blockquote, the marker as visible text — valid GFM, nothing lost.
const plain = createCodec([]);
const degradedHtml = plain.parse(md);
assert.ok(degradedHtml.includes("<blockquote>"));
assert.ok(degradedHtml.includes("[!NOTE]"));
assert.ok(!degradedHtml.includes("data-callout"));

// If that plugin-less editor re-saves, the marker text survives (turndown
// escapes the brackets, as it does for any literal ones)…
const resaved = plain.serialize(degradedHtml);
assert.equal(resaved, "> \\[!NOTE\\] Useful information.");

// …and an editor WITH the plugin re-hydrates even the escaped form back into
// a decorated callout, and normalises it to canonical syntax on save.
const decorated = createCodec([callout()]);
const rehydrated = decorated.parse(resaved);
assert.ok(rehydrated.includes('data-callout="note"'));
assert.equal(decorated.serialize(rehydrated), md);
```

## The EditorContext reference

Every plugin entry point — commands, rules, key handlers, menu items, `setup`,
lifecycle hooks — receives the same `EditorContext`. It is bound to *this*
editor instance (no root parameter to pass wrong on multi-editor pages).

### `ctx.dom` — the caret-safe toolbox

These helpers encode the contentEditable invariants (the full catalog, with
the bug behind each rule, is in [DEVELOPMENT.md](DEVELOPMENT.md)). Use them
instead of re-deriving caret math:

| Helper | What it does — and which gotcha it encapsulates |
|---|---|
| `currentBlock()` / `currentListItem()` | The top-level block / `<li>` holding the caret. `null` when the selection is outside the editor. |
| `blockKindOf(el)` | Tag → `BlockKind` (`"heading1"`, `"taskList"`, …). |
| `textBeforeCaret(block)` | Text from block start to caret — **pre-normalized**: a typed trailing space arrives as `U+00A0` (NBSP) and is mapped to a plain space; ZWSP caret furniture is stripped. Your string comparisons never meet either. |
| `isAtBlockStart(block)` | Caret at the block's visible start (ZWSP-aware). |
| `deleteLeadingChars(block, n)` | Delete the first `n` characters — anchored to the first **text** node, so a leading task checkbox is never swept into the deletion. |
| `ensureNotEmpty(el)` | Give an empty element a placeable caret (`<br>` anchor). An element with no children — or only empty text nodes — makes Chrome type into the *previous* block. |
| `placeCaretAtStart/AtEnd/After` | Caret placement that respects the anchors above. |
| `toggleInlineTag(tag)` / `isInlineTagActive(tag)` | The generalized inline-wrap machinery (what inline code and highlight use). |
| `selectionRect()` | Viewport rect of the selection — for positioning UI. |

### `ctx.exec`, `ctx.transact`, `ctx.markdown`, `ctx.ui`

- **`exec(cmd, payload?)` acts on the CARET block** — commands find their
  target through the selection, not through arguments. It returns `false`
  when the command is unregistered (warns), refused (`run` returned `false`),
  or the editor is read-only; otherwise `true`. Each `exec` runs inside a
  transaction and commits (normalize → history → change event) on completion.
- **`transact(fn)`** batches any number of DOM mutations — including nested
  `exec` calls — into **one undo step and one change event**. It is
  re-entrant: nested transactions commit once, at the outermost level. Any
  listener your `setup` attaches must wrap its mutations in `transact`,
  otherwise they are invisible to history and the `change` event.
- **`ctx.markdown`** is *this editor's* pipeline — core GFM plus every plugin
  extension in this instance: `parse(md)`, `serialize(html)`, and
  `insert(md)` (parse and insert at the caret as real blocks, transactional).
  Never reach for a global parser: two editors on one page can have different
  codecs.
- **`ctx.ui`** — see [Plugin UI](#plugin-ui).

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin, type EditorContext } from "edodo-write";

// `setup` receives the ctx once after mount — captured here to demonstrate
// the helpers directly.
let ctx: EditorContext | null = null;
const probe = definePlugin({ name: "probe", setup: (c) => { ctx = c; } });

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "one\n\ntwo", plugins: [probe] });
editor.focus(); // jsdom: focus BEFORE placing carets (focus resets a selection)

// textBeforeCaret hides the NBSP gotcha: the DOM holds "hello\u00a0"…
const first = editor.content.querySelector("p")!;
(first.firstChild as Text).data = "hello\u00a0";
const sel = window.getSelection()!;
const r = document.createRange();
r.selectNodeContents(first);
r.collapse(false);
sel.removeAllRanges();
sel.addRange(r);
assert.equal(ctx!.dom.textBeforeCaret(first), "hello "); // …you see a space
assert.equal(ctx!.dom.currentBlock(), first);

// exec acts on the CARET block: move the caret to the second paragraph.
const second = editor.content.querySelectorAll("p")[1]!;
ctx!.dom.placeCaretAtEnd(second);
ctx!.exec("heading2");
assert.equal(editor.getMarkdown(), "hello\n\n## two");

// transact: two commands, ONE undo step.
ctx!.transact(() => {
  ctx!.exec("divider");
  ctx!.exec("divider");
});
assert.equal(editor.getMarkdown(), "hello\n\n## two\n\n---\n\n---");
editor.undo();
assert.equal(editor.getMarkdown(), "hello\n\n## two");
editor.destroy();
```

## Plugin UI

`ctx.ui` is the **only sanctioned way to render plugin UI** — never append
your own elements to `document.body`. Every floating surface needs the same
safety properties, so they are implemented once (`src/core/ui.ts`):

- `ui.popover({ anchor, placement?, render, onClose? })` — an anchored
  floating panel. The editor handles: portal into a themed body-level layer
  (never clipped by the editor's overflow), viewport clamping,
  Escape/outside-click/scroll dismissal, one-popover-per-editor, and forced
  teardown on `destroy()` / `setReadOnly(true)`. `render(container, close)`
  builds the content with real DOM and may return a cleanup.
- `ui.menu({ anchor, items })` — a keyboard-navigable list menu built on
  `popover` (ArrowUp/Down, Enter, grouped headers, `danger` styling). Menus
  that open under the resting pointer don't take hover highlight until the
  mouse actually moves — don't rebuild that either.
- `ui.notify(message)` — a transient toast ("Copied as Markdown").

**Selection preservation** is the subtle part, and the UI layer does the heavy
lifting: when a popover opens, the editor's selection `Range` is saved, and
`mousedown` on the popover frame is prevented — clicking a button must not
collapse the selection it is about to act on (form fields are exempt so they
stay typeable). If your popover contains an input that steals focus, clone the
selection range *before* opening and restore it before acting, as the worked
example below does.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin, type EditorContext } from "edodo-write";

let ctx: EditorContext | null = null;
const probe = definePlugin({ name: "probe", setup: (c) => { ctx = c; } });

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "anchor me", plugins: [probe] });

// Popovers portal into a body-level layer, not into the editor.
const block = editor.content.querySelector("p")!;
const handle = ctx!.ui.popover({
  anchor: block,
  placement: "below",
  render(container, close) {
    const btn = document.createElement("button");
    btn.textContent = "Do it";
    btn.addEventListener("click", () => close());
    container.appendChild(btn);
  },
});
assert.ok(document.body.querySelector(".ew-popover"));
assert.ok(!editor.content.querySelector(".ew-popover"));
handle.close();
assert.equal(document.body.querySelector(".ew-popover"), null);

// destroy() tears down any open popover — plugins never leak UI.
ctx!.ui.popover({ anchor: block, render() {} });
editor.destroy();
assert.equal(document.body.querySelector(".ew-popover"), null);
```

A complete worked example — a slash item that opens a popover with a URL
field, preserving the selection across the focus steal (jsdom cannot exercise
focus/typing, so this one is shown, not run; the executable proof for
first-party popover flows is `tests/e2e/features.spec.ts`, and for plugin
slash/keybinding/toolbar flows `tests/e2e/plugins.spec.ts`):

```ts no-run
import { definePlugin } from "edodo-write";

export const bookmark = definePlugin({
  name: "bookmark",
  slashItems: [{
    id: "bookmark",
    title: "Bookmark",
    hint: "Link card from a URL",
    keywords: ["link", "card", "url"],
    group: "Embeds",
    run(ctx) {
      // The slash menu already removed the "/query" text and the caret sits
      // in the (now empty) block. Save the range BEFORE the input steals
      // focus, so we can act on it afterwards.
      const saved = window.getSelection()?.getRangeAt(0).cloneRange() ?? null;
      const anchor = ctx.dom.selectionRect() ?? ctx.dom.currentBlock()!;
      ctx.ui.popover({
        anchor,
        placement: "below",
        render(container, close) {
          const input = document.createElement("input");
          input.placeholder = "https://…";
          const ok = document.createElement("button");
          ok.textContent = "Insert";
          ok.addEventListener("click", () => {
            const url = input.value.trim();
            close();
            if (!url || !saved) return;
            // Restore the selection the input stole, then mutate inside ONE
            // transaction (one undo step, one change event).
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(saved);
            ctx.transact(() => {
              ctx.markdown.insert(`[${url}](${url})`);
            });
          });
          container.append(input, ok);
          setTimeout(() => input.focus(), 0);
        },
      });
    },
  }],
});
```

## The round-trip contract

Markdown is the single source of truth, so a plugin that changes what the
editor *reads* must change what it *writes* — `markdown.marked` (parse) and
`markdown.turndown` (serialize) ship in the same object because **a parse
extension without its serialize twin is a round-trip bug by construction**.
The formats are marked's and turndown's own, deliberately unwrapped: anything
those ecosystems document works here.

The failure mode is quiet and vicious: the document *renders* fine, then the
first save re-serialises the view and your syntax is gone. `assertRoundTrip`
(from `edodo-write/testing`) exists to make that loud — it checks
parse → serialize returns the input byte-for-byte, **and** that a second pass
is stable (idempotence):

```ts
import { strict as assert } from "node:assert";
import { definePlugin } from "edodo-write";
import { createCodec, assertRoundTrip } from "edodo-write/testing";

// A parse-only extension: %%text%% → <ins>. Renders beautifully…
const broken = definePlugin({
  name: "ins-broken",
  sanitize: { tags: ["ins"] },
  markdown: {
    marked: [{
      extensions: [{
        name: "inserted",
        level: "inline" as const,
        start: (src: string) => src.indexOf("%%"),
        tokenizer(src: string) {
          const m = /^%%([^%\n]+)%%/.exec(src);
          if (!m) return undefined;
          return { type: "inserted", raw: m[0], text: m[1] };
        },
        renderer(token: { text: string }) {
          return `<ins>${token.text}</ins>`;
        },
      }],
    }],
    // …no turndown twin. The first save destroys the syntax.
  },
});

const codec = createCodec([broken]);
assert.ok(codec.parse("%%new%% words").includes("<ins>new</ins>"));
assert.equal(codec.serialize(codec.parse("%%new%% words")), "new words"); // gone!
assert.throws(() => assertRoundTrip(codec, "%%new%% words"), /Round-trip diverged/);
```

### The dev loop (testing your plugin)

1. **Unit-test the codec first.** `createCodec([yourPlugin()])` builds the
   exact pipeline an editor with your plugin uses — no DOM host, no editor.
   `assertRoundTrip` every syntax form you support, plus the *interactions*
   (your mark inside bold, inside a list item, inside a blockquote…). Also
   round-trip a plain-GFM corpus through your codec to prove you broke nothing.
2. **Test behavior in jsdom** the way this guide's examples do: construct an
   editor, drive it through `exec`, dispatched `input`/`keydown` events, and
   selection placement — and assert on `getMarkdown()` (the contract), not on
   pixels. Two jsdom caveats: `document.execCommand` does not exist there, so
   the built-in inline marks (`bold`/`italic`/`strike`) no-op — use commands
   built on `ctx.dom` (like `toggleInlineTag`) or test those in a real
   browser; and `Range.getClientRects` is missing, so anything that positions
   UI from a selection needs the two-line stub shown earlier. Focus the
   editor *before* creating a selection.
3. **Prove UI flows in a real browser.** Keyboard events synthesized in jsdom
   never exercise real caret movement, IME, or focus — the repo's Playwright
   suite (`tests/e2e/plugins.spec.ts`) types `==text==` for real, presses the
   real shortcut, clicks the real toolbar button. The e2e fixture accepts
   `?plugins=highlight,callout`, so first-party plugin behavior is verified
   end-to-end; follow that pattern for yours.

## Recipes

### Autolink on space

An inline rule that turns a typed URL into a link when the space after it
lands. Note the character class: **a typed trailing space reaches the DOM as
`U+00A0` (NBSP)**. Block-rule text is pre-normalized for you, but inline rules
match the raw text node — so match both. The runner still does the caret work:
the new `<a>` gets the ZWSP park so you don't keep typing inside the link.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin } from "edodo-write";

const autolink = definePlugin({
  name: "autolink",
  inputRules: [{
    kind: "inline",
    trigger: /(https?:\/\/\S+)[ \u00a0]$/, // the trigger consumes the space
    apply: (match) => {
      const a = document.createElement("a");
      a.href = match[1];
      a.textContent = match[1];
      return a;                              // a node factory, not a tag name
    },
  }],
});

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "placeholder", plugins: [autolink] });

// Simulate the state right after typing "see https://example.com␣" —
// with the NBSP the browser actually produces.
const p = editor.content.querySelector("p")!;
p.textContent = "see https://example.com\u00a0";
const sel = window.getSelection()!;
const r = document.createRange();
r.selectNodeContents(p);
r.collapse(false);
sel.removeAllRanges();
sel.addRange(r);
editor.content.dispatchEvent(new Event("input", { bubbles: true }));

assert.ok(editor.getHTML().includes('<a href="https://example.com">'));
assert.equal(editor.getMarkdown(), "see [https://example.com](https://example.com)");
editor.destroy();
```

### Shadowing Mod-B

Plugin keybindings (default priority 100) sort before the core preset's
(priority 0), so registering the same key **shadows** the built-in. Return
`true` to consume the event; return `false` and the next binding — eventually
core's — still runs. The structural Enter/Backspace/Tab engine runs after all
registered bindings regardless.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin } from "edodo-write";

let intercepted = 0;
const noBold = definePlugin({
  name: "no-bold",
  keymap: {
    "Mod-b": () => { intercepted += 1; return true; }, // consumed: core never sees it
  },
});

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "hello", plugins: [noBold] });
editor.content.dispatchEvent(
  new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }),
);
assert.equal(intercepted, 1);
assert.equal(editor.getMarkdown(), "hello"); // nothing was bolded
editor.destroy();
```

### A slash item in your own group

Slash items are grouped under section headers (`group`, default `"Blocks"`);
new group names simply appear in the menu. Items either point at a `command`
(with an optional `payload`) or provide a `run` function, and can hide
contextually via `when(ctx)`. Ids must be globally unique — a collision with
any other plugin (or the core preset) throws at construction.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin } from "edodo-write";

// jsdom lacks Range.getClientRects — stub so the menu can position itself.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const embeds = definePlugin({
  name: "embeds",
  slashItems: [{
    id: "embed-bookmark",
    title: "Bookmark",
    hint: "Link card",
    keywords: ["link", "card"],
    group: "Embeds",                 // a brand-new section header
    command: "divider",              // stand-in; usually your own command
  }],
});

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "placeholder", plugins: [embeds] });

// Type "/book" in an empty-ish paragraph: the menu opens, filtered.
editor.focus();
const p = editor.content.querySelector("p")!;
p.textContent = "/book";
const sel = window.getSelection()!;
const r = document.createRange();
r.selectNodeContents(p);
r.collapse(false);
sel.removeAllRanges();
sel.addRange(r);
editor.content.dispatchEvent(new Event("input", { bubbles: true }));

const menu = document.querySelector(".ew-slash.is-visible")!;
assert.ok(menu);                                   // the menu is open…
assert.ok(menu.textContent!.includes("Embeds"));   // …with the custom group header
assert.ok(menu.textContent!.includes("Bookmark")); // …and the item

// Enter picks the highlighted item: the "/query" text is removed for you,
// then the command runs.
editor.content.dispatchEvent(
  new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
);
assert.equal(editor.getMarkdown(), "---");
editor.destroy();
```

### Autosave on change

`on.change` is declarative sugar over `editor.on("change", …)`, with the ctx
supplied and guard-isolation applied. The `change` event is **debounced
(~120 ms)** so a burst of typing is one save — await it in tests (never a
fixed-time sleep in e2e; here the debounce is the thing being shown).

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite, definePlugin } from "edodo-write";

const saves: string[] = [];
const autosave = definePlugin({
  name: "autosave",
  on: {
    change: (markdown) => { saves.push(markdown); },
  },
});

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "v1", plugins: [autosave] });

editor.setMarkdown("v2");
assert.equal(saves.length, 0);                       // not yet — debounced
await new Promise((resolve) => setTimeout(resolve, 200));
assert.deepEqual(saves, ["v2"]);
editor.destroy();
```

### Removing core features

`exclude` removes feature keys (command names / item ids) **from the core
preset only** — the command, its input rules, keybindings, and menu items all
go together; plugins are never affected by it.

```ts
import { strict as assert } from "node:assert";
import { EdodoWrite } from "edodo-write";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host, { value: "no tasks here", exclude: ["taskList"] });

// The command is fully unregistered: exec warns and returns false.
const origWarn = console.warn;
console.warn = () => {};
assert.equal(editor.exec("taskList"), false);
console.warn = origWarn;

// Everything else still exists:
editor.focus();
const p = editor.content.querySelector("p")!;
const sel = window.getSelection()!;
const r = document.createRange();
r.selectNodeContents(p);
r.collapse(false);
sel.removeAllRanges();
sel.addRange(r);
assert.equal(editor.exec("bulletList"), true);
assert.equal(editor.getMarkdown(), "- no tasks here");
editor.destroy();
```

## The never-do list

- **Never use `execCommand` for block structure.** `formatBlock`,
  `insertUnorderedList` and friends are silently dropped inside `input`
  events — exactly where input rules run. Build blocks with manual DOM
  through `ctx.dom` (every core block command does).
- **Never hand-roll caret math.** `ctx.dom` exists because each helper
  encodes a bug: NBSP text, ZWSP furniture, checkbox-first task items,
  unplaceable empty blocks. Re-deriving any of these corrupts documents in
  ways jsdom tests won't catch.
- **Never assign user strings to `innerHTML`.** Menu labels, popover content,
  anything: use `textContent` / `createElement`. (The registry UIs already
  treat your `title`/`label`/`hint` as plain text — keep your own UI to the
  same standard.)
- **Never ship an unpaired markdown extension.** Parse without serialize eats
  the syntax on first save; serialize without parse writes syntax the editor
  can't read back. Pair them and prove it with `assertRoundTrip`.
- **Never append UI to `document.body` yourself.** `ctx.ui` popovers get
  theming, clamping, dismissal, selection preservation and destroy-teardown
  for free; a raw appended div gets none and leaks on `destroy()`.
- **Never mutate the document outside `transact` from your own listeners.**
  Commands, rules and menu items are wrapped for you — but a listener you
  attach in `setup` is not. Un-transacted mutations skip normalization, undo
  history and the `change` event; wrap them.
- **Never lower the sanitizer floor** — you can't (widening is additive and
  the denial floor is enforced), but don't design syntax that needs scripts,
  iframes or event handlers to render.

When in doubt, read `src/core/preset.ts` — every built-in is written against
the same API you have, and it is the reference implementation for taste.
