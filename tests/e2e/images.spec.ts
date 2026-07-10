import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { markdown, html } from "./helpers";

/**
 * Image ingestion: clipboard paste, drag-and-drop, the popover file picker,
 * and the configurable uploader (mock CDN / failure / data-URL fallback).
 * The fixture wires ?upload=mock|fail (see src/e2e/main.ts).
 */

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function open(page: Page, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams(params).toString();
  await page.goto(`/e2e.html${qs ? `?${qs}` : ""}`);
  const content = page.locator(".ew-content");
  await content.waitFor();
  await content.locator(":scope > *").first().click();
}

/** Dispatch a paste whose clipboard carries a real PNG File. */
async function pasteImage(page: Page, name = "screenshot.png"): Promise<void> {
  await page.evaluate(
    ([b64, fileName]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], fileName, { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const root = document.querySelector(".ew-content") as HTMLElement;
      root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [PNG_B64, name],
  );
}

test.describe("clipboard image paste", () => {
  test("uploads through the configured uploader and lands as ![alt](url)", async ({ page }) => {
    await open(page, { upload: "mock", value: "before" });
    await pasteImage(page, "shot.png");
    // pending placeholder appears immediately…
    await expect(page.locator(".ew-content img[data-uploading]")).toHaveCount(1);
    // …and is absent from the Markdown until the upload resolves
    expect(await markdown(page)).toBe("before");
    await expect.poll(() => markdown(page)).toBe(
      "before\n\n![shot](https://cdn.example.com/mock/shot.png)",
    );
    await expect(page.locator(".ew-content img[data-uploading]")).toHaveCount(0);
  });

  test("image files beat text flavors on the same clipboard", async ({ page }) => {
    await open(page, { upload: "mock" });
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "img.png", { type: "image/png" }));
      dt.setData("text/plain", "ignored text");
      const root = document.querySelector(".ew-content") as HTMLElement;
      root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_B64);
    await expect.poll(() => markdown(page)).toContain("cdn.example.com/mock/img.png");
    expect(await markdown(page)).not.toContain("ignored text");
  });

  test("without an uploader the image embeds as a data: URL (fallback)", async ({ page }) => {
    await open(page);
    await pasteImage(page, "tiny.png");
    await expect.poll(() => markdown(page)).toMatch(/^!\[tiny\]\(data:image\/png;base64,/);
    // and it round-trips: reload the produced markdown
    const md = await markdown(page);
    await page.evaluate((m) => window.editor.setMarkdown(m), md);
    expect(await markdown(page)).toBe(md);
    await expect(page.locator(".ew-content img")).toHaveCount(1);
  });

  test("a failed upload removes the placeholder and shows a toast", async ({ page }) => {
    await open(page, { upload: "fail", value: "safe" });
    await pasteImage(page);
    await expect(page.locator(".ew-toast")).toHaveText("Image upload failed");
    await expect.poll(() => markdown(page)).toBe("safe");
    await expect(page.locator(".ew-content img")).toHaveCount(0);
  });
});

test.describe("drag-and-drop", () => {
  test("dropping an image file uploads and inserts it", async ({ page }) => {
    await open(page, { upload: "mock", value: "target paragraph" });
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      const root = document.querySelector(".ew-content") as HTMLElement;
      const rect = root.getBoundingClientRect();
      root.dispatchEvent(new DragEvent("drop", {
        dataTransfer: dt,
        clientX: rect.left + 50,
        clientY: rect.top + 10,
        bubbles: true,
        cancelable: true,
      }));
    }, PNG_B64);
    await expect.poll(() => markdown(page)).toContain("![dropped](https://cdn.example.com/mock/dropped.png)");
  });
});

test.describe("popover file picker", () => {
  test("slash → Image → Upload… inserts via the uploader, honoring the alt field", async ({ page }) => {
    await open(page, { upload: "mock" });
    await page.keyboard.type("/image");
    await page.keyboard.press("Enter");
    await expect(page.locator(".ew-popover")).toBeVisible();
    await page.locator('.ew-popover input[name="alt"]').fill("a chosen file");
    await page.locator('[data-testid="ew-image-file"]').setInputFiles({
      name: "picked.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_B64, "base64"),
    });
    await expect.poll(() => markdown(page)).toBe(
      "![a chosen file](https://cdn.example.com/mock/picked.png)",
    );
  });

  test("the URL path still works alongside", async ({ page }) => {
    await open(page);
    await page.keyboard.type("/image");
    await page.keyboard.press("Enter");
    await page.locator('.ew-popover input[name="src"]').fill("https://example.com/pic.jpg");
    await page.locator('.ew-popover input[name="src"]').press("Enter");
    expect(await markdown(page)).toBe("![](https://example.com/pic.jpg)");
    expect(await html(page)).toContain('src="https://example.com/pic.jpg"');
  });
});
