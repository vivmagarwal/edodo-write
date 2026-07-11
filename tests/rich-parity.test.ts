import { describe, it, expect } from "vitest";
import { createCodec, assertRoundTrip } from "../src/lib/testing";
import { footnote } from "../src/plugins/footnote";
import { file } from "../src/plugins/file";
import { detailsToggle } from "../src/plugins/details";

// jsdom lacks Range.getClientRects — selection-positioned UI needs the stub.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

describe("footnote (RFC §12)", () => {
  const codec = createCodec([footnote()]);

  it("round-trips reference + definition byte-stable", () => {
    assertRoundTrip(codec, "see[^1]\n\n[^1]: note");
  });

  it("renders a ref <sup> chip and a trailing <section>", () => {
    const html = codec.parse("see[^1]\n\n[^1]: note");
    expect(html).toContain('class="ew-fn-ref"');
    expect(html).toContain('id="fnref-1"');
    expect(html).toContain('href="#fn-1"');
    expect(html).toContain('class="ew-footnotes"');
    expect(html).toContain('id="fn-1"');
  });

  it("numbers by definition order, preserving the stored id", () => {
    const md = "a[^b] and c[^a]\n\n[^a]: first\n\n[^b]: second";
    const html = codec.parse(md);
    // [^a] is defined first → display 1; [^b] second → display 2.
    expect(html).toMatch(/id="fnref-a">1</);
    expect(html).toMatch(/id="fnref-b">2</);
    assertRoundTrip(codec, md);
  });

  it("leaves an unmatched reference literal (not consumed as a chip)", () => {
    // No `[^x]: …` definition → the tokenizer refuses the ref, so it renders
    // as literal text rather than a footnote chip.
    const html = codec.parse("ghost[^x] here");
    expect(html).not.toContain("ew-fn-ref");
    expect(html).not.toContain("ew-footnotes");
    expect(html).toContain("[^x]");
  });

  it("is reusable across documents (state resets per parse)", () => {
    assertRoundTrip(codec, "one[^1]\n\n[^1]: a");
    assertRoundTrip(codec, "two[^2]\n\n[^2]: b");
  });

  it("keeps the FIRST body when an id is defined twice (GitHub behaviour)", () => {
    const html = codec.parse("a[^1]\n\n[^1]: first\n\n[^1]: second");
    expect(html).toContain("first");
    expect(html).not.toContain("second");
  });
});

describe("file / attachment (RFC §12)", () => {
  const codec = createCodec([file()]);

  it("round-trips a named attachment byte-stable", () => {
    assertRoundTrip(codec, "!file[report.pdf](https://r2/x)");
  });

  it("round-trips an EMPTY-name attachment byte-stable", () => {
    assertRoundTrip(codec, "!file[](https://r2/x)");
  });

  it("renders the chip with data-file-* + contenteditable=false", () => {
    const html = codec.parse("!file[report.pdf](https://r2/x)");
    expect(html).toContain('class="ew-file"');
    expect(html).toContain('data-file-name="report.pdf"');
    expect(html).toContain('data-file-url="https://r2/x"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain("\u{1F4CE}");
  });

  it("falls back to the URL as the label when name is empty", () => {
    const html = codec.parse("!file[](https://r2/x)");
    expect(html).toContain("https://r2/x");
    expect(html).toContain('data-file-name=""');
  });

  it("supports the optional unfurl sibling", () => {
    assertRoundTrip(codec, "!unfurl[My Site](https://example.com/)");
    const html = codec.parse("!unfurl[My Site](https://example.com/)");
    expect(html).toContain('class="ew-unfurl"');
    expect(html).toContain('data-unfurl-title="My Site"');
  });

  it("degrades gracefully without the plugin (no chip, filename still visible)", () => {
    const plain = createCodec([]);
    const html = plain.parse("!file[a.pdf](https://r2/x)");
    expect(html).not.toContain("ew-file");
    expect(html).toContain("a.pdf");
  });
});

describe("details / toggle (RFC §12)", () => {
  const codec = createCodec([detailsToggle()]);

  it("round-trips the stored HTML form byte-stable", () => {
    assertRoundTrip(codec, "<details data-md-open><summary>**S**</summary>body</details>");
  });

  it("renders open + inline-markdown summary", () => {
    const html = codec.parse("<details data-md-open><summary>**S**</summary>body</details>");
    expect(html).toMatch(/<details[^>]*\sopen[^>]*>/);
    expect(html).toContain("<summary><strong>S</strong></summary>");
    expect(html).toContain("body");
  });

  it("round-trips a collapsed toggle (no open marker)", () => {
    assertRoundTrip(codec, "<details><summary>Title</summary>content</details>");
  });

  it("preserves the data-md-block marker", () => {
    assertRoundTrip(codec, "<details data-md-block data-md-open><summary>X</summary>y</details>");
  });
});
