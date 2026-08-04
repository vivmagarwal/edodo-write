# Changelog

All notable changes to `edodo-write` are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## 0.9.3

### Fixed

- **The caret-in-view fix missed the case that prompted it.** 0.9.2 hooked
  only `handleInput`, which is TYPING. Enter, Backspace, paste and commands
  are structural and arrive at `afterMutation` instead — so pressing Enter
  at the end of a document, the exact reported case, still left the caret on
  the bottom edge. Both funnels now keep the caret in view. Measured in a
  real embedded editor: two Enters at the end of a long document leave 56px
  of visible space below the caret instead of 22px.

## 0.9.2

The caret stays comfortably on screen.

### Fixed

- **Writing at the end of a document happened on the last visible pixel
  row.** Browsers scroll a caret into view only just, so in an EMBEDDED
  editor — one given a fixed box by its host, with no document-length bottom
  padding to hide behind — the line being typed ended flush against the
  bottom edge with nothing beneath it. Pressing Enter there gave no sense of
  anywhere to go. Reported by an app embedding the editor: "when I move to
  the last line and press Enter … the whole thing should scroll up so that
  the user always sees the cursor and also a few more new lines below that."

  Two halves, because either alone leaves a gap:
  - `keepCaretInView` (exported from `src/core/ui.ts`) runs after every
    input, once the DOM has settled — an Enter that created a block has only
    just changed the document height. It pushes the caret away from whichever
    edge it is near, and never asks a short box for more room than it has.
  - the fill layout's content now carries real bottom padding (5rem, tunable
    with `--ew-fill-bottom-pad`) plus `scroll-padding`, so there is somewhere
    to scroll TO and browsers that honour scroll-padding do the right thing
    natively.

  Page layout is untouched: its content is not its own scroller and its 40vh
  bottom padding already solved this.

## 0.9.1

Floating panels stay on screen.

### Fixed

- **The slash menu opened off-screen near the bottom of the window.** Its
  positioner clamped horizontally but not vertically: it always dropped out of
  the caret, so when the caret sat low in the viewport a 320px menu was written
  out below the fold and simply appeared not to open. This is the ordinary case
  rather than an exotic one — an editor pane of fixed height usually ends at
  the fold, and `/` is reached for on the last line more than anywhere else.
  The menu now flips above the caret when it will not fit below.
- **The selection toolbar had the mirror-image bug** — selecting text on the
  first line of a document positioned it off the top edge. It now drops below
  the selection instead.
- One positioner for every floating panel (`position` in `src/core/ui.ts`,
  now exported), flipping in both directions and clamping into the viewport
  when neither side fits. It replaces three near-duplicates that each got a
  different subset of this right. The slash menu also reveals itself *before*
  measuring — a `display: none` element reports 0×0, which is why the old code
  had to hard-code its width and could not reason about its height at all.

### Documented

- **`--ew-bg` must be opaque.** The writing surface paints no background of
  its own, so this token is read only by chrome that floats over text (slash
  menu, popovers, drag ghost, table handles, docked toolbar). An embedder that
  sets it to `transparent` to "blend into my form" changes nothing about the
  writing area and instead makes every one of those panels see-through. Theme
  it to your popover surface. Noted in `src/styles.css` beside the token.

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
