# Extending

edodo-write is small and hackable. Common extensions:

## Add a Markdown input rule

Block rules live in `src/core/input-rules.ts` (`BLOCK_RULES`); inline rules in
`INLINE_RULES`. To add a block rule, add a `{ re, cmd }` entry whose regex
matches the normalised trigger text (trailing space included), and make sure the
command exists in `applyCommand`.

```ts
// e.g. a callout via ">> "
{ re: /^>> $/, cmd: "blockquote" }
```

## Add a command

Extend the `Command` union in `src/core/types.ts`, add a `case` in
`applyCommand` (`src/core/commands.ts`), and — if it's a block transform — build
it with manual DOM (see the existing `toList` / `setBlock`; avoid `execCommand`
for structure so it works inside input rules). Add it to the slash menu
(`src/core/slash-menu.ts`) and/or the toolbar (`src/core/toolbar.ts`) to surface
it in the UI.

## Add a slash-menu item

Append to `ITEMS` in `src/core/slash-menu.ts`:

```ts
{ title: "Callout", cmd: "blockquote", hint: "Highlighted note", keys: ["callout", "note", "aside"] }
```

## Customise the look

Every color is a CSS variable on `.ew` (`--ew-fg`, `--ew-bg`, `--ew-accent`,
`--ew-code-bg`, …) and the reading width is `--ew-content-width`. Override them
in your own stylesheet, or restyle `.ew-content`, `.ew-toolbar`, `.ew-slash`
directly.

## Change Enter/Backspace or clipboard behaviour

- **Keys** — `src/core/keymap.ts` owns Enter/Backspace/Tab and the shortcut map.
  Enter/Backspace are implemented as manual DOM splits/merges (`splitBlock`,
  `mergeWithPrevious`, `exitList`, …); follow those patterns and always leave the
  block model clean (proper block tags, a `<br>` in empty blocks — use
  `ensureNotEmpty`). See the "contentEditable rules" in
  [DEVELOPMENT.md](DEVELOPMENT.md).
- **Clipboard** — `src/core/clipboard.ts`. `handleCopyCut` decides what goes on
  the clipboard; `insertMarkdown` decides how pasted content lands. Both are pure
  DOM + the parse/serialize pipeline.
- **Drag handles** — `src/core/block-handles.ts` (hover gutter + pointer drag).

## Change Markdown flavour

Parsing is `marked` (`src/core/parse.ts`); serialising is `turndown` +
`@joplin/turndown-plugin-gfm` (`src/core/serialize.ts`). Adjust the `marked`
options or add `turndown` rules there. Keep the two in sync so the round-trip
stays stable — the `tests/roundtrip.test.ts` suite guards this.

## Tests

- `npm test` — Vitest (jsdom): parse/serialize/round-trip/sanitize + editor
  lifecycle + execCommand-free DOM paths.
- `npm run typecheck` — must stay at zero errors.
- Interactive `execCommand`/selection behaviour: run `npm run dev` and drive the
  playground in a real browser.
