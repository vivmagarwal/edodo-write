# Markdown support & shortcuts

Markdown is the source of truth. Everything you type is rendered live and
serialised back to GFM Markdown on every change.

## Type-to-format (input rules)

Type these at the **start of a line** — the trailing space triggers the
transform:

| Type | Becomes |
|---|---|
| `# ` | Heading 1 |
| `## ` | Heading 2 |
| `### ` | Heading 3 |
| `- ` or `* ` | Bulleted list |
| `1. ` | Numbered list |
| `[ ] ` | To-do item (unchecked) |
| `[x] ` | To-do item (checked) |
| `> ` | Blockquote |
| `` ``` `` then space | Code block |
| `--- ` | Divider (horizontal rule) |

Inline marks fire as you close the delimiter, mid-line:

| Type | Becomes |
|---|---|
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `` `code` `` | `code` |
| `~~strike~~` | ~~strike~~ |

## Slash menu

On an empty line, press `/` to open the block picker. Type to filter, `↑`/`↓`
to move, `Enter` to insert, `Esc` to dismiss. Blocks: Text, Heading 1–3,
Bulleted list, Numbered list, To-do list, Quote, Code, Divider.

## Floating toolbar

Select text to reveal a toolbar with Bold, Italic, Strikethrough, Inline code,
Link, Heading 1/2 and Quote.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `⌘/Ctrl + B` | Bold |
| `⌘/Ctrl + I` | Italic |
| `⌘/Ctrl + Shift + E` | Inline code |
| `⌘/Ctrl + K` | Link (prompts for URL) |
| `⌘/Ctrl + Shift + 8` | Bulleted list |
| `⌘/Ctrl + Shift + 7` | Numbered list |
| `⌘/Ctrl + Shift + 9` | To-do list |
| `⌘/Ctrl + Z` | Undo |
| `⌘/Ctrl + Shift + Z` / `⌘/Ctrl + Y` | Redo |
| `Tab` / `Shift + Tab` | Indent / outdent a list item |
| `Shift + Enter` | Soft line break within a block |
| `Enter` (at end of a heading) | New paragraph (not another heading) |
| `Enter` (in an empty list item) | Exit the list |
| `Enter` (in a code block) | New line (not a new block) |
| `Backspace` (start of heading/quote) | Convert to paragraph |
| `Backspace` (start of paragraph) | Merge into the previous block |

## Copy, paste & drag

- **Copy / cut** put the selection on the clipboard as **Markdown** (and rich
  HTML), so pasting into any text field yields Markdown and pasting into Docs/
  Word yields formatting.
- **Paste** parses Markdown (or converts pasted rich HTML to Markdown) and
  inserts it as real blocks — splitting the current block where needed.
- **Drag** a block by the `⣿` grip in the hover gutter to reorder it.

## Serialised Markdown

Output is **GitHub-Flavored Markdown**:

- ATX headings (`#`), `-` bullets, `1.` ordered lists.
- Fenced code blocks (```` ``` ````).
- Task lists (`- [ ]` / `- [x]`).
- Tables, strikethrough (`~~`), links, images.

Task-list checkboxes are interactive in the editor; ticking one updates the
Markdown from `[ ]` to `[x]`.

## Notes & limits (v0.x)

- Underline has no Markdown equivalent and is intentionally not offered.
- Pasting inserts plain text (Markdown you paste is still picked up by the input
  rules as you continue typing). Rich HTML→Markdown paste is planned.
- Nested-list depth changes use Tab/Shift-Tab via the browser's native list
  behaviour.
