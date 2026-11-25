# Shared launcher code for scripts/dev.sh and scripts/start.sh. Sourced, not run.
#
# UI: plain Bash; the interactive parts use gum (Charm) when it is available,
# through the ui_* wrappers only. Without gum (bare SSH, CI) the same wrappers
# fall back to numbered lists and `read -p`. NONINTERACTIVE=1 skips every
# question and takes the safe default.

GUM_VERSION="0.17.0"

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TOOLS_BIN="$ROOT/.tools/bin"
API_REPO=${AGENTRY_API_REPO:-$HOME/code/dsh-agents-api}
API_HERDR_NAME=${AGENTRY_API_HERDR_NAME:-agentry-api}
API_WAIT_SECONDS=${AGENTRY_API_WAIT_SECONDS:-120}
NONINTERACTIVE=${NONINTERACTIVE:-0}

export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$TOOLS_BIN:$PATH"

# ---------------------------------------------------------------- gum / UI

HAS_GUM=0
detect_gum() {
  if command -v gum >/dev/null 2>&1; then HAS_GUM=1; else HAS_GUM=0; fi
  # gum needs a terminal; a piped or backgrounded run uses the plain fallback.
  [ -t 0 ] && [ -t 1 ] || HAS_GUM=0
}

interactive() { [ "$NONINTERACTIVE" != 1 ] && [ -t 0 ]; }

# Downloads the pinned gum release into .tools/bin (git-ignored).
install_gum_binary() {
  local arch os url tmp
  case "$(uname -m)" in
    x86_64 | amd64) arch=x86_64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echo "No gum build for $(uname -m); using plain prompts." >&2; return 1 ;;
  esac
  os=$(uname -s)
  url="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}/gum_${GUM_VERSION}_${os}_${arch}.tar.gz"
  tmp=$(mktemp -d)
  if ! curl -fsSL "$url" -o "$tmp/gum.tgz" || ! tar -xzf "$tmp/gum.tgz" -C "$tmp"; then
    rm -rf "$tmp"
    echo "Could not download gum; using plain prompts." >&2
    return 1
  fi
  mkdir -p "$TOOLS_BIN"
  find "$tmp" -type f -name gum -exec install -m 0755 {} "$TOOLS_BIN/gum" \;
  rm -rf "$tmp"
  [ -x "$TOOLS_BIN/gum" ]
}

# Offers gum once when it is missing (a terminal run only).
ensure_gum() {
  detect_gum
  [ "$HAS_GUM" = 1 ] && return 0
  interactive || return 0
  [ -e "$ROOT/.tools/no-gum" ] && return 0
  local answer
  read -r -p "Install gum ${GUM_VERSION} into .tools/bin for nicer menus? [y/N] " answer
  if [[ "$answer" =~ ^[Yy] ]]; then
    install_gum_binary && detect_gum
  else
    mkdir -p "$ROOT/.tools" && touch "$ROOT/.tools/no-gum"
  fi
}

ui_box() {
  if [ "$HAS_GUM" = 1 ]; then
    gum style --border rounded --border-foreground 39 --padding "0 2" --margin "0 0 1 0" "$@"
  else
    printf '== %s ==\n' "$1"
    shift
    for line in "$@"; do printf '   %s\n' "$line"; done
    echo
  fi
}

ui_ok() { if [ "$HAS_GUM" = 1 ]; then gum style --foreground 42 "✔ $*"; else echo "[ok] $*"; fi; }
ui_warn() { if [ "$HAS_GUM" = 1 ]; then gum style --foreground 214 "⚠ $*"; else echo "[!!] $*"; fi; }
ui_err() { if [ "$HAS_GUM" = 1 ]; then gum style --foreground 196 "✘ $*" >&2; else echo "[xx] $*" >&2; fi; }

