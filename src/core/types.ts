/**
 * Shared types for the edodo-write core — including the public plugin surface.
 *
 * The editor is a thin, framework-free controller over a `contentEditable`
 * host. Markdown is the single source of truth: it is parsed to HTML on load
 * and serialised back to Markdown on every change. Nothing in this file (or
 * the pure `parse` / `serialize` / `sanitize` modules) touches React.
 *
 * ── Extensibility model ──────────────────────────────────────────────────────
 * Everything ABOVE the engine is pluggable through `EdodoPlugin`: commands,
 * input rules, keyboard shortcuts, slash-menu items, toolbar buttons,
 * block-menu items, and markdown pipeline extensions. The engine itself —
 * structural Enter/Backspace/Tab semantics, undo history, the clipboard
 * contract, the sanitizer's denial floor, and drag mechanics — is deliberately
 * NOT pluggable: those implement the contentEditable invariants whose
 * violation corrupts documents. Plugins can intercept (priority-ordered
 * keybindings run before the engine) but never remove them.
 */

import type { MarkedExtension } from "marked";
import type TurndownService from "turndown";
import type { SanitizeOptions } from "./sanitize.js";
import type { EdodoWrite } from "./editor.js";

// ── Commands ────────────────────────────────────────────────────────────────

/**
 * Command name → payload type. Built-ins are declared here; plugins add their
 * own via TypeScript module augmentation:
 *
 *   declare module "edodo-write" {
 *     interface CommandPayloads { highlight: void }
 *   }
 *
 * `void` means "no payload". Because this is an interface (not a closed
 * union), `editor.exec("bold")` stays fully typed while plugin commands are
 * first-class citizens of the same type.
 */
export interface CommandPayloads {
  bold: void;
  italic: void;
  strike: void;
  code: void;
  link: { href: string | null };
  clear: void;
  paragraph: void;
  heading1: void;
  heading2: void;
  heading3: void;
  heading4: void;
  heading5: void;
  heading6: void;
  bulletList: void;
  orderedList: void;
  taskList: void;
  blockquote: void;
  codeBlock: void;
  divider: void;
  image: { src: string; alt?: string };
  table: { rows?: number; cols?: number };
  insertText: { text: string };
}

/** Every declared command name (built-ins + augmented plugin commands). */
export type Command = keyof CommandPayloads & string;

/**
 * A command name for dynamic dispatch: autocompletes declared commands but
 * admits any string (plain-JS plugins lose nothing). Executing an unregistered
 * command returns `false` and warns in the console — it never throws.
 */
export type AnyCommand = Command | (string & {});

/** Typed payload tuple: required exactly when the payload isn't `void`. */
export type PayloadArgs<C extends AnyCommand> = C extends Command
  ? CommandPayloads[C] extends void
    ? []
    : [payload: CommandPayloads[C]]
  : [payload?: unknown];

/** A command implementation, registered by the core preset or a plugin. */
export interface CommandSpec<P = unknown> {
  /**
   * Perform the edit. Block structure MUST be built with manual DOM (never
   * `execCommand`, which is silently dropped inside `input` events — exactly
   * where input rules run). Runs inside a transaction: mutate and return; the
   * editor commits (normalize, history, change event) afterwards. Return
   * `false` to signal "did nothing here" (skips the commit).
   */
  run(ctx: EditorContext, payload: P): boolean | void;
  /** Is the format active at the selection? Drives toolbar/menu highlights. */
  isActive?(ctx: EditorContext): boolean;
}

// ── Input rules (type-to-format) ────────────────────────────────────────────

/**
 * Fires on `input` when the caret's block matches `within` (default: plain
 * paragraphs) and the text from block start to caret matches `trigger`.
 * The matched text is pre-normalized (NBSP → space, ZWSP stripped) — plugin
 * regexes never need to know those gotchas exist.
 */
