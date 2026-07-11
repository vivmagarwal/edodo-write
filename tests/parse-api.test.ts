// @vitest-environment node
//
// RFC §8 — the content-lifecycle parse/visitor API must run with NO DOM
// present (Next.js server components / edge / bare Node). This file forces the
// node environment so it also proves the no-DOM guarantee.

import { describe, it, expect } from "vitest";
import {
  splitCodeSegments,
  stripCodeBlocks,
  markCodeLines,
  extractTokens,
  toggleTaskInMarkdown,
  parseTokens,
  TASK_LINE_RE,
  type TokenNode,
} from "edodo-write/parse";
import { emoji, tags } from "edodo-write/plugins";

const MENTION = /@\[([^\]]+)\]\(([^)\s]+)\)/g;

describe("no-DOM guarantee", () => {
  it("runs without a DOM", () => {
    expect(typeof (globalThis as any).document).toBe("undefined");
    expect(typeof (globalThis as any).DOMParser).toBe("undefined");
  });
});

describe("splitCodeSegments — join invariant", () => {
  const corpus = [
    "",
    "plain text with no code",
    "a `inline` b",
    "```\nfenced\n```",
    "before\n```js\ncode @[x](y)\n```\nafter",
    "mix `a` and ```\nb\n``` and `c`",
    "unterminated ` backtick stays literal",
    "~~~\ntilde fence\n~~~",
    "nested ``a `b` c`` span",
    "  ```\n  indented fence up to 3\n  ```",
    "line1\nline2 `x`\nline3",
    "@[Alice](u_1) `@[Bob](u_2)` @[channel](@channel)",
  ];
  it("parts.map(p=>p.text).join('') === md for every fixture", () => {
    for (const md of corpus) {
      const joined = splitCodeSegments(md)
        .map((p) => p.text)
        .join("");
      expect(joined).toBe(md);
    }
  });
  it("marks fenced and inline regions as code", () => {
    const parts = splitCodeSegments("a `x` b");
    const codeText = parts.filter((p) => p.code).map((p) => p.text).join("");
    expect(codeText).toBe("`x`");
  });
});

describe("stripCodeBlocks", () => {
  it("blanks code chars, preserves length and newlines", () => {
    const md = "hi `secret` bye\n```\nblock\n```\nend";
    const out = stripCodeBlocks(md);
    expect(out.length).toBe(md.length);
    expect(out.split("\n").length).toBe(md.split("\n").length);
    expect(out).not.toContain("secret");
    expect(out).not.toContain("block");
    expect(out).toContain("hi");
    expect(out).toContain("bye");
    expect(out).toContain("end");
  });
});

describe("markCodeLines", () => {
  it("flags fenced-block lines, not inline-code lines", () => {
    const md = "para `x`\n```\ncode\n```\ntail";
    const flags = markCodeLines(md);
    expect(flags.length).toBe(md.split("\n").length);
    expect(flags).toEqual([false, true, true, true, false]);
  });
});

describe("extractTokens — code-skipping", () => {
  it("skips tokens inside inline code and fenced blocks", () => {
    const md = [
      "hi @[Alice](u_1) there",
      "`@[Inline](u_x)` should be skipped",
      "```",
      "@[Fenced](u_y) skipped too",
      "```",
      "and @[Bob](u_2) at the end",
    ].join("\n");
    const rows = extractTokens(md, MENTION, (m) => ({ display: m[1], id: m[2] }));
    expect(rows).toEqual([
      { display: "Alice", id: "u_1" },
      { display: "Bob", id: "u_2" },
    ]);
  });
  it("accepts a non-global pattern and upgrades it", () => {
    const rows = extractTokens("@[A](1) @[B](2)", /@\[([^\]]+)\]\(([^)\s]+)\)/, (m) => m[2]);
    expect(rows).toEqual(["1", "2"]);
  });
  it("handles the @channel broadcast id", () => {
    const rows = extractTokens("ping @[channel](@channel)", MENTION, (m) => ({ id: m[2] }));
    expect(rows).toEqual([{ id: "@channel" }]);
  });
});

describe("toggleTaskInMarkdown — DOM-order index parity", () => {
  const md = "- [ ] a\n- [x] b\n- [ ] c";
  it("flips the Nth checkbox to an absolute state", () => {
    expect(toggleTaskInMarkdown(md, 0, true)).toBe("- [x] a\n- [x] b\n- [ ] c");
    expect(toggleTaskInMarkdown(md, 1, false)).toBe("- [ ] a\n- [ ] b\n- [ ] c");
    expect(toggleTaskInMarkdown(md, 2, true)).toBe("- [ ] a\n- [x] b\n- [x] c");
  });
  it("returns md unchanged for an out-of-range index", () => {
    expect(toggleTaskInMarkdown(md, 5, true)).toBe(md);
    expect(toggleTaskInMarkdown(md, -1, true)).toBe(md);
  });
  it("skips checkbox-shaped lines inside fenced code (index parity with render)", () => {
    const src = ["- [ ] real", "```", "- [ ] fake in code", "```", "- [ ] real2"].join("\n");
    // index 1 must be "real2", NOT the fenced line.
    expect(toggleTaskInMarkdown(src, 1, true)).toBe(
      ["- [ ] real", "```", "- [ ] fake in code", "```", "- [x] real2"].join("\n"),
    );
  });
  it("handles blockquote-nested and ordered task markers", () => {
    expect(TASK_LINE_RE.test("> - [ ] q")).toBe(true);
    expect(TASK_LINE_RE.test("1. [ ] ordered")).toBe(true);
    expect(toggleTaskInMarkdown("> - [ ] q", 0, true)).toBe("> - [x] q");
  });
});

describe("parseTokens", () => {
  it("walks a token tree with plugin grammars applied", () => {
    const md = "hi @[Alice](u_1) :rocket:";
    const nodes = parseTokens(md, {
      plugins: [
        emoji({ map: { rocket: "🚀" } }),
        tags({
          trigger: "@",
          source: () => [],
          serialize: (i) => `@[${i.display}](${i.id})`,
          parse: { pattern: MENTION, toItem: (m) => ({ display: m[1], id: m[2] }) },
        }),
      ],
    });
    // Flatten to find mention + emoji nodes anywhere in the tree.
    const flat: TokenNode[] = [];
    const visit = (ns: TokenNode[]) =>
      ns.forEach((n) => {
        flat.push(n);
        if (n.children) visit(n.children);
      });
    visit(nodes);
    const mention = flat.find((n) => n.type === "mention");
    const emo = flat.find((n) => n.type === "emoji");
    expect(mention?.attrs).toEqual({ id: "u_1", display: "Alice" });
    expect(emo?.attrs).toEqual({ code: "rocket", glyph: "🚀" });
  });
  it("returns exact block-level ranges", () => {
    const md = "# Title\n\nbody";
    const nodes = parseTokens(md);
    const heading = nodes.find((n) => n.type === "heading")!;
    expect(md.slice(heading.range[0], heading.range[1])).toBe("# Title\n\n");
  });
});
