/**
 * The Enter / Backspace / Tab semantics matrix, exercised in jsdom.
 *
 * Real KeyboardEvents are dispatched through a mounted EdodoWrite's content
 * element, so the full path runs: editor.onKeyDown → handleKeydown (registered
 * bindings, then the structural engine) → afterMutation (normalize + history).
 * jsdom performs no native contentEditable editing, so every DOM change
 * asserted here was made by the engine's manual Range surgery.
 *
 * Each test asserts BOTH the serialized Markdown and the DOM shape.
 */
import { describe, it, expect, afterEach } from "vitest";
import { EdodoWrite } from "@core/editor";
import { getSelection } from "@core/dom";

const ZWSP = String.fromCharCode(0x200b);

const editors: EdodoWrite[] = [];

function mount(value = ""): EdodoWrite {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ed = new EdodoWrite(host, { value, toolbar: false, slashMenu: false });
  editors.push(ed);
  return ed;
}

afterEach(() => {
  for (const ed of editors.splice(0)) ed.destroy();
  document.body.innerHTML = "";
});

/** Dispatch a real keydown on the editor's content element. Returns true when
 *  the engine handled it (i.e. preventDefault was called). */
function press(ed: EdodoWrite, key: string, init: KeyboardEventInit = {}): boolean {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  return !ed.content.dispatchEvent(ev);
}

function caretAtStart(node: Node): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function caretAtEnd(node: Node): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

function caretIn(node: Node, offset: number): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ── Enter ──────────────────────────────────────────────────────────────────

describe("Enter", () => {
  it("at the end of a heading starts a paragraph, not another heading", () => {
    const ed = mount("# Title");
    caretAtEnd(ed.content.querySelector("h1")!);
    expect(press(ed, "Enter")).toBe(true);

    const children = Array.from(ed.content.children).map((c) => c.tagName);
    expect(children).toEqual(["H1", "P"]);
    const p = ed.content.children[1] as HTMLElement;
    expect(p.innerHTML).toBe("<br>"); // placeable caret in the empty paragraph
    // caret landed in the new paragraph
    const sel = getSelection()!;
    expect(p.contains(sel.anchorNode) || sel.anchorNode === p).toBe(true);

    p.textContent = "body"; // "type" into it
    expect(ed.getMarkdown()).toBe("# Title\n\nbody");
  });

  it("mid-heading splits it and the tail becomes a paragraph", () => {
    const ed = mount("# HeadTail");
    const text = ed.content.querySelector("h1")!.firstChild!;
    caretIn(text, 4); // Head | Tail
    expect(press(ed, "Enter")).toBe(true);

    expect(ed.content.querySelector("h1")!.textContent).toBe("Head");
    expect(ed.content.querySelector("p")!.textContent).toBe("Tail");
    expect(ed.getMarkdown()).toBe("# Head\n\nTail");
  });

  it("in a list item splits it into two items", () => {
    const ed = mount("- alpha");
    const text = ed.content.querySelector("li")!.firstChild!;
    caretIn(text, 2); // al | pha
    expect(press(ed, "Enter")).toBe(true);

    const items = ed.content.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("al");
    expect(items[1].textContent).toBe("pha");
    expect(ed.getMarkdown()).toBe("- al\n- pha");
  });

  it("in an EMPTY list item exits the list into a paragraph", () => {
    const ed = mount("- one");
    caretAtEnd(ed.content.querySelector("li")!);
    expect(press(ed, "Enter")).toBe(true); // creates an empty second item
    expect(press(ed, "Enter")).toBe(true); // empty item → exit

    const children = Array.from(ed.content.children).map((c) => c.tagName);
    expect(children).toEqual(["UL", "P"]);
    expect(ed.content.querySelectorAll("li").length).toBe(1);
    expect(ed.getMarkdown()).toBe("- one");

    (ed.content.children[1] as HTMLElement).textContent = "outside";
    expect(ed.getMarkdown()).toBe("- one\n\noutside");
  });

  it("in a task item carries an UNCHECKED checkbox into the new item", () => {
    const ed = mount("- [x] done");
    caretAtEnd(ed.content.querySelector("li")!);
    expect(press(ed, "Enter")).toBe(true);

    const items = ed.content.querySelectorAll("li");
    expect(items.length).toBe(2);
    const next = items[1] as HTMLElement;
    expect(next.classList.contains("task-list-item")).toBe(true);
    expect(next.getAttribute("data-task")).toBe("todo");
    const box = next.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.checked).toBe(false); // never inherits the checked state
    // The zero-width text anchor parks the caret after the checkbox.
    expect(box.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect((box.nextSibling as Text).data).toContain(ZWSP);

    (box.nextSibling as Text).appendData("next"); // "type" into the item
    expect(ed.getMarkdown()).toBe("- [x] done\n- [ ] next");
  });

  it("in a code block inserts a newline (ZWSP terminator trick), never a new block", () => {
    const ed = mount("```\ncode\n```");
    const codeText = ed.content.querySelector("pre code")!.firstChild as Text;
    caretIn(codeText, 4); // end of "code", before the terminating \n
    expect(press(ed, "Enter")).toBe(true);

    expect(ed.content.children.length).toBe(1); // still one <pre>, no split
    expect(ed.content.children[0].tagName).toBe("PRE");
    // "\n" + ZWSP makes the new line real and the caret placeable on it.
    expect(ed.content.querySelector("code")!.textContent).toBe(`code\n${ZWSP}\n`);
    const range = getSelection()!.getRangeAt(0);
    expect((range.startContainer as Text).data).toBe(`\n${ZWSP}`);
    expect(range.startOffset).toBe(1); // between the newline and the ZWSP

    range.insertNode(document.createTextNode("more")); // "type" on the new line
    expect(ed.getMarkdown()).toBe("```\ncode\nmore\n```");
  });

  it("in a table cell moves DOWN a row (header → first body cell)", () => {
    const ed = mount("| a | b |\n| --- | --- |\n| 1 | 2 |");
    caretAtEnd(ed.content.querySelector("th")!);
    expect(press(ed, "Enter")).toBe(true);

    const sel = getSelection()!;
    const firstTd = ed.content.querySelector("td")!;
    expect(firstTd.contains(sel.anchorNode) || sel.anchorNode === firstTd).toBe(true);
    // The table itself was not split or duplicated.
    expect(ed.content.querySelectorAll("table").length).toBe(1);
  });

  it("in the LAST row escapes to a new paragraph below the table", () => {
    const ed = mount("| a | b |\n| --- | --- |\n| 1 | 2 |");
    caretAtEnd(ed.content.querySelector("td")!); // "1" — last row
    expect(press(ed, "Enter")).toBe(true);

    const table = ed.content.querySelector("table")!;
    const after = table.nextElementSibling as HTMLElement;
    expect(after?.tagName).toBe("P");
    const sel = getSelection()!;
    expect(after.contains(sel.anchorNode) || sel.anchorNode === after).toBe(true);
    expect(ed.content.querySelectorAll("table").length).toBe(1);
    expect(ed.getMarkdown()).toContain("| 1");
  });

  it("Shift+Enter inserts a soft line break within the block", () => {
    const ed = mount("ab");
    caretIn(ed.content.querySelector("p")!.firstChild!, 1); // a | b
    expect(press(ed, "Enter", { shiftKey: true })).toBe(true);

    expect(ed.content.querySelectorAll("p").length).toBe(1);
    expect(ed.content.querySelector("p br")).not.toBeNull();
    expect(ed.getMarkdown()).toBe("a\\\nb"); // backslash hard break
  });
});

