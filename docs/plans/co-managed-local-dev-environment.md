# Co-Managed IT — local dev environment (worktree feature-co-managed-it)

Repair record for the 2026-09-09 smoke-environment mitigation. No secret values
here; secrets live in the gitignored `secrets/` directory and the gitignored
`server/.env.local` / worker `.env` files.

## Topology

| Piece | Where | Notes |
|---|---|---|
| App server | `http://feature-co-managed-it.localhost:3374` | Board-owned card service `dev-server` (card `964ce5e0-45a5-41b2-8e2c-73903742a85a`), cwd `server/`, registered through `scripts/dev/run-card-service.sh` and launched by `scripts/dev/run-co-managed-dev-server.sh`. The wrapper sets the canonical app/auth origin and `DEV_ALLOWED_ORIGINS`; keep this separate from the production review app on `:23374`. Do NOT use `npm run dev` here: its `npx nx build-deps server` step forces a full production `server:build` on cache misses; use the documented launcher against prebuilt workspace dists. |
| Database | `server_co_managed` at `127.0.0.1:5376` | Card-owned PostgreSQL. Recheck the configured target before use; do not reconnect to historical port `5472` or recreate shared infrastructure. |
| Redis | dedicated branch redis, docker container `co-managed-it-redis`, `127.0.0.1:6374` (password = `secrets/redis_password`) | A DEDICATED instance is required for isolation: the workflow runtime v2 stream client (`shared/workflow/streams/redisStreamClient.ts`) hardcodes `workflow:events:*` stream names and the `workflow-runtime-v2` consumer group, ignoring `WORKFLOW_REDIS_STREAM_PREFIX` — on a shared redis this branch's worker would consume other worktrees' events. Recreate with: `docker run -d --name co-managed-it-redis --restart unless-stopped -p 6374:6379 -e RP="$(cat secrets/redis_password)" redis:7-alpine sh -c 'exec redis-server --requirepass "$RP"'` (env-var passing avoids shell mangling of special characters in the password). |
| Temporal | docker container `co-managed-it-temporal-dev` (`temporalio/temporal server start-dev`), gRPC `127.0.0.1:7374`, UI `http://localhost:8374`, namespace `default` | Persistence in `.dev-temporal/temporal-dev.db` (gitignored). Host port 7233 is occupied by another worktree's broken auto-setup container (waits forever for Cassandra) — do not use it. |
| Temporal worker | Board card service `temporal-worker`, cwd `ee/temporal-workflows`, command `node dist/ee/temporal-workflows/src/worker.js` | Polls `tenant-workflows`, `portal-domain-workflows`, `email-domain-workflows`, `alga-jobs`, `sla-workflows`. Health check `:8375`, gated on `ENABLE_HEALTH_CHECK=true` with the port from `HEALTH_CHECK_PORT` (both set by `scripts/dev/generate-co-managed-worker-env.sh`). `worker.ts` calls `dotenv.config()` itself, so no env wrapper is needed. |
| Workflow worker | Board card service `workflow-worker`, cwd `services/workflow-worker`, command `node --env-file=.env .` | Runtime v2: polls `workflow-runtime-v2` Temporal queue + redis event streams. Health `:4374` (the port comes from `PORT` in `.env`, not `HEALTH_PORT`). Module-level code reads `REDIS_*` before `dotenv.config()` runs, so the environment must be present at process start — but do NOT use `sh -c "set -a; . ./.env; set +a; ..."` to do it: `DB_PASSWORD_SERVER` and `REDIS_PASSWORD` contain an unquoted `&`, which bash parses as the background operator, so both arrive **empty** and the worker authenticates with no password. `node --env-file` parses the file without a shell. |

## Registering the services with readiness probes

`workflow-ensure-service` accepts `--readinessPort` and `--readinessPath`. Neither
appears in `--help`, and without them a service that has died still reports
`live`, because the hub is then only watching the PTY. Register all four with a
probe so liveness is an HTTP status rather than a registration status:

