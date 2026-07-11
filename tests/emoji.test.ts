import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";
import { emoji } from "../src/plugins/emoji";
import { defaultEmojiMap } from "../src/plugins/emoji-map";
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

// ── The `:query` suggestion menu (autocomplete) ─────────────────────────────

function pressKey(editor: EdodoWrite, key: string): void {
  editor.content.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

function menuEl(): HTMLElement | null {
  return document.querySelector(".ew-popover.ew-menu");
}

function mount(value = "", plugin = emoji({ map: MAP })) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, { value, plugins: [plugin] });
}

describe("emoji: autocomplete menu", () => {
  it("`:` + two query chars opens the menu; Enter inserts the chip", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "go :ro");
    expect(menuEl()).toBeTruthy();
    expect(menuEl()!.textContent).toContain(":rocket:");
    pressKey(editor, "Enter");
    expect(menuEl()).toBeNull();
    expect(editor.getHTML()).toContain('data-shortcode="rocket"');
    expect(editor.getMarkdown()).toBe("go :rocket:");
    editor.destroy();
  });

  it("one query char is not enough (ordinary colons stay quiet)", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "note :r");
    expect(menuEl()).toBeNull();
    editor.destroy();
  });

  it("mid-word colons never trigger (12:30 stays text)", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "meet at 12:30");
    expect(menuEl()).toBeNull();
    editor.destroy();
  });

  it("Tab picks like Enter", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, ":ta");
    expect(menuEl()).toBeTruthy();
    pressKey(editor, "Tab");
    expect(editor.getMarkdown()).toBe(":tada:");
    editor.destroy();
  });

  it("ArrowDown moves the active row before picking", () => {
    // Query "t" chars: entries for ":ta" in MAP = ["tada"] only — use a map
    // with two hits to prove navigation.
    const editor = mount("", emoji({ map: { tada: "🎉", taco: "🌮" } }));
    typeIntoFirstParagraph(editor, ":ta");
    const rows = menuEl()!.querySelectorAll(".ew-menu__title");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe(":taco:"); // suggestions sort alphabetically
    pressKey(editor, "ArrowDown");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe(":tada:");
    editor.destroy();
  });

  it("Escape closes and leaves the typed text alone", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, ":ro");
    expect(menuEl()).toBeTruthy();
    pressKey(editor, "Escape");
    expect(menuEl()).toBeNull();
    expect(editor.getMarkdown()).toBe(":ro");
    editor.destroy();
  });

  it("a query nothing matches never opens (and a stale menu closes)", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, ":zzqq");
    expect(menuEl()).toBeNull();
    editor.destroy();
  });

  it("never opens inside code blocks", () => {
    const editor = mount("```\ncode\n```");
    editor.focus();
    const code = editor.content.querySelector("pre code")!;
    code.textContent = "x :ro";
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(code.firstChild!, (code.firstChild as Text).length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    editor.content.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menuEl()).toBeNull();
    editor.destroy();
  });

  it("prefix matches rank before substring matches", () => {
    const editor = mount("", emoji({ map: { art: "🎨", heart: "❤️", cart: "🛒" } }));
    typeIntoFirstParagraph(editor, ":ar");
    const rows = menuEl()!.querySelectorAll(".ew-menu__title");
    expect(rows[0].textContent).toBe(":art:");
    // the substring hits follow, alphabetical
    expect(rows[1].textContent).toBe(":cart:");
    expect(rows[2].textContent).toBe(":heart:");
    editor.destroy();
  });

  it("mid-line pick replaces only the trigger+query span", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "before :roc after");
    expect(menuEl()).toBeNull(); // caret is at the very end — after " after"
    // park the caret right after ":roc"
    const p = editor.content.querySelector("p")!;
    const text = p.firstChild as Text;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(text, "before :roc".length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    editor.content.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menuEl()).toBeTruthy();
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("before :rocket: after");
    editor.destroy();
  });

  it("storedForm unicode picks insert the bare glyph", () => {
    const editor = mount("", emoji({ map: MAP, storedForm: "unicode" }));
    typeIntoFirstParagraph(editor, ":ro");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("🚀");
    editor.destroy();
  });

  it("autocomplete: false keeps the menu off entirely", () => {
    const editor = mount("", emoji({ map: MAP, autocomplete: false }));
    typeIntoFirstParagraph(editor, ":ro");
    expect(menuEl()).toBeNull();
    editor.destroy();
  });

  it("destroy() tears the menu down", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, ":ro");
    expect(menuEl()).toBeTruthy();
    editor.destroy();
    expect(menuEl()).toBeNull();
  });
});

describe("emoji: built-in default map", () => {
  it("emoji() with zero config round-trips gemoji-standard codes", () => {
    const codec = createCodec([emoji()]);
    assertRoundTrip(codec, "ship it :rocket: :+1: :tada:");
    expect(codec.parse(":fire:")).toContain("🔥");
  });

  it("defaultEmojiMap is exported and spreads for extension", () => {
    expect(defaultEmojiMap.rocket).toBe("🚀");
    const codec = createCodec([emoji({ map: { ...defaultEmojiMap, shipit: "🐿️" } })]);
    assertRoundTrip(codec, ":shipit: :rocket:");
  });
});

// ── Review regressions: line-local trigger text, IME, caret-inside-query ───

describe("emoji: autocomplete regressions (v0.9.0 review)", () => {
  it("opens at the start of a SECOND list item (typed, not loaded)", () => {
    const editor = mount("- item one");
    editor.focus();
    const li = editor.content.querySelector("li")!;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(li.firstChild as Text, (li.firstChild as Text).length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    pressKey(editor, "Enter"); // engine splits the list item
    expect(editor.content.querySelectorAll("li").length).toBe(2);
    const second = editor.content.querySelectorAll("li")[1];
    second.textContent = ":ro";
    const r2 = document.createRange();
    r2.setStart(second.firstChild as Text, 3);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    editor.content.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menuEl(), "menu opens in the second item").toBeTruthy();
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("- item one\n- :rocket:");
    editor.destroy();
  });

  it("opens after a soft line break (<br>) — the break starts a new line", () => {
    const editor = mount();
    editor.focus();
    const p = editor.content.querySelector("p")!;
    p.innerHTML = "hello<br>:ro";
    const text = p.lastChild as Text;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(text, text.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    editor.content.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menuEl()).toBeTruthy();
    editor.destroy();
  });

  it("menu keys are ignored during IME composition", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, ":ro");
    expect(menuEl()).toBeTruthy();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(ev, "isComposing", { value: true });
    editor.content.dispatchEvent(ev);
    expect(menuEl(), "menu unchanged — the IME owns that Enter").toBeTruthy();
    expect(editor.getMarkdown()).toBe(":ro");
    editor.destroy();
  });

  it("caret moved INSIDE the query: rows refilter and a pick consumes the whole token", () => {
    const editor = mount("", emoji({ map: { smile: "😄", smiley: "😃" } }));
    typeIntoFirstParagraph(editor, ":smi");
    expect(menuEl()).toBeTruthy();
    // ArrowLeft: caret between "m" and "i"
    const text = editor.content.querySelector("p")!.firstChild as Text;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(text, 3); // ":sm|i"
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
    expect(menuEl(), "menu stays open — caret is still inside the token").toBeTruthy();
    pressKey(editor, "Enter");
    // The FULL ":smi" token is consumed — no stray "i" after the chip.
    expect(editor.getMarkdown()).toBe(":smile:");
    editor.destroy();
  });
});
