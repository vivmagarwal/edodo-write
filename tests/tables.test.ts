import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";
import { getSelection } from "@core/dom";

function mount(value = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, { value });
}

function caretIn(el: Element): void {
  const sel = getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function press(ed: EdodoWrite, key: string, init: KeyboardEventInit = {}): boolean {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  ed.content.dispatchEvent(e);
  return e.defaultPrevented;
}

const TABLE_MD = "| a | b |\n| --- | --- |\n| 1 | 2 |";

describe("table insert command", () => {
  it("inserts a GFM-shaped table (header row + body) and serializes", () => {
    const ed = mount("intro");
    ed.exec("table", { rows: 2, cols: 2 });
    expect(ed.content.querySelectorAll("thead th").length).toBe(2);
    expect(ed.content.querySelectorAll("tbody tr").length).toBe(1);
    // empty cells serialize to an empty-but-valid GFM table
    const md = ed.getMarkdown();
    expect(md).toContain("intro");
    expect(md).toContain("| --- | --- |");
    ed.destroy();
  });

  it("replaces the empty paragraph it was invoked from", () => {
    const ed = mount("");
    caretIn(ed.content.querySelector("p")!);
    ed.exec("table", {});
    expect(ed.content.querySelector("table")).not.toBeNull();
    // default 3×3, the invoking empty paragraph is gone, a trailing p remains
    expect(ed.content.children[0].tagName).toBe("TABLE");
    expect(ed.content.lastElementChild!.tagName).toBe("P");
    ed.destroy();
  });

  it("caret lands in the first header cell", () => {
    const ed = mount("");
    ed.exec("table", {});
    const sel = getSelection()!;
    const th = ed.content.querySelector("th")!;
    expect(th.contains(sel.anchorNode) || sel.anchorNode === th).toBe(true);
    ed.destroy();
  });

  it("clamps absurd sizes", () => {
    const ed = mount("");
    ed.exec("table", { rows: 9999, cols: 9999 });
    expect(ed.content.querySelectorAll("th").length).toBeLessThanOrEqual(12);
    expect(ed.content.querySelectorAll("tr").length).toBeLessThanOrEqual(50);
    ed.destroy();
  });
});

describe("Tab navigation in tables", () => {
  it("Tab hops to the next cell; Shift+Tab hops back", () => {
    const ed = mount(TABLE_MD);
    const cells = Array.from(ed.content.querySelectorAll("th, td"));
    caretIn(cells[0]);
    expect(press(ed, "Tab")).toBe(true);
    let sel = getSelection()!;
    expect(cells[1].contains(sel.anchorNode) || sel.anchorNode === cells[1]).toBe(true);

    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);
    sel = getSelection()!;
    expect(cells[0].contains(sel.anchorNode) || sel.anchorNode === cells[0]).toBe(true);
    ed.destroy();
  });

  it("Tab in the LAST cell appends a new body row", () => {
    const ed = mount(TABLE_MD);
    const cells = Array.from(ed.content.querySelectorAll("th, td"));
    caretIn(cells[cells.length - 1]); // "2"
    expect(press(ed, "Tab")).toBe(true);
    expect(ed.content.querySelectorAll("tbody tr").length).toBe(2);
    const newFirst = ed.content.querySelectorAll("tbody tr")[1].firstElementChild!;
    const sel = getSelection()!;
    expect(newFirst.contains(sel.anchorNode) || sel.anchorNode === newFirst).toBe(true);
    // and the whole thing still round-trips
    expect(ed.getMarkdown()).toContain("| 1");
    ed.destroy();
  });

  it("Shift+Tab in the FIRST cell is consumed but never leaves the table", () => {
    const ed = mount(TABLE_MD);
    caretIn(ed.content.querySelector("th")!);
    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);
    const sel = getSelection()!;
    expect(ed.content.querySelector("table")!.contains(sel.anchorNode)).toBe(true);
    ed.destroy();
  });

  it("Tab outside a table still indents lists (no regression)", () => {
    const ed = mount("- a\n- b");
    const secondLi = ed.content.querySelectorAll("li")[1];
    caretIn(secondLi);
    expect(press(ed, "Tab")).toBe(true);
    expect(ed.getMarkdown()).toBe("- a\n    - b");
    ed.destroy();
  });
});

describe("table cells and the normalizer", () => {
  it("empty cells get caret anchors (br) after normalization", () => {
    const ed = mount("| a |  |\n| --- | --- |\n|  | 2 |");
    ed.content.querySelectorAll("td, th").forEach((cell) => {
      expect(cell.firstChild).not.toBeNull();
    });
    ed.destroy();
  });

  it("a table round-trips byte-for-byte with padded GFM cells", () => {
    const ed = mount(TABLE_MD);
    const once = ed.getMarkdown();
    ed.setMarkdown(once, { silent: true });
    expect(ed.getMarkdown()).toBe(once);
    ed.destroy();
  });
});
