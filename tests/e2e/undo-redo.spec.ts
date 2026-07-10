import { test, expect } from "@playwright/test";
import { openEditor, markdown } from "./helpers";

/** Markdown-snapshot history driven by real keyboard shortcuts. */

test("undo reverts a typing burst; redo restores it", async ({ page }) => {
  await openEditor(page, "base");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("new line of text");
  await page.waitForTimeout(200); // let the debounced snapshot record
  expect(await markdown(page)).toBe("base\n\nnew line of text");

  // Typing bursts may span several snapshots (debounce timing), so undo/redo
  // until the target state is reached — the semantics we pin are reachability
  // in order, not snapshot granularity.
  for (let i = 0; i < 10 && (await markdown(page)) !== "base"; i++) {
    await page.keyboard.press("ControlOrMeta+z");
  }
  expect(await markdown(page)).toBe("base");

  for (let i = 0; i < 10 && (await markdown(page)) !== "base\n\nnew line of text"; i++) {
    await page.keyboard.press("ControlOrMeta+Shift+z");
  }
  expect(await markdown(page)).toBe("base\n\nnew line of text");
});

test("undo reverts a block transform", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("# Heading");
  await page.waitForTimeout(200);
  await page.keyboard.press("ControlOrMeta+z");
  const md = await markdown(page);
  expect(md).not.toContain("# Heading");
});

test("Mod+Y also redoes", async ({ page }) => {
  await openEditor(page, "one");
  await page.keyboard.press("End");
  await page.keyboard.type(" two");
  await page.waitForTimeout(200);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await markdown(page)).toBe("one");
  await page.keyboard.press("ControlOrMeta+y");
  expect(await markdown(page)).toBe("one two");
});

test("a fresh edit after undo truncates the redo tail", async ({ page }) => {
  await openEditor(page, "start");
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  await page.waitForTimeout(200);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await markdown(page)).toBe("start");
  await page.keyboard.press("End");
  await page.keyboard.type(" branch");
  await page.waitForTimeout(200);
  await page.keyboard.press("ControlOrMeta+Shift+z"); // nothing to redo
  expect(await markdown(page)).toBe("start branch");
});
