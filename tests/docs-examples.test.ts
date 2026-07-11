/**
 * Stage 3 of the test pyramid: executable documentation.
 *
 * Reads README.md and every docs/*.md AT RUNTIME, extracts fenced code
 * blocks, and:
 *   - executes every ```ts / ```js block (vitest+jsdom, public package names
 *     resolved to src/ by the aliases in vitest.config.ts);
 *   - typechecks every ```tsx block against the real exports (one strict
 *     ts.Program over all tsx blocks) — React examples are compile-only;
 *   - syntax-checks ```ts no-run blocks without executing them.
 *
 * Execution works by writing each runnable block VERBATIM to a temp file
 * under tests/.docs-tmp/ and `import()`ing it — vitest transforms the
 * TypeScript and resolves the `edodo-write` aliases, so the docs run exactly
 * as a consumer would run them. Temp files are generated fresh from the
 * current docs on every run (never committed), so tests cannot drift from
 * the docs.
 *
 * The authoring contract for doc examples lives in docs/DEVELOPMENT.md
 * ("Stage 3 — Executable doc examples").
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FORMAT_HOST: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: () => ROOT,
  getNewLine: () => "\n",
};

function throwOnErrors(diagnostics: readonly ts.Diagnostic[]): void {
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) throw new Error(ts.formatDiagnostics(errors, FORMAT_HOST));
}

/** Syntax-check a `ts no-run` fragment (never executed, may reference
 *  undeclared identifiers — so no semantic checking). */
function syntaxCheck(code: string): void {
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  throwOnErrors(out.diagnostics ?? []);
}

/** One strict ts.Program over every tsx temp file, built lazily after
 *  beforeAll has written them. Public package names are mapped to `src` —
 *  the same mapping tsconfig uses — so the check works on a CLEAN checkout
 *  (dist-lib is a build artifact and absent in CI). The shipped declaration
 *  emit itself is validated at release time by prepublishOnly's build. */
let tsxProgram: ts.Program | null = null;
function tsxDiagnosticsFor(file: string, all: string[]): readonly ts.Diagnostic[] {
  tsxProgram ??= ts.createProgram(all, {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: ROOT,
    paths: {
      "edodo-write": ["src/lib/index.ts"],
      "edodo-write/react": ["src/lib/react.tsx"],
      "edodo-write/plugins": ["src/plugins/index.ts"],
      "edodo-write/testing": ["src/lib/testing.ts"],
    },
  });
  const source = tsxProgram.getSourceFile(file);
  if (!source) throw new Error(`tsx program did not load ${file}`);
  return ts.getPreEmitDiagnostics(tsxProgram, source);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = join(ROOT, "tests", ".docs-tmp");

interface DocBlock {
  /** Repo-relative path of the source document. */
  file: string;
  /** 1-based ordinal among the ts/js/tsx blocks of that document. */
  n: number;
  /** 1-based line of the opening fence in the document. */
  line: number;
  lang: "ts" | "js" | "tsx";
  noRun: boolean;
  code: string;
  firstLine: string;
  /** Absolute path of the generated temp module (runnable blocks only). */
  tempPath: string | null;
}

/** The documents whose examples are executable. Discovered at runtime so a
 *  newly added docs/*.md is covered without touching this file. internal/
 *  holds untracked local-only notes (absent on CI and fresh clones); their
 *  examples still execute here so they can't rot in the clones that have
 *  them. */
function docFiles(): string[] {
  const fromDir = (dir: string) => {
    try {
      return readdirSync(join(ROOT, dir))
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => join(ROOT, dir, f));
    } catch {
      return []; // directory absent (internal/ on CI)
    }
  };
  return [join(ROOT, "README.md"), ...fromDir("docs"), ...fromDir("internal")];
}

/** Extract fenced code blocks. A fence opens with ``` at column 0 followed by
 *  an info string; any line starting with ``` closes it. Only ts/js/tsx
 *  blocks are returned — bash/json/css/html and untagged diagrams are inert. */
function extractBlocks(absPath: string): DocBlock[] {
  const rel = relative(ROOT, absPath);
  const lines = readFileSync(absPath, "utf8").split(/\r?\n/);
  const blocks: DocBlock[] = [];
  let open: { lang: string; flags: string[]; start: number; body: string[] } | null = null;
  let n = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      if (line.startsWith("```")) {
        const { lang, flags, start, body } = open;
        open = null;
        if (lang === "ts" || lang === "js" || lang === "tsx") {
          n += 1;
          const code = body.join("\n");
          blocks.push({
            file: rel,
            n,
            line: start,
            lang,
            noRun: flags.includes("no-run"),
            code,
            firstLine: (body.find((l) => l.trim() !== "") ?? "").trim(),
            tempPath: null,
          });
        }
      } else {
        open.body.push(line);
      }
      continue;
    }
    const m = /^```(\S*)\s*(.*)$/.exec(line);
    if (m) open = { lang: m[1], flags: m[2].split(/\s+/).filter(Boolean), start: i + 1, body: [] };
  }
  if (open) throw new Error(`${rel}: unclosed \`\`\` fence opened at line ${open.start}`);
  return blocks;
}

function slug(rel: string): string {
  return rel.replace(/\.md$/, "").replace(/[^A-Za-z0-9]+/g, "_");
}

// ---------------------------------------------------------------------------
// Collection: read the docs once at module load; the same extraction feeds
// both test registration and temp-file generation, so they cannot disagree.
// ---------------------------------------------------------------------------
const allBlocks: DocBlock[] = docFiles().flatMap(extractBlocks);

for (const b of allBlocks) {
  if (!b.noRun) {
    const hash = createHash("sha1").update(b.code).digest("hex").slice(0, 8);
    b.tempPath = join(TMP_DIR, `${slug(b.file)}-${b.n}-${hash}.${b.lang}`);
  }
}

const tsxTempPaths = allBlocks.filter((b) => b.lang === "tsx" && b.tempPath).map((b) => b.tempPath!);

beforeAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  for (const b of allBlocks) {
    if (b.tempPath) {
      writeFileSync(
        b.tempPath,
        `// Generated from ${b.file} (block #${b.n}, line ${b.line}) — do not edit.\n${b.code}\n`,
      );
    }
  }
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("docs examples", () => {
  it("found executable examples in the docs", () => {
    // If extraction ever breaks, fail loudly rather than silently running 0.
    expect(allBlocks.length).toBeGreaterThan(10);
    expect(allBlocks.some((b) => b.tempPath)).toBe(true);
  });

  const byFile = new Map<string, DocBlock[]>();
  for (const b of allBlocks) {
    if (!byFile.has(b.file)) byFile.set(b.file, []);
    byFile.get(b.file)!.push(b);
  }

  for (const [file, blocks] of byFile) {
    describe(file, () => {
      for (const b of blocks) {
        const title = `block #${b.n} — ${b.firstLine}`;

        if (b.lang === "tsx") {
          // React examples: compile-checked (strict, against the shipped
          // types), not rendered — jsdom has no real renderer wired here.
          it(`${title} (tsx compile-check)`, () => {
            throwOnErrors(tsxDiagnosticsFor(b.tempPath!, tsxTempPaths));
          });
        } else if (b.tempPath) {
          // Runnable ts/js: import the verbatim block; its own assertions
          // (node:assert) throw on failure and fail this test.
          it(title, async () => {
            await import(b.tempPath!);
          });
        } else {
          // `ts no-run`: never executed, but it must still be valid syntax.
          it(`${title} (no-run, syntax-check)`, () => {
            syntaxCheck(b.code);
          });
        }
      }
    });
  }
});
