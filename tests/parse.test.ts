import { describe, it, expect } from "vitest";
import { parseMarkdown, decorateTaskLists } from "@core/parse";

describe("parseMarkdown", () => {
  it("renders headings", () => {
    expect(parseMarkdown("# Hello")).toContain("<h1>Hello</h1>");
    expect(parseMarkdown("### Three")).toContain("<h3>Three</h3>");
  });

  it("renders inline marks", () => {
    const html = parseMarkdown("**bold** *italic* `code` ~~strike~~");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<del>strike</del>");
  });

  it("renders bullet and ordered lists", () => {
    expect(parseMarkdown("- a\n- b")).toContain("<ul>");
    expect(parseMarkdown("1. a\n2. b")).toContain("<ol>");
  });

  it("renders blockquotes and code fences", () => {
    expect(parseMarkdown("> quote")).toContain("<blockquote>");
    const code = parseMarkdown("```\nx = 1\n```");
    expect(code).toContain("<pre>");
    expect(code).toContain("<code");
  });

  it("renders links", () => {
    expect(parseMarkdown("[t](https://a.com)")).toContain('href="https://a.com"');
  });

  it("decorates task lists and makes checkboxes interactive", () => {
    const html = parseMarkdown("- [ ] todo\n- [x] done");
    expect(html).toContain("contains-task-list");
    expect(html).toContain("task-list-item");
    expect(html).toContain('data-task="todo"');
    expect(html).toContain('data-task="done"');
    expect(html).not.toContain("disabled");
  });

  it("strips scripts and event handlers", () => {
    expect(parseMarkdown("<script>alert(1)</script>ok")).not.toContain("<script");
    const evil = parseMarkdown('<img src="x" onerror="alert(1)">');
    expect(evil).not.toContain("onerror");
  });

  it("strips javascript: URLs", () => {
    const html = parseMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("can skip sanitising for a trusted DOM-free path", () => {
    const raw = parseMarkdown("# H", { sanitize: false });
    expect(raw).toContain("<h1");
  });
});

describe("decorateTaskLists", () => {
  it("adds the conventional classes", () => {
    const out = decorateTaskLists('<ul><li><input type="checkbox"> a</li></ul>');
    expect(out).toContain("contains-task-list");
    expect(out).toContain("task-list-item");
  });
});
