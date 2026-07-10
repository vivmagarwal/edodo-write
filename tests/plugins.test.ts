import { describe, it, expect, vi } from "vitest";
import { EdodoWrite } from "@core/editor";
import { definePlugin, resolvePlugins, parseKeyString, matchesKey } from "@core/plugin";
import { corePreset } from "@core/preset";
import { highlight } from "../src/plugins/highlight";
import { callout } from "../src/plugins/callout";
import { createCodec, assertRoundTrip } from "../src/lib/testing";

function mount(options: ConstructorParameters<typeof EdodoWrite>[1] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, options);
}

describe("plugin resolution", () => {
  it("throws on duplicate plugin names", () => {
    const a = definePlugin({ name: "dupe" });
    const b = definePlugin({ name: "dupe" });
    expect(() => resolvePlugins([a, b])).toThrow(/duplicate plugin name "dupe"/);
  });

  it("throws when two plugins register the same command", () => {
    const a = definePlugin({ name: "a", commands: { thing: { run: () => {} } } });
    const b = definePlugin({ name: "b", commands: { thing: { run: () => {} } } });
    expect(() => resolvePlugins([a, b])).toThrow(/command "thing" registered by both "a" and "b"/);
  });

  it("throws when a plugin collides with a built-in command", () => {
    const rogue = definePlugin({ name: "rogue", commands: { bold: { run: () => {} } } });
    expect(() => resolvePlugins([corePreset(), rogue])).toThrow(/bold/);
  });

  it("throws on duplicate slash-item ids", () => {
    const a = definePlugin({ name: "a", slashItems: [{ id: "x", title: "X", run: () => {} }] });
    const b = definePlugin({ name: "b", slashItems: [{ id: "x", title: "X", run: () => {} }] });
    expect(() => resolvePlugins([a, b])).toThrow(/slash item "x"/);
  });

  it("definePlugin validates the name and key strings upfront", () => {
    expect(() => definePlugin({ name: "Bad Name!" })).toThrow(/kebab-case/);
    expect(() => definePlugin({ name: "ok", keymap: { "Mod-Fnord-x": "bold" } })).toThrow(/unknown modifier/);
  });

  it("orders keymap entries by priority desc (plugins beat built-ins)", () => {
    const shadow = definePlugin({ name: "shadow", keymap: { "Mod-b": () => true } });
    const reg = resolvePlugins([corePreset(), shadow]);
    const modB = reg.keymap.filter((k) => k.descriptor.key === "b" && k.descriptor.mod);
    expect(modB[0].plugin).toBe("shadow");
    expect(modB[1].plugin).toBe("core");
  });

  it("exclude removes core-preset features but not plugin ones", () => {
    const reg = resolvePlugins([corePreset()], ["taskList"]);
    expect(reg.commands.has("taskList")).toBe(false);
    expect(reg.slashItems.find((i) => i.id === "taskList")).toBeUndefined();
    expect(reg.blockRules.find((r) => r.apply === "taskList")).toBeUndefined();
    expect(reg.commands.has("bold")).toBe(true);
  });
});

describe("key string matching", () => {
  it("parses modifiers and matches events", () => {
    const d = parseKeyString("Mod-Shift-8", "test");
    expect(matchesKey(d, new KeyboardEvent("keydown", { key: "8", metaKey: true, shiftKey: true }))).toBe(true);
    // Shift+8 reports "*" on US layouts — the code fallback must match.
    expect(matchesKey(d, new KeyboardEvent("keydown", { key: "*", code: "Digit8", metaKey: true, shiftKey: true }))).toBe(true);
    expect(matchesKey(d, new KeyboardEvent("keydown", { key: "8", metaKey: true }))).toBe(false);
    expect(matchesKey(d, new KeyboardEvent("keydown", { key: "8", shiftKey: true }))).toBe(false);
  });
});

describe("plugins in a live editor", () => {
  it("a plugin command executes through editor.exec", () => {
    const ran = vi.fn();
    const editor = mount({ plugins: [definePlugin({ name: "t", commands: { boom: { run: ran } } })] });
    expect(editor.exec("boom" as string)).toBe(true);
    expect(ran).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("an unknown command returns false and warns instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = mount();
    expect(editor.exec("nope" as string)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    editor.destroy();
  });

  it("a throwing plugin command is isolated (logged, editor keeps working)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const editor = mount({
      value: "hello",
      plugins: [definePlugin({ name: "t", commands: { boom: { run: () => { throw new Error("kaboom"); } } } })],
    });
    editor.exec("boom" as string);
    expect(error).toHaveBeenCalled();
    expect(editor.getMarkdown()).toBe("hello"); // editor still alive
    error.mockRestore();
    editor.destroy();
  });

  it("setup runs after mount; its cleanup and on.destroy run on destroy", () => {
    const order: string[] = [];
    const editor = mount({
      plugins: [definePlugin({
        name: "t",
        setup: () => { order.push("setup"); return () => order.push("cleanup"); },
        on: { destroy: () => order.push("destroy") },
      })],
    });
    expect(order).toEqual(["setup"]);
    editor.destroy();
    expect(order).toEqual(["setup", "cleanup", "destroy"]);
  });

  it("two editors with different plugins do not share pipelines", () => {
    const a = mount({ value: "==hi==", plugins: [highlight()] });
    const b = mount({ value: "==hi==" });
    expect(a.getHTML()).toContain("<mark>");
    expect(b.getHTML()).not.toContain("<mark>");
    a.destroy();
    b.destroy();
  });

  it("exclude removes a feature from a live editor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = mount({ exclude: ["taskList"] });
    expect(editor.exec("taskList")).toBe(false);
    warn.mockRestore();
    editor.destroy();
  });
});

describe("first-party plugin round-trips (the paired-extension contract)", () => {
  it("highlight: ==text== survives byte-for-byte", () => {
    const codec = createCodec([highlight()]);
    assertRoundTrip(codec, "some ==highlighted== words");
    expect(codec.parse("==hi==")).toContain("<mark>hi</mark>");
    expect(codec.serialize("<p><mark>hi</mark></p>")).toBe("==hi==");
  });

  it("callout: GitHub alert syntax survives byte-for-byte", () => {
    const codec = createCodec([callout()]);
    const md = "> [!NOTE]\n> Useful information.";
    assertRoundTrip(codec, md);
    const html = codec.parse(md);
    expect(html).toContain('data-callout="note"');
    expect(html).not.toContain("[!NOTE]");
  });

  it("callout degrades to a plain blockquote without the plugin", () => {
    const codec = createCodec([]);
    const html = codec.parse("> [!NOTE]\n> Useful information.");
    expect(html).toContain("<blockquote>");
    // The marker text is preserved (no data loss), just not decorated.
    expect(html).toContain("[!NOTE]");
  });

  it("core markdown without plugins is unaffected by plugin codecs existing", () => {
    const withPlugins = createCodec([highlight(), callout()]);
    const plain = createCodec([]);
    const md = "# Title\n\n- [x] task\n\n> quote";
    expect(withPlugins.serialize(withPlugins.parse(md))).toBe(md);
    expect(plain.serialize(plain.parse(md))).toBe(md);
  });
});
