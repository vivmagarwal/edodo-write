import { describe, it, expect } from "vitest";
import { htmlToMarkdown, createMarkdownSerializer, tidyMarkdown } from "@core/serialize";
import { parseMarkdown } from "@core/parse";

const roundtrip = (md: string) => htmlToMarkdown(parseMarkdown(md));

describe("code fences are byte-preserved by the tidy pass", () => {
  it("keeps alignment spaces, trailing whitespace and blank-line runs inside fences", () => {
    const code = "-    aligned\n1.    numbered\ntrailing  \n\n\n\nend";
    const md = htmlToMarkdown(`<pre><code>${code.replace(/</g, "&lt;")}</code></pre>`);
    expect(md).toBe("```\n" + code + "\n```");
  });

  it("keeps fence content stable across two round-trips", () => {
    const md = "```\n-    aligned\n\n\n\nx\n```";
    const once = roundtrip(md);
    expect(once).toBe(md);
    expect(roundtrip(once)).toBe(md);
  });

  it("still tidies prose around a fence", () => {
    const md = tidyMarkdown("-   item\n\n```\n-   code\n```\n\ntrailing   ");
    expect(md).toBe("- item\n\n```\n-   code\n```\n\ntrailing");
  });

  it("handles a fence with a language", () => {
    const md = "```js\nconst x  =  1;  \n```";
    expect(roundtrip(md)).toBe(md);
  });
});

describe("soft breaks (backslash hard break)", () => {
  it("serializes <br> as a backslash break that survives whitespace trimming", () => {
    expect(htmlToMarkdown("<p>one<br>two</p>")).toBe("one\\\ntwo");
  });

  it("round-trips: the break is still a <br> after reparse", () => {
    const md = htmlToMarkdown("<p>one<br>two</p>");
    expect(parseMarkdown(md)).toContain("<br");
    expect(roundtrip(md)).toBe(md);
  });
});

describe("serializer instancing", () => {
  it("custom rules apply per instance without leaking into the default", () => {
    const custom = createMarkdownSerializer([
      (td) => td.addRule("shout", { filter: "mark", replacement: (c) => `==${c}==` }),
    ]);
    expect(custom("<p><mark>hi</mark></p>")).toBe("==hi==");
    // default serializer keeps <mark> as raw HTML (td.keep)
    expect(htmlToMarkdown("<p><mark>hi</mark></p>")).toBe("<mark>hi</mark>");
  });

  it("normalizes NBSP to a plain space in prose but not in fences", () => {
    expect(tidyMarkdown("a b")).toBe("a b");
    expect(tidyMarkdown("```\na b\n```")).toBe("```\na b\n```");
  });
});

describe("trailing <br> artifacts", () => {
  it("a caret-anchor br at the end of a block serializes to nothing", () => {
    expect(htmlToMarkdown("<p>outside<br></p>")).toBe("outside");
    expect(htmlToMarkdown("<h2>title<br></h2>")).toBe("## title");
  });

  it("a REAL soft break (content follows) still serializes as a hard break", () => {
    expect(htmlToMarkdown("<p>one<br>two</p>")).toBe("one\\\ntwo");
  });
});
