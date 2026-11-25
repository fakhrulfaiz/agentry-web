#!/usr/bin/env bash
# Agentry Web for development: `next dev` (hot reload, slow first visits, no prefetch).
# Checks that the Agentry API answers first. PORT (default 3000), NONINTERACTIVE=1.
set -eo pipefail
source "$(dirname "$0")/lib/launch.sh"

PORT=${PORT:-3000}
ensure_gum
ui_box "Agentry Web · development" "next dev on http://localhost:$PORT" "For daily use, scripts/start.sh is much faster."
require_api
check_port "$PORT"

cd "$ROOT"
exec pnpm exec next dev -p "$PORT"