export interface BlockInputRule {
  kind: "block";
  /** e.g. `/^#### $/` — anchored to the block start, trailing space included. */
  trigger: RegExp;
  /** Block tags the rule may fire in. Default: `["P"]`. */
  within?: string[];
  /**
   * A command name — the trigger text is auto-deleted (checkbox-safe) and the
   * caret re-anchored for you — or a function for full control (return `true`
   * if the document changed).
   */
  apply: AnyCommand | ((ctx: EditorContext, match: RegExpExecArray, block: HTMLElement) => boolean);
}

/**
 * Fires when typing completes an inline pattern (e.g. the closing `**`).
 * `trigger` must be `$`-anchored; match[0] is the exact span replaced and
 * match[1] the inner text. Never fires inside code blocks.
 */
export interface InlineInputRule {
  kind: "inline";
  /** e.g. `/==([^=\n]+)==$/` */
  trigger: RegExp;
  /**
   * Tag name to wrap match[1] in (the caret is parked outside the new mark
   * for you), or a node factory for exotic marks.
   */
  apply: string | ((match: RegExpExecArray) => Node);
}

export type InputRule = BlockInputRule | InlineInputRule;

// ── Keybindings ─────────────────────────────────────────────────────────────

/**
 * Key syntax: `[Mod-|Ctrl-|Alt-|Shift-]*Key` where `Mod` is ⌘ on macOS and
 * Ctrl elsewhere — e.g. `"Mod-b"`, `"Mod-Shift-7"`, `"Shift-Enter"`.
 * A binding is either a command name or a handler returning `true` when it
 * consumed the event. Plugin bindings (priority 100 by default) run before
 * the core preset (priority 0); the structural Enter/Backspace/Tab engine
 * runs last and cannot be unregistered.
 */
export type KeyBinding =
  | AnyCommand
  | ((ctx: EditorContext, event: KeyboardEvent) => boolean);

// ── Menu / toolbar contributions ────────────────────────────────────────────

export interface SlashItem {
  /** Stable unique id (used for de-dupe, tests, and a11y). */
  id: string;
  title: string;
  hint?: string;
  /** Extra filter keywords besides the title. */
  keywords?: string[];
  /** Section header the item is grouped under. Default: "Blocks". */
  group?: string;
  /** Hide the item contextually. */
  when?(ctx: EditorContext): boolean;
  /** Either a command to execute… */
  command?: AnyCommand;
  payload?: unknown;
  /** …or arbitrary behavior. Runs AFTER the `/query` text was removed. */
  run?(ctx: EditorContext): void;
}

export interface ToolbarItem {
  /** Stable unique id. Also exposed as `data-cmd` on the button. */
  id: string;
  /** Button text (kept plain — never interpolated as HTML). */
  label: string;
  /** Tooltip + aria-label. */
  title: string;
  command?: AnyCommand;
  payload?: unknown;
  run?(ctx: EditorContext): void;
  /** Highlight state; defaults to the command's `isActive`. */
  isActive?(info: SelectionInfo, ctx: EditorContext): boolean;
}

export interface BlockMenuItem {
  /** Stable unique id. */
  id: string;
  title: string;
  /** Section header ("Turn into", "Actions"…). Default: "Actions". */
  group?: string;
  /** Styled as destructive. */
  danger?: boolean;
  when?(ctx: EditorContext, block: HTMLElement): boolean;
  /**
   * The action. `block` is the block the menu was opened on — the caret is
   * already placed inside it, so `ctx.exec("heading1")` turns THIS block.
   */
  run(ctx: EditorContext, block: HTMLElement): void;
}

// ── Markdown pipeline extensions ────────────────────────────────────────────

/**
 * Paired parse/serialize extensions. The formats are marked's and turndown's
 * own — we deliberately do not wrap them. THE CONTRACT: a parse extension
 * without its serialize twin is a round-trip bug by construction; ship both,
 * and prove stability with `assertRoundTrip` from `edodo-write/testing`.
 */
