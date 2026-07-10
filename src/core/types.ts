/**
 * Shared types for the edodo-write core.
 *
 * The editor is a thin, framework-free controller over a `contentEditable`
 * host. Markdown is the single source of truth: it is parsed to HTML on load
 * and serialised back to Markdown on every change. Nothing in this file (or
 * the pure `parse` / `serialize` / `sanitize` modules) touches React.
 */

/** A formatting command the editor knows how to apply. */
export type Command =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "clear"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "divider";

/** Events the editor emits. Subscribe with `editor.on(event, handler)`. */
export interface EditorEvents {
  /** Fired (debounced) whenever the Markdown value changes. */
  change: (markdown: string) => void;
  /** Fired when the selection changes; `null` when it leaves the editor. */
  selection: (info: SelectionInfo | null) => void;
  focus: () => void;
  blur: () => void;
}

export type EditorEventName = keyof EditorEvents;

/** Which inline/block formats are active at the current selection. */
export interface SelectionInfo {
  empty: boolean;
  collapsed: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  block: BlockKind;
  /** Bounding rect of the selection in viewport coords (for toolbars). */
  rect: DOMRect | null;
}

export type BlockKind =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "other";

export interface EditorOptions {
  /** Initial Markdown value. */
  value?: string;
  /** Placeholder shown when the document is empty. */
  placeholder?: string;
  /** Focus the editor after mounting. */
  autofocus?: boolean;
  /** Render-only mode — no editing, no toolbars. */
  readOnly?: boolean;
  /** Show the floating selection toolbar (Medium-style). Default: true. */
  toolbar?: boolean;
  /** Enable the `/` slash command menu (Notion-style). Default: true. */
  slashMenu?: boolean;
  /** Native browser spellcheck. Default: true. */
  spellcheck?: boolean;
  /** Extra class name(s) applied to the editor host. */
  className?: string;
  /** ARIA label for the editable region. */
  ariaLabel?: string;
  /** Convenience: `onChange` is registered as a `change` listener. */
  onChange?: (markdown: string) => void;
}
