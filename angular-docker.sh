#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$ROOT_DIR/scripts/angular-docker.sh"
ACTION="${1:-help}"
shift || true

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing executable runner: $RUNNER" >&2
  exit 1
fi

clean() {
  echo "Stopping Angular stack..."
  "$RUNNER" stop || true

  echo "Removing Angular container (if exists)..."
  docker rm -f ozon-app-web 2>/dev/null || true

  echo "Removing Angular image (if exists)..."
  docker image rm ozon-app-web 2>/dev/null || true

  echo "Pruning Docker builder cache..."
  docker builder prune -f || true

  echo "Removing local node_modules..."
  rm -rf "$ROOT_DIR/node_modules"

  echo "Clean completed."
}

case "$ACTION" in
  install|build|test|start|start-bg|logs|stop)
    "$RUNNER" "$ACTION" "$@"
    ;;
  clean)
    clean
    ;;
  all)
    "$RUNNER" install
    "$RUNNER" build
    ;;
  help|-h|--help)
    cat <<'EOF'
Usage: ./angular-docker.sh <command>

Commands:
  install   Install dependencies in Docker
  build     Build ozon-app-web in Docker
  test      Run Angular tests in Docker
  start     Start Angular via docker-compose (foreground)
  start-bg  Start Angular via docker-compose (background)
  logs      Follow Angular container logs
  stop      Stop and remove Angular compose stack
  clean     Full cleanup (containers, image, cache, node_modules)
  all       Install + build
EOF
    ;;
  *)
    echo "Unknown command: $ACTION" >&2
    echo "Run: ./angular-docker.sh help" >&2
    exit 1
    ;;
esac