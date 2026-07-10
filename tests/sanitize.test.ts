import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "edodo-write";

/**
 * The negative matrix for the sanitiser: what must never survive, what must
 * be unwrapped, and how far `SanitizeOptions` widening is allowed to go.
 */

describe("denied tags are removed outright (children included)", () => {
  it("script (element and its payload)", () => {
    expect(sanitizeHtml("<p>a</p><script>alert(1)</script>")).toBe("<p>a</p>");
  });

  it("style", () => {
    expect(sanitizeHtml("<style>p{color:red}</style><p>hi</p>")).toBe("<p>hi</p>");
  });

  it("iframe", () => {
    expect(sanitizeHtml('<iframe src="https://evil.test"></iframe><p>ok</p>')).toBe("<p>ok</p>");
  });

  it("object and embed (fallback content dies with the object)", () => {
    expect(sanitizeHtml('<object data="x"><p>fallback</p></object><embed src="x"><p>ok</p>')).toBe("<p>ok</p>");
  });

  it("form takes its children with it", () => {
    expect(sanitizeHtml("<form><p>inside</p></form><p>after</p>")).toBe("<p>after</p>");
  });

  it("meta, link, base", () => {
    expect(
      sanitizeHtml('<meta http-equiv="refresh" content="0"><link rel="stylesheet" href="x"><base href="https://evil.test/"><p>kept</p>'),
    ).toBe("<p>kept</p>");
  });

  it("template (its inert content never re-enters the tree)", () => {
    expect(sanitizeHtml("<template><script>alert(1)</script><p>t</p></template><p>kept</p>")).toBe("<p>kept</p>");
  });

  it("noscript", () => {
    expect(sanitizeHtml("<noscript><p>ns</p></noscript><p>ok</p>")).toBe("<p>ok</p>");
  });
});

describe("event handlers are stripped", () => {
  it("onclick on an allowed tag", () => {
    expect(sanitizeHtml('<p onclick="alert(1)">x</p>')).toBe("<p>x</p>");
  });

  it("onerror on an image (src survives, handler does not)", () => {
    expect(sanitizeHtml('<img src="https://x.test/a.png" onerror="alert(1)">')).toBe('<img src="https://x.test/a.png">');
  });

  it("onmouseover on a link", () => {
    expect(sanitizeHtml('<a href="https://x.test" onmouseover="pwn()">x</a>')).toBe('<a href="https://x.test">x</a>');
  });

  it("mixed-case handler names (the HTML parser lowercases them)", () => {
    expect(sanitizeHtml('<p ONClick="alert(1)">x</p>')).toBe("<p>x</p>");
  });
});

