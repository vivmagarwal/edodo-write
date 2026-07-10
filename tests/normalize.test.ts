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
