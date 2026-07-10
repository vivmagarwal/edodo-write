import { test, expect } from "@playwright/test";
import { openEditor, markdown, html } from "./helpers";

/**
 * Type-to-format: the Markdown input rules, driven by real typing (each
 * keystroke fires a real `input` event — the environment where
 * execCommand-based block ops silently fail, hence manual-DOM transforms).
 */

test.describe("block input rules", () => {
  const cases: Array<{ typed: string; then: string; tag: string; md: string }> = [
    { typed: "# ", then: "Title", tag: "h1", md: "# Title" },
    { typed: "## ", then: "Sub", tag: "h2", md: "## Sub" },
    { typed: "### ", then: "Small", tag: "h3", md: "### Small" },
    { typed: "> ", then: "wise words", tag: "blockquote", md: "> wise words" },
    { typed: "- ", then: "first", tag: "ul", md: "- first" },
    { typed: "* ", then: "starred", tag: "ul", md: "- starred" },
    { typed: "1. ", then: "one", tag: "ol", md: "1. one" },
  ];

  for (const c of cases) {
    test(`"${c.typed}" becomes <${c.tag}>`, async ({ page }) => {
      await openEditor(page);
      await page.keyboard.type(c.typed + c.then);
      expect(await html(page)).toContain(`<${c.tag}`);
      expect(await markdown(page)).toBe(c.md);
    });
  }

  test('"[ ] " becomes an unchecked task', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("[ ] buy milk");
    expect(await markdown(page)).toBe("- [ ] buy milk");
    await expect(page.locator('.ew-content input[type="checkbox"]')).toHaveCount(1);
    await expect(page.locator('.ew-content input[type="checkbox"]')).not.toBeChecked();
  });

  test('"[x] " becomes a checked task', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("[x] done thing");
    expect(await markdown(page)).toBe("- [x] done thing");
    await expect(page.locator('.ew-content input[type="checkbox"]')).toBeChecked();
  });

  test('"```" becomes a code block INSTANTLY; typed text stays verbatim', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("```");
    await page.keyboard.type("const x = 1;");
    expect(await html(page)).toContain("<pre>");
    expect(await markdown(page)).toBe("```\nconst x = 1;\n```");
  });

  test('"---" becomes a divider INSTANTLY on the third dash', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("---");
    expect(await html(page)).toContain("<hr");
    await page.keyboard.type("after");
    expect(await markdown(page)).toBe("---\n\nafter");
  });

  test('"___ " and "*** " become dividers (space-triggered)', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("___ ");
    expect(await html(page)).toContain("<hr");
    await page.keyboard.type("between");
    await page.keyboard.press("Enter");
    await page.keyboard.type("*** ");
    const h = await html(page);
    expect((h.match(/<hr/g) || []).length).toBe(2);
  });

  test('"___" + Enter converts to a divider (Enter fallback)', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("___");
    await page.keyboard.press("Enter");
    expect(await html(page)).toContain("<hr");
    await page.keyboard.type("after");
    expect(await markdown(page)).toBe("---\n\nafter");
  });

  test('typing "***bold italic***" is NOT hijacked by the divider rule', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("***both***");
    expect(await html(page)).not.toContain("<hr");
    expect(await markdown(page)).toContain("both");
  });
});

test.describe("inline input rules", () => {
  const cases: Array<{ typed: string; tag: string; md: string }> = [
    { typed: "some **bold** text", tag: "strong", md: "some **bold** text" },
    { typed: "some *italic* text", tag: "em", md: "some *italic* text" },
    { typed: "some _snake_ text", tag: "em", md: "some *snake* text" },
    { typed: "some `code` text", tag: "code", md: "some `code` text" },
    { typed: "some ~~gone~~ text", tag: "del", md: "some ~~gone~~ text" },
  ];

  for (const c of cases) {
    test(`typing "${c.typed}" produces <${c.tag}>`, async ({ page }) => {
      await openEditor(page);
      await page.keyboard.type(c.typed);
      expect(await html(page)).toContain(`<${c.tag}>`);
      expect(await markdown(page)).toBe(c.md);
    });
  }

  test("typing continues OUTSIDE the new mark (caret parked after)", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("**bold**plain");
    const h = await html(page);
    expect(h).toContain("<strong>bold</strong>");
    expect(h).not.toContain("<strong>boldplain</strong>");
    expect(await markdown(page)).toBe("**bold**plain");
  });

  test("inline rules do not fire inside a code block", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("```");
    await page.keyboard.type("not **bold** here");
    expect(await html(page)).not.toContain("<strong>");
    expect(await markdown(page)).toBe("```\nnot **bold** here\n```");
  });
});
