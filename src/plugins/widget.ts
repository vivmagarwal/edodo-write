/**
 * Shared widget machinery for source-carrying block plugins (diagrams, math
 * blocks, embeds).
 *
 * A widget is a non-editable `<figure data-widget="<kind>" data-source="…">`
 * whose SOURCE lives in the `data-source` attribute — that attribute is the
 * single thing the plugin's turndown rule serializes back to Markdown, so the
 * rendered view can be anything (SVG, iframe, card) without ever touching the
 * round-trip. The engine treats FIGURE as a first-class block: Enter escapes
 * below it, Backspace before it deletes it whole (undoable), drag reorders it.
 *
 * Rendering is reconciled, not imperative: `mountWidgets` walks the editor for
 * figures of a kind and (re)renders any whose source changed since the last
 * pass (tracked via `data-rendered`). Call it from `setup` and `on.change` —
 * cheap because unchanged widgets are skipped.
 */

import type { EdodoPlugin, EditorContext } from "../lib/index.js";

export interface WidgetSpec {
  /** data-widget discriminator, e.g. "diagram-edd", "math-block", "embed". */
  kind: string;
  /**
   * Render `source` into `el` (the figure's dedicated render surface — its
   * only child). May be async; a rejected promise renders a readable error
   * box instead of exploding the editor.
   */
  render(source: string, el: HTMLElement, ctx: EditorContext): void | Promise<void>;
  /**
   * Open an editing UI on click. Default: a source textarea popover with
   * Save/Cancel (+ live re-render on save). Pass `false` to disable editing,
   * or a custom handler.
   */
  edit?: false | ((figure: HTMLElement, ctx: EditorContext) => void);
  /** Placeholder title while (re)rendering, e.g. "Rendering diagram…". */
  busyText?: string;
}

/** Build a widget figure element for insertion (used by commands/input rules). */
export function createWidget(kind: string, source: string): HTMLElement {
  const figure = document.createElement("figure");
  figure.setAttribute("data-widget", kind);
  figure.setAttribute("data-source", source);
  figure.setAttribute("contenteditable", "false");
  const surface = document.createElement("div");
  surface.className = "ew-widget__surface";
  figure.appendChild(surface);
  return figure;
}

/** The figure's render surface (created on demand for parsed-from-Markdown widgets). */
function surfaceOf(figure: HTMLElement): HTMLElement {
  let surface = figure.querySelector(":scope > .ew-widget__surface") as HTMLElement | null;
  if (!surface) {
    surface = document.createElement("div");
    surface.className = "ew-widget__surface";
    figure.textContent = "";
    figure.appendChild(surface);
  }
  return surface;
}

/**
 * Reconcile all widgets of `spec.kind` under the editor root: render new or
 * changed ones, skip untouched ones. Idempotent and cheap — call freely.
 */
export function mountWidgets(ctx: EditorContext, spec: WidgetSpec): void {
  const figures = ctx.root.querySelectorAll<HTMLElement>(`figure[data-widget="${spec.kind}"]`);
  figures.forEach((figure) => {
    figure.setAttribute("contenteditable", "false");
    const source = figure.getAttribute("data-source") ?? "";
    if (figure.getAttribute("data-rendered") === source) return;
    figure.setAttribute("data-rendered", source);
    const surface = surfaceOf(figure);
    surface.classList.add("is-busy");
    if (spec.busyText) surface.setAttribute("aria-label", spec.busyText);
    Promise.resolve()
      .then(() => spec.render(source, surface, ctx))
      .then(() => surface.classList.remove("is-busy"))
      .catch((err) => {
        surface.classList.remove("is-busy");
        surface.textContent = "";
        const box = document.createElement("div");
        box.className = "ew-widget__error";
        box.textContent = `${spec.kind}: ${err instanceof Error ? err.message : String(err)}`;
        surface.appendChild(box);
      });
  });
}

/**
 * Wire click-to-edit for a widget kind. Default editor: a popover with the
 * source in a textarea, Save / Cancel, saving inside one transaction (one
 * undo step) and re-rendering via `mountWidgets`.
 * Returns the cleanup function — return it from the plugin's `setup`.
 */
export function wireWidgetEditing(ctx: EditorContext, spec: WidgetSpec): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const figure = target.closest?.(`figure[data-widget="${spec.kind}"]`) as HTMLElement | null;
    if (!figure || !ctx.root.contains(figure)) return;
    if (spec.edit === false) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof spec.edit === "function") {
      spec.edit(figure, ctx);
      return;
    }
    openSourceEditor(ctx, spec, figure);
  };
  ctx.root.addEventListener("click", onClick);
  return () => ctx.root.removeEventListener("click", onClick);
}

function openSourceEditor(ctx: EditorContext, spec: WidgetSpec, figure: HTMLElement): void {
  ctx.ui.popover({
    anchor: figure,
    placement: "below",
    render(el, close) {
      el.classList.add("ew-widget-editor");
      const textarea = document.createElement("textarea");
      textarea.className = "ew-widget-editor__source";
      textarea.value = figure.getAttribute("data-source") ?? "";
      textarea.rows = Math.min(14, Math.max(4, textarea.value.split("\n").length + 1));
      textarea.setAttribute("aria-label", `${spec.kind} source`);
      el.appendChild(textarea);

      const actions = document.createElement("div");
      actions.className = "ew-popover__actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ew-popover__btn ew-popover__btn--primary";
      save.textContent = "Save";
      save.addEventListener("click", () => {
        close();
        ctx.transact(() => {
          figure.setAttribute("data-source", textarea.value);
          figure.removeAttribute("data-rendered");
        });
        mountWidgets(ctx, spec);
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ew-popover__btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => close());
      actions.append(save, cancel);
      el.appendChild(actions);
      setTimeout(() => textarea.focus(), 0);
    },
  });
}

/** HTML-escape a source string for embedding in a data attribute by a marked
 *  renderer (newlines survive attribute round-trips). */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
