import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";
import { emoji } from "../src/plugins/emoji";
import { createCodec, assertRoundTrip } from "../src/lib/testing";

// jsdom lacks Range.getClientRects — selection-positioned UI needs the stub.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const MAP: Record<string, string> = { rocket: "🚀", "+1": "👍", tada: "🎉" };

/** Simulate having typed `text` into the first paragraph (caret at end). */
function typeIntoFirstParagraph(editor: EdodoWrite, text: string): void {
  editor.focus();
  const p = editor.content.querySelector("p")!;
  p.textContent = text;
  const node = p.firstChild as Text;
  const sel = window.getSelection()!;
  const r = document.createRange();
  r.setStart(node, node.length);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  editor.content.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("emoji: round-trip (shortcode stored form)", () => {
  const codec = createCodec([emoji({ map: MAP })]);

  it("known shortcodes round-trip byte-stable", () => {
    assertRoundTrip(codec, "ship it :rocket: :+1:");
    assertRoundTrip(codec, ":tada:");
    assertRoundTrip(codec, "party :tada: time");
  });

  it("parse: :code: → span[data-shortcode] carrying the glyph", () => {
    const html = codec.parse("go :rocket:");
    expect(html).toContain('class="ew-emoji"');
    expect(html).toContain('data-shortcode="rocket"');
    expect(html).toContain("🚀");
  });

  it("unknown shortcode survives verbatim (not consumed)", () => {
    const html = codec.parse("nah :nope:");
    expect(html).not.toContain("data-shortcode");
    expect(html).toContain(":nope:");
    assertRoundTrip(codec, "nah :nope:");
  });

  it("lookup is case-insensitive; the stored shortcode is lowercased", () => {
    const html = codec.parse(":ROCKET:");
    expect(html).toContain('data-shortcode="rocket"');
    expect(codec.serialize(html)).toBe(":rocket:");
  });

  it("times and stray colons are never hijacked", () => {
    assertRoundTrip(codec, "meet at 12:30:45 sharp");
    assertRoundTrip(codec, "ratio a:b here");
    expect(codec.parse("meet at 12:30:45 sharp")).not.toContain("data-shortcode");
  });

  it("emoji inside bold / lists / quotes survives", () => {
    assertRoundTrip(codec, "**bold :rocket: text**");
    assertRoundTrip(codec, "- item :tada:");
    assertRoundTrip(codec, "> quoted :+1:");
  });

  it("shortcodes inside code fences/spans are left literal", () => {
    assertRoundTrip(codec, "`:rocket:` stays literal");
    assertRoundTrip(codec, "```\n:rocket:\n```");
    expect(codec.parse("`:rocket:`")).not.toContain("data-shortcode");
  });
});

describe("emoji: degradation without the plugin", () => {
  const plain = createCodec([]);
  it("shortcodes stay literal, lossless text", () => {
    const html = plain.parse("ship it :rocket:");
    expect(html).not.toContain("data-shortcode");
    expect(html).toContain(":rocket:");
    assertRoundTrip(plain, "ship it :rocket:");
  });
});

describe("emoji: unicode stored form", () => {
  const codec = createCodec([emoji({ map: MAP, storedForm: "unicode" })]);
  it("serialises to the bare glyph (no chip)", () => {
    const html = codec.parse("go :rocket:");
    expect(html).not.toContain("data-shortcode");
    expect(html).toContain("🚀");
    expect(codec.serialize(html)).toBe("go 🚀");
  });
});

describe("emoji: live input rule (type-to-replace)", () => {
  it("typing a KNOWN :shortcode: converts to a chip; markdown round-trips", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, { value: "placeholder", plugins: [emoji({ map: MAP })] });
    typeIntoFirstParagraph(editor, "go :rocket:");
    expect(editor.getHTML()).toContain('data-shortcode="rocket"');
    expect(editor.getMarkdown()).toBe("go :rocket:");
    editor.destroy();
  });

  it("typing an UNKNOWN :shortcode: does not convert", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, { value: "placeholder", plugins: [emoji({ map: MAP })] });
    typeIntoFirstParagraph(editor, "go :nope:");
    expect(editor.getHTML()).not.toContain("data-shortcode");
    expect(editor.getMarkdown()).toBe("go :nope:");
    editor.destroy();
  });
});

describe("emoji: custom render()", () => {
  it("a stored chip is rebuilt with render() and still round-trips", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, {
      value: "go :rocket:",
      plugins: [
        emoji({
          map: MAP,
          render: (glyph, code) => {
            const el = document.createElement("span");
            el.className = "ew-emoji custom";
            el.setAttribute("data-shortcode", code);
            el.textContent = glyph;
            return el;
          },
        }),
      ],
    });
    expect(editor.content.querySelector("span.custom")).toBeTruthy();
    expect(editor.getMarkdown()).toBe("go :rocket:");
    editor.destroy();
  });
});
