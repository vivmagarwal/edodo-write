import { describe, it, expect } from "vitest";
import { createCodec, assertRoundTrip, type Codec } from "edodo-write/testing";
import { highlight, callout } from "edodo-write/plugins";

/**
 * A broad Markdown corpus proving the round-trip contract:
 *
 *   • STABLE inputs survive serialize(parse(md)) byte-for-byte.
 *   • CANONICAL inputs converge to a documented canonical form on the first
 *     pass and are idempotent from then on (rt(rt(x)) === rt(x)).
 *
 * The whole corpus also runs through the highlight+callout plugin codec to
 * prove plugin markdown extensions do not disturb core Markdown.
 */

const core = createCodec([]);
const rt = (codec: Codec, md: string) => codec.serialize(codec.parse(md));

/** Inputs that must survive one pass byte-for-byte (and stay stable). */
const STABLE: Array<[string, string]> = [
  ["fenced code with a language", "```js\nconst x = 1;\n```"],
  [
    "fence content is verbatim (indentation, blank runs, trailing comment)",
    "```python\ndef f():\n    return [1, 2]\n\n\n    # trailing\n```",
  ],
  ["fence-in-fence (4-backtick outer, 3-backtick inner)", "````md\n```js\nconst x = 1;\n```\n````"],
  ["NBSP inside a fence is preserved (tidy is fence-aware)", "```\na\u00A0b\n```"],
  ["image with alt and title", '![An alt](https://example.com/a.png "The title")'],
  ["image without title", "![alt](https://example.com/a.png)"],
  ["image with empty alt", "![](https://example.com/a.png)"],
  ["headings 4–6", "#### Four\n\n##### Five\n\n###### Six"],
  ["ordered list starting at 3", "3. three\n4. four\n5. five"],
  ["escaped asterisks stay escaped", "not \\*emphasis\\* here"],
  ["escaped tag-opener stays literal", "a \\<script> tag"],
  ["link with a title", '[site](https://example.com "Home page")'],
  ["bold+italic together", "***both*** and **bold** and *italic*"],
  ["unicode / emoji / CJK / RTL", "café naïve — 😀🎉 中文段落测试 مرحبا بالعالم עברית"],
  ["heading with inline code", "## Use `npm test` locally"],
  ["code span containing backticks", "`` `x` ``"],
  ["plain ampersand is not entity-escaped", "Tom & Jerry"],
  ["nested bullet list (4-space canonical)", "- a\n    - b\n        - c"],
  ["nested ordered list", "1. one\n2. two\n    1. nested"],
  ["nested blockquotes", "> outer\n>\n> > inner"],
  ["task list", "- [ ] todo\n- [x] done"],
  ["nested task list", "- [ ] parent\n    - [x] child"],
  ["backslash hard break", "line one\\\nline two"],
  ["tight list", "- a\n- b"],
  ["loose list stays loose", "- a\n\n- b"],
  ["divider between paragraphs", "above\n\n---\n\nbelow"],
  ["lone divider", "---"],
  ["autolink canonical form (inline link)", "[https://example.com](https://example.com)"],
  ["== is plain text without the highlight plugin", "some ==bright== words"],
  ["empty document", ""],
  ["very long line", "lorem ipsum dolor sit amet ".repeat(200).trim()],
  ["very long unbroken word", "x".repeat(4000)],
  [
    "kitchen-sink document",
    [
      "# Title",
      "",
      'Intro with **bold**, *italic*, `code`, ~~strike~~, ***both***, and a [link](https://example.com "Home").',
      "",
      "## Lists",
      "",
      "- one",
      "- two",
      "    - nested",
      "        - deeper",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] todo",
      "- [x] done",
      "",
      "> A quote",
      ">",
      "> > nested quote",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "| a   | b   |",
      "| --- | --- |",
      "| 1   | 2   |",
      "",
      "---",
      "",
      "Final line one\\",
      "line two — café 😀 中文 مرحبا",
    ].join("\n"),
  ],
];

/**
 * Inputs the pipeline rewrites into a canonical form. Each case asserts the
 * exact canonical output AND that the canonical form is a fixed point.
 */
