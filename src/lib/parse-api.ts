/**
 * `edodo-write/parse` — a Node-safe (no DOM) parse/visitor API for the content
 * lifecycle: notification fan-out, full-text search projection, AI moderation,
 * attachment GC, and task-checkbox persistence (RFC §8).
 *
 * Everything here runs in bare Node / Next.js server components / edge — no
 * `document`, no `DOMParser`, no sanitiser. The primitives are built on a
 * CommonMark-aware code-region splitter whose defining invariant is:
 *
 *     splitCodeSegments(md).map((p) => p.text).join("") === md
 *
 * so token extractors can reliably SKIP anything inside fenced blocks or inline
 * code without ever losing or reordering a character. The token grammars a host
 * feeds `extractTokens` / `parseTokens` are the SAME `parse.pattern`s the
 * render-time plugins use, so extraction and render can never diverge.
 */

import { Marked } from "marked";
import { corePreset } from "../core/preset.js";
import type { EdodoPlugin } from "../core/types.js";

// ── Code-region model ────────────────────────────────────────────────────────

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/;

/**
 * Per-character code mask: `true` where the character sits inside a fenced code
 * block OR an inline code span. Two phases:
 *   1. fenced blocks — line-anchored (```/~~~, indent ≤ 3, close ≥ open length);
 *   2. inline code spans — CommonMark backtick runs (a run of N backticks closes
 *      on the next run of EXACTLY N backticks) scanned only over non-fenced text.
 */
function computeCodeMask(s: string): boolean[] {
  const n = s.length;
  const code = new Array<boolean>(n).fill(false);
  const fenced = new Array<boolean>(n).fill(false);

  // Phase 1 — fenced blocks (line based).
  let i = 0;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  while (i < n) {
    const eol = s.indexOf("\n", i);
    const lineEnd = eol === -1 ? n : eol;
    const nextStart = eol === -1 ? n : eol + 1;
    const line = s.slice(i, lineEnd);
    if (fenceChar === null) {
      const m = FENCE_OPEN.exec(line);
      if (m) {
        fenceChar = m[2][0];
        fenceLen = m[2].length;
        for (let k = i; k < nextStart; k++) fenced[k] = true;
      }
    } else {
      for (let k = i; k < nextStart; k++) fenced[k] = true;
      const cm = FENCE_CLOSE.exec(line);
      if (cm && cm[2][0] === fenceChar && cm[2].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
    }
    i = nextStart;
  }
  for (let k = 0; k < n; k++) if (fenced[k]) code[k] = true;

  // Phase 2 — inline code spans over non-fenced regions.
  i = 0;
  while (i < n) {
    if (fenced[i]) {
      i++;
      continue;
    }
    if (s[i] === "`") {
      let j = i;
      while (j < n && s[j] === "`" && !fenced[j]) j++;
      const runLen = j - i;
      let k = j;
      let closed = -1;
      while (k < n && !fenced[k]) {
        if (s[k] === "`") {
          let l = k;
          while (l < n && s[l] === "`" && !fenced[l]) l++;
          if (l - k === runLen) {
            closed = l;
            break;
          }
          k = l;
        } else {
          k++;
        }
      }
      if (closed !== -1) {
        for (let p = i; p < closed; p++) code[p] = true;
        i = closed;
        continue;
      }
      i = j; // unterminated run → the backticks are literal
      continue;
    }
    i++;
  }
  return code;
}

/**
 * Split `md` into consecutive `{ code, text }` segments where `code` marks
 * fenced-block / inline-code regions. Invariant:
 * `splitCodeSegments(md).map((p) => p.text).join("") === md`.
 */
export function splitCodeSegments(md: string): Array<{ code: boolean; text: string }> {
  const s = String(md ?? "");
  if (s === "") return [];
  const mask = computeCodeMask(s);
  const parts: Array<{ code: boolean; text: string }> = [];
  let start = 0;
  for (let i = 1; i <= s.length; i++) {
    if (i === s.length || mask[i] !== mask[i - 1]) {
      parts.push({ code: mask[i - 1], text: s.slice(start, i) });
      start = i;
    }
  }
  return parts;
}

/**
 * Replace every code-region character with a space (newlines preserved) so the
 * result has the SAME length and line structure as `md` but no code content for
 * a caller's line/offset-anchored scans to trip over.
 */
export function stripCodeBlocks(md: string): string {
  const s = String(md ?? "");
  const mask = computeCodeMask(s);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += mask[i] ? (s[i] === "\n" ? "\n" : " ") : s[i];
  }
  return out;
}

/**
 * Per-line flags (`md.split("\n")` order): `true` for a line that is part of a
 * fenced code block (its opening/closing fence lines included). Inline code
 * never makes a whole line "code". For line-anchored scans (e.g. task lists).
 */
