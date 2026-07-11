import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";
import { placeCaretAtEnd, placeCaretAtStart, getSelection } from "@core/dom";

/**
 * RFC §7 — imperative `insertText`. Caret-safe, non-destructive, ONE undo step
 * + ONE change event. Backs dictation and `{{placeholder}}` injection.
 *
 * The text is treated as Markdown, so we assert with standalone tokens (no
 * leading/trailing spaces, which marked would trim) to isolate the caret-vs-
 * append semantics under test.
 */

function mount(value = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new EdodoWrite(host, { value });
  return { host, editor };
}

/** Move the selection OUT of the editor entirely. */
function caretOutside() {
  const outside = document.createElement("div");
  outside.textContent = "elsewhere";
  document.body.appendChild(outside);
  const sel = getSelection();
  const r = document.createRange();
  r.selectNodeContents(outside);
  sel?.removeAllRanges();
  sel?.addRange(r);
}

describe("insertText", () => {
  it("inserts at the caret (end) — inline, same paragraph", () => {
    const { editor } = mount("alpha");
    placeCaretAtEnd(editor.content.firstElementChild as HTMLElement);
    editor.insertText("beta");
    expect(editor.getMarkdown()).toBe("alphabeta"); // single paragraph
    editor.destroy();
  });

  it("inserts at the caret (start) — respects caret position", () => {
    const { editor } = mount("alpha");
    placeCaretAtStart(editor.content.firstElementChild as HTMLElement);
    editor.insertText("beta");
    expect(editor.getMarkdown()).toBe("betaalpha"); // inserted before, still inline
    editor.destroy();
  });

  it("appends a NEW paragraph when the caret is outside (no fusion)", () => {
    const { editor } = mount("alpha");
    caretOutside();
    editor.insertText("{{firstName}}");
    expect(editor.getMarkdown()).toBe("alpha\n\n{{firstName}}");
    editor.destroy();
  });

  it("a single undo reverts the whole insert", () => {
    const { editor } = mount("alpha");
    placeCaretAtEnd(editor.content.firstElementChild as HTMLElement);
    editor.insertText("beta");
    expect(editor.getMarkdown()).toBe("alphabeta");
    editor.undo();
    expect(editor.getMarkdown()).toBe("alpha");
    editor.destroy();
  });

  it("fires exactly one change event", async () => {
    const { editor } = mount("alpha");
    let count = 0;
    editor.on("change", () => { count += 1; });
    placeCaretAtEnd(editor.content.firstElementChild as HTMLElement);
    editor.insertText("beta");
    await new Promise((r) => setTimeout(r, 200));
    expect(count).toBe(1);
    editor.destroy();
  });

  it("returns false and no-ops on empty text", () => {
    const { editor } = mount("alpha");
    placeCaretAtEnd(editor.content.firstElementChild as HTMLElement);
    expect(editor.insertText("")).toBe(false);
    expect(editor.getMarkdown()).toBe("alpha");
    editor.destroy();
  });

  it("returns false when read-only", () => {
    const { editor } = mount("alpha");
    editor.setReadOnly(true);
    expect(editor.insertText("beta")).toBe(false);
    expect(editor.getMarkdown()).toBe("alpha");
    editor.destroy();
  });

  it("is reachable via editor.exec (registered command)", () => {
    const { editor } = mount("alpha");
    placeCaretAtEnd(editor.content.firstElementChild as HTMLElement);
    editor.exec("insertText", { text: "beta" });
    // exec dispatches the registered command; the text is inserted.
    expect(editor.getMarkdown()).toContain("beta");
    editor.destroy();
  });
});
