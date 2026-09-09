# Co-Managed IT — local dev environment (worktree feature-co-managed-it)

Repair record for the 2026-09-09 smoke-environment mitigation. No secret values
here; secrets live in the gitignored `secrets/` directory and the gitignored
`server/.env.local` / worker `.env` files.

## Topology

| Piece | Where | Notes |
|---|---|---|
| App server | `http://localhost:3374` | Board-owned card service `dev-server` (card `964ce5e0-45a5-41b2-8e2c-73903742a85a`), cwd `server/`, command `PORT=3374 npm run dev` |
| Database | `server_co_managed` on the shared `alga-psa-local-test` postgres, direct `127.0.0.1:5472` | Isolated per-branch DB. PgBouncer (`:6472`) only routes the shared `server` DB, so this branch connects to postgres directly. Full CE+EE chain (1130 migrations) + 89 dev seeds applied via `npm run migrate:ee` and `knex seed:run` (NODE_ENV=migration, admin creds). |
| Redis | shared `alga-psa-local-test` redis `127.0.0.1:6380` | Branch event-bus isolation via `REDIS_PREFIX=alga-psa-comanaged:`. Caveat: the workflow runtime v2 stream client hardcodes `workflow:events:*` (ignores `WORKFLOW_REDIS_STREAM_PREFIX`), so that stream is shared across worktrees on this redis. |
| Temporal | docker container `co-managed-it-temporal-dev` (`temporalio/temporal server start-dev`), gRPC `127.0.0.1:7374`, UI `http://localhost:8374`, namespace `default` | Persistence in `.dev-temporal/temporal-dev.db` (gitignored). Host port 7233 is occupied by another worktree's broken auto-setup container (waits forever for Cassandra) — do not use it. |
| Temporal worker | Board card service `temporal-worker`, cwd `ee/temporal-workflows`, command `npm run start` | Polls `tenant-workflows`, `portal-domain-workflows`, `email-domain-workflows`, `alga-jobs`, `sla-workflows`. Health check `:8375`. |
| Workflow worker | Board card service `workflow-worker`, cwd `services/workflow-worker`, command `sh -c "set -a; . ./.env; set +a; exec npm run start"` | Runtime v2: polls `workflow-runtime-v2` Temporal queue + redis event streams. Health `:4374`. The `.env` must be sourced by the shell because module-level code reads `REDIS_*` before `dotenv.config()` runs. |

## Reproducible preparation (before server/worker start)

1. `secrets/` must contain `credential_encryption_key` and `alga_auth_key`
   (dev-only generated values; `openssl rand`). `initializeApp` fails closed
   without the credential key (EE credentials vault).
2. Build generated outputs: `npx nx build-deps server` (the server `npm run dev`
   does this automatically). The workers additionally need
   `npm run build` in `ee/temporal-workflows` and `services/workflow-worker`
   (tsc + tsc-alias; the tsx `npm run dev` watch scripts do not work in this
   monorepo layout — tsx resolves the `@ee/*` tsconfig alias to the real
   `@ee/lib` package and misses dist-only exports under CJS interop).
3. Generate worker env files: `scripts/dev/generate-co-managed-worker-env.sh`
   (reads `server/.env.local` + `secrets/`, writes the two gitignored `.env`s).

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
