# Co-managed IT review stack — services, readiness and the dev-origin environment

Everything the reviewer touches for card `964ce5e0` / PR #3363 runs as an
**alga-dev card service** under the hub. There are no `systemd --user` units for
this card and none should be reintroduced; the two are mutually exclusive and a
leftover unit is what produced the port-collision failures in earlier rounds.

| Service | Port | cwd | Readiness |
|---|---|---|---|
| `dev-server` | 3374 | `<worktree>/server` | `3374` + `/auth/msp/signin` |
| `temporal-worker` | 8375 | `<worktree>/ee/temporal-workflows` | `8375` + `/health` |
| `workflow-worker` | 4374 | `<worktree>/services/workflow-worker` | `4374` + `/health` |
| `review-guide` | 8874 | `/home/robert/card-reviews/co-managed-it-3363` | `8874` + `/` |

`<worktree>` is `/home/robert/alga-copies/feature-co-managed-it`.

## Registration commands

Run these verbatim.

Two things about them are load-bearing and are the reason they are written out
rather than retyped from memory:

* **Every service is registered through `scripts/dev/run-card-service.sh`, never
  as the bare command.** A service registered bare is a child of a card-service
  PTY and dies when the alga-dev agent swaps itself, which it does every ten to
  twenty minutes. The wrapper's header explains all three ways that has happened
  on this card.
* **Each one passes `--health`.** That is what lets the wrapper's supervisor
  restart a service that is still running but has stopped answering, which is
  the standing failure mode here. Without it the supervisor only reacts to a
  process that exits.

The verb is `workflow-ensure-service`. (An earlier revision of this file said
`workflow-register-service`; there is no such verb.)

```bash
PROJECT=964ce5e0-45a5-41b2-8e2c-73903742a85a
WORKTREE=/home/robert/alga-copies/feature-co-managed-it
RUN="$WORKTREE/scripts/dev/run-card-service.sh"

# The dev server gets a longer grace and a longer probe timeout than the
# default, because `next dev` compiles a route on its first request and a slow
# answer must not be read as no answer.
alga-dev workflow-ensure-service --projectId=$PROJECT --name=dev-server \
  --cwd="$WORKTREE/server" \
  --command="CARD_SERVICE_STARTUP_GRACE=420 CARD_SERVICE_PROBE_TIMEOUT=30 $RUN dev-server \
    --health http://127.0.0.1:3374/auth/msp/signin \
    $WORKTREE/scripts/dev/run-co-managed-dev-server.sh --host 100.82.172.57 --port 3374"

alga-dev workflow-ensure-service --projectId=$PROJECT --name=temporal-worker \
  --cwd="$WORKTREE/ee/temporal-workflows" \
  --command="$RUN temporal-worker --health http://127.0.0.1:8375/health \
    node dist/ee/temporal-workflows/src/worker.js"

alga-dev workflow-ensure-service --projectId=$PROJECT --name=workflow-worker \
  --cwd="$WORKTREE/services/workflow-worker" \
  --command="$RUN workflow-worker --health http://127.0.0.1:4374/health \
    node --env-file=.env ."

alga-dev workflow-ensure-service --projectId=$PROJECT --name=review-guide \
  --cwd=/home/robert/card-reviews/co-managed-it-3363 \
  --command="$RUN review-guide --health http://127.0.0.1:8874/ \
    python3 -m http.server 8874 --bind 0.0.0.0"
```

### Two traps in `workflow-ensure-service`

1. **It refuses a live service whose registered command differs**, with
   `Service "X" is already live with a different command; conclude it first`.
   Changing a command therefore means
   `alga-dev workflow-conclude-service --projectId=$PROJECT --name=X --reason=...`
   and then re-ensuring. It does *not* silently adopt the old command.
2. **It is idempotent when the command matches**, returning `"created": false`.
   That is the desired behaviour for reviving a dead PTY, but it means
   re-ensuring is *not* a way to pick up new code.

### Restarting is adoption, not a cold start

`workflow-restart-service` kills the wrapper in the PTY; the wrapper relaunches
and, finding the recorded supervisor alive, running the same command and
answering its health probe, **adopts it instead of starting a second copy**.
That is deliberate — it is what stops a relaunch from fighting a healthy
process for its port — but it also means a restart alone keeps serving the old
code. To actually cycle a service:

