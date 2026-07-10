import { describe, it, expect, vi } from "vitest";
import { EdodoWrite } from "@core/editor";
import { math } from "../src/plugins/math";
import { createCodec, assertRoundTrip } from "../src/lib/testing";

// jsdom lacks Range.getClientRects — selection-positioned UI (slash menu)
// needs the stub. Real browsers never do.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

function mount(value: string, options: ConstructorParameters<typeof EdodoWrite>[1] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, { value, plugins: [math()], ...options });
}

/** Simulate having just typed `text` into the first paragraph (caret at end). */
function typeIntoFirstParagraph(editor: EdodoWrite, text: string): void {
  const p = editor.content.querySelector("p")!;
  p.textContent = text;
  const sel = window.getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(p);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
  editor.content.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("math: round-trip stability", () => {
  const codec = createCodec([math()]);

  it("inline $tex$ survives byte-for-byte", () => {
    assertRoundTrip(codec, "inline $x^2$ math");
    assertRoundTrip(codec, "$x^2$");
    assertRoundTrip(codec, "sum $\\frac{a}{b}$ end");
  });

  it("block $$…$$ survives byte-for-byte", () => {
    assertRoundTrip(codec, "$$\nE=mc^2\n$$");
    assertRoundTrip(codec, "before\n\n$$\n\\frac{a}{b} + c\n$$\n\nafter");
    assertRoundTrip(codec, "$$\n\\sum_{i=0}^n i^2\n\\ge \\frac{n^3}{3}\n$$");
  });

  it("attribute-hostile TeX (quotes, angle brackets) survives", () => {
    assertRoundTrip(codec, "$a<b$ stays");
    assertRoundTrip(codec, '$$\nf("x") < g("y")\n$$');
  });

  it("inline math inside bold / lists / quotes survives", () => {
    assertRoundTrip(codec, "**bold $x_i$ math**");
    assertRoundTrip(codec, "- item with $x^2$ math");
    assertRoundTrip(codec, "> quoted $x^2$ math");
  });

  it("one-line $$E=mc^2$$ normalizes to the canonical block form", () => {
    const once = codec.serialize(codec.parse("$$E=mc^2$$"));
    expect(once).toBe("$$\nE=mc^2\n$$");
    assertRoundTrip(codec, once);
  });

  it("plain GFM is unaffected by the math codec", () => {
    assertRoundTrip(codec, "# Title\n\n- [x] task\n\n> quote\n\n```\ncode $x$ here\n```");
    assertRoundTrip(codec, "costs $$ money mid-line stays one paragraph");
  });
});

describe("math: currency is never hijacked", () => {
  const codec = createCodec([math()]);

  it('"costs $5 and $10 total" stays plain text', () => {
    const html = codec.parse("costs $5 and $10 total");
    expect(html).not.toContain("data-math");
    expect(html).toContain("costs $5 and $10 total");
    assertRoundTrip(codec, "costs $5 and $10 total");
  });

  it("edge rules: whitespace at the edges or $ inside never matches", () => {
    for (const md of ["a $ b $ c", "$ spaced $", "$trail $", "$5$0"]) {
      expect(codec.parse(md)).not.toContain("data-math");
    }
    // …but a legitimate formula right next to currency still works.
    expect(codec.parse("pay $5 for $x^2$")).toContain('data-math="x^2"');
  });

  it("the input rule refuses the currency shape too", () => {
    const editor = mount("placeholder");
    // The state right after typing the SECOND "$" of "costs $5 and $10…".
    typeIntoFirstParagraph(editor, "costs $5 and $");
    expect(editor.getHTML()).not.toContain("data-math");
    expect(editor.getMarkdown()).toBe("costs $5 and $");
    editor.destroy();
  });
});

describe("math: degradation without the plugin", () => {
  const plain = createCodec([]);

  it("inline $tex$ stays literal, lossless text", () => {
    const html = plain.parse("inline $x^2$ math");
    expect(html).not.toContain("data-math");
    expect(html).toContain("$x^2$");
    assertRoundTrip(plain, "inline $x^2$ math");
    assertRoundTrip(plain, "costs $5 and $10 total");
  });

  it("block $$…$$ keeps its content as visible text", () => {
    const html = plain.parse("$$\nE=mc^2\n$$");
    expect(html).not.toContain("data-widget");
    expect(html).toContain("E=mc^2");
    const resaved = plain.serialize(html);
    expect(resaved).toContain("$$");
    expect(resaved).toContain("E=mc^2");
  });
});

describe("math: marked/turndown pairing", () => {
  const codec = createCodec([math()]);

  it("parse: $tex$ → span[data-math], $$…$$ → figure[data-widget=math]", () => {
    expect(codec.parse("$x^2$")).toContain('data-math="x^2"');
    const block = codec.parse("$$\nE=mc^2\n$$");
    expect(block).toContain('data-widget="math"');
    expect(block).toContain('data-source="E=mc^2"');
  });

  it("serialize: the DOM forms write the syntax back from the data attrs", () => {
    expect(codec.serialize('<p><span class="ew-math" data-math="x^2">anything</span></p>')).toBe("$x^2$");
    expect(
      codec.serialize('<figure data-widget="math" data-source="E=mc^2"><div class="ew-widget__surface">x</div></figure>'),
    ).toBe("$$\nE=mc^2\n$$");
  });
});

describe("math: input rule in a live editor", () => {
  it("typing the closing $ converts to a chip; markdown round-trips", () => {
    const editor = mount("placeholder");
    typeIntoFirstParagraph(editor, "cost $x^2$");
    expect(editor.getHTML()).toContain('data-math="x^2"');
    expect(editor.getMarkdown()).toBe("cost $x^2$");
    editor.destroy();
  });
});

describe("math: rendering", () => {
  it("KaTeX renders inline chips and block widgets when available", async () => {
    const editor = mount("try $x^2$ inline\n\n$$\nE=mc^2\n$$");
    await vi.waitFor(() => {
      const html = editor.getHTML();
      expect(html).toContain("katex");
    }, { timeout: 3000 });
    // Rendering never touches the Markdown contract.
    expect(editor.getMarkdown()).toBe("try $x^2$ inline\n\n$$\nE=mc^2\n$$");
    editor.destroy();
  });

  it("options.render overrides the built-in renderer (inline + block)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, {
      value: "a $x^2$ b\n\n$$\ny\n$$",
      plugins: [math({ render: (tex, el, displayMode) => { el.textContent = `R(${tex},${displayMode})`; } })],
    });
    await vi.waitFor(() => {
      const html = editor.getHTML();
      expect(html).toContain("R(x^2,false)");
      expect(html).toContain("R(y,true)");
    });
    expect(editor.getHTML()).not.toContain("katex");
    editor.destroy();
  });

  it("a throwing renderer falls back to plain TeX text (typing survives)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, {
      value: "a $x^2$ b",
      plugins: [math({ render: () => { throw new Error("boom"); } })],
    });
    await vi.waitFor(() => {
      const span = editor.content.querySelector("span[data-math]")!;
      expect(span.textContent).toBe("x^2");
    });
    expect(editor.getMarkdown()).toBe("a $x^2$ b");
    editor.destroy();
  });
});

