#!/usr/bin/env bash
set -euo pipefail

atlas_release_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$atlas_release_root/script/release.mjs" "$@"
