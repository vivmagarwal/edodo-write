import { describe, it, expect, beforeEach } from "vitest";
import { EdodoWrite } from "@core/editor";
import { insertMarkdown } from "@core/clipboard";
import { getSelection } from "@core/dom";

beforeEach(() => { document.body.innerHTML = ""; });

function frag(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "ew-content";
  root.contentEditable = "true";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}
function caretAtEndOf(node: Node): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}
function mount(value = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, { value });
}

describe("insertMarkdown (paste)", () => {
  it("inserts multiple blocks from markdown", () => {
    const root = frag("<p><br></p>");
    caretAtEndOf(root.querySelector("p")!);
    insertMarkdown(root, "## Heading\n\n- a\n- b\n\n> quote");
    expect(root.querySelector("h2")?.textContent).toBe("Heading");
    expect(root.querySelectorAll("ul li").length).toBe(2);
    expect(root.querySelector("blockquote")).not.toBeNull();
  });

  it("inserts inline markdown at the caret without new blocks", () => {
    const root = frag("<p>start end</p>");
    const p = root.querySelector("p")!;
    const sel = getSelection()!;
    const r = document.createRange();
    r.setStart(p.firstChild!, 6); // between "start " and "end"
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    insertMarkdown(root, "**bold**");
    expect(root.querySelectorAll("p").length).toBe(1);
    expect(root.querySelector("strong")?.textContent).toBe("bold");
  });

  it("splits the current block when pasting blocks mid-paragraph", () => {
    const root = frag("<p>before after</p>");
    const p = root.querySelector("p")!;
    const sel = getSelection()!;
    const r = document.createRange();
    r.setStart(p.firstChild!, 7); // after "before "
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    insertMarkdown(root, "# New\n\nblock");
    expect(root.querySelector("h1")?.textContent).toBe("New");
    // "after" survives as trailing text
    expect(root.textContent).toContain("after");
    expect(root.textContent).toContain("before");
  });
});

describe("undo / redo", () => {
  it("undo restores the previous markdown; redo re-applies it", () => {
    const ed = mount("# One");
    ed.setMarkdown("# Two");
    ed.setMarkdown("# Three");
    expect(ed.getMarkdown()).toBe("# Three");
    ed.undo();
    expect(ed.getMarkdown()).toBe("# Two");
    ed.undo();
    expect(ed.getMarkdown()).toBe("# One");
    ed.redo();
    expect(ed.getMarkdown()).toBe("# Two");
    ed.destroy();
  });

  it("a new edit after undo truncates the redo tail", () => {
    const ed = mount("a");
    ed.setMarkdown("b");
    ed.setMarkdown("c");
    ed.undo(); // → b
    ed.setMarkdown("d"); // branch; redo tail (c) dropped
    ed.redo(); // nothing to redo
    expect(ed.getMarkdown()).toBe("d");
    ed.destroy();
  });

  it("undo at the beginning is a no-op", () => {
    const ed = mount("only");
    ed.undo();
    ed.undo();
    expect(ed.getMarkdown()).toBe("only");
    ed.destroy();
  });
});
