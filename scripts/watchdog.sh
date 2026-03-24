#!/usr/bin/env bash
set -u

cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
LOG_FILE="./watchdog.log"
PID_FILE="./.watchdog.pid"

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  echo "[$(timestamp)] [watchdog] $*" | tee -a "$LOG_FILE"
}

is_pid_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

acquire_lock() {
  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && is_pid_alive "$old_pid"; then
      log "Watchdog already running with PID $old_pid. Exiting duplicate launcher."
      exit 0
    fi
    rm -f "$PID_FILE"
  fi

  echo "$$" > "$PID_FILE"
}

cleanup_port() {
  local pids
  pids="$(lsof -ti:"$PORT" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    log "Killing existing process(es) on :$PORT -> $pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

on_exit() {
  log "Stopping watchdog by user request."
  rm -f "$PID_FILE"
  exit 0
}

trap on_exit INT TERM

acquire_lock

log "Starting Interstellar with auto-restart on :$PORT"
log "Press Ctrl+C to stop."

cleanup_port

if command -v pnpm >/dev/null 2>&1; then
  START_CMD=(pnpm start)
else
  START_CMD=(npm run start)
fi

log "Using start command: ${START_CMD[*]}"

while true; do
  "${START_CMD[@]}"
  code=$?
  if [[ "$code" -eq 0 ]]; then
    log "Server exited normally with code 0. Not restarting."
    rm -f "$PID_FILE"
    break
  fi

  log "Server crashed with code ${code}. Restarting in 2s..."
  sleep 2
done
