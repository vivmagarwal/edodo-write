/**
 * Document normalizer — the schema-invariant enforcer.
 *
 * contentEditable happily leaves the document in states the editor can't work
 * with: select-all + Delete keeps the first block's emptied shell (typing then
 * lands inside a stale `<h1>`), cut can leave a block with no caret anchor,
 * cross-block deletes splice styled `<span>`s into the surviving block, and
 * native edits sometimes drop bare text nodes or `<div>`s at the root — after
 * which input rules and the slash menu silently die.
 *
 * Instead of patching each symptom, `normalizeDocument` re-establishes the
 * schema after every mutation (input, paste, cut, commands):
 *
 *   1. Root children are block elements only — stray text/inline runs are
 *      wrapped into `<p>`, `<div>`s become paragraphs (or are unwrapped when
 *      they contain blocks).
 *   2. Browser styling artifacts are removed (`span[style]`/`font` unwrapped,
 *      stray `style` attributes dropped).
 *   3. Structural shells are repaired: `<ul>`/`<ol>` with no `<li>` are
 *      removed, `<pre>` always wraps a `<code>`, task items keep their
 *      checkbox + caret anchor.
 *   4. Every empty block gets a placeable caret (`<br>`, or a zero-width text
 *      node inside `<pre><code>` where a `<br>` would mean a newline).
 *   5. An effectively-empty document resets to a single empty paragraph — so
 *      select-all + Delete behaves like Notion, not like a haunted heading.
 *
 * The pass is cheap (one walk of the top-level children plus two targeted
 * queries) and idempotent. It never touches selection except through the
 * `caretFallback` the editor applies when the document was reset.
 */

const ZWSP = "​";

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "BLOCKQUOTE", "PRE", "HR", "TABLE", "FIGURE",
]);

const EMPTY_DOC_HTML = "<p><br></p>";

/** Text content with caret-parking zero-width spaces removed. */
export function visibleText(el: Node): string {
  return (el.textContent ?? "").split(ZWSP).join("");
}

/**
 * Is this element inside (or itself) a plugin-owned island whose interior the
 * normalizer must never touch? Widget figures, inline data-math chips, and
 * any non-editable subtree qualify — their inline styles are render output,
 * not contentEditable damage.
 */
