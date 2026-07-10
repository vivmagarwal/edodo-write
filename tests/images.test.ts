import { describe, it, expect, vi } from "vitest";
import { EdodoWrite } from "@core/editor";
import { dataUrlUploader, isImageFile, defaultAlt, DATA_URL_MAX_BYTES } from "@core/image-upload";
import { htmlToMarkdown } from "@core/serialize";

const PNG_BYTES = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (c) => c.charCodeAt(0));

function pngFile(name = "photo.png"): File {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

function mount(options: ConstructorParameters<typeof EdodoWrite>[1] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EdodoWrite(host, options);
}

describe("insertImages", () => {
  it("uploads through the configured uploader and writes ![alt](url)", async () => {
    const uploadImage = vi.fn(async (file: File) => `https://cdn.test/${file.name}`);
    const ed = mount({ value: "before", uploadImage });
    await ed.insertImages([pngFile("cat.png")]);
    expect(uploadImage).toHaveBeenCalledOnce();
    expect(ed.getMarkdown()).toBe("before\n\n![cat](https://cdn.test/cat.png)");
    ed.destroy();
  });

  it("accepts an { src, alt } result and honors the returned alt", async () => {
    const ed = mount({ uploadImage: async () => ({ src: "https://cdn.test/x.png", alt: "described" }) });
    await ed.insertImages([pngFile()]);
    expect(ed.getMarkdown()).toBe("![described](https://cdn.test/x.png)");
    ed.destroy();
  });

  it("an explicit alt option overrides the filename default", async () => {
    const ed = mount({ uploadImage: async () => "https://cdn.test/y.png" });
    await ed.insertImages([pngFile("IMG_4321.png")], { alt: "sunset over the bay" });
    expect(ed.getMarkdown()).toBe("![sunset over the bay](https://cdn.test/y.png)");
    ed.destroy();
  });

  it("inserts multiple files in order", async () => {
    const ed = mount({ uploadImage: async (f: File) => `https://cdn.test/${f.name}` });
    await ed.insertImages([pngFile("one.png"), pngFile("two.png")]);
    expect(ed.getMarkdown()).toBe("![one](https://cdn.test/one.png)\n\n![two](https://cdn.test/two.png)");
    ed.destroy();
  });

  it("PENDING uploads are excluded from getMarkdown until they resolve", async () => {
    let release!: (url: string) => void;
    const gate = new Promise<string>((r) => { release = r; });
    const ed = mount({ value: "text", uploadImage: () => gate });
    const done = ed.insertImages([pngFile()]);
    // mid-upload: placeholder in the DOM, absent from the contract
    expect(ed.content.querySelector("img[data-uploading]")).not.toBeNull();
    expect(ed.getMarkdown()).toBe("text");
    release("https://cdn.test/late.png");
    await done;
    expect(ed.getMarkdown()).toBe("text\n\n![photo](https://cdn.test/late.png)");
    expect(ed.content.querySelector("img[data-uploading]")).toBeNull();
    ed.destroy();
  });

  it("a failed upload removes the placeholder and leaves the doc unchanged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ed = mount({ value: "keep me", uploadImage: async () => { throw new Error("nope"); } });
    await ed.insertImages([pngFile()]);
    expect(ed.getMarkdown()).toBe("keep me");
    expect(ed.content.querySelector("img")).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    ed.destroy();
  });

  it("deleting the placeholder mid-upload cancels that image", async () => {
    let release!: (url: string) => void;
    const gate = new Promise<string>((r) => { release = r; });
    const ed = mount({ value: "text", uploadImage: () => gate });
    const done = ed.insertImages([pngFile()]);
    ed.content.querySelector("img[data-uploading]")!.closest("p")!.remove();
    release("https://cdn.test/orphan.png");
    await done;
    expect(ed.getMarkdown()).toBe("text");
    ed.destroy();
  });

  it("falls back to a data: URL when no uploader is configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const ed = mount();
    await ed.insertImages([pngFile("tiny.png")]);
    const md = ed.getMarkdown();
    expect(md).toMatch(/^!\[tiny\]\(data:image\/png;base64,/);
    expect(info).toHaveBeenCalledOnce(); // one advisory, once per editor
    await ed.insertImages([pngFile("more.png")]);
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
    ed.destroy();
  });

  it("the data-URL markdown round-trips through setMarkdown", async () => {
    const ed = mount();
    vi.spyOn(console, "info").mockImplementation(() => {});
    await ed.insertImages([pngFile()]);
    const md = ed.getMarkdown();
    ed.setMarkdown(md, { silent: true });
    expect(ed.getMarkdown()).toBe(md);
    expect(ed.content.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
    ed.destroy();
  });

  it("ignores non-image files and read-only editors", async () => {
    const uploadImage = vi.fn(async () => "https://cdn.test/x.png");
    const ed = mount({ value: "doc", uploadImage });
    await ed.insertImages([new File(["hi"], "notes.txt", { type: "text/plain" })]);
    expect(uploadImage).not.toHaveBeenCalled();
    ed.setReadOnly(true);
    await ed.insertImages([pngFile()]);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(ed.getMarkdown()).toBe("doc");
    ed.destroy();
  });
});

describe("image paste interception", () => {
  function pasteEvent(files: File[], text = ""): ClipboardEvent {
    const e = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e, "clipboardData", {
      value: {
        files,
        getData: (type: string) => (type === "text/plain" ? text : ""),
      },
    });
    return e;
  }

  it("image files on the clipboard win over text flavors", async () => {
    const uploadImage = vi.fn(async (f: File) => `https://cdn.test/${f.name}`);
    const ed = mount({ uploadImage });
    ed.content.dispatchEvent(pasteEvent([pngFile("shot.png")], "should be ignored"));
    await vi.waitFor(() => expect(ed.getMarkdown()).toContain("cdn.test/shot.png"));
    expect(ed.getMarkdown()).not.toContain("should be ignored");
    ed.destroy();
  });

  it("a text-only paste still flows through the markdown pipeline", () => {
    const ed = mount();
    ed.content.dispatchEvent(pasteEvent([], "## pasted heading"));
    expect(ed.getMarkdown()).toBe("## pasted heading");
    ed.destroy();
  });
});

describe("data-url uploader guardrails", () => {
  it("isImageFile / defaultAlt", () => {
    expect(isImageFile(pngFile())).toBe(true);
    expect(isImageFile(new File([""], "a.txt", { type: "text/plain" }))).toBe(false);
    expect(defaultAlt(pngFile("holiday.photo.jpeg"))).toBe("holiday.photo");
  });

  it("rejects files beyond the embed ceiling with a helpful error", async () => {
    const big = new File([new Uint8Array(DATA_URL_MAX_BYTES + 1)], "huge.png", { type: "image/png" });
    await expect(dataUrlUploader(big)).rejects.toThrow(/too large to embed/);
  });
});

describe("pending images and the serializer", () => {
  it("img[data-uploading] serializes to nothing", () => {
    expect(htmlToMarkdown('<p>before</p><p><img src="blob:x" alt="a" data-uploading=""></p><p>after</p>'))
      .toBe("before\n\nafter");
  });

  it("the same img without the marker serializes normally", () => {
    expect(htmlToMarkdown('<p><img src="https://x/a.png" alt="a"></p>')).toBe("![a](https://x/a.png)");
  });
});
