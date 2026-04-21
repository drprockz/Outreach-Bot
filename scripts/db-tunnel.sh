#!/usr/bin/env bash
# Manage the SSH tunnel to the VPS Postgres.
# Usage:
#   ./scripts/db-tunnel.sh up      # open tunnel (idempotent)
#   ./scripts/db-tunnel.sh down    # close tunnel
#   ./scripts/db-tunnel.sh status  # show whether it's up

set -euo pipefail

VPS_USER="root"
VPS_HOST="193.203.163.180"
LOCAL_PORT="5432"
REMOTE_PORT="5432"
TUNNEL_PATTERN="ssh -fN -L ${LOCAL_PORT}:localhost:${REMOTE_PORT} ${VPS_USER}@${VPS_HOST}"

find_pid() {
  pgrep -f "${TUNNEL_PATTERN}" || true
}

case "${1:-up}" in
  up)
    if [[ -n "$(find_pid)" ]]; then
      echo "tunnel already up (pid $(find_pid))"
      exit 0
    fi
    if lsof -iTCP:${LOCAL_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port ${LOCAL_PORT} already in use by another process — close it first"
      exit 1
    fi
    echo "opening tunnel: localhost:${LOCAL_PORT} -> ${VPS_USER}@${VPS_HOST}:${REMOTE_PORT}"
    ${TUNNEL_PATTERN}
    sleep 1
    if [[ -n "$(find_pid)" ]]; then
      echo "tunnel up (pid $(find_pid))"
    else
      echo "tunnel failed to start"; exit 1
    fi
    ;;
  down)
    pid="$(find_pid)"
    if [[ -z "${pid}" ]]; then
      echo "no tunnel running"
    else
      kill ${pid}
      echo "tunnel stopped (was pid ${pid})"
    fi
    ;;
  status)
    pid="$(find_pid)"
    if [[ -n "${pid}" ]]; then
      echo "up (pid ${pid})"
    else
      echo "down"
    fi
    ;;
  *)
    echo "usage: $0 {up|down|status}"; exit 1;;
esac
