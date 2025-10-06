#!/usr/bin/env bash
# run_async.sh: launch a long-running command in the background without
# blocking the current terminal. Output is redirected to a timestamped log.

set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${ASYNC_LOG_DIR:-${ROOT_DIR}/async-logs}"
mkdir -p "${LOG_DIR}"

timestamp="$(date '+%Y%m%d-%H%M%S')"
safe_cmd="$(printf '%q ' "$@")"
log_file="${LOG_DIR}/async-${timestamp}.log"

echo "[run_async] launching: ${safe_cmd}"
echo "[run_async]    output: ${log_file}"

nohup "$@" >"${log_file}" 2>&1 &
bg_pid=$!
disown "${bg_pid}" >/dev/null 2>&1 || true

echo "[run_async] background pid: ${bg_pid}"
