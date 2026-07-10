/**
 * A tiny, dependency-free HTML sanitiser.
 *
 * We only ever render Markdown that WE parsed (via `marked`) or HTML pasted
 * into the editor, so the threat surface is small — but "small" is not "none".
 * This strips scripts, event handlers, and `javascript:` URLs, and allow-lists
 * the tag/attribute set the editor understands. It runs anywhere a DOM is
 * available (browsers + jsdom/happy-dom in tests).
 *
 * Plugins may WIDEN the allow-list additively (extra tags/attributes for their
 * parsed HTML to survive) via `SanitizeOptions` — but the denial floor is not
 * negotiable: scripts, iframes, event handlers, and script-scheme URLs are
 * always stripped regardless of what an extension asks for.
 */

export interface SanitizeOptions {
  /** Extra allowed tags (lowercase). */
  tags?: string[];
  /** Extra allowed attributes per tag (lowercase). */
  attributes?: Record<string, string[]>;
}

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
]);

/** The non-negotiable denial floor — never allowed, even via extensions. */
const DENIED_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "form", "link", "meta",
  "noscript", "base", "template", "frame", "frameset", "applet",
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
  // Browsers strip ASCII control chars (tab/newline/CR) when parsing URLs, so
  // "jav\tascript:…" IS a live javascript: URL — strip them before checking.
  const v = value.replace(/[\u0000-\u001f]/g, "").trim().toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("data:text/html") || v.startsWith("vbscript:")) {
    return false;
  }
  return true;
}

interface ResolvedPolicy {
  tags: Set<string>;
  attrs: Record<string, Set<string>>;
}

function resolvePolicy(options?: SanitizeOptions): ResolvedPolicy {
  if (!options || (!options.tags?.length && !options.attributes)) {
    return { tags: ALLOWED_TAGS, attrs: TAG_ATTRS };
  }
  const tags = new Set(ALLOWED_TAGS);
  for (const t of options.tags ?? []) {
    const tag = t.toLowerCase();
    if (!DENIED_TAGS.has(tag)) tags.add(tag);
  }
  const attrs: Record<string, Set<string>> = { ...TAG_ATTRS };
  for (const [tag, names] of Object.entries(options.attributes ?? {})) {
    const key = tag.toLowerCase();
    attrs[key] = new Set([...(attrs[key] ?? []), ...names.map((n) => n.toLowerCase())]);
  }
  return { tags, attrs };
}

function cleanElement(el: Element, policy: ResolvedPolicy): void {
  const tag = el.tagName.toLowerCase();

  if (!policy.tags.has(tag)) {
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

  const allowedForTag = policy.attrs[tag];
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
export function sanitizeHtml(html: string, options?: SanitizeOptions): string {
  const policy = resolvePolicy(options);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return "";

  // Remove dangerous elements outright before unwrapping unknowns.
  root.querySelectorAll(Array.from(DENIED_TAGS).join(",")).forEach((n) => n.remove());

  // Depth-first walk; snapshot the node list because we mutate the tree.
  const all = Array.from(root.querySelectorAll("*"));
  for (const el of all) {
    // Element may have been detached by a previous unwrap; skip if so.
    if (el.isConnected) cleanElement(el, policy);
  }
  return root.innerHTML;
}