```bash
$WORKTREE/scripts/dev/run-card-service.sh dev-server --stop
alga-dev workflow-restart-service --projectId=$PROJECT --name=dev-server
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
the script invokes the dev entrypoint directly and skips nx.

## The launcher runs `server/dev-server.ts`, not `next dev`

`npm run dev` and `npm run dev:turbo` both run `server/dev-server.ts`, and
`server/src/test/unit/devScriptWiring.test.ts` guards that. Development must not
run Next's built-in dev server: it owns the HTTP `upgrade` event and leaves
upgrades it does not recognise open, and an unanswered handshake holds one of
Chromium's per-origin WebSocket slots, stalling HMR and hydration.
`run-co-managed-dev-server.sh` therefore execs `node node_modules/.bin/tsx
dev-server.ts` — the same entrypoint, without nx.

Two properties of that entrypoint the launcher has to pin:

- **`HOSTNAME`.** `dev-server.ts` binds `process.env.HOSTNAME ?? '0.0.0.0'`.
  Interactive bash exports `HOSTNAME` as the machine name, which would bind the
  listener to that name's single address (127.0.1.1 here) and make the tailnet
  review URL unreachable while `localhost` still answered. `next dev -p` ignored
  `HOSTNAME`, so this trap arrives with the custom entrypoint. The launcher
  exports `HOSTNAME=0.0.0.0`.
- **`NEXT_PUBLIC_HOCUSPOCUS_URL`.** `server/.env.local` ships
  `ws://localhost:1235`, which names the *reviewer's own* machine once the app is
  served over the tailnet. The launcher overrides it to
  `ws://<advertised-host>:<port>/hocuspocus` so the socket goes through the
  entrypoint's bounded proxy. With no hocuspocus upstream running, that answers a
  prompt `502` and the notification hook falls back to its 30s poll.

Verify the upgrade handling with a raw probe rather than trusting the banner:
unrecognised paths must answer `404`, `/hocuspocus` must answer `502` (or
upgrade, if an upstream is running), and `/_next/webpack-hmr` must answer
`101 Switching Protocols`. None of them may hang.

## A port check is not readiness

`workflow-restart-service` for `dev-server` has reported `status:live`
**without spawning a process** (stale PTY). Separately, the app **accepts TCP
while wedged** and then hangs with a 0-byte response. Either way a port probe
says "up".

