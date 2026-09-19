# Co-managed IT review stack — services, readiness and the dev-origin environment

Everything the reviewer touches for card `964ce5e0` / PR #3363 runs as an
**alga-dev card service** under the hub. There are no `systemd --user` units for
this card and none should be reintroduced; the two are mutually exclusive and a
leftover unit is what produced the port-collision failures in earlier rounds.

| Service | Port | cwd | Readiness |
|---|---|---|---|
| `dev-server` | 3374 | `<worktree>/server` | `3374` + `/auth/signin` |
| `temporal-worker` | 8375 | `<worktree>/ee/temporal-workflows` | `8375` + `/health` |
| `workflow-worker` | 4374 | `<worktree>/services/workflow-worker` | `4374` + `/health` |
| `review-guide` | 8874 | `/home/robert/card-reviews/co-managed-it-3363` | `8874` + `/` |

`<worktree>` is `/home/robert/alga-copies/feature-co-managed-it`.

## Registration commands

Run these verbatim. `--readinessPath` matters: see *A port check is not
readiness* below.

```bash
PROJECT=964ce5e0-45a5-41b2-8e2c-73903742a85a
WORKTREE=/home/robert/alga-copies/feature-co-managed-it

alga-dev workflow-register-service --projectId=$PROJECT --name=dev-server \
  --cwd="$WORKTREE/server" \
  --command='../scripts/dev/run-co-managed-dev-server.sh' \
  --readinessPort=3374 --readinessPath=/auth/signin

alga-dev workflow-register-service --projectId=$PROJECT --name=temporal-worker \
  --cwd="$WORKTREE/ee/temporal-workflows" \
  --command='node dist/ee/temporal-workflows/src/worker.js' \
  --readinessPort=8375 --readinessPath=/health

alga-dev workflow-register-service --projectId=$PROJECT --name=workflow-worker \
  --cwd="$WORKTREE/services/workflow-worker" \
  --command='node --env-file=.env .' \
  --readinessPort=4374 --readinessPath=/health

alga-dev workflow-register-service --projectId=$PROJECT --name=review-guide \
  --cwd=/home/robert/card-reviews/co-managed-it-3363 \
  --command='python3 -m http.server 8874 --bind 0.0.0.0' \
  --readinessPort=8874 --readinessPath=/
```

## The dev-origin environment is load-bearing

`scripts/dev/run-co-managed-dev-server.sh` exists so this cannot be lost by
retyping a registration. It sets, every time:

```
HOST=http://100.82.172.57:3374
NEXTAUTH_URL=http://100.82.172.57:3374
DEV_ALLOWED_ORIGINS=100.82.172.57,localhost
```

`server/next.config.mjs` reads `DEV_ALLOWED_ORIGINS` into `allowedDevOrigins`.
Without it Next **403s every `/_next/*` HMR, font and RSC request** from a
browser on the tailnet address, and the page stalls at *"Loading
translations…"*. `curl` still returns 200 throughout, so a curl-only check
falsely passes.

`next.config.mjs` now asserts this at startup: if `HOST`/`NEXTAUTH_URL`
advertise a non-loopback host that `DEV_ALLOWED_ORIGINS` does not list, the dev
server refuses to start with an explanatory error instead of serving a
silently-broken page. Plain `next dev` on localhost is unaffected and still
needs no `DEV_ALLOWED_ORIGINS`.

**Do not switch the launch to `npm run dev`.** That goes through nx, whose
build-deps include `server:build` — a full Next production build that has OOMed
repeatedly on this host, even at a 32 GB heap. The workspace dists are prebuilt;
the script invokes `next` directly.

## A port check is not readiness

`workflow-restart-service` for `dev-server` has reported `status:live`
**without spawning a process** (stale PTY). Separately, the app **accepts TCP
while wedged** and then hangs with a 0-byte response. Either way a port probe
says "up".

After every restart, verify with an actual HTTP status:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 http://100.82.172.57:3374/auth/signin
# expect 200 or 307
```

That is also why each service above registers a `--readinessPath` and not just a
port: the hub then probes the listener's HTTP response rather than the PTY.

## Checks before declaring the stack healthy

```bash
# 1. No systemd units for this card, ever.
systemctl --user list-unit-files | grep -i co-managed-3363   # must be empty
ls ~/.config/systemd/user/ | grep -i co-managed              # must be empty

# 2. Every listener is a child of the alga-dev hub, not an orphan.
for p in 3374 8375 4374 8874; do
  pid=$(ss -lptnH "sport = :$p" | grep -oP 'pid=\K[0-9]+' | head -1)
  echo -n "port $p pid=$pid parents:"
  cur=$pid; while [ -n "$cur" ] && [ "$cur" != "1" ]; do
    cur=$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' '); echo -n " $cur"; done; echo
done
# each chain must pass through the hub pid (460951 at time of writing)

# 3. Real HTTP readiness, not a port check.
curl -s -o /dev/null -w 'app %{http_code}\n'   http://100.82.172.57:3374/auth/signin
curl -s -o /dev/null -w 'temporal %{http_code}\n' http://127.0.0.1:8375/health
curl -s -o /dev/null -w 'workflow %{http_code}\n' http://127.0.0.1:4374/health
curl -s -o /dev/null -w 'guide %{http_code}\n'    http://100.82.172.57:8874/
```

## Restarting after editing a workspace package

`next dev` on :3374 does **not** reliably hot-reload edits under `packages/` or
`shared/`, and a compile error becomes sticky — it keeps serving the cached
error at stale line numbers. After editing any workspace package:

```bash
npm run build --workspace=@alga-psa/<pkg>      # required for packages/storage:
                                               # next dev resolves
                                               # @alga-psa/storage/StorageService
                                               # from dist, which is gitignored
                                               # and CI-rebuilt
alga-dev workflow-restart-service --projectId=$PROJECT --name=dev-server
curl -s -o /dev/null -w '%{http_code}\n' http://100.82.172.57:3374/auth/signin
```

Skipping the restart validates stale code; an earlier round got false 200s
exactly that way.
