// @vitest-environment node
//
// RFC §10 — the email adapter must render in bare Node (no DOM). This file
// forces the Node environment so a regression to a DOM dependency fails here.

import { describe, it, expect } from "vitest";
import { toEmailHtml, createEmailRenderer, NEUTRAL_EMAIL_THEME, type EmailStyleTokens } from "edodo-write/email";
import { emoji, tags } from "edodo-write/plugins";

const MENTION = /@\[([^\]]+)\]\(([^)\s]+)\)/g;
const mentions = () =>
  tags({
    trigger: "@",
    source: () => [],
    serialize: (i) => `@[${i.display}](${i.id})`,
    parse: { pattern: MENTION, toItem: (m) => ({ display: m[1], id: m[2] }) },
  });

describe("no-DOM guarantee", () => {
  it("runs without a DOM", () => {
    expect(typeof (globalThis as any).document).toBe("undefined");
    const { html } = toEmailHtml("# Hi\n\nHello");
    expect(html).toContain("Hi");
  });
});

describe("marked-version safety (positional renderer signatures)", () => {
  // The email renderer relies on marked v12's POSITIONAL renderer signatures
  // (`heading(text, level)`, `link(href, title, text)`, …). marked v13 changed
  // these to a token-object shape, which would silently break rendering — so
  // this smoke test fails loudly if that API contract ever regresses (and
  // package.json must keep `marked` at `^12`, which excludes v13).
  it("renders a heading's text into an <h2 (positional signature intact)", () => {
    const { html } = toEmailHtml("# Hello");
    expect(html).toContain("Hello");
    expect(html).toContain("<h2");
  });
});

describe("zero-config default theme", () => {
  it("renders with no options at all", () => {
    const { html, text, markdown } = toEmailHtml("# Welcome\n\nThanks for joining.");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(NEUTRAL_EMAIL_THEME.card);
    expect(html).toContain("<h2");
    expect(html).toContain("<p");
    expect(text).toBe("Welcome\n\nThanks for joining.");
    expect(markdown).toBe("# Welcome\n\nThanks for joining.");
    // Neutral — no brand strings.
    expect(html.toLowerCase()).not.toContain("edodo");
  });
});