export interface MarkdownExtensionSpec {
  /** Passed to this editor's `new Marked().use(…)`. */
  marked?: MarkedExtension[];
  /** Receives this editor's TurndownService — `addRule` / `keep` / `remove`. */
  turndown?(td: TurndownService): void;
}

// ── The plugin ──────────────────────────────────────────────────────────────

export interface EdodoPlugin {
  /** Unique kebab-case name. Duplicate names/ids throw at construction. */
  name: string;
  /**
   * Ordering weight for input rules and keybindings — higher runs earlier.
   * The core preset registers at 0; plugins default to 100, so a plugin can
   * shadow `Mod-b` (the structural key engine still runs last regardless).
   */
  priority?: number;
  /**
   * Command implementations. Declare the names in `CommandPayloads` via
   * module augmentation for typed `exec` calls; registration itself works
   * with any string (validated at runtime, collisions throw).
   */
  commands?: { [name: string]: CommandSpec<any> };
  inputRules?: InputRule[];
  keymap?: Record<string, KeyBinding>;
  slashItems?: SlashItem[];
  toolbarItems?: ToolbarItem[];
  blockMenuItems?: BlockMenuItem[];
  markdown?: MarkdownExtensionSpec;
  /**
   * Widen the sanitizer allow-list so this plugin's parsed HTML survives.
   * Additive only — the denial floor (scripts, iframes, event handlers,
   * script-scheme URLs) is not negotiable.
   */
  sanitize?: SanitizeOptions;
  /**
   * Imperative escape hatch: runs once after mount. Return a cleanup
   * function; it is called on `destroy()`. Wrap any DOM mutations your own
   * listeners make in `ctx.transact()` so they become one undo step + one
   * change event.
   */
  setup?(ctx: EditorContext): void | (() => void);
  /** Declarative lifecycle hooks (sugar over `editor.on`). */
  on?: Partial<{
    change: (markdown: string, ctx: EditorContext) => void;
    selection: (info: SelectionInfo | null, ctx: EditorContext) => void;
    focus: (ctx: EditorContext) => void;
    blur: (ctx: EditorContext) => void;
    destroy: (ctx: EditorContext) => void;
  }>;
}

// ── The context handed to every plugin entry point ──────────────────────────

/**
 * The blessed, caret-safe DOM toolbox — bound to this editor's root (no root
 * parameter to pass wrong on multi-editor pages). These helpers encode the
 * hard-won contentEditable invariants; plugins must use them rather than
 * reimplement caret logic.
 */
export interface EditorDom {
  currentBlock(): HTMLElement | null;
  currentListItem(): HTMLElement | null;
  blockKindOf(el: HTMLElement | null): BlockKind;
  /** Text from the block start to the caret (NBSP-normalized, ZWSP-free). */
  textBeforeCaret(block: HTMLElement): string;
  isAtBlockStart(block: HTMLElement): boolean;
  /** Delete leading characters, anchored to the first TEXT node (checkbox-safe). */
  deleteLeadingChars(block: HTMLElement, n: number): void;
  /** Give an empty element a placeable caret (`<br>` normalization). */
  ensureNotEmpty(el: HTMLElement): void;
  placeCaretAtStart(el: HTMLElement): void;
  placeCaretAtEnd(el: HTMLElement): void;
  placeCaretAfter(node: Node): void;
  /** Toggle an inline wrapper tag (the generalized inline-code machinery). */
  toggleInlineTag(tag: string): void;
  isInlineTagActive(tag: string): boolean;
  /** Viewport rect of the current selection (for positioning UI). */
  selectionRect(): DOMRect | null;
}

/** Editor-owned floating-UI primitives — see `ui.ts`. */
export interface EditorUI {
  /**
   * An anchored floating panel. The editor handles: body portal, viewport
   * clamping, keeping the text selection alive while the popover has focus,
   * Escape/outside-click dismissal, and teardown on destroy()/readOnly.
   */
  popover(opts: PopoverOptions): PopoverHandle;
  /** A keyboard-navigable list menu built on `popover`. */
  menu(opts: MenuOptions): PopoverHandle;
  /** A transient toast ("Copied as Markdown"). */
  notify(message: string): void;
}

