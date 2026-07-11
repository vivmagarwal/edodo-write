/**
 * `edodo-write/plugins` — first-party optional plugins.
 *
 *   import { highlight, callout, math, diagrams, tags, embeds } from "edodo-write/plugins";
 *   new EdodoWrite(host, { plugins: [highlight(), math(), diagrams()] });
 *
 * Each plugin is a named factory export in its own module so bundlers drop
 * the ones you don't use.
 */

export { highlight } from "./highlight.js";
export { callout, CALLOUT_KINDS, type CalloutKind } from "./callout.js";
export { math, type MathOptions } from "./math.js";
export { diagrams, edodoDraw, type DiagramsOptions, type DiagramRenderer, type EdodoDrawOptions } from "./diagrams.js";
export { tags, type TagsOptions, type TagItem, type TagTokenItem, type ResolveMention } from "./tags.js";
export { emoji, type EmojiOptions } from "./emoji.js";
export { defaultEmojiMap } from "./emoji-map.js";
export { embeds, type EmbedsOptions, type EmbedMetadata } from "./embeds.js";
export { footnote } from "./footnote.js";
export { file, type FileOptions, type FileUploader, type FileUploadResult } from "./file.js";
export { detailsToggle } from "./details.js";
export { createWidget, mountWidgets, wireWidgetEditing, escapeAttr, type WidgetSpec } from "./widget.js";
