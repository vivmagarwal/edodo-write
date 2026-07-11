import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The CDN story: a STATIC page — one <link> + one <script type="module">
 * importing dist-lib/standalone.js (what unpkg/jsdelivr serve) — gets the
 * full editor with plugins, no bundler, no import map. This spec drives that
 * exact page; the bundle is built on demand if absent.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test.beforeAll(() => {
  // ALWAYS rebuild (~0.7 s): a stale bundle silently tests yesterday's code.
  execSync("npm run build:lib && npm run build:standalone", { cwd: ROOT, stdio: "inherit" });
});

async function open(page: import("@playwright/test").Page, value = ""): Promise<void> {
  const qs = value ? `?value=${encodeURIComponent(value)}` : "";
  await page.goto(`/e2e-cdn.html${qs}`);
  await page.locator(".ew-content").waitFor();
  await page.locator(".ew-content > *").first().click();
}

const md = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as never as { editor: { getMarkdown(): string } }).editor.getMarkdown());

test("the full editor works from the standalone bundle: typing, rules, markdown", async ({ page }) => {
  await open(page);
  await page.keyboard.type("# CDN heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- item one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("with ==highlight== and **bold**");
  expect(await md(page)).toBe("# CDN heading\n\n- item one\n- with ==highlight== and **bold**");
});

test("plugins load: callout hydrates, tags menu picks, slash menu opens", async ({ page }) => {
  await open(page, "> [!NOTE]\n> Static pages welcome.");
  await expect(page.locator('[data-callout="note"]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("by #sta");
  await page.keyboard.press("Enter"); // pick "static"
  expect(await md(page)).toContain("[#static](https://example.com/t/static)");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.locator(".ew-slash.is-visible")).toHaveCount(1);
});

test("styles arrived via the plain CSS file (chip + toolbar visuals exist)", async ({ page }) => {
  await open(page, "styled [#static](https://example.com/t/static)");
  const chipBg = await page
    .locator("a.ew-tag")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(chipBg).not.toBe("rgba(0, 0, 0, 0)"); // the stylesheet actually applied
});
