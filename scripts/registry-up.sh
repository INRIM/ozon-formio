#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE (copy .env.example first)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${REGISTRY_HOST:?REGISTRY_HOST not set in .env}"
: "${REGISTRY_USER:?REGISTRY_USER not set in .env}"
: "${REGISTRY_PASSWORD:?REGISTRY_PASSWORD not set in .env}"

echo "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USER" --password-stdin

exec docker compose -f "$ROOT_DIR/docker-compose.registry.yml" up -d
