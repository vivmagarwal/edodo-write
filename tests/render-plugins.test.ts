import { describe, it, expect } from "vitest";
import {
  createRenderCodec,
  renderMarkdownWithPlugins,
  toHTML,
} from "edodo-write";
import { createCodec } from "edodo-write/testing";
import { callout, math, highlight } from "edodo-write/plugins";

/**
 * RFC §4 — plugin-aware rendering. The read-only renderer must apply the same
 * marked+turndown+sanitize registry an editor built with the same plugins uses
 * ("render codec === editor codec"), and it must be deterministic so SSR and
 * client agree.
 */

describe("renderMarkdownWithPlugins", () => {
  it("renders plugin HTML that the bare parser cannot", () => {
    const md = "> [!NOTE]\n> Useful information.";
    // Bare toHTML (no plugins) leaves the callout token as literal text.
    expect(toHTML(md)).toContain("[!NOTE]");
    // Plugin-aware render turns it into the callout blockquote.
    const html = renderMarkdownWithPlugins(md, [callout()]);
    expect(html).toContain('data-callout="note"');
    expect(html).not.toContain("[!NOTE]");
  });

  it("renders math and highlight tokens", () => {
    const html = renderMarkdownWithPlugins("cost is $x^2$ and ==hot==", [math(), highlight()]);
    expect(html).toContain('data-math="x^2"');
    expect(html).toContain("<mark>hot</mark>");
  });

  it("matches the editor's parse codec (render == editor codec)", () => {
    const md = "> [!TIP]\n> Ship it.\n\nInline ==mark== and $a+b$ math.";
    const plugins = [callout(), highlight(), math()];

    // `createCodec(...).parse` is constructed identically to the pipeline an
    // `EdodoWrite` instance builds (resolvePlugins([corePreset(), ...plugins])
    // → createMarkdownParser(registry.markedExtensions, registry.sanitize)),
    // so this is exactly the editor's parse half.
    const editorParse = createCodec(plugins).parse;
    const rendered = renderMarkdownWithPlugins(md, plugins);
    expect(rendered).toBe(editorParse(md));
  });

  it("is deterministic — same input yields identical output", () => {
    const md = "> [!WARNING]\n> Careful.\n\n$e=mc^2$ and ==stress==";
    const plugins = [callout(), math(), highlight()];
    const a = renderMarkdownWithPlugins(md, plugins);
    const b = renderMarkdownWithPlugins(md, plugins);
    expect(a).toBe(b);
    // A reused codec produces the same bytes too.
    const codec = createRenderCodec(plugins);
    expect(codec.render(md)).toBe(a);
    expect(codec.render(md)).toBe(codec.render(md));
  });

  it("with no plugins equals the bare GFM parser", () => {
    const md = "# H\n\n- a\n- b\n\n> quote";
    expect(renderMarkdownWithPlugins(md)).toBe(toHTML(md));
    expect(createRenderCodec().render(md)).toBe(toHTML(md));
  });
});
