import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";
import { tags, type TagItem } from "../src/plugins/tags";
import { createCodec, assertRoundTrip } from "../src/lib/testing";

// jsdom lacks Range.getClientRects — stub so the menu popover can anchor
// itself to the selection (real browsers never need this).
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const ITEMS: TagItem[] = [
  { label: "alpha", href: "https://example.com/tags/alpha" },
  { label: "beta", href: "https://example.com/tags/beta" },
  { label: "gamma" },
];
const staticSource = (query: string) => ITEMS.filter((t) => t.label.startsWith(query.toLowerCase()));

function mount(value = "", plugin = tags({ source: staticSource })) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, { value, plugins: [plugin] });
}

/** Simulate having typed `text` into the first paragraph: set the content,
 *  park the caret at the end of the TEXT node (where real typing leaves it),
 *  and fire `input`. */
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

function pressKey(editor: EdodoWrite, key: string): void {
  editor.content.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

function menuEl(): HTMLElement | null {
  return document.querySelector(".ew-popover.ew-menu");
}

describe("tags: picking", () => {
  it("a linked item inserts a chip that serializes as a plain GFM link", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "#al");
    expect(menuEl()).toBeTruthy();
    expect(menuEl()!.textContent).toContain("#alpha");
    pressKey(editor, "Enter");
    expect(menuEl()).toBeNull();
    expect(editor.getHTML()).toContain('class="ew-tag"');
    expect(editor.getMarkdown()).toBe("[#alpha](https://example.com/tags/alpha)");
    editor.destroy();
  });

  it("works mid-line: only the trigger+query span is replaced", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "hello #be");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("hello [#beta](https://example.com/tags/beta)");
    editor.destroy();
  });

  it("an item without any href inserts plain text", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "#ga");
    expect(menuEl()!.textContent).toContain("#gamma");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("#gamma");
    expect(editor.getHTML()).not.toContain("<a");
    editor.destroy();
  });

  it("options.href derives links for items without one", () => {
    const editor = mount("", tags({
      source: (q) => ITEMS.filter((t) => t.label.startsWith(q)),
      href: (item) => `https://t.example/${item.label}`,
    }));
    typeIntoFirstParagraph(editor, "#ga");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("[#gamma](https://t.example/gamma)");
    editor.destroy();
  });
});

describe("tags: create", () => {
  it("offers Create #query when nothing matches and inserts it", () => {
    const editor = mount("", tags({ source: () => [] }));
    typeIntoFirstParagraph(editor, "#zz");
    expect(menuEl()!.textContent).toContain("Create #zz");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("#zz");
    editor.destroy();
  });

  it("created tags get an href through options.href", () => {
    const editor = mount("", tags({ source: () => [], href: (it) => `https://t.example/${it.label}` }));
    typeIntoFirstParagraph(editor, "#zz");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("[#zz](https://t.example/zz)");
    editor.destroy();
  });

  it("allowCreate: false keeps the menu closed for non-matching queries", () => {
    const editor = mount("", tags({ source: () => [], allowCreate: false }));
    typeIntoFirstParagraph(editor, "#zz");
    expect(menuEl()).toBeNull();
    editor.destroy();
  });
});

describe("tags: menu behavior", () => {
  it("never opens inside code blocks", () => {
    const editor = mount("```\ncode\n```");
    editor.focus();
    const code = editor.content.querySelector("pre code")!;
    code.textContent = "code #a";
    const node = code.firstChild as Text;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(node, node.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    editor.content.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menuEl()).toBeNull();
    editor.destroy();
  });

  it("Escape closes the menu and leaves the typed text alone", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "#al");
    expect(menuEl()).toBeTruthy();
    pressKey(editor, "Escape");
    expect(menuEl()).toBeNull();
    expect(editor.getMarkdown()).toBe("#al");
    editor.destroy();
  });

  it("destroy() tears the menu down", () => {
    const editor = mount();
    typeIntoFirstParagraph(editor, "#al");
    expect(menuEl()).toBeTruthy();
    editor.destroy();
    expect(menuEl()).toBeNull();
  });

  it("discards stale async source results by sequence number", async () => {
    const resolvers: Record<string, (items: TagItem[]) => void> = {};
    const source = (q: string) => new Promise<TagItem[]>((res) => { resolvers[q] = res; });
    const editor = mount("", tags({ source }));
    typeIntoFirstParagraph(editor, "#a");   // slow first query…
    typeIntoFirstParagraph(editor, "#ab");  // …superseded before it resolves
    resolvers["ab"]([{ label: "abnew" }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(menuEl()!.textContent).toContain("#abnew");
    resolvers["a"]([{ label: "astale" }]);  // the slow one lands late — stale
    await new Promise((r) => setTimeout(r, 0));
    expect(menuEl()!.textContent).toContain("#abnew");
    expect(menuEl()!.textContent).not.toContain("astale");
    editor.destroy();
  });
});

describe("tags: decoration", () => {
  it("stored tag links hydrate with the ew-tag chip class", () => {
    const editor = mount("[#alpha](https://example.com/tags/alpha)");
    expect(editor.getHTML()).toContain('class="ew-tag"');
    expect(editor.getMarkdown()).toBe("[#alpha](https://example.com/tags/alpha)");
    editor.destroy();
  });

  it("ordinary links are left undecorated", () => {
    const editor = mount("[docs](https://example.com/docs)");
    expect(editor.getHTML()).not.toContain("ew-tag");
    editor.destroy();
  });
});

describe("tags: round-trip (pure GFM — no markdown extensions)", () => {
  const codec = createCodec([tags({ source: () => [] })]);

  it("both tag forms are byte-stable", () => {
    assertRoundTrip(codec, "[#alpha](https://example.com/tags/alpha)");
    assertRoundTrip(codec, "#gamma");
    assertRoundTrip(codec, "tagged [#alpha](https://example.com/tags/alpha) and #gamma mid-line");
  });

  it("tags survive inside list items and blockquotes", () => {
    assertRoundTrip(codec, "- [#alpha](https://example.com/tags/alpha) in a list");
    assertRoundTrip(codec, "> quoted #tag and [#beta](https://example.com/tags/beta)");
  });

  it("a plain-GFM corpus is unaffected", () => {
    assertRoundTrip(codec, "# Heading\n\nSome **bold** text and a [link](https://example.com)\n\n- a\n- b");
  });
});

describe("multiple tags instances", () => {
  it("distinct names allow #tags and @mentions in one editor", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, {
      plugins: [
        tags({ source: () => [] }),
        tags({ name: "mentions", trigger: "@", source: () => [] }),
      ],
    });
    editor.destroy();
  });

  it("two instances WITHOUT distinct names still throw (collision safety)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    expect(() => new EdodoWrite(host, {
      plugins: [tags({ source: () => [] }), tags({ trigger: "@", source: () => [] })],
    })).toThrow(/duplicate plugin name/);
  });
});