# ui_choose "Header" option... — prints the chosen option. Non-interactive: the first.
ui_choose() {
  local header=$1
  shift
  if ! interactive; then printf '%s\n' "$1"; return; fi
  if [ "$HAS_GUM" = 1 ]; then
    gum choose --header "$header" "$@"
    return
  fi
  echo "$header" >&2
  local i=1 opt
  for opt in "$@"; do echo "  $i) $opt" >&2; i=$((i + 1)); done
  local n
  while true; do
    read -r -p "Choose [1-$#]: " n
    if [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le $# ]; then
      printf '%s\n' "${!n}"
      return
    fi
  done
}

# ui_spin "Title" command... — runs the command with a spinner (plain: a line before it).
ui_spin() {
  local title=$1
  shift
  if [ "$HAS_GUM" = 1 ]; then
    gum spin --spinner dot --title "$title" -- "$@"
  else
    echo "$title"
    "$@"
  fi
}

# ---------------------------------------------------------------- config

# Reads one key from .env.local / .env (Next's order: .env.local wins) unless already exported.
env_value() {
  local key=$1 file line
  if [ -n "${!key:-}" ]; then printf '%s\n' "${!key}"; return; fi
  for file in "$ROOT/.env.local" "$ROOT/.env"; do
    [ -f "$file" ] || continue
    line=$(grep -E "^${key}=" "$file" | tail -n 1) || continue
    [ -n "$line" ] || continue
    line=${line#*=}
    line=${line%\"}; line=${line#\"}; line=${line%\'}; line=${line#\'}
    printf '%s\n' "$line"
    return
  done
}

port_in_use() { ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN; }

check_port() {
  local port=$1
  if port_in_use "$port"; then
    ui_err "Port $port is already in use (another Agentry Web?)."
    if command -v hc >/dev/null 2>&1; then echo "   Stop it first, e.g. \`hc kill agentry-web\`, or pick another: PORT=3001 $0" >&2; fi
    exit 1
  fi
}

# ---------------------------------------------------------------- Agentry API check

api_healthy() { curl -fsS -m 3 "$1/health" >/dev/null 2>&1; }

wait_for_api() {
  local url=$1 waited=0
  while [ "$waited" -lt "$API_WAIT_SECONDS" ]; do
    api_healthy "$url" && return 0
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# Starts the API through its own launcher in a herdr terminal (when herdr and the repo are here).
start_api() {
  local launcher="$API_REPO/scripts/dev.sh"
  if ! command -v hc >/dev/null 2>&1 || [ ! -x "$launcher" ]; then
    ui_err "Cannot start it from here (needs herdr \`hc\` and $launcher)."
    return 1
  fi
  hc kill "$API_HERDR_NAME" >/dev/null 2>&1 || true
  hc run --bg --no-parent --outlive-parent --name "$API_HERDR_NAME" --cwd "$API_REPO" "$launcher" >/dev/null
  ui_ok "Started the API in herdr terminal \"$API_HERDR_NAME\" (\`hc read $API_HERDR_NAME\` shows its output)."
}

# Makes sure the Agentry API answers /health before the web app starts.
# Interactive: offers to start it, wait for it, continue anyway, or quit.
# Non-interactive: waits up to AGENTRY_API_WAIT_SECONDS, then fails.
require_api() {
  local url
  url=$(env_value AGENTRY_API_URL)
  if [ -z "$url" ]; then
    ui_err "AGENTRY_API_URL is not set (put it in .env.local; see .env.example)."
    exit 1
  fi
  url=${url%/}
  if api_healthy "$url"; then
    ui_ok "Agentry API is up at $url"
    return 0
  fi
  ui_warn "Agentry API is not answering at $url/health"
  if ! interactive; then
    echo "Waiting up to ${API_WAIT_SECONDS}s for it ..."
    if wait_for_api "$url"; then ui_ok "Agentry API is up at $url"; return 0; fi
    ui_err "Agentry API did not come up at $url."
    exit 1
  fi
  while true; do
    local choice
    choice=$(ui_choose "What now?" "Start the API (herdr: $API_HERDR_NAME)" "Wait for it" "Continue without it" "Quit")
    case "$choice" in
      Start*)
        start_api || continue
        ;&
      Wait*)
        if ui_spin "Waiting for $url/health (up to ${API_WAIT_SECONDS}s) ..." bash -c "$(declare -f api_healthy wait_for_api); API_WAIT_SECONDS=$API_WAIT_SECONDS wait_for_api '$url'"; then
          ui_ok "Agentry API is up at $url"
          return 0
        fi
        ui_warn "Still not answering."
        ;;
      Continue*)
        ui_warn "Starting without the API: sign-in works, chats and lists will fail until it is up."
        return 0
        ;;
      *) exit 1 ;;
    esac
  done
}
