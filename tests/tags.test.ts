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

describe("multi-instance decoration", () => {
  it("# and @ chips decorate independently — no instance strips the other's", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, {
      value: "[@vivek](https://example.com/u/vivek) shipped [#roadmap](https://example.com/t/roadmap)",
      plugins: [
        tags({ source: () => [] }),
        tags({ name: "mentions", trigger: "@", source: () => [] }),
      ],
    });
    const chips = editor.content.querySelectorAll("a.ew-tag");
    expect(chips.length).toBe(2);
    // ownership marks are live-DOM only — never in the Markdown
    expect(editor.getMarkdown()).toBe(
      "[@vivek](https://example.com/u/vivek) shipped [#roadmap](https://example.com/t/roadmap)",
    );
    editor.destroy();
  });
});

// ── RFC §5 — configurable mention token ──────────────────────────────────────

type ResolveMention = (id: string, fallbackDisplay: string) => { display: string } | null;

function mentionPlugin(resolveMention?: ResolveMention) {
  return tags({
    name: "mentions",
    trigger: "@",
    source: () => [],
    allowBroadcast: { id: "@channel", display: "channel" },
    serialize: (i) => `@[${i.display}](${i.id})`,
    parse: {
      pattern: /@\[([^\]]+)\]\(([^)\s]+)\)/g,
      toItem: (m) => ({ display: m[1], id: m[2] }),
    },
    resolveMention,
  });
}

describe("tags: custom mention token (RFC §5)", () => {
  it("the EDODO fixture round-trips byte-stable", () => {
    const codec = createCodec([mentionPlugin()]);
    assertRoundTrip(codec, "hi @[Alice](u_1) and @[channel](@channel)");
  });

  it("renders a chip with the right data-* attrs and a leading @", () => {
    const codec = createCodec([mentionPlugin()]);
    const html = codec.parse("hi @[Alice](u_1)");
    expect(html).toContain('class="ew-mention"');
    expect(html).toContain('data-mention-id="u_1"');
    expect(html).toContain('data-mention-display="Alice"');
    expect(html).toContain(">@Alice<");
  });

  it("the @channel broadcast token round-trips and keeps its id", () => {
    const codec = createCodec([mentionPlugin()]);
    const html = codec.parse("@[channel](@channel)");
    expect(html).toContain('data-mention-id="@channel"');
    expect(html).toContain('data-mention-display="channel"');
    expect(codec.serialize(html)).toBe("@[channel](@channel)");
  });

  it("resolveMention relabels the visible text but never the stored token", () => {
    const codec = createCodec([
      mentionPlugin((id) => (id === "u_1" ? { display: "Deleted user" } : null)),
    ]);
    const html = codec.parse("hi @[Alice](u_1)");
    expect(html).toContain(">@Deleted user<");             // visible relabel
    expect(html).toContain('data-mention-display="Alice"'); // frozen token unchanged
    expect(codec.serialize(html)).toBe("hi @[Alice](u_1)"); // serialises to the ORIGINAL
  });

  it("mentions survive inside lists and blockquotes", () => {
    const codec = createCodec([mentionPlugin()]);
    assertRoundTrip(codec, "- @[Bob](u_2) in a list");
    assertRoundTrip(codec, "> quoted @[Bob](u_2)");
  });

  it("attribute-hostile display/id survive round-trip", () => {
    const codec = createCodec([mentionPlugin()]);
    assertRoundTrip(codec, "hey @[A & B](u_3)");
  });

  it("omitting serialize/parse keeps the pure-GFM path (no token extension)", () => {
    const codec = createCodec([tags({ name: "mentions", trigger: "@", source: () => [] })]);
    const html = codec.parse("see @[x](y)");
    expect(html).not.toContain("data-mention-id");
  });
});

