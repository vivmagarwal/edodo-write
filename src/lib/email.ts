/**
 * `edodo-write/email` — a generic, inline-styled email HTML renderer (RFC §10).
 *
 * Mail clients strip <style> blocks, mangle tables/images, and honour only a
 * narrow tag set — so this renderer bakes a `style=""` onto every element from
 * an injectable theme bag, clamps author headings to h2–h4, forces links to
 * open in a new tab, drops block code into a styled <pre>, drops tables, turns
 * images into links, and passes `{{placeholder}}` through (optionally
 * substituting from a data/fallbacks bag). The output is then run through a
 * DOM-free, restricted email allow-list sanitiser.
 *
 * ZERO product specifics live here: the teal palette, brand fonts, footer
 * identity, and unsubscribe compliance all arrive through `theme`, `shells`,
 * `footers`, and the runtime `footerHtml`. The package ships a NEUTRAL default
 * theme + transactional shell so it renders with no host config.
 *
 * Node-safe: the renderer, sanitiser, and the plain-text twin (`toPlainText`,
 * §9) all run in bare Node / server components / edge. Never throws — a render
 * error falls back to an escaped `<p>`.
 */

import { Marked } from "marked";
import { parseDocument } from "htmlparser2";
import render from "dom-serializer";
import { isTag, type ChildNode, type Element } from "domhandler";
import { corePreset } from "../core/preset.js";
import { toPlainText } from "./plain-text.js";
import type { EdodoPlugin } from "../core/types.js";

// ── Public types ─────────────────────────────────────────────────────────────

/** An `EMAIL_STYLES`-shaped theme bag: a `style=""` string per element slot. */
export interface EmailStyleTokens {
  body: string;
  card: string;
  paragraph: string;
  heading: string;
  link: string;
  blockquote: string;
  code: string;
  pre: string;
  footer: string;
  footerText: string;
  /** Extra slots a custom shell may read (`hr`, `list`, …). */
  [k: string]: string;
}

/** Wraps rendered body HTML into a full email document (or a fragment). */
export interface EmailShell {
  (content: string, footerHtml?: string): string;
}

export type EmailTemplate = "transactional" | "marketing" | "inline";

export interface EmailRenderOptions {
  /** Which shell wraps the body. Default "transactional". */
  template?: EmailTemplate;
  /** Style bag. Default = the neutral built-in theme. */
  theme?: EmailStyleTokens;
  /** Override one or more shells (host owns the doctype/card if it wants). */
  shells?: Partial<Record<EmailTemplate, EmailShell>>;
  /** Per-template default footer HTML. */
  footers?: Partial<Record<"transactional" | "marketing", string>>;
  /** Runtime per-recipient footer (wins over `footers`). Raw unless `sanitizeFooter`. */
  footerHtml?: string;
  /** Sanitise the footer HTML too. Default false (host-trusted, server-generated). */
  sanitizeFooter?: boolean;
  /** Token resolution (mentions/emoji/…) for the body render + plain-text twin. */
  plugins?: EdodoPlugin[];
  /** `{{placeholder}}` values. */
  data?: Record<string, string>;
  /** `{{placeholder}}` fallbacks (used when `data` lacks a key). */
  fallbacks?: Record<string, string>;
  /** Optional subject line (placeholder-substituted, returned as `subject`). */
  subject?: string;
  /** Plain-text twin options. `preserveLineBreaks` defaults to true for email. */
  plainText?: { preserveLineBreaks?: boolean };
}

export interface EmailRenderResult {
  subject?: string;
  html: string;
  text: string;
  markdown: string;
}

// ── Neutral default theme (NO brand strings) ─────────────────────────────────

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export const NEUTRAL_EMAIL_THEME: EmailStyleTokens = {
  body: `margin:0;padding:0;background-color:#f4f4f5;font-family:${SANS};color:#18181b;line-height:1.6;`,
  card: "max-width:600px;margin:0 auto;padding:32px;background-color:#ffffff;",
  paragraph: "margin:0 0 16px 0;font-size:16px;color:#18181b;",
  heading: "margin:24px 0 12px 0;font-weight:600;color:#18181b;line-height:1.3;",
  link: "color:#2563eb;text-decoration:underline;",
  blockquote:
    "margin:0 0 16px 0;padding:8px 16px;border-left:4px solid #d4d4d8;color:#52525b;",
  code: `font-family:${MONO};font-size:14px;background-color:#f4f4f5;padding:2px 4px;border-radius:3px;`,
  pre: `margin:0 0 16px 0;padding:16px;background-color:#f4f4f5;border-radius:6px;overflow-x:auto;font-family:${MONO};font-size:14px;line-height:1.5;`,
  footer: "padding:16px 0 0 0;margin-top:16px;border-top:1px solid #e4e4e7;",
  footerText: "margin:0;font-size:12px;color:#71717a;",
  hr: "border:none;border-top:1px solid #e4e4e7;margin:24px 0;",
  list: "margin:0 0 16px 0;padding-left:24px;font-size:16px;color:#18181b;",
};

