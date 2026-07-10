/**
 * Math — TeX math with GitHub-native Markdown syntax:
 *
 *   inline:  $x^2$          (content never starts/ends with whitespace,
 *                            never contains `$` or a newline, and the closing
 *                            `$` is not followed by a digit — so prose like
 *                            "costs $5 and $10 total" is never hijacked)
 *   block:   $$              (its own block, possibly multiline)
 *            E = mc^2
 *            $$
 *
 * GitHub renders both forms natively, and without this plugin they stay
 * visible, lossless plain text — the required degradation story.
 *
 * In the editor an inline formula is a non-editable chip
 * `<span class="ew-math" data-math="…">` and a block formula is the shared
 * widget figure (`figure[data-widget="math"][data-source]`) — the TeX source
 * lives in the attribute, so the rendered view (KaTeX, or styled plain TeX
 * when KaTeX is absent) never touches the round-trip. Click a chip to edit or
 * remove it; click a block to open the shared source editor.
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import { createWidget, mountWidgets, wireWidgetEditing, escapeAttr, type WidgetSpec } from "./widget.js";

export interface MathOptions {
  /** Custom renderer (e.g. KaTeX). Default: styled TeX source text. */
  render?: (tex: string, el: HTMLElement, displayMode: boolean) => void;
}

type MathRender = NonNullable<MathOptions["render"]>;

/** No-engine fallback: the TeX source as styled text (chip / code block). */
function plainRender(tex: string, el: HTMLElement, displayMode: boolean): void {
  el.textContent = "";
  if (displayMode) {
    const code = document.createElement("code");
    code.textContent = tex;
    el.appendChild(code);
  } else {
    el.textContent = tex;
  }
}

// KaTeX is an OPTIONAL peer — lazy-import once, fall back to plain TeX text
// when it isn't installed. Module-level cache: the engine is global anyway.
let katexRender: Promise<MathRender> | null = null;
function loadKatex(): Promise<MathRender> {
  katexRender ??= import("katex").then(
    (mod) => {
      const katex = mod.default;
      return (tex: string, el: HTMLElement, displayMode: boolean) =>
        katex.render(tex, el, { displayMode, throwOnError: false });
    },
    () => plainRender,
  );
  return katexRender;
}

// Inline edges mirrored in the marked tokenizer AND the input rule: content
// starts and ends with a non-space non-`$` char, no `$`/newline inside.
const INLINE_TEX = /^\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/;
// Block forms: `$$` lines around a (possibly multiline) body, or one-line
// `$$E=mc^2$$`. Both anchored to a line start (see the extension's `start`).
const BLOCK_TEX_MULTI = /^\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*(?=\n|$)/;
const BLOCK_TEX_ONE_LINE = /^\$\$([^\n$]+)\$\$[ \t]*(?=\n|$)/;

/**
 * Reconcile inline chips: decorate + (re)render any whose source changed
 * since the last pass (`data-rendered`, same protocol as `mountWidgets`).
 * A render error must never break typing — fall back to plain TeX text.
 */
function mountInlineMath(ctx: EditorContext, getRender: () => Promise<MathRender>): void {
  ctx.root.querySelectorAll<HTMLElement>("span[data-math]").forEach((span) => {
    span.classList.add("ew-math");
    span.setAttribute("contenteditable", "false");
    const tex = span.getAttribute("data-math") ?? "";
    if (span.getAttribute("data-rendered") === tex) return;
    span.setAttribute("data-rendered", tex);
    void getRender().then((render) => {
      if (!span.isConnected || span.getAttribute("data-math") !== tex) return;
      span.textContent = "";
      try {
        render(tex, span, false);
      } catch {
        plainRender(tex, span, false);
      }
    });
  });
}

/**
 * A widget figure whose surface already carries the source as text. Turndown
 * skips "blank" elements before rules run, so a figure must never be empty —
 * otherwise a save landing between insertion and the async render would drop
 * the block from the Markdown. (The marked renderer keeps the same invariant.)
 */
function createMathWidget(source: string): HTMLElement {
  const figure = createWidget("math", source);
  const surface = figure.querySelector<HTMLElement>(".ew-widget__surface");
  if (surface) surface.textContent = source;
  return figure;
}

function wireInlineEditing(ctx: EditorContext, remount: () => void): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const span = target.closest?.("span[data-math]") as HTMLElement | null;
    if (!span || !ctx.root.contains(span)) return;
    e.preventDefault();
    e.stopPropagation();
    openInlineEditor(ctx, span, remount);
  };
  ctx.root.addEventListener("click", onClick);
  return () => ctx.root.removeEventListener("click", onClick);
}

