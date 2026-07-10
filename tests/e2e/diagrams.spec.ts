import { test, expect, type Page } from "@playwright/test";
import { markdown } from "./helpers";

/**
 * Diagrams plugin in a real browser. The fixture registers a deterministic
 * fake renderer (?plugins=diagrams) for the widget mechanics, plus the real
 * edododraw engine (?plugins=edododraw) for one smoke pass. Assertions are on
 * `getMarkdown()` — the contract — never pixels.
 */

const FENCE = "```fake\nscene-a --> scene-b\n```";

// No first-block click here (helpers.openEditor's would land on the widget
// figure and open its source editor).
async function open(page: Page, plugins: string, value: string): Promise<void> {
  const qs = new URLSearchParams({ plugins, ...(value ? { value } : {}) });
  await page.goto(`/e2e.html?${qs}`);
  await page.locator(".ew-content").waitFor();
}

test("diagrams: a fence renders through the registered renderer, markdown intact", async ({ page }) => {
  await open(page, "diagrams", FENCE);
  await expect(page.locator('figure[data-widget="diagram"] .fake-diagram'))
    .toHaveText("rendered:scene-a --> scene-b");
  await expect.poll(() => markdown(page)).toBe(FENCE);
});

test("diagrams: click-to-edit popover saves the source and re-renders", async ({ page }) => {
  await open(page, "diagrams", FENCE);
  await page.locator('figure[data-widget="diagram"]').click();
  const textarea = page.locator(".ew-widget-editor textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue("scene-a --> scene-b");
  await textarea.fill("x --> y");
  await page.locator(".ew-popover__btn--primary").click();
  await expect.poll(() => markdown(page)).toBe("```fake\nx --> y\n```");
  await expect(page.locator(".fake-diagram")).toHaveText("rendered:x --> y");
});

test("diagrams: cancel leaves the source untouched", async ({ page }) => {
  await open(page, "diagrams", FENCE);
  await page.locator('figure[data-widget="diagram"]').click();
  const textarea = page.locator(".ew-widget-editor textarea");
  await textarea.fill("discarded");
  await page.locator(".ew-popover__btn:not(.ew-popover__btn--primary)").click();
  await expect.poll(() => markdown(page)).toBe(FENCE);
});

test("diagrams: the slash item inserts a widget and opens the source editor", async ({ page }) => {
  await open(page, "diagrams", "");
  await page.locator(".ew-content > *").first().click();
  await page.keyboard.type("/fake");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ew-widget-editor textarea")).toBeVisible();
  await expect.poll(() => markdown(page)).toBe("```fake\n```");
});

test("edodoDraw: a ```edd fence renders an SVG via the real engine", async ({ page }) => {
  const fence = "```edd\nscene { a[Hi] --> b[There] }\n```";
  await open(page, "edododraw", fence);
  await expect(page.locator('figure[data-widget="diagram"] svg').first())
    .toBeVisible({ timeout: 15_000 });
  await expect.poll(() => markdown(page)).toBe(fence);
});