export function markCodeLines(md: string): boolean[] {
  const s = String(md ?? "");
  const lines = s.split("\n");
  const result: boolean[] = [];
  let fenceChar: string | null = null;
  let fenceLen = 0;
  for (const line of lines) {
    if (fenceChar === null) {
      const m = FENCE_OPEN.exec(line);
      if (m) {
        fenceChar = m[2][0];
        fenceLen = m[2].length;
        result.push(true);
      } else {
        result.push(false);
      }
    } else {
      result.push(true);
      const cm = FENCE_CLOSE.exec(line);
      if (cm && cm[2][0] === fenceChar && cm[2].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
    }
  }
  return result;
}

// ── Token extraction ─────────────────────────────────────────────────────────

/**
 * Run `pattern` over `md`, SKIPPING any match that begins inside a code region,
 * and map each surviving match with `map`. The `pattern` is a plugin's
 * `parse.pattern` (e.g. the mention grammar), so extraction and render agree.
 * A non-global pattern is upgraded to global internally.
 */
export function extractTokens<T>(
  md: string,
  pattern: RegExp,
  map: (m: RegExpExecArray) => T,
): T[] {
  const s = String(md ?? "");
  const mask = computeCodeMask(s);
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  const out: T[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index < s.length && !mask[m.index]) out.push(map(m));
    if (m[0] === "") re.lastIndex++; // guard against zero-width infinite loops
  }
  return out;
}

// ── GFM task toggling ────────────────────────────────────────────────────────

/**
 * Recognises a GFM task line — the leading list marker (optionally nested in
 * blockquotes / ordered markers) up to and INCLUDING the `[`, the single state
 * char, then the closing `]`. Group 1 is the prefix through `[`, group 2 is `]`.
 */
export const TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)[ xX](\])/;

/**
 * Flip the `index`-th (0-based, document order, code-skipping) GFM checkbox to
 * an ABSOLUTE state. `index` maps 1:1 to rendered `input[type=checkbox]` order.
 * Out-of-range `index` returns `md` unchanged.
 */
export function toggleTaskInMarkdown(md: string, index: number, checked: boolean): string {
  const s = String(md ?? "");
  if (index < 0) return s;
  const lines = s.split("\n");
  const codeLine = markCodeLines(s);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (codeLine[i]) continue;
    if (TASK_LINE_RE.test(lines[i])) {
      if (count === index) {
        lines[i] = lines[i].replace(TASK_LINE_RE, (_m, p1, p2) => `${p1}${checked ? "x" : " "}${p2}`);
        return lines.join("\n");
      }
      count++;
    }
  }
  return s; // index out of range → unchanged
}

// ── Token tree ───────────────────────────────────────────────────────────────

/**
 * A node in the token walk produced by `parseTokens`. `range` is a best-effort
 * `[start, end)` offset into the source; block-level ranges are exact, inline
 * ranges are best-effort. `attrs` carries token metadata (mention id/display,
 * emoji code/glyph, link href, image src/alt, …).
 */
export interface TokenNode {
  type: string;
  value?: string;
  attrs?: Record<string, string>;
  children?: TokenNode[];
  range: [number, number];
}

function normType(type: string): string {
  return type.startsWith("mention") ? "mention" : type;
}

function tokenAttrs(tok: any): Record<string, string> | undefined {
  if (String(tok.type).startsWith("mention")) {
    const item = tok.item ?? {};
    return { id: String(item.id ?? ""), display: String(item.display ?? "") };
  }
  switch (tok.type) {
    case "emoji":
      return { code: String(tok.code ?? ""), glyph: String(tok.glyph ?? "") };
    case "link": {
      const a: Record<string, string> = { href: String(tok.href ?? "") };
      if (tok.title) a.title = String(tok.title);
      return a;
    }
    case "image": {
      const a: Record<string, string> = { src: String(tok.href ?? ""), alt: String(tok.text ?? "") };
      if (tok.title) a.title = String(tok.title);
      return a;
    }
    case "heading":
      return { depth: String(tok.depth ?? 1) };
    default:
      return undefined;
  }
}

function tokenValue(tok: any): string | undefined {
  switch (tok.type) {
    case "text":
    case "codespan":
    case "escape":
    case "code":
      return typeof tok.text === "string" ? tok.text : undefined;
    default:
      return undefined;
  }
}

/**
 * Walk `md` as a token tree, applying the token grammars of `plugins`
 * (mentions/emoji/…) so their custom tokens surface as typed nodes. Node-safe:
 * uses marked's lexer, never a DOM.
 */
export function parseTokens(md: string, opts: { plugins?: EdodoPlugin[] } = {}): TokenNode[] {
  const s = String(md ?? "");
  const marked = new Marked({ gfm: true, breaks: false });
  for (const p of [corePreset(), ...(opts.plugins ?? [])]) {
    for (const ext of p.markdown?.marked ?? []) marked.use(ext);
  }
  const tokens = marked.lexer(s) as any[];

  const walk = (toks: any[], searchStart: number): TokenNode[] => {
    const nodes: TokenNode[] = [];
    let cursor = searchStart;
    for (const tok of toks) {
      const raw: string = typeof tok.raw === "string" ? tok.raw : "";
      let start = raw ? s.indexOf(raw, cursor) : cursor;
      if (start < 0) start = cursor;
      const end = start + raw.length;
      const node: TokenNode = { type: normType(String(tok.type)), range: [start, end] };
      const attrs = tokenAttrs(tok);
      if (attrs) node.attrs = attrs;
      const value = tokenValue(tok);
      if (value !== undefined) node.value = value;
      const childToks: any[] | undefined = Array.isArray(tok.tokens)
        ? tok.tokens
        : Array.isArray(tok.items)
          ? tok.items
          : undefined;
      if (childToks && childToks.length) node.children = walk(childToks, start);
      nodes.push(node);
      cursor = end > cursor ? end : cursor;
    }
    return nodes;
  };

  return walk(tokens, 0);
}
