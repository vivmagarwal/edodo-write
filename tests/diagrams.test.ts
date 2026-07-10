import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";
import { resolvePlugins } from "@core/plugin";
import { corePreset } from "@core/preset";
import { diagrams, edodoDraw, type DiagramRenderer } from "../src/plugins/diagrams";
import { createCodec, assertRoundTrip } from "../src/lib/testing";

function mount(options: ConstructorParameters<typeof EdodoWrite>[1] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, options);
}

/** A deterministic renderer that records the sources it was asked to draw. */
function fakePlugin() {
  const calls: string[] = [];
  const render: DiagramRenderer = (source, el) => {
    calls.push(source);
    const div = document.createElement("div");
    div.className = "fake-diagram";
    div.textContent = `rendered:${source}`;
    el.appendChild(div);
  };
  return { plugin: diagrams({ renderers: { fake: render } }), calls };
}

/** mountWidgets renders through the microtask queue — let it settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("diagrams: markdown round-trip", () => {
  const codec = createCodec([fakePlugin().plugin]);

  it("round-trips a simple fence byte-for-byte", () => {
    assertRoundTrip(codec, "```fake\na --> b\n```");
  });

  it("round-trips multiline sources with quotes, angle brackets, ampersands, unicode", () => {
    assertRoundTrip(
      codec,
      '```fake\nnode "quoted" & <angled>\n  indented → line\nümlaut & 中文 & a<b>c\n```',
    );
  });

  it("round-trips a fence embedded in prose", () => {
    assertRoundTrip(codec, "before\n\n```fake\nx --> y\n```\n\nafter");
  });

  it("round-trips an empty fence", () => {
    assertRoundTrip(codec, "```fake\n```");
  });

  it("parses the fence into a source-carrying widget figure", () => {
    const html = codec.parse('```fake\na "b" --> <c>\n```');
    expect(html).toContain('data-widget="diagram"');
    expect(html).toContain('data-lang="fake"');
    expect(html).not.toContain("<pre>");
    // The source survives attribute escaping and reads back verbatim.
    const doc = new DOMParser().parseFromString(html, "text/html");
    const figure = doc.querySelector('figure[data-widget="diagram"]')!;
    expect(figure.getAttribute("data-source")).toBe('a "b" --> <c>');
  });

  it("leaves unregistered languages as plain code blocks (critical regression)", () => {
    assertRoundTrip(codec, "```js\nconst a = 1;\n```");
    assertRoundTrip(codec, "```\nno language\n```");
    expect(codec.parse("```js\nconst a = 1;\n```")).toContain('<code class="language-js">');
    expect(codec.parse("```js\nconst a = 1;\n```")).not.toContain("data-widget");
  });

  it("does not disturb a plain-GFM corpus", () => {
    assertRoundTrip(codec, "# Title\n\nSome **bold** prose.\n\n- one\n- two\n\n> quoted");
  });
});

describe("diagrams: degradation without the plugin", () => {
  it("a diagram fence is an ordinary, lossless code block in a plugin-less editor", () => {
    const plain = createCodec([]);
    const md = "```edd\nscene { a[Hi] --> b[There] }\n```";
    assertRoundTrip(plain, md);
    const html = plain.parse(md);
    expect(html).toContain("<pre>");
    expect(html).not.toContain("data-widget");
  });
});

describe("diagrams: rendering", () => {
  it("calls the renderer with the exact source and mounts the result", async () => {
    const { plugin, calls } = fakePlugin();
    const editor = mount({ value: '```fake\na "x" --> b\n```', plugins: [plugin] });
    await settle();
    expect(calls).toEqual(['a "x" --> b']);
    const surface = editor.content.querySelector('figure[data-widget="diagram"] .ew-widget__surface')!;
    expect(surface.textContent).toBe('rendered:a "x" --> b');
    expect(editor.getMarkdown()).toBe('```fake\na "x" --> b\n```');
    editor.destroy();
  });

  it("a throwing renderer produces an error box, not a broken editor", async () => {
    const boom = diagrams({
      renderers: {
        fake: () => {
          throw new Error("kaboom");
        },
      },
    });
    const editor = mount({ value: "```fake\nbad\n```", plugins: [boom] });
    await settle();
    const box = editor.content.querySelector(".ew-widget__error")!;
    expect(box).toBeTruthy();
    expect(box.textContent).toContain("kaboom");
    expect(editor.getMarkdown()).toBe("```fake\nbad\n```"); // the source is untouched
    editor.destroy();
  });

  it("a fence for a language with no renderer stays a plain code block in the DOM", async () => {
    const { plugin } = fakePlugin();
    const editor = mount({ value: "```js\ncode\n```", plugins: [plugin] });
    await settle();
    expect(editor.content.querySelector("figure")).toBeNull();
    expect(editor.content.querySelector("pre code")).toBeTruthy();
    editor.destroy();
  });

  it("async renderers are supported (rejections become error boxes)", async () => {
    const rejecting = diagrams({
      renderers: { fake: async () => { throw new Error("async kaboom"); } },
    });
    const editor = mount({ value: "```fake\nbad\n```", plugins: [rejecting] });
    await settle();
    expect(editor.content.querySelector(".ew-widget__error")?.textContent).toContain("async kaboom");
    editor.destroy();
  });
});

describe("diagrams: command and slash items", () => {
  it("the diagram command inserts a widget at the caret block", async () => {
    const { plugin } = fakePlugin();
    const editor = mount({ value: "seed", plugins: [plugin] });
    editor.focus();
    const p = editor.content.querySelector("p")!;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    expect(editor.exec("diagram", { lang: "fake", source: "a --> b" })).toBe(true);
    expect(editor.getMarkdown()).toBe("seed\n\n```fake\na --> b\n```");
    await settle();
    expect(editor.content.querySelector(".fake-diagram")?.textContent).toBe("rendered:a --> b");
    editor.destroy();
  });

  it("registers one slash item per renderer key", () => {
    const reg = resolvePlugins([corePreset(), fakePlugin().plugin]);
    const item = reg.slashItems.find((i) => i.id === "diagram-fake")!;
    expect(item).toBeTruthy();
    expect(item.group).toBe("Media");
  });

  it("edodoDraw registers the Diagram + Mermaid slash items", () => {
    const reg = resolvePlugins([corePreset(), edodoDraw()]);
    const edd = reg.slashItems.find((i) => i.id === "diagram-edd")!;
    const mermaid = reg.slashItems.find((i) => i.id === "diagram-mermaid")!;
    expect(edd.title).toBe("Diagram");
    expect(edd.hint).toBe("edodo-draw (text to diagram)");
    expect(edd.group).toBe("Media");
    expect(mermaid.title).toBe("Mermaid diagram");
    expect(mermaid.group).toBe("Media");
  });
});

describe("edodoDraw: markdown codec (no engine needed for the round-trip)", () => {
  it("round-trips edd and mermaid fences byte-for-byte", () => {
    const codec = createCodec([edodoDraw()]);
    assertRoundTrip(codec, "```edd\nscene { a[Hi] --> b[There] }\n```");
    assertRoundTrip(codec, "```mermaid\nflowchart LR\n  a --> b\n```");
    expect(codec.parse("```edd\nscene {}\n```")).toContain('data-lang="edd"');
  });

  it("the languages option narrows which fences become widgets", () => {
    const codec = createCodec([edodoDraw({ languages: ["edd"] })]);
    expect(codec.parse("```edd\nscene {}\n```")).toContain("data-widget");
    expect(codec.parse("```mermaid\nflowchart LR\n```")).toContain("<pre>");
    assertRoundTrip(codec, "```mermaid\nflowchart LR\n  a --> b\n```");
  });
});