const CANONICAL: Array<[string, string, string]> = [
  // Turndown escapes the closing bracket too.
  ["escaped opening bracket gains a closing escape", "a \\[bracket] opens", "a \\[bracket\\] opens"],
  // Parens inside a URL are escaped on the way out.
  [
    "link with parens in the URL",
    "[wiki](https://en.wikipedia.org/wiki/Foo_(bar))",
    "[wiki](https://en.wikipedia.org/wiki/Foo_\\(bar\\))",
  ],
  // 2-space nesting is valid input; 4-space is the canonical output.
  ["2-space nested list → 4-space", "- a\n  - b", "- a\n    - b"],
  // The GFM table serializer pads cells to the 3-char separator width.
  [
    "GFM table → padded canonical form",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
  ],
  [
    "ragged GFM table → same canonical form",
    "|a|b|\n|-|-|\n|1|2|",
    "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
  ],
  // NBSP is a contentEditable artifact, normalised to a plain space in prose.
  ["NBSP → space in prose", "a\u00A0b", "a b"],
  // Zero-width spaces are caret parks; always stripped on serialise.
  ["zero-width space is stripped", "a\u200Bb", "ab"],
  ["setext H1 → ATX", "Title\n=====", "# Title"],
  ["setext H2 → ATX", "Sub\n---", "## Sub"],
  ["tilde fence → backtick fence", "~~~\ncode\n~~~", "```\ncode\n```"],
  ["autolink → inline link", "<https://example.com>", "[https://example.com](https://example.com)"],
  // GFM autolinking wraps bare URLs on parse; serialize makes it explicit.
  [
    "bare URL in prose → inline link",
    "visit https://example.com now",
    "visit [https://example.com](https://example.com) now",
  ],
  ["whitespace-only document → empty", "   \n\t  \n", ""],
  // marked decodes the entity; turndown re-escapes the raw `<`.
  ["entity input → backslash escape", "5 &lt; 6", "5 \\< 6"],
  // Turndown's raw list markers (`-` + 3 spaces) survive inside blockquotes
  // because the tidy pass only normalises markers at line start (see the
  // BUG note at the bottom of this file). Idempotent and valid, just wider.
  ["list inside a blockquote (3-space markers)", "> - one\n> - two", "> -   one\n> -   two"],
  ["task item inside a blockquote", "> - [ ] inside", "> -   [ ]  inside"],
  // Without the callout plugin the marker is escaped prose, not a callout.
  ["callout syntax without the plugin", "> [!NOTE]\n> Useful.", "> \\[!NOTE\\] Useful."],
];

describe("round-trip corpus — byte-stable inputs (core codec)", () => {
  for (const [name, md] of STABLE) {
    it(`is stable for: ${name}`, () => {
      expect(rt(core, md)).toBe(md);
    });
  }
});

describe("round-trip corpus — canonicalising inputs (core codec)", () => {
  for (const [name, input, canonical] of CANONICAL) {
    it(`canonicalises: ${name}`, () => {
      const once = rt(core, input);
      expect(once).toBe(canonical);
      // Idempotency: the canonical form is a fixed point.
      expect(rt(core, once)).toBe(once);
    });
  }
});

describe("plugin codec (highlight + callout) does not disturb core markdown", () => {
  const plug = createCodec([highlight(), callout()]);

  for (const [name, md] of STABLE) {
    it(`plugin codec is stable for: ${name}`, () => {
      // assertRoundTrip checks both byte-stability and second-pass stability.
      assertRoundTrip(plug, md);
    });
  }

  for (const [name, input, canonical] of CANONICAL) {
    // With the callout plugin installed, the GitHub alert marker is a real
    // callout and round-trips byte-for-byte instead of canonicalising.
    if (input.startsWith("> [!NOTE]")) continue;
    it(`plugin codec canonicalises identically for: ${name}`, () => {
      const once = rt(plug, input);
      expect(once).toBe(canonical);
      expect(rt(plug, once)).toBe(once);
    });
  }

  it("callout syntax is byte-stable with the plugin installed", () => {
    assertRoundTrip(plug, "> [!NOTE]\n> Useful.");
  });

  it("highlight syntax is byte-stable with the plugin installed", () => {
    assertRoundTrip(plug, "some ==bright== words");
  });
});

// BUG (minor, canonicalisation): tidyMarkdown's list-marker normalisations
// (src/core/serialize.ts, the `^(\s*)([-*+])[ \t]+` family) are anchored to
// line start and do not account for blockquote `> ` prefixes. Lists inside
// blockquotes therefore keep turndown's raw three-space markers
// ("> -   one") instead of the one-space canonical form used everywhere
// else. Output is valid and idempotent — pinned above — but inconsistent.
