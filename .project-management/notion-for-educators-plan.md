# edodo-write — "Notion for educators" — Plan

<!-- HOT — rewrite in place, keep ≤15 lines. A fresh context reads this FIRST. -->
## Status
- **State:** 🟨 IN PROGRESS — started 2026-08-29 from the Tribe audit in
  `../edodo_app` (its plan: `.project-management/tribe-polish-plan.md`).
- **Phase/Task:** Phase 1 (fixes the app already needs) in progress.
- **Last updated:** 2026-08-29
- **Resume:** `npm ci` if node_modules is missing; `npx vitest run`,
  `npm run typecheck`, `npx playwright test` (Chromium via Vite :5283) are the
  three gates (docs/DEVELOPMENT.md). Release: bump version → CHANGELOG →
  `bash scripts/publish.sh` (token in ../edodo-draw/.env) → bump
  `edodo-write` in ../edodo_app. The consumer that drives priorities is the
  Tribe composer (`../edodo_app/features/tribe/composer-plugins.ts`) and the
  LMS/CMS markdown editor (`components/admin/content/markdown-editor.tsx`).
- **Uncommitted:** none between tasks — commit at every task boundary.

## Mission
- **What:** Make edodo-write the editor an educator reaches for — Notion's
  feel (type-to-format, slash blocks, drag, toggles, callouts, tables, media,
  math) with chat-composer ergonomics for Tribe — and make it boringly
  reliable: every host-visible defect found in the app gets fixed HERE, with
  a test that was red first.
- **Why:** The user's directive (2026-08-29): "make our edodo write Notion for
  educators … robust, reliable, maintainable." The Tribe polish had to work
  around three package defects in the app; that is the wrong layer.
- **Done means:**
  1. Phase 1 shipped to npm and consumed by edodo_app: emoji no longer breaks
     GFM autolinks; @mentions can span one space; Enter-to-submit is a core
     option (Tribe drops its plugin + DOM-event shim); the hard-break-before-
     list serializer edge is fixed.
  2. Phase 2: a browser audit of the playground (real key events, not
     `playwright-cli type`) produces a findings table like the Tribe one, and
     the top items are fixed with e2e coverage.
  3. Docs (INTEGRATION_GUIDE, FIRST_PARTY_PLUGINS, MARKDOWN_AND_SHORTCUTS,
     CHANGELOG) describe every new option; `tests/docs-examples.test.ts`
     executes the examples.

## Decisions
| # | Date | Decision | Why |
|---|------|----------|-----|
| E1 | 2026-08-29 | Enter-to-submit lives in the CORE (`submitOn: "enter" \| "mod-enter" \| false`, `onSubmit`) at keymap tier 1.5 — after plugin bindings, before the structural Enter engine; Shift+Enter is always a soft break; Enter keeps its structural meaning inside `li` and `pre`; IME-composing Enter never submits | Hosts (Tribe) had to reimplement this as a priority −10 plugin bubbling a DOM event because the plugin config is frozen and cannot hold a React closure. Chat semantics are a first-class composer need (RFC 0001 §12) |
| E2 | 2026-08-29 | `tags({ allowSpaces })` — the query may contain up to N spaces while the source still returns matches; the menu closes on the first space that yields nothing | Slack completes "@QA Bob" typed in full; today the token closes at the first space |
| E3 | 2026-08-29 | The emoji marked extension's `start` only stops at a `:` that begins a plausible shortcode (`:[a-z0-9_+-]+:`) | `src.indexOf(":")` halted the inline lexer inside `https:`, so any codec with `emoji()` lost GFM autolinks (verified in Node from the app) |

## Gotchas discovered
- The "`- ` fast-typing race" reported from the app was NOT real: real key
  events (keyboard.type 0 ms, pressSequentially, insertText) all convert; only
  `playwright-cli type` breaks input rules. Never test contenteditable with it.

## Phases

### Phase 1 — Fixes the app already needs
| # | Task | Verify | Status | Notes |
|---|------|--------|--------|-------|
| 1 | Emoji `start` hook (E3) + unit test: autolink survives with `emoji()` in the codec | vitest red→green | ✅ | src/plugins/emoji.ts `startRe`; tests/emoji.test.ts |
| 2 | `tags({ allowSpaces })` (E2) + e2e (menu stays open across "QA B", closes on a non-matching space) | playwright red→green | ✅ | tags.ts triggerRe; fixture `people` plugin; tags.spec.ts |
| 3 | Core `submitOn`/`onSubmit` (E1) + unit + e2e (Enter submits; Shift+Enter breaks; li/pre keep Enter; menu Enter wins) | vitest + playwright | ✅ | keymap tier 1.5 + `fireSubmit` flushes the debounced change; React `onSubmit`; keymap.test + composer.spec |
| 4 | Serializer: a ZWSP before a block marker defeated turndown's line-start escape → paragraph line reloaded as a list | roundtrip test | ✅ | `stripCaretFurniture` before turndown (serialize.ts); serialize.test |
| 5 | Docs + CHANGELOG + version bump → publish 0.10.0 → bump in edodo_app, delete the Tribe shim, walk locally + prod | both repos green | ⬜ | |

### Phase 2 — The educator's editor (audit-driven)
| # | Task | Verify | Status | Notes |
|---|------|--------|--------|-------|
| 1 | Browser audit of the playground with real key events: slash menu, drag, toggles, callouts, tables, images, math, paste from Docs/Word, mobile | findings table | ⬜ | |
| 2 | Fix the top findings, each with a red-first test | | ⬜ | |

## Verification ladder
1. `npx vitest run` · 2. `npm run typecheck` · 3. `npx playwright test` ·
4. `bash scripts/publish.sh --dry-run` · 5. consume in edodo_app: check +
tribe e2e + browser walk · 6. prod walk.

## Progress log
<!-- newest first, ≤8 lines/entry -->

### 2026-08-29 00:15 — Phase 1 tasks 1–4 done, gates green
- 760 vitest (incl. executed doc examples) + 195 Playwright journeys green.
  Version 0.10.0, CHANGELOG written. Next: publish, bump edodo_app, delete
  the Tribe shim, walk locally + prod.

### 2026-08-29 — Plan created
- Scope set from the Tribe audit; the list-race retracted after a real-key
  repro. Starting Phase 1 with the emoji autolink fix.