describe("math: inline chip editing popover", () => {
  function openChipPopover(editor: EdodoWrite): HTMLElement {
    const span = editor.content.querySelector("span[data-math]") as HTMLElement;
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return document.body.querySelector(".ew-popover") as HTMLElement;
  }

  it("Save updates the TeX and the Markdown", () => {
    const editor = mount("keep $x^2$ here");
    const popover = openChipPopover(editor);
    expect(popover).toBeTruthy();
    const input = popover.querySelector("input")!;
    expect(input.value).toBe("x^2");
    input.value = "y^3";
    (popover.querySelector(".ew-popover__btn--primary") as HTMLElement).click();
    expect(editor.getMarkdown()).toBe("keep $y^3$ here");
    editor.destroy();
  });

  it("Remove unwraps to plain text (no $ delimiters — it must not re-hydrate)", () => {
    const editor = mount("keep $x^2$ here");
    const popover = openChipPopover(editor);
    (popover.querySelector(".is-danger") as HTMLElement).click();
    expect(editor.getMarkdown()).toBe("keep x^2 here");
    // Round-trip proof: reloading that markdown produces no chip.
    const codec = createCodec([math()]);
    expect(codec.parse("keep x^2 here")).not.toContain("data-math");
    editor.destroy();
  });
});

describe("math: slash item", () => {
  it("/math inserts a $$ widget and opens its source editor", () => {
    const editor = mount("placeholder");
    editor.focus();
    typeIntoFirstParagraph(editor, "/math");
    const menu = document.querySelector(".ew-slash.is-visible")!;
    expect(menu.textContent).toContain("Advanced");
    expect(menu.textContent).toContain("Math block");
    editor.content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(editor.getMarkdown()).toBe("$$\nE = mc^2\n$$");
    // The shared widget editor opened on the fresh block.
    const textarea = document.body.querySelector(".ew-popover textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("E = mc^2");
    textarea.value = "a^2 + b^2 = c^2";
    (document.body.querySelector(".ew-popover .ew-popover__btn--primary") as HTMLElement).click();
    expect(editor.getMarkdown()).toBe("$$\na^2 + b^2 = c^2\n$$");
    editor.destroy();
  });
});
