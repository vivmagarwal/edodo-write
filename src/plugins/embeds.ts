/**
 * Embeds — Notion-style media embeds (video / audio / web bookmark) whose
 * Markdown form is NOTHING but a bare URL line:
 *
 *   https://youtu.be/dQw4w9WgXcQ
 *
 * Why this syntax: GFM already autolinks a bare URL, so the document degrades
 * to a clickable link in any editor without this plugin — zero data loss, no
 * invented fence. A deliberately written `[title](url)` link (text ≠ href) is
 * NEVER converted; that is the opt-out.
 *
 * In the editor an embed is `<figure data-widget="embed" data-source="<url>">`
 * (the shared widget machinery — the engine treats FIGURE as a first-class
 * block). Hydration is a reconciliation pass, not a marked extension: on setup
 * and on every change, top-level paragraphs whose ONLY content is one bare
 * URL — as a GFM autolink (text === href) or as plain typed text — become
 * widgets, unless the caret is inside them (never yank the line the user is
 * still on). The paired turndown rules serialize both the widget and the
 * still-a-paragraph form back to the bare URL line, so the round-trip is
 * byte-stable in every state.
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import { createWidget, mountWidgets, wireWidgetEditing, type WidgetSpec } from "./widget.js";

export interface EmbedMetadata {
  title?: string;
  description?: string;
  image?: string;
}

export interface EmbedsOptions {
  /** Fetch bookmark-card metadata for a URL. Default: domain-only cards. */
  fetchMetadata?: (url: string) => Promise<EmbedMetadata>;
}

export type EmbedClassification =
  | { kind: "youtube"; id: string }
  | { kind: "vimeo"; id: string }
  | { kind: "video" }
  | { kind: "audio" }
  | { kind: "bookmark" };

const ZWSP = "​";
const URL_RE = /^https?:\/\/\S+$/;
const VIDEO_EXT = /\.(mp4|webm|mov)$/;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a)$/;
const YT_ID = /^[\w-]{6,}$/;

function stripZwsp(s: string): string {
  return s.split(ZWSP).join("");
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** Which renderer a URL gets. Exported for tests (pure, DOM-free). */
export function classifyEmbedUrl(url: string): EmbedClassification {
  let u: URL;
  try { u = new URL(url); } catch { return { kind: "bookmark" }; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0] ?? "";
    if (YT_ID.test(id)) return { kind: "youtube", id };
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    const v = u.searchParams.get("v");
    if (u.pathname === "/watch" && v && YT_ID.test(v)) return { kind: "youtube", id: v };
    const m = /^\/(?:shorts|embed)\/([\w-]{6,})/.exec(u.pathname);
    if (m) return { kind: "youtube", id: m[1] };
  }
  if (host === "vimeo.com") {
    const m = /^\/(\d+)\/?$/.exec(u.pathname);
    if (m) return { kind: "vimeo", id: m[1] };
  }
  const path = u.pathname.toLowerCase();
  if (VIDEO_EXT.test(path)) return { kind: "video" };
  if (AUDIO_EXT.test(path)) return { kind: "audio" };
  return { kind: "bookmark" };
}

/**
 * The URL of a paragraph that IS just one bare URL: either a single GFM
 * autolink (text === href — a written `[title](url)` differs and opts out) or
 * plain typed text. Inline marks (`**…**` around the URL) also opt out.
 */
function loneEmbedUrl(p: HTMLElement): string | null {
  const text = stripZwsp(p.textContent ?? "").trim();
  if (!URL_RE.test(text)) return null;
  if (p.querySelector("*:not(br):not(a)")) return null;
  const anchors = p.querySelectorAll("a");
  if (anchors.length > 1) return null;
  if (anchors.length === 1) {
    const href = anchors[0].getAttribute("href") ?? "";
    if (stripZwsp(anchors[0].textContent ?? "").trim() !== href) return null;
    if (href !== text) return null; // prose around the link
  }
  return text;
}

function caretInside(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel) return false;
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    if (el.contains(r.startContainer) || el.contains(r.endContainer)) return true;
  }
  return false;
}

function renderFrame(el: HTMLElement, src: string, title: string): void {
  const iframe = document.createElement("iframe");
  iframe.className = "ew-embed__frame";
  iframe.src = src;
  iframe.title = title;
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("loading", "lazy");
  el.appendChild(iframe);
}

async function renderBookmark(
  el: HTMLElement,
  url: string,
  fetchMetadata: EmbedsOptions["fetchMetadata"],
): Promise<void> {
  let meta: EmbedMetadata = {};
  if (fetchMetadata) {
    try { meta = (await fetchMetadata(url)) ?? {}; } catch { meta = {}; }
  }
  const card = document.createElement("div");
  card.className = "ew-embed__card";
  if (meta.image) {
    const thumb = document.createElement("img");
    thumb.className = "ew-embed__card-thumb";
    thumb.src = meta.image;
    thumb.alt = "";
    card.appendChild(thumb);
  }
  const body = document.createElement("div");
  body.className = "ew-embed__card-body";
  const title = document.createElement("div");
  title.className = "ew-embed__card-title";
  title.textContent = meta.title || hostnameOf(url);
  body.appendChild(title);
  if (meta.description) {
    const desc = document.createElement("div");
    desc.className = "ew-embed__card-desc";
    desc.textContent = meta.description;
    body.appendChild(desc);
  }
  const line = document.createElement("div");
  line.className = "ew-embed__card-url";
  line.textContent = url;
  body.appendChild(line);
  card.appendChild(body);
  el.appendChild(card);
}

