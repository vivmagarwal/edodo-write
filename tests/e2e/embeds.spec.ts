import { test, expect, type Page } from "@playwright/test";
import { markdown } from "./helpers";

/**
 * Embeds plugin — real-browser pass: hydration of a stored bare-URL line into
 * the right renderer (YouTube iframe, <video>, bookmark card), the
 * type-then-Enter conversion (only once the caret has left the line), and the
 * click-to-edit popover's "Turn into link" opt-out. Markdown (the contract)
 * is asserted throughout; conversions ride the ~120 ms change debounce, so
 * everything polls — never a fixed sleep for the happy path.
 */

const FIGURE = 'figure[data-widget="embed"]';

async function openEmbeds(page: Page, value = "") {
  const qs = new URLSearchParams({ plugins: "embeds", ...(value ? { value } : {}) });
  await page.goto(`/e2e.html?${qs}`);
  await page.locator(".ew-content").waitFor();
}

test("a stored YouTube URL hydrates into a nocookie iframe, markdown intact", async ({ page }) => {
  const url = "https://youtu.be/dQw4w9WgXcQ";
  await openEmbeds(page, url);
  const iframe = page.locator(`${FIGURE} iframe.ew-embed__frame`);
  await expect(iframe).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  await expect.poll(() => markdown(page)).toBe(url);
});

test("typing a URL converts only once the caret leaves the line", async ({ page }) => {
  const url = "https://youtu.be/abc123xyz";
  await openEmbeds(page);
  await page.locator(".ew-content").click();
  await page.keyboard.type(url);
  // The caret is still on the line: the markdown is already the bare URL
  // (the change debounce has fired), but no widget appears.
  await expect.poll(() => markdown(page)).toBe(url);
  await expect(page.locator(FIGURE)).toHaveCount(0);
  // Enter moves the caret to a fresh paragraph — the pass converts.
  await page.keyboard.press("Enter");
  await expect(page.locator(FIGURE)).toHaveCount(1);
  await expect(page.locator(FIGURE)).toHaveAttribute("data-source", url);
  await expect.poll(() => markdown(page)).toBe(url);
});

test("a .mp4 URL renders a <video controls>", async ({ page }) => {
  const url = "https://example.com/clip.mp4";
  await openEmbeds(page, url);
  const video = page.locator(`${FIGURE} video.ew-embed__media`);
  await expect(video).toHaveAttribute("src", url);
  await expect(video).toHaveAttribute("controls", "");
  await expect.poll(() => markdown(page)).toBe(url);
});

test("an unknown domain renders a bookmark card titled with the hostname", async ({ page }) => {
  const url = "https://some-blog.example.org/post/1";
  await openEmbeds(page, url);
  await expect(page.locator(`${FIGURE} .ew-embed__card-title`)).toHaveText("some-blog.example.org");
  await expect(page.locator(`${FIGURE} .ew-embed__card-url`)).toHaveText(url);
  await expect.poll(() => markdown(page)).toBe(url);
});

test('"Turn into link" leaves [hostname](url) and is never re-embedded', async ({ page }) => {
  const url = "https://some-blog.example.org/post/1";
  await openEmbeds(page, url);
  await page.locator(`${FIGURE} .ew-embed__card`).click();
  const popover = page.locator(".ew-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Turn into link" }).click();
  await expect(page.locator(FIGURE)).toHaveCount(0);
  await expect.poll(() => markdown(page)).toBe("[some-blog.example.org](https://some-blog.example.org/post/1)");
  // Force another reconciliation pass (a real edit elsewhere) and prove the
  // text ≠ href opt-out holds: the link paragraph stays a paragraph.
  await page.keyboard.press("Enter");
  await page.keyboard.type("still a link above");
  await expect.poll(() => markdown(page)).toBe(
    "[some-blog.example.org](https://some-blog.example.org/post/1)\n\nstill a link above",
  );
  await expect(page.locator(FIGURE)).toHaveCount(0);
});
