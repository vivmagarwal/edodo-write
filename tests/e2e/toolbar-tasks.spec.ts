import { test, expect } from "@playwright/test";
import { openEditor, markdown, selectBlockText } from "./helpers";

/** Floating selection toolbar + task checkbox interactivity. */

test.describe("selection toolbar", () => {
  test("appears on selection, hides when collapsed", async ({ page }) => {
    await openEditor(page, "select me please");
    await selectBlockText(page, 0);
    await expect(page.locator(".ew-toolbar.is-visible")).toHaveCount(1);
    await page.keyboard.press("ArrowRight"); // collapse
    await expect(page.locator(".ew-toolbar.is-visible")).toHaveCount(0);
  });

  test("bold button bolds and shows active state", async ({ page }) => {
    await openEditor(page, "target words");
    await selectBlockText(page, 0);
    const boldBtn = page.locator('.ew-toolbar [data-cmd="bold"]');
    await boldBtn.click();
    expect(await markdown(page)).toBe("**target words**");
    await expect(boldBtn).toHaveClass(/is-active/);
  });

  test("H1 button converts the block", async ({ page }) => {
    await openEditor(page, "make me big");
    await selectBlockText(page, 0);
    await page.locator('.ew-toolbar [data-cmd="heading1"]').click();
    expect(await markdown(page)).toBe("# make me big");
  });

  test("quote button wraps the block", async ({ page }) => {
    await openEditor(page, "wise words");
    await selectBlockText(page, 0);
    await page.locator('.ew-toolbar [data-cmd="blockquote"]').click();
    expect(await markdown(page)).toBe("> wise words");
  });
});

test.describe("task checkboxes", () => {
  test("clicking a checkbox flips [ ] to [x] in the Markdown", async ({ page }) => {
    await openEditor(page, "- [ ] first\n- [x] second");
    const boxes = page.locator('.ew-content input[type="checkbox"]');
    await boxes.nth(0).click();
    await expect.poll(() => markdown(page)).toBe("- [x] first\n- [x] second");
    await boxes.nth(1).click();
    await expect.poll(() => markdown(page)).toBe("- [x] first\n- [ ] second");
  });

  test("checkbox clicks are inert in read-only mode", async ({ page }) => {
    await openEditor(page, "- [ ] frozen");
    await page.evaluate(() => window.editor.setReadOnly(true));
    await page.locator('.ew-content input[type="checkbox"]').click();
    await page.waitForTimeout(150);
    expect(await markdown(page)).toBe("- [ ] frozen");
  });
});

test.describe("block handles", () => {
  test("hovering a block reveals the gutter handle", async ({ page }) => {
    await openEditor(page, "first block\n\nsecond block");
    await page.locator(".ew-content > p").first().hover();
    await expect(page.locator(".ew-block-handle")).toBeVisible();
  });

  test("the + button inserts an empty paragraph below", async ({ page }) => {
    await openEditor(page, "only block");
    await page.locator(".ew-content > p").first().hover();
    await page.locator(".ew-bh-add").click();
    await page.keyboard.type("inserted");
    expect(await markdown(page)).toBe("only block\n\ninserted");
  });
});