function isPluginIsland(el: Element, root: HTMLElement): boolean {
  let node: Element | null = el;
  while (node && node !== root) {
    if (
      node.hasAttribute("data-widget") ||
      node.hasAttribute("data-math") ||
      node.getAttribute("contenteditable") === "false"
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** Does this block hold anything worth keeping? */
function blockHasContent(el: HTMLElement): boolean {
  if (visibleText(el).trim() !== "") return true;
  return !!el.querySelector("img,hr,input,table,td,th");
}

function isInlineOrText(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return !BLOCK_TAGS.has((node as HTMLElement).tagName) &&
    (node as HTMLElement).tagName !== "DIV" &&
    (node as HTMLElement).tagName !== "LI";
}

/** Ensure `el` has a placeable caret target (see dom.ts ensureNotEmpty). */
function ensureCaretAnchor(el: HTMLElement): void {
  const hasContent = Array.from(el.childNodes).some(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE ||
      (n.nodeType === Node.TEXT_NODE && (n as Text).data.split(ZWSP).join("").length > 0),
  );
  if (hasContent) return;
  el.textContent = "";
  el.appendChild(document.createElement("br"));
}

/**
 * Normalize the editable root in place. Returns true when the document was
 * "effectively empty" and has been reset to a single empty paragraph — the
 * caller should re-place the caret in that case.
 */
export function normalizeDocument(root: HTMLElement): boolean {
  // 2. Styling artifacts from native cross-block merges. Only styled spans and
  //    font tags — plain spans may carry classes a plugin's markdown gives
  //    meaning to, and the serializer ignores them anyway.
  //    CRITICAL EXCLUSION: plugin-owned islands (widget figures, math chips,
  //    any contenteditable=false subtree) render with inline styles on
  //    purpose — an engine's SVG sizing, KaTeX's spacing spans. Stripping
  //    inside them destroys the render while the Markdown stays fine (the
  //    "diagram breaks after any edit" bug). The normalizer repairs PROSE;
  //    islands belong to their plugins.
  root.querySelectorAll("span[style], font").forEach((el) => {
    if (isPluginIsland(el, root)) return;
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  root.querySelectorAll("[style]").forEach((el) => {
    if (isPluginIsland(el, root)) return;
    el.removeAttribute("style");
  });

  // 1. Root children must be blocks. Wrap runs of inline/text nodes into <p>.
  //    Whitespace-only text nodes between blocks (marked emits "\n" separators)
  //    are formatting, not content — drop them instead of wrapping.
  let child = root.firstChild;
  while (child) {
    const next: ChildNode | null = child.nextSibling;
    if (child.nodeType === Node.TEXT_NODE && visibleText(child).trim() === "") {
      root.removeChild(child);
      child = next;
      continue;
    }
    if (isInlineOrText(child)) {
      // Collect the full run of consecutive inline/text siblings.
      const p = document.createElement("p");
      root.insertBefore(p, child);
      let run: ChildNode | null = child;
      while (run && isInlineOrText(run)) {
        const after: ChildNode | null = run.nextSibling;
        p.appendChild(run);
        run = after;
      }
      child = p.nextSibling;
      continue;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === "DIV") {
        const hasBlockChildren = Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName) || c.tagName === "DIV");
        if (hasBlockChildren) {
          // Unwrap: hoist children to the root; they're re-examined next loop.
          const first = el.firstChild;
          while (el.firstChild) root.insertBefore(el.firstChild, el);
          el.remove();
          child = first ?? next;
          continue;
        }
        const p = document.createElement("p");
        while (el.firstChild) p.appendChild(el.firstChild);
        el.replaceWith(p);
        child = next;
        continue;
      }
    }
    child = next;
  }

  // 3. Structural repairs, block by block.
  for (const el of Array.from(root.children) as HTMLElement[]) {
    switch (el.tagName) {
      case "UL":
      case "OL": {
        if (!el.querySelector("li")) { el.remove(); break; }
        el.querySelectorAll("li").forEach((li) => normalizeListItem(li as HTMLElement));
        break;
      }
      case "PRE": {
        let code = el.querySelector(":scope > code") as HTMLElement | null;
        if (!code) {
          code = document.createElement("code");
          while (el.firstChild) code.appendChild(el.firstChild);
          el.appendChild(code);
        }
        // A <br> inside <pre> means a newline, so anchor with a ZWSP text
        // node instead (stripped on serialize).
        if (visibleText(code) === "" && !code.firstChild) {
          code.appendChild(document.createTextNode(ZWSP));
        }
        break;
      }
      case "HR":
        break;
      case "TABLE": {
        // Every cell needs a placeable caret (typing into an empty cell).
        el.querySelectorAll("td, th").forEach((cell) => {
          if (!(cell as HTMLElement).firstChild) {
            cell.appendChild(document.createElement("br"));
          }
        });
        break;
      }
      case "FIGURE":
        // Widgets (diagrams, embeds…): non-editable islands owned by plugins.
        el.setAttribute("contenteditable", "false");
        break;
      default:
        ensureCaretAnchor(el);
    }
  }

  // 5. A childless root gets its empty paragraph back. (Deliberately NOT a
  //    reset of "empty-looking" documents — a freshly inserted empty heading
  //    or quote is a legitimate state. The select-all replace/delete paths
  //    reset explicitly in the editor, where intent is known.)
  if (root.children.length === 0) {
    root.innerHTML = EMPTY_DOC_HTML;
    return true;
  }
  return false;
}

/**
 * True when the document holds nothing a user would miss: no visible text and
 * no void/media content. Used by the cut path to collapse leftover block
 * shells (`<h1></h1>` after a select-all cut) back to one empty paragraph.
 */
export function isEffectivelyEmpty(root: HTMLElement): boolean {
  if (visibleText(root).trim() !== "") return false;
  return !root.querySelector("img,hr,input,table,pre,figure");
}

/** Keep a task item's checkbox-first + caret-anchor structure intact. */
function normalizeListItem(li: HTMLElement): void {
  const box = li.querySelector(':scope > input[type="checkbox"]');
  if (box) {
    if (li.firstChild !== box) li.prepend(box);
    if (!box.nextSibling || box.nextSibling.nodeType !== Node.TEXT_NODE) {
      box.after(document.createTextNode(ZWSP));
    }
    li.classList.add("task-list-item");
    if (!li.hasAttribute("data-task")) {
      li.setAttribute("data-task", (box as HTMLInputElement).checked ? "done" : "todo");
    }
    return;
  }
  const hasSublist = !!li.querySelector(":scope > ul, :scope > ol");
  if (!hasSublist) ensureCaretAnchor(li);
}
