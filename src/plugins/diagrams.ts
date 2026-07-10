/**
 * Diagrams — fenced diagram code rendered as widgets.
 *
 * A fenced code block whose language has a registered renderer
 * (```edd, ```mermaid, …) becomes a non-editable
 * `<figure data-widget="diagram" data-lang data-source>` via the shared
 * widget machinery; every other fence falls through to the default code
 * rendering untouched. PERFECT degradation: without the plugin the fence is
 * an ordinary GFM code block — GitHub even renders ```mermaid natively.
 *
 * `edodoDraw()` is `diagrams()` preconfigured for the `edododraw` engine
 * (lazy-imported on first render; optional peer dependency of consumers).
 * The engine's native language is the EDD DSL, and it imports raw Mermaid
 * through the DSL's `mermaid """…"""` block — so one renderer serves both
 * ```edd and ```mermaid fences.
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import { createWidget, mountWidgets, wireWidgetEditing, escapeAttr, type WidgetSpec } from "./widget.js";
import type TurndownService from "turndown";
import type { EdodoDraw as EdodoDrawEngine } from "edododraw";

declare module "../core/types.js" {
  interface CommandPayloads {
    diagram: { lang: string; source?: string };
  }
}

export type DiagramRenderer = (source: string, el: HTMLElement, ctx: EditorContext) => void | Promise<void>;

export interface DiagramsOptions {
  /** fence language → renderer, e.g. { mermaid: …, edd: … } */
  renderers: Record<string, DiagramRenderer>;
}

export interface EdodoDrawOptions {
  /** Fence languages routed to the edododraw engine. Default: ["edd", "mermaid"]. */
  languages?: string[];
}

const KIND = "diagram";

/** Tiny starter sources for the slash items; unknown languages start empty
 *  (the source editor opens immediately, so blank is a fine starting point). */
const STARTERS: Record<string, string> = {
  edd: "scene {\n  a[Start] --> b[Finish]\n}",
  mermaid: "flowchart LR\n  a[Start] --> b[Finish]",
};

function isDiagramFigure(node: Node): node is HTMLElement {
  return node.nodeName === "FIGURE" && (node as HTMLElement).getAttribute("data-widget") === KIND;
}

function toFence(figure: HTMLElement): string {
  const lang = figure.getAttribute("data-lang") ?? "";
  const source = figure.getAttribute("data-source") ?? "";
  return `\n\n\`\`\`${lang}\n${source ? `${source}\n` : ""}\`\`\`\n\n`;
}

interface DiagramSlashSpec {
  lang: string;
  title: string;
  hint?: string;
  keywords?: string[];
}

/** The shared plugin body — `diagrams()` and `edodoDraw()` differ only in
 *  name, renderer map, and slash-item copy. */
