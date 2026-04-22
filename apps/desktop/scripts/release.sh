#!/usr/bin/env bash
# Local release script: builds mac (arm64 + x64) + win (x64 only) and
# uploads to GitHub as a draft release matching package.json version.
#
# Why a script: previous releases broke because we either (a) ran
# `tsc -b` which clobbered dist/ with ESM that Electron can't load, or
# (b) passed `--arm64` on the CLI and electron-builder applied it
# globally, producing a 1GB Windows installer that bundled both archs.
# Doing it here keeps the happy path verbatim + documented.
#
# Prereqs:
#   - GH_TOKEN exported (GitHub PAT, scope: repo)
#   - Working dir is on APFS OR `output:` in electron-builder.yml
#     points at APFS (currently ~/memora-release)
#
# Usage: ./scripts/release.sh

set -euo pipefail

if [ -z "${GH_TOKEN:-}" ]; then
  echo "ERROR: GH_TOKEN not set. export it, then rerun." >&2
  exit 1
fi

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DESKTOP_DIR"

echo "==> Clean dist/"
rm -rf dist/

echo "==> electron-vite build (produces CJS bundle)"
env -u ELECTRON_RUN_AS_NODE COPYFILE_DISABLE=1 npx electron-vite build

echo "==> Build + publish macOS (arm64 + x64)"
env -u ELECTRON_RUN_AS_NODE COPYFILE_DISABLE=1 \
  npx electron-builder --mac --arm64 --x64 \
  -c electron-builder.yml \
  -c.directories.output="$HOME/memora-release/\${version}" \
  --publish always

echo "==> Build + publish Windows (x64 only — no --arm64!)"
env -u ELECTRON_RUN_AS_NODE COPYFILE_DISABLE=1 \
  npx electron-builder --win --x64 \
  -c electron-builder.yml \
  -c.directories.output="$HOME/memora-release/\${version}" \
  --publish always

echo
echo "==> Done. Review + publish the draft release at:"
echo "    https://github.com/contractlayer/memora/releases"
