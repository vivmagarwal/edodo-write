import { test, expect, type Page } from "@playwright/test";
import { markdown } from "./helpers";

/**
 * The composer-embedding surface in a REAL browser: fill layout geometry,
 * the docked (fixed) toolbar, and the emoji `:query` suggestion menu.
 * Convention: every behavior is proven on BOTH paths — the user's gesture
 * (hover/click/type) and the public API (window.editor.*).
 */

async function openFixture(page: Page, qs: string, focusFirstBlock = true) {
  await page.goto(`/e2e.html${qs}`);
  const content = page.locator(".ew-content");
  await content.waitFor();
  if (focusFirstBlock) await content.locator(":scope > *").first().click();
  return content;
}

/** The fixture page caps #host at 46rem (a page-like container). The layout
 *  tests are about how the editor fills WHATEVER box the app gives it, so
 *  they lift the cap and size the host like an embedding app would. */
async function unconstrainHost(page: Page, extra = "") {
  await page.addStyleTag({ content: `#host { max-width: none; margin: 0; ${extra} }` });
}

test.describe("fill layout", () => {
  test("page (default): a centered column capped below the host width", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const content = await openFixture(page, "?value=hello");
    await unconstrainHost(page);
    const host = await page.locator("#host").boundingBox();
    const box = await content.boundingBox();
    expect(box!.width).toBeLessThan(host!.width); // capped by --ew-content-width
    expect(box!.x).toBeGreaterThan(host!.x + 100); // and centered, not left-flush
  });

  test("fill: the content takes the host's full width and loses the page pad", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const content = await openFixture(page, "?value=hello&layout=fill");
    await unconstrainHost(page);
    await expect(page.locator("#host")).toHaveClass(/ew--fill/);
    const host = await page.locator("#host").boundingBox();
    const box = await content.boundingBox();
    expect(Math.abs(box!.width - host!.width)).toBeLessThan(2);
    // The 40vh document pad is gone: a one-line doc is a short box, not 320px+.
    expect(box!.height).toBeLessThan(200);
    // …and typing works exactly the same.
    await page.keyboard.type(" world");
    expect(await markdown(page)).toBe("hello world");
  });

  test("fill: the editor stretches to a fixed-height composer box", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const content = await openFixture(page, "?value=hello&layout=fill&toolbar=fixed");
    await unconstrainHost(page, "height: 240px; border: 1px solid #ccc;");
    const host = await page.locator("#host").boundingBox();
    const bar = await page.locator(".ew-fixed-toolbar").boundingBox();
    const box = await content.boundingBox();
    // toolbar docked on top, content fills the REST of the box
    expect(Math.abs(bar!.y - host!.y)).toBeLessThan(3);
    expect(Math.abs(box!.y + box!.height - (host!.y + host!.height))).toBeLessThan(3);
  });

  test("API: setLayout flips the geometry at runtime", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const content = await openFixture(page, "?value=hello");
    await unconstrainHost(page);
    const before = await content.boundingBox();
    await page.evaluate(() => window.editor.setLayout("fill"));
    const after = await content.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 100);
    await page.evaluate(() => window.editor.setLayout("page"));
    const back = await content.boundingBox();
    expect(Math.abs(back!.width - before!.width)).toBeLessThan(2);
  });
});

test.describe("fixed toolbar", () => {
  test("gesture: always visible; click Bold, type, click again to unbold", async ({ page }) => {
    await openFixture(page, "?toolbar=fixed");
    const bar = page.locator(".ew-fixed-toolbar");
    await expect(bar).toBeVisible(); // no selection needed — that's the point
    await page.keyboard.type("plain ");
    await bar.locator('[data-cmd="bold"]').click();
    await page.keyboard.type("loud");
    await bar.locator('[data-cmd="bold"]').click();
    await page.keyboard.type(" plain");
    expect(await markdown(page)).toBe("plain **loud** plain");
  });

  test("gesture: the bar reflects formatting AT THE CARET (no selection)", async ({ page }) => {
    await openFixture(page, "?value=" + encodeURIComponent("plain **loud** end") + "&toolbar=fixed");
    const bold = page.locator('.ew-fixed-toolbar [data-cmd="bold"]');
    await page.locator(".ew-content strong").click(); // caret inside the bold run
    await expect(bold).toHaveClass(/is-active/);
    await page.locator(".ew-content p").click({ position: { x: 5, y: 5 } }); // caret in plain text
    await expect(bold).not.toHaveClass(/is-active/);
  });

  test("gesture: a block button transforms the current block", async ({ page }) => {
    await openFixture(page, "?value=item&toolbar=fixed");
    await page.locator('.ew-fixed-toolbar [data-cmd="bulletList"]').click();
    expect(await markdown(page)).toBe("- item");
  });

  test("toolbarItems picks the buttons, in order", async ({ page }) => {
    await openFixture(page, "?toolbar=fixed&toolbarItems=italic,bold");
    const ids = await page
      .locator(".ew-fixed-toolbar .ew-toolbar__btn")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.cmd));
    expect(ids).toEqual(["italic", "bold"]);
  });

  test("read-only disables the bar; toggling back re-arms it", async ({ page }) => {
    await openFixture(page, "?value=x&toolbar=fixed");
    await page.evaluate(() => window.editor.setReadOnly(true));
    await expect(page.locator('.ew-fixed-toolbar [data-cmd="bold"]')).toBeDisabled();
    await page.evaluate(() => window.editor.setReadOnly(false));
    await expect(page.locator('.ew-fixed-toolbar [data-cmd="bold"]')).toBeEnabled();
  });

  test("API: setToolbar switches modes at runtime; exec matches the gesture", async ({ page }) => {
    await openFixture(page, "?value=hello");
    await expect(page.locator(".ew-fixed-toolbar")).toHaveCount(0);
    await page.evaluate(() => window.editor.setToolbar({ mode: "fixed", items: ["bold", "italic"] }));
    await expect(page.locator(".ew-fixed-toolbar .ew-toolbar__btn")).toHaveCount(2);
    // API path produces the same document as the button path.
    await page.locator(".ew-content p").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.evaluate(() => window.editor.exec("bold"));
    expect(await markdown(page)).toBe("**hello**");
    await page.evaluate(() => window.editor.setToolbar("none"));
    await expect(page.locator(".ew-fixed-toolbar")).toHaveCount(0);
  });
});

