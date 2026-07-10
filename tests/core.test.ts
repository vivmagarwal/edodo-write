import { describe, it, expect, beforeEach } from "vitest";
import {
  deleteLeadingChars, blockKindOf, isBlockEmpty, textBeforeCaret, getSelection,
} from "@core/dom";
import { applyCommand, makeTaskItem } from "@core/commands";
import { runInputRules } from "@core/input-rules";

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
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("dom helpers", () => {
  it("blockKindOf maps tags", () => {
    expect(blockKindOf(document.createElement("h1"))).toBe("heading1");
    expect(blockKindOf(document.createElement("blockquote"))).toBe("blockquote");
    const ul = document.createElement("ul");
    expect(blockKindOf(ul)).toBe("bulletList");
    ul.classList.add("contains-task-list");
    expect(blockKindOf(ul)).toBe("taskList");
  });

  it("isBlockEmpty detects empty vs filled blocks", () => {
    const empty = document.createElement("p");
    empty.innerHTML = "<br>";
    expect(isBlockEmpty(empty)).toBe(true);
    const filled = document.createElement("p");
    filled.textContent = "x";
    expect(isBlockEmpty(filled)).toBe(false);
  });

  it("deleteLeadingChars removes the first N characters", () => {
    const root = frag("<p>hello</p>");
    deleteLeadingChars(root.querySelector("p")!, 3);
    expect(root.querySelector("p")!.textContent).toBe("lo");
  });

  it("textBeforeCaret returns text up to the caret", () => {
    const root = frag("<p>hello</p>");
    const p = root.querySelector("p")!;
    const sel = getSelection()!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 3);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(textBeforeCaret(p)).toBe("hel");
  });
});

describe("commands (execCommand-free paths)", () => {
  it("divider inserts an <hr> and a following paragraph", () => {
    const root = frag("<p>x</p>");
    caretAtEndOf(root.querySelector("p")!);
    applyCommand(root, "divider");
    expect(root.querySelector("hr")).not.toBeNull();
  });

  it("codeBlock wraps the block in <pre><code>", () => {
    const root = frag("<p>code me</p>");
    caretAtEndOf(root.querySelector("p")!);
    applyCommand(root, "codeBlock");
    const code = root.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("code me");
  });

  it("makeTaskItem decorates a list item", () => {
    const li = document.createElement("li");
    makeTaskItem(li, true);
    expect(li.classList.contains("task-list-item")).toBe(true);
    expect(li.getAttribute("data-task")).toBe("done");
    const box = li.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.checked).toBe(true);
  });
});

describe("input rules (execCommand-free paths)", () => {
  it("turns '``` ' into a code block", () => {
    const root = frag("<p>``` </p>");
    caretAtEndOf(root.querySelector("p")!);
    const changed = runInputRules(root);
    expect(changed).toBe(true);
    expect(root.querySelector("pre")).not.toBeNull();
  });

  it("turns '--- ' into a divider", () => {
    const root = frag("<p>--- </p>");
    caretAtEndOf(root.querySelector("p")!);
    const changed = runInputRules(root);
    expect(changed).toBe(true);
    expect(root.querySelector("hr")).not.toBeNull();
  });

  it("wraps '**bold**' into <strong> as it is typed", () => {
    const root = frag("<p>say **hi**</p>");
    caretAtEndOf(root.querySelector("p")!);
    const changed = runInputRules(root);
    expect(changed).toBe(true);
    expect(root.querySelector("strong")?.textContent).toBe("hi");
  });
});
