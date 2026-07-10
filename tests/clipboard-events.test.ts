import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCopyCut, handlePaste, insertMarkdown, type MarkdownPipeline } from "@core/clipboard";
import { sanitizeHtml } from "@core/sanitize";
import { getSelection } from "@core/dom";
import { createCodec } from "edodo-write/testing";
import { highlight } from "edodo-write/plugins";

/**
 * handleCopyCut / handlePaste with hand-rolled clipboardData stubs — jsdom has
 * no real clipboard. The stubs implement exactly the surface the handlers use
 * (getData / setData / preventDefault).
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

function frag(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "ew-content";
  root.contentEditable = "true";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function stubEvent(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  const preventDefault = vi.fn();
  const e = {
    clipboardData: {
      getData: (type: string) => store.get(type) ?? "",
      setData: (type: string, value: string) => void store.set(type, value),
    },
    preventDefault,
  } as unknown as ClipboardEvent;
  return { e, store, preventDefault };
}

function selectContents(node: Node): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(r);
}

function caretAt(node: Node, offset: number): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function caretAtEndOf(node: Node): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** The highlight plugin's exact editor pipeline, for custom-pipeline tests. */
function highlightPipeline(): MarkdownPipeline {
  const codec = createCodec([highlight()]);
  return { parse: codec.parse, serialize: codec.serialize, sanitize: (h) => sanitizeHtml(h) };
}

