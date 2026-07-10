import { test, expect, type Page } from "@playwright/test";
import { markdown, html } from "./helpers";

/**
 * Tags plugin E2E — the fixture registers tags() with a static source:
 * alpha/beta (href'd to https://example.com/tags/…) + gamma (no href).
 * Assertions run against getMarkdown() — the contract — never pixels.
 */

async function openWithTags(page: Page, value = "") {
  const qs = new URLSearchParams({ plugins: "tags", ...(value ? { value } : {}) });
  await page.goto(`/e2e.html?${qs}`);
  const content = page.locator(".ew-content");
  await content.waitFor();
  // Click the FIRST block — clicking the content's bottom padding appends a
  // paragraph (that's a feature).
  await content.locator(":scope > *").first().click();
  return content;
}

const menu = (page: Page) => page.locator(".ew-popover.ew-menu");

test("typing #al opens the menu; Enter inserts a linked chip + trailing space", async ({ page }) => {
  await openWithTags(page);
  await page.keyboard.type("#al");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator(".ew-menu__item")).toHaveText(["#alpha"]);
  await page.keyboard.press("Enter");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator(".ew-content a.ew-tag")).toHaveText("#alpha");
  await expect.poll(() => markdown(page)).toBe("[#alpha](https://example.com/tags/alpha)");
  // The inserted trailing space is real: typing continues after it.
  await page.keyboard.type("next");
  await expect.poll(() => markdown(page)).toBe("[#alpha](https://example.com/tags/alpha) next");
});

test("an item without an href inserts plain text", async ({ page }) => {
  await openWithTags(page);
  await page.keyboard.type("#ga");
  await expect(menu(page).locator(".ew-menu__item")).toHaveText(["#gamma"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => markdown(page)).toBe("#gamma");
  expect(await html(page)).not.toContain("<a");
  await page.keyboard.type("x");
  await expect.poll(() => markdown(page)).toBe("#gamma x");
});

test("a non-matching query offers Create #query", async ({ page }) => {
  await openWithTags(page);
  await page.keyboard.type("#zz");
  await expect(menu(page).locator(".ew-menu__item")).toHaveText(["Create #zz"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => markdown(page)).toBe("#zz");
});

test("Escape closes the menu and leaves the typed text alone", async ({ page }) => {
  await openWithTags(page);
  await page.keyboard.type("#al");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect.poll(() => markdown(page)).toBe("#al");
});

test("arrow keys navigate; Enter picks the highlighted item", async ({ page }) => {
  await openWithTags(page);
  await page.keyboard.type("#");
  await expect(menu(page).locator(".ew-menu__item")).toHaveText(["#alpha", "#beta", "#gamma"]);
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).locator(".ew-menu__item.is-active")).toHaveText("#beta");
  await page.keyboard.press("Enter");
  await expect.poll(() => markdown(page)).toBe("[#beta](https://example.com/tags/beta)");
});

test("clicking a suggestion picks it", async ({ page }) => {
  await openWithTags(page);
  await page.keyboard.type("mention #be");
  await menu(page).locator(".ew-menu__item", { hasText: "#beta" }).click();
  await expect.poll(() => markdown(page)).toBe("mention [#beta](https://example.com/tags/beta)");
});

test("typing the trigger inside a code block does nothing", async ({ page }) => {
  await openWithTags(page, "```\ncode\n```");
  await page.locator(".ew-content pre").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" #al");
  await expect(menu(page)).toHaveCount(0);
  await expect.poll(() => markdown(page)).toContain("code #al");
});

test("stored tag links hydrate with the chip class and round-trip", async ({ page }) => {
  await openWithTags(page, "keep [#alpha](https://example.com/tags/alpha) and #gamma");
  await expect(page.locator(".ew-content a.ew-tag")).toHaveText("#alpha");
  await expect.poll(() => markdown(page)).toBe("keep [#alpha](https://example.com/tags/alpha) and #gamma");
});
