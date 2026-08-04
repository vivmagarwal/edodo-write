import { describe, it, expect, beforeEach } from "vitest";
import { keepCaretInView } from "@core/ui";

/**
 * Keeping the caret comfortably on screen.
 *
 * The bug this guards: browsers scroll a caret into view only just — the line
 * you are writing ends flush against the bottom of the scroller, with nothing
 * visible beneath it. A page-height editor hides that behind its
 * document-length bottom padding; an EMBEDDED one, given a fixed box by its
 * host, has none, so writing at the end of a document happens on the last
 * visible pixel row. Reported as: "when I move to the last line and press
 * Enter … the whole thing should scroll up so that the user always sees the
 * cursor and also a few more new lines below that."
 *
 * jsdom lays nothing out, so the geometry is stubbed: a scroller box, and a
 * caret rect placed wherever the case needs it. What is under test is the
 * arithmetic that decides whether — and how far — to scroll.
 */

const BOX = { top: 100, bottom: 500, height: 400 };
const MARGIN = 56;

let scroller: HTMLElement;

/** Put the caret at a given viewport y, with a line's height. */
function caretAt(top: number, height = 20) {
  const node = scroller.firstChild as Node;
  const range = {
    startContainer: node,
    getBoundingClientRect: () => new DOMRect(0, top, 1, height),
  };
  const selection = {
    rangeCount: 1,
    getRangeAt: () => range,
  };
  window.getSelection = () => selection as unknown as Selection;
}

beforeEach(() => {
  document.body.innerHTML = "";
  scroller = document.createElement("div");
  scroller.appendChild(document.createTextNode("x"));
  document.body.appendChild(scroller);
  scroller.getBoundingClientRect = () =>
    new DOMRect(0, BOX.top, 800, BOX.height);
  scroller.scrollTop = 0;
});

describe("keepCaretInView", () => {
  it("leaves a comfortable caret alone", () => {
    caretAt(300);
    keepCaretInView(scroller, MARGIN);
    expect(scroller.scrollTop).toBe(0);
  });

  it("scrolls down when the caret is at the very bottom edge", () => {
    // The reported case: the line being typed sits on the last pixel row.
    caretAt(BOX.bottom - 20);
    keepCaretInView(scroller, MARGIN);
    // Enough to put MARGIN of blank space under the caret.
    expect(scroller.scrollTop).toBe(MARGIN);
  });

  it("scrolls down when the caret has gone below the fold entirely", () => {
    caretAt(BOX.bottom + 40);
    keepCaretInView(scroller, MARGIN);
    expect(scroller.scrollTop).toBe(40 + 20 + MARGIN);
  });

  it("scrolls up when the caret is above the top edge", () => {
    scroller.scrollTop = 500;
    caretAt(BOX.top - 30);
    keepCaretInView(scroller, MARGIN);
    expect(scroller.scrollTop).toBe(500 - (30 + MARGIN));
  });

  it("never asks a short box for more room than it has", () => {
    // A 40px-tall composer cannot give 56px of margin top AND bottom; being
    // able to SEE the caret has to win over the breathing room.
    scroller.getBoundingClientRect = () => new DOMRect(0, 100, 800, 40);
    caretAt(132);
    keepCaretInView(scroller, MARGIN);
    expect(scroller.scrollTop).toBeGreaterThanOrEqual(0);
    expect(scroller.scrollTop).toBeLessThan(40);
  });

  it("ignores a selection that is not inside this editor", () => {
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    const outside = document.createTextNode("y");
    elsewhere.appendChild(outside);
    window.getSelection = () =>
      ({
        rangeCount: 1,
        getRangeAt: () => ({
          startContainer: outside,
          getBoundingClientRect: () => new DOMRect(0, 9999, 1, 20),
        }),
      }) as unknown as Selection;
    keepCaretInView(scroller, MARGIN);
    expect(scroller.scrollTop).toBe(0);
  });

  it("falls back to the block's box when the caret measures zero", () => {
    // A collapsed range at a block boundary reports 0x0 in every browser.
    const block = document.createElement("p");
    block.getBoundingClientRect = () => new DOMRect(0, BOX.bottom - 10, 800, 20);
    scroller.appendChild(block);
    const text = document.createTextNode("hello");
    block.appendChild(text);
    window.getSelection = () =>
      ({
        rangeCount: 1,
        getRangeAt: () => ({
          startContainer: text,
          getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
        }),
      }) as unknown as Selection;
    keepCaretInView(scroller, MARGIN);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it("does nothing without a selection", () => {
    window.getSelection = () => null;
    expect(() => keepCaretInView(scroller, MARGIN)).not.toThrow();
    expect(scroller.scrollTop).toBe(0);
  });
});
