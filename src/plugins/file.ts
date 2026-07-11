/**
 * File / attachment — a stored `!file[name](url)` token ↔ a non-editable chip.
 *
 *   parse:      `!file[report.pdf](https://r2/x)`
 *               → <a class="ew-file" href="https://r2/x"
 *                    data-file-name="report.pdf" data-file-url="https://r2/x"
 *                    target="_blank" rel="noopener noreferrer"
 *                    contenteditable="false">📎 report.pdf</a>
 *   serialize:  that anchor → `!file[report.pdf](https://r2/x)`
 *
 * The name may be EMPTY — `!file[](https://r2/x)` is valid (a bare URL
 * attachment); the visible label then falls back to the URL. The stored token
 * is plain Markdown-adjacent text, so without the plugin it degrades to legible
 * literal text rather than a broken embed.
 *
 * An optional UNFURL sibling — `!unfurl[title](url)` → an `a.ew-unfurl` link
 * card — is handled by the same plugin (same grammar, different marker) so a
 * host can render rich link previews next to the raw attachment.
 *
 * The host owns storage: pass an `uploader` and the slash item / `uploadFile`
 * helper picks a file, uploads it, and inserts the resulting token. Nothing in
 * this file knows where bytes live.
 */

import { definePlugin, type EdodoPlugin, type EditorContext } from "../lib/index.js";
import { escapeAttr } from "./widget.js";

declare module "../core/types.js" {
  interface CommandPayloads {
    /** Insert a stored `!file[name](url)` chip at the caret. */
    insertFile: { name: string; url: string };
    /** Insert a stored `!unfurl[title](url)` link card at the caret. */
    insertUnfurl: { title: string; url: string };
  }
}

/** What a host uploader resolves with: the hosted URL (+ optional display name). */
export type FileUploadResult = string | { url: string; name?: string };
export type FileUploader = (file: File) => Promise<FileUploadResult>;

export interface FileOptions {
  /**
   * Store a picked file and resolve with its hosted URL (+ optional name).
   * Wired to the "File" slash item and the `uploadFile` command. When omitted
   * those affordances are inert — the `insertFile` command (host supplies the
   * URL) still works.
   */
  uploader?: FileUploader;
  /** `accept` attribute for the file picker. Default: any file. */
  accept?: string;
}

// Grammar: `!file[<name>](<url>)`, name may be empty, url is everything up to
// the closing paren. Anchored (^) — the inline lexer feeds us the remaining src.
const FILE_RE = /^!file\[([^\]]*)\]\(([^)]+)\)/;
const UNFURL_RE = /^!unfurl\[([^\]]*)\]\(([^)]+)\)/;

function fileChipHtml(name: string, url: string): string {
  const label = name || url;
  return (
    `<a class="ew-file" href="${escapeAttr(url)}"` +
    ` data-file-name="${escapeAttr(name)}" data-file-url="${escapeAttr(url)}"` +
    ` target="_blank" rel="noopener noreferrer" contenteditable="false">` +
    `\u{1F4CE} ${escapeAttr(label)}</a>`
  );
}

function unfurlChipHtml(title: string, url: string): string {
  const label = title || url;
  return (
    `<a class="ew-unfurl" href="${escapeAttr(url)}"` +
    ` data-unfurl-title="${escapeAttr(title)}" data-unfurl-url="${escapeAttr(url)}"` +
    ` target="_blank" rel="noopener noreferrer" contenteditable="false">` +
    `\u{1F517} ${escapeAttr(label)}</a>`
  );
}

/** Pick a file, upload it via the host uploader, and insert the token. */
function pickAndUpload(ctx: EditorContext, opts: FileOptions): void {
  if (!opts.uploader || typeof document === "undefined") return;
  const input = document.createElement("input");
  input.type = "file";
  if (opts.accept) input.accept = opts.accept;
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    void Promise.resolve(opts.uploader!(file)).then(
      (res) => {
        const url = typeof res === "string" ? res : res.url;
        const name = typeof res === "string" ? file.name : res.name ?? file.name;
        if (url) ctx.exec("insertFile", { name, url });
      },
      () => ctx.ui.notify("Upload failed"),
    );
  });
  input.click();
}

export function file(options: FileOptions = {}): EdodoPlugin {
  return definePlugin({
    name: "file",

    commands: {
      insertFile: {
        run: (ctx, payload: { name: string; url: string }) => {
          if (!payload?.url) return false;
          ctx.markdown.insert(`!file[${payload.name ?? ""}](${payload.url})`);
        },
      },
      insertUnfurl: {
        run: (ctx, payload: { title: string; url: string }) => {
          if (!payload?.url) return false;
          ctx.markdown.insert(`!unfurl[${payload.title ?? ""}](${payload.url})`);
        },
      },
    },

    slashItems: options.uploader
      ? [{
          id: "file",
          title: "File",
          hint: "Attach a file",
          keywords: ["file", "attachment", "attach", "upload", "document"],
          group: "Media",
          run: (ctx) => pickAndUpload(ctx, options),
        }]
      : [],

    // The parsed chips carry data-file-*/data-unfurl-*/contenteditable on <a>.
    sanitize: {
      attributes: {
        a: [
          "contenteditable",
          "data-file-name", "data-file-url",
          "data-unfurl-title", "data-unfurl-url",
        ],
      },
    },

    markdown: {
      marked: [{
        extensions: [
          {
            name: "file",
            level: "inline",
            start: (src: string) => src.indexOf("!file["),
            tokenizer(src: string) {
              const m = FILE_RE.exec(src);
              if (!m) return undefined;
              return { type: "file", raw: m[0], fileName: m[1], fileUrl: m[2] };
            },
            renderer(token) {
              return fileChipHtml(String(token.fileName), String(token.fileUrl));
            },
          },
          {
            name: "unfurl",
            level: "inline",
            start: (src: string) => src.indexOf("!unfurl["),
            tokenizer(src: string) {
              const m = UNFURL_RE.exec(src);
              if (!m) return undefined;
              return { type: "unfurl", raw: m[0], title: m[1], unfurlUrl: m[2] };
            },
            renderer(token) {
              return unfurlChipHtml(String(token.title), String(token.unfurlUrl));
            },
          },
        ],
      }],
      turndown: (td) => {
        td.addRule("file", {
          filter: (node) =>
            node.nodeName === "A" && (node as HTMLElement).classList.contains("ew-file"),
          replacement: (_content, node) => {
            const el = node as HTMLElement;
            const name = el.getAttribute("data-file-name") ?? "";
            const url = el.getAttribute("data-file-url") ?? el.getAttribute("href") ?? "";
            return `!file[${name}](${url})`;
          },
        });
        td.addRule("unfurl", {
          filter: (node) =>
            node.nodeName === "A" && (node as HTMLElement).classList.contains("ew-unfurl"),
          replacement: (_content, node) => {
            const el = node as HTMLElement;
            const title = el.getAttribute("data-unfurl-title") ?? "";
            const url = el.getAttribute("data-unfurl-url") ?? el.getAttribute("href") ?? "";
            return `!unfurl[${title}](${url})`;
          },
        });
      },
    },
  });
}
