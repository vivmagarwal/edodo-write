import { test, expect, type Page } from "@playwright/test";
import { markdown, html } from "./helpers";

/**
 * Math plugin in a real browser (?plugins=math): the typed-$ input rule, the
 * KaTeX widget render, the inline chip's edit popover, and the slash flow.
 * Assertions target getMarkdown() — the contract — via expect.poll (the
 * change event is debounced; never a fixed sleep).
 */

async function openMath(page: Page, value = "", { click = true } = {}) {
  const qs = new URLSearchParams({ plugins: "math", ...(value ? { value } : {}) });
  await page.goto(`/e2e.html?${qs}`);
  const content = page.locator(".ew-content");
  await content.waitFor();
  // Clicking a widget figure would open its editor — only click into text.
  if (click) await content.locator(":scope > *").first().click();
  return content;
}

test("typing $x^2$ converts to a chip and round-trips", async ({ page }) => {
  await openMath(page);
  await page.keyboard.type("$x^2$ done");
  await expect.poll(() => markdown(page)).toBe("$x^2$ done");
  expect(await html(page)).toContain('data-math="x^2"');
  await expect(page.locator(".ew-content span[data-math]")).toHaveCount(1);
});

test("currency is never hijacked while typing", async ({ page }) => {
  await openMath(page);
  await page.keyboard.type("costs $5 and $10 total");
  await expect.poll(() => markdown(page)).toBe("costs $5 and $10 total");
  await expect(page.locator(".ew-content span[data-math]")).toHaveCount(0);
});

test("stored $$ block hydrates into a rendered KaTeX widget", async ({ page }) => {
  await openMath(page, "$$\nE=mc^2\n$$", { click: false });
  await expect(page.locator('figure[data-widget="math"]')).toHaveCount(1);
  // KaTeX is installed in this repo — the surface gets a real render.
  await expect(page.locator('figure[data-widget="math"] .katex').first()).toBeVisible();
  expect(await markdown(page)).toBe("$$\nE=mc^2\n$$");
});

test("clicking a chip opens the popover; Save updates the markdown", async ({ page }) => {
  await openMath(page, "keep $x^2$ here", { click: false });
  await page.locator(".ew-content span[data-math]").click();
  const input = page.locator(".ew-popover input");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("x^2");
  await input.fill("y^3");
  await page.locator(".ew-popover .ew-popover__btn--primary").click();
  await expect.poll(() => markdown(page)).toBe("keep $y^3$ here");
});

test("chip Remove unwraps to plain text without $ delimiters", async ({ page }) => {
  await openMath(page, "keep $x^2$ here", { click: false });
  await page.locator(".ew-content span[data-math]").click();
  await page.locator(".ew-popover .is-danger").click();
  await expect.poll(() => markdown(page)).toBe("keep x^2 here");
});

test("slash: Math block inserts a $$ widget and opens its editor", async ({ page }) => {
  await openMath(page);
  await page.keyboard.type("/math");
  const menu = page.locator(".ew-slash.is-visible");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Math block");
  await page.keyboard.press("Enter");
  await expect(page.locator('figure[data-widget="math"]')).toHaveCount(1);
  await expect.poll(() => markdown(page)).toBe("$$\nE = mc^2\n$$");
  // The shared widget source editor opened on the fresh block.
  const textarea = page.locator(".ew-popover textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue("E = mc^2");
  await textarea.fill("a^2 + b^2 = c^2");
  await page.locator(".ew-popover .ew-popover__btn--primary").click();
  await expect.poll(() => markdown(page)).toBe("$$\na^2 + b^2 = c^2\n$$");
});

test("an editor WITHOUT the plugin keeps $ syntax as plain text", async ({ page }) => {
  await page.goto(`/e2e.html?value=${encodeURIComponent("inline $x^2$ math")}`);
  await page.locator(".ew-content").waitFor();
  expect(await html(page)).not.toContain("data-math");
  expect(await markdown(page)).toBe("inline $x^2$ math");
});
