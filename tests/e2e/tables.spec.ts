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

test.describe("hover controls (the Notion-style authoring surface)", () => {
  /** Pure user gestures: hover a cell, click the pill, pick a menu item. */
  async function columnMenu(page: import("@playwright/test").Page, cellText: string) {
    await page.locator(".ew-content th, .ew-content td").filter({ hasText: cellText }).first().hover();
    await page.locator(".ew-th-col").click();
    await expect(page.locator(".ew-menu")).toBeVisible();
  }
  async function rowMenu(page: import("@playwright/test").Page, cellText: string) {
    await page.locator(".ew-content th, .ew-content td").filter({ hasText: cellText }).first().hover();
    await page.locator(".ew-th-row").click();
    await expect(page.locator(".ew-menu")).toBeVisible();
  }

  test("hovering a cell reveals column/row handles and the + buttons", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.locator(".ew-content td").first().hover();
    await expect(page.locator(".ew-th-col")).toBeVisible();
    await expect(page.locator(".ew-th-row")).toBeVisible();
    await expect(page.locator(".ew-th-addcol")).toBeVisible();
    await expect(page.locator(".ew-th-addrow")).toBeVisible();
  });

  test("Delete column via the column pill — no caret preparation needed", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await columnMenu(page, "b");
    await page.locator(".ew-menu__item", { hasText: "Delete column" }).click();
    const md = await markdown(page);
    expect(squash(md)).toContain("| a |");
    expect(squash(md)).not.toContain("| b |");
    expect(squash(md)).not.toContain("| 2 |");
  });

  test("Insert left / Insert right place the caret in the new header cell", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await columnMenu(page, "a");
    await page.locator(".ew-menu__item", { hasText: "Insert left" }).click();
    await page.keyboard.type("first");
    expect(squash(await markdown(page))).toContain("| first | a | b |");

    await columnMenu(page, "b");
    await page.locator(".ew-menu__item", { hasText: "Insert right" }).click();
    await page.keyboard.type("last");
    expect(squash(await markdown(page))).toContain("| first | a | b | last |");
  });

  test("Move column right reorders every row", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await columnMenu(page, "a");
    await page.locator(".ew-menu__item", { hasText: "Move right" }).click();
    const md = squash(await markdown(page));
    expect(md).toContain("| b | a |");
    expect(md).toContain("| 2 | 1 |");
  });

  test("row menu: Insert below, Move, Delete; header row protected", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await rowMenu(page, "1");
    await page.locator(".ew-menu__item", { hasText: "Insert below" }).click();
    await page.keyboard.type("x");
    expect(squash(await markdown(page))).toContain("| x |");

    // Header row: Delete/Move/Insert-above are disabled.
    await rowMenu(page, "a");
    await expect(page.locator(".ew-menu__item", { hasText: "Delete row" })).toBeDisabled();
    await expect(page.locator(".ew-menu__item", { hasText: "Insert above" })).toBeDisabled();
    await page.keyboard.press("Escape");

    // Body row deletion works.
    await rowMenu(page, "x");
    await page.locator(".ew-menu__item", { hasText: "Delete row" }).click();
    await expect.poll(async () => squash(await markdown(page))).not.toContain("| x |");
  });

  test("Clear contents empties the column but keeps the structure", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await columnMenu(page, "b");
    await page.locator(".ew-menu__item", { hasText: "Clear contents" }).click();
    const md = squash(await markdown(page));
    expect(md).not.toContain("b");
    expect(md.split("\n").length).toBe(3);
  });

  test("the edge + buttons add a column and a row", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.locator(".ew-content td").first().hover();
    await page.locator(".ew-th-addcol").click();
    await page.keyboard.type("extra");
    expect(squash(await markdown(page))).toContain("| a | b | extra |");

    await page.locator(".ew-content td").first().hover();
    await page.locator(".ew-th-addrow").click();
    await page.keyboard.type("tail");
    expect(squash(await markdown(page))).toContain("| tail |");
  });

  test("last remaining column cannot be deleted", async ({ page }) => {
    await openEditor(page, "| only |\n| --- |\n| x |");
    await columnMenu(page, "only");
    await expect(page.locator(".ew-menu__item", { hasText: "Delete column" })).toBeDisabled();
  });

  test("handles are inert in read-only mode", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.evaluate(() => window.editor.setReadOnly(true));
    await page.locator(".ew-content td").first().hover();
    await expect(page.locator(".ew-th-col")).toBeHidden();
  });

  test("whole-table Delete stays in the block menu; 'Turn into' hidden", async ({ page }) => {
    await openEditor(page, TABLE_MD);
    await page.locator(".ew-content td").first().click();
    await page.locator(".ew-content table").hover();
    await page.locator(".ew-bh-drag").click();
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
