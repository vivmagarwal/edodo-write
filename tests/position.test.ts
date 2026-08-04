import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { position } from "@core/ui";

/**
 * The floating-panel positioner.
 *
 * The bug this guards: `position` clamped horizontally but not vertically, so
 * a panel that preferred "below" and did not fit below was written out at a
 * `top` past the bottom of the window. In the slash menu's case that is the
 * ORDINARY case, not an edge one — an editor pane of fixed height usually
 * ends at the fold, so typing `/` on its last line put a 320px menu entirely
 * off-screen and it read as "the slash menu is broken".
 *
 * jsdom lays nothing out: `getBoundingClientRect()` is 0×0 for every element
 * and `clientWidth/clientHeight` are 0. Both are stubbed here so the geometry
 * under test is the geometry asserted — the panel's own size is the only
 * thing `position` measures, and the viewport is the only thing it clamps to.
 */

const VIEWPORT = { w: 1000, h: 800 };
const PANEL = { w: 280, h: 320 };

let panel: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  panel = document.createElement("div");
  panel.style.position = "absolute";
  document.body.appendChild(panel);
  panel.getBoundingClientRect = () =>
    new DOMRect(0, 0, PANEL.w, PANEL.h);
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: VIEWPORT.w,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: VIEWPORT.h,
    configurable: true,
  });
  window.scrollX = 0;
  window.scrollY = 0;
});

afterEach(() => {
  window.scrollX = 0;
  window.scrollY = 0;
});

/** The caret rect a writer's cursor would produce at a given viewport y. */
const caretAt = (top: number, left = 400) => new DOMRect(left, top, 0, 20);

const placed = () => ({
  left: parseInt(panel.style.left, 10),
  top: parseInt(panel.style.top, 10),
});

describe("position", () => {
  it("drops below the anchor when there is room", () => {
    position(panel, caretAt(100), "below");
    // 100 + 20 (caret height) + 6 (gap)
    expect(placed().top).toBe(126);
    expect(placed().left).toBe(400);
  });

  it("flips ABOVE the anchor when the panel would overflow the bottom", () => {
    // A caret on the last line of a pane that ends at the fold. Below would
    // be 806 — the whole panel past a 800px window.
    position(panel, caretAt(780), "below");
    const { top } = placed();
    // 780 - 6 - 320
    expect(top).toBe(454);
    expect(top + PANEL.h).toBeLessThanOrEqual(VIEWPORT.h);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it("flips BELOW the anchor when the panel would overflow the top", () => {
    position(panel, caretAt(30), "above");
    // No room above (30 - 6 - 320 is negative), so it drops below: 30+20+6
    expect(placed().top).toBe(56);
  });

  it("sits above the anchor when 'above' is preferred and fits", () => {
    position(panel, caretAt(500), "above");
    expect(placed().top).toBe(174);
  });

  it("keeps a panel taller than the window inside the viewport", () => {
    panel.getBoundingClientRect = () => new DOMRect(0, 0, PANEL.w, 2000);
    position(panel, caretAt(400), "below");
    const { top } = placed();
    expect(top).toBe(8);
  });

  it("clamps horizontally at both edges", () => {
    position(panel, caretAt(100, 990), "below");
    expect(placed().left).toBe(VIEWPORT.w - PANEL.w - 8);
    position(panel, caretAt(100, -50), "below");
    expect(placed().left).toBe(8);
  });

  it("writes DOCUMENT coordinates — the page's scroll offset is added last", () => {
    window.scrollX = 60;
    window.scrollY = 1200;
    position(panel, caretAt(100), "below");
    // The anchor rect is viewport-relative, so the decision is unchanged and
    // only the final translation differs.
    expect(placed()).toEqual({ left: 400 + 60, top: 126 + 1200 });
  });
});
