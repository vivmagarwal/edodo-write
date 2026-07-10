/**
 * Image upload helpers — the pieces behind `EditorOptions.uploadImage` and
 * `editor.insertImages()`.
 *
 * The contract: an uploader takes a `File` and resolves with the hosted URL
 * (or `{ src, alt? }`). Where the bytes go is entirely the application's
 * business — an S3/R2 endpoint, Supabase storage, a local dev server. The
 * editor only ever writes the resolved URL into the Markdown.
 *
 * `dataUrlUploader` is the zero-config fallback: it embeds the image bytes as
 * a `data:` URL, so the Markdown stays fully self-contained and renders
 * anywhere. That honesty has a cost — document size — so large files are
 * rejected outright and oversized raster images are downscaled when a canvas
 * is available (real browsers; silently skipped in jsdom).
 */

/** Files the editor treats as images (paste / drop / picker filtering). */
export function isImageFile(file: File): boolean {
  return /^image\//.test(file.type);
}

/** Hard ceiling for the data-URL fallback — beyond this, embedding would
 *  produce multi-megabyte Markdown lines; a real uploader is required. */
export const DATA_URL_MAX_BYTES = 5 * 1024 * 1024;

/** Raster images larger than this (either dimension) are downscaled before
 *  embedding, when a 2D canvas exists. */
export const DOWNSCALE_MAX_DIMENSION = 2048;

/**
 * The built-in fallback uploader: embed the file as a `data:` URL.
 * Also exported for explicit use (`uploadImage: dataUrlUploader`) when
 * self-contained Markdown is exactly what you want.
 */
export async function dataUrlUploader(file: File): Promise<{ src: string }> {
  if (file.size > DATA_URL_MAX_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — too large to embed ` +
      `as a data URL. Configure \`uploadImage\` to store images externally ` +
      `(see docs/IMAGE_HOSTING.md).`,
    );
  }
  const raw = await readAsDataUrl(file);
  const scaled = await downscale(raw, file.type).catch(() => null);
  return { src: scaled ?? raw };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale an oversized raster image via canvas. Returns null when no
 * downscaling applies (small image, non-raster type, or no canvas — jsdom).
 */
async function downscale(dataUrl: string, type: string): Promise<string | null> {
  // GIFs would lose animation; SVGs are text — embed both verbatim.
  if (!/^image\/(png|jpeg|webp)$/.test(type)) return null;
  if (typeof document === "undefined") return null;
  const probe = document.createElement("canvas");
  try {
    // jsdom defines getContext but throws "Not implemented" — probe quietly.
    if (typeof probe.getContext !== "function" || !probe.getContext("2d")) return null;
  } catch {
    return null;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("could not decode image"));
    el.src = dataUrl;
  });
  if (img.width <= DOWNSCALE_MAX_DIMENSION && img.height <= DOWNSCALE_MAX_DIMENSION) return null;

  const scale = DOWNSCALE_MAX_DIMENSION / Math.max(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.85);
}

/** 1×1 transparent GIF — the placeholder src where blob: URLs are unavailable. */
export const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** A preview URL for a just-dropped file; TRANSPARENT_PIXEL where blob: URLs
 *  don't exist (jsdom). */
export function previewUrl(file: File): string {
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(file);
    }
  } catch { /* jsdom: not implemented */ }
  return TRANSPARENT_PIXEL;
}

export function revokePreviewUrl(url: string | null): void {
  if (url && url.startsWith("blob:")) {
    try { URL.revokeObjectURL(url); } catch { /* best-effort */ }
  }
}

/** Default alt text for an uploaded file: the basename, sans extension. */
export function defaultAlt(file: File): string {
  return (file.name || "image").replace(/\.[a-z0-9]+$/i, "");
}
