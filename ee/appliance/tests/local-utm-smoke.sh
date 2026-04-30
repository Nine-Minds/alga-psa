#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  local-utm-smoke.sh monitor \
    --status-url http://<node-ip>:8080/api/status \
    --app-url http://<node-ip>:3000 \
    --token <status-token> [--timeout-seconds 3600] [--interval-seconds 5]

  local-utm-smoke.sh verify \
    --kubeconfig <path> \
    --node-ip <ip> \
    --status-token <status-token>

Subtests:
  monitor mode validates T020 by proving status API becomes reachable before app URL is ready.
  verify mode validates T021-T023 using live cluster checks.
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

http_code() {
  local url="$1"
  shift || true
  curl -sS -o /dev/null -w '%{http_code}' "$@" "$url" || true
}

monitor_t020() {
  local status_url=""
  local app_url=""
  local token=""
  local timeout_seconds=3600
  local interval_seconds=5

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --status-url) status_url="$2"; shift 2 ;;
      --app-url) app_url="$2"; shift 2 ;;
      --token) token="$2"; shift 2 ;;
      --timeout-seconds) timeout_seconds="$2"; shift 2 ;;
      --interval-seconds) interval_seconds="$2"; shift 2 ;;
      *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
    esac
  done

  [ -n "$status_url" ] || { echo "--status-url is required" >&2; exit 1; }
  [ -n "$app_url" ] || { echo "--app-url is required" >&2; exit 1; }
  [ -n "$token" ] || { echo "--token is required" >&2; exit 1; }

  require_cmd curl

  local start_ts now elapsed
  start_ts="$(date +%s)"
  local status_first_ts=""
  local app_first_ts=""

  echo "[T020] Monitoring bootstrap timing"
  echo "[T020] status_url=$status_url"
  echo "[T020] app_url=$app_url"

  while true; do
    now="$(date +%s)"
    elapsed=$((now - start_ts))
    if [ "$elapsed" -gt "$timeout_seconds" ]; then
      echo "[T020] FAIL: timed out after ${timeout_seconds}s" >&2
      exit 1
    fi

    if [ -z "$status_first_ts" ]; then
      local status_code
      status_code="$(http_code "${status_url}?token=${token}")"
      if [ "$status_code" = "200" ]; then
        status_first_ts="$now"
        echo "[T020] status API first reachable at +$elapsed s"
      fi
    fi

    if [ -z "$app_first_ts" ]; then
      local app_code
      app_code="$(http_code "$app_url")"
      if [ "$app_code" = "200" ] || [ "$app_code" = "301" ] || [ "$app_code" = "302" ] || [ "$app_code" = "307" ] || [ "$app_code" = "308" ]; then
        app_first_ts="$now"
        echo "[T020] app URL first reachable at +$elapsed s (HTTP $app_code)"
      fi
    fi

    if [ -n "$status_first_ts" ] && [ -n "$app_first_ts" ]; then
      if [ "$status_first_ts" -lt "$app_first_ts" ]; then
        echo "[T020] PASS: status UI became reachable before app URL"
        return 0
      fi
      echo "[T020] FAIL: app URL became reachable before status UI" >&2
      exit 1
    fi

    sleep "$interval_seconds"
  done
}

