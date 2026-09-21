#!/usr/bin/env bash
#
# Run a long-lived card-service process so that it survives the two ways a
# card-service PTY kills the thing attached to it.
#
# FAILURE MODE 1 -- the PTY wedges the process (blocking write)
#
# A card service's stdout/stderr are a PTY slave, and Node opens fd 1 for a TTY
# in BLOCKING mode (no O_NONBLOCK) -- writes to a TTY are synchronous. If
# nothing drains the PTY master, the ~64KB line discipline buffer fills and the
# next `console.log` blocks the main thread inside write(2). The event loop
# stops. Everything downstream of that looks alive but answers nothing:
#
#   * the process stays in S (sleeping), wchan=wait_woken, and burns no CPU;
#   * its listening sockets survive, because they are kernel objects, so TCP
#     connects still complete -- they just pile up unaccepted in the accept
#     queue (`ss -ltn` shows a non-zero Recv-Q on the LISTEN row);
#   * an HTTP probe therefore connects successfully and then receives ZERO
#     bytes and times out, rather than being refused.
#
# That is exactly how both co-managed workers were found on 2026-09-19: PIDs
# ~4h old, /health never answering, Recv-Q=4 on ports 8375 and 4374. The
# masters for their PTYs had been leaked by fd inheritance into unrelated
# long-lived processes (other worktrees' dev servers, stray shells), so the
# PTYs were never hung up and never read -- writes did not fail, they just
# blocked forever. Reproduced end to end in a control: a Node HTTP server
# logging 2KB every 5ms onto an undrained PTY stops answering within a second
# while its listener stays up.
#
# Fix: a regular file can never apply that backpressure, so the service's
# output goes to one. The PTY carries only this script's fixed-size banner.
#
# FAILURE MODE 2 -- the agent service swaps and SIGHUPs the whole PTY
#
# Routing output to a file was not enough. Three services registered at
# 15:25:46Z on 2026-09-19 were dead by 15:25:53Z, logs ending mid-stream with
# no error and no exit marker. The journal names the killer exactly:
#
#   11:25:53 node[1883404]: [supervisor] service exited for swap
#   11:25:53 node[1883404]: [supervisor] promoted 202609191525-gac083025a5
#
# `~/alga-dev/ghostty-pane-ide/scripts/host-supervisor.mjs` runs the alga-dev
# agent service under a `for(;;)` loop and the agent self-updates: it drains,
# exits with the swap code, and the supervisor spawns the new release. Every
# card-service PTY lives inside that process. node-pty's forkpty puts each
# card service in its OWN session with the PTY slave as controlling terminal,
# so when the agent exits and the master fd closes, the kernel delivers SIGHUP
# to the foreground process group of every one of those sessions. Since the
# registered command `exec`s the service, the service IS the session leader and
# takes the SIGHUP. It dies without writing anything.
#
# This is not rare. On 2026-09-19 the agent swapped at 11:08, 11:25, 11:34 and
# 11:52 -- roughly every ten to twenty minutes. Anything whose lifetime is tied
# to a card-service PTY cannot stay up for an afternoon, let alone overnight.
# (The `review-guide` service survived four swaps only by accident: its PTY
# master had been leaked into an unrelated long-lived process, so the master
# never closed and the SIGHUP was never sent -- failure mode 1 protecting
# against failure mode 2.)
#
# Fix: start the service with setsid(), in a session of its own with no
# controlling terminal, so the PTY teardown has no signal path to it. The
# service is then reparented to systemd --user and outlives any number of agent
# swaps. This wrapper stays in the foreground of the PTY and only watches.
#
# FAILURE MODE 3 -- the volume under the log file refuses writes
#
# Routing output to a regular file removed the PTY backpressure, but it also
# gave all four services one shared failure domain: the log directory. On
# 2026-09-19 every card service -- including a bare `python3 -m http.server`
# with no application code of its own -- stopped within the same minute at
# 18:59Z, three of them with no error and no exit marker at all. The fourth,
# `dev-server`, named the cause on its way out:
#
#   Failed to flush logs to file: Error: Unknown system error -122 ... write
#
# errno 122 is EDQUOT. The alga-dev agent service, an unrelated process, hit the
# identical `-122 ... write` six minutes later, so this was never a property of
# any one service: writes to that storage were failing process-wide, and a
# process whose stdout cannot be written does not survive it.
#
# The storage is the reason. `/home/robert/alga-copies` -- which holds every
# worktree AND this log directory -- is a btrfs filesystem inside a SPARSE
# 110 GiB loopback image, `/home/robert/alga-copies.img`, on a root ext4 that
# had 40 GiB free. btrfs reported 35.8 GiB free inside the image, but that space
# only exists if the host can still grow the image, and the host is shared with
# everything else on the box. The inner filesystem's idea of free space is a
# promise the outer one had not reserved and could not keep.
#
# That cause is host-level and no wrapper can fix it. What a wrapper can fix is
# the consequence: the service staying dead afterwards. This script used to
# watch the service and exit when it died, so a transient host condition ended
# the review stack permanently and a human had to notice and restart it.
#
# Fix: the detached side is a supervisor, not the service itself. It re-runs the
# service whenever it exits, backing off to 30s, and -- when --health is given
# -- restarts a process that is running but has stopped answering, which is
# failure mode 1 returning in any new shape. Because the supervisor is the thing
# that gets detached, it survives agent swaps exactly as the service used to,
# and the stack heals itself once the host recovers.
#
# ADOPTION
#
# Detaching the service means a relaunch could collide with a still-healthy
# process on the same port -- the precise pathology the systemd units had.
# So a relaunch adopts instead: if the recorded PID is alive, runs this same
# command, and (when --health is given) answers its probe, the wrapper attaches
# to it rather than starting a second copy. Re-registering or restarting the
# card service is therefore idempotent and never fights itself for a port.
#
# Usage:
#   scripts/dev/run-card-service.sh <service-name> [--health <url>] <command> [args...]
#
# Register it as the card service command, e.g.:
#   alga-dev workflow-ensure-service --projectId=<id> --name=temporal-worker \
#     --cwd=<dir> \
#     --command='../../scripts/dev/run-card-service.sh temporal-worker --health http://127.0.0.1:8375/health node dist/.../worker.js' \
#     --readinessPort=8375 --readinessPath=/health
#
# To stop a detached service (the card service's own kill only reaches this
# wrapper):
#   scripts/dev/run-card-service.sh <service-name> --stop
#
set -uo pipefail