```
P=964ce5e0-45a5-41b2-8e2c-73903742a85a
R=/home/robert/alga-copies/feature-co-managed-it
RUN="$R/scripts/dev/run-card-service.sh"
alga-dev workflow-ensure-service --projectId=$P --name=dev-server --cwd=$R/server \
  --readinessPort=3374 --readinessPath=/auth/msp/signin \
  --command="CARD_SERVICE_STARTUP_GRACE=420 CARD_SERVICE_PROBE_TIMEOUT=30 $RUN dev-server --health http://127.0.0.1:3374/auth/msp/signin $R/scripts/dev/run-co-managed-dev-server.sh"
# Thereafter this commandless invocation revives the same board-owned service:
alga-dev workflow-ensure-service --projectId=$P --name=dev-server
alga-dev workflow-ensure-service --projectId=$P --name=temporal-worker --cwd=$R/ee/temporal-workflows \
  --command='node dist/ee/temporal-workflows/src/worker.js' --readinessPort=8375 --readinessPath=/health
alga-dev workflow-ensure-service --projectId=$P --name=workflow-worker --cwd=$R/services/workflow-worker \
  --command='node --env-file=.env .' --readinessPort=4374 --readinessPath=/health
```

`ensure-service` refuses to change the readiness of a service that already
declares one — conclude it first, then re-register. It also will not revive a
service whose PTY has died: after `ensure`, run
`alga-dev workflow-restart-service --projectId=$P --name=<name>`.

The `dev-server` launcher sets `HOST`, `NEXTAUTH_URL` and
`DEV_ALLOWED_ORIGINS` to the canonical `feature-co-managed-it.localhost:3374`
origin. Keep these aligned with `server/.env.local` so sign-in cookies and
redirects stay on the dev origin. Without the allowed origin, Next can 403
`/_next/*` requests while a plain page request still returns 200.

Verify with HTTP, never with the service list:

```
curl -s -o /dev/null -w '%{http_code}\n' http://feature-co-managed-it.localhost:3374/auth/msp/signin   # expect 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8375/health        # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4374/health        # 200
```

## Reproducible preparation (before server/worker start)

1. `secrets/` must contain `credential_encryption_key` and `alga_auth_key`
   (dev-only generated values; `openssl rand`). `initializeApp` fails closed
   without the credential key (EE credentials vault).
2. Build generated outputs: `npx nx build-deps server` once (expect the
   included production `server:build` to take ~10 min and need a large heap:
   `NODE_OPTIONS=--max-old-space-size=16384`), or the targeted equivalents the
   dev server actually needs: `npm run build --workspace=@alga-psa/shared
   --workspace=@alga-psa/co-managed --workspace=@alga-psa/workflows` (plus any
   other dist-consumed package the boot log complains about). The workers
   additionally need `npm run build` in `ee/temporal-workflows` and
   `services/workflow-worker` (tsc + tsc-alias; the tsx `npm run dev` watch
   scripts do not work in this monorepo layout — tsx resolves the `@ee/*`
   tsconfig alias to the real `@ee/lib` package and misses dist-only exports
   under CJS interop).
3. Generate worker env files AND copy onboarding seeds into the worker dist:
   `scripts/dev/generate-co-managed-worker-env.sh` (reads `server/.env.local` +
   `secrets/`, writes the two gitignored `.env`s, and replicates the
   Dockerfile's `dist/seeds/onboarding` copy that provisioning needs).
4. Start/restart the three board card services (`dev-server`,
   `temporal-worker`, `workflow-worker`) via `alga-dev workflow-restart-service
   --projectId=964ce5e0-... --name=<svc>`; verify with `alga-dev list-sessions`
   + `pgrep` that a PTY and process actually exist (see gotcha below), then
   confirm the dev-server boot log reaches "Credential vault encryption
   configuration validated" and prints the dev password banner.

## Known repairs encoded in this branch

- `shared/tsup.config.ts`: added entries for `core/index`,
  `lib/ticketChecklists/index`, `lib/ticketCloseRules/index` — these were
  exported in `shared/package.json` as dist targets but never built, which
  broke `@alga-psa/co-managed/workflowTicketMutation` (imported from
  `server/src/lib/initializeApp.ts:1`) for every plain-Node consumer.
- `packages/co-managed/src`: ~35 strict-mode type errors fixed (mostly
  `(): never` helper annotations restoring control-flow narrowing); these
  blocked the `ee/temporal-workflows` production build.
- `server/.env.local` `REDIS_PASSWORD` had drifted from
  `secrets/redis_password` (the file is authoritative — the server reads the
  file, env-only consumers got WRONGPASS).

## Board-service gotcha

If a card service record says `live` but its PTY session is missing
(`terminal-get-content` → "Terminal session not found"), `workflow-restart-service`
reports success without spawning anything. Recovery:
`workflow-conclude-service` then `workflow-ensure-service` (a second `ensure`
may be needed — verify with `alga-dev list-sessions` and `pgrep`).