verify_t021_t023() {
  local kubeconfig=""
  local node_ip=""
  local status_token=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --kubeconfig) kubeconfig="$2"; shift 2 ;;
      --node-ip) node_ip="$2"; shift 2 ;;
      --status-token) status_token="$2"; shift 2 ;;
      *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
    esac
  done

  [ -n "$kubeconfig" ] || { echo "--kubeconfig is required" >&2; exit 1; }
  [ -n "$node_ip" ] || { echo "--node-ip is required" >&2; exit 1; }
  [ -n "$status_token" ] || { echo "--status-token is required" >&2; exit 1; }

  require_cmd kubectl
  require_cmd curl

  local kube=(kubectl --kubeconfig "$kubeconfig")

  echo "[T021] Checking LOGIN_READY conditions"
  local app_code
  app_code="$(http_code "http://${node_ip}:3000")"
  case "$app_code" in
    200|301|302|307|308) ;;
    *) echo "[T021] FAIL: app URL returned unexpected HTTP code $app_code" >&2; exit 1 ;;
  esac

  local users_count
  users_count="$(${kube[@]} -n msp exec db-0 -- sh -c "PGPASSWORD=\$POSTGRES_PASSWORD psql -U postgres -d server -tAc 'select count(*) from users;'" | tr -d '[:space:]')"
  if [ -z "$users_count" ] || [ "$users_count" -le 0 ] 2>/dev/null; then
    echo "[T021] FAIL: expected seeded users > 0, got '${users_count:-<empty>}'" >&2
    exit 1
  fi
  echo "[T021] PASS: app reachable and seeded users=$users_count"

  echo "[T022] Checking background-degraded status classification"
  local status_json
  status_json="$(curl -fsS "http://${node_ip}:8080/api/status?token=${status_token}")"
  printf '%s\n' "$status_json" | jq -e '.rollup.state == "ready_with_background_issues"' >/dev/null
  printf '%s\n' "$status_json" | jq -e '.topBlockers[]? | select(.component == "workflow-worker") | select(.loginBlocking == false)' >/dev/null
  printf '%s\n' "$status_json" | jq -e '.topBlockers[]? | select((.reason // "") | test("not found"; "i"))' >/dev/null
  echo "[T022] PASS: status API reports non-login-blocking workflow-worker missing-tag blocker"

  echo "[T023] Checking Temporal autosetup + service-links hardening"
  local temporal_command temporal_enable temporal_ui_enable temporal_ready temporal_ui_ready
  temporal_command="$(${kube[@]} -n msp get deploy temporal -o jsonpath='{.spec.template.spec.containers[0].command}' 2>/dev/null || true)"
  temporal_enable="$(${kube[@]} -n msp get deploy temporal -o jsonpath='{.spec.template.spec.enableServiceLinks}' 2>/dev/null || true)"
  temporal_ui_enable="$(${kube[@]} -n msp get deploy temporal-ui -o jsonpath='{.spec.template.spec.enableServiceLinks}' 2>/dev/null || true)"
  temporal_ready="$(${kube[@]} -n msp get deploy temporal -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  temporal_ui_ready="$(${kube[@]} -n msp get deploy temporal-ui -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"

  printf '%s' "$temporal_command" | grep -q 'autosetup' || { echo "[T023] FAIL: temporal command does not include autosetup" >&2; exit 1; }
  [ "$temporal_enable" = "false" ] || { echo "[T023] FAIL: temporal enableServiceLinks expected false, got '$temporal_enable'" >&2; exit 1; }
  [ "$temporal_ui_enable" = "false" ] || { echo "[T023] FAIL: temporal-ui enableServiceLinks expected false, got '$temporal_ui_enable'" >&2; exit 1; }
  [ -n "$temporal_ready" ] && [ "$temporal_ready" -ge 1 ] 2>/dev/null || { echo "[T023] FAIL: temporal deployment not ready" >&2; exit 1; }
  [ -n "$temporal_ui_ready" ] && [ "$temporal_ui_ready" -ge 1 ] 2>/dev/null || { echo "[T023] FAIL: temporal-ui deployment not ready" >&2; exit 1; }
  echo "[T023] PASS: Temporal and Temporal UI are ready with autosetup and service links disabled"
}

main() {
  if [ "$#" -lt 1 ]; then
    usage
    exit 1
  fi

  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    monitor)
      shift
      monitor_t020 "$@"
      ;;
    verify)
      shift
      verify_t021_t023 "$@"
      ;;
    *)
      echo "unknown mode: $1" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
