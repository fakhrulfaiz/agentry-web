#!/usr/bin/env bash
# Agentry Web deployment launcher.
# Runs the Docker image from dist/agentry-web-<tag>.tar (the newest; or AGENTRY_WEB_IMAGE_TAR),
# made by `scripts/dev.sh image`: loads it unless already loaded, then replaces the container
# `agentry-web` (restart unless-stopped, port PORT, env from .env/.env.local, data in .data/).
# No tar: a terminal run offers to build it now or to run without Docker; otherwise it fails.
#   --no-docker   next build (when the source changed) + next start, no image
#   --rebuild     with --no-docker: always build first
# Checks that the Agentry API answers first. PORT (default 3000), NONINTERACTIVE=1.
set -eo pipefail
source "$(dirname "$0")/lib/launch.sh"

PORT=${PORT:-3000}
MODE=docker
REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-docker) MODE=node ;;
    --rebuild) REBUILD=1 ;;
    -h | --help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Whether anything the build reads is newer than the last `next build`.
stale_build() {
  local stamp="$ROOT/.next/BUILD_ID"
  [ -f "$stamp" ] || return 0
  [ -n "$(find "$ROOT/app" "$ROOT/src" "$ROOT/next.config.ts" "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/postcss.config.mjs" "$ROOT/.env.local" "$ROOT/.env" -newer "$stamp" -print -quit 2>/dev/null)" ]
}

run_node() {
  ui_box "Agentry Web · production (no Docker)" "next build + next start on http://localhost:$PORT"
  check_port "$PORT"
  cd "$ROOT"
  if [ "$REBUILD" = 1 ] || stale_build; then
    echo "Building ..."
    pnpm build
    ui_ok "Build done."
  else
    ui_ok "Build is up to date (--rebuild to force)."
  fi
  exec pnpm exec next start -p "$PORT"
}

ensure_gum
require_api
[ "$MODE" = node ] && run_node

require_docker
tar=$(find_image_tar)
if [ -z "$tar" ]; then
  ui_warn "No image tar in ${DIST_DIR#$ROOT/}/ (make one with: scripts/dev.sh image)."
  if ! interactive; then
    ui_err "Nothing to deploy. Build the image, set AGENTRY_WEB_IMAGE_TAR, or use --no-docker."
    exit 1
  fi
  case "$(ui_choose "What now?" "Build the image now" "Run without Docker (next build + start)" "Quit")" in
    Build*) build_image_tar; tar=$IMAGE_TAR ;;
    Run*) run_node ;;
    *) exit 1 ;;
  esac
fi

ui_box "Agentry Web · deploy" "image tar: ${tar#$ROOT/}" "container $CONTAINER_NAME on http://localhost:$PORT"
ref=$(load_image_tar "$tar")
# The port may be held by the container this run replaces; anything else holding it is an error.
if port_in_use "$PORT" && [ -z "$(docker ps -q --filter "name=^${CONTAINER_NAME}$" --filter "publish=$PORT")" ]; then
  check_port "$PORT"
fi
run_container "$ref" "$PORT"