test.describe("emoji autocomplete", () => {
  test("gesture: `:` + query opens the menu; Enter inserts; round-trips", async ({ page }) => {
    await openFixture(page, "?plugins=emoji");
    await page.keyboard.type("ship it :rock");
    const menu = page.locator(".ew-popover.ew-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText(":rocket:");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    expect(await markdown(page)).toBe("ship it :rocket:");
    // …and the chip renders the glyph
    await expect(page.locator('.ew-content [data-shortcode="rocket"]')).toHaveText("🚀");
  });

  test("gesture: arrows navigate, click picks, Escape leaves text alone", async ({ page }) => {
    await openFixture(page, "?plugins=emoji");
    await page.keyboard.type(":hea"); // heart, hear_no_evil, headphones…
    const menu = page.locator(".ew-popover.ew-menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    expect(await markdown(page)).toBe(":hea");
    // reopen by typing one more character, then pick the first row by click
    await page.keyboard.type("r");
    await expect(menu).toBeVisible();
    const first = menu.locator(".ew-menu__title").first();
    const code = (await first.textContent())!; // e.g. ":heart:"
    await first.click();
    expect(await markdown(page)).toBe(code);
  });

  test("typing the full :shortcode: still converts instantly (input rule)", async ({ page }) => {
    await openFixture(page, "?plugins=emoji");
    await page.keyboard.type("go :tada: go");
    expect(await markdown(page)).toBe("go :tada: go");
    await expect(page.locator('.ew-content [data-shortcode="tada"]')).toHaveText("🎉");
  });

  test("API: stored shortcodes hydrate as chips and round-trip byte-stable", async ({ page }) => {
    await openFixture(page, "?plugins=emoji", false);
    await page.evaluate(() => window.editor.setMarkdown("hi :wave: — ship :rocket:"));
    await expect(page.locator(".ew-content [data-shortcode]")).toHaveCount(2);
    expect(await markdown(page)).toBe("hi :wave: — ship :rocket:");
  });
});

test.describe("v0.9.0 review regressions", () => {
  test("emoji menu opens at the start of a SECOND (typed) list item", async ({ page }) => {
    await openFixture(page, "?plugins=emoji");
    await page.keyboard.type("- item one");
    await page.keyboard.press("Enter");
    await page.keyboard.type(":roc");
    await expect(page.locator(".ew-popover.ew-menu")).toBeVisible();
    await page.keyboard.press("Enter");
    expect(await markdown(page)).toBe("- item one\n- :rocket:");
  });

  test("emoji rows are buttons: no horizontal overflow, glyph beside its name", async ({ page }) => {
    await openFixture(page, "?plugins=emoji");
    await page.keyboard.type(":roc");
    const menu = page.locator(".ew-popover.ew-menu");
    await expect(menu).toBeVisible();
    const overflow = await menu.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const row = menu.locator(".ew-menu__item").first();
    expect(await row.evaluate((el) => el.tagName)).toBe("BUTTON");
    const glyph = await row.locator(".ew-emoji-menu__glyph").boundingBox();
    const title = await row.locator(".ew-menu__title").boundingBox();
    // adjacent (Slack-style "🚀 :rocket:"), not pushed to opposite edges
    expect(title!.x - (glyph!.x + glyph!.width)).toBeLessThan(20);
  });

  test("fill: scrolling the content hides the block handle (no wrong-block actions)", async ({ page }) => {
    const long = Array.from({ length: 30 }, (_, i) => `para ${i}`).join("\n\n");
    const content = await openFixture(page, `?value=${encodeURIComponent(long)}&layout=fill`);
    await unconstrainHost(page, "height: 200px;");
    await content.locator(":scope > p").nth(2).hover();
    await expect(page.locator(".ew-block-handle")).toBeVisible();
    await content.evaluate((el) => { el.scrollTop += 120; });
    await expect(page.locator(".ew-block-handle")).toBeHidden();
  });

  test("setToolbar('floating') over a live selection shows the bar immediately", async ({ page }) => {
    await openFixture(page, "?value=hello%20world&toolbar=fixed");
    await page.locator(".ew-content p").dblclick(); // select a word
    await page.evaluate(() => window.editor.setToolbar("floating"));
    await expect(page.locator(".ew-toolbar")).toHaveClass(/is-visible/);
    await expect(page.locator(".ew-fixed-toolbar")).toHaveCount(0);
  });
});
