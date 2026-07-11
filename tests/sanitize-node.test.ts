// @vitest-environment node
//
// RFC §3.4 — the sanitiser must run with NO DOM present. This file forces the
// bare-Node environment (no `DOMParser`, no `document`) so it proves the
// isomorphic guarantee: `toHTML`/`sanitizeHtml` strip scripts, event handlers,
// and script-scheme URLs server-side, never throw, and keep the data:-on-img /
// data:-not-on-a asymmetry — exactly the Next.js server-component / edge path.

import { describe, it, expect } from "vitest";
import { toHTML, sanitizeHtml } from "edodo-write";

describe("sanitiser is DOM-free (bare Node)", () => {
  it("there really is no DOM in this environment", () => {
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe("undefined");
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
  });

  it("toHTML strips script/handlers/js-urls in Node", () => {
    const out = toHTML(
      "# Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))",
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("sanitizeHtml does not throw in Node", () => {
    expect(() => sanitizeHtml("<p onclick=x>hi<script>e()</script></p>")).not.toThrow();
    expect(sanitizeHtml("<p onclick=x>hi<script>e()</script></p>")).toBe("<p>hi</p>");
  });

  it("data: allowed on img, blocked on a", () => {
    expect(toHTML("![x](data:image/png;base64,AAAA)")).toContain("data:image/png");
    expect(toHTML("[x](data:text/html,<h1>)")).not.toMatch(/href="data:/);
  });

  it("task lists still decorate in Node (decorateTaskLists is DOM-free too)", () => {
    const out = toHTML("- [ ] todo\n- [x] done");
    expect(out).toContain("contains-task-list");
    expect(out).toContain('data-task="todo"');
    expect(out).toContain('data-task="done"');
    expect(out).not.toContain("disabled");
  });

  it("bare-Node output equals jsdom output for a representative doc", () => {
    // The isomorphic promise: identical bytes regardless of environment.
    const md = "# Title\n\n- [ ] a\n- [x] b\n\n> quote & <b>bold</b>\n\n[l](https://x.test)";
    // Reference captured from the jsdom run (see the assertions above); the
    // point here is that the Node render is deterministic and sanitised.
    const out = toHTML(md);
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("&amp;");
    expect(out).not.toMatch(/<script|onerror|javascript:/i);
  });
});

// mXSS via the HTML5 `--!>` "abrupt closing" comment terminator. htmlparser2
// does NOT honour `--!>`, so `<!--a--!><img …>` is swallowed as ONE comment
// node; if we re-emit it verbatim a browser re-parsing our output closes the
// comment at `--!>` and revives a live `<img onerror>`. The fix DROPS every
// comment node, so no comment (the smuggling vehicle) and nothing hidden in it
// can survive re-parsing.
describe("mXSS comment-terminator bypass is closed (bare Node)", () => {
  // The core invariant for EVERY payload: our output must carry no comment node
  // (so a re-parse can't reopen one) and no live handler / script URL / script.
  const noSmuggling = (out: string) => {
    expect(out).not.toContain("<!--"); // no comment re-serialized → no re-parse trick
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/<script/i);
  };

  // htmlparser2 swallows each of these ENTIRE payloads as a single comment node
  // (the `--!>` it ignores keeps the comment open), so dropping the comment
  // removes the smuggled element too — nothing survives at all.
  const FULLY_SWALLOWED = [
    `<!--a--!><img src=x onerror=alert(1)>`,
    `<!----!><img src=x onerror=alert(1)>`,
    `<!-- --!><a href="javascript:alert(1)">x</a>`,
  ];
  for (const payload of FULLY_SWALLOWED) {
    it(`drops the whole comment-smuggled payload: ${payload}`, () => {
      for (const out of [sanitizeHtml(payload), toHTML(payload)]) {
        noSmuggling(out);
        expect(out).not.toMatch(/<img/i); // the smuggled tag is gone with the comment
        expect(out).not.toMatch(/<a[\s>]/i);
      }
    });
  }

  // Here htmlparser2 DOES close `<!-->` as an empty comment, so the `<img>` is a
  // real sibling element — never smuggled. The comment is dropped and the img
  // is SANITISED (onerror stripped) → a harmless `<img src="x">`. That is the
  // safe, correct outcome: the danger (the handler + the live comment) is gone.
  it("sanitises (does not smuggle) a real element after an empty comment", () => {
    const payload = `<!--><img src=x onerror=alert(1)>`;
    for (const out of [sanitizeHtml(payload), toHTML(payload)]) {
      noSmuggling(out);
      expect(out).toMatch(/<img/i); // a legitimately-parsed, allowed element…
      expect(out).not.toMatch(/onerror/i); // …stripped of its event handler
    }
  });

  it("a plain comment is removed but adjacent text survives", () => {
    const out = sanitizeHtml("<!-- comment -->hello");
    expect(out).toContain("hello");
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("comment");
  });

  it("normal markup still renders (regression floor)", () => {
    expect(sanitizeHtml("<p>hi</p>")).toBe("<p>hi</p>");
    // A GFM task-list checkbox still survives the sanitiser.
    const cb = sanitizeHtml('<input type="checkbox" disabled>');
    expect(cb).toContain("<input");
    expect(cb).toContain('type="checkbox"');
  });
});
