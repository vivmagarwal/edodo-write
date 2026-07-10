/**
 * `edodo-write/react` — a thin React wrapper over the framework-free editor.
 *
 *   import { EdodoWriteEditor, Markdown } from "edodo-write/react";
 *   import "edodo-write/styles.css";
 *
 *   <EdodoWriteEditor value={md} onChange={setMd} placeholder="Write…" />
 *   <Markdown value={md} />   // read-only render
 *
 * React is a peer dependency; the core entry never imports it.
 */

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { EdodoWrite } from "../core/editor.js";
import type { EditorOptions, SelectionInfo } from "../core/types.js";
import { parseMarkdown } from "../core/parse.js";

export interface EdodoWriteEditorProps
  extends Omit<EditorOptions, "value" | "onChange" | "className"> {
  /** Markdown value. Treated as "initial + controlled": external changes that
   *  differ from the last emitted value re-hydrate the editor. */
  value?: string;
  onChange?: (markdown: string) => void;
  onSelection?: (info: SelectionInfo | null) => void;
  /** Imperative handle to the underlying editor, once mounted. */
  onReady?: (editor: EdodoWrite) => void;
  className?: string;
  style?: CSSProperties;
}

export function EdodoWriteEditor({
  value = "",
  onChange,
  onSelection,
  onReady,
  className,
  style,
  ...opts
}: EdodoWriteEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EdodoWrite | null>(null);
  const lastValueRef = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelection);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelection;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = new EdodoWrite(host, { ...opts, value });
    editorRef.current = editor;
    lastValueRef.current = value;

    const offChange = editor.on("change", (md) => {
      lastValueRef.current = md;
      onChangeRef.current?.(md);
    });
    const offSelection = editor.on("selection", (info) => onSelectionRef.current?.(info));
    onReady?.(editor);

    return () => {
      offChange();
      offSelection();
      editor.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controlled-value sync: only re-hydrate when the incoming value differs from
  // what the editor last emitted, so we never clobber the caret while typing.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      editor.setMarkdown(value, { silent: true });
    }
  }, [value]);

  return <div ref={hostRef} className={className} style={style} />;
}

export interface MarkdownProps {
  value?: string;
  className?: string;
  style?: CSSProperties;
}

/** Read-only Markdown renderer sharing the editor's stylesheet. */
export function Markdown({ value = "", className, style }: MarkdownProps) {
  const html = parseMarkdown(value);
  return (
    <div className={className ? `ew ${className}` : "ew"} style={style}>
      <div className="ew-content ew-content--readonly" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export { EdodoWrite } from "../core/editor.js";
export type { EditorOptions, SelectionInfo } from "../core/types.js";
