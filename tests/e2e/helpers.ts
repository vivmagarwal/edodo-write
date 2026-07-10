import type { Page, Locator } from "@playwright/test";

/**
 * Shared helpers for the real-browser E2E suite. Every spec drives the bare
 * fixture page (`/e2e.html`), which exposes the editor instance as
 * `window.editor` so specs can read Markdown (the source of truth) directly.
 */

// `window.editor` / `window.EdodoWrite` are declared by the fixture entry
// (src/e2e/main.ts), which shares the tsconfig program with these specs.

/** Open the fixture with an initial Markdown value; caret focused in the
 *  FIRST block (clicking the content's padding would append a paragraph —
 *  that's a feature, see the click-below-append spec). */
export async function openEditor(page: Page, value = ""): Promise<Locator> {
  const qs = value ? `?value=${encodeURIComponent(value)}` : "";
  await page.goto(`/e2e.html${qs}`);
  const content = page.locator(".ew-content");
  await content.waitFor();
  await content.locator(":scope > *").first().click();
  return content;
}

/** The editor's Markdown — the value an app would store. */
export function markdown(page: Page): Promise<string> {
  return page.evaluate(() => window.editor.getMarkdown());
}

/** The editor's live HTML (for asserting block structure). */
export function html(page: Page): Promise<string> {
  return page.evaluate(() => window.editor.getHTML());
}

/** Put the caret at the very end of the document. */
export async function caretToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector(".ew-content") as HTMLElement;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    root.focus();
  });
}

/** Select all text inside the given block (nth top-level block, 0-based). */
export async function selectBlockText(page: Page, nth: number): Promise<void> {
  await page.evaluate((n) => {
    const root = document.querySelector(".ew-content") as HTMLElement;
    const block = root.children[n] as HTMLElement;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(block);
    sel.removeAllRanges();
    sel.addRange(range);
  }, nth);
}

/** Dispatch a synthetic paste with the given clipboard flavors. */
export async function paste(
  page: Page,
  flavors: { "text/plain"?: string; "text/html"?: string },
): Promise<void> {
  await page.evaluate((data) => {
    const root = document.querySelector(".ew-content") as HTMLElement;
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(data)) {
      if (value != null) dt.setData(type, value);
    }
    root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, flavors);
}

/** Capture what a copy/cut puts on the clipboard, per flavor. */
export async function interceptCopy(page: Page, kind: "copy" | "cut"): Promise<Record<string, string>> {
  return page.evaluate(async (k) => {
    return await new Promise<Record<string, string>>((resolve) => {
      const seen: Record<string, string> = {};
      const orig = DataTransfer.prototype.setData;
      DataTransfer.prototype.setData = function (type: string, val: string) {
        seen[type] = val;
        return orig.call(this, type, val);
      };
      document.addEventListener(
        k,
        () => setTimeout(() => { DataTransfer.prototype.setData = orig; resolve(seen); }, 30),
        { once: true },
      );
      document.execCommand(k);
    });
  }, kind);
}
