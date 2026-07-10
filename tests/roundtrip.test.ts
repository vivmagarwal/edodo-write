import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@core/parse";
import { htmlToMarkdown } from "@core/serialize";

/** Markdown → HTML → Markdown should be stable for well-formed input. */
function roundtrip(md: string): string {
  return htmlToMarkdown(parseMarkdown(md));
}

describe("markdown round-trip stability", () => {
  const cases: Array<[string, string]> = [
    ["heading", "# Title"],
    ["paragraph", "Just a line of text."],
    ["bold + italic", "This is **bold** and *italic*."],
    ["inline code", "Use `npm i edodo-write` to install."],
    ["strikethrough", "That was ~~wrong~~ right."],
    ["link", "See [the repo](https://github.com/vivmagarwal/edodo-write)."],
    ["bullet list", "- one\n- two\n- three"],
    ["ordered list", "1. one\n2. two\n3. three"],
    ["blockquote", "> a wise quote"],
    ["code block", "```\nconst x = 1;\n```"],
    ["divider", "above\n\n---\n\nbelow"],
    ["task list", "- [ ] todo\n- [x] done"],
  ];

  for (const [name, md] of cases) {
    it(`is stable for: ${name}`, () => {
      expect(roundtrip(md)).toBe(md);
    });
  }

  it("is idempotent across two passes for a mixed document", () => {
    const md = [
      "# edodo-write",
      "",
      "A **Markdown-native** editor.",
      "",
      "- [x] round-trips",
      "- [ ] ships",
      "",
      "> Markdown is the contract.",
    ].join("\n");
    const once = roundtrip(md);
    const twice = roundtrip(once);
    expect(twice).toBe(once);
  });
});
