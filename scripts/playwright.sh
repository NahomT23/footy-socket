#!/usr/bin/env bash
#
# Playwright launcher.
#
# Browsers are cached inside the repository (`.cache/ms-playwright`) instead of
# `~/Library/Caches/ms-playwright` so that sandboxed/CI environments that cannot
# write to the home directory still work. Override with PLAYWRIGHT_BROWSERS_PATH.
#
#   npm run test:e2e         -> runs `playwright test`
#   npm run test:e2e:install -> downloads the chromium build
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$REPO_ROOT/.cache/ms-playwright}"

# Playwright's own CLI, resolved the same way npm would put it on PATH.
exec "$REPO_ROOT/node_modules/.bin/playwright" "$@"
