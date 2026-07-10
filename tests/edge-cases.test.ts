import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@core/parse";
import { htmlToMarkdown } from "@core/serialize";

/**
 * Edge cases from the natural process of writing / editing / reading.
 * The invariant we care about: the Markdown we emit must faithfully represent
 * the editor content — i.e. DOM → Markdown → DOM is stable (same text + tags),
 * and special characters are never silently reinterpreted.
 */

function md(html: string): string {
  return htmlToMarkdown(html);
}

function textOf(html: string): string {
  const d = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  return (d.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
// DOM(html) → md → DOM(html2): the normalised TEXT content must be preserved.
function reparseText(html: string): string {
  return textOf(parseMarkdown(md(html)));
}
function plain(html: string): string {
  return textOf(html);
}
// tag skeleton of the re-parsed output (which block/inline tags survived)
function tagsOf(html: string): string[] {
  const out = parseMarkdown(md(html));
  const d = new DOMParser().parseFromString(`<div>${out}</div>`, "text/html");
  return Array.from(d.body.querySelectorAll("*")).map((e) => e.tagName.toLowerCase());
}

describe("special characters in prose survive the round-trip", () => {
  const cases: Array<[string, string]> = [
    ["asterisks (math)", "<p>2 * 3 * 4 = 24</p>"],
    ["underscores (identifiers)", "<p>use my_variable_name and __dunder__ here</p>"],
    ["hash", "<p>see issue #42 and #hashtag</p>"],
    ["brackets", "<p>array[0] and [not a link]</p>"],
    ["angle brackets", "<p>a > b and 1 < 2</p>"],
    ["ampersand", "<p>Tom & Jerry and R&D</p>"],
    ["backslash path", "<p>open C:\\Users\\name\\file</p>"],
    ["pipe", "<p>a | b | c columns</p>"],
    ["leading number", "<p>3.14 is pi, not a list</p>"],
    ["leading dash math", "<p>5 - 3 = 2</p>"],
    ["literal backtick", "<p>the ` character</p>"],
    ["html-looking text", "<p>type &lt;script&gt; to break things</p>"],
    ["entity-looking text", "<p>write &amp;amp; literally</p>"],
    ["quotes and apostrophes", "<p>\"quoted\" and it's fine</p>"],
    ["exclaim bracket (image-like)", "<p>![not an image] here</p>"],
  ];
  for (const [name, html] of cases) {
    it(name, () => {
      // The re-parsed text content must equal the original text content.
      expect(reparseText(html)).toBe(plain(html));
    });
  }
});

describe("structure survives the round-trip (tags preserved)", () => {
  const structural: Array<[string, string, string[]]> = [
    ["nested bullet list", "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>", ["ul", "li", "ul"]],
    ["ordered in bullet", "<ul><li>top<ol><li>one</li><li>two</li></ol></li></ul>", ["ul", "ol"]],
    ["heading with bold", "<h2>A <strong>bold</strong> heading</h2>", ["h2", "strong"]],
    ["link with bold", '<p><a href="https://x.com"><strong>bold link</strong></a></p>', ["a", "strong"]],
    ["nested emphasis", "<p><strong>bold <em>and italic</em></strong></p>", ["strong", "em"]],
    ["adjacent marks", "<p><strong>a</strong>b<strong>c</strong></p>", ["strong", "strong"]],
    ["blockquote multiline", "<blockquote><p>line one</p><p>line two</p></blockquote>", ["blockquote"]],
    ["task list mixed", '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox"> a</li><li class="task-list-item"><input type="checkbox" checked> b</li></ul>', ["ul", "li", "input"]],
    ["paragraph then list", "<p>intro</p><ul><li>one</li><li>two</li></ul>", ["p", "ul", "li"]],
    ["image", '<p><img src="https://x.com/a.png" alt="alt text"></p>', ["img"]],
    ["hr between", "<p>above</p><hr><p>below</p>", ["p", "hr", "p"]],
  ];
  for (const [name, html, expectedTags] of structural) {
    it(name, () => {
      const tags = tagsOf(html);
      for (const t of expectedTags) expect(tags).toContain(t);
      // text is preserved too (ignoring inter-block spacing)
      expect(reparseText(html).replace(/ /g, "")).toBe(plain(html).replace(/ /g, ""));
    });
  }
});

describe("code blocks are verbatim (no markdown escaping inside)", () => {
  it("keeps markdown-looking code intact", () => {
    const out = md("<pre><code># not a heading\n- not a list\n**not bold**</code></pre>");
    expect(out).toContain("# not a heading");
    expect(out).toContain("- not a list");
    expect(out).toContain("**not bold**");
    // and it re-parses to a code block, not real headings/lists
    const back = parseMarkdown(out);
    expect(back).toContain("<pre>");
    expect(back).not.toContain("<h1>");
  });
  it("inline code keeps its content", () => {
    expect(md("<p>run <code>npm i --save-dev</code> now</p>")).toBe("run `npm i --save-dev` now");
  });
});

describe("whitespace and empties", () => {
  it("collapses trailing empty paragraphs", () => {
    expect(md("<p>text</p><p><br></p><p><br></p>")).toBe("text");
  });
  it("an empty document serialises to empty", () => {
    expect(md("<p><br></p>")).toBe("");
  });
  it("multiple paragraphs keep a blank line between them", () => {
    expect(md("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });
});
