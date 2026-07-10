import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "@core/serialize";

describe("htmlToMarkdown", () => {
  it("serialises headings", () => {
    expect(htmlToMarkdown("<h1>Hello</h1>")).toBe("# Hello");
    expect(htmlToMarkdown("<h2>Two</h2>")).toBe("## Two");
  });

  it("serialises inline marks", () => {
    expect(htmlToMarkdown("<p><strong>b</strong></p>")).toBe("**b**");
    expect(htmlToMarkdown("<p><em>i</em></p>")).toBe("*i*");
    expect(htmlToMarkdown("<p><code>c</code></p>")).toBe("`c`");
    expect(htmlToMarkdown("<p><del>s</del></p>")).toBe("~~s~~");
  });

  it("serialises links", () => {
    expect(htmlToMarkdown('<p><a href="https://a.com">t</a></p>')).toBe("[t](https://a.com)");
  });

  it("serialises bullet lists with a dash marker", () => {
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
  });

  it("serialises ordered lists", () => {
    expect(htmlToMarkdown("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
  });

  it("serialises task lists", () => {
    const html =
      '<ul class="contains-task-list">' +
      '<li class="task-list-item"><input type="checkbox"> a</li>' +
      '<li class="task-list-item"><input type="checkbox" checked> b</li>' +
      "</ul>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("- [ ] a");
    expect(md).toContain("- [x] b");
  });

  it("serialises fenced code blocks", () => {
    const md = htmlToMarkdown("<pre><code>x = 1</code></pre>");
    expect(md).toBe("```\nx = 1\n```");
  });

  it("drops empty trailing paragraphs and zero-width spaces", () => {
    expect(htmlToMarkdown("<p>hi</p><p><br></p>")).toBe("hi");
    expect(htmlToMarkdown("<p>a​b</p>")).toBe("ab");
  });
});
