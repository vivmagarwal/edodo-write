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

- Type \`## \` at the start of a line for a heading
- Type \`- \` for a bullet, \`1. \` for a number, \`[ ] \` for a to-do
- Type \`> \` for a quote, \`\`\`\` for a code block, \`--- \` for a divider
- Select some text to get a **floating toolbar**
- On an empty line, press \`/\` for the **slash menu**

Everything you write round-trips to clean Markdown — watch the panel on the right.`,
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
