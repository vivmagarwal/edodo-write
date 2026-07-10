/**
 * `edodo-write/plugins` — first-party optional plugins.
 *
 *   import { highlight, callout } from "edodo-write/plugins";
 *   new EdodoWrite(host, { plugins: [highlight(), callout()] });
 *
 * Each plugin is a named factory export in its own module so bundlers drop
 * the ones you don't use.
 */

export { highlight } from "./highlight.js";
export { callout, CALLOUT_KINDS, type CalloutKind } from "./callout.js";
