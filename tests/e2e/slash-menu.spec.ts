import { test, expect } from "@playwright/test";
import { openEditor, markdown } from "./helpers";

/** The `/` slash command menu. */

test("opens on / at the start of an empty paragraph", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("/");
  await expect(page.locator(".ew-slash.is-visible")).toHaveCount(1);
});

test("filters as you type a query", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("/head");
  const items = page.locator(".ew-slash.is-visible .ew-slash__item");
  await expect(items).toHaveCount(6); // Heading 1–6
});

test("keeps filtering when the query contains a space", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("/heading 2");
  const items = page.locator(".ew-slash.is-visible .ew-slash__item");
  await expect(items).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Spaced");
  expect(await markdown(page)).toBe("## Spaced");
});

test("opens inside an empty list item", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("- item one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/h3");
  await expect(page.locator(".ew-slash.is-visible")).toHaveCount(1);
});

test("Enter inserts the highlighted block and removes the trigger text", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("/h2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Chapter");
  expect(await markdown(page)).toBe("## Chapter");
});

test("ArrowDown moves the highlight", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("/head");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second");
  expect(await markdown(page)).toBe("## Second");
});

test("Escape closes the menu and keeps the typed text", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("/quo");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ew-slash.is-visible")).toHaveCount(0);
  expect(await markdown(page)).toBe("/quo");
});

test("clicking an item applies it", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("/");
  await page.locator(".ew-slash.is-visible .ew-slash__item", { hasText: "Quote" }).click();
  await page.keyboard.type("clicked in");
  expect(await markdown(page)).toBe("> clicked in");
});

test("does not open mid-word", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("half/way");
  await expect(page.locator(".ew-slash.is-visible")).toHaveCount(0);
});
