#!/usr/bin/env bash

set -euo pipefail

ACTION="${1:-build}"
shift || true

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/ozon-app-web"
COMPOSE_FILE="$ROOT_DIR/docker-compose.angular.yml"
ENV_FILE="$ROOT_DIR/.env"
IMAGE="${NODE_DOCKER_IMAGE:-node:22-bookworm}"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
NODE_MODULES_VOLUME="${OZON_ANGULAR_NODE_MODULES_VOLUME:-ozon_app_web_node_modules}"
NPM_CACHE_VOLUME="${OZON_ANGULAR_NPM_CACHE_VOLUME:-ozon_app_web_npm_cache}"

read_env_value() {
  local key="$1"
  local file="$2"
  if [[ ! -f "$file" ]]; then
    return
  fi
  awk -F= -v k="$key" '
    $0 ~ "^[[:space:]]*#" { next }
    $1 ~ "^[[:space:]]*"k"[[:space:]]*$" {
      v=$0
      sub(/^[^=]*=/, "", v)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      gsub(/^"|"$/, "", v)
      gsub(/^'\''|'\''$/, "", v)
      print v
      exit
    }
  ' "$file"
}

BACKEND_NETWORK_FROM_FILE="$(read_env_value BACKEND_DOCKER_NETWORK "$ENV_FILE")"
BACKEND_NETWORK="${BACKEND_NETWORK_FROM_FILE:-${BACKEND_DOCKER_NETWORK:-backend_default}}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Missing directory: $APP_DIR" >&2
  exit 1
fi

run_in_container() {
  local cmd="$1"
  docker run --rm \
    -e CI=true \
    -e NG_CLI_ANALYTICS=false \
    -e npm_config_cache=/tmp/.npm \
    -v "$ROOT_DIR:/workspace" \
    -v "${NODE_MODULES_VOLUME}:/workspace/ozon-app-web/node_modules" \
    -v "${NPM_CACHE_VOLUME}:/tmp/.npm" \
    -w /workspace/ozon-app-web \
    "$IMAGE" \
    bash -lc "$cmd"
}

install_cmd() {
  chmod +x ./scripts/ensure-deps.sh
  ./scripts/ensure-deps.sh
}

ensure_backend_network() {
  if docker network inspect "$BACKEND_NETWORK" >/dev/null 2>&1; then
    return
  fi

  cat <<EOF
Missing Docker network: $BACKEND_NETWORK

Set the backend network name and retry, for example:
  BACKEND_DOCKER_NETWORK=my_backend_default ./angular-docker.sh start
EOF
  exit 1
}

case "$ACTION" in
  install)
    run_in_container "$(declare -f install_cmd); install_cmd"
    ;;
  build)
    run_in_container "$(declare -f install_cmd); install_cmd; npm run build; if [[ -d dist ]]; then chown -R ${HOST_UID}:${HOST_GID} dist; fi"
    ;;
  test)
    run_in_container "$(declare -f install_cmd); install_cmd; npm run test"
    ;;
  start)
    ensure_backend_network
    echo "Using backend Docker network: $BACKEND_NETWORK"
    docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" up --build ozon-app-web
    ;;
  stop)
    docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" down
    ;;
  start-bg)
    ensure_backend_network
    echo "Using backend Docker network: $BACKEND_NETWORK"
    docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" up -d --build ozon-app-web
    ;;
  logs)
    docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" logs -f ozon-app-web
    ;;
  *)
    cat <<'EOF'
Usage: ./scripts/angular-docker.sh [install|build|test|start|start-bg|logs|stop]

Environment:
  NODE_DOCKER_IMAGE   Node image tag (default: node:22-bookworm)
  OZON_ANGULAR_NODE_MODULES_VOLUME  Docker volume for Linux node_modules
  OZON_ANGULAR_NPM_CACHE_VOLUME     Docker volume for npm cache
  BACKEND_DOCKER_NETWORK            External backend network name for compose
EOF
    exit 1
    ;;
esac
