// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EdodoWriteEditor, Markdown } from "edodo-write/react";
import type { EdodoWrite } from "edodo-write";
import { highlight } from "edodo-write/plugins";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("<EdodoWriteEditor>", () => {
  it("mounts an editor with the initial value", async () => {
    let editor: EdodoWrite | null = null;
    await act(async () => {
      root.render(<EdodoWriteEditor value="# Hi" onReady={(e) => { editor = e; }} />);
    });
    expect(editor).not.toBeNull();
    expect(editor!.getMarkdown()).toBe("# Hi");
    expect(host.querySelector(".ew-content h1")?.textContent).toBe("Hi");
  });

  it("re-hydrates when the controlled value changes externally", async () => {
    let editor: EdodoWrite | null = null;
    const ui = (value: string) => (
      <EdodoWriteEditor value={value} onReady={(e) => { editor = e; }} />
    );
    await act(async () => root.render(ui("first")));
    await act(async () => root.render(ui("# second")));
    expect(editor!.getMarkdown()).toBe("# second");
  });

  it("does NOT clobber the editor when its own onChange value echoes back", async () => {
    let editor: EdodoWrite | null = null;
    let latest = "start";
    const handle = (md: string) => { latest = md; };
    const ui = () => (
      <EdodoWriteEditor value={latest} onChange={handle} onReady={(e) => { editor = e; }} />
    );
    await act(async () => root.render(ui()));
    // simulate an internal edit → change event → parent echoes value back
    await act(async () => {
      editor!.setMarkdown("edited by user");
      await new Promise((r) => setTimeout(r, 200)); // debounced change
    });
    expect(latest).toBe("edited by user");
    const htmlBefore = editor!.getHTML();
    await act(async () => root.render(ui()));
    expect(editor!.getHTML()).toBe(htmlBefore); // no re-hydration happened
  });

  it("passes plugins through to the editor", async () => {
    let editor: EdodoWrite | null = null;
    await act(async () => {
      root.render(
        <EdodoWriteEditor value="==lit==" plugins={[highlight()]} onReady={(e) => { editor = e; }} />,
      );
    });
    expect(editor!.getHTML()).toContain("<mark>lit</mark>");
    expect(editor!.getMarkdown()).toBe("==lit==");
  });

  it("destroys the editor (and its floating UI) on unmount", async () => {
    await act(async () => root.render(<EdodoWriteEditor value="bye" />));
    expect(document.querySelector(".ew-content")).not.toBeNull();
    await act(async () => root.unmount());
    expect(document.querySelector(".ew-content")).toBeNull();
    expect(document.querySelector(".ew-toolbar")).toBeNull();
    expect(document.querySelector(".ew-slash")).toBeNull();
    expect(document.querySelector(".ew-layer")).toBeNull();
  });
});

describe("<Markdown>", () => {
  it("renders sanitised markdown read-only", async () => {
    await act(async () => {
      root.render(<Markdown value={'# Title\n\n<script>alert(1)</script>ok'} />);
    });
    expect(host.querySelector("h1")?.textContent).toBe("Title");
    expect(host.innerHTML).not.toContain("<script");
    expect(host.querySelector(".ew-content--readonly")).not.toBeNull();
  });
});