function openEmbedActions(figure: HTMLElement, ctx: EditorContext): void {
  const url = figure.getAttribute("data-source") ?? "";
  ctx.ui.popover({
    anchor: figure,
    placement: "below",
    render(el, close) {
      el.classList.add("ew-widget-editor");
      const input = document.createElement("input");
      input.className = "ew-widget-editor__source";
      input.value = url;
      input.readOnly = true;
      input.setAttribute("aria-label", "embed URL");
      el.appendChild(input);

      const actions = document.createElement("div");
      actions.className = "ew-popover__actions";
      const button = (label: string, cls: string, onClick: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = label;
        b.addEventListener("click", onClick);
        actions.appendChild(b);
      };
      button("Open", "ew-popover__btn ew-popover__btn--primary", () => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
      button("Turn into link", "ew-popover__btn", () => {
        close();
        ctx.transact(() => {
          const p = document.createElement("p");
          const a = document.createElement("a");
          a.setAttribute("href", url);
          // hostname as the text: text ≠ href, so the reconciliation pass
          // never re-embeds it — this IS the opt-out.
          a.textContent = hostnameOf(url);
          p.appendChild(a);
          figure.replaceWith(p);
          ctx.dom.placeCaretAtEnd(p);
        });
      });
      button("Remove", "ew-popover__btn is-danger", () => {
        close();
        ctx.transact(() => figure.remove());
      });
      el.appendChild(actions);
    },
  });
}

export function embeds(options: EmbedsOptions = {}): EdodoPlugin {
  const spec: WidgetSpec = {
    kind: "embed",
    busyText: "Loading embed…",
    edit: openEmbedActions,
    async render(source, el) {
      el.textContent = "";
      const c = classifyEmbedUrl(source);
      switch (c.kind) {
        case "youtube":
          renderFrame(el, `https://www.youtube-nocookie.com/embed/${c.id}`, "YouTube video");
          return;
        case "vimeo":
          renderFrame(el, `https://player.vimeo.com/video/${c.id}`, "Vimeo video");
          return;
        case "video": {
          const video = document.createElement("video");
          video.className = "ew-embed__media";
          video.controls = true;
          video.src = source;
          el.appendChild(video);
          return;
        }
        case "audio": {
          // Wrapped for padding (bare <audio> sits flush with the surface).
          const wrap = document.createElement("div");
          wrap.className = "ew-embed__card";
          const audio = document.createElement("audio");
          audio.className = "ew-embed__media";
          audio.controls = true;
          audio.src = source;
          wrap.appendChild(audio);
          el.appendChild(wrap);
          return;
        }
        case "bookmark":
          await renderBookmark(el, source, options.fetchMetadata);
      }
    },
  };

  /** Hydrate lone-URL paragraphs into widgets, then (re)render all widgets. */
  const reconcile = (ctx: EditorContext) => {
    const candidates: Array<{ p: HTMLElement; url: string }> = [];
    ctx.root.querySelectorAll<HTMLElement>(":scope > p").forEach((p) => {
      const url = loneEmbedUrl(p);
      if (url && !caretInside(p)) candidates.push({ p, url });
    });
    if (candidates.length) {
      ctx.transact(() => {
        for (const { p, url } of candidates) p.replaceWith(createWidget("embed", url));
      });
    }
    mountWidgets(ctx, spec);
  };

  return definePlugin({
    name: "embeds",

    // setup runs after the constructor value is loaded — one pass here covers
    // the initial document (setMarkdown-silent never fires `change`).
    setup(ctx) {
      reconcile(ctx);
      return wireWidgetEditing(ctx, spec);
    },

    on: {
      change: (_md, ctx) => reconcile(ctx),
    },

    markdown: {
      // No marked extension: a bare URL line is native GFM (autolinked on
      // parse). The turndown twins below write BOTH editor states back to it.
      turndown: (td) => {
        const embedSource = (node: Node): string | null =>
          node.nodeName === "FIGURE" && (node as HTMLElement).getAttribute("data-widget") === "embed"
            ? (node as HTMLElement).getAttribute("data-source") ?? ""
            : null;
        const replaceEmbed = (url: string) => (url ? `\n\n${url}\n\n` : "");
        td.addRule("embedWidget", {
          filter: (node) => embedSource(node) !== null,
          replacement: (_content, node) => replaceEmbed(embedSource(node)!),
        });
        // Turndown short-circuits "blank" nodes past all rules — and an embed
        // figure IS blank until its async render lands (a bookmark card
        // mid-fetch has no text). A save fired in that window must not lose
        // the embed, so shim THIS instance's blank rule for our figures.
        const rules = td.rules as unknown as {
          blankRule: { replacement: (content: string, node: Node, options: unknown) => string };
        };
        const blank = rules.blankRule.replacement;
        rules.blankRule.replacement = (content, node, options) => {
          const url = embedSource(node);
          return url !== null ? replaceEmbed(url) : blank(content, node, options);
        };
        // A paragraph that IS just one bare URL (autolinked or not-yet-
        // hydrated) serializes as the bare line — byte-stable with the widget.
        td.addRule("embedBareUrl", {
          filter: (node) => node.nodeName === "P" && loneEmbedUrl(node as HTMLElement) !== null,
          replacement: (_content, node) => `\n\n${loneEmbedUrl(node as HTMLElement)!}\n\n`,
        });
      },
    },
  });
}
