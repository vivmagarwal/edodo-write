import { test, expect } from "@playwright/test";
import { openEditor, markdown, html, paste, interceptCopy, selectBlockText, caretToEnd } from "./helpers";

/** Markdown in, Markdown out — the clipboard contract. */

test.describe("copy / cut", () => {
  test("copy puts Markdown on text/plain and rich HTML on text/html", async ({ page }) => {
    await openEditor(page, "some **bold** words");
    await selectBlockText(page, 0);
    const clip = await interceptCopy(page, "copy");
    expect(clip["text/plain"]).toBe("some **bold** words");
    expect(clip["text/html"]).toContain("<strong>bold</strong>");
  });

  test("copying a heading + list yields block Markdown", async ({ page }) => {
    await openEditor(page, "## Head\n\n- a\n- b");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.selectNodeContents(root);
      sel.removeAllRanges();
      sel.addRange(r);
    });
    const clip = await interceptCopy(page, "copy");
    expect(clip["text/plain"]).toBe("## Head\n\n- a\n- b");
  });

  test("cut removes the selection from the document", async ({ page }) => {
    await openEditor(page, "keep\n\nremove me");
    await selectBlockText(page, 1);
    const clip = await interceptCopy(page, "cut");
    expect(clip["text/plain"]).toBe("remove me");
    expect(await markdown(page)).toBe("keep");
  });
});

test.describe("paste", () => {
  test("plain-text Markdown is parsed into real blocks", async ({ page }) => {
    await openEditor(page);
    await paste(page, { "text/plain": "# Pasted\n\n- one\n- two\n\n> quote" });
    const h = await html(page);
    expect(h).toContain("<h1>Pasted</h1>");
    expect(h).toContain("<ul>");
    expect(h).toContain("<blockquote>");
    expect(await markdown(page)).toBe("# Pasted\n\n- one\n- two\n\n> quote");
  });

  test("rich HTML is converted to Markdown blocks", async ({ page }) => {
    await openEditor(page);
    await paste(page, { "text/html": "<h2>From the web</h2><p>with <b>bold</b></p>" });
    expect(await markdown(page)).toBe("## From the web\n\nwith **bold**");
  });

  test("a single inline snippet pastes inline, without a new block", async ({ page }) => {
    await openEditor(page, "start end");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const p = root.children[0];
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.setStart(p.firstChild!, 6); // after "start "
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      root.focus();
    });
    await paste(page, { "text/plain": "**mid** " });
    expect(await markdown(page)).toBe("start **mid** end");
  });

  test("pasted script tags are sanitised away", async ({ page }) => {
    await openEditor(page);
    await paste(page, { "text/html": '<p>ok</p><script>window.__pwned = true</script><img src="x" onerror="window.__pwned2 = true">' });
    const pwned = await page.evaluate(() => [(window as any).__pwned, (window as any).__pwned2]);
    expect(pwned).toEqual([undefined, undefined]);
    const h = await html(page);
    expect(h).not.toContain("<script");
    expect(h).not.toContain("onerror");
  });

  test("mid-paragraph block paste splits the paragraph", async ({ page }) => {
    await openEditor(page, "before after");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const p = root.children[0];
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.setStart(p.firstChild!, 7); // after "before "
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      root.focus();
    });
    await paste(page, { "text/plain": "# Wedge\n\nmiddle" });
    const md = await markdown(page);
    expect(md).toContain("# Wedge");
    expect(md).toContain("middle");
    expect(md).toContain("after");
  });
});