describe("handleCopyCut", () => {
  it("copy sets BOTH flavors: text/plain is Markdown, text/html is rich", () => {
    const root = frag("<p>Hello <strong>world</strong></p>");
    selectContents(root.querySelector("p")!);
    const { e, store, preventDefault } = stubEvent();

    expect(handleCopyCut(e, false)).toBe(true);
    expect(store.get("text/plain")).toBe("Hello **world**");
    expect(store.get("text/html")).toContain("<strong>world</strong>");
    expect(preventDefault).toHaveBeenCalledOnce();
    // Copy does not touch the document.
    expect(root.textContent).toBe("Hello world");
  });

  it("the HTML flavor is regenerated from Markdown — no ZWSP, no data-task, disabled checkboxes", () => {
    // A task list as the live editor DOM carries it: interactive checkbox,
    // data-task attribute, zero-width caret park after the checkbox.
    const root = frag(
      '<ul class="contains-task-list"><li class="task-list-item" data-task="todo"><input type="checkbox">\u200Btask text</li></ul>',
    );
    selectContents(root);
    const { e, store } = stubEvent();

    expect(handleCopyCut(e, false)).toBe(true);
    expect(store.get("text/plain")).toBe("- [ ] task text");
    const html = store.get("text/html")!;
    expect(html).not.toContain("\u200B");
    expect(html).not.toContain("data-task");
    // GFM's native export semantics: the checkbox is disabled again.
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
  });

  it("cut deletes the selection after writing the clipboard", () => {
    const root = frag("<p>Hello world</p>");
    selectContents(root.querySelector("p")!.firstChild!);
    const { e, store } = stubEvent();

    expect(handleCopyCut(e, true)).toBe(true);
    expect(store.get("text/plain")).toBe("Hello world");
    expect(root.querySelector("p")!.textContent).toBe("");
  });

  it("a collapsed selection is not handled (returns false, clipboard untouched)", () => {
    const root = frag("<p>Hello</p>");
    caretAt(root.querySelector("p")!.firstChild!, 2);
    const { e, store, preventDefault } = stubEvent();

    expect(handleCopyCut(e, false)).toBe(false);
    expect(store.size).toBe(0);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("copies through a plugin pipeline (mark → ==highlight== Markdown)", () => {
    const root = frag("<p>some <mark>hi</mark> words</p>");
    selectContents(root.querySelector("p")!);
    const { e, store } = stubEvent();

    expect(handleCopyCut(e, false, highlightPipeline())).toBe(true);
    expect(store.get("text/plain")).toBe("some ==hi== words");
    expect(store.get("text/html")).toContain("<mark>hi</mark>");
  });
});

describe("handlePaste", () => {
  it("returns false without clipboardData", () => {
    const root = frag("<p><br></p>");
    const e = { clipboardData: null, preventDefault: vi.fn() } as unknown as ClipboardEvent;
    expect(handlePaste(root, e)).toBe(false);
  });

  it("rich HTML becomes real blocks (via Markdown, not raw HTML insertion)", () => {
    const root = frag("<p><br></p>");
    caretAtEndOf(root.querySelector("p")!);
    const { e, preventDefault } = stubEvent({
      "text/html": "<h2>Hi</h2><p>rich <b>bold</b></p>",
      "text/plain": "Hi rich bold",
    });

    expect(handlePaste(root, e)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(root.querySelector("h2")?.textContent).toBe("Hi");
    // <b> came back as canonical <strong> because the paste went through Markdown.
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    // The empty paragraph the caret sat in was consumed.
    expect(root.firstElementChild?.tagName).toBe("H2");
  });

  it("pasted HTML is sanitized (scripts and handlers cannot enter the editor)", () => {
    const root = frag("<p><br></p>");
    caretAtEndOf(root.querySelector("p")!);
    const { e } = stubEvent({
      "text/html": '<p>ok</p><script>alert(1)</script><p onclick="pwn()">click</p>',
      "text/plain": "ok click",
    });

    expect(handlePaste(root, e)).toBe(true);
    expect(root.querySelector("script")).toBeNull();
    expect(root.innerHTML).not.toContain("onclick");
    expect(root.innerHTML).not.toContain("alert(1)");
    expect(root.textContent).toContain("ok");
    expect(root.textContent).toContain("click");
  });

  it("plain text is treated as Markdown and becomes blocks", () => {
    const root = frag("<p><br></p>");
    caretAtEndOf(root.querySelector("p")!);
    const { e } = stubEvent({ "text/plain": "# Title\n\n- a\n- b" });

    expect(handlePaste(root, e)).toBe(true);
    expect(root.querySelector("h1")?.textContent).toBe("Title");
    expect(root.querySelectorAll("ul li").length).toBe(2);
  });

  it("whitespace-only text/html falls back to the text/plain Markdown", () => {
    const root = frag("<p><br></p>");
    caretAtEndOf(root.querySelector("p")!);
    const { e } = stubEvent({ "text/html": "  \n ", "text/plain": "> quoted" });

    expect(handlePaste(root, e)).toBe(true);
    expect(root.querySelector("blockquote")).not.toBeNull();
  });

  it("an empty paste is swallowed (handled, DOM untouched)", () => {
    const root = frag("<p>keep me</p>");
    caretAtEndOf(root.querySelector("p")!);
    const before = root.innerHTML;
    const { e, preventDefault } = stubEvent();

    expect(handlePaste(root, e)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(root.innerHTML).toBe(before);
  });

  it("pastes inline Markdown at the caret, replacing the selected text", () => {
    const root = frag("<p>Hello world</p>");
    const text = root.querySelector("p")!.firstChild!;
    const sel = getSelection()!;
    const r = document.createRange();
    r.setStart(text, 6);
    r.setEnd(text, 11); // "world"
    sel.removeAllRanges();
    sel.addRange(r);
    const { e } = stubEvent({ "text/plain": "**friend**" });

    expect(handlePaste(root, e)).toBe(true);
    expect(root.querySelectorAll("p").length).toBe(1);
    expect(root.querySelector("strong")?.textContent).toBe("friend");
    expect(root.textContent).not.toContain("world");
  });

  describe("lone-URL-over-selection → createLink branch (jsdom execCommand is a no-op; assert via spy)", () => {
    const execSpy = vi.fn();
    let original: unknown;

    beforeEach(() => {
      original = (document as unknown as Record<string, unknown>).execCommand;
      (document as unknown as Record<string, unknown>).execCommand = execSpy;
      execSpy.mockClear();
    });

    afterEach(() => {
      (document as unknown as Record<string, unknown>).execCommand = original;
    });

    it("a bare URL pasted over a selection goes through execCommand('createLink')", () => {
      const root = frag("<p>select me</p>");
      selectContents(root.querySelector("p")!.firstChild!);
      const { e } = stubEvent({ "text/plain": "  https://example.com/x?y=1  " });

      expect(handlePaste(root, e)).toBe(true);
      expect(execSpy).toHaveBeenCalledTimes(1);
      expect(execSpy).toHaveBeenCalledWith("createLink", false, "https://example.com/x?y=1");
      // No block insertion happened (execCommand is the whole action).
      expect(root.querySelectorAll("p").length).toBe(1);
      expect(root.textContent).toBe("select me");
    });

    it("a bare URL at a collapsed caret is NOT linkified — it inserts as Markdown", () => {
      const root = frag("<p>text here</p>");
      caretAtEndOf(root.querySelector("p")!);
      const { e } = stubEvent({ "text/plain": "https://example.com" });

      expect(handlePaste(root, e)).toBe(true);
      expect(execSpy).not.toHaveBeenCalled();
      // GFM autolinking turned the pasted URL into a real anchor.
      expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    });

    it("a URL with an HTML flavor alongside skips the createLink branch", () => {
      const root = frag("<p>select me</p>");
      selectContents(root.querySelector("p")!.firstChild!);
      const { e } = stubEvent({
        "text/plain": "https://example.com",
        "text/html": '<p><a href="https://example.com">https://example.com</a></p>',
      });

      expect(handlePaste(root, e)).toBe(true);
      expect(execSpy).not.toHaveBeenCalled();
      expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    });

    it("non-URL text over a selection is a normal Markdown paste", () => {
      const root = frag("<p>select me</p>");
      selectContents(root.querySelector("p")!.firstChild!);
      const { e } = stubEvent({ "text/plain": "not a url" });

      expect(handlePaste(root, e)).toBe(true);
      expect(execSpy).not.toHaveBeenCalled();
      expect(root.textContent).toBe("not a url");
    });
  });

  it("pastes plugin Markdown through a custom pipeline (==x== → <mark>)", () => {
    const root = frag("<p>before after</p>");
    caretAt(root.querySelector("p")!.firstChild!, 7);
    const { e } = stubEvent({ "text/plain": "==hl==" });

    expect(handlePaste(root, e, highlightPipeline())).toBe(true);
    expect(root.querySelectorAll("p").length).toBe(1);
    expect(root.querySelector("mark")?.textContent).toBe("hl");
  });
});

describe("insertMarkdown split semantics with a custom pipeline (highlight codec)", () => {
  it("inline plugin markdown inserts inline — no new blocks", () => {
    const root = frag("<p>before after</p>");
    caretAt(root.querySelector("p")!.firstChild!, 7);

    insertMarkdown(root, "==hi==", highlightPipeline());
    expect(root.querySelectorAll("p").length).toBe(1);
    expect(root.querySelector("mark")?.textContent).toBe("hi");
    expect(root.textContent).toContain("before");
    expect(root.textContent).toContain("after");
  });

  it("multi-block markdown splits the paragraph; the tail becomes a trailing paragraph", () => {
    const root = frag("<p>before after</p>");
    caretAt(root.querySelector("p")!.firstChild!, 7); // after "before "

    insertMarkdown(root, "# New\n\n==x== body", highlightPipeline());
    expect(root.querySelector("h1")?.textContent).toBe("New");
    expect(root.querySelector("mark")?.textContent).toBe("x");
    const paragraphs = Array.from(root.querySelectorAll("p")).map((p) => p.textContent);
    expect(paragraphs.some((t) => t?.includes("before"))).toBe(true);
    expect(paragraphs.some((t) => t?.includes("after"))).toBe(true);
  });

  it("pasting blocks into an empty paragraph consumes it", () => {
    const root = frag("<p><br></p>");
    caretAtEndOf(root.querySelector("p")!);

    insertMarkdown(root, "# A\n\nb", highlightPipeline());
    expect(root.firstElementChild?.tagName).toBe("H1");
    expect(root.children.length).toBe(2);
    expect(root.children[1].textContent).toBe("b");
  });
});
