import { test, expect } from "@playwright/test";
import { openEditor, markdown, html, paste, selectBlockText } from "./helpers";

/** Wave-2 features: link popover, block menu, images, headings 4–6, URL paste. */

test.describe("link popover", () => {
  test("Mod+K on a selection links it through the popover (no window.prompt)", async ({ page }) => {
    let sawDialog = false;
    page.on("dialog", async (d) => { sawDialog = true; await d.dismiss(); });
    await openEditor(page, "link these words");
    await selectBlockText(page, 0);
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.locator(".ew-popover input[name=href]");
    await expect(input).toBeVisible();
    await input.fill("https://example.com");
    await input.press("Enter");
    expect(await markdown(page)).toBe("[link these words](https://example.com)");
    expect(sawDialog).toBe(false);
  });

  test("clicking an existing link opens the editor with Remove", async ({ page }) => {
    await openEditor(page, "see [the docs](https://example.com) now");
    await page.locator(".ew-content a").click();
    await expect(page.locator(".ew-popover input[name=href]")).toHaveValue("https://example.com");
    await page.locator(".ew-popover button", { hasText: "Remove" }).click();
    expect(await markdown(page)).toBe("see the docs now");
  });

  test("Escape dismisses without changes", async ({ page }) => {
    await openEditor(page, "nothing changes");
    await selectBlockText(page, 0);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".ew-popover")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ew-popover")).toHaveCount(0);
    expect(await markdown(page)).toBe("nothing changes");
  });
});

test.describe("block menu (grip click)", () => {
  async function openMenu(page: import("@playwright/test").Page) {
    await page.locator(".ew-content > *").first().hover();
    await page.locator(".ew-bh-drag").click();
    await expect(page.locator(".ew-menu")).toBeVisible();
  }

  test("turn into: paragraph becomes a heading", async ({ page }) => {
    await openEditor(page, "plain text\n\nother");
    await openMenu(page);
    await page.locator(".ew-menu__item", { hasText: "Heading 1" }).click();
    expect(await markdown(page)).toBe("# plain text\n\nother");
  });

  test("duplicate clones the block through Markdown", async ({ page }) => {
    await openEditor(page, "# dup me\n\nrest");
    await openMenu(page);
    await page.locator(".ew-menu__item", { hasText: "Duplicate" }).click();
    expect(await markdown(page)).toBe("# dup me\n\n# dup me\n\nrest");
  });

  test("delete removes the block", async ({ page }) => {
    await openEditor(page, "# kill me\n\nsurvivor");
    await openMenu(page);
    await page.locator(".ew-menu__item.is-danger", { hasText: "Delete" }).click();
    expect(await markdown(page)).toBe("survivor");
  });

  test("keyboard navigation: arrows + Enter", async ({ page }) => {
    await openEditor(page, "navigate me\n\nother");
    await openMenu(page);
    await page.keyboard.press("ArrowDown"); // Heading 1 (after Text)
    await page.keyboard.press("Enter");
    expect(await markdown(page)).toBe("# navigate me\n\nother");
  });

  test("dragging still reorders (click/drag disambiguation)", async ({ page }) => {
    await openEditor(page, "first\n\nsecond\n\nthird");
    await page.locator(".ew-content > p").first().hover();
    const grip = page.locator(".ew-bh-drag");
    const third = page.locator(".ew-content > p").nth(2);
    const gBox = (await grip.boundingBox())!;
    const tBox = (await third.boundingBox())!;
    await page.mouse.move(gBox.x + gBox.width / 2, gBox.y + gBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(tBox.x + 20, tBox.y + tBox.height + 4, { steps: 12 });
    await page.mouse.up();
    expect(await markdown(page)).toBe("second\n\nthird\n\nfirst");
    await expect(page.locator(".ew-menu")).toHaveCount(0);
  });
});

test.describe("images", () => {
  test("slash → Image opens a URL form and inserts markdown", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("/image");
    await page.keyboard.press("Enter");
    const src = page.locator(".ew-popover input[name=src]");
    await expect(src).toBeVisible();
    await src.fill("https://example.com/cat.png");
    await page.locator(".ew-popover input[name=alt]").fill("a cat");
    await src.press("Enter");
    expect(await markdown(page)).toBe("![a cat](https://example.com/cat.png)");
    await expect(page.locator(".ew-content img")).toHaveCount(1);
  });
});

test.describe("headings 4–6", () => {
  for (const n of [4, 5, 6]) {
    test(`"${"#".repeat(n)} " becomes h${n}`, async ({ page }) => {
      await openEditor(page);
      await page.keyboard.type(`${"#".repeat(n)} Deep`);
      expect(await html(page)).toContain(`<h${n}>Deep</h${n}>`);
      expect(await markdown(page)).toBe(`${"#".repeat(n)} Deep`);
    });
  }
});

test.describe("click below the last block", () => {
  test("appends a fresh paragraph (Notion feel)", async ({ page }) => {
    await openEditor(page, "# Only a heading");
    const content = page.locator(".ew-content");
    const box = (await content.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
    await page.keyboard.type("appended below");
    expect(await markdown(page)).toBe("# Only a heading\n\nappended below");
  });

  test("reuses a trailing empty paragraph instead of stacking new ones", async ({ page }) => {
    await openEditor(page, "text");
    const content = page.locator(".ew-content");
    const box = (await content.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
    await page.keyboard.type("once");
    expect(await markdown(page)).toBe("text\n\nonce");
  });
});

test.describe("paste URL over selection", () => {
  test("wraps the selection in a link", async ({ page }) => {
    await openEditor(page, "check the docs here");
    await selectBlockText(page, 0);
    await paste(page, { "text/plain": "https://example.com/docs" });
    expect(await markdown(page)).toBe("[check the docs here](https://example.com/docs)");
  });

  test("a URL pasted at a collapsed caret stays plain text-ish", async ({ page }) => {
    await openEditor(page);
    await paste(page, { "text/plain": "https://example.com/docs" });
    const md = await markdown(page);
    expect(md).toContain("example.com/docs");
  });
});
