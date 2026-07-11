# Changelog

All notable changes to `edodo-write` are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

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
