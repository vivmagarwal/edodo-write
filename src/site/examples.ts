export interface Example {
  id: string;
  label: string;
  markdown: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "welcome",
    label: "Welcome",
    markdown: `# Welcome to edodo-write ✎

A **Notion / Medium**-style editor whose single source of truth is _Markdown_.

Try it:

- Type \`## \` for a heading, \`- \` for a bullet, \`1. \` for a number, \`[ ] \` for a to-do
- Type \`> \` for a quote, three backticks for an instant code block, \`---\` for an instant divider
- On an empty line, press \`/\` — the menu has group headers and accepts spaces (\`/heading 1\` works)
- Select some text for the **floating toolbar**; \`⌘/Ctrl+K\` opens the **link popover** (click any link to edit it)
- **Hover** a block: drag the \`⣿\` grip to reorder, or **click** it for Turn into, Duplicate, Copy as Markdown, Delete
- Type \`==text==\` to ==highlight== it, or \`> [!note] \` for a callout — both from \`edodo-write/plugins\`
- Type \`:\` plus two letters — \`:rock\` — for **emoji autocomplete** :rocket: and \`@\`/\`#\` for mentions and topics
- Switch to the **💬 Composer** tab up top: the same editor as a Slack-style chat box (\`layout: "fill"\`, fixed toolbar)
- **Paste** Markdown and it renders as blocks; **copy** and you get Markdown back
- **Paste or drop an image** and it uploads (configurable) or embeds — \`/image\` also offers Upload and URL
- Click **below the last block** to start a new paragraph; select-all then type replaces the whole document
- \`⌘/Ctrl+Z\` undo, \`⌘/Ctrl+⇧Z\` redo, \`Tab\`/\`Shift+Tab\` to indent lists

Everything you write round-trips to clean Markdown — watch the panel on the right.`,
  },
  {
    id: "plugins",
    label: "Plugins",
    markdown: `# Plugins

This demo registers the two first-party plugins from \`edodo-write/plugins\`:

\`\`\`js
import { highlight, callout } from "edodo-write/plugins";
new EdodoWrite(host, { plugins: [highlight(), callout()] });
\`\`\`

## Highlight

Wrap text in double equals to ==highlight== it. Or select some text and press \`⌘/Ctrl+⇧H\` — the floating toolbar gains an **H** button too. It serialises as \`==text==\`.

## Callout

> [!NOTE]
> Callouts are stored as GitHub alert syntax, so this block renders natively on GitHub and degrades to a plain quote everywhere else.

> [!WARNING]
> Type \`> \` then \`[!warning] \` to make one, or pick **Callout** from the slash menu.

Both are ordinary plugins built on the public API — check the Markdown panel to see exactly what they store.`,
  },
  {
    id: "formatting",
    label: "Formatting",
    markdown: `## Inline formatting

You can make text **bold**, *italic*, ~~struck through~~, or \`inline code\`.
Add [links](https://github.com/vivmagarwal/edodo-write) too.

> Blockquotes are great for pulling out an idea.

1. Ordered lists
2. keep their
3. numbering

- Bulleted lists
- are simple
  - and nest`,
  },
  {
    id: "tasks",
    label: "To-do list",
    markdown: `## Launch checklist

- [x] Write the core editor
- [x] Round-trip Markdown
- [ ] Ship v0.1.0
- [ ] Tell everyone

Click a checkbox above — the Markdown updates from \`[ ]\` to \`[x]\`.`,
  },
  {
    id: "code",
    label: "Code",
    markdown: `## Code blocks

Fenced code is preserved verbatim:

\`\`\`js
export function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

Press Enter inside a code block for a newline (not a new paragraph).`,
  },
  {
    id: "powerups",
    label: "Power-ups",
    markdown: `# Power-ups

Everything below is **pure Markdown** — check the panel on the right.

## Diagrams (edodo-draw)

\`\`\`edd
scene {
  rect  md   "Markdown"      { fill: yellow }
  round-rect ed "edodo-write" { fill: blue }
  ellipse    us "Your app"    { fill: green }
  md --> ed --> us
}
\`\`\`

Click the diagram to edit its source. Mermaid fences render through the same
engine.

## Math

Inline $E = mc^2$ and blocks:

$$
x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}
$$

## Tables

Type \`/table\`, then Tab through cells — Tab at the end adds a row; the block
menu (click the grip) adds and removes rows and columns.

| Feature | Stored as |
| --- | --- |
| Diagrams | \`\`\`edd fences |
| Math | $…$ / $$…$$ |
| Tags | plain links |

## Tags

Type \`#\` for topics and \`@\` for people or bots — two instances of the same
plugin, each with its own source:
[#roadmap](https://github.com/vivmagarwal/edodo-write/issues) [@vivek](https://github.com/vivmagarwal) [@dodo-bot](https://github.com/vivmagarwal/edodo-write)

## Embeds

A bare URL on its own line becomes a media card:

https://www.youtube.com/watch?v=dQw4w9WgXcQ`,
  },
  {
    id: "extras",
    label: "Emoji & extras",
    markdown: `# Emoji, footnotes, files, toggles

## Emoji

Type \`:\` plus two or more letters — \`:rock\` — and pick from the menu. Zero
config: the built-in map covers the gemoji-standard names, stored as plain
text tokens. :rocket: :tada: :fire: :heart_eyes:

Unknown codes survive verbatim (\`:nope:\`), and \`12:30:45\` is never hijacked.

## Footnotes

Markdown footnotes round-trip[^1] and renumber as you write[^2].

[^1]: The reference and the definition stay linked.

[^2]: Stored as standard \`[^id]\` syntax.

## File attachments

A file token renders as a chip — click it to open:

!file[edodo-write-spec.pdf](https://github.com/vivmagarwal/edodo-write/raw/master/README.md)

## Collapsible toggle

<details><summary>**Click to expand** — stored as native HTML</summary>

GitHub renders \`<details>\` natively, so this degrades to a working toggle
everywhere. The summary renders inline Markdown; the body renders blocks.

</details>`,
  },
  {
    id: "article",
    label: "Article",
    markdown: `# The case for Markdown-native editing

Rich text editors usually store their own bespoke JSON. That's fine — until you
need to diff it, grep it, feed it to an LLM, or move it somewhere else.

## Markdown as the contract

edodo-write keeps **Markdown** as the value. The rich surface is just a *view*;
the bytes you save are portable, human-readable, and version-control friendly.

> If you can read the file, you own the file.

That's the whole idea.`,
  },
];
