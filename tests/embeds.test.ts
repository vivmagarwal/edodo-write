/**
 * Embeds plugin — jsdom side: the URL classifier, the reconciliation pass
 * (lone-URL paragraph → widget, caret-safe, opt-out respected), the paired
 * turndown rules, bookmark metadata, and the round-trip contract.
 * Real clicking/typing (popover actions, type-then-Enter) lives in
 * tests/e2e/embeds.spec.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { EdodoWrite } from "@core/editor";
import { embeds, classifyEmbedUrl } from "../src/plugins/embeds";
import { createCodec, assertRoundTrip } from "../src/lib/testing";

// jsdom lacks Range.getClientRects — stub for selection-driven paths.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

function mount(options: ConstructorParameters<typeof EdodoWrite>[1] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, options);
}

function placeCaretAtEnd(el: HTMLElement) {
  const sel = window.getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Fire `input` and wait out the editor's ~120 ms change debounce. */
async function settle(editor: EdodoWrite) {
  editor.content.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
}

describe("classifyEmbedUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42", { kind: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://youtu.be/abc123xyz", { kind: "youtube", id: "abc123xyz" }],
    ["https://www.youtube.com/shorts/abc123xyz", { kind: "youtube", id: "abc123xyz" }],
    ["https://www.youtube.com/embed/abc123xyz", { kind: "youtube", id: "abc123xyz" }],
    ["https://vimeo.com/123456789", { kind: "vimeo", id: "123456789" }],
    ["https://vimeo.com/about", { kind: "bookmark" }],
    ["https://example.com/clip.mp4", { kind: "video" }],
    ["https://example.com/clip.webm?dl=1", { kind: "video" }],
    ["https://example.com/clip.MOV", { kind: "video" }],
    ["https://example.com/song.mp3", { kind: "audio" }],
    ["https://example.com/take.m4a", { kind: "audio" }],
    ["https://example.com/blog/post", { kind: "bookmark" }],
    ["not a url", { kind: "bookmark" }],
  ])("%s → %j", (url, expected) => {
    expect(classifyEmbedUrl(url)).toEqual(expected);
  });
});

describe("reconciliation pass", () => {
  it("hydrates a lone-URL initial value into an embed widget (setup pass)", async () => {
    const editor = mount({ value: "https://youtu.be/abc123xyz", plugins: [embeds()] });
    const figure = editor.content.querySelector('figure[data-widget="embed"]')!;
    expect(figure).toBeTruthy();
    expect(figure.getAttribute("data-source")).toBe("https://youtu.be/abc123xyz");
    await vi.waitFor(() => {
      const iframe = figure.querySelector("iframe.ew-embed__frame") as HTMLIFrameElement;
      expect(iframe?.src).toBe("https://www.youtube-nocookie.com/embed/abc123xyz");
    });
    // The Markdown is still exactly the bare URL line — byte round-trip.
    expect(editor.getMarkdown()).toBe("https://youtu.be/abc123xyz");
    editor.destroy();
  });

  it("never converts a deliberately written [title](url) link (the opt-out)", () => {
    const md = "[watch this](https://youtu.be/abc123xyz)";
    const editor = mount({ value: md, plugins: [embeds()] });
    expect(editor.content.querySelector("figure")).toBeNull();
    expect(editor.getMarkdown()).toBe(md);
    editor.destroy();
  });

  it("leaves the paragraph alone while the caret is inside it", async () => {
    const editor = mount({ value: "first line\n\nplaceholder", plugins: [embeds()] });
    editor.focus();
    const second = editor.content.querySelectorAll("p")[1]!;
    second.textContent = "https://youtu.be/abc123xyz";
    placeCaretAtEnd(second);
    await settle(editor);
    expect(editor.content.querySelector("figure")).toBeNull();
    // …but converts once the caret has left the line.
    placeCaretAtEnd(editor.content.querySelector("p")!);
    await settle(editor);
    expect(editor.content.querySelector('figure[data-widget="embed"]')).toBeTruthy();
    expect(editor.getMarkdown()).toBe("first line\n\nhttps://youtu.be/abc123xyz");
    editor.destroy();
  });

  it("does not embed a URL that is part of a sentence", () => {
    const md = "visit [https://example.com](https://example.com) now";
    const editor = mount({ value: md, plugins: [embeds()] });
    expect(editor.content.querySelector("figure")).toBeNull();
    expect(editor.getMarkdown()).toBe(md);
    editor.destroy();
  });
});

describe("bookmark metadata", () => {
  it("uses options.fetchMetadata for the card", async () => {
    const fetchMetadata = vi.fn(async () => ({
      title: "A Great Post",
      description: "Words about things.",
    }));
    const editor = mount({
      value: "https://example.com/blog/post",
      plugins: [embeds({ fetchMetadata })],
    });
    await vi.waitFor(() => {
      const card = editor.content.querySelector(".ew-embed__card")!;
      expect(card).toBeTruthy();
      expect(card.querySelector(".ew-embed__card-title")?.textContent).toBe("A Great Post");
      expect(card.querySelector(".ew-embed__card-desc")?.textContent).toBe("Words about things.");
      expect(card.querySelector(".ew-embed__card-url")?.textContent).toBe("https://example.com/blog/post");
    });
    expect(fetchMetadata).toHaveBeenCalledWith("https://example.com/blog/post");
    editor.destroy();
  });

  it("falls back to the hostname when fetchMetadata rejects", async () => {
    const fetchMetadata = vi.fn(async () => { throw new Error("network down"); });
    const editor = mount({
      value: "https://example.com/blog/post",
      plugins: [embeds({ fetchMetadata })],
    });
    await vi.waitFor(() => {
      expect(
        editor.content.querySelector(".ew-embed__card-title")?.textContent,
      ).toBe("example.com");
    });
    expect(editor.content.querySelector(".ew-widget__error")).toBeNull();
    editor.destroy();
  });
});

describe("round-trip contract", () => {
  const codec = createCodec([embeds()]);

  it("figure widget serializes to the bare URL line", () => {
    expect(
      codec.serialize('<figure data-widget="embed" data-source="https://youtu.be/abc123xyz"></figure>'),
    ).toBe("https://youtu.be/abc123xyz");
  });

  it("a not-yet-hydrated lone autolink paragraph serializes to the same bare line", () => {
    expect(
      codec.serialize('<p><a href="https://youtu.be/abc123xyz">https://youtu.be/abc123xyz</a></p>'),
    ).toBe("https://youtu.be/abc123xyz");
  });

  it("a doc mixing embeds and normal links is byte-stable", () => {
    const doc = [
      "# Media",
      "",
      "intro with a [real link](https://example.com/page) in prose",
      "",
      "https://youtu.be/abc123xyz",
      "",
      "https://example.com/clip.mp4",
      "",
      "closing words with **bold**",
    ].join("\n");
    assertRoundTrip(codec, doc);
    assertRoundTrip(codec, "[title](https://youtu.be/abc123xyz)");
    assertRoundTrip(codec, "visit [https://example.com](https://example.com) now");
  });

  it("degrades to a plain clickable link without the plugin (lossless GFM)", () => {
    const plain = createCodec([]);
    const html = plain.parse("https://youtu.be/abc123xyz");
    expect(html).toContain('<a href="https://youtu.be/abc123xyz">');
    expect(html).not.toContain("figure");
  });
});
