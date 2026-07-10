/**
 * `edodo-write/testing` — helpers for plugin authors and integrators.
 *
 * The plugin contract's teeth: if your plugin contributes a marked extension,
 * it must contribute the paired turndown rule, and your tests must prove the
 * round-trip:
 *
 *   import { createCodec, assertRoundTrip } from "edodo-write/testing";
 *   const codec = createCodec([highlight()]);
 *   assertRoundTrip(codec, "some ==highlighted== text");
 *
 * Requires a DOM (browser, jsdom, or happy-dom).
 */

import type { EdodoPlugin, ParseOptions } from "./index.js";
import { corePreset } from "../core/preset.js";
import { resolvePlugins } from "../core/plugin.js";
import { createMarkdownParser } from "../core/parse.js";
import { createMarkdownSerializer } from "../core/serialize.js";

export interface Codec {
  parse(md: string, opts?: ParseOptions): string;
  serialize(html: string): string;
}

/**
 * Build the exact parse/serialize codec an editor constructed with these
 * plugins would use — for tests, SSR previews, or headless conversion that
 * must match the editor byte-for-byte.
 */
export function createCodec(plugins: EdodoPlugin[] = [], exclude?: string[]): Codec {
  const registry = resolvePlugins([corePreset(), ...plugins], exclude);
  return {
    parse: createMarkdownParser(registry.markedExtensions, registry.sanitize),
    serialize: createMarkdownSerializer(registry.turndownExtensions),
  };
}

/**
 * Assert that `markdown` survives a parse→serialize round-trip byte-for-byte,
 * and that a second pass is stable too. Throws with a readable diff on
 * divergence.
 */
export function assertRoundTrip(codec: Codec, markdown: string): void {
  const once = codec.serialize(codec.parse(markdown));
  if (once !== markdown) {
    throw new Error(
      `Round-trip diverged.\n--- input ---\n${markdown}\n--- after one pass ---\n${once}`,
    );
  }
  const twice = codec.serialize(codec.parse(once));
  if (twice !== once) {
    throw new Error(
      `Round-trip is not idempotent.\n--- pass 1 ---\n${once}\n--- pass 2 ---\n${twice}`,
    );
  }
}