describe("three shells", () => {
  const md = "# Title\n\nBody text.";
  it("transactional is a full doc with a card div", () => {
    const { html } = toEmailHtml(md, { template: "transactional" });
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("<table");
  });
  it("marketing is a full doc with a table layout", () => {
    const { html } = toEmailHtml(md, { template: "marketing" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<table");
  });
  it("inline is a bare fragment (no doctype)", () => {
    const { html } = toEmailHtml(md, { template: "inline" });
    expect(html).not.toContain("<!doctype");
    expect(html.trim().startsWith("<div")).toBe(true);
  });
});

describe("heading clamp h2–h4", () => {
  it("clamps h1 → h2 and h6 → h4", () => {
    const { html } = toEmailHtml("# One\n\n###### Six");
    expect(html).toContain("<h2");
    expect(html).toContain("<h4");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h5");
    expect(html).not.toContain("<h6");
  });
  it("keeps h3 as h3", () => {
    const { html } = toEmailHtml("### Three");
    expect(html).toContain("<h3");
  });
});

describe("tables dropped, images → links", () => {
  it("drops a GFM table", () => {
    const { html } = toEmailHtml("before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter");
    expect(html).not.toContain("<table");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });
  it("converts an image to a link", () => {
    const { html } = toEmailHtml("![the logo](https://cdn.example.com/logo.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://cdn.example.com/logo.png"');
    expect(html).toContain("the logo");
  });
});

describe("placeholder substitution", () => {
  it("substitutes {{name}} from data", () => {
    const { html, text } = toEmailHtml("Hi {{name}}!", { data: { name: "Alice" } });
    expect(html).toContain("Hi Alice!");
    expect(text).toContain("Hi Alice!");
  });
  it("falls back when data lacks the key", () => {
    const { html } = toEmailHtml("Hi {{name}}!", { data: {}, fallbacks: { name: "there" } });
    expect(html).toContain("Hi there!");
  });
  it("leaves an unknown placeholder verbatim, and passes through with no bags", () => {
    expect(toEmailHtml("Hi {{name}}!", { data: {} }).html).toContain("Hi {{name}}!");
    expect(toEmailHtml("Hi {{name}}!").html).toContain("Hi {{name}}!");
  });
  it("HTML-escapes injected values", () => {
    const { html } = toEmailHtml("{{x}}", { data: { x: "<script>bad</script>" } });
    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;script&gt;");
  });
  it("substitutes the subject line", () => {
    const { subject } = toEmailHtml("body", { subject: "Welcome {{name}}", data: { name: "Bo" } });
    expect(subject).toBe("Welcome Bo");
  });
});

describe("footer injection", () => {
  it("injects a runtime footerHtml raw (unsanitised by default)", () => {
    const footer = '<p style="color:red">Unsubscribe <a href="https://x/u?t=abc">here</a></p>';
    const { html } = toEmailHtml("body", { footerHtml: footer });
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("https://x/u?t=abc");
  });
  it("footerHtml wins over a per-template default footer", () => {
    const { html } = toEmailHtml("body", {
      footers: { transactional: "DEFAULT-FOOTER" },
      footerHtml: "RUNTIME-FOOTER",
    });
    expect(html).toContain("RUNTIME-FOOTER");
    expect(html).not.toContain("DEFAULT-FOOTER");
  });
  it("uses the per-template default when no runtime footer", () => {
    const { html } = toEmailHtml("body", { footers: { transactional: "DEFAULT-FOOTER" } });
    expect(html).toContain("DEFAULT-FOOTER");
  });
  it("sanitises the footer when asked", () => {
    const { html } = toEmailHtml("body", {
      footerHtml: '<p>ok<script>evil()</script></p>',
      sanitizeFooter: true,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("ok");
  });
});

describe("sanitisation of the body", () => {
  it("strips script/handlers/javascript: urls", () => {
    const { html } = toEmailHtml("# Hi\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/javascript:/i);
  });
  it("keeps inline styles on allowed elements", () => {
    const { html } = toEmailHtml("a **paragraph**");
    expect(html).toMatch(/<p style="/);
  });
});

describe("plugins", () => {
  it("resolves emoji to a glyph (span dropped, glyph kept)", () => {
    const { html, text } = toEmailHtml("ship it :rocket:", { plugins: [emoji({ map: { rocket: "🚀" } })] });
    expect(html).toContain("🚀");
    expect(html).not.toContain("data-shortcode"); // span unwrapped by email allowlist
    expect(text).toContain("🚀");
  });
  it("resolves a mention to @Display", () => {
    const { html, text } = toEmailHtml("hi @[Alice](u_1)", { plugins: [mentions()] });
    expect(html).toContain("@Alice");
    expect(text).toContain("@Alice");
  });
});

describe("createEmailRenderer", () => {
  it("binds defaults and lets calls override", () => {
    const theme: EmailStyleTokens = { ...NEUTRAL_EMAIL_THEME, paragraph: "PARA-STYLE" };
    const render = createEmailRenderer({ theme, footers: { transactional: "BASE-FOOTER" } });
    const { html } = render("hello");
    expect(html).toContain("PARA-STYLE");
    expect(html).toContain("BASE-FOOTER");
    // per-call override wins for footerHtml
    const { html: h2 } = render("hello", { footerHtml: "CALL-FOOTER" });
    expect(h2).toContain("CALL-FOOTER");
    expect(h2).not.toContain("BASE-FOOTER");
  });
});

describe("never throws", () => {
  it("handles empty / nullish input", () => {
    expect(() => toEmailHtml("")).not.toThrow();
    expect(() => toEmailHtml(null as any)).not.toThrow();
    expect(() => toEmailHtml(undefined as any)).not.toThrow();
    expect(toEmailHtml("").markdown).toBe("");
  });
});
