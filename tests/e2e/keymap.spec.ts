import { test, expect } from "@playwright/test";
import { openEditor, markdown, html, caretToEnd } from "./helpers";

/** Enter / Backspace / Tab semantics (the Notion-verified behaviors). */

test.describe("Enter", () => {
  test("at the end of a heading starts a paragraph, not another heading", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("# Big");
    await page.keyboard.press("Enter");
    await page.keyboard.type("body");
    expect(await html(page)).toContain("<h1>Big</h1>");
    expect(await markdown(page)).toBe("# Big\n\nbody");
  });

  test("inside a heading splits it; the tail becomes a paragraph", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("# HeadTail");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    expect(await markdown(page)).toBe("# Head\n\nTail");
  });

  test("in a list item creates the next item", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("- one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("two");
    expect(await markdown(page)).toBe("- one\n- two");
  });

  test("in an EMPTY list item exits the list", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("- one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // empty item → exit
    await page.keyboard.type("outside");
    expect(await markdown(page)).toBe("- one\n\noutside");
  });

  test("in a code block inserts a newline, not a new block", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("```");
    await page.keyboard.type("line1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("line2");
    expect(await markdown(page)).toBe("```\nline1\nline2\n```");
    expect(await html(page)).not.toContain("<div>");
  });

  test("never produces a native <div> block", async ({ page }) => {
    await openEditor(page, "# One\n\ntwo");
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("three");
    await page.keyboard.press("Enter");
    expect(await html(page)).not.toContain("<div>");
  });
});

test.describe("Backspace", () => {
  test("at the start of a heading converts it to a paragraph", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("# Title");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    expect(await html(page)).not.toContain("<h1>");
    expect(await markdown(page)).toBe("Title");
  });

  test("at the start of a quote converts it to a paragraph", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("> quoted");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    expect(await markdown(page)).toBe("quoted");
  });

  test("at the start of a list item unwraps it to a paragraph", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("- item");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    expect(await markdown(page)).toBe("item");
  });

  test("at the start of a paragraph merges into the previous block", async ({ page }) => {
    await openEditor(page, "first\n\nsecond");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const p2 = root.children[1];
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.setStart(p2.firstChild!, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      root.focus();
    });
    await page.keyboard.press("Backspace");
    expect(await markdown(page)).toBe("firstsecond");
  });

  test("deletes a divider that precedes the paragraph", async ({ page }) => {
    await openEditor(page, "above\n\n---\n\nbelow");
    await page.evaluate(() => {
      const root = document.querySelector(".ew-content") as HTMLElement;
      const below = root.children[2];
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.setStart(below.firstChild!, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      root.focus();
    });
    await page.keyboard.press("Backspace");
    expect(await markdown(page)).toBe("above\n\nbelow");
  });
});

test.describe("Tab in lists", () => {
  test("indents the second item into a nested list; Shift+Tab outdents", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("- parent");
    await page.keyboard.press("Enter");
    await page.keyboard.type("child");
    await page.keyboard.press("Tab");
    // turndown emits 4-space nested-list indentation (CommonMark-valid).
    expect(await markdown(page)).toBe("- parent\n    - child");
    await page.keyboard.press("Shift+Tab");
    expect(await markdown(page)).toBe("- parent\n- child");
  });

  test("cannot indent the first item", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("- only");
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    expect(await markdown(page)).toBe("- only");
  });
});

test.describe("shortcuts", () => {
  test("Mod+B bolds the selection", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("make this bold");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");
    expect(await markdown(page)).toBe("**make this bold**");
  });

  test("Mod+I italicises the selection", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("emphasis");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+i");
    expect(await markdown(page)).toBe("*emphasis*");
  });

  test("Mod+Shift+8 toggles a bullet list", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("listify");
    await page.keyboard.press("ControlOrMeta+Shift+8");
    expect(await markdown(page)).toBe("- listify");
  });
});