// ── Backspace ───────────────────────────────────────────────────────────────

describe("Backspace", () => {
  it("at the start of a heading converts it to a paragraph", () => {
    const ed = mount("# Title");
    caretAtStart(ed.content.querySelector("h1")!);
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.querySelector("h1")).toBeNull();
    expect(ed.content.querySelector("p")!.textContent).toBe("Title");
    expect(ed.getMarkdown()).toBe("Title");
  });

  it("at the start of a blockquote converts it to a paragraph", () => {
    const ed = mount("> quoted");
    caretAtStart(ed.content.querySelector("blockquote")!);
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.querySelector("blockquote")).toBeNull();
    expect(ed.getMarkdown()).toBe("quoted");
  });

  it("at the start of a top-level list item unlists it to a paragraph", () => {
    const ed = mount("- item");
    caretAtStart(ed.content.querySelector("li")!);
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.querySelector("ul")).toBeNull();
    expect(ed.content.querySelector("p")!.textContent).toContain("item");
    expect(ed.getMarkdown()).toBe("item");
  });

  it("at the start of a task item strips the checkbox on the way out", () => {
    const ed = mount("- [ ] task");
    const box = ed.content.querySelector('input[type="checkbox"]')!;
    caretIn(box.nextSibling!, 0); // where the caret really sits: after the box
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.querySelector("ul")).toBeNull();
    expect(ed.content.querySelector('input[type="checkbox"]')).toBeNull();
    expect(ed.getMarkdown()).toBe("task");
  });

  it("at the start of a NESTED item outdents it one level", () => {
    const ed = mount("- a\n  - b");
    const nested = ed.content.querySelectorAll("li")[1];
    caretAtStart(nested);
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.querySelector("ul ul")).toBeNull();
    expect(ed.content.querySelectorAll("li").length).toBe(2);
    expect(ed.getMarkdown()).toBe("- a\n- b");
  });

  it("at the start of a paragraph merges it into the previous paragraph", () => {
    const ed = mount("first\n\nsecond");
    caretIn(ed.content.children[1].firstChild!, 0);
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.querySelectorAll("p").length).toBe(1);
    expect(ed.getMarkdown()).toBe("firstsecond");
  });

  it("merges a paragraph into the LAST ITEM of a preceding list", () => {
    const ed = mount("- a\n\ntail");
    caretIn(ed.content.children[1].firstChild!, 0);
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.children.length).toBe(1);
    expect(ed.content.querySelector("li")!.textContent).toBe("atail");
    expect(ed.getMarkdown()).toBe("- atail");
  });

  // Backspace at the start of a MIDDLE list item must split the list in
  // place (Notion behavior) — never reorder the document by dropping the
  // paragraph below the remaining items.
  it("at the start of a MIDDLE item splits the list in place", () => {
    const ed = mount("- a\n- b\n- c");
    caretAtStart(ed.content.querySelectorAll("li")[1]);
    expect(press(ed, "Backspace")).toBe(true);
    expect(ed.getMarkdown()).toBe("- a\n\nb\n\n- c");
  });

  it("deletes a preceding divider outright instead of merging", () => {
    const ed = mount("above\n\n---\n\nbelow");
    caretIn(ed.content.children[2].firstChild!, 0);
    expect(press(ed, "Backspace")).toBe(true);

    expect(ed.content.querySelector("hr")).toBeNull();
    expect(ed.content.querySelectorAll("p").length).toBe(2); // "below" survives intact
    expect(ed.getMarkdown()).toBe("above\n\nbelow");
  });

  it("refuses to merge prose into a preceding code block (unhandled)", () => {
    const ed = mount("```\nx\n```\n\ntail");
    caretIn(ed.content.children[1].firstChild!, 0);
    expect(press(ed, "Backspace")).toBe(false); // engine declines; browser default

    expect(ed.content.querySelector("pre")).not.toBeNull();
    expect(ed.content.querySelector("p")!.textContent).toBe("tail");
    expect(ed.getMarkdown()).toBe("```\nx\n```\n\ntail");
  });

  it("consumes the key but never merges prose into a preceding table", () => {
    const ed = mount("| a |\n| --- |\n| 1 |\n\ntail");
    caretIn(ed.content.children[1].firstChild!, 0);
    expect(press(ed, "Backspace")).toBe(true); // consumed…

    expect(ed.content.querySelector("table")).not.toBeNull(); // …but a no-op
    expect(ed.content.querySelector("p")!.textContent).toBe("tail");
    expect(ed.getMarkdown()).toContain("| 1");
    expect(ed.getMarkdown()).toContain("tail");
  });

  it("mid-block is left to the browser (unhandled)", () => {
    const ed = mount("word");
    caretIn(ed.content.querySelector("p")!.firstChild!, 2);
    expect(press(ed, "Backspace")).toBe(false);
    expect(ed.getMarkdown()).toBe("word");
  });
});

