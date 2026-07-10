import { test, expect } from "@playwright/test";
import { openEditor, markdown, html, interceptCopy } from "./helpers";

/**
 * Document-integrity scenarios: the select-all family, native cross-block
 * deletes, read-only toggling, and other paths where contentEditable used to
 * corrupt the document (see src/core/normalize.ts).
 */

test.describe("select-all", () => {
  test("Delete resets to an empty paragraph; typing starts fresh", async ({ page }) => {
    await openEditor(page, "# Head\n\npara text\n\n- item");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("fresh start");
    expect(await markdown(page)).toBe("fresh start");
    expect(await html(page)).not.toContain("<h1");
    expect(await html(page)).not.toContain("<ul");
  });

  test("Backspace resets to an empty paragraph", async ({ page }) => {
    await openEditor(page, "# Head\n\npara");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("clean");
    expect(await markdown(page)).toBe("clean");
    expect(await html(page)).not.toContain("<h1");
  });

  test("typing over a full selection replaces the doc with a paragraph", async ({ page }) => {
    await openEditor(page, "# Head\n\npara text");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("replacement");
    expect(await markdown(page)).toBe("replacement");
    expect(await html(page)).toContain("<p>replacement</p>");
  });

  test("Cut resets to an empty paragraph; typing stays inside a block", async ({ page }) => {
    await openEditor(page, "# Head\n\npara text");
    await page.keyboard.press("ControlOrMeta+a");
    const clip = await interceptCopy(page, "cut");
    expect(clip["text/plain"]).toBe("# Head\n\npara text");
    await page.keyboard.type("after-cut");
    expect(await markdown(page)).toBe("after-cut");
    expect(await html(page)).toContain("<p>after-cut</p>");
    // The corruption signature was a bare text node at the root:
    const rootTextNodes = await page.evaluate(() =>
      Array.from(document.querySelector(".ew-content")!.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE).length);
    expect(rootTextNodes).toBe(0);
  });
});

test.describe("cross-block native deletes", () => {
  test("deleting across a heading and paragraph leaves no styled spans", async ({ page }) => {
    await openEditor(page, "# Heading\n\nparagraph body");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const h = root.children[0].firstChild!;
      const p = root.children[1].firstChild!;
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.setStart(h, 4);
      r.setEnd(p, 9);
      sel.removeAllRanges();
      sel.addRange(r);
      root.focus();
    });
    await page.keyboard.press("Backspace");
    await page.keyboard.type("X");
    const h = await html(page);
    expect(h).not.toContain("style=");
    expect(h).not.toContain("<span");
    expect(await markdown(page)).toBe("# HeadX body");
  });
});

test.describe("soft breaks", () => {
  test("Shift+Enter round-trips through Markdown (backslash hard break)", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("line one");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line two");
    const md = await markdown(page);
    expect(md).toBe("line one\\\nline two");
    // Reload from the produced Markdown — the break must survive.
    await page.evaluate((m) => window.editor.setMarkdown(m), md);
    expect(await html(page)).toContain("<br");
    expect(await markdown(page)).toBe(md);
  });
});

test.describe("read-only at runtime", () => {
  test("toggling read-only disables handles, typing, and cut", async ({ page }) => {
    await openEditor(page, "first\n\nsecond");
    await page.evaluate(() => window.editor.setReadOnly(true));
    await page.locator(".ew-content > p").first().hover();
    await expect(page.locator(".ew-block-handle")).toBeHidden();
    await page.locator(".ew-content").click();
    await page.keyboard.type("nope");
    expect(await markdown(page)).toBe("first\n\nsecond");
  });

  test("an editor constructed read-only becomes FULLY editable on toggle", async ({ page }) => {
    await page.goto("/e2e.html");
    await page.evaluate(() => {
      window.editor.destroy();
      const host = document.getElementById("host")!;
      window.editor = new window.EdodoWrite(host, { value: "start", readOnly: true });
    });
    await page.evaluate(() => window.editor.setReadOnly(false));
    await page.locator(".ew-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    // Input rules must work — proof the listeners were wired all along.
    await page.keyboard.type("# now a heading");
    expect(await markdown(page)).toBe("# now a heading");
    // Undo must work too.
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await markdown(page)).not.toBe("# now a heading");
  });
});

test.describe("misc guards", () => {
  test("Mod+U does not underline (Markdown has no underline)", async ({ page }) => {
    await openEditor(page, "no underline");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+u");
    expect(await html(page)).not.toContain("<u>");
    expect(await markdown(page)).toBe("no underline");
  });

  test("Enter on a table escapes to a paragraph below instead of splitting it", async ({ page }) => {
    await openEditor(page, "| a | b |\n| --- | --- |\n| 1 | 2 |");
    await page.locator(".ew-content td").first().click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("below");
    const h = await html(page);
    expect((h.match(/<table/g) || []).length).toBe(1);
    expect(await markdown(page)).toContain("below");
  });

  test("Backspace at a paragraph after a table never merges into the table", async ({ page }) => {
    await openEditor(page, "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nkeep me");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const p = Array.from(root.children).find((c) => c.tagName === "P")!;
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.setStart(p.firstChild!, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      root.focus();
    });
    await page.keyboard.press("Backspace");
    const md = await markdown(page);
    expect(md).toContain("keep me");
    expect((await html(page)).match(/<table/g)!.length).toBe(1);
    // the paragraph must still be a sibling, not inside the table
    const inTable = await page.evaluate(() =>
      !!document.querySelector(".ew-content table p"));
    expect(inTable).toBe(false);
  });

  test("copy HTML flavor carries no editor internals (ZWSP, live checkboxes)", async ({ page }) => {
    await openEditor(page, "- [ ] task one\n- [x] task two");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.selectNodeContents(root);
      sel.removeAllRanges();
      sel.addRange(r);
    });
    const clip = await interceptCopy(page, "copy");
    expect(clip["text/plain"]).toBe("- [ ] task one\n- [x] task two");
    expect(clip["text/html"]).not.toContain("​");
    expect(clip["text/html"]).not.toContain("data-task");
  });
});
