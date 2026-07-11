/**
 * A tiny, DOM-free HTML sanitiser.
 *
 * We only ever render Markdown that WE parsed (via `marked`) or HTML pasted
 * into the editor, so the threat surface is small — but "small" is not "none".
 * This strips scripts, event handlers, and `javascript:` URLs, and allow-lists
 * the tag/attribute set the editor understands.
 *
 * Isomorphic by construction: the HTML is tokenised with `htmlparser2` and
 * re-serialised with `dom-serializer` (both pure-JS, no DOM), so it produces
 * identical output in the browser, in jsdom tests, AND in bare Node / edge /
 * Next.js server components — exactly the SSR runtimes `<Markdown>`/`toHTML`
 * invite. The serializer is configured (`encodeEntities: "utf8"`,
 * `emptyAttrs: true`) to match the browser's HTML-fragment serialisation
 * byte-for-byte for the tag/attribute set we emit.
 *
 * Plugins may WIDEN the allow-list additively (extra tags/attributes for their
 * parsed HTML to survive) via `SanitizeOptions` — but the denial floor is not
 * negotiable: scripts, iframes, event handlers, and script-scheme URLs are
 * always stripped regardless of what an extension asks for.
 */

import { parseDocument } from "htmlparser2";
import render from "dom-serializer";
import { isTag, isText, type ChildNode, type Element } from "domhandler";

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

/**
 * Clean one element node in place and return the nodes that should replace it
 * in the output:
 *   • denied tag        → `[]`               (dropped outright, children too)
 *   • unknown tag       → its cleaned children (unwrapped, wrapper dropped)
 *   • non-checkbox input→ `[]`               (only task-list checkboxes survive)
 *   • allowed tag       → `[el]`             (attributes filtered, links hardened)
 */
function cleanElement(el: Element, policy: ResolvedPolicy): ChildNode[] {
  const tag = el.name.toLowerCase();

  // Denied tags never survive — their whole subtree goes with them.
  if (DENIED_TAGS.has(tag)) return [];

  if (!policy.tags.has(tag)) {
    // Unwrap unknown elements: keep their (cleaned) children, drop the wrapper.
    return cleanNodes(el.children, policy);
  }

  // Only checkbox inputs survive (task lists); everything else is removed.
  if (tag === "input" && el.attribs.type !== "checkbox") return [];

  const allowedForTag = policy.attrs[tag];
  for (const name of Object.keys(el.attribs)) {
    // Attribute names are already lowercased by the HTML parser.
    const isAllowed =
      GLOBAL_ATTRS.has(name) || (allowedForTag && allowedForTag.has(name));
    if (name.startsWith("on") || !isAllowed) {
      delete el.attribs[name];
      continue;
    }
    if (URL_ATTRS.has(name) && !safeUrl(el.attribs[name])) {
      delete el.attribs[name];
    }
  }

  // Harden external links (rel keeps its original slot when it already exists,
  // else lands last — matching the browser's attribute serialisation order).
  if (tag === "a" && el.attribs.target === "_blank") {
    el.attribs.rel = "noopener noreferrer";
  }

  el.children = cleanNodes(el.children, policy);
  return [el];
}

/**
 * Clean a list of sibling nodes, splicing in the results of each.
 *
 * ONLY elements and TEXT survive. Comment / directive (`<!doctype>`, `<!-->`) /
 * CDATA / processing-instruction nodes are DROPPED outright (mirroring
 * DOMPurify). This is not cosmetic: htmlparser2 does not honour the HTML5 `--!>`
 * "abrupt closing" comment terminator, so a payload like
 * `<!--a--!><img src=x onerror=alert(1)>` is swallowed as ONE comment node and,
 * if re-emitted verbatim, a browser re-parsing our output (via
 * dangerouslySetInnerHTML) closes the comment at `--!>` and materialises a live
 * `<img onerror>`. Refusing to re-serialise ANY comment node closes that mXSS
 * seam completely.
 */
function cleanNodes(nodes: ChildNode[], policy: ResolvedPolicy): ChildNode[] {
  const out: ChildNode[] = [];
  for (const node of nodes) {
    if (isTag(node)) out.push(...cleanElement(node, policy));
    else if (isText(node)) out.push(node); // text survives; comments/CDATA/directives dropped
  }
  return out;
}

/**
 * Sanitise an HTML string. Returns cleaned HTML. Runs anywhere — browsers,
 * jsdom/happy-dom tests, and bare Node (no DOM required).
 */
export function sanitizeHtml(html: string, options?: SanitizeOptions): string {
  const policy = resolvePolicy(options);
  // Parse WITHOUT a wrapper element — `parseDocument` handles a fragment
  // natively, and a stray `</div>` in the input can't break out of anything.
  const doc = parseDocument(html ?? "", { decodeEntities: true });
  const cleaned = cleanNodes(doc.children as ChildNode[], policy);
  return render(cleaned, { encodeEntities: "utf8", emptyAttrs: true });
}