if [ $# -lt 2 ]; then
  echo "usage: run-card-service.sh <service-name> [--health <url>] <command> [args...]" >&2
  echo "       run-card-service.sh <service-name> --stop" >&2
  exit 2
fi

SERVICE_NAME="$1"; shift

HEALTH_URL=""
STOP_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --health) HEALTH_URL="$2"; shift 2 ;;
    --stop) STOP_ONLY=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_DIR="${CARD_SERVICE_LOG_DIR:-$REPO_ROOT/.card-service-logs}"
mkdir -p "$RUN_DIR"
LOG_FILE="$RUN_DIR/$SERVICE_NAME.log"
PID_FILE="$RUN_DIR/$SERVICE_NAME.pid"
CMD_FILE="$RUN_DIR/$SERVICE_NAME.cmd"
CHILD_FILE="$RUN_DIR/$SERVICE_NAME.child"
# Marker in the supervisor's argv so a live process can be recognised as ours.
SUPERVISOR_TAG="card-service-supervisor"
# How long a freshly started service may take to answer its health probe before
# the supervisor counts misses against it. `next dev` compiles on first request.
STARTUP_GRACE="${CARD_SERVICE_STARTUP_GRACE:-180}"
# How long one probe may take before it counts as a miss. A dev server still
# compiling a route answers slowly, not never, and must not be restarted for it.
PROBE_TIMEOUT="${CARD_SERVICE_PROBE_TIMEOUT:-10}"

# The detached service's own timestamped marker, so "did it die or was it never
# started" is answerable from the log alone.
stamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

recorded_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

