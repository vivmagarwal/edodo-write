/**
 * Generate `public/llms-full.txt` (and `public/llms.txt`) — one deterministic,
 * LLM-consumable file that concatenates EVERY documentation guide from the
 * repo's single source of truth (`docs/*.md`). Regenerated on every build
 * (`prebuild`) so the file served at
 * https://vivmagarwal.github.io/edodo-write/llms-full.txt stays in lockstep
 * with the docs. Deterministic: fixed order, no timestamps.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const SITE = pkg.homepage.replace(/\/$/, "");

// [file, title] — same order as the docs site nav. GUARDED below: every
// file in docs/ must appear here and every entry must exist — a new guide
// that isn't listed (or a typo'd entry) fails the build instead of silently
// dropping out of the LLM corpus. Docs are the source of truth, mechanically.
const DOCS = [
  ["GETTING_STARTED.md", "Getting started"],
  ["ARCHITECTURE.md", "Architecture"],
  ["PLUGIN_GUIDE.md", "Plugin guide"],
  ["FIRST_PARTY_PLUGINS.md", "First-party plugins"],
  ["INTEGRATION_GUIDE.md", "Embed in your app (API)"],
  ["IMAGE_HOSTING.md", "Image hosting"],
  ["MARKDOWN_AND_SHORTCUTS.md", "Markdown support & shortcuts"],
  ["NOTION_UX_STUDY.md", "Notion UX study"],
  ["DEVELOPMENT.md", "Development guide"],
];

const L = [];
L.push(`# edodo-write — complete documentation (v${pkg.version})`);
L.push("");
L.push(`> ${pkg.description}`);
L.push("");
L.push(`- Live site (rendered docs + playground): ${SITE}/`);
L.push(`- npm package: https://www.npmjs.com/package/${pkg.name}  (\`npm i ${pkg.name}\`)`);
L.push(`- Source repo: ${pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}`);
L.push("");
L.push("This ONE file concatenates every guide, generated verbatim from the source repo.");
L.push("");
L.push("---");
L.push("");

// ── Drift guard ──────────────────────────────────────────────────────────
const onDisk = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).sort();
const listed = DOCS.map(([f]) => f).sort();
const missingFromList = onDisk.filter((f) => !listed.includes(f));
const missingOnDisk = listed.filter((f) => !onDisk.includes(f));
if (missingFromList.length || missingOnDisk.length) {
  if (missingFromList.length) {
    console.error(`✗ docs not listed in gen-llms-txt.mjs (add them so LLMs see them): ${missingFromList.join(", ")}`);
  }
  if (missingOnDisk.length) {
    console.error(`✗ listed docs missing on disk: ${missingOnDisk.join(", ")}`);
  }
  process.exit(1);
}

for (const [file, title] of DOCS) {
  const body = readFileSync(join(root, "docs", file), "utf8").trim();
  L.push(`# ${title}`);
  L.push("");
  L.push(body);
  L.push("");
  L.push("---");
  L.push("");
}

const full = L.join("\n");
// public/ holds only generated (gitignored) files — absent on a clean clone.
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "llms-full.txt"), full);

// The index file (llms.txt convention: H1, blockquote summary, link list).
const repoUrl = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
const short = [
  `# edodo-write`,
  "",
  `> ${pkg.description}`,
  "",
  "## Docs",
  "",
  `- [Complete documentation in one file](${SITE}/llms-full.txt): every guide below, concatenated — fetch this for full context`,
  ...DOCS.map(([file, title]) => `- [${title}](${repoUrl}/blob/master/docs/${file})`),
  "",
  "## Package",
  "",
  `- [npm](https://www.npmjs.com/package/${pkg.name}): \`npm i ${pkg.name}\``,
  `- [Source repo](${repoUrl})`,
  `- [Live playground](${SITE}/)`,
  "",
].join("\n");
writeFileSync(join(root, "public", "llms.txt"), short);

// --pkg: also write tarball-root copies so the npm package carries the
// corpus (node_modules/edodo-write/llms-full.txt — agents working inside a
// consumer repo get full context without a network hop).
if (process.argv.includes("--pkg")) {
  writeFileSync(join(root, "llms-full.txt"), full);
  writeFileSync(join(root, "llms.txt"), short);
}

console.log(`✓ wrote public/llms-full.txt (${full.length} bytes) + public/llms.txt${process.argv.includes("--pkg") ? " + package copies" : ""}`);
