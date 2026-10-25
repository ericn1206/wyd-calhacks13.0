#!/usr/bin/env bash
# Launches N isolated app instances (default 2) to emulate separate clients joining one session.
# Each gets its own Electron userData dir => its own SpacetimeDB identity token, localStorage
# (name, tutorial flag), preferences and logs. Builds once, then runs `electron-vite preview`.
# Usage: npm run dev:two [-- -n 3] [--no-build] [--fresh]
#   -n N        number of instances
#   --no-build  reuse existing out/
#   --fresh     wipe the instances' userData first (new identity + first-run tutorial)
# Data lives in ~/.wyd-test/client-<i>; logs: <dir>/logs/stdb.log. Ctrl+C stops all.
set -euo pipefail
cd "$(dirname "$0")/.."

N=2; BUILD=1; FRESH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) N="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --fresh) FRESH=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

ROOT="${WYD_TEST_DIR:-$HOME/.wyd-test}"
if [[ $BUILD -eq 1 ]]; then npx electron-vite build; fi

trap 'trap - EXIT; kill 0' EXIT INT TERM

for i in $(seq 1 "$N"); do
  DIR="$ROOT/client-$i"
  if [[ $FRESH -eq 1 ]]; then rm -rf "$DIR"; fi
  mkdir -p "$DIR"
  echo "client $i -> $DIR"
  npx electron-vite preview --skipBuild -- --user-data-dir="$DIR" 2>&1 | sed -u "s/^/[c$i] /" &
  sleep 2
done

echo "Running $N clients. Ctrl+C to stop."
wait
