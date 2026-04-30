#!/usr/bin/env bash

set -euo pipefail

MARKER_FILE="node_modules/.ozon_deps_ok"
LOCK_FILE="package-lock.json"

needs_install=0

if [[ ! -d node_modules ]]; then
  needs_install=1
fi

if [[ -d node_modules && ! -f "$MARKER_FILE" ]]; then
  needs_install=1
fi

if [[ -f "$LOCK_FILE" && -f "$MARKER_FILE" && "$LOCK_FILE" -nt "$MARKER_FILE" ]]; then
  needs_install=1
fi

if [[ "$needs_install" -eq 1 ]]; then
  NPM_FLAGS=(--no-audit --no-fund --loglevel=error --legacy-peer-deps)
  if [[ -f "$LOCK_FILE" ]]; then
    npm ci "${NPM_FLAGS[@]}"
  else
    npm install "${NPM_FLAGS[@]}"
  fi
  mkdir -p node_modules
  touch "$MARKER_FILE"
fi
