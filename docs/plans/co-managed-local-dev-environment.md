# Co-Managed IT — local dev environment (worktree feature-co-managed-it)

Repair record for the 2026-09-09 smoke-environment mitigation. No secret values
here; secrets live in the gitignored `secrets/` directory and the gitignored
`server/.env.local` / worker `.env` files.

## Topology

| Piece | Where | Notes |
|---|---|---|
| App server | `http://localhost:3374` | Board-owned card service `dev-server` (card `964ce5e0-45a5-41b2-8e2c-73903742a85a`), cwd `server/`, command `NODE_ENV=development NODE_OPTIONS="--max-old-space-size=32768 --enable-source-maps" PORT=3374 ../node_modules/.bin/next dev`. Do NOT use `npm run dev` here: its `npx nx build-deps server` step forces a full production `server:build` on every nx cache miss, which OOMed at the script's 8 GB heap and kept dying even at 16 GB; running `next dev` directly (turbopack, the same runtime nx's `next:dev` target uses) against prebuilt workspace dists is the reliable path. |
| Database | `server_co_managed` on the shared `alga-psa-local-test` postgres, direct `127.0.0.1:5472` | Isolated per-branch DB. PgBouncer (`:6472`) only routes the shared `server` DB, so this branch connects to postgres directly. Full CE+EE chain (1130 migrations) + 89 dev seeds applied via `npm run migrate:ee` and `knex seed:run` (NODE_ENV=migration, admin creds). |
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
alga-dev workflow-ensure-service --projectId=$P --name=dev-server --cwd=$R/server \
  --command='PORT=3374 HOST=http://100.82.172.57:3374 NEXTAUTH_URL=http://100.82.172.57:3374 DEV_ALLOWED_ORIGINS=100.82.172.57,localhost NODE_ENV=development NODE_PATH=$R/node_modules node $R/node_modules/.bin/next dev -p 3374' \
  --readinessPort=3374 --readinessPath=/auth/signin
alga-dev workflow-ensure-service --projectId=$P --name=temporal-worker --cwd=$R/ee/temporal-workflows \
  --command='node dist/ee/temporal-workflows/src/worker.js' --readinessPort=8375 --readinessPath=/health
alga-dev workflow-ensure-service --projectId=$P --name=workflow-worker --cwd=$R/services/workflow-worker \
  --command='node --env-file=.env .' --readinessPort=4374 --readinessPath=/health
```

`ensure-service` refuses to change the readiness of a service that already
declares one — conclude it first, then re-register. It also will not revive a
service whose PTY has died: after `ensure`, run
`alga-dev workflow-restart-service --projectId=$P --name=<name>`.

The `dev-server` command must keep `HOST`, `NEXTAUTH_URL` and
`DEV_ALLOWED_ORIGINS` verbatim. Without them Next 403s `/_next/*`, HMR, font and
RSC requests from a tailnet browser while `curl` still returns 200, so a port
check passes and the page silently stalls.

Verify with HTTP, never with the service list:

```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3374/auth/signin   # 307
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
