import { describe, it, expect } from "vitest";
import { normalizeDocument, isEffectivelyEmpty, visibleText } from "@core/normalize";

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("normalizeDocument", () => {
  it("wraps stray root text nodes into a paragraph", () => {
    const r = root("");
    r.textContent = "loose text";
    normalizeDocument(r);
    expect(r.innerHTML).toBe("<p>loose text</p>");
  });

  it("wraps a run of inline nodes into ONE paragraph", () => {
    const r = root("before <strong>bold</strong> after<h2>real</h2>");
    normalizeDocument(r);
    expect(r.children.length).toBe(2);
    expect(r.children[0].tagName).toBe("P");
    expect(r.children[0].innerHTML).toBe("before <strong>bold</strong> after");
    expect(r.children[1].tagName).toBe("H2");
  });

  it("converts a leaf <div> into a paragraph", () => {
    const r = root("<div>native enter artifact</div>");
    normalizeDocument(r);
    expect(r.innerHTML).toBe("<p>native enter artifact</p>");
  });

  it("unwraps a <div> that contains blocks", () => {
    const r = root("<div><p>one</p><p>two</p></div>");
    normalizeDocument(r);
    expect(r.innerHTML).toBe("<p>one</p><p>two</p>");
  });

  it("removes empty list shells", () => {
    const r = root("<p>keep</p><ul>\n</ul><ol></ol>");
    normalizeDocument(r);
    expect(r.querySelector("ul,ol")).toBeNull();
  });

  it("unwraps styled spans and strips style attributes (native merge artifacts)", () => {
    const r = root('<h1>Head<span style="font-size: 1rem">&nbsp;tail</span></h1><p style="color:red">x</p>');
    normalizeDocument(r);
    expect(r.innerHTML).not.toContain("<span");
    expect(r.innerHTML).not.toContain("style=");
    expect(r.querySelector("h1")!.textContent).toBe("Head tail");
  });

  it("gives empty blocks a caret anchor", () => {
    const r = root("<h2></h2>");
    normalizeDocument(r);
    expect(r.innerHTML).toBe("<h2><br></h2>");
  });

  it("wraps naked <pre> content in <code> and anchors an empty one", () => {
    const r = root("<pre>naked()</pre><pre></pre>");
    normalizeDocument(r);
    const pres = r.querySelectorAll("pre");
    expect(pres[0].innerHTML).toBe("<code>naked()</code>");
    expect(visibleText(pres[1])).toBe("");
    expect(pres[1].querySelector("code")!.firstChild).not.toBeNull(); // ZWSP anchor
  });

  it("repairs task items: checkbox first + caret anchor after it", () => {
    const r = root('<ul><li>text <input type="checkbox"></li></ul>');
    normalizeDocument(r);
    const li = r.querySelector("li")!;
    expect((li.firstChild as HTMLElement).tagName).toBe("INPUT");
    expect(li.firstChild!.nextSibling!.nodeType).toBe(Node.TEXT_NODE);
    expect(li.classList.contains("task-list-item")).toBe(true);
  });

  it("resets a childless root to one empty paragraph and reports it", () => {
    const r = root("");
    expect(normalizeDocument(r)).toBe(true);
    expect(r.innerHTML).toBe("<p><br></p>");
  });

  it("does NOT reset an intentionally empty heading (slash-menu state)", () => {
    const r = root("<h2><br></h2>");
    expect(normalizeDocument(r)).toBe(false);
    expect(r.querySelector("h2")).not.toBeNull();
  });

  it("is idempotent", () => {
    const r = root("loose<div>d</div><ul></ul><h1></h1>");
    normalizeDocument(r);
    const once = r.innerHTML;
    normalizeDocument(r);
    expect(r.innerHTML).toBe(once);
  });
});

describe("isEffectivelyEmpty", () => {
  it("true for emptied shells", () => {
    expect(isEffectivelyEmpty(root("<h1></h1><ul></ul>"))).toBe(true);
  });
  it("false when text or void content remains", () => {
    expect(isEffectivelyEmpty(root("<p>x</p>"))).toBe(false);
    expect(isEffectivelyEmpty(root("<p><img src='x.png'></p>"))).toBe(false);
    expect(isEffectivelyEmpty(root("<hr>"))).toBe(false);
  });
});

describe("plugin islands are off-limits to the normalizer", () => {
  it("inline styles inside widget figures survive (engine render output)", () => {
    const r = root(
      '<figure data-widget="diagram" data-source="x" contenteditable="false">' +
      '<div class="ew-widget__surface" style="position: relative; overflow: hidden;">' +
      '<svg style="position: absolute; width: 100%; height: 100%"><rect width="100%"></rect></svg>' +
      "</div></figure><p>prose</p>",
    );
    normalizeDocument(r);
    expect(r.querySelector(".ew-widget__surface")!.getAttribute("style")).toContain("relative");
    expect(r.querySelector("svg")!.getAttribute("style")).toContain("100%");
  });

  it("KaTeX-style spans inside data-math chips survive (no unwrap, no strip)", () => {
    const r = root(
      '<p>before <span class="ew-math" data-math="x^2" contenteditable="false">' +
      '<span class="katex" style="margin-right: 0.05em"><span style="top: -3em">x</span></span>' +
      "</span> after</p>",
    );
    normalizeDocument(r);
    const chip = r.querySelector("[data-math]")!;
    expect(chip.querySelectorAll("span[style]").length).toBe(2);
  });

  it("prose styling artifacts are STILL scrubbed outside islands", () => {
    const r = root(
      '<h1>Head<span style="font-size: 1rem">&nbsp;tail</span></h1>' +
      '<p style="color:red">x</p>' +
      '<figure data-widget="embed" data-source="u"><div style="padding: 4px">card</div></figure>',
    );
    normalizeDocument(r);
    expect(r.querySelector("h1 span")).toBeNull();          // prose span unwrapped
    expect(r.querySelector("p")!.hasAttribute("style")).toBe(false); // prose style stripped
    expect(r.querySelector("figure div")!.getAttribute("style")).toContain("padding"); // island kept
  });
});

describe("nested paragraph repair", () => {
  it("unwraps a <p> inside a <p> (container-split residue)", () => {
    const r = root("<p>outer <p>inner</p></p>");
    normalizeDocument(r);
    expect(r.querySelector("p p")).toBeNull();
    expect(r.textContent).toContain("inner");
  });

  it("leaves legitimate blockquote <p> children alone and anchors empty ones", () => {
    const r = root("<blockquote><p>kept</p><p></p></blockquote>");
    normalizeDocument(r);
    expect(r.querySelectorAll("blockquote > p").length).toBe(2);
    expect(r.querySelectorAll("blockquote > p")[1].firstChild).not.toBeNull(); // anchored
  });

  it("does not unwrap paragraphs inside plugin islands", () => {
    const r = root('<figure data-widget="embed" data-source="u"><div><p>card body</p></div></figure>');
    normalizeDocument(r);
    expect(r.querySelector("figure p")).not.toBeNull();
  });
});
