/**
 * The applyCommand matrix not covered elsewhere: block toggles in both
 * directions, list upgrades/unwraps, link edit/removal, inline tag toggling,
 * and the insertion commands' exact DOM shapes.
 *
 * These run against a bare contentEditable root (the same registry-free entry
 * point `editor.exec()` funnels into) so each transform's DOM output is
 * asserted directly. Where a path delegates to `document.execCommand` (which
 * jsdom does not implement) the call is stubbed and the delegation asserted.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyCommand, isInlineActive } from "@core/commands";
import { getSelection } from "@core/dom";
import { htmlToMarkdown } from "@core/serialize";

const ZWSP = String.fromCharCode(0x200b);

function frag(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "ew-content";
  root.contentEditable = "true";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
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

function selectText(node: Node, start: number, end: number): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** jsdom has no document.execCommand — stub it and record the calls. */
function stubExecCommand(): unknown[][] {
  const calls: unknown[][] = [];
  (document as unknown as Record<string, unknown>).execCommand =
    (...args: unknown[]) => { calls.push(args); return true; };
  return calls;
}

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { delete (document as unknown as Record<string, unknown>).execCommand; });

// ── setBlock ────────────────────────────────────────────────────────────────

describe("setBlock", () => {
  it("re-applying the same heading toggles back to a paragraph", () => {
    const root = frag("<h2>x</h2>");
    caretAtEnd(root.querySelector("h2")!);
    applyCommand(root, "heading2");
    expect(root.querySelector("h2")).toBeNull();
    const p = root.querySelector("p")!;
    expect(p.textContent).toBe("x");
    // The caret is restored INTO the new block.
    const sel = getSelection()!;
    expect(p.contains(sel.anchorNode) || sel.anchorNode === p).toBe(true);
  });

  it("heading4/5/6 retag a paragraph", () => {
    for (const [cmd, tag] of [["heading4", "H4"], ["heading5", "H5"], ["heading6", "H6"]] as const) {
      document.body.innerHTML = "";
      const root = frag("<p>deep</p>");
      caretAtEnd(root.querySelector("p")!);
      applyCommand(root, cmd);
      expect(root.children[0].tagName).toBe(tag);
      expect(root.children[0].textContent).toBe("deep");
    }
  });

  it("paragraph on a paragraph is a no-op", () => {
    const root = frag("<p>same</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "paragraph");
    expect(root.innerHTML).toBe("<p>same</p>");
  });
});

// ── toList ──────────────────────────────────────────────────────────────────

describe("toList", () => {
  it("wraps a paragraph into a bullet list", () => {
    const root = frag("<p>x</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "bulletList");
    expect(root.querySelector("ul > li")!.textContent).toBe("x");
    expect(htmlToMarkdown(root.innerHTML)).toBe("- x");
  });

  it("upgrades a plain UL to a task list, decorating every item", () => {
    const root = frag("<ul><li>a</li><li>b</li></ul>");
    caretAtEnd(root.querySelector("li")!);
    applyCommand(root, "taskList");

    const ul = root.querySelector("ul")!;
    expect(ul.classList.contains("contains-task-list")).toBe(true);
    const boxes = root.querySelectorAll('li > input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    root.querySelectorAll("li").forEach((li) => {
      expect(li.classList.contains("task-list-item")).toBe(true);
      expect(li.getAttribute("data-task")).toBe("todo");
    });
    expect(htmlToMarkdown(root.innerHTML)).toBe("- [ ] a\n- [ ] b");
  });

  it("toggles a task list OFF, unwrapping to paragraphs with checkboxes stripped", () => {
    const root = frag("<ul><li>a</li><li>b</li></ul>");
    caretAtEnd(root.querySelector("li")!);
    applyCommand(root, "taskList"); // upgrade…
    applyCommand(root, "taskList"); // …then toggle off

    expect(root.querySelector("ul")).toBeNull();
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
    expect(Array.from(root.children).map((c) => c.tagName)).toEqual(["P", "P"]);
    expect(htmlToMarkdown(root.innerHTML)).toBe("a\n\nb");
  });

  it("toggles a bullet list off into paragraphs", () => {
    const root = frag("<ul><li>x</li></ul>");
    caretAtEnd(root.querySelector("li")!);
    applyCommand(root, "bulletList");
    expect(root.querySelector("ul")).toBeNull();
    expect(root.querySelector("p")!.textContent).toBe("x");
  });

  it("orderedList wraps in an <ol>", () => {
    const root = frag("<p>1st</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "orderedList");
    expect(root.querySelector("ol > li")!.textContent).toBe("1st");
  });
});

// ── toggleBlockquote ───────────────────────────────────────────────────────

describe("toggleBlockquote", () => {
  it("wraps a paragraph's inline content in a blockquote", () => {
    const root = frag("<p>q</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "blockquote");
    expect(root.querySelector("blockquote")!.textContent).toBe("q");
    expect(root.querySelector("p")).toBeNull();
    expect(htmlToMarkdown(root.innerHTML)).toBe("> q");
  });

  it("unwraps inline-content blockquotes back into one paragraph", () => {
    const root = frag("<blockquote>q</blockquote>");
    caretAtEnd(root.querySelector("blockquote")!);
    applyCommand(root, "blockquote");
    expect(root.querySelector("blockquote")).toBeNull();
    expect(root.querySelector("p")!.textContent).toBe("q");
  });

  it("unwraps BLOCK children in place (the block-children branch)", () => {
    const root = frag("<blockquote><p>a</p><p>b</p></blockquote>");
    caretAtEnd(root.querySelector("p")!); // caret inside the first inner <p>
    applyCommand(root, "blockquote");

    expect(root.querySelector("blockquote")).toBeNull();
    expect(Array.from(root.children).map((c) => c.tagName)).toEqual(["P", "P"]);
    expect(root.children[0].textContent).toBe("a");
    expect(root.children[1].textContent).toBe("b");
    expect(htmlToMarkdown(root.innerHTML)).toBe("a\n\nb");
  });
});

// ── toggleCodeBlock ────────────────────────────────────────────────────────

describe("toggleCodeBlock", () => {
  it("wraps a paragraph in <pre><code>", () => {
    const root = frag("<p>print(1)</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "codeBlock");
    expect(root.querySelector("pre > code")!.textContent).toBe("print(1)");
    expect(htmlToMarkdown(root.innerHTML)).toBe("```\nprint(1)\n```");
  });

  it("anchors an EMPTY code block with a ZWSP so the caret is placeable", () => {
    const root = frag("<p><br></p>");
    caretAtStart(root.querySelector("p")!);
    applyCommand(root, "codeBlock");
    const code = root.querySelector("pre > code")!;
    expect(code.textContent).toBe(ZWSP);
    expect(code.querySelector("br")).toBeNull(); // a <br> in <pre> would mean a newline
  });

  it("toggles a code block back to a paragraph", () => {
    const root = frag("<pre><code>y</code></pre>");
    caretAtEnd(root.querySelector("code")!);
    applyCommand(root, "codeBlock");
    expect(root.querySelector("pre")).toBeNull();
    expect(root.querySelector("p")!.textContent).toBe("y");
  });

  it("toggling an empty code block off strips the ZWSP anchor", () => {
    const root = frag(`<pre><code>${ZWSP}</code></pre>`);
    caretAtEnd(root.querySelector("code")!);
    applyCommand(root, "codeBlock");
    const p = root.querySelector("p")!;
    expect(p.innerHTML).toBe("<br>"); // empty paragraph, placeable caret
  });
});

// ── applyLink ──────────────────────────────────────────────────────────────

describe("link", () => {
  it("inserts the href as a link at a collapsed caret", () => {
    const root = frag("<p>see </p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "link", { href: "https://ex.com" });
    const a = root.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://ex.com");
    expect(a.textContent).toBe("https://ex.com"); // the href doubles as the text
  });

  it("edits an existing link IN PLACE from a collapsed caret", () => {
    const root = frag('<p><a href="https://a.com">click</a></p>');
    const a = root.querySelector("a")!;
    selectText(a.firstChild!, 2, 2); // collapsed caret inside the link text
    applyCommand(root, "link", { href: "https://b.com" });

    expect(root.querySelectorAll("a").length).toBe(1); // never split
    expect(a.getAttribute("href")).toBe("https://b.com");
    expect(a.textContent).toBe("click"); // text untouched
  });

  it("removal selects the whole link before unlinking (collapsed-caret fix)", () => {
    const root = frag('<p><a href="https://a.com">click</a> tail</p>');
    const a = root.querySelector("a")!;
    selectText(a.firstChild!, 2, 2);
    const calls = stubExecCommand();
    applyCommand(root, "link", { href: null });

    // execCommand("unlink") no-ops on a collapsed caret — the selection must
    // cover the link's contents when the call is made.
    expect(getSelection()!.toString()).toBe("click");
    expect(calls).toEqual([["unlink"]]);
  });

  it("a non-collapsed selection delegates to execCommand('createLink')", () => {
    const root = frag("<p>pick me</p>");
    selectText(root.querySelector("p")!.firstChild!, 0, 4);
    const calls = stubExecCommand();
    applyCommand(root, "link", { href: "https://x.com" });
    expect(calls).toEqual([["createLink", false, "https://x.com"]]);
  });
});

// ── toggleInlineTag (via the `code` command) ───────────────────────────────

describe("toggleInlineTag", () => {
  it("wraps the selection and reports active; a second toggle unwraps", () => {
    const root = frag("<p>hello</p>");
    selectText(root.querySelector("p")!.firstChild!, 1, 4); // "ell"
    applyCommand(root, "code");

    expect(root.querySelector("code")!.textContent).toBe("ell");
    expect(isInlineActive(root, "code")).toBe(true);
    expect(htmlToMarkdown(root.innerHTML)).toBe("h`ell`o");

    applyCommand(root, "code"); // unwrap
    expect(root.querySelector("code")).toBeNull();
    expect(root.querySelector("p")!.textContent).toBe("hello");
    expect(isInlineActive(root, "code")).toBe(false);
  });

  it("a collapsed caret outside any wrapper is a no-op", () => {
    const root = frag("<p>plain</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "code");
    expect(root.querySelector("code")).toBeNull();
  });
});

// ── insertImage / insertDivider ────────────────────────────────────────────

describe("image", () => {
  it("inserts an image block plus a trailing paragraph after the current block", () => {
    const root = frag("<p>x</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "image", { src: "https://i.png", alt: "pic" });

    expect(Array.from(root.children).map((c) => c.tagName)).toEqual(["P", "P", "P"]);
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://i.png");
    expect(img.getAttribute("alt")).toBe("pic");
    expect((root.lastElementChild as HTMLElement).innerHTML).toBe("<br>");
    expect(htmlToMarkdown(root.innerHTML)).toBe("x\n\n![pic](https://i.png)");
  });

  it("replaces an EMPTY paragraph instead of leaving it behind", () => {
    const root = frag("<p><br></p>");
    caretAtStart(root.querySelector("p")!);
    applyCommand(root, "image", { src: "https://i.png" });

    expect(Array.from(root.children).map((c) => c.tagName)).toEqual(["P", "P"]);
    expect(root.children[0].querySelector("img")).not.toBeNull();
    expect(root.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("does nothing without a src", () => {
    const root = frag("<p>x</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "image", { src: "" });
    expect(root.innerHTML).toBe("<p>x</p>");
  });
});

describe("divider", () => {
  it("replaces an EMPTY paragraph with the <hr> + fresh paragraph", () => {
    const root = frag("<p><br></p>");
    caretAtStart(root.querySelector("p")!);
    applyCommand(root, "divider");

    expect(Array.from(root.children).map((c) => c.tagName)).toEqual(["HR", "P"]);
    expect(htmlToMarkdown(root.innerHTML)).toBe("---");
    // Caret parked in the fresh paragraph.
    const p = root.querySelector("p")!;
    const sel = getSelection()!;
    expect(p.contains(sel.anchorNode) || sel.anchorNode === p).toBe(true);
  });

  it("keeps a non-empty block and inserts below it", () => {
    const root = frag("<p>keep</p>");
    caretAtEnd(root.querySelector("p")!);
    applyCommand(root, "divider");
    expect(Array.from(root.children).map((c) => c.tagName)).toEqual(["P", "HR", "P"]);
    expect(root.children[0].textContent).toBe("keep");
  });
});
