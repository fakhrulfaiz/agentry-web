#!/usr/bin/env bash
# Agentry Web, production build: `next build` then `next start` (prefetch and the client cache on).
# Checks that the Agentry API answers first. Rebuilds only when the source changed since the
# last build, unless --rebuild / --no-build. PORT (default 3000), NONINTERACTIVE=1.
set -eo pipefail
source "$(dirname "$0")/lib/launch.sh"

PORT=${PORT:-3000}
BUILD=auto
for arg in "$@"; do
  case "$arg" in
    --rebuild) BUILD=always ;;
    --no-build) BUILD=never ;;
    -h | --help)
      sed -n '2,4p' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Whether anything the build reads is newer than the last build.
stale_build() {
  local stamp="$ROOT/.next/BUILD_ID"
  [ -f "$stamp" ] || return 0
  [ -n "$(find "$ROOT/app" "$ROOT/src" "$ROOT/next.config.ts" "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/postcss.config.mjs" "$ROOT/.env.local" "$ROOT/.env" -newer "$stamp" -print -quit 2>/dev/null)" ]
}

ensure_gum
ui_box "Agentry Web · production" "next build + next start on http://localhost:$PORT"
require_api
check_port "$PORT"

cd "$ROOT"
case "$BUILD" in
  always) need=1 ;;
  never) need=0 ;;
  *) if stale_build; then need=1; else need=0; fi ;;
esac
if [ "$need" = 1 ]; then
  echo "Building (the source changed since the last build) ..."
  pnpm build
  ui_ok "Build done."
else
  ui_ok "Build is up to date (--rebuild to force)."
fi

exec pnpm exec next start -p "$PORT"
