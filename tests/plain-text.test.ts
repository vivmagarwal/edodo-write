// @vitest-environment node
//
// RFC §9 — toPlainText must be Node-safe (no DOM, no sanitiser). This file
// forces the bare-Node environment.

import { describe, it, expect } from "vitest";
import { toPlainText } from "edodo-write";
import { emoji, tags } from "edodo-write/plugins";

const MENTION = /@\[([^\]]+)\]\(([^)\s]+)\)/g;
const mentions = () =>
  tags({
    trigger: "@",
    source: () => [],
    serialize: (i) => `@[${i.display}](${i.id})`,
    parse: { pattern: MENTION, toItem: (m) => ({ display: m[1], id: m[2] }) },
  });

describe("no-DOM guarantee", () => {
  it("runs without a DOM", () => {
    expect(typeof (globalThis as any).document).toBe("undefined");
    expect(toPlainText("# Hello")).toBe("Hello");
  });
});

describe("empty / nullish input", () => {
  it("returns '' for '', null, undefined", () => {
    expect(toPlainText("")).toBe("");
    expect(toPlainText(null)).toBe("");
    expect(toPlainText(undefined)).toBe("");
  });
});

describe("block collapse", () => {
  it("drops #, blockquote markers, and code fences into one line", () => {
    const out = toPlainText("# H\n\n> q\n\n```x```");
    expect(out).not.toContain("#");
    expect(out).not.toContain(">");
    expect(out).not.toContain("`");
    expect(out).not.toContain("\n");
    expect(out).toContain("H");
    expect(out).toContain("q");
    expect(out).toContain("x");
  });
  it("drops tables entirely", () => {
    const out = toPlainText("text before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntext after");
    expect(out).toBe("text before text after");
  });
  it("images collapse to alt, links to their text", () => {
    expect(toPlainText("![the alt](http://x/y.png)")).toBe("the alt");
    expect(toPlainText("[click here](http://x)")).toBe("click here");
    expect(toPlainText("![](http://x/y.png) tail")).toBe("tail");
  });
});

describe("truncation math", () => {
  it("caps returned length including the ellipsis", () => {
    const out = toPlainText("one two three four five six", { maxLength: 12 });
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.endsWith("…")).toBe(true);
  });
  it("honours a custom ellipsis and empty ellipsis", () => {
    const dots = toPlainText("aaaa bbbb cccc dddd", { maxLength: 10, ellipsis: "..." });
    expect(dots.length).toBeLessThanOrEqual(10);
    expect(dots.endsWith("...")).toBe(true);
    const none = toPlainText("aaaaaaaaaaaaaaaaaaaa", { maxLength: 5, ellipsis: "" });
    expect(none).toBe("aaaaa");
  });
  it("returns only the ellipsis when the budget is smaller than it", () => {
    expect(toPlainText("hello world", { maxLength: 1, ellipsis: "..." })).toBe("...");
  });
  it("does not truncate when under the cap", () => {
    expect(toPlainText("short", { maxLength: 100 })).toBe("short");
  });
  it("backs up to a word boundary only when past halfway", () => {
    const out = toPlainText("hello world", { maxLength: 9 });
    // limit = 9 - 1 = 8 → "hello wo"; lastSpace=5 > 4 → back up to "hello".
    expect(out).toBe("hello…");
  });
  it("never splits an astral char into a lone surrogate at the cut", () => {
    const out = toPlainText("🚀".repeat(10), { maxLength: 5, ellipsis: "" });
    const last = out.charCodeAt(out.length - 1);
    // The final code unit must not be a lone HIGH surrogate (0xD800–0xDBFF) —
    // a dangling first-half that renders as U+FFFD. (A low surrogate here is
    // fine: it is the valid second half of the preceding emoji.)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    // What survives is whole rockets only — a well-formed string.
    expect(out).toBe("🚀🚀");
  });
});

describe("plugin token resolution", () => {
  it("mention → @Display, emoji → glyph with the map", () => {
    const out = toPlainText("# H\n\n@[Bob](u2) :tada:", {
      maxLength: 160,
      plugins: [mentions(), emoji({ map: { tada: "🎉" } })],
    });
    expect(out).toBe("H @Bob 🎉");
  });
  it("resolves the @channel broadcast display", () => {
    const out = toPlainText("ping @[channel](@channel)", { plugins: [mentions()] });
    expect(out).toBe("ping @channel");
  });
  it("unknown emoji drops its colons", () => {
    const out = toPlainText("ship it :nope:", { plugins: [emoji({ map: { rocket: "🚀" } })] });
    expect(out).toBe("ship it nope");
  });
  it("leaves numeric colon runs intact", () => {
    expect(toPlainText("at 12:30:45 today")).toBe("at 12:30:45 today");
  });
});

describe("preserveLineBreaks (email fallback)", () => {
  it("keeps paragraph breaks", () => {
    const out = toPlainText("para one\n\npara two", { preserveLineBreaks: true });
    expect(out).toBe("para one\n\npara two");
  });
});

describe("entities and stripped tags", () => {
  it("decodes the 7-entity map by default", () => {
    expect(toPlainText("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });
  it("drops the contents of script/style", () => {
    const out = toPlainText("keep <script>alert(1)</script> me");
    expect(out).not.toContain("alert");
    expect(out).toContain("keep");
    expect(out).toContain("me");
  });
  it("never throws", () => {
    expect(() => toPlainText("<<<>>> [broken](")).not.toThrow();
  });
});