After every restart, verify with an actual HTTP status:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 http://100.82.172.57:3374/auth/msp/signin
# expect 200
```

That is also why each service above registers a `--readinessPath` and not just a
port: the hub then probes the listener's HTTP response rather than the PTY.

### …and neither is a redirect

The path used to be `/auth/signin`, and that was not a readiness check either.
`/auth/signin` never reaches the App Router — `proxy.ts` answers it with a 307 to
the portal-specific sign-in — so it returns the same 307 whether the router can
resolve anything or nothing.

Human review blocker 6 is what that costs. The registered app was serving the
root **"404 - Page Not Found"** for every `/msp` URL three or more segments deep
— the co-managed shared task, ticket and project detail routes, but equally
`/msp/projects/<id>/tasks/<taskId>`, `/msp/workflows/runs/<id>`,
`/msp/time-entry/timesheet/<id>` and `/msp/settings/integrations/entra`. Shallower
routes were fine. Throughout, `/auth/signin` answered 307, the port was bound,
the supervisor's probe passed and the service record said live.

`/auth/msp/signin` is the shallowest public URL that resolves a page three
segments deep and renders it, so the probe fails when the router's deeper
entries are missing.

## When routes that exist render "404 - Page Not Found"

The truncation above was **in the running Turbopack dev server's app route
table, not in the tree**. Established by experiment on 2026-09-19:

* Every one of those route files was present, tracked, and byte-identical to
  working siblings; nothing was edited to fix it.
* `.next/dev/server/app-paths-manifest.json` *listed* the missing routes, so the
  entrypoints had been compiled — the router simply would not match them.
* The one intervention that cleared it was making any change under
  `server/src/app/**` (moving a directory out and straight back), which forces
  Turbopack to re-derive the app route tree. Every route recovered at once.
* It did not come back: not across a plain restart, not across a wiped `.next`
  with a cold 11 GB Turbopack cache, and not across a restart deliberately
  interrupted 77 s into a cold build (the shape of the restart that preceded it).
* The structure itself is sound. A minimal Next 16.2.12 app reproducing this
  tree — `@modal` slot with eight `(.)` interceptions, a `default.tsx`, a
  `[...catchAll]`, a nested per-section `@modal`, routes up to five segments
  deep — resolves every route in both `next dev` and a production `next build`.

So it is a **dev-runtime defect, not a source defect**, and it is not
deterministic — it could not be re-induced. Next 16.2 turns
`turbopackFileSystemCacheForDev` on by default, which is the only component that
can carry a route table across a restart, but that was not proven to be the
carrier.

If a route that exists renders the root 404:

```bash
# 1. Confirm it is the whole depth band, not one route. Any /msp URL three or
#    more segments deep will show it; a two-segment one will not.
#    (Needs a session cookie — /msp bounces at the proxy otherwise.)
# 2. Force Turbopack to re-derive the route tree.
touch server/src/app/msp/layout.tsx
# 3. Re-probe. If it persists, stop the service and clear the dev cache:
scripts/dev/run-card-service.sh dev-server --stop
rm -rf server/.next
alga-dev workflow-restart-service --projectId=$PROJECT --name=dev-server
```

`server/src/app/msp/co-management/sharedDetailRoutes.contract.test.ts` pins the
*structural* half of this — that the URLs the co-managed surfaces emit resolve,
through Next's own matcher, to the pages they name. It cannot see a dev server
whose route table has gone stale; that is what the readiness path is for.

## When the whole stack dies at once

On 2026-09-19 all four services stopped within the same minute at 18:59Z, three
of them with no error and no exit marker, including a bare `python3 -m
http.server`. That is not four coincidences; it is one shared failure domain.

`run-card-service.sh` routes every service's stdout and stderr to a regular file
under `.card-service-logs/`, and that directory lives on the same volume as the
worktree: **`/home/robert/alga-copies` is btrfs inside a *sparse* 110 GiB
loopback image, `/home/robert/alga-copies.img`, on a root ext4 that had 40 GiB
free.** btrfs reported 35.8 GiB free inside the image, but that space only exists
while the host can still grow the backing file, and the host is shared with
everything else on the box. When writes to that volume started failing
(`Unknown system error -122` — `EDQUOT`), every process whose stdout pointed at
it died. The alga-dev agent service, unrelated to this card, hit the identical
errno six minutes later.

So: **if the stack dies all at once, check host disk first**, not the services.

```bash
df -h /                                  # the loopback image's own filesystem
du -h  /home/robert/alga-copies.img      # allocated, vs 110G apparent
btrfs filesystem usage /home/robert/alga-copies
```

The supervisor added to `run-card-service.sh` cannot prevent this — the cause is
host-level — but it does mean the stack comes back by itself once the host
recovers, instead of staying dead until a human notices. A service that exits is
re-run with backoff (1s, 5s, 15s, then 30s), and a service that is still running
but has stopped answering its `--health` probe is restarted. Restarts are
recorded in the service's own log:

```
=== 2026-09-19T19:21:56Z run-card-service.sh: wedge (pid 1088752) stopped answering http://127.0.0.1:8899/health; restarting
=== 2026-09-19T19:21:56Z run-card-service.sh: wedge exited (status 143); restarting in 1s
```

`<service>.pid` is the **supervisor**; `<service>.child` is the service it is
currently running. `--stop` takes both down, and must be used rather than
killing the pid file, or the supervisor simply restarts what you killed.

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
curl -s -o /dev/null -w 'app %{http_code}\n'   http://100.82.172.57:3374/auth/msp/signin
curl -s -o /dev/null -w 'temporal %{http_code}\n' http://127.0.0.1:8375/health
curl -s -o /dev/null -w 'workflow %{http_code}\n' http://127.0.0.1:4374/health
curl -s -o /dev/null -w 'guide %{http_code}\n'    http://100.82.172.57:8874/
```

## Restarting after editing a workspace package

The dev server on :3374 does **not** reliably hot-reload edits under `packages/` or
`shared/`, and a compile error becomes sticky — it keeps serving the cached
error at stale line numbers. After editing any workspace package:

```bash
npm run build --workspace=@alga-psa/<pkg>      # required for packages/storage:
                                               # the dev server resolves
                                               # @alga-psa/storage/StorageService
                                               # from dist, which is gitignored
                                               # and CI-rebuilt
alga-dev workflow-restart-service --projectId=$PROJECT --name=dev-server
curl -s -o /dev/null -w '%{http_code}\n' http://100.82.172.57:3374/auth/msp/signin
```

Skipping the restart validates stale code; an earlier round got false 200s
exactly that way.
