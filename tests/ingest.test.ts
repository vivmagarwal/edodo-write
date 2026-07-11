// @vitest-environment node
//
// RFC §11 — configurable HTML → Markdown. Forced to the bare-Node environment
// (turndown bundles its own DOM) to prove the Node-safe guarantee.

import { describe, it, expect } from "vitest";
import { createHtmlToMarkdown, looksLikeHtml, emptyParagraphRule, brRule } from "edodo-write/ingest";

describe("no-DOM guarantee", () => {
  it("runs without a DOM", () => {
    expect(typeof (globalThis as any).document).toBe("undefined");
    const { htmlToMarkdown } = createHtmlToMarkdown();
    expect(htmlToMarkdown("<h1>Hi</h1>")).toBe("# Hi");
  });
});

describe("full-document ingest", () => {
  it("extracts <body>, drops <head>/<title>/<style>", () => {
    const { htmlToMarkdown } = createHtmlToMarkdown();
    const html =
      "<html><head><title>Page Title</title><style>.x{color:red}</style></head>" +
      "<body><h1>Heading</h1><p>Paragraph.</p></body></html>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Heading");
    expect(md).toContain("Paragraph.");
    expect(md).not.toContain("Page Title");
    expect(md).not.toContain("color:red");
  });
});

describe("GFM", () => {
  const { htmlToMarkdown } = createHtmlToMarkdown();
  it("converts tables", () => {
    const md = htmlToMarkdown(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    expect(md).toContain("| A");
    expect(md).toContain("| --- |");
  });
  it("converts strikethrough", () => {
    expect(htmlToMarkdown("<p><del>gone</del></p>")).toContain("~~gone~~");
  });
  it("converts task lists", () => {
    const md = htmlToMarkdown(
      '<ul><li><input type="checkbox" disabled> todo</li><li><input type="checkbox" checked disabled> done</li></ul>',
    );
    expect(md).toContain("[ ]");
    expect(md).toContain("[x]");
  });
  it("can be disabled", () => {
    const { htmlToMarkdown: plain } = createHtmlToMarkdown({ gfm: false });
    expect(plain("<p><del>gone</del></p>")).not.toContain("~~");
  });
});

describe("danger-tag stripping (dual defense)", () => {
  const { htmlToMarkdown } = createHtmlToMarkdown();
  it("strips script/style/iframe/object/embed/noscript", () => {
    const md = htmlToMarkdown(
      "<p>keep</p><script>evil()</script><style>.a{}</style>" +
        "<iframe src=x></iframe><object></object><embed><noscript>ns</noscript>",
    );
    expect(md).toContain("keep");
    expect(md).not.toContain("evil");
    expect(md).not.toContain(".a{}");
    expect(md).not.toContain("ns");
  });
  it("catches both a paired danger block (regex) and a void danger tag (node removal)", () => {
    // <script>…</script> is removed by the regex pre-strip; the void <embed>
    // (no close) is removed by the turndown node-removal second defense.
    const md = htmlToMarkdown("<p>ok</p><script>evil()</script><embed src=x>");
    expect(md).toContain("ok");
    expect(md).not.toContain("evil");
    expect(md).not.toContain("src=x");
  });
  it("second defense removes an unclosed danger opener without orphaning its body", () => {
    const md = htmlToMarkdown("<p>ok</p><script>window.x=1");
    expect(md).toContain("ok");
    expect(md).not.toContain("window.x");
  });
  it("honours a custom stripTags list", () => {
    const { htmlToMarkdown: strict } = createHtmlToMarkdown({ stripTags: ["aside"] });
    expect(strict("<p>keep</p><aside>drop me</aside>")).not.toContain("drop me");
  });
});

describe("named rules", () => {
  const { htmlToMarkdown } = createHtmlToMarkdown();
  it("drops empty <p> spacers", () => {
    const md = htmlToMarkdown("<p>one</p><p></p><p><br></p><p>two</p>");
    expect(md).toContain("one");
    expect(md).toContain("two");
    expect(md).not.toMatch(/\n\n\n/); // no triple blank runs from spacers
  });
  it("turns a raw <br> outside a table into a soft \\n", () => {
    const md = htmlToMarkdown("<p>line one<br>line two</p>");
    expect(md).toContain("line one\nline two");
    expect(md).not.toContain("\\"); // not turndown's backslash hard break
  });
  it("exposes the rules as overridable objects", () => {
    expect(typeof emptyParagraphRule.replacement).toBe("function");
    expect(typeof brRule.replacement).toBe("function");
  });
  it("accepts extra custom rules", () => {
    const { htmlToMarkdown: withRule } = createHtmlToMarkdown({
      rules: [
        {
          name: "shout",
          filter: (node) => node.nodeName === "STRONG",
          replacement: (content) => `!!${content}!!`,
        },
      ],
    });
    expect(withRule("<p>a <strong>b</strong></p>")).toContain("!!b!!");
  });
});

describe("trim", () => {
  it("trims by default", () => {
    const { htmlToMarkdown } = createHtmlToMarkdown();
    expect(htmlToMarkdown("<p>hi</p>")).toBe("hi");
  });
  it("accepts { trim: false } and keeps the content", () => {
    // turndown already trims its own output, so for these inputs the untrimmed
    // and trimmed results carry identical content; the option is threaded and
    // matters for callers whose custom rules emit surrounding whitespace.
    const { htmlToMarkdown } = createHtmlToMarkdown();
    const out = htmlToMarkdown("<p>hi</p>", { trim: false });
    expect(out.trim()).toBe("hi");
    expect(() => htmlToMarkdown("<p>hi</p>", { trim: false })).not.toThrow();
  });
  it("collapses 3+ blank lines to 2 even with trim off", () => {
    const { htmlToMarkdown } = createHtmlToMarkdown();
    const out = htmlToMarkdown("<p>a</p><p>b</p>", { trim: false });
    expect(out).not.toMatch(/\n\n\n/);
  });
});

describe("turndown option overrides", () => {
  it("respects a custom bulletListMarker", () => {
    const { htmlToMarkdown } = createHtmlToMarkdown({ turndown: { bulletListMarker: "*" } });
    expect(htmlToMarkdown("<ul><li>x</li></ul>")).toMatch(/^\*\s+x$/);
  });
});

describe("looksLikeHtml", () => {
  it("detects tags and doctypes", () => {
    expect(looksLikeHtml("<p>hi</p>")).toBe(true);
    expect(looksLikeHtml("<br>")).toBe(true);
    expect(looksLikeHtml("<!DOCTYPE html>")).toBe(true);
    expect(looksLikeHtml("</div>")).toBe(true);
  });
  it("returns false for plain text / markdown / empty", () => {
    expect(looksLikeHtml("just text")).toBe(false);
    expect(looksLikeHtml("# a markdown heading")).toBe(false);
    expect(looksLikeHtml("a < b and c > d")).toBe(false);
    expect(looksLikeHtml("")).toBe(false);
    expect(looksLikeHtml(null as any)).toBe(false);
  });
});

describe("never throws", () => {
  it("handles nullish / empty input", () => {
    const { htmlToMarkdown } = createHtmlToMarkdown();
    expect(() => htmlToMarkdown("")).not.toThrow();
    expect(() => htmlToMarkdown(null as any)).not.toThrow();
    expect(htmlToMarkdown("")).toBe("");
  });
});
