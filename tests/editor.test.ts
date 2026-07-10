import { describe, it, expect } from "vitest";
import { EdodoWrite } from "@core/editor";

function mount(value = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new EdodoWrite(host, { value });
  return { host, editor };
}

describe("EdodoWrite lifecycle", () => {
  it("hydrates from Markdown and reads it back", () => {
    const { editor } = mount("# Title\n\nHello **world**");
    expect(editor.getHTML()).toContain("<h1>Title</h1>");
    expect(editor.getMarkdown()).toBe("# Title\n\nHello **world**");
    editor.destroy();
  });

  it("reports empty state and placeholder class", () => {
    const { editor } = mount("");
    expect(editor.isEmpty()).toBe(true);
    expect(editor.content.classList.contains("ew-content--empty")).toBe(true);
    editor.setMarkdown("not empty", { silent: true });
    expect(editor.isEmpty()).toBe(false);
    editor.destroy();
  });

  it("setMarkdown replaces the document", () => {
    const { editor } = mount("# One");
    editor.setMarkdown("# Two", { silent: true });
    expect(editor.getMarkdown()).toBe("# Two");
    editor.destroy();
  });

  it("emits a debounced change event", async () => {
    const { editor } = mount("# One");
    let got = "";
    editor.on("change", (md) => { got = md; });
    editor.setMarkdown("# Two"); // not silent → schedules change
    await new Promise((r) => setTimeout(r, 160));
    expect(got).toBe("# Two");
    editor.destroy();
  });

  it("off() unsubscribes", async () => {
    const { editor } = mount("x");
    let count = 0;
    const handler = () => { count += 1; };
    editor.on("change", handler);
    editor.off("change", handler);
    editor.setMarkdown("y");
    await new Promise((r) => setTimeout(r, 160));
    expect(count).toBe(0);
    editor.destroy();
  });

  it("destroy tears down the DOM and floating UI", () => {
    const { host, editor } = mount("hi");
    editor.destroy();
    expect(host.querySelector(".ew-content")).toBeNull();
    expect(document.querySelector(".ew-toolbar")).toBeNull();
    expect(document.querySelector(".ew-slash")).toBeNull();
  });

  it("read-only editors are not editable", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new EdodoWrite(host, { value: "# ro", readOnly: true });
    expect(editor.content.getAttribute("contenteditable")).toBe("false");
    editor.destroy();
  });
});
