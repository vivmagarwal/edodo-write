import { test, expect } from "@playwright/test";
import { markdown, html, selectBlockText } from "./helpers";

/**
 * Plugin API smoke — the fixture registers the first-party plugins
 * (?plugins=highlight,callout), so one browser pass exercises the ENTIRE
 * registry wiring: commands, input rules, keymap, toolbar, slash items,
 * markdown pipeline, and sanitizer widening.
 */

async function openWithPlugins(page: import("@playwright/test").Page, value = "") {
  const qs = new URLSearchParams({ plugins: "highlight,callout", ...(value ? { value } : {}) });
  await page.goto(`/e2e.html?${qs}`);
  const content = page.locator(".ew-content");
  await content.waitFor();
  await content.click();
  return content;
}

test("highlight: typing ==text== creates a <mark> and round-trips", async ({ page }) => {
  await openWithPlugins(page);
  await page.keyboard.type("some ==bright== words");
  expect(await html(page)).toContain("<mark>bright</mark>");
  expect(await markdown(page)).toBe("some ==bright== words");
});

test("highlight: Mod+Shift+H toggles the mark via the plugin keybinding", async ({ page }) => {
  await openWithPlugins(page, "glow up");
  await selectBlockText(page, 0);
  await page.keyboard.press("ControlOrMeta+Shift+h");
  expect(await markdown(page)).toBe("==glow up==");
});

test("highlight: the plugin's toolbar button appears and works", async ({ page }) => {
  await openWithPlugins(page, "button me");
  await selectBlockText(page, 0);
  const btn = page.locator('.ew-toolbar [data-cmd="highlight"]');
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await markdown(page)).toBe("==button me==");
  await expect(btn).toHaveClass(/is-active/);
});

test("highlight: loading ==marks== from stored markdown renders them", async ({ page }) => {
  await openWithPlugins(page, "pre ==lit== post");
  expect(await html(page)).toContain("<mark>lit</mark>");
  expect(await markdown(page)).toBe("pre ==lit== post");
});

test("callout: typing [!warning] inside a quote upgrades it", async ({ page }) => {
  await openWithPlugins(page);
  await page.keyboard.type("> ");
  await page.keyboard.type("[!warning] ");
  await page.keyboard.type("Danger ahead");
  expect(await html(page)).toContain('data-callout="warning"');
  expect(await markdown(page)).toBe("> [!WARNING]\n> Danger ahead");
});

test("callout: slash item inserts a note callout", async ({ page }) => {
  await openWithPlugins(page);
  await page.keyboard.type("/callout");
  await page.keyboard.press("Enter");
  await page.keyboard.type("remember this");
  expect(await markdown(page)).toBe("> [!NOTE]\n> remember this");
});

test("callout: stored GitHub-alert markdown hydrates into a decorated block", async ({ page }) => {
  await openWithPlugins(page, "> [!TIP]\n> Drink water.");
  expect(await html(page)).toContain('data-callout="tip"');
  expect(await markdown(page)).toBe("> [!TIP]\n> Drink water.");
});

test("an editor WITHOUT the plugins keeps plugin syntax as plain text (no data loss)", async ({ page }) => {
  await page.goto(`/e2e.html?value=${encodeURIComponent("keep ==this== raw")}`);
  await page.locator(".ew-content").waitFor();
  expect(await html(page)).not.toContain("<mark>");
  expect(await markdown(page)).toContain("==this==");
});
