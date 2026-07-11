# edodo-write → Full Replacement of `@edodo/markdown-composer`: Engineering Spec

## 1. Title + TL;DR

**Goal.** Upgrade `edodo-write` (OSS, MIT, v0.6.5) so that it can *fully* replace the in-house `@edodo/markdown-composer` inside EDodo.app — owning not just WYSIWYG editing but also **safe server-side rendering, mentions, emoji, plain-text extraction, email HTML, HTML ingest, and a stored-token parse/visitor API** — with **zero EDodo specifics baked into the package**. Every product-specific behavior (the `@[Display](id)` token grammar, the `:shortcode:` emoji map, the teal email theme, the ingest strip-list) is injected by the host through a plugin/config/adapter seam. The sequence is: **ship these as additive semver-minor releases of `edodo-write` first**, then EDodo builds a thin wrapper that registers its plugins, switches all reads to the plugin-aware renderer, and deletes `@edodo/markdown-composer` (and the already-dead `@edodo/edutor`).

The single most important architectural rule, which every item below serves: **the renderer's parse codec MUST be the same codec the editor would serialize** — read-only render output must be byte-identical to what an editor built with the same plugins would round-trip. Today that is false in two ways (the module-level renderer ignores plugin extensions, and it silently skips sanitization in bare Node), and those two facts are the P0s.

### Capability gap table

| # | Capability | Gap today | Priority | Effort |
|---|---|---|---|---|
| A | **SSR-safe sanitizer** | `sanitizeHtml` throws in bare Node (`DOMParser` undefined); `toHTML`/`<Markdown>` silently emit **unsanitized** HTML server-side | **P0** (security) | L (swap DOM dep for `parse5`/`htmlparser2`, keep policy layer) |
| B | **Plugin-aware render (render == editor codec)** | `<Markdown>`/`toHTML` use extension-free module parser; mentions/emoji/callouts/math don't render | **P0** | M |
| C | **Mentions as configurable plugin** | `tags()` hardcodes GFM `[label](href)`; no custom stored token | **P1** | M |
| D | **Emoji plugin** | none | **P1** | S–M |
| E | **Imperative `insertText`** | no caret-safe insert command exposed as a helper/command | **P1** | S |
| F | **Content-lifecycle parse/visitor API** | no Node-safe token walker / extractors / `toggleTask` | **P1** | M |
| G | **Plain-text extraction** | no `toPlainText` | **P1** | S–M |
| H | **Email render adapter** | none | **P2** | M |
| I | **Configurable HTML ingest** | `htmlToMarkdown` has fixed strip-list + fixed rules | **P2** | S |
| J | **Remaining editor parity** (footnotes, toggle, file token, source/split modes, drag handle, stable DOM hooks) | partial/missing | **P2** | M–L |

**Sequencing note:** A is the keystone. B, G, and H all require Markdown→HTML to run *safely* in Node; all three are blocked-on or degraded-by A. Ship A first.

---

## 2. Design principles

1. **Markdown is the single source of truth.** This is already `edodo-write`'s core invariant (`src/core/types.ts:9-18`). Nothing below stores HTML as canonical, or bakes a rendered chip into storage. The only stored artifacts are Markdown tokens (`@[Display](id)`, `:shortcode:`, `!file[name](url)`, `[^id]`, standard `![alt](url)`).

2. **Every EDodo-specific is injected upstream-blind.** The package must never contain the strings `"EDodo"`, `edodo.app`, the teal palette, or the `@[…](…)` grammar as a hardcoded default. Product specifics arrive through: plugin registration (mention token grammar, emoji map, file token), a theme/shell config (email), and an options bag (ingest strip-list). The package ships *neutral* defaults so it renders out-of-the-box, and hosts override them.

3. **Render codec === editor codec.** For any plugin set `P`, `renderMarkdown(md, { plugins: P })` MUST produce the same HTML that an `EdodoWrite` instance constructed with `P` produces via `getHTML()` after `setMarkdown(md)`, and the reverse serialize (`getMarkdown()`) must reproduce `md` byte-for-byte (`assertRoundTrip`, `testing.ts:44`). A parse extension without its serialize twin is a bug *by construction* (`types.ts:200-205`). This is what makes read-only pages, editor previews, and server extraction all agree.

4. **Backward compatible, additive, semver-minor.** No existing export changes signature or behavior. Every new capability is a new export, a new optional prop, or a new optional option field with a default that reproduces current behavior. Nothing is deprecated or removed. `parseMarkdown(md)` with no plugins keeps returning today's plain-GFM output.

---

## 3. P0 — SSR-safe rendering & sanitizer

### 3.1 The current problem (verified, not assumed)

The sanitizer is DOM-bound and the parser fast-paths *around* it when no DOM exists.

`src/core/sanitize.ts:133`:
```ts
const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
```
`src/core/parse.ts:42`:
```ts
if (opts.sanitize === false || typeof DOMParser === "undefined") return raw;   // ← bare Node bypass
```

Empirically confirmed against the built `dist-lib/index.js` in a real no-DOM Node process:
```
typeof DOMParser: undefined
toHTML("# Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>")
  → "<h1>Hi</h1>\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>"
  CONTAINS <script>? true   CONTAINS onerror? true
sanitizeHtml("<p onclick=x>hi<script>e()</script></p>")
  → THROWS ReferenceError: DOMParser is not defined
```

So: **`toHTML`/`renderMarkdown`/`<Markdown>` emit live `<script>`/`onerror`/`javascript:` to any Next.js server component / edge / Node SSR path** (exactly the runtimes `<Markdown>` invites), and **`sanitizeHtml` called directly crashes** there. `@edodo/markdown-composer` avoids this by shipping a *pure-JS* server path (`sanitize-html`, no jsdom — chosen precisely because jsdom@28 breaks under Turbopack). `edodo-write` must match that DOM-free guarantee.

### 3.2 Required fix — an isomorphic, allowlist sanitizer