describe("URL scheme blocking", () => {
  it("javascript: href is removed (tag and text survive)", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("mixed-case JaVaScRiPt:", () => {
    expect(sanitizeHtml('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("leading whitespace does not hide the scheme", () => {
    expect(sanitizeHtml('<a href="   javascript:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("vbscript:", () => {
    expect(sanitizeHtml('<a href="vbscript:MsgBox(1)">x</a>')).toBe("<a>x</a>");
  });

  it("data:text/html href (mixed case too)", () => {
    expect(sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="DATA:text/html;base64,PHNjcmlwdD4=">x</a>')).toBe("<a>x</a>");
  });

  it("data:text/html img src", () => {
    expect(sanitizeHtml('<img src="data:text/html,<script>x</script>" alt="a">')).toBe('<img alt="a">');
  });

  it("data:image src is allowed", () => {
    expect(sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="a">')).toBe(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="a">',
    );
  });

  it("https, mailto, and relative URLs are allowed", () => {
    expect(sanitizeHtml('<a href="https://x.test/p?q=1#f">x</a>')).toBe('<a href="https://x.test/p?q=1#f">x</a>');
    expect(sanitizeHtml('<a href="mailto:a@b.test">x</a>')).toBe('<a href="mailto:a@b.test">x</a>');
    expect(sanitizeHtml('<a href="/relative/path">x</a>')).toBe('<a href="/relative/path">x</a>');
  });

  // Browsers strip ASCII tab/newline/CR when parsing URLs, so
  // href="jav\tascript:alert(1)" — or the entity-encoded "jav&#x09;ascript:…"
  // — is a live javascript: URL. safeUrl strips C0 controls before the
  // scheme check.
  it("tab/newline inside the scheme cannot bypass the javascript: block", () => {
    expect(sanitizeHtml('<a href="jav\tascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="jav&#x09;ascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="java\nscript:alert(1)">x</a>')).toBe("<a>x</a>");
  });
});

describe("unknown tags unwrap, keeping their children", () => {
  it("section around a paragraph", () => {
    expect(sanitizeHtml("<section><p>hi</p></section>")).toBe("<p>hi</p>");
  });

  it("nested unknown wrappers unwrap all the way down", () => {
    expect(sanitizeHtml("<section><article><p>deep</p></article></section>")).toBe("<p>deep</p>");
  });

  it("custom elements unwrap keeping inline children", () => {
    expect(sanitizeHtml("<custom-x>text <b>b</b></custom-x>")).toBe("text <b>b</b>");
  });

  it("svg unwraps to nothing (no text content)", () => {
    expect(sanitizeHtml('<svg onload="x"><circle r="1"></circle></svg><p>ok</p>')).toBe("<p>ok</p>");
  });

  it("details/summary are stripped by policy (content preserved)", () => {
    expect(sanitizeHtml("<details open><summary>More</summary><p>body</p></details>")).toBe("More<p>body</p>");
  });
});

describe("input elements", () => {
  it("only checkboxes survive; text inputs are removed", () => {
    expect(sanitizeHtml('<input type="text" value="x"><p>ok</p>')).toBe("<p>ok</p>");
  });

  it("an input without a type is removed", () => {
    expect(sanitizeHtml("<input><p>ok</p>")).toBe("<p>ok</p>");
  });

  it('type="checkbox" keeps type/checked/disabled', () => {
    expect(sanitizeHtml('<input type="checkbox" checked disabled>')).toBe(
      '<input type="checkbox" checked="" disabled="">',
    );
  });

  it("the type check is case-sensitive on the attribute value (uppercase is removed)", () => {
    // Conservative: an unexpected casing errs toward removal, never toward keeping.
    expect(sanitizeHtml('<input type="CHECKBOX" checked>')).toBe("");
  });
});

describe("attribute allow-list", () => {
  it("style and unknown data-* attributes are stripped; title and data-task kept", () => {
    expect(sanitizeHtml('<p style="color:red" data-foo="1" data-task="todo" title="t">x</p>')).toBe(
      '<p data-task="todo" title="t">x</p>',
    );
  });

  it("code keeps its language class; ol keeps start; td keeps colspan", () => {
    expect(sanitizeHtml('<pre><code class="language-js">x</code></pre>')).toBe(
      '<pre><code class="language-js">x</code></pre>',
    );
    expect(sanitizeHtml('<ol start="3"><li>x</li></ol>')).toBe('<ol start="3"><li>x</li></ol>');
    expect(sanitizeHtml('<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>',
    );
  });

  it("target=_blank links are hardened with rel=noopener noreferrer", () => {
    expect(sanitizeHtml('<a href="https://x.test" target="_blank">x</a>')).toBe(
      '<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it("an existing rel is overwritten on _blank links", () => {
    expect(sanitizeHtml('<a href="https://x.test" target="_blank" rel="opener">x</a>')).toBe(
      '<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });
});

describe("SanitizeOptions widening", () => {
  it("extra tags are allowed (case-insensitive option)", () => {
    expect(sanitizeHtml("<figure><p>cap</p></figure>", { tags: ["FIGURE"] })).toBe("<figure><p>cap</p></figure>");
  });

  it("widening is additive — defaults still apply alongside options", () => {
    expect(sanitizeHtml('<p>ok</p><figure>f</figure><a href="https://x.test">l</a>', { tags: ["figure"] })).toBe(
      '<p>ok</p><figure>f</figure><a href="https://x.test">l</a>',
    );
  });

  it("extra attributes are allowed per tag (the callout plugin's widening)", () => {
    expect(
      sanitizeHtml('<blockquote data-callout="note">x</blockquote>', {
        attributes: { BLOCKQUOTE: ["data-callout"] },
      }),
    ).toBe('<blockquote data-callout="note">x</blockquote>');
    // …and without the widening the attribute is stripped.
    expect(sanitizeHtml('<blockquote data-callout="note">x</blockquote>')).toBe("<blockquote>x</blockquote>");
  });

  it("widening CANNOT allow denied tags", () => {
    expect(sanitizeHtml("<script>alert(1)</script><iframe></iframe><p>ok</p>", { tags: ["script", "iframe"] })).toBe(
      "<p>ok</p>",
    );
  });

  it("widening CANNOT re-enable event handlers", () => {
    expect(sanitizeHtml('<p onclick="pwn()">x</p>', { attributes: { p: ["onclick"] } })).toBe("<p>x</p>");
  });
});
