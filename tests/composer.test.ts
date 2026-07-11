import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";

/**
 * The composer-embedding surface: the `layout` option ("page" vs "fill") and
 * the `toolbar` option (floating / fixed / none, with item picking). Geometry
 * is CSS (proven in the Playwright suite) — these tests pin the structural
 * contract: classes, DOM placement, ordering, disabled state, teardown.
 */

// jsdom lacks Range.getClientRects — selection-positioned UI needs the stub.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

function mount(options = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, options);
}

describe("layout option", () => {
  it("default is page — no fill class", () => {
    const editor = mount();
    expect(editor.host.classList.contains("ew--fill")).toBe(false);
    editor.destroy();
  });

  it('layout: "fill" stamps ew--fill on the host', () => {
    const editor = mount({ layout: "fill" });
    expect(editor.host.classList.contains("ew--fill")).toBe(true);
    editor.destroy();
  });

  it("setLayout toggles at runtime, both directions", () => {
    const editor = mount();
    editor.setLayout("fill");
    expect(editor.host.classList.contains("ew--fill")).toBe(true);
    editor.setLayout("page");
    expect(editor.host.classList.contains("ew--fill")).toBe(false);
    editor.destroy();
  });
});

describe("toolbar option", () => {
  it("default (and true) is the floating bar only", () => {
    const editor = mount();
    expect(document.querySelector(".ew-toolbar")).toBeTruthy();
    expect(document.querySelector(".ew-fixed-toolbar")).toBeNull();
    editor.destroy();
    expect(document.querySelector(".ew-toolbar")).toBeNull();
  });

  it('"none" (and false) builds neither', () => {
    const a = mount({ toolbar: "none" });
    expect(document.querySelector(".ew-toolbar")).toBeNull();
    expect(document.querySelector(".ew-fixed-toolbar")).toBeNull();
    a.destroy();
    const b = mount({ toolbar: false });
    expect(document.querySelector(".ew-toolbar")).toBeNull();
    b.destroy();
  });

  it('"fixed" docks the bar inside the host, before the content', () => {
    const editor = mount({ toolbar: "fixed" });
    const bar = editor.host.querySelector(".ew-fixed-toolbar");
    expect(bar).toBeTruthy();
    expect(bar!.nextElementSibling).toBe(editor.content);
    expect(document.querySelector(".ew-toolbar")).toBeNull(); // no floating twin
    editor.destroy();
    expect(document.querySelector(".ew-fixed-toolbar")).toBeNull();
  });

  it("the fixed bar carries every registry item, including the list/code buttons", () => {
    const editor = mount({ toolbar: "fixed" });
    const ids = Array.from(
      editor.host.querySelectorAll<HTMLButtonElement>(".ew-fixed-toolbar .ew-toolbar__btn"),
    ).map((b) => b.dataset.cmd);
    expect(ids).toEqual([
      "bold", "italic", "strike", "code", "link",
      "heading1", "heading2", "blockquote",
      "bulletList", "orderedList", "codeBlock",
    ]);
    editor.destroy();
  });

  it("items picks buttons in the GIVEN order; unknown ids are skipped", () => {
    const editor = mount({ toolbar: { mode: "fixed", items: ["italic", "bold", "nope"] } });
    const ids = Array.from(
      editor.host.querySelectorAll<HTMLButtonElement>(".ew-fixed-toolbar .ew-toolbar__btn"),
    ).map((b) => b.dataset.cmd);
    expect(ids).toEqual(["italic", "bold"]);
    editor.destroy();
  });

  it("items also trims the floating bar", () => {
    const editor = mount({ toolbar: { mode: "floating", items: ["bold"] } });
    const ids = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".ew-toolbar .ew-toolbar__btn"),
    ).map((b) => b.dataset.cmd);
    expect(ids).toEqual(["bold"]);
    editor.destroy();
  });

  it("setToolbar swaps modes at runtime and never leaks the old bar", () => {
    const editor = mount(); // floating
    editor.setToolbar({ mode: "fixed", items: ["bold", "italic"] });
    expect(document.querySelector(".ew-toolbar")).toBeNull();
    expect(editor.host.querySelectorAll(".ew-fixed-toolbar").length).toBe(1);
    editor.setToolbar("none");
    expect(document.querySelector(".ew-fixed-toolbar")).toBeNull();
    editor.setToolbar(true);
    expect(document.querySelector(".ew-toolbar")).toBeTruthy();
    editor.destroy();
  });

  it("a fixed-bar button drives a real command (block transform, no execCommand)", () => {
    const editor = mount({ value: "hello", toolbar: "fixed" });
    editor.focus();
    const btn = editor.host.querySelector<HTMLButtonElement>('[data-cmd="codeBlock"]')!;
    btn.click();
    expect(editor.getMarkdown()).toBe("```\nhello\n```");
    editor.destroy();
  });

  it("read-only disables the fixed bar and re-enabling restores it", () => {
    const editor = mount({ value: "x", toolbar: "fixed" });
    const btn = editor.host.querySelector<HTMLButtonElement>('[data-cmd="bold"]')!;
    editor.setReadOnly(true);
    expect(btn.disabled).toBe(true);
    expect(editor.host.querySelector(".ew-fixed-toolbar--disabled")).toBeTruthy();
    editor.setReadOnly(false);
    expect(btn.disabled).toBe(false);
    expect(editor.host.querySelector(".ew-fixed-toolbar--disabled")).toBeNull();
    editor.destroy();
  });

  it("an editor constructed read-only starts with the fixed bar disabled", () => {
    const editor = mount({ value: "x", toolbar: "fixed", readOnly: true });
    const btn = editor.host.querySelector<HTMLButtonElement>('[data-cmd="bold"]')!;
    expect(btn.disabled).toBe(true);
    editor.destroy();
  });
});

// ── Review regressions: lifecycle (v0.9.0 review) ───────────────────────────

describe("lifecycle regressions", () => {
  it("a reused host never inherits the previous editor's fill layout", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const a = new EdodoWrite(host, { layout: "fill" });
    expect(host.classList.contains("ew--fill")).toBe(true);
    a.destroy();
    expect(host.classList.contains("ew--fill"), "destroy cleans the class").toBe(false);
    const b = new EdodoWrite(host, { layout: "page" });
    expect(host.classList.contains("ew--fill")).toBe(false);
    b.destroy();
  });

  it("setToolbar / setLayout after destroy are safe no-ops (no throw, no leak)", () => {
    const editor = mount({ toolbar: "fixed" });
    editor.destroy();
    expect(() => editor.setToolbar("fixed")).not.toThrow();
    expect(() => editor.setToolbar("floating")).not.toThrow();
    expect(() => editor.setLayout("fill")).not.toThrow();
    expect(document.querySelector(".ew-toolbar"), "no floating bar leaked onto body").toBeNull();
    expect(document.querySelector(".ew-fixed-toolbar")).toBeNull();
    expect(editor.host.classList.contains("ew--fill")).toBe(false);
  });
});