// ── Tab / Shift-Tab ─────────────────────────────────────────────────────────

describe("Tab / Shift-Tab in lists", () => {
  it("indents the second item into a nested list; Shift-Tab outdents it", () => {
    const ed = mount("- a\n- b");
    caretAtEnd(ed.content.querySelectorAll("li")[1]);
    expect(press(ed, "Tab")).toBe(true);

    const nested = ed.content.querySelector("ul > li > ul > li");
    expect(nested?.textContent).toBe("b");
    expect(ed.getMarkdown()).toBe("- a\n    - b"); // turndown's 4-space nesting

    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);
    expect(ed.content.querySelector("ul ul")).toBeNull();
    expect(ed.getMarkdown()).toBe("- a\n- b");
  });

  it("cannot indent the FIRST item", () => {
    const ed = mount("- only");
    caretAtEnd(ed.content.querySelector("li")!);
    expect(press(ed, "Tab")).toBe(false);
    expect(ed.content.querySelector("ul ul")).toBeNull();
    expect(ed.getMarkdown()).toBe("- only");
  });

  it("Shift-Tab on a top-level item is not handled", () => {
    const ed = mount("- a");
    caretAtEnd(ed.content.querySelector("li")!);
    expect(press(ed, "Tab", { shiftKey: true })).toBe(false);
    expect(ed.getMarkdown()).toBe("- a");
  });

  it("Tab outside a list is not handled", () => {
    const ed = mount("para");
    caretAtEnd(ed.content.querySelector("p")!);
    expect(press(ed, "Tab")).toBe(false);
    expect(ed.getMarkdown()).toBe("para");
  });
});

// ── Mod-U swallow + history routing ────────────────────────────────────────

describe("modifier keys handled by the engine", () => {
  it("swallows Mod-U (Markdown has no underline)", () => {
    const ed = mount("hello");
    caretAtEnd(ed.content.querySelector("p")!);
    expect(press(ed, "u", { metaKey: true })).toBe(true);
    expect(press(ed, "u", { ctrlKey: true })).toBe(true);
    expect(ed.content.querySelector("u")).toBeNull();
    expect(ed.getMarkdown()).toBe("hello");
  });

  it("routes Mod-Z to undo and Mod-Shift-Z / Mod-Y to redo", () => {
    const ed = mount("a");
    ed.setMarkdown("b");
    caretAtEnd(ed.content.querySelector("p")!);

    expect(press(ed, "z", { metaKey: true })).toBe(true);
    expect(ed.getMarkdown()).toBe("a");

    expect(press(ed, "z", { metaKey: true, shiftKey: true })).toBe(true);
    expect(ed.getMarkdown()).toBe("b");

    expect(press(ed, "y", { ctrlKey: true })).toBe(true); // redo at tail: no-op, still consumed
    expect(ed.getMarkdown()).toBe("b");
  });
});
