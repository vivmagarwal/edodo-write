# Image hosting

The editor never stores image bytes. An image in the document is exactly what
it is in Markdown — `![alt](url)` — and the `uploadImage` option decides what
that URL is. You hand the editor a function that stores a `File` somewhere and
resolves with its URL; the editor handles everything around it (placeholders,
ordering, cancellation, failure).

## The mental model

Three ingestion paths, one funnel:

1. **Clipboard paste** — a screenshot or a copied image file. Image files win
   over text flavours on the same clipboard (Notion behaviour — and uploading
   your own copy beats hotlinking whatever URL rode along in the HTML
   flavour).
2. **Drag-and-drop** — image files dropped onto the document are inserted at
   the drop point (the caret is placed under the pointer first).
3. **The `/image` popover** — the **Upload…** button opens a file picker
   (multiple files, `image/*` only; the alt field applies to the picked
   files). The URL field beside it inserts a URL directly, with no upload.

All three call `editor.insertImages(files)` — which is public, so your own
file picker or API can use the same path — and every file flows through the
same `uploadImage`. Whatever URL comes back is what lands in the Markdown; the
document's value never contains anything else.

## The uploader contract

```ts no-run
type ImageUploader = (file: File, editor: EdodoWrite) =>
  Promise<string | { src: string; alt?: string }>;
```

- Resolve with a **string** — the hosted URL — or with `{ src, alt? }` when
  the upload also produced better alt text (a returned `alt` overrides the
  default).
- Alt text defaults to the filename without its extension (`IMG_4321.png` →
  `IMG_4321`); the popover's alt field or `insertImages(files, { alt })`
  override that default.
- **Throw (or reject) to signal failure.** The editor removes the pending
  placeholder, shows an "Image upload failed" toast, logs the error via
  `console.error`, and leaves the document exactly as it was. Resolving
  without a `src` counts as a failure too.

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

const editor = new EdodoWrite(host, {
  value: "Trip report",
  // A stub uploader: pretend the bytes went to a CDN.
  uploadImage: async (file) => `https://cdn.example.com/${file.name}`,
});

const file = new File([new Uint8Array([1, 2, 3])], "sunrise.png", { type: "image/png" });
await editor.insertImages([file]); // resolves when the upload settles

// The uploader's URL — never the bytes — is what lands in the Markdown,
// with the filename (sans extension) as the default alt text.
assert.equal(
  editor.getMarkdown(),
  "Trip report\n\n![sunrise](https://cdn.example.com/sunrise.png)",
);
editor.destroy();
```

## While an upload is in flight

Each image renders immediately as a pending placeholder (`img[data-uploading]`
with a local `blob:` preview) — but it does **not** exist in the document's
value yet:

- **`getMarkdown()` excludes pending images.** A serializer rule skips
  `img[data-uploading]`, so a `change` event or autosave that fires mid-upload
  can never persist a `blob:` preview URL — which would be meaningless outside
  the current page session. The image joins the Markdown only once a real URL
  exists.
- **Delete to cancel.** Removing the placeholder while its upload is in
  flight cancels that image — the URL the uploader later resolves with is
  discarded.
- **Failure cleans up.** A rejected upload removes the placeholder, shows the
  "Image upload failed" toast, and leaves the document unchanged.
- `await editor.insertImages(files)` resolves once every upload has settled.
  Multiple files keep their order — all placeholders are placed first, then
  the uploads race.

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);

const editor = new EdodoWrite(host, {
  value: "Nothing is lost.",
  uploadImage: async () => { throw new Error("storage unreachable"); },
});

const file = new File([new Uint8Array([1])], "doomed.png", { type: "image/png" });

// The editor reports the failure via console.error — keep the output quiet.
const original = console.error;
console.error = () => {};
try {
  await editor.insertImages([file]);
} finally {
  console.error = original;
}

// Placeholder removed, "Image upload failed" toast shown — and the document
// is exactly what it was.
assert.equal(editor.getMarkdown(), "Nothing is lost.");
editor.destroy();
```

## Wiring real hosting

### A multipart upload endpoint (S3 / R2 style)

Most apps already have an authenticated endpoint that accepts a multipart form
and returns the stored file's public URL:

```ts no-run
import { EdodoWrite } from "edodo-write";
import type { ImageUploader } from "edodo-write";

const uploadImage: ImageUploader = async (file) => {
  const body = new FormData();
  body.append("file", file, file.name);

  const res = await fetch("/api/img/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` }, // or cookie/session auth
    body, // the browser sets the multipart Content-Type + boundary itself
  });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);

  // e.g. { success: true, data: { url: "https://cdn.example.com/abc123.png" } }
  const json = await res.json();
  if (!json.success) throw new Error("upload rejected by the server");
  return json.data.url;
};

