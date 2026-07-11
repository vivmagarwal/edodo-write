import { describe, it, expect } from "vitest";
import {
  insertColumn, deleteColumn, moveColumn, clearColumn,
  insertRow, deleteRow, moveRow, clearRow,
} from "@core/table-ui";
import { htmlToMarkdown } from "@core/serialize";

function table(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML =
    "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
    "<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>";
  document.body.appendChild(el);
  return el.querySelector("table")!;
}

const md = (t: HTMLElement) => htmlToMarkdown(t.outerHTML).replace(/ +/g, " ");

describe("column operations", () => {
  it("insert left/right hits every row with the right cell kind", () => {
    const t = table();
    insertColumn(t, 0, "left");
    expect(t.querySelectorAll("thead th").length).toBe(3);
    expect(t.querySelectorAll("tbody tr")[0].children[0].tagName).toBe("TD");
    insertColumn(t, 2, "right");
    expect(t.querySelector("tr")!.children.length).toBe(4);
  });

  it("delete removes the column everywhere; the last column is protected", () => {
    const t = table();
    deleteColumn(t, 1);
    expect(md(t)).not.toContain("b");
    expect(md(t)).not.toContain("4");
    deleteColumn(t, 0); // only one left — no-op
    expect(t.querySelector("th")).not.toBeNull();
  });

  it("move swaps the column across header and body", () => {
    const t = table();
    moveColumn(t, 0, 1);
    expect(md(t)).toContain("| b | a |");
    expect(md(t)).toContain("| 2 | 1 |");
    moveColumn(t, 1, 1); // already last — no-op
    expect(md(t)).toContain("| b | a |");
  });

  it("clear empties cells but keeps structure", () => {
    const t = table();
    clearColumn(t, 0);
    expect(t.querySelectorAll("tr").length).toBe(3);
    expect(md(t)).not.toContain("a");
    expect(md(t)).toContain("b");
  });
});

describe("row operations", () => {
  it("insert below the header lands as the FIRST body row", () => {
    const t = table();
    insertRow(t, t.querySelector("thead tr") as HTMLTableRowElement, "below");
    const firstBody = t.querySelector("tbody tr")!;
    expect(firstBody.textContent).toBe("");
    expect(t.querySelectorAll("tbody tr").length).toBe(3);
  });

  it("insert above/below a body row", () => {
    const t = table();
    const row2 = t.querySelectorAll("tbody tr")[1] as HTMLTableRowElement;
    insertRow(t, row2, "above");
    expect(t.querySelectorAll("tbody tr").length).toBe(3);
    expect(t.querySelectorAll("tbody tr")[1].textContent).toBe("");
  });

  it("the header row can never be deleted or moved", () => {
    const t = table();
    const header = t.querySelector("thead tr") as HTMLTableRowElement;
    deleteRow(t, header);
    moveRow(header, 1);
    expect(t.querySelector("thead tr")).not.toBeNull();
    expect(md(t)).toContain("| a | b |");
  });

  it("body rows delete, move, and clear", () => {
    const t = table();
    const rows = () => Array.from(t.querySelectorAll("tbody tr")) as HTMLTableRowElement[];
    moveRow(rows()[0], 1);
    expect(md(t).indexOf("3")).toBeLessThan(md(t).indexOf("1"));
    clearRow(rows()[0]);
    expect(md(t)).not.toContain("3");
    deleteRow(t, rows()[1]);
    expect(t.querySelectorAll("tbody tr").length).toBe(1);
  });

  it("the first body row cannot move up into the header", () => {
    const t = table();
    const first = t.querySelector("tbody tr") as HTMLTableRowElement;
    moveRow(first, -1);
    expect(t.querySelector("tbody tr")!.textContent).toBe("12");
  });
});