export interface PopoverOptions {
  anchor: HTMLElement | DOMRect;
  placement?: "above" | "below";
  /** Build the content with real DOM. Return an optional cleanup. */
  render(container: HTMLElement, close: () => void): void | (() => void);
  onClose?(): void;
}

export interface MenuOptions {
  anchor: HTMLElement | DOMRect;
  items: Array<{
    id: string;
    title: string;
    hint?: string;
    group?: string;
    danger?: boolean;
    disabled?: boolean;
    action(): void;
  }>;
  onClose?(): void;
}

export interface PopoverHandle {
  close(): void;
  readonly el: HTMLElement;
}

/** Everything a command / rule / keybinding / menu item may touch. */
export interface EditorContext {
  readonly editor: EdodoWrite;
  /** The contentEditable root (`.ew-content`). */
  readonly root: HTMLElement;
  /** Execute a registered command. Returns false when unregistered/refused. */
  exec<C extends AnyCommand>(cmd: C, ...args: PayloadArgs<C>): boolean;
  /** Batch DOM mutations into ONE undo step + ONE change event. Re-entrant. */
  transact<T>(fn: () => T): T;
  /** THIS editor's markdown pipeline (with all plugin extensions applied). */
  markdown: {
    parse(md: string): string;
    serialize(html: string): string;
    /** Parse Markdown and insert it at the caret as real blocks. */
    insert(md: string): void;
  };
  dom: EditorDom;
  ui: EditorUI;
}

// ── Events / selection info (public, pre-existing) ──────────────────────────

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
  /** `isActive()` of every registered command that defines one. Open-world. */
  marks: Readonly<Record<string, boolean>>;
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

// ── Image uploads ───────────────────────────────────────────────────────────

/** What an image uploader resolves with: the hosted URL, or `{ src, alt? }`. */
export type ImageUploadResult = string | { src: string; alt?: string };

/**
 * Handles an image file arriving via clipboard paste, drag-and-drop, or the
 * image popover's file picker. Upload the file to wherever your application
 * stores images and resolve with its public URL — that URL is what lands in
 * the Markdown (`![alt](src)`). Reject/throw to signal failure (the pending
 * placeholder is removed and a toast is shown).
 *
 * When no uploader is configured the editor falls back to embedding the image
 * as a `data:` URL — fully self-contained Markdown, at the cost of document
 * size. See docs/IMAGE_HOSTING.md for wiring real hosting (S3/R2 endpoints,
 * Supabase, browser-local stores) and the fallback's limits.
 */
export type ImageUploader = (file: File, editor: EdodoWrite) => Promise<ImageUploadResult>;

// ── Options ─────────────────────────────────────────────────────────────────

export interface EditorOptions {
  /** Initial Markdown value. */
  value?: string;
  /** Placeholder shown when the document is empty. */
  placeholder?: string;
  /** Focus the editor after mounting. */
  autofocus?: boolean;
  /** Render-only mode — no editing, no toolbars. Toggleable at runtime. */
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
  /**
   * Plugins, applied in order after the core preset. Resolved once at
   * construction — to change the set, create a new editor.
   */
  plugins?: EdodoPlugin[];
  /**
   * Feature keys (command names / item ids) to REMOVE from the core preset,
   * e.g. `["taskList", "codeBlock"]`.
   */
  exclude?: string[];
  /**
   * Store images arriving via paste / drop / the image popover's file picker.
   * Omitted: images are embedded as `data:` URLs in the Markdown (small docs
   * only — see docs/IMAGE_HOSTING.md).
   */
  uploadImage?: ImageUploader;
}

export type { SanitizeOptions };
