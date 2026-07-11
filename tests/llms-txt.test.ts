import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The LLM corpus (public/llms-full.txt + llms.txt) must be a deterministic,
 * complete projection of docs/ — docs are the source of truth, mechanically.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function generate(): { full: string; index: string } {
  execFileSync("node", [join(root, "scripts", "gen-llms-txt.mjs")], { cwd: root });
  return {
    full: readFileSync(join(root, "public", "llms-full.txt"), "utf8"),
    index: readFileSync(join(root, "public", "llms.txt"), "utf8"),
  };
}

describe("llms.txt generation", () => {
  it("includes EVERY guide in docs/ — a new doc cannot silently drop out", () => {
    const { full } = generate();
    const docs = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md"));
    expect(docs.length).toBeGreaterThan(0);
    for (const file of docs) {
      // The doc's own first heading appears verbatim in the corpus.
      const firstHeading = readFileSync(join(root, "docs", file), "utf8")
        .split("\n")
        .find((l) => l.startsWith("# "));
      expect(firstHeading, `${file} has an H1`).toBeTruthy();
      expect(full, `${file} is in llms-full.txt`).toContain(firstHeading!);
    }
  });

  it("is byte-for-byte deterministic across runs", () => {
    const first = generate();
    const second = generate();
    expect(second.full).toBe(first.full);
    expect(second.index).toBe(first.index);
  });

  it("the index follows the llms.txt convention and points at the full corpus", () => {
    const { index } = generate();
    expect(index.startsWith("# edodo-write\n")).toBe(true);
    expect(index).toContain("> "); // summary blockquote
    expect(index).toContain("/llms-full.txt");
    expect(index).toContain("npm i edodo-write");
  });

  it("carries no timestamps or other non-doc-derived churn", () => {
    const { full } = generate();
    expect(full).not.toMatch(/\b20\d\d-\d\d-\d\dT/); // no ISO timestamps
    expect(full).not.toMatch(/generated at/i);
  });
});
