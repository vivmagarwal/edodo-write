#!/usr/bin/env bash
# Publish edodo-write to npm using the token stored in edodo-draw/.env
# (NPM_ACCESS_TOKEN). Keeps the token out of this repo and out of a committed
# .npmrc. Runs the package build via the `prepublishOnly` hook.
#
#   scripts/publish.sh            # publish current version
#   scripts/publish.sh --dry-run  # pack + validate without publishing
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${NPM_ENV_FILE:-../edodo-draw/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ token env file not found: $ENV_FILE" >&2
  exit 1
fi

TOKEN="$(grep -E '^NPM_ACCESS_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -z "${TOKEN:-}" ]]; then
  echo "✗ NPM_ACCESS_TOKEN not set in $ENV_FILE" >&2
  exit 1
fi

# Write a temporary, gitignored .npmrc with the auth token; remove on exit.
NPMRC=".npmrc"
cleanup() { rm -f "$NPMRC"; }
trap cleanup EXIT
printf '//registry.npmjs.org/:_authToken=%s\n' "$TOKEN" > "$NPMRC"

echo "→ npm whoami: $(npm whoami 2>/dev/null || echo '(token-scoped)')"

if [[ "${1:-}" == "--dry-run" ]]; then
  npm publish --dry-run --access public
else
  npm publish --access public
fi
