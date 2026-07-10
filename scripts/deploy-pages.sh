#!/usr/bin/env bash
# Build the playground/docs site and deploy it to the gh-pages branch.
# Branch-based deploy — needs only `repo` scope, no Actions workflow.
#
#   scripts/deploy-pages.sh
#
# Requires: gh/git auth configured for the repo remote.
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${PAGES_REMOTE:-$(git remote get-url origin)}"

echo "→ building site (relative base for /edodo-write/)…"
npm run build

# GitHub Pages: disable Jekyll, and serve the SPA for any path.
touch dist/.nojekyll
cp dist/index.html dist/404.html

echo "→ pushing dist/ to gh-pages…"
pushd dist >/dev/null
git init -q -b gh-pages
git add -A
git -c user.email="vivmagarwal@gmail.com" -c user.name="vivmagarwal" \
    commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -f "$REMOTE" gh-pages:gh-pages
rm -rf .git
popd >/dev/null

echo "✓ deployed. Pages: https://vivmagarwal.github.io/edodo-write/"
