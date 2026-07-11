import { test, expect } from "@playwright/test";
import { markdown } from "./helpers";

/**
 * Regression: opening menus must NEVER scroll the page. The original bug —
 * clicking a table column pill on a tall page yanked the viewport to the top —
 * only reproduces when the document is tall enough to scroll, which is why
 * every short-fixture test missed it. These specs run on a deliberately tall
 * document, scrolled to the bottom.
 */

const TALL_MD =
  Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of filler prose to make the page scroll.`).join("\n\n") +
  "\n\n| one | two | three |\n| --- | --- | --- |\n| a | b | c |";

async function openTall(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`/e2e.html?value=${encodeURIComponent(TALL_MD)}`);
  await page.locator(".ew-content table").waitFor();
  await page.locator(".ew-content table").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
}

test("clicking the column pill keeps the scroll position and opens the menu", async ({ page }) => {
  await openTall(page);
  const before = await page.evaluate(() => Math.round(window.scrollY));
  expect(before).toBeGreaterThan(200); // the page really is scrolled

  await page.locator(".ew-content th").nth(2).hover();
  await page.locator(".ew-th-col").click();
  await expect(page.locator(".ew-menu")).toBeVisible();
  const after = await page.evaluate(() => Math.round(window.scrollY));
  expect(Math.abs(after - before)).toBeLessThan(30);

  // …and the menu actually works from here.
  await page.locator(".ew-menu__item", { hasText: "Delete column" }).click();
  await expect.poll(async () => (await markdown(page)).includes("three")).toBe(false);
});

test("the row pill and edge + buttons are scroll-stable too", async ({ page }) => {
  await openTall(page);
  const before = await page.evaluate(() => Math.round(window.scrollY));

  await page.locator(".ew-content td").first().hover();
  await page.locator(".ew-th-row").click();
  await expect(page.locator(".ew-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".ew-content td").first().hover();
  await page.locator(".ew-th-addrow").click();

  const after = await page.evaluate(() => Math.round(window.scrollY));
  expect(Math.abs(after - before)).toBeLessThan(30);
});

test("block-menu (grip) and slash menu arrow navigation never scroll the page", async ({ page }) => {
  await openTall(page);
  const before = await page.evaluate(() => Math.round(window.scrollY));

  // Block menu on the table.
  await page.locator(".ew-content table").hover();
  await page.locator(".ew-bh-drag").click();
  await expect(page.locator(".ew-menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");

  // Slash menu below the table, with arrow travel through the whole list.
  await page.locator(".ew-content td").first().click();
  await page.keyboard.press("Enter"); // last row → escape below table
  await page.keyboard.type("/");
  await expect(page.locator(".ew-slash.is-visible")).toHaveCount(1);
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");

  const after = await page.evaluate(() => Math.round(window.scrollY));
  expect(Math.abs(after - before)).toBeLessThan(30);
});

test("a diagram re-renders to fit when its container resizes", async ({ page }) => {
  await page.goto(`/e2e.html?plugins=diagrams&value=${encodeURIComponent("```fake\nhello\n```")}`);
  const surface = page.locator('figure[data-widget="diagram"] .ew-widget__surface');
  await expect(surface).toContainText("rendered:hello");

  // Track render passes via DOM: the fake renderer appends one .fake-diagram
  // per render (mountWidgets clears first, so count stays 1 — but the NODE
  // identity changes). Capture identity, resize, expect a fresh node.
  const stamp = () => page.evaluate(() => {
    const el = document.querySelector(".fake-diagram") as HTMLElement & { __stamp?: number };
    if (el && !el.__stamp) el.__stamp = Math.random();
    return el?.__stamp ?? null;
  });
  const first = await stamp();
  expect(first).not.toBeNull();

  await page.setViewportSize({ width: 700, height: 700 }); // container shrinks
  await expect.poll(stamp, { timeout: 4000 }).not.toBe(first); // re-rendered
  expect(await markdown(page)).toBe("```fake\nhello\n```"); // contract untouched
});