# A recycled PID must not be mistaken for the supervisor. The recorded command
# line is compared against the live one before the wrapper will adopt it. The
# supervisor carries the service command as its own trailing argv precisely so
# this stays checkable from /proc alone.
pid_matches_command() {
  local pid="$1"
  [ -f "$CMD_FILE" ] || return 1
  local want live
  want="$(cat "$CMD_FILE")"
  live="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
  [ -n "$live" ] || return 1
  case "$live" in
    *"$SUPERVISOR_TAG "*" ${want% } ") return 0 ;;
  esac
  [ "${live% }" = "${want% }" ]
}

# The service the supervisor is currently running, for diagnostics and --stop.
child_pid() {
  local pid
  pid="$(cat "$CHILD_FILE" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

healthy() {
  [ -n "$HEALTH_URL" ] || return 0
  curl -fsS -o /dev/null -m 5 "$HEALTH_URL" 2>/dev/null
}

# Stopping has to reach the supervisor first, otherwise it would simply restart
# the service it was told to give up on. The supervisor takes its child with it
# on SIGTERM; the child is killed here too in case the supervisor was already
# gone, or died hard enough not to run its trap.
stop_service() {
  local pid child
  child="$(child_pid || true)"
  if pid="$(recorded_pid)"; then
    echo "stopping $SERVICE_NAME (supervisor $pid${child:+, service $child})"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  if [ -n "$child" ]; then
    kill "$child" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$child" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$child" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" "$CHILD_FILE"
  [ -n "$pid" ] || [ -n "$child" ]
}

if [ "$STOP_ONLY" = 1 ]; then
  stop_service || echo "$SERVICE_NAME is not running"
  rm -f "$CMD_FILE"
  exit 0
fi

if [ $# -lt 1 ]; then
  echo "usage: run-card-service.sh <service-name> [--health <url>] <command> [args...]" >&2
  exit 2
fi

COMMAND_LINE="$*"
ADOPTED=0
SERVICE_PID=""

if pid="$(recorded_pid)" && pid_matches_command "$pid" && healthy; then
  SERVICE_PID="$pid"
  ADOPTED=1
else
  # Not adoptable. If something stale is recorded, retire it before rebinding
  # the port, otherwise the new copy dies on EADDRINUSE and the old wedged one
  # keeps answering nothing.
  if recorded_pid >/dev/null || child_pid >/dev/null; then
    echo "retiring unhealthy $SERVICE_NAME"
    stop_service || true
  fi
  rm -f "$PID_FILE" "$CHILD_FILE"

  # Keep one previous run so a crash loop is still diagnosable after a relaunch.
  if [ -f "$LOG_FILE" ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.prev"
  fi
  printf '%s\n' "$COMMAND_LINE" > "$CMD_FILE"
  { echo "=== $(stamp) run-card-service.sh starting $SERVICE_NAME: $COMMAND_LINE"; } >> "$LOG_FILE"

  # setsid() puts the supervisor in a new session with no controlling terminal,
  # so the SIGHUP that the agent-service swap sends to this PTY's session cannot
  # reach it or the service beneath it. stdin is /dev/null and stdout/stderr are
  # a regular file, so no descriptor of this PTY survives into either process.
  #
  # The supervisor -- not the service -- is what gets detached, so the service
  # is restarted in place whenever it exits or stops answering. Nothing in this
  # loop may be fatal on a failed write: the whole point of failure mode 3 is
  # that writing to this log is exactly what stops working, and a supervisor
  # that dies of its own logging is no supervisor at all.
  setsid bash -c '
    set -u
    pid_file="$1"; child_file="$2"; health="$3"; grace="$4"; probe_timeout="$5"; name="$6"; shift 6
    echo $$ > "$pid_file"
    stamp() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }
    child=""; probe=""
    # Named, so the handler body needs no quoting of its own -- a single quote
    # here would close the supervisor script this whole loop is written inside.
    # The probe is killed too: it outlives its supervisor otherwise, and would
    # then restart a service nobody is supervising any more.
    on_term() {
      [ -n "$probe" ] && kill "$probe" 2>/dev/null
      [ -n "$child" ] && kill -TERM "$child" 2>/dev/null
      rm -f "$child_file"; exit 0
    }
    trap on_term TERM INT
    restarts=0
    while :; do
      started=$(date +%s)
      "$@" &
      child=$!
      echo "$child" > "$child_file"

      if [ -n "$health" ]; then
        # Watch for a process that is running but has stopped answering. Three
        # consecutive misses after the startup grace, so a slow request or a
        # single dropped probe never restarts a working service.
        (
          sleep "$grace"
          misses=0
          while kill -0 "$child" 2>/dev/null; do
            if curl -fsS -o /dev/null -m "$probe_timeout" "$health" 2>/dev/null; then
              misses=0
            else
              misses=$((misses + 1))
              if [ "$misses" -ge 3 ]; then
                echo "=== $(stamp) run-card-service.sh: $name (pid $child) stopped answering $health; restarting" || true
                kill -TERM "$child" 2>/dev/null
                sleep 10
                kill -9 "$child" 2>/dev/null
                exit 0
              fi
            fi
            sleep 10
          done
        ) &
        probe=$!
      else
        probe=""
      fi

      wait "$child"; status=$?
      child=""
      [ -n "$probe" ] && kill "$probe" 2>/dev/null
      rm -f "$child_file"

      # A service that stayed up is not in a crash loop; only consecutive fast
      # failures back off, so a one-off death is recovered from immediately.
      if [ $(( $(date +%s) - started )) -ge 120 ]; then restarts=0; else restarts=$((restarts + 1)); fi
      case "$restarts" in 0|1) delay=1 ;; 2) delay=5 ;; 3) delay=15 ;; *) delay=30 ;; esac
      echo "=== $(stamp) run-card-service.sh: $name exited (status $status); restarting in ${delay}s" || true
      sleep "$delay"
    done
  ' "$SUPERVISOR_TAG" "$PID_FILE" "$CHILD_FILE" "$HEALTH_URL" "$STARTUP_GRACE" "$PROBE_TIMEOUT" "$SERVICE_NAME" "$@" \
    </dev/null >>"$LOG_FILE" 2>&1 &
  disown || true

  for _ in $(seq 1 50); do
    SERVICE_PID="$(recorded_pid || true)"
    [ -n "$SERVICE_PID" ] && break
    sleep 0.1
  done
  if [ -z "$SERVICE_PID" ]; then
    echo "failed to start $SERVICE_NAME -- see $LOG_FILE" >&2
    tail -20 "$LOG_FILE" >&2 || true
    exit 1
  fi