function buildDiagramsPlugin(
  name: string,
  renderers: Record<string, DiagramRenderer>,
  items: DiagramSlashSpec[],
): EdodoPlugin {
  const spec: WidgetSpec = {
    kind: KIND,
    busyText: "Rendering diagram…",
    render(source, el, ctx) {
      // `el` is the figure's render surface; the figure carries the language.
      const lang = el.parentElement?.getAttribute("data-lang") ?? "";
      const render = renderers[lang];
      if (!render) throw new Error(`no renderer registered for "${lang}"`);
      el.textContent = ""; // a re-render replaces — never accumulates
      return render(source, el, ctx);
    },
  };

  return definePlugin({
    name,

    commands: {
      diagram: {
        run: (ctx, payload?: { lang?: string; source?: string }) => {
          const lang = payload?.lang ?? Object.keys(renderers)[0];
          const block = ctx.dom.currentBlock();
          if (!lang || !block) return false;
          const figure = createWidget(KIND, payload?.source ?? STARTERS[lang] ?? "");
          figure.setAttribute("data-lang", lang);
          const p = document.createElement("p");
          p.appendChild(document.createElement("br"));
          block.after(figure);
          figure.after(p);
          if ((block.textContent ?? "").trim() === "" && block.tagName === "P") block.remove();
          ctx.dom.placeCaretAtStart(p);
          mountWidgets(ctx, spec);
        },
      },
    },

    slashItems: items.map((it) => ({
      id: `diagram-${it.lang}`,
      title: it.title,
      hint: it.hint,
      keywords: ["diagram", "chart", "graph", it.lang, ...(it.keywords ?? [])],
      group: "Media",
      run(ctx: EditorContext) {
        if (!ctx.exec("diagram", { lang: it.lang })) return;
        // The caret now sits in the paragraph inserted after the widget —
        // open the source editor through the shared click-to-edit glue.
        const figure = ctx.dom.currentBlock()?.previousElementSibling;
        if (figure && isDiagramFigure(figure)) {
          figure.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      },
    })),

    sanitize: { tags: ["figure"], attributes: { figure: ["data-widget", "data-source", "data-lang"] } },

    markdown: {
      marked: [{
        renderer: {
          // marked v12: code(code, infostring, escaped). Returning false falls
          // through to the default code rendering — an unregistered language
          // (```js, bare ```) must stay an ordinary code block.
          code(code: string, infostring: string | undefined): string | false {
            const lang = (infostring ?? "").trim().split(/\s+/)[0] ?? "";
            if (!lang || !(lang in renderers)) return false;
            return `<figure data-widget="${KIND}" data-lang="${escapeAttr(lang)}" data-source="${escapeAttr(code)}"></figure>\n`;
          },
        },
      }],
      turndown: (td: TurndownService) => {
        td.addRule("diagram", {
          filter: (node) => isDiagramFigure(node),
          replacement: (_content, node) => toFence(node as HTMLElement),
        });
        // A not-yet-rendered figure has no text content, and turndown routes
        // "blank" nodes past the rule array entirely — intercept the blank
        // rule so an unmounted widget still serializes to its fence.
        const rules = td.rules as unknown as {
          blankRule: { replacement: (content: string, node: Node, options: unknown) => string };
        };
        const blank = rules.blankRule.replacement;
        rules.blankRule.replacement = (content, node, options) =>
          isDiagramFigure(node) ? toFence(node) : blank(content, node, options);
      },
    },

    setup(ctx) {
      mountWidgets(ctx, spec);
      return wireWidgetEditing(ctx, spec);
    },

    on: {
      change: (_md, ctx) => mountWidgets(ctx, spec),
    },
  });
}

export function diagrams(options: DiagramsOptions): EdodoPlugin {
  const items = Object.keys(options.renderers).map((lang) => ({
    lang,
    title: lang === "mermaid" ? "Mermaid diagram" : `Diagram (${lang})`,
    hint: `Rendered \`\`\`${lang} block`,
  }));
  return buildDiagramsPlugin("diagrams", options.renderers, items);
}

export function edodoDraw(options: EdodoDrawOptions = {}): EdodoPlugin {
  const languages = options.languages ?? ["edd", "mermaid"];

  // Lazy-import the engine once; every renderer shares the module promise.
  let mod: Promise<typeof import("edododraw")> | null = null;
  const loadEngine = () => (mod ??= import("edododraw"));

  // One engine per surface. A (re)render destroys the previous instance —
  // the error path clears the surface, so reuse can't assume the old SVG
  // mount survived, and destroy() keeps listeners/SVG roots from leaking.
  const instances = new WeakMap<HTMLElement, EdodoDrawEngine>();

  const renderWith = (lang: string): DiagramRenderer => async (source, el) => {
    const { EdodoDraw } = await loadEngine();
    instances.get(el)?.destroy();
    instances.delete(el);
    el.textContent = "";
    const engine = new EdodoDraw(el, { interactive: false });
    instances.set(el, engine);
    // The engine's native language is the EDD DSL; any other fence (mermaid)
    // is fed through the DSL's raw-Mermaid import block.
    const src = lang === "edd" ? source : `mermaid """\n${source}\n"""`;
    const { diagnostics } = await engine.render(src);
    const err = diagnostics.find((d) => d.severity === "error");
    if (err) throw new Error(`${err.message} (line ${err.line})`);
  };

  const renderers: Record<string, DiagramRenderer> = {};
  for (const lang of languages) renderers[lang] = renderWith(lang);

  const items = languages.map((lang): DiagramSlashSpec => {
    if (lang === "edd") {
      return { lang, title: "Diagram", hint: "edodo-draw (text to diagram)", keywords: ["edd", "edodo", "draw", "flowchart"] };
    }
    if (lang === "mermaid") {
      return { lang, title: "Mermaid diagram", hint: "Mermaid, hand-drawn", keywords: ["mermaid", "flowchart"] };
    }
    return { lang, title: `Diagram (${lang})` };
  });

  return buildDiagramsPlugin("edodo-draw", renderers, items);
}
