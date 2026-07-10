import { test, expect } from "@playwright/test";
import { openEditor, markdown, html } from "./helpers";

/** GFM pads cells to column width — compare with runs of spaces squashed. */
const squash = (md: string) => md.replace(/ +/g, " ");

/** Robust tables: slash insert, typing in cells, Tab/Enter navigation, and
 *  the block-menu row/column operations. */

const TABLE_MD = "| a | b |\n| --- | --- |\n| 1 | 2 |";

test.describe("insert + typing", () => {
  test("slash → Table inserts a 3×3 and typing fills the header", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("/table");
    await page.keyboard.press("Enter");
    await expect(page.locator(".ew-content table")).toHaveCount(1);
    await page.keyboard.type("Name");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Age");
    const md = await markdown(page);
    expect(squash(md)).toContain("| Name | Age |");
    expect(md).toContain("| --- | --- |");
  });

  test("a loaded table is editable cell by cell", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.locator(".ew-content td").first().click();
    await page.keyboard.type("23");
    expect(squash(await markdown(page))).toContain("| 123 | 2");
  });
});

test.describe("keyboard navigation", () => {
  test("Tab walks cells; Tab at the end adds a row", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.locator(".ew-content th").first().click();
    await page.keyboard.press("Tab"); // → b
    await page.keyboard.press("Tab"); // → 1
    await page.keyboard.type("x");
    expect(squash(await markdown(page))).toContain("| x1 | 2 |");
    await page.keyboard.press("Tab"); // → 2 (last)
    await page.keyboard.press("Tab"); // append row
    await page.keyboard.type("new");
    const md = await markdown(page);
    expect(squash(md)).toContain("| new |");
  });

  test("Enter moves down a row; from the last row it escapes below", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.locator(".ew-content th").first().click();
    await page.keyboard.press("Enter"); // header → body cell below
    await page.keyboard.type("below-header ");
    expect(await markdown(page)).toContain("below-header");
    await page.keyboard.press("Enter"); // last row → escape
    await page.keyboard.type("outside");
    const md = await markdown(page);
    expect(md).toContain("outside");
    expect((await html(page)).match(/<table/g)!.length).toBe(1);
  });
});

test.describe("block menu table operations", () => {
  async function openTableMenu(page: import("@playwright/test").Page, cellSelector: string) {
    await page.locator(cellSelector).click(); // caret into the target cell
    await page.locator(".ew-content table").hover();
    await page.locator(".ew-bh-drag").click();
    await expect(page.locator(".ew-menu")).toBeVisible();
  }

  test("Add row below the caret's row", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await openTableMenu(page, ".ew-content td:first-child");
    await page.locator(".ew-menu__item", { hasText: "Add row below" }).click();
    await page.keyboard.type("added");
    const md = await markdown(page);
    expect(md.split("\n").length).toBe(4); // header + sep + 2 body rows
    expect(squash(md)).toContain("| added |");
  });

  test("Add column right of the caret's column", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await openTableMenu(page, ".ew-content th:first-child");
    await page.locator(".ew-menu__item", { hasText: "Add column right" }).click();
    await page.keyboard.type("mid");
    expect(squash(await markdown(page))).toContain("| a | mid | b |");
  });

  test("Delete row (body) works; the header row is protected", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await openTableMenu(page, ".ew-content td:first-child");
    await page.locator(".ew-menu__item", { hasText: "Delete row" }).click();
    await expect.poll(() => markdown(page)).not.toContain("| 1");

    await openTableMenu(page, ".ew-content th:first-child");
    await page.locator(".ew-menu__item", { hasText: "Delete row" }).click();
    await expect(page.locator(".ew-toast")).toContainText("header row");
    expect(squash(await markdown(page))).toContain("| a | b |");
  });

  test("Delete column removes the caret's column everywhere", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await openTableMenu(page, ".ew-content th:nth-child(2)");
    await page.locator(".ew-menu__item", { hasText: "Delete column" }).click();
    const md = await markdown(page);
    expect(squash(md)).toContain("| a |");
    expect(squash(md)).not.toContain("| b |");
    expect(squash(md)).not.toContain("| 2 |");
  });

  test("'Turn into' entries are hidden for tables; Delete still offered", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await openTableMenu(page, ".ew-content td:first-child");
    await expect(page.locator(".ew-menu__item", { hasText: "Heading 1" })).toHaveCount(0);
    await page.locator(".ew-menu__item.is-danger", { hasText: "Delete" }).click();
    await expect.poll(() => markdown(page)).toBe("");
  });

  test("Backspace in a cell never merges cells or escapes the table", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.locator(".ew-content td:nth-child(2)").click(); // "2"
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace"); // deletes "2"
    await page.keyboard.press("Backspace"); // at empty cell start — must not merge
    const h = await html(page);
    expect((h.match(/<td/g) || []).length).toBe(2);
    expect(squash(await markdown(page))).toContain("| 1 |");
  });
});