const editor = new EdodoWrite(host, { uploadImage });
```

Don't set `Content-Type` yourself when sending `FormData` — the browser must
generate the multipart boundary.

### Supabase Storage

```ts no-run
import { createClient } from "@supabase/supabase-js";
import { EdodoWrite } from "edodo-write";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const editor = new EdodoWrite(host, {
  uploadImage: async (file) => {
    const path = `${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from("images").upload(path, file, {
      contentType: file.type,
    });
    if (error) throw error; // → placeholder removed + failure toast
    return supabase.storage.from("images").getPublicUrl(path).data.publicUrl;
  },
});
```

The `images` bucket must be public for `getPublicUrl` — otherwise return a
signed URL (`createSignedUrl`) instead.

### Browser-local IndexedDB (offline / drafts)

For an offline-first draft surface you can keep the bytes in the browser and
serve them back yourself — for example from a service worker:

```ts no-run
import { EdodoWrite } from "edodo-write";

async function saveDraftImage(id: string, file: File): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("draft-images", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const editor = new EdodoWrite(host, {
  uploadImage: async (file) => {
    const id = crypto.randomUUID();
    await saveDraftImage(id, file);
    // A service-worker fetch handler serves /draft-images/<id> from the same
    // IndexedDB store, so the <img> renders normally while drafting.
    return `/draft-images/${id}`;
  },
});
```

**Warning:** these URLs resolve only in that browser profile — the service
worker and the IndexedDB store live there and nowhere else. Markdown exported,
synced, or opened anywhere else will have **dead image links**. That is
exactly why this is not the default: use it for drafts, and re-upload to real
hosting on publish.

## Zero configuration: the data-URL fallback

Without `uploadImage`, images are embedded into the Markdown itself as
`data:image/…;base64,` URLs (the built-in `dataUrlUploader`):

- **Fully portable** — the document is self-contained and renders in any
  Markdown viewer, with no hosting at all.
- **Costs document size** — base64 is ~4/3 of the file's bytes, on a single
  Markdown line.
- **5 MB hard cap** (`DATA_URL_MAX_BYTES`) — a larger file fails with a clear
  error telling you to configure `uploadImage` (the normal failure path:
  toast, document unchanged).
- **Automatic downscaling** — PNG/JPEG/WebP larger than 2048px on the longest
  side (`DOWNSCALE_MAX_DIMENSION`) are downscaled on a canvas before embedding
  (real browsers only — environments without a 2D canvas, like jsdom, embed
  the original). GIFs (animation would be lost) and SVGs (already text) embed
  verbatim.
- A **one-time `console.info` advisory** per editor instance tells you the
  fallback is in use. Passing `uploadImage: dataUrlUploader` explicitly makes
  the same choice deliberately — and without the advisory.

Fine for note-taking, small documents, and anything meant to live as one
self-contained file. Configure real hosting for anything collaborative,
anything autosaved to a database on every change, or documents with more than
a handful of images.

```ts
import { EdodoWrite } from "edodo-write";
import { strict as assert } from "node:assert";

const host = document.createElement("div");
document.body.appendChild(host);
const editor = new EdodoWrite(host); // no uploadImage configured

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // a few PNG-ish bytes
const file = new File([bytes], "tiny.png", { type: "image/png" });

// Logs the one-time advisory via console.info, then embeds the bytes.
await editor.insertImages([file]);

// The Markdown is fully self-contained — no hosting involved.
assert.match(editor.getMarkdown(), /^!\[tiny\]\(data:image\/png;base64,/);
editor.destroy();
```

## Constraints & security

- **Only `image/*` files are accepted.** Every ingestion path filters by MIME
  type, and `insertImages` silently ignores anything else. Read-only editors
  refuse all of it.
- **The sanitiser strips script-scheme URLs** — `javascript:`, `vbscript:` and
  `data:text/html` — from `src`/`href` when Markdown or pasted HTML is parsed.
  `data:image/*` is allowed (the fallback depends on it).
- **Alt text defaults to the filename sans extension**; supply better alt via
  the popover's alt field, `insertImages(files, { alt })`, or the uploader's
  `{ src, alt }` return value.
- **The popover's URL field performs no upload and no fetch** — the URL is
  inserted as-is.

Everything image-related is exported from `edodo-write`: `dataUrlUploader`,
`isImageFile`, `DATA_URL_MAX_BYTES`, `DOWNSCALE_MAX_DIMENSION`, and the
`ImageUploader` / `ImageUploadResult` types.