// ── Default shells ───────────────────────────────────────────────────────────

const META =
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';

function footerBlock(theme: EmailStyleTokens, footerHtml?: string): string {
  if (!footerHtml) return "";
  return `<div style="${theme.footer}"><div style="${theme.footerText}">${footerHtml}</div></div>`;
}

function transactionalShell(theme: EmailStyleTokens): EmailShell {
  return (content, footerHtml) =>
    `<!doctype html><html><head>${META}</head>` +
    `<body style="${theme.body}"><div style="${theme.card}">` +
    `${content}${footerBlock(theme, footerHtml)}` +
    `</div></body></html>`;
}

function marketingShell(theme: EmailStyleTokens): EmailShell {
  // Table-based, full-bleed layout — the classic marketing-email structure,
  // structurally distinct from the transactional card.
  return (content, footerHtml) =>
    `<!doctype html><html><head>${META}</head>` +
    `<body style="${theme.body}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">` +
    `<div style="${theme.card}">${content}${footerBlock(theme, footerHtml)}</div>` +
    `</td></tr></table></body></html>`;
}

function inlineShell(theme: EmailStyleTokens): EmailShell {
  // No doctype — a bare fragment for embedding in an existing document.
  return (content, footerHtml) =>
    `<div style="${theme.body}"><div style="${theme.card}">` +
    `${content}${footerBlock(theme, footerHtml)}` +
    `</div></div>`;
}

function resolveShell(template: EmailTemplate, theme: EmailStyleTokens, overrides?: EmailRenderOptions["shells"]): EmailShell {
  const custom = overrides?.[template];
  if (custom) return custom;
  switch (template) {
    case "marketing":
      return marketingShell(theme);
    case "inline":
      return inlineShell(theme);
    default:
      return transactionalShell(theme);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Substitute `{{key}}` from `data` then `fallbacks`. A key present in neither is
 * left verbatim. When both bags are absent, the string is returned untouched.
 * `escape` HTML-escapes the injected value (HTML context); off for plain text.
 */
function substitute(
  s: string,
  data?: Record<string, string>,
  fallbacks?: Record<string, string>,
  escape = false,
): string {
  if (!data && !fallbacks) return s;
  return s.replace(PLACEHOLDER_RE, (m, key: string) => {
    const v = data && key in data ? data[key] : fallbacks && key in fallbacks ? fallbacks[key] : undefined;
    if (v === undefined) return m;
    return escape ? escapeHtml(v) : v;
  });
}

// ── Restricted email sanitiser (DOM-free) ────────────────────────────────────

const EMAIL_TAGS = new Set([
  "p", "h2", "h3", "h4", "a", "strong", "em", "s", "ul", "ol", "li", "blockquote", "br", "hr", "code", "pre",
]);
const EMAIL_TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel", "style", "title"]),
};
const EMAIL_GLOBAL_ATTRS = new Set(["style"]);
const EMAIL_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

function emailSafeUrl(value: string): boolean {
  const v = value.replace(/[ -]/g, "").trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!scheme) return true; // relative / anchor — no scheme to abuse
  return EMAIL_SCHEMES.includes(scheme[1].toLowerCase() + ":");
}

function cleanEmailElement(el: Element): ChildNode[] {
  const tag = el.name.toLowerCase();
  if (!EMAIL_TAGS.has(tag)) {
    // Unknown/disallowed tag (span, div, img, table…) → unwrap, keep children.
    return cleanEmailNodes(el.children as ChildNode[]);
  }
  const allowed = EMAIL_TAG_ATTRS[tag];
  for (const name of Object.keys(el.attribs)) {
    const ok = EMAIL_GLOBAL_ATTRS.has(name) || (allowed && allowed.has(name));
    if (name.startsWith("on") || !ok) {
      delete el.attribs[name];
      continue;
    }
    if (name === "href" && !emailSafeUrl(el.attribs[name])) delete el.attribs[name];
  }
  el.children = cleanEmailNodes(el.children as ChildNode[]);
  return [el];
}

function cleanEmailNodes(nodes: ChildNode[]): ChildNode[] {
  const out: ChildNode[] = [];
  for (const node of nodes) {
    if (isTag(node)) out.push(...cleanEmailElement(node));
    else out.push(node);
  }
  return out;
}

function sanitizeEmailHtml(html: string): string {
  const doc = parseDocument(html ?? "", { decodeEntities: true });
  const cleaned = cleanEmailNodes(doc.children as ChildNode[]);
  return render(cleaned, { encodeEntities: "utf8", emptyAttrs: true });
}

/** Exposed so hosts can sanitise a custom footer with the same policy. */
export { sanitizeEmailHtml };

