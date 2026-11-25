#!/usr/bin/env bash
# Agentry Web development launcher.
#   scripts/dev.sh          next dev with hot reload (a terminal run asks: run, or build the image)
#   scripts/dev.sh run      next dev, no question
#   scripts/dev.sh image    build the Docker image and export it to dist/agentry-web-<tag>.tar
# next dev checks that the Agentry API answers first. PORT (default 3000), NONINTERACTIVE=1.
set -eo pipefail
source "$(dirname "$0")/lib/launch.sh"

PORT=${PORT:-3000}
cmd=${1:-}
case "$cmd" in
  "" | run | image) ;;
  -h | --help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown command: $cmd (try --help)" >&2; exit 2 ;;
esac

ensure_gum
if [ -z "$cmd" ]; then
  case "$(ui_choose "Agentry Web · development" "Run next dev (hot reload)" "Build the Docker image (.tar for deployment)")" in
    Build*) cmd=image ;;
    *) cmd=run ;;
  esac
fi

if [ "$cmd" = image ]; then
  build_image_tar
  echo "   Deploy it with scripts/start.sh (here, or copy the tar to dist/ on the server)."
  exit 0
fi

ui_box "Agentry Web · development" "next dev on http://localhost:$PORT" "For daily use: scripts/dev.sh image, then scripts/start.sh."
require_api
check_port "$PORT"
cd "$ROOT"
exec pnpm exec next dev -p "$PORT"
