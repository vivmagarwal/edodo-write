# Changelog

All notable changes to `edodo-write` are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## 0.9.0

Composer ergonomics: everything needed to drop the editor into a comment box
or chat input instead of a full page.

### Added

- **`layout: "page" | "fill"`** (+ runtime `setLayout()`) — `"fill"` stretches
  the editor to its host's full width and height (flex column, internal
  scroll), dropping the document-page opinions (centered `max-width` column,
  `40vh` bottom pad) that made embedded composers look broken. `"page"`
  (default) is unchanged.
- **Fixed toolbar** — `toolbar: "fixed"` (or `{ mode: "fixed", items: [...] }`)
  docks a persistent, Slack-style formatting bar above the content. It reflects
  formatting at the caret (no selection needed), draws from the same registry
  as the floating bar (plugin items appear automatically), disables itself in
  read-only mode, and is switchable at runtime via `setToolbar()`. The object
  form picks and orders the buttons; it trims the floating bar too.
- **Toolbar registry additions** — `bulletList`, `orderedList`, and `codeBlock`
  buttons (both toolbar modes).
- **Emoji autocomplete** — typing `:` + two or more characters opens a filtered
  shortcode menu (up/down navigate, Enter/Tab/click insert, Escape dismisses;
  never in code blocks or mid-word). Fills the `autocomplete` option `emoji()`
  reserved in 0.8.0.
- **`defaultEmojiMap`** — `emoji()` now works with zero config: a curated
  built-in map (~500 gemoji-standard names) exported from
  `edodo-write/plugins`; replace it or spread-extend it with custom emoji.

### Fixed (13 findings from the pre-release adversarial review)

- **Key dispatch ignores IME composition** (engine-wide): Firefox/Safari
  deliver real keys with `isComposing` during composition; Enter could split a
  block (or commit a menu pick) under an active composition. Keydown dispatch
  now skips composing events — the same contract input rules always followed.
- **Suggestion menus (emoji AND tags) read LINE-local trigger text** — they now
  open at the start of any list item and after soft line breaks (block-level
  text concatenated sibling items with no separator, so the `(^|\s)` guard
  refused everywhere but the first).
- **Menu picks consume the whole token** — picking with the caret moved inside
  the query no longer strands leftover query text after the chip, and the rows
  refilter as the caret moves within the token.
- **Fill layout + inner scroll**: block handles and table pills hide when the
  content scrolls (a stale handle acted on the wrong block); the slash menu and
  floating toolbar dismiss too; absolute chrome is clipped to the composer box;
  the docked toolbar stacks above hover chrome; the handle gutter is wide
  enough for the handle again.
- **Emoji menu rows** render as buttons (no horizontal clipping) with the glyph
  beside its name instead of pushed to opposite edges.
- **Lifecycle**: a reused host no longer inherits the previous editor's fill
  class (constructor toggles; destroy cleans up); `setToolbar`/`setLayout`
  after `destroy()` are safe no-ops; `setToolbar` syncs the new bar with the
  live selection immediately.

### Changed

- `spanBeforeCaret` moved to the shared DOM helpers (used by both the tags and
  emoji suggestion menus) — no behavior change.

## 0.8.0

Markdown-composer parity release: the framework-agnostic core gains the
server-safe rendering, plugin, and adapter surface a host CMS needs, plus a
security hardening of the default render path.

### Added

- **DOM-free sanitizer** — `sanitizeHtml` / `toHTML` tokenize with `htmlparser2`
  and re-serialize with `dom-serializer`, so they produce identical, sanitized
  output in the browser, in jsdom, and in bare Node / edge / Next.js server
  components (no DOM required). Plugins may additively widen the allow-list; the
  denial floor (scripts, iframes, event handlers, script-scheme URLs) is not
  negotiable.
- **Plugin-aware render** — `toHTML` runs the plugin markdown pipeline (marked
  extensions) so first-party and host plugins render server-side too.
- **Mentions / tags custom-token seam** — `tags()` gains a token mode: supply
  `serialize` + `parse` (and optionally `render`, `resolveMention`,
  `allowBroadcast`) to store a first-class mention token (e.g. `@[Display](id)`)
  that round-trips byte-stable, relabels deleted accounts at render time, and is
  now emitted directly when a suggestion is picked from the autocomplete menu.
- **Emoji plugin** — `:shortcode:` → glyph, with a host-supplied map.
- **`insertText` command** — programmatic caret-position text insertion.
- **Parse API** (`edodo-write/parse`) — a standalone, plugin-aware
  Markdown → sanitized HTML function for read-only render targets.
- **`toPlainText`** — Node-safe, plugin-aware Markdown → plain text for SEO
  `<meta>` descriptions, JSON-LD, OG/Twitter cards, list excerpts, and the email
  plain-text twin.
- **Email adapter** (`edodo-write/email`) — inline-styled, mail-client-safe HTML
  (+ a plain-text twin) from Markdown, with an injectable theme/shell/footer and
  its own restricted DOM-free sanitizer.
- **Ingest adapter** (`edodo-write/ingest`) — HTML/paste → Markdown normalization.
- **New plugins** — `footnote()` (`[^id]` references + definitions),
  `file()` (attachment / unfurl chips), and `detailsToggle()` (collapsible
  `<details>`).

### Changed

- **Security-positive behavior change:** on the server / in bare Node (no
  `DOMParser`), `toHTML` and `<Markdown>` now **sanitize by default**. Previously,
  with no DOM present, they returned **raw, unsanitized HTML**. Any server code
  that relied on receiving raw HTML from these APIs will now receive sanitized
  HTML. This is the intended, safer default and matches browser behavior.

### Fixed

- **mXSS comment-node bypass** — the sanitizer now **drops** comment, directive,
  CDATA, and processing-instruction nodes (only elements and text survive),
  mirroring DOMPurify. `htmlparser2` does not honor the HTML5 `--!>` "abrupt
  closing" comment terminator, so a payload like
  `<!--a--!><img src=x onerror=alert(1)>` was swallowed as one comment node and,
  when re-serialized and re-parsed by a browser, could revive a live
  `<img onerror>`. Refusing to re-emit any comment node closes that seam.
- **`toPlainText` surrogate split** — truncation no longer emits a lone high
  surrogate when a length cut falls inside an astral character (emoji).
- **Footnotes** — when an id is defined twice, the **first** definition body is
  kept (GitHub behavior), not the last.