Replace the `DOMParser` dependency in `sanitize.ts` with a **DOM-independent HTML tokenizer/serializer** (`parse5` or `htmlparser2`, both native-Node) while keeping the existing policy layer verbatim: `resolvePolicy`, `cleanElement`, `safeUrl`, `DENIED_TAGS`, `ALLOWED_TAGS`, `GLOBAL_ATTRS`, `TAG_ATTRS`, `on*`-strip, `target=_blank`→`rel=noopener noreferrer` hardening (`sanitize.ts:56-125`). Then **delete the `typeof DOMParser === "undefined"` bailout at `parse.ts:42`** so sanitization *always* runs unless the caller explicitly passes `sanitize: false` for trusted input.

```ts
// src/core/sanitize.ts — signature unchanged; implementation becomes DOM-free
function sanitizeHtml(html: string, options?: SanitizeOptions): string
interface SanitizeOptions { tags?: string[]; attributes?: Record<string, string[]>; }  // sanitize.ts:16-21
```

The policy model to preserve (this is the canonical, minimal contract — mirror `@edodo/markdown-composer`'s DOM-free server allowlist where richer):

- **Allowed tags** (floor): prose + `a b blockquote br code div em i s del h1–h6 hr img input li ol p pre section span strong sub sup table tbody td th thead tr ul figure figcaption details summary`.
- **Schemes**: `http, https, mailto, tel` globally on `href`/`src`; `data:` allowed **only** on `<img src>`, never on `<a href>` (phishing/XSS asymmetry — must be preserved). `safeUrl` additionally strips control chars and blocks `javascript:`/`data:text/html`/`vbscript:`.
- **Global attrs**: `class contenteditable id rel target title` + a **round-trip data-attr set** (see §4).
- `input` must allow `type checked disabled class` or server-rendered task lists lose every checkbox.
- `disallowedTagsMode: discard` semantics (unknown tag dropped, content kept).

### 3.3 How plugins ADD allowances

Keep the existing additive merge (`plugin.ts:192-203`): a plugin's `sanitize?: SanitizeOptions` widens the allowlist for its own output only; the `DENIED_TAGS` floor is re-filtered and non-negotiable (`resolvePolicy`, `sanitize.ts:76-79`). Example already in-tree: `math.ts:236-243` adds `{ tags:["figure"], attributes:{ figure:[…], span:["data-math"] } }`. The **round-trip data-attrs** an EDodo mention/file/unfurl/emoji/math plugin needs (`data-mention-id data-mention-display data-shortcode data-file-name data-file-url data-unfurl-title data-unfurl-url data-math-source data-md-block data-md-open data-md-empty`) are supplied by *those plugins*, not hardcoded into the core floor.

### 3.4 Acceptance tests (must run in bare Node, no jsdom)

```ts
// __tests__/sanitize-node.test.ts  — run in a node env with NO DOMParser
test("toHTML strips script/handlers/js-urls in Node", () => {
  const out = toHTML("# Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))");
  expect(out).not.toMatch(/<script/i);
  expect(out).not.toMatch(/onerror/i);
  expect(out).not.toMatch(/javascript:/i);
  expect(out).toContain("<h1>Hi</h1>");
});
test("sanitizeHtml does not throw in Node", () => {
  expect(() => sanitizeHtml("<p onclick=x>hi<script>e()</script></p>")).not.toThrow();
});
test("data: allowed on img, blocked on a", () => {
  expect(toHTML("![x](data:image/png;base64,AAAA)")).toContain("data:image/png");
  expect(toHTML("[x](data:text/html,<h1>)")).not.toMatch(/href="data:/);
});
```

---

## 4. P0 — Plugin-aware rendering (render == editor codec)

### 4.1 Problem

`<Markdown>` (`react.tsx:94`), `toHTML` (`index.ts:72-74`), and `renderMarkdown` (`index.ts:87`) all call the **extension-free** module-level `parseMarkdown` (`parse.ts:54-56`), which lazily builds `createMarkdownParser()` with **no arguments** → no plugin marked extensions. Plugin extensions are threaded only inside an editor instance (`editor.ts:146`) or `createCodec` (`testing.ts:34`). So a page rendering stored content with mentions/emoji/callouts/math read-only gets **raw tokens**, not chips. This is the documented limitation in `llms-full.txt` (~line 2217).

### 4.2 Required additions

Promote the codec that already applies plugin extensions from `/testing` into a first-class **render** helper on the main entry, and give `<Markdown>` a `plugins` prop.

```ts
// src/lib/index.ts (new exports, alongside toHTML ~line 72)

/** Markdown → sanitized HTML using the SAME marked+turndown+sanitize registry as an editor
 *  built with these plugins. corePreset() is always included first. Node-safe (depends on §3). */
function renderMarkdownWithPlugins(
  md: string,
  plugins?: EdodoPlugin[],
  opts?: ParseOptions & { exclude?: string[] },
): string;

/** Build a reusable render codec once (hot paths / SSR loops) and reuse it. */
function createRenderCodec(
  plugins?: EdodoPlugin[],
  exclude?: string[],
): { render(md: string, opts?: ParseOptions): string };
```

Internally identical to `createCodec` (`testing.ts:31-37`): `resolvePlugins([corePreset(), ...plugins], exclude)` → `createMarkdownParser(registry.markedExtensions, registry.sanitize)`. Both **must** depend on the §3 no-DOM sanitizer.

```ts
// src/lib/react.tsx — MarkdownProps (line 86-90) gains `plugins`
interface MarkdownProps {
  value?: string;
  plugins?: EdodoPlugin[];   // NEW — routes through createRenderCodec instead of bare parseMarkdown
  className?: string;
  style?: React.CSSProperties;
}
```

### 4.3 Usage

```tsx
import { Markdown } from "edodo-write/react";
import { mentions, emoji, callout, math } from "@/lib/edodo-write-plugins"; // host presets

<Markdown value={storedMd} plugins={[mentions(cfg), emoji(cfg), callout(), math()]} />
```
```ts
// server component
import { createRenderCodec } from "edodo-write";
const codec = createRenderCodec([mentions(cfg), emoji(cfg)]);
export default async function Page() {
  const html = codec.render(post.body_md);          // sanitized, plugin-aware, Node-safe
  return <div className="ew ew-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
```

### 4.4 React 18/19 & hydration

- Output must be **deterministic** (no `Date.now()`/random ids in rendered chips; footnote/math ids derive from source, not a counter that differs SSR vs client) so `dangerouslySetInnerHTML` server output === client. Any post-render DOM enhancement (clickable checkboxes, code toolbar) runs in `useEffect` only, never during render.
- `<Markdown>` renders a **stable wrapper** (`div.ew.ew-content`) with a single delegated click handler pattern (mirror markdown-composer's `onMentionClick` delegation on the stable wrapper) so callbacks never rebind and don't cause hydration diffs.
- Ship a React 19 peer range (§13).

**Acceptance:** `renderMarkdownWithPlugins(md, P)` === `new EdodoWrite(host, { plugins: P }).setMarkdown(md).getHTML()` for a fixture corpus covering every plugin; SSR string === client-hydrated `innerHTML` (no dev-mode hydration warning).

---

## 5. P1 — Mentions as a configurable plugin

### 5.1 Problem

`edodo-write`'s `tags()` plugin (`tags.ts:70`) supports `@`/`:` triggers and an async `source`, but serialization is **hardcoded GFM**: an item with `href` → `[@label](href)`, without → plain text `@label` (`tags.ts:210-230`). There is no marked/turndown extension, so a *custom* stored token can't round-trip. EDodo needs a different stored form.

### 5.2 The exact EDodo token to support (worked example)

From `constants.js:8` and `markdown-composer.jsx:513`:
```
MENTION_TOKEN_RE = /@\[([^\]]+)\]\(([^)\s]+)\)/g          // @[Display Name](id)
insert format:   `@[${item.display}](${item.id}) `        // display frozen at insert + TRAILING SPACE
```
- **Grammar:** `@[` + display (`[^\]]+`, ≥1, no `]`) + `](` + id (`[^)\s]+`, no `)`/whitespace) + `)`.
- **`@channel` special case:** the channel item is `{ id:'@channel', display:'channel' }` → stored token `@[channel](@channel)`. The host treats `id === '@channel' || id === 'channel'` as a broadcast, everything else as a user id.
- **Rendered chip** (`render.js:361-368`), `escapeHtml` on both id and display, leading literal `@`:
```html
<span class="mc-mention" data-mention-id="{id}" data-mention-display="{display}" contenteditable="false">@{display}</span>
```
- **No tombstone stored.** Display is frozen at insert; deleted-account relabeling happens at render via a `resolveMention(id, display) → {display}` hook, never in the token.

### 5.3 Required API — extend `tags()` with serialize/parse/render hooks

Add three hooks to `TagsOptions` (`tags.ts:32-46`) and, because the stored form now diverges from plain GFM, require the plugin to register the *paired* marked+turndown extension internally so it round-trips. Prefer extending `tags()` over a new concept.

```ts
interface TagsOptions {
  trigger: string;                                   // "@"
  source: (query: string) => Promise<TagItem[]>;     // async suggestions
  allowBroadcast?: { id: string; display: string };  // NEW — the @channel item, host-defined

  // NEW serialization seam (default = current GFM behavior when omitted → fully backward compatible)
  serialize?: (item: TagItem) => string;             // TagItem → stored markdown token (NO trailing space; engine adds it)
  parse?: {                                          // token grammar the marked ext + extractor use
    pattern: RegExp;                                 // e.g. /@\[([^\]]+)\]\(([^)\s]+)\)/g
    toItem: (m: RegExpExecArray) => TagItem;         // capture → { id, display }
  };
  render?: (item: TagItem, resolve?: ResolveMention) => Node; // read-render chip
  resolveMention?: ResolveMention;                    // (id, display) => { display } | null — deleted-account relabel
}
type ResolveMention = (id: string, fallbackDisplay: string) => { display: string } | null;
interface TagItem { id: string; display: string; subtitle?: string; avatar?: string; color?: string; }
```

When `serialize`/`parse`/`render` are supplied, the plugin MUST internally register a `markdown.marked` tokenizer + `markdown.turndown` rule (the round-trip twin, `types.ts:200-211`), plus `sanitize: { tags:["span"], attributes:{ span:["data-mention-id","data-mention-display"] } }`. When omitted, behavior is exactly today's GFM path (backward compatible). Multi-instance decorate keys off `data-tag-trigger` (`tags.ts:239-253`) — keep the new chip compatible.

### 5.4 EDodo worked example

```ts
export const mentions = (cfg: { fetchUsers: (q: string) => Promise<TagItem[]>; resolveMention?: ResolveMention }) =>
  tags({
    trigger: "@",
    source: cfg.fetchUsers,
    allowBroadcast: { id: "@channel", display: "channel" },
    serialize: (i) => `@[${i.display}](${i.id})`,                     // engine appends the trailing space
    parse: {
      pattern: /@\[([^\]]+)\]\(([^)\s]+)\)/g,
      toItem: (m) => ({ display: m[1], id: m[2] }),
    },
    resolveMention: cfg.resolveMention,
    render: (i, resolve) => {
      const d = (resolve?.(i.id, i.display)?.display) ?? i.display;
      const el = document.createElement("span");
      el.className = "ew-mention"; el.dataset.mentionId = i.id; el.dataset.mentionDisplay = d;
      el.contentEditable = "false"; el.textContent = `@${d}`;
      return el;
    },
  });
```

**Acceptance:** `assertRoundTrip(codec, "hi @[Alice](u_1) and @[channel](@channel)")` passes byte-stable; render chip has correct `data-*`; `resolveMention` relabels without changing the stored token.

---

## 6. P1 — Emoji plugin

First-party `emoji()` plugin (`src/plugins/emoji.ts`, exported from `src/plugins/index.ts`), modeled on `highlight.ts:46-73`.

```ts
interface EmojiOptions {
  map: Record<string, string>;      // shortcode → glyph (host supplies; EDodo passes DEFAULT_EMOJI, 187 entries)
  trigger?: string;                 // default ":"  — autocomplete + picker
  autocomplete?: boolean;           // default true
  picker?: boolean;                 // default true
  storedForm?: "shortcode" | "unicode"; // default "shortcode" → stored & round-tripped as :name:
  render?: (glyph: string, code: string) => Node;  // default: <span class="ew-emoji" data-shortcode>{glyph}</span>
}
function emoji(options: EmojiOptions): EdodoPlugin;
```

- **Grammar:** `/:([a-z0-9_+-]+):/gi`; lookup lowercased against `map`. **Unknown shortcode → literal passthrough** (`:foo:` unchanged) — do not consume.
- **Stored form** `:shortcode:` (default). The `markdown.marked` inline extension emits the glyph span; the paired `markdown.turndown` rule writes `data-shortcode` back to `:name:` — this preserves round-trip even though the visible node is a glyph. (`storedForm: "unicode"` serializes the bare glyph and needs no reverse rule.)
- Optional inline `inputRules` for type-to-replace and a `tags`-style `:` suggestion menu.

```ts
import { DEFAULT_EMOJI } from "@/lib/edodo-emoji";   // host owns the map
emoji({ map: DEFAULT_EMOJI });                       // :rocket: → 🚀, round-trips to :rocket:
```

**Acceptance:** `assertRoundTrip(codec, "ship it :rocket: :+1:")`; unknown `:nope:` survives verbatim; render span carries `data-shortcode="rocket"`.

---

## 7. P1 — Imperative text insertion

Dictation and email `{{placeholder}}` injection both need a caret-safe, non-destructive insert that produces **one undo step and one change event**. `edodo-write` already has the machinery (`ctx.markdown.insert`, `clipboard.ts:95`, `transact`); expose it as both a core command and an instance method.

```ts
// src/core/types.ts — CommandPayloads augmentation (types.ts:39-61)
interface CommandPayloads { insertText: { text: string }; }

// src/core/commands.ts — coreCommands, registered in preset.ts:85
insertText: {
  run(ctx, { text }) {
    return ctx.transact(() => {                    // one undo step + one change event
      // caret inside editor → insert at caret; else focus + append as a NEW paragraph at end.
      // NEVER fuse onto the prior line; NEVER blindly append mid-doc. Use ctx.dom caret helpers.
      ctx.markdown.insert(text);                    // treats text as markdown; use dom.insertText for literal
      return true;
    });
  },
}

// src/core/editor.ts — public method (alongside insertImages :270)
insertText(text: string): boolean;   // instance.exec("insertText", { text }) sugar
```

This is the exact 3-method `editorApi` semantics markdown-composer exposes to `dictation.render` and `editorRef` (`markdown-composer.jsx:1046-1121`): `insertText` is caret-aware and non-destructive. Expose `focus()` and `getMarkdown()` too (already present) so the host's dictation slot and `editorRef` bind to `{ insertText, focus, getMarkdown }`.

```ts
editor.exec("insertText", { text: "{{first_name}}" });   // placeholder sidebar
<DictationButton onTranscription={(t) => editorApi.insertText(t)} />
```

**Acceptance:** insert at caret inserts inline; insert with caret outside appends a new paragraph (no fusion); a single `undo()` reverts the whole insert; exactly one `change` fires.

---

## 8. P1 — Content-lifecycle parsing API

EDodo parses **stored markdown server-side** for notification fan-out, Postgres FTS, AI moderation, attachment GC, and task-checkbox persistence (`lib/tribe/service.js:317,321,550`). Today those bind to markdown-composer's `extractMentions`/`extractAttachments`/`toggleTaskInMarkdown`/`extractEmojiShortcodes`, all built on the **code-region-aware splitter** `splitCodeSegments` (invariant `parts.map(p=>p.text).join('') === md`). The host must never hand-roll these regexes. `edodo-write` must expose a **Node-safe parse/visitor API** so extractors bind to a real parse tree.

```ts
// src/lib/parse-api.ts — new "./parse" subpath, Node-safe (no DOM)

/** CommonMark-accurate fence/inline-code splitter. Invariant: parts.map(p=>p.text).join("") === md. */
function splitCodeSegments(md: string): Array<{ code: boolean; text: string }>;
function stripCodeBlocks(md: string): string;        // code chars → spaces, offsets preserved
function markCodeLines(md: string): boolean[];        // per-line, for line-anchored scans

/** Walk stored markdown as a token tree, applying plugin token grammars (mentions/emoji/file/…). */
function parseTokens(md: string, opts?: { plugins?: EdodoPlugin[] }): TokenNode[];
interface TokenNode { type: string; /* "text"|"mention"|"emoji"|"file"|"image"|"link"|"footnoteRef"|… */
  value?: string; attrs?: Record<string, string>; children?: TokenNode[]; range: [number, number]; }

/** Generic token-family extractor driven by a plugin's parse.pattern (code-skipping). */
function extractTokens(md: string, pattern: RegExp, map: (m: RegExpExecArray) => any): any[];

/** GFM task toggle: flip Nth (0-based, doc-order, code-skipping) checkbox to absolute state. */
function toggleTaskInMarkdown(md: string, index: number, checked: boolean): string;
```

Hosts compose their extractors on top (the mention/file/emoji grammars come from the *same* plugin `parse.pattern` used at render time, so extraction and render can never diverge):

```ts
import { extractTokens, splitCodeSegments } from "edodo-write/parse";
import { mentions } from "@/lib/edodo-write-plugins";

const MENTION = /@\[([^\]]+)\]\(([^)\s]+)\)/g;
export function extractMentions(md: string) {
  const rows = extractTokens(md, MENTION, (m) => ({ display: m[1], id: m[2] }));
  const userIds = [...new Set(rows.map(r => r.id).filter(id => id !== "@channel" && id !== "channel"))];
  const hasChannelMention = rows.some(r => r.id === "@channel" || r.id === "channel");
  return { userIds, hasChannelMention, mentions: rows };
}
```

`toggleTaskInMarkdown` must reproduce markdown-composer's contract exactly: recognizes `TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)[ xX](\])/`, index maps 1:1 to DOM `input[type=checkbox]` document order (code-skipping), returns `md` unchanged if index out of range. It backs `onTaskToggle` (§12) and the `<Markdown>` checkbox enhancer.

**Acceptance:** extractor tests over fixtures with tokens inside fenced/inline code (must be skipped); `toggleTaskInMarkdown` index parity with rendered checkbox order; `splitCodeSegments` join-invariant property test.

---

## 9. P1 — Plain-text extraction

Generic, **Node-safe (no DOM, no sanitizer)**, plugin-aware `toPlainText` for SEO `<meta>`, JSON-LD, OG/Twitter descriptions, and card excerpts. EDodo has ~15 consumers (articles JSON-LD @300, notes meta @160 + crawler block @4000, profile bio @200, book/path @200, list excerpts @160–200, email fallback with `preserveLineBreaks`). Implement as a **token-based** walker (a `marked.Renderer` emitting text), never via `toHTML`→strip (that needs a DOM and the sanitizer).

```ts
// src/lib/index.ts (alongside toMarkdown ~line 77)
function toPlainText(md: string, options?: PlainTextOptions): string;
interface PlainTextOptions {
  maxLength?: number;                 // hard cap on RETURNED length (ellipsis counted in budget); falsy = no truncation
  ellipsis?: string;                  // default "…"; "" honored; only null/undefined → default
  preserveLineBreaks?: boolean;       // false = single line (SEO default); true = keep paragraph breaks (email)
  wordBoundary?: boolean;             // default true; back up to last space only if past halfway
  plugins?: EdodoPlugin[];            // token resolution (mention → @Display, emoji → glyph, file → name…)
  decodeEntities?: boolean;           // default true (7-entity map: & < > " ' &#39; &nbsp;)
  stripTags?: string[];               // default ["script","style","iframe","noscript","object","embed"] (contents dropped)
}
```

**Reference behavior to reproduce** (from markdown-composer `plain-text.js` + `markdown-utils.js`):

- Block tokens append `\n\n`; headings drop `#` and level; `blockquote` → inner text; fenced code → inner code text, markers dropped; `hr` → `\n`; **tables dropped entirely** (`renderer.table = () => ''`); list items → `- item`.
- Inline: `strong/em/del/codespan` → text only; `br` → space; `[text](url)` → `text`; `![alt](url)` → `alt` (empty alt → "").
- **Plugin token resolution** (via `plugins`, replacing markdown-composer's hardcoded regexes): mention `@[Display](id)` → `@Display`; file `!file[name](url)` → `name || url`; unfurl `!unfurl[title](url)` → `title || url`; **emoji `:code:` → glyph via the plugin's map** (else drop colons). This is the FTS/moderation projection (`markdown-utils.js:75-78`) — same emoji map as render, so plain-text and rendered glyph never disagree.
- **Truncation math** (carry verbatim): ellipsis included in budget (`limit = maxLength - ellipsis.length`; `limit<=0 → ellipsis`); word-boundary backup fires only when `lastSpace > limit*0.5`; single-line default collapses all whitespace, `preserveLineBreaks` keeps `\n\n`.
- Never throw: on parse error fall back to `String(md)` and still run the strip pipeline.

```ts
import { toPlainText } from "edodo-write";
import { mentions, emoji } from "@/lib/edodo-write-plugins";
const desc = toPlainText(article.body_md, { maxLength: 300, plugins: [mentions(cfg), emoji(cfg)] });
```

**Acceptance:** `toPlainText("")` / `null` / `undefined` → `""`; `maxLength` cap honored including ellipsis; `# H\n\n> q\n\n\`\`\`x\`\`\`` collapses correctly; mention→`@Display`, `:rocket:`→🚀 with map, unknown emoji drops colons; runs in bare Node.

---

## 10. P2 — Email render adapter

A generic inline-styled email renderer. **All EDodo branding (teal palette, fonts, footer identity, unsubscribe compliance, Resend transport) stays in the host.** The package owns mechanism + a neutral default transactional shell.

```ts
// src/lib/email.ts — new "./email" subpath in package.json exports
interface EmailStyleTokens {                 // EMAIL_STYLES-shaped theme bag (host injects)
  body: string; card: string; paragraph: string; heading: string;
  link: string; blockquote: string; code: string; pre: string;
  footer: string; footerText: string; [k: string]: string;
}
interface EmailShell { (content: string, footerHtml?: string): string; }  // doctype+meta+body+card+hr+footer slot
interface EmailRenderOptions {
  template?: "transactional" | "marketing" | "inline";   // default "transactional"
  theme?: EmailStyleTokens;                 // default = neutral built-in theme
  shells?: Partial<Record<"transactional"|"marketing"|"inline", EmailShell>>;
  footers?: Partial<Record<"transactional"|"marketing", string>>;  // per-template default footer HTML
  footerHtml?: string;                      // runtime per-recipient override (wins); NOT sanitized unless sanitizeFooter
  sanitizeFooter?: boolean;                 // default false (host-trusted, server-generated footer)
  plugins?: EdodoPlugin[];
  data?: Record<string, string>; fallbacks?: Record<string, string>;  // {{placeholder}} substitution
  plainText?: { preserveLineBreaks?: boolean };
}
function toEmailHtml(md: string, opts?: EmailRenderOptions): { subject?: string; html: string; text: string; markdown: string };
function createEmailRenderer(defaults: EmailRenderOptions): (md: string, opts?: EmailRenderOptions) => ReturnType<typeof toEmailHtml>;
```

**Mechanism the package owns (100% generic today in markdown-composer `email.js`):** a custom `marked.Renderer` that attaches a `style=""` per element from the theme bag; **clamps author headings to h2–h4** (`Math.min(Math.max(level,2),4)`); forces links `target="_blank" rel="noopener"`; **drops block code to a styled `<pre>`, drops tables to `''`, converts images to a link** (mail clients butcher these); passes `{{placeholder}}` through untouched; then **`sanitize-html`** (pure-JS, Turbopack-safe) with the restricted email allowlist:
```
tags: p h2 h3 h4 a strong em s ul ol li blockquote br hr code pre
attrs: a → [href target rel style title]; * → [style]
schemes: http https mailto tel (href only); disallowedTagsMode: discard
```
Never throws — falls back to an escaped `<p>`. The plain-text twin is `toPlainText(md, { preserveLineBreaks:true, plugins })` (§9).

**Injection seams:** `theme` (all colors/fonts/widths — EDodo passes teal `#0d9488`/system-transactional/Georgia-marketing), `shells` (host owns doctype/card if it wants; default built from theme), `footers` + runtime `footerHtml` (the primary branding seam — EDodo's identity line and per-recipient unsubscribe footer). The package must never contain `"EDodo"` or `edodo.app`.

```ts
// host
const render = createEmailRenderer({
  theme: BRAND_EMAIL_THEME,                                   // = today's EMAIL_STYLES
  footers: { transactional: EDODO_FOOTER, marketing: EDODO_FOOTER },
  plugins: [mentions(cfg), emoji(cfg)],
});
const { html, text, markdown } = render(bodyMd, {
  template: "marketing", data: placeholders, fallbacks,
  footerHtml: buildUnsubscribeFooterHtml(token),             // runtime override wins
});
```

**Acceptance:** transactional/marketing/inline shells; heading clamp; tables dropped; image→link; `{{name}}` substituted with fallback; injected `footerHtml` appears raw (unless `sanitizeFooter`); default theme renders with zero host config.

---

## 11. P2 — Configurable HTML ingest

Make `htmlToMarkdown` express the EDodo ingest config without forking. Today `edodo-write`'s serializer is fixed; markdown-composer's ingest has a strip-list + two custom turndown rules + GFM.

```ts
// src/lib/ingest.ts (or extend serialize.ts) — new "./ingest" subpath
interface IngestOptions {
  turndown?: Partial<TurndownServiceOptions>;   // defaults: headingStyle atx, bulletListMarker "-",
                                                //   codeBlockStyle fenced, emDelimiter "*", strongDelimiter "**",
                                                //   linkStyle inlined, hr "---"
  gfm?: boolean;                                // default true (@joplin/turndown-plugin-gfm)
  stripTags?: string[];                         // default ["head","script","style","iframe","noscript","object","embed"]
                                                //   → regex PRE-strip + td.remove() (dual defense; head document-special)
  rules?: Array<{ name: string; filter: TurndownFilter; replacement: TurndownRule["replacement"] }>;
  trim?: boolean;                               // default true; \n{3,}→\n\n normalization always applied
}
function createHtmlToMarkdown(opts?: IngestOptions): {
  htmlToMarkdown: (html: string, o?: { trim?: boolean }) => string;
  service: TurndownService;
};
// convenience predicate (app composes detect→convert itself; do NOT move normalizeBodyToMarkdown into the lib)
function looksLikeHtml(str: string): boolean;
```

Ship the two named custom rules markdown-composer relies on, as overridable exports: `emptyParagraphRule` (drop `<p>` with no text and no children — Word/Gmail spacers) and `brRule` (raw `<br>` outside tables → single soft `\n`, not turndown's hard `  \n`). Keep the **dual strip** (regex pre-strip + `td.remove()`) — deliberate defense-in-depth against DOM parsers surfacing tag contents — derived from one `stripTags` array (regex over all; `td.remove()` over the non-`head` subset). Keep the never-throw fallback (best-effort tag-strip) and singleton caching, but let `create…` mint isolated instances.

```ts
const { htmlToMarkdown } = createHtmlToMarkdown();   // EDodo's config is the default
export function normalizeBodyToMarkdown(input: string) {   // stays app-layer
  return looksLikeHtml(input) ? htmlToMarkdown(input) : input;
}
```

**Acceptance:** full-document ingest extracts `<body>`, drops `<head>`/`<title>`; GFM tables/strikethrough/task-lists; script/style/iframe/object/embed/noscript stripped (both defenses); `<br>`→`\n`; empty `<p>` dropped; `{ trim:false }` opt-out honored.

---

## 12. P2 — Remaining editor parity

Ship these as first-party plugins/props so a host wrapper can reach markdown-composer feature parity. Each is a paired parse+serialize plugin (round-trip contract) unless noted.

- **Footnotes plugin** (`src/plugins/footnote.ts`). Definition `[^id]: text` (line-anchored, 4-space/tab continuation), reference `[^id]`, numbered by definition order; unmatched ref → literal. Render ref `<sup class="ew-fn-ref"><a href="#…" id="…">{n}</a></sup>` and a trailing `<section class="ew-footnotes">`. `insertFootnote()` imperative. Round-trips to `[^id]`/`[^id]:`.
- **Collapsible toggle plugin** (`<details>`/`<summary>`, `insertDetailsBlock()`). Summary content renders inline markdown (`parseInline`). Preserve `data-md-block`/`data-md-open`/`data-md-empty` round-trip attrs; sanitizer allows `open` on `<details>`.
- **File/attachment token plugin** (`src/plugins/file.ts`). Exact stored form `!file[name](url)` (name may be **empty**: `[^\]]*`); render:
  ```html
  <a class="ew-file" href="{url}" data-file-name="{name}" data-file-url="{url}" target="_blank" rel="noopener noreferrer" contenteditable="false"><span class="ew-file-icon">📎</span>{name || url}</a>
  ```
  Plus optional unfurl sibling `!unfurl[title](url)` → `<a class="ew-unfurl">🔗 {title||url}</a>`. `insertFile(name,url)` imperative; `fetcher`/`uploader` injected by host (`imageUpload`/`fileUpload` configs with `uploader:(file)=>{url,name}`, size/accept defaults).
- **Math plugin** already exists (`math.ts`) — confirm `$…$`/`$$…$$` extraction-before-parse, `data-math-source` round-trip, `throwOnError:false`, and that KaTeX CSS is a documented consumer dependency.
- **Modes** (`source`/`split`/`preview`/`view`/`tabs`) + **`sourceDrawer`** + **`taskCheckboxes`/`onTaskToggle`** + **`dictation` render-slot** + **`editorRef`**: provide either the same prop surface on the React editor (`markdown-composer.jsx:129-164`) or a **headless API** (the LiveEditor imperative handle: `transformBlock`, `wrap`, `insertLink/Image/File/Table/CodeBlock/DetailsBlock/MathInline/MathBlock/Footnote`, `detectTrigger`/`replaceTrigger`, `saveCaret`/`restoreCaret`, `insertMarkdownAtCaret`, `undo`/`redo`) so a host can build those modes. `onTaskToggle(updatedMd, {index, checked})` must call `toggleTaskInMarkdown` (§8).
- **Markdown-snapshot undo/redo** (not native `contentEditable` undo): full-markdown snapshots + caret bookmarks, ~600ms coalescing, 200-entry cap, redo-tail truncation. Mandatory for any DOM-surgery WYSIWYG. `edodo-write` already abandons native undo (`editor.ts` history) — confirm parity.
- **Toolbar presets** matching markdown-composer names (`minimal/basic/email/tribe/rich/full`) with feature-gated button filtering (drop `mention`/`emoji`/`image`/`attach`/`source` when their feature is off), and a **slash menu** mapping to the same imperative calls.
- **Block drag-reorder handle** (`blockDrag`, Notion-style) in live mode.
- **`maxLength` guidance:** the editor does NOT enforce length; the host measures **stored markdown** length (`MAX_POST_LEN=20000`, `MAX_COMMENT_LEN=10000`, `MAX_DM_LEN=10000`). Requirement on the package: serialization must be **stable/canonical** so length checks are meaningful (idempotent round-trip).
- **Stable DOM hooks:** document a public, versioned set of classnames/`data-*` (`ew-content`, `ew-mention`, `ew-emoji`, `ew-file`, `data-mention-id`, `data-mc-ignore`-equivalent for non-serializing chrome) so hosts can target caret-scroll/focus/popovers without depending on private internals. Chrome that must **never** serialize (code toolbar, source drawer) carries a `data-*ignore` marker.

---

## 13. Cross-cutting

- **React 19 peer support + CI lane.** `peerDependencies: { react: "^18 || ^19", react-dom: "^18 || ^19" }`. Add a CI matrix lane running the render/hydration suite under React 19. No `findDOMNode`, no legacy context; deterministic render (§4.4).
- **ESM.** Ship real ESM with a subpath `exports` map: `.` , `./react`, `./plugins`, `./testing`, `./standalone`, and the new `./email`, `./ingest`, `./parse`. Generate `.d.ts` (`npm run build:types`) and point `types` at built declarations for every subpath — v0.6.5 currently ships **no** built `.d.ts`, which blocks typed host consumption. This is a required fix, not optional.
- **No-DOM guarantee.** `toHTML`, `renderMarkdownWithPlugins`, `createRenderCodec`, `toPlainText`, `toEmailHtml`, `htmlToMarkdown`, and the `./parse` API must all run in bare Node (Next.js server components, edge). Only the interactive editor and DOM enhancers require a DOM. Add a CI lane that imports the server surface in a **DOM-free** Node context and runs the sanitize/render/plaintext suites there.
- **Theming / CSS-var contract.** Expose the read-render styles as CSS custom properties on the `.ew-content` (and email-neutral) scope so hosts theme without overriding rules — e.g. `--ew-accent`, `--ew-mention-bg`, `--ew-code-bg`, plus a dark-mode signal (`.ew-dark` ancestor / `prefers-color-scheme`). EDodo maps these to its teal/dark tokens. Ship `edodo-write.css` and document that consumers must also load a highlight.js theme + `katex/dist/katex.css` (the package does not bundle them), matching markdown-composer's consumer contract.
- **Performance.** `createRenderCodec`/`createEmailRenderer` build the marked+turndown registry **once**; reuse across renders (don't rebuild per call as the lazy module parser does). Keep highlight.js **core-only** with an explicit language registry (js/ts/xml/css/python/json/bash/shell/markdown/sql/java/c/cpp/csharp/go/rust/php/ruby/yaml/diff/plaintext; unknown → `plaintext`) to keep public-page bundles small.

---

## 14. Compatibility & versioning

Every change is **additive and semver-minor**. No existing export changes signature; no behavior removed; nothing deprecated. `parseMarkdown(md)`/`toHTML(md)` with no plugins keep returning today's plain-GFM output — the only behavioral change is that in bare Node they now *sanitize* instead of leaking raw HTML (a security fix, strictly safer, not a breaking contract).

**Suggested roadmap:**

| Version | Contents |
|---|---|
| **0.7 — Security + render** | §3 no-DOM sanitizer + remove the `DOMParser`-undefined bypass; §4 `renderMarkdownWithPlugins` / `createRenderCodec` / `<Markdown plugins>`; ship `.d.ts` for all subpaths; DOM-free CI lane. |
| **0.8 — Mentions + emoji + insertText** | §5 `tags()` serialize/parse/render hooks + `allowBroadcast`; §6 `emoji()` plugin; §7 `insertText` command + method. |
| **0.9 — Parse + plaintext + email + ingest** | §8 `./parse` (splitter, `parseTokens`, `extractTokens`, `toggleTaskInMarkdown`); §9 `toPlainText`; §10 `./email`; §11 configurable `./ingest`. |
| **0.10 — Editor parity** | §12 footnote/toggle/file plugins, modes/sourceDrawer/dictation/editorRef, toolbar presets, block drag, stable DOM hooks; React 19 CI lane. |

---

## 15. Acceptance test matrix

Add these to `edodo-write`'s suite. Fixtures marked **EDODO** are the exact round-trip strings the host relies on.

| Item | Test | Fixtures |
|---|---|---|
| §3 sanitizer | Bare-Node: `toHTML` strips `<script>`, `on*`, `javascript:`; `data:` img-only; `sanitizeHtml` no throw | `# Hi\n\n<script>alert(1)</script>`, `<img src=x onerror=1>`, `[x](javascript:1)`, `![](data:image/png;base64,AAAA)` |
| §4 render==codec | `renderMarkdownWithPlugins(md,P)` === editor `getHTML()`; SSR string === hydrated `innerHTML` | full plugin corpus |
| §5 mentions | `assertRoundTrip` byte-stable; chip `data-*`; `resolveMention` relabels, token unchanged | **EDODO** `hi @[Alice](u_1) and @[channel](@channel)` |
| §6 emoji | `assertRoundTrip`; unknown passthrough; `data-shortcode` | **EDODO** `ship it :rocket: :+1: :nope:` |
| §7 insertText | caret vs append semantics; single undo; one change event | `"{{first_name}}"` |
| §8 parse | extractors skip code; `toggleTaskInMarkdown` index==DOM order; splitter join-invariant | ``` `@[x](y)` ```, `- [ ] a\n- [x] b`, `> - [ ] q` |
| §9 plaintext | `""`/`null`→`""`; `maxLength` incl. ellipsis; mention→`@Display`, emoji→glyph; tables dropped; bare Node | **EDODO** `# H\n\n@[Bob](u2) :tada:\n\n\| a \| b \|` @ 160 |
| §10 email | 3 shells; heading clamp h2–h4; tables dropped; image→link; `{{}}` sub; footer injection; default theme no-config | markdown with `#`, table, image, `{{name}}` |
| §11 ingest | body extract, `<head>` dropped; GFM; danger tags stripped (dual); `<br>`→`\n`; empty `<p>` dropped | Word/Gmail HTML paste |
| §12 footnote/toggle/file | `assertRoundTrip` each | **EDODO** `see[^1]\n\n[^1]: note`, `!file[report.pdf](https://r2/…)`, `!file[](https://r2/x)` (empty name), `<details data-md-open><summary>**S**</summary>body</details>` |

---

## 16. EDodo migration checklist (post-upgrade)

Once `edodo-write` ships 0.7–0.10, EDodo executes, in order:

1. **Add dep.** `edodo-write@^0.10` in `apps/web`; remove `@edodo/markdown-composer` from `package.json` **only after** step 8.
2. **Build the thin wrapper.** `apps/web/lib/edodo-write/` exporting the EDodo plugin presets + a `<Composer>` and `<Reader>` that wrap `EdodoWriteEditor` / `<Markdown>` with the standard plugin set and props.
3. **Register EDodo plugins:**
   - `mentions({ fetchUsers, resolveMention })` with `serialize: i => \`@[${i.display}](${i.id})\``, `parse.pattern = /@\[([^\]]+)\]\(([^)\s]+)\)/g`, `allowBroadcast: { id:"@channel", display:"channel" }`.
   - `emoji({ map: DEFAULT_EMOJI })` (the 187-entry map, kept host-side as the shared render+FTS contract).
   - `footnote()`, `detailsToggle()`, `file({ uploader })`, `math()`.
   - `createEmailRenderer({ theme: BRAND_EMAIL_THEME, footers: { transactional: EDODO_FOOTER, marketing: EDODO_FOOTER }, plugins })` — move today's `EMAIL_STYLES` into `BRAND_EMAIL_THEME`; keep `buildUnsubscribeFooterHtml` in the host passing `footerHtml`. Re-point `lib/lms/email-templates.js`'s drifted `STYLES`/`wrapWelcomeEmail` at the same theme (collapses the documented drift).
   - `createHtmlToMarkdown()` (defaults already match EDodo); keep `normalizeBodyToMarkdown`/`looksLikeHtml` app-side.
4. **Switch reads to the plugin-aware renderer.** Replace every `<Markdown>` / `markdownToHtml` call with `<Reader>` (`<Markdown plugins={EDODO_PLUGINS}>`) or `createRenderCodec(EDODO_PLUGINS).render(md)` in server components. Verify no crawler/SEO regressions (server-fetch pages still emit sanitized HTML + `sr-only` plaintext).
5. **Rebind server lifecycle.** Point `lib/tribe/service.js` (notifications/FTS/moderation), attachment GC, and `onTaskToggle` at `edodo-write/parse` (`extractTokens`+host wrappers, `toggleTaskInMarkdown`). Replace `extractPlainTextFromMarkdown` with `toPlainText(md, { plugins: EDODO_PLUGINS })`. Keep `validateContentLength` host-side.
6. **Switch SEO/excerpt sinks** (articles/notes/profile/books/paths/cards) to `toPlainText(md, { maxLength, plugins })`; the email `text` fallback to `{ preserveLineBreaks: true }`.
7. **Wire editor features:** dictation via the `editorApi` render-slot (`insertText`), `editorRef` for the placeholder sidebar, `onTaskToggle`, `sourceDrawer`, toolbar preset `tribe`/`email`/etc.
8. **Delete the old packages.** Remove `packages/markdown-composer/` and `packages/edutor/` (zero consumers since 2026-05-02) once the full test suite (incl. the byte-parity fixtures in §15) is green. Drop `@mdxeditor/editor` once Learning Paths migrate.
9. **Delete docs.** `docs/EDUTOR_GUIDE.md`, `docs/MARKDOWN_COMPOSER_GUIDE.md`.
10. **Update `CLAUDE.md`.** Replace the "Editors Quick Reference — Markdown Composer is the standard" section with "edodo-write is the standard"; fix the stale `markdownToEmailHtml` / `lib/email/markdown-to-email.js` pointer (that file does not exist — the real entry is `renderMarkdownEmail` in `apps/web/lib/email/render-markdown.js`, which post-migration wraps `createEmailRenderer`); update the AI-builder/render-target notes and the Documentation Pointers table.