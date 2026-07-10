/**
 * The link editor — an inline popover (no `window.prompt`). Reached from
 * Mod-K, the toolbar's link button, and clicking an existing link.
 *
 * The hard part is selection preservation: the popover's input steals focus,
 * which would normally collapse the selection `createLink` needs. The UI layer
 * saves the Range when the popover opens; we restore it right before running
 * the command.
 */

import type { EditorContext } from "./types.js";
import type { EditorUIImpl } from "./ui.js";
import { buildFieldForm } from "./ui.js";
import { closestWithin, getRange, selectionRect } from "./dom.js";

export function openLinkEditor(ctx: EditorContext, linkEl?: HTMLElement | null): boolean {
  const ui = ctx.ui as EditorUIImpl;
  const range = getRange();
  const existing = linkEl ??
    (range ? closestWithin(range.startContainer, ctx.root, (el) => el.tagName === "A") : null);

  // Nothing to link: no selection and not on an existing link.
  if (!existing && (!range || range.collapsed)) return false;

  const anchor = existing?.getBoundingClientRect() ?? selectionRect();
  if (!anchor) return false;

  const currentHref = existing?.getAttribute("href") ?? "";

  ctx.ui.popover({
    anchor,
    placement: "below",
    render(el, close) {
      el.classList.add("ew-link-popover");
      buildFieldForm(el, {
        fields: [{ name: "href", label: "Link URL", placeholder: "Paste or type a link…", value: currentHref }],
        submitLabel: existing ? "Save" : "Link",
        actions: existing
          ? [
              {
                label: "Open",
                onPick: () => {
                  const href = existing.getAttribute("href");
                  if (href) window.open(href, "_blank", "noopener");
                },
              },
              {
                label: "Remove",
                danger: true,
                onPick: () => {
                  close();
                  ui.restoreSelection();
                  ctx.exec("link", { href: null });
                },
              },
            ]
          : [],
        onSubmit(values) {
          close();
          ui.restoreSelection();
          ctx.exec("link", { href: values.href || null });
        },
      });
    },
  });
  return true;
}