function openInlineEditor(ctx: EditorContext, span: HTMLElement, remount: () => void): void {
  ctx.ui.popover({
    anchor: span,
    placement: "below",
    render(el, close) {
      el.classList.add("ew-widget-editor");
      const input = document.createElement("input");
      input.className = "ew-widget-editor__source";
      input.value = span.getAttribute("data-math") ?? "";
      input.setAttribute("aria-label", "math source");
      el.appendChild(input);

      const actions = document.createElement("div");
      actions.className = "ew-popover__actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ew-popover__btn ew-popover__btn--primary";
      save.textContent = "Save";
      save.addEventListener("click", () => {
        const tex = input.value.trim();
        close();
        if (!tex) return;
        ctx.transact(() => {
          span.setAttribute("data-math", tex);
          span.removeAttribute("data-rendered");
          span.textContent = tex; // visible until the render pass catches up
        });
        remount();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ew-popover__btn is-danger";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        close();
        // Unwrap to the bare TeX text WITHOUT `$` delimiters — with them the
        // text would re-hydrate into a chip on the next parse.
        ctx.transact(() => {
          span.replaceWith(document.createTextNode(span.getAttribute("data-math") ?? ""));
        });
      });
      actions.append(save, remove);
      el.appendChild(actions);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          save.click();
        }
      });
      setTimeout(() => input.focus(), 0);
    },
  });
}

export function math(options: MathOptions = {}): EdodoPlugin {
  const getRender: () => Promise<MathRender> = options.render
    ? () => Promise.resolve(options.render as MathRender)
    : loadKatex;

  const spec: WidgetSpec = {
    kind: "math",
    busyText: "Rendering math…",
    render: async (source, el) => {
      const render = await getRender();
      el.textContent = "";
      try {
        render(source, el, true);
      } catch {
        plainRender(source, el, true);
      }
    },
  };

  const mountAll = (ctx: EditorContext) => {
    mountWidgets(ctx, spec);
    mountInlineMath(ctx, getRender);
  };

  return definePlugin({
    name: "math",

    inputRules: [
      {
        // The typed closing `$` converts — same edges as the marked tokenizer.
        kind: "inline",
        trigger: /\$([^\s$](?:[^$\n]*[^\s$])?)\$$/,
        apply: (match) => {
          const span = document.createElement("span");
          span.className = "ew-math";
          span.setAttribute("data-math", match[1]);
          span.setAttribute("contenteditable", "false");
          span.textContent = match[1]; // rendered by the next change pass
          return span;
        },
      },
    ],

    slashItems: [
      {
        id: "math-block",
        title: "Math block",
        hint: "Display TeX equation ($$)",
        keywords: ["math", "tex", "latex", "katex", "equation", "formula"],
        group: "Advanced",
        run(ctx) {
          const block = ctx.dom.currentBlock();
          const figure = createMathWidget("E = mc^2");
          ctx.transact(() => {
            if (block) block.replaceWith(figure);
            else ctx.root.appendChild(figure);
          });
          mountWidgets(ctx, spec);
          // Open the shared source editor through the click wiring.
          figure.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        },
      },
    ],

    sanitize: {
      tags: ["figure"],
      attributes: {
        figure: ["data-widget", "data-source"],
        span: ["data-math"],
      },
    },

    markdown: {
      marked: [{
        extensions: [
          {
            name: "math-block",
            level: "block",
            // Only cut paragraphs at a LINE starting with `$$` — a mid-line
            // "costs $$ money" must never split its paragraph.
            start(src: string) {
              const m = /(?:^|\n)\$\$/.exec(src);
              if (!m) return undefined;
              return m[0].startsWith("\n") ? m.index + 1 : m.index;
            },
            tokenizer(src: string) {
              let m = BLOCK_TEX_MULTI.exec(src);
              let text: string;
              if (m) {
                text = m[1];
              } else {
                m = BLOCK_TEX_ONE_LINE.exec(src);
                if (!m) return undefined;
                text = m[1].trim();
              }
              return { type: "math-block", raw: m[0], text };
            },
            renderer(token) {
              // The surface carries the source as text so the figure is never
              // "blank" to turndown; mountWidgets replaces it with the render.
              const source = escapeAttr(String(token.text));
              return `<figure data-widget="math" data-source="${source}"><div class="ew-widget__surface">${source}</div></figure>\n`;
            },
          },
          {
            name: "math-inline",
            level: "inline",
            start: (src: string) => src.indexOf("$"),
            tokenizer(src: string) {
              const m = INLINE_TEX.exec(src);
              if (!m) return undefined;
              return { type: "math-inline", raw: m[0], text: m[1] };
            },
            renderer(token) {
              const tex = escapeAttr(String(token.text));
              return `<span class="ew-math" data-math="${tex}">${tex}</span>`;
            },
          },
        ],
      }],
      turndown: (td) => {
        td.addRule("math-inline", {
          filter: (node) =>
            node.nodeName === "SPAN" && (node as HTMLElement).hasAttribute("data-math"),
          replacement: (_content, node) =>
            `$${(node as HTMLElement).getAttribute("data-math") ?? ""}$`,
        });
        td.addRule("math-block", {
          filter: (node) =>
            node.nodeName === "FIGURE" && (node as HTMLElement).getAttribute("data-widget") === "math",
          replacement: (_content, node) => {
            const source = (node as HTMLElement).getAttribute("data-source") ?? "";
            return `\n\n$$\n${source}\n$$\n\n`;
          },
        });
      },
    },

    setup: (ctx) => {
      mountAll(ctx);
      const unwireBlock = wireWidgetEditing(ctx, spec);
      const unwireInline = wireInlineEditing(ctx, () => mountAll(ctx));
      return () => {
        unwireBlock();
        unwireInline();
      };
    },

    on: {
      change: (_md, ctx) => mountAll(ctx),
    },
  });
}
