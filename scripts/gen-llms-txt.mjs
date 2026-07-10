/**
 * Generate `public/llms-full.txt` (and `public/llms.txt`) — one deterministic,
 * LLM-consumable file that concatenates EVERY documentation guide from the
 * repo's single source of truth (`docs/*.md`). Regenerated on every build
 * (`prebuild`) so the file served at
 * https://vivmagarwal.github.io/edodo-write/llms-full.txt stays in lockstep
 * with the docs. Deterministic: fixed order, no timestamps.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const SITE = pkg.homepage.replace(/\/$/, "");

// [file, title] — same order as the docs site nav.
const DOCS = [
  ["GETTING_STARTED.md", "Getting started"],
  ["ARCHITECTURE.md", "Architecture"],
  ["PLUGIN_GUIDE.md", "Plugin guide"],
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

for (const [file, title] of DOCS) {
  let body;
  try {
    body = readFileSync(join(root, "docs", file), "utf8").trim();
  } catch {
    continue;
  }
  L.push(`# ${title}`);
  L.push("");
  L.push(body);
  L.push("");
  L.push("---");
  L.push("");
}

const full = L.join("\n");
writeFileSync(join(root, "public", "llms-full.txt"), full);

// A short pointer file (llms.txt convention).
const short = [
  `# edodo-write`,
  "",
  `> ${pkg.description}`,
  "",
  `Full documentation for LLMs: ${SITE}/llms-full.txt`,
  `npm: https://www.npmjs.com/package/${pkg.name}`,
  `Repo: ${pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}`,
  "",
].join("\n");
writeFileSync(join(root, "public", "llms.txt"), short);

console.log(`✓ wrote public/llms-full.txt (${full.length} bytes) + public/llms.txt`);
