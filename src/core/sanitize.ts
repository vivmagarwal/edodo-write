/**
 * A tiny, dependency-free HTML sanitiser.
 *
 * We only ever render Markdown that WE parsed (via `marked`) or HTML pasted
 * into the editor, so the threat surface is small — but "small" is not "none".
 * This strips scripts, event handlers, and `javascript:` URLs, and allow-lists
 * the tag/attribute set the editor understands. It runs anywhere a DOM is
 * available (browsers + jsdom/happy-dom in tests).
 */

const ALLOWED_TAGS = new Set([
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "del", "mark", "sub", "sup",
  "a", "img",
  "ul", "ol", "li",
  "blockquote",
  "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td",
  "input", // task-list checkboxes only (filtered below)
  "span", "div",
  "details", "summary",
]);

const GLOBAL_ATTRS = new Set(["class", "id", "dir", "title", "data-checked", "data-task"]);

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  input: new Set(["type", "checked", "disabled"]),
  td: new Set(["colspan", "rowspan", "align"]),
  th: new Set(["colspan", "rowspan", "align"]),
  ol: new Set(["start"]),
  code: new Set(["class"]), // language-xxx for highlighting hooks
};

const URL_ATTRS = new Set(["href", "src"]);

function safeUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("data:text/html") || v.startsWith("vbscript:")) {
    return false;
  }
  return true;
}

function cleanElement(el: Element): void {
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap unknown elements: keep their children, drop the wrapper.
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    return;
  }

  // Only checkbox inputs survive (task lists); everything else is removed.
  if (tag === "input" && el.getAttribute("type") !== "checkbox") {
    el.remove();
    return;
  }

  const allowedForTag = TAG_ATTRS[tag];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const isAllowed =
      GLOBAL_ATTRS.has(name) || (allowedForTag && allowedForTag.has(name));
    if (name.startsWith("on") || !isAllowed) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (URL_ATTRS.has(name) && !safeUrl(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }

  // Harden external links.
  if (tag === "a" && el.getAttribute("target") === "_blank") {
    el.setAttribute("rel", "noopener noreferrer");
  }
}

/**
 * Sanitise an HTML string. Returns cleaned HTML. Safe to call in Node test
 * environments (jsdom) and in browsers.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return "";

  // Remove dangerous elements outright before unwrapping unknowns.
  root.querySelectorAll("script,style,iframe,object,embed,form,link,meta,noscript").forEach((n) => n.remove());

  // Depth-first walk; snapshot the node list because we mutate the tree.
  const all = Array.from(root.querySelectorAll("*"));
  for (const el of all) {
    // Element may have been detached by a previous unwrap; skip if so.
    if (el.isConnected) cleanElement(el);
  }
  return root.innerHTML;
}