fi

# Fixed-size banner: this is the ONLY thing written to the PTY before the watch
# loop, so it can never approach the line-discipline buffer limit no matter how
# chatty the service is.
echo "card service : $SERVICE_NAME"
echo "  command    : $COMMAND_LINE"
echo "  cwd        : $(pwd)"
echo "  supervisor : $SERVICE_PID $([ "$ADOPTED" = 1 ] && echo '(adopted -- already running and healthy)' || echo '(started detached)')"
echo "  service    : $(child_pid || echo '<starting>')"
echo "  session    : detached (setsid); survives alga-dev agent-service swaps"
echo "  restarts   : supervised; re-run on exit, and on a lost health probe"
echo "  log        : $LOG_FILE"
echo "  previous   : $LOG_FILE.prev"
echo "  follow     : tail -f $LOG_FILE"
echo "  health     : ${HEALTH_URL:-<none configured>}"
echo "  stop       : $(dirname "${BASH_SOURCE[0]}")/run-card-service.sh $SERVICE_NAME --stop"
echo
echo "Output is routed to the log file on purpose -- see the header of"
echo "scripts/dev/run-card-service.sh. A blank terminal here is expected and"
echo "is NOT a sign the service failed to start; check the log."

# This wrapper is the PTY's session leader and is the thing that dies on an
# agent-service swap. Leaving the service running when that happens is the
# whole point, so the watch loop must not clean up on the way out.
trap 'exit 0' HUP TERM INT

while kill -0 "$SERVICE_PID" 2>/dev/null; do
  sleep 5
done

# Reaching here means the supervisor itself is gone, which a service exiting no
# longer causes. Do not clear the child record: if the supervisor was killed
# without running its trap, the service may still be up, and the next launch
# must find it to retire it rather than colliding with it on the port.
echo "$(stamp) $SERVICE_NAME supervisor (pid $SERVICE_PID) exited; last log lines:"
tail -20 "$LOG_FILE" 2>/dev/null || true
rm -f "$PID_FILE"
exit 1