describe("tags: interactive pick emits the custom token (RFC §5)", () => {
  const USERS: TagItem[] = [{ label: "Alice", id: "u_1", display: "Alice" }];
  const userSource = (q: string) =>
    USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase()));

  function pickableMention() {
    return tags({
      name: "mentions",
      trigger: "@",
      source: userSource,
      allowBroadcast: { id: "@channel", display: "channel" },
      serialize: (i) => `@[${i.display}](${i.id})`,
      parse: {
        pattern: /@\[([^\]]+)\]\(([^)\s]+)\)/g,
        toItem: (m) => ({ display: m[1], id: m[2] }),
      },
    });
  }

  it("picking a suggestion inserts a chip that serializes to @[Display](id)", () => {
    const editor = mount("", pickableMention());
    typeIntoFirstParagraph(editor, "@Al");
    expect(menuEl()).toBeTruthy();
    expect(menuEl()!.textContent).toContain("@Alice");
    pressKey(editor, "Enter");
    expect(menuEl()).toBeNull();
    // A live chip, not a GFM link or plain text.
    expect(editor.content.querySelector("span.ew-mention")).toBeTruthy();
    expect(editor.getHTML()).toContain('data-mention-id="u_1"');
    expect(editor.getHTML()).not.toContain("<a");
    // …and it serializes as the exact custom token.
    expect(editor.getMarkdown()).toBe("@[Alice](u_1)");
    editor.destroy();
  });

  it("picking mid-line only replaces the trigger+query span", () => {
    const editor = mount("", pickableMention());
    typeIntoFirstParagraph(editor, "hey @Al");
    pressKey(editor, "Enter");
    expect(editor.getMarkdown()).toBe("hey @[Alice](u_1)");
    editor.destroy();
  });

  it("the allowBroadcast entry picks to the broadcast token", () => {
    const editor = mount("", pickableMention());
    typeIntoFirstParagraph(editor, "@");
    expect(menuEl()).toBeTruthy();
    expect(menuEl()!.textContent).toContain("@channel");
    pressKey(editor, "Enter"); // broadcast leads the menu → index 0
    expect(editor.getMarkdown()).toBe("@[channel](@channel)");
    editor.destroy();
  });

  it("a picked token round-trips byte-stable after reload", () => {
    const editor = mount("", pickableMention());
    typeIntoFirstParagraph(editor, "@Al");
    pressKey(editor, "Enter");
    const md = editor.getMarkdown();
    editor.destroy();
    // Re-mount from the saved markdown — the chip must hydrate + re-serialize.
    const reopened = mount(md, pickableMention());
    expect(reopened.content.querySelector("span.ew-mention")).toBeTruthy();
    expect(reopened.getMarkdown()).toBe("@[Alice](u_1)");
    reopened.destroy();
  });

  it("a custom render() is used for the newly-picked chip too", () => {
    const editor = mount(
      "",
      tags({
        name: "mentions",
        trigger: "@",
        source: userSource,
        serialize: (i) => `@[${i.display}](${i.id})`,
        parse: {
          pattern: /@\[([^\]]+)\]\(([^)\s]+)\)/g,
          toItem: (m) => ({ display: m[1], id: m[2] }),
        },
        render: (item) => {
          const el = document.createElement("span");
          el.className = "ew-mention custom";
          el.dataset.mentionId = item.id;
          el.dataset.mentionDisplay = item.display;
          el.setAttribute("contenteditable", "false");
          el.textContent = `@${item.display}`;
          return el;
        },
      }),
    );
    typeIntoFirstParagraph(editor, "@Al");
    pressKey(editor, "Enter");
    expect(editor.content.querySelector("span.custom")).toBeTruthy();
    expect(editor.getMarkdown()).toBe("@[Alice](u_1)");
    editor.destroy();
  });
});

describe("tags: mention chips in a live editor", () => {
  it("loads a stored token as a chip and round-trips on save", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, {
      value: "hi @[Alice](u_1)",
      plugins: [mentionPlugin()],
    });
    expect(editor.getHTML()).toContain('data-mention-id="u_1"');
    expect(editor.content.querySelector("span.ew-mention")).toBeTruthy();
    expect(editor.getMarkdown()).toBe("hi @[Alice](u_1)");
    editor.destroy();
  });

  it("a custom render() builds the chip and it still round-trips", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, {
      value: "hi @[Alice](u_1)",
      plugins: [
        tags({
          name: "mentions",
          trigger: "@",
          source: () => [],
          serialize: (i) => `@[${i.display}](${i.id})`,
          parse: {
            pattern: /@\[([^\]]+)\]\(([^)\s]+)\)/g,
            toItem: (m) => ({ display: m[1], id: m[2] }),
          },
          render: (item) => {
            const el = document.createElement("span");
            el.className = "ew-mention custom";
            el.dataset.mentionId = item.id;
            el.dataset.mentionDisplay = item.display;
            el.setAttribute("contenteditable", "false");
            el.textContent = `@${item.display}`;
            return el;
          },
        }),
      ],
    });
    expect(editor.content.querySelector("span.custom")).toBeTruthy();
    expect(editor.getMarkdown()).toBe("hi @[Alice](u_1)");
    editor.destroy();
  });
});