// ── The marked email renderer ────────────────────────────────────────────────

function buildRenderer(theme: EmailStyleTokens): Record<string, unknown> {
  return {
    heading(text: string, level: number): string {
      const lvl = Math.min(Math.max(level, 2), 4);
      return `<h${lvl} style="${theme.heading}">${text}</h${lvl}>`;
    },
    paragraph(text: string): string {
      return `<p style="${theme.paragraph}">${text}</p>`;
    },
    link(href: string, title: string | null | undefined, text: string): string {
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="${theme.link}"${t}>${text}</a>`;
    },
    image(href: string, _title: string | null | undefined, text: string): string {
      // Mail clients butcher inline images → link to the asset instead.
      const label = text || href;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="${theme.link}">${escapeHtml(label)}</a>`;
    },
    code(code: string, _infostring: string | undefined): string {
      return `<pre style="${theme.pre}"><code>${escapeHtml(code)}</code></pre>`;
    },
    codespan(text: string): string {
      return `<code style="${theme.code}">${text}</code>`;
    },
    blockquote(quote: string): string {
      return `<blockquote style="${theme.blockquote}">${quote}</blockquote>`;
    },
    list(body: string, ordered: boolean): string {
      const tag = ordered ? "ol" : "ul";
      return `<${tag} style="${theme.list}">${body}</${tag}>`;
    },
    listitem(text: string): string {
      return `<li>${text}</li>`;
    },
    del(text: string): string {
      return `<s style="text-decoration:line-through;">${text}</s>`;
    },
    hr(): string {
      return `<hr style="${theme.hr}"/>`;
    },
    // Tables are dropped — mail clients render them inconsistently.
    table(): string {
      return "";
    },
  };
}

function renderBody(md: string, theme: EmailStyleTokens, plugins?: EdodoPlugin[]): string {
  const marked = new Marked({ gfm: true, breaks: false });
  for (const p of [corePreset(), ...(plugins ?? [])]) {
    for (const ext of p.markdown?.marked ?? []) marked.use(ext);
  }
  marked.use({ renderer: buildRenderer(theme) as never });
  return String(marked.parse(md ?? "", { async: false }));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Render Markdown to inline-styled email HTML (+ a plain-text twin). Never
 * throws: a render error falls back to an escaped `<p>` in the same shell.
 */
export function toEmailHtml(md: string, opts: EmailRenderOptions = {}): EmailRenderResult {
  const source = md ?? "";
  const theme = opts.theme ?? NEUTRAL_EMAIL_THEME;
  const template = opts.template ?? "transactional";
  const shell = resolveShell(template, theme, opts.shells);

  // Body → HTML.
  let bodyHtml: string;
  try {
    const rendered = renderBody(source, theme, opts.plugins);
    bodyHtml = sanitizeEmailHtml(rendered);
  } catch {
    bodyHtml = `<p style="${theme.paragraph}">${escapeHtml(String(source))}</p>`;
  }
  bodyHtml = substitute(bodyHtml, opts.data, opts.fallbacks, true);

  // Footer: runtime override wins, else the per-template default.
  const footerDefault =
    template === "marketing" ? opts.footers?.marketing : template === "inline" ? undefined : opts.footers?.transactional;
  let footerHtml = opts.footerHtml ?? footerDefault;
  if (footerHtml && opts.sanitizeFooter) footerHtml = sanitizeEmailHtml(footerHtml);

  const html = shell(bodyHtml, footerHtml);

  // Plain-text twin.
  let text: string;
  try {
    text = toPlainText(source, {
      preserveLineBreaks: opts.plainText?.preserveLineBreaks ?? true,
      plugins: opts.plugins,
    });
  } catch {
    text = String(source);
  }
  text = substitute(text, opts.data, opts.fallbacks, false);

  const result: EmailRenderResult = { html, text, markdown: source };
  if (opts.subject != null) result.subject = substitute(opts.subject, opts.data, opts.fallbacks, false);
  return result;
}

/**
 * Bind a set of defaults (theme, plugins, footers, …) once and reuse the
 * renderer across messages. Per-call `opts` shallow-override the defaults;
 * `data`/`fallbacks` are merged (call wins).
 */
export function createEmailRenderer(
  defaults: EmailRenderOptions = {},
): (md: string, opts?: EmailRenderOptions) => EmailRenderResult {
  return (md, opts = {}) =>
    toEmailHtml(md, {
      ...defaults,
      ...opts,
      shells: { ...defaults.shells, ...opts.shells },
      footers: { ...defaults.footers, ...opts.footers },
      data: { ...defaults.data, ...opts.data },
      fallbacks: { ...defaults.fallbacks, ...opts.fallbacks },
      plainText: { ...defaults.plainText, ...opts.plainText },
      plugins: opts.plugins ?? defaults.plugins,
    });
}
