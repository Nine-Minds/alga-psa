# Compose PgBouncer: require password authentication — implementation plan

Card: 18bce850 · PSA ticket alga-2026-0002635 · Branch `feature/security-critical-require-password-auth-in-compo`
Base: `main` @ d6dc22c273. Design only; nothing in this document is implemented yet.

## 1. Current state (code-grounded)

| Fact | Evidence |
|---|---|
| PgBouncer accepts any client for a listed user without checking a password | `pgbouncer/pgbouncer.ini.template:8` `auth_type = trust`, `listen_addr = 0.0.0.0` |
| PgBouncer logs into Postgres with md5 hashes it derives from the secrets | `pgbouncer/entrypoint.sh:24-31,43-47` writes `"app_user" "md5…"` and `"postgres" "md5…"` |
| Only `server` and `postgres` databases are routed | `pgbouncer.ini.template:1-3` |
| Postgres already requires md5 everywhere in compose (sibling card merged) | `docker-compose.base.yaml:182,188` (`password_encryption=md5`, `--auth-host=md5 --auth-local=md5`); `postgres/alga-postgres-entrypoint.sh` rewrites legacy `trust` → `md5` and refuses `POSTGRES_HOST_AUTH_METHOD=trust` |
| Data-plane ports are no longer published by the shared definition (sibling card merged) | `pgbouncer/docker-compose.yaml` has no `ports:`; overlays bind `${EXPOSE_INFRA_BIND_ADDR:-127.0.0.1}` (`docker-compose.ce.yaml:370`, `docker-compose.ee.yaml:442`, `docker-compose.expose-infra.yaml:29`). Port 6432 is still reachable from every container on `app-network`, and from the host where an overlay publishes it |
| A harness already exists and has a placeholder for this card | `scripts/tests/ce-postgres-auth.test.sh` T8 skips "PgBouncer rejects a wrong password" while the template says `trust` (`:484-495`); CI `.github/workflows/ce-postgres-auth.yml` already triggers on `pgbouncer/**` |
| Helm/appliance is not affected | `ee/helm/pgbouncer/templates/configmap.yaml:30` `auth_type = ${AUTH_TYPE:-scram-sha-256}`; `ee/appliance/flux/profiles/single-node/values/pgbouncer.single-node.yaml:21` `authType: scram-sha-256` |

**Empirical check (2026-10-11).** I ran the existing harness (`T1 T8`, `CE_POSTGRES_AUTH_T8=1`) against a scratch copy with only `auth_type = md5` changed. `app_user` and `postgres` connected through 6432 with their secrets, a wrong password was rejected, and all 9 assertions passed. On the live dev stack (`alga-psa-local-test`), the host-run server's `DB_PASSWORD_SERVER` and `DB_PASSWORD_ADMIN` (`server/.env.local`) both hash to the userlist entries. A real psql login as `app_user` through 6472 works.

## 2. Why `trust` was introduced (scope item 2)

The history runs on two branches cut on the same day, 2025-10-04:

1. `5dcdd91c80` ("update PgBouncer configuration for improved security") changed `auth_type = md5` to `trust`. It deleted the userlist and replaced `userlist.txt.template` with the comment `# authentication delegated to Postgres`. The same commit added `SET password_encryption = 'md5'` to `server/setup/create_database.js`, "so PgBouncer (md5 auth) can connect".
2. `538c51cc9d` ("wip / billing test fixups") made the same `md5` → `trust` flip on the other branch. It also added `POSTGRES_HOST_AUTH_METHOD: trust` to `docker-compose.prebuilt.ce.yaml`.
3. `82fca6c190` (2025-10-05) brought the userlist back, as md5 hashes generated in `entrypoint.sh`, but left `auth_type = trust`.

**Root cause.** The md5 userlist (plaintext then, hashed now) could not log into a Postgres whose role passwords were stored as SCRAM, which is the Postgres default. The symptom was "password authentication failed" through PgBouncer, which hit the billing integration runs among others. The fix applied was to make PgBouncer `trust` and believe Postgres would authenticate, together with Postgres `trust`. Under PgBouncer `trust`, though, PgBouncer authenticates to Postgres itself with the stored hash, so Postgres never sees the client's password.

**The real fix is already on main.** Password storage is pinned to md5 on both sides: `postgres -c password_encryption=md5`, `SET password_encryption='md5'` in `create_database.js`, and the Postgres wrapper re-hashing the superuser as md5 during trust removal. The userlist is generated from the same secrets. The remaining work is to turn client authentication back on and remove the drift and edge cases that would turn into outages once it is on (§4).

## 3. Auth scheme decision

**Use `auth_type = md5`.** The sibling Postgres card already standardised compose on md5: `password_encryption=md5`, hba `md5`, and the wrapper writes md5 verifiers. A userlist of md5 hashes can only log into roles with md5 verifiers. SCRAM needs either plaintext passwords in the userlist (the Helm approach) or SCRAM verifiers, and that would mean changing Postgres, the wrapper and `create_database.js` together. Under hba `md5`, Postgres would still accept SCRAM verifiers, so a later move to SCRAM is possible, but it belongs on a separate card (see open question Q2).

## 4. Client inventory under md5

Every client must send the right password for a user in the userlist, to a database listed in `[databases]`.

| Client | Path today | User / DB | Password source | Under md5 |
|---|---|---|---|---|
| server, app pool (all stacks) | pgbouncer | app_user / server | `db_password_server` (`packages/db/src/lib/knexfile.ts:34`; `DATABASE_URL` in ce:60, prebuilt.ce:69, prebuilt.ee:58) | OK |
| server admin plus pg-boss (`getAdminConnection` `packages/db/src/lib/admin.ts:81-88`, `getPostgresConnection` `knexfile.ts:40-52`, `server/src/lib/jobs/jobScheduler.ts:109-128`) | pgbouncer, because `DB_HOST_ADMIN` is unset so it falls back to `DB_HOST` | **postgres** / server | `postgres_password` | OK, but superuser goes through the pooler (§5 B) |
| workflow-worker, email-service (ce, prebuilt.ce, ee, prebuilt.ee, imap.ce) | pgbouncer | app_user plus postgres (admin) / server | both secrets mounted | OK; admin as above |
| temporal-worker (ee:485-534, e2e-emulators:224-240) | pgbouncer | postgres (all activities via `getAdminConnection`) plus app_user / server | `postgres_password` | OK; admin as above |
| setup, CE/prebuilt CE | direct Postgres (`setup/entrypoint.sh` rewrites pgbouncer→postgres:5432; ce:109-113; prebuilt.ce:116-119) | — | — | unaffected |
| setup, CI fresh install | direct (`DB_HOST_ADMIN=postgres` at `e2e-fresh-install-tests.yaml:547-551`) | — | — | unaffected |
| **setup, EE dev** (`docker-compose.ee.yaml:151`, `ee/setup/entrypoint.sh`) | **pgbouncer** for everything, including `CREATE DATABASE` and migrations through transaction pooling | postgres / postgres, server, *hocuspocus* | `postgres_password` | works only while `postgres` stays in the userlist; the hocuspocus step already fails (non-fatal) because that DB is not routed |
| hocuspocus, ce / prebuilt.ce / ee | direct Postgres (ce:318, prebuilt.ce:332, ee:390) | — | — | unaffected |
| **hocuspocus, prebuilt.ee** (`docker-compose.prebuilt.ee.yaml:323`) | pgbouncer | hocuspocus_user / hocuspocus (defaults in `hocuspocus/entrypoint.sh:51-62`) | `db_password_hocuspocus` | **broken today and under md5**: neither the user nor the DB is in PgBouncer. `hocuspocus/entrypoint.sh:85` loops forever |
| **hocuspocus, root `docker-compose.yaml`** (shared env :19-23, service :272-283) | pgbouncer, unless ee.yaml overrides `DB_HOST` (it does in the dev stack) | app_user / server | **`db_password_hocuspocus`**, which is not app_user's password | **breaks newly under md5** when run without the ee overlay; under trust the password is ignored |
| host-run dev server (wire-in, e.g. `server/.env.local` `DB_HOST=127.0.0.1 DB_PORT=6472`, no `DB_HOST_ADMIN`) | pgbouncer for both app and admin | app_user plus postgres | `DB_PASSWORD_SERVER`, `DB_PASSWORD_ADMIN` in `.env.local` | OK (hashes verified); affected by §5 B |
| CI upgrade pooler (`e2e-tests/harness/create-upgrade-pgbouncer.mjs`) | its own pgbouncer built from `pgbouncer/` with an extra `upgrade_ci` DB | app_user; admin direct | `db_password_server` | OK; re-verify in CI |
| `docker-compose.e2e.yaml` (`server_test` through `pgbouncer-test`), `docker-compose.e2e-local.yaml` `pgbouncer-test` | pgbouncer-test | app_user / **server_test** | mounted | **already broken under trust** (`server_test` not routed; `DATABASES_*` env ignored by our entrypoint). Used by `scripts/test-e2e-setup.sh` and `server/src/test/e2e/utils/docker-service-manager.ts` only, not by CI |
| unit / integration tests (`server/vitest.globalSetup.js` via `.env.localtest` → `localhost:5472`, `ee/temporal-workflows/.env.test` → 5432) | direct | — | — | unaffected |

Secret normalisation also matters. Clients `trim()` secrets (`packages/core/src/lib/secrets/FileSystemSecretProvider.ts:83`, `fsSecretCore.ts:357`). The Postgres wrapper strips `\r\n`. `pgbouncer/entrypoint.sh` uses `$(cat)`, which strips only trailing `\n`. A secret with a trailing `\r` or space therefore hashes differently in PgBouncer than the client sends. Today that is invisible. Under md5 it means a lockout.

## 5. Changes

### A. Turn on client authentication (required; ships with or before the Postgres-trust card's release)

1. `pgbouncer/pgbouncer.ini.template`
   - `auth_type = md5`.
   - Comment above it: compose stores md5 verifiers (`password_encryption=md5`), the userlist is derived from the same secrets, and `trust` must never be used.
2. `pgbouncer/entrypoint.sh`
   - Read secrets with the client semantics: trim leading and trailing whitespace including `\r`. Add a one-line comment pointing at `FileSystemSecretProvider` so the two stay aligned.
   - **Fail closed**: exit non-zero if either secret is empty after trimming. Today an empty secret yields `md5(""+user)`.
   - **Fail closed on config drift**: after `envsubst`, refuse to start if the rendered ini has an `auth_type` other than `md5`/`scram-sha-256`. This guards against a mounted override or a hand edit to `trust`. It mirrors what the Postgres wrapper does for `POSTGRES_HOST_AUTH_METHOD=trust`.
   - Leave the hash generation itself unchanged.
3. Delete `pgbouncer/userlist.txt.template` (dead, with the misleading "delegated to Postgres" text) and its `COPY`/`chmod` in `pgbouncer/Dockerfile`. Update `pgbouncer/README.md` with an Authentication section: md5, userlist derived from secrets at start, and rotation means restarting pgbouncer after changing a secret.
4. Fix the two hocuspocus paths that would break or are already broken:
   - `docker-compose.prebuilt.ee.yaml:323-324`: point hocuspocus straight at Postgres (`DB_HOST: postgres`, `DB_PORT: 5432`) and set `DB_NAME_HOCUSPOCUS`/`DB_USER_HOCUSPOCUS` defaults as in `docker-compose.ce.yaml:318-321` and prebuilt.ce. Add `depends_on: postgres` if needed.
   - Root `docker-compose.yaml`: the hocuspocus service gets `DB_HOST: postgres`, `DB_PORT: 5432` and `hocuspocus`/`hocuspocus_user` defaults, matching ce. The shared `x-environment` values `DB_NAME_HOCUSPOCUS: server` / `DB_USER_HOCUSPOCUS: app_user` also feed setup's `setupHocuspocusDatabase`. Today that step sets `app_user`'s password to the hocuspocus secret before the server step resets it. Change those defaults to `hocuspocus`/`hocuspocus_user` so setup and hocuspocus agree. Verify on the dev stack (root + base + ee) that hocuspocus starts and `app_user` keeps the server password.
5. Update the release/upgrade note (see §7).

### B. Take the superuser off PgBouncer (scope item 4; recommended in this card, see Q1)

The superuser is reachable through the pooler today only because admin connections fall back to `DB_HOST`. `getAdminConnection` and `getPostgresConnection` (which pg-boss uses) already honour `DB_HOST_ADMIN`/`DB_PORT_ADMIN`, so no code changes are needed. pg-boss and DDL also behave better on a direct session than through transaction pooling.

1. Add `DB_HOST_ADMIN: postgres` and `DB_PORT_ADMIN: 5432` (overridable via `${DB_HOST_ADMIN:-postgres}`) to every service that mounts `postgres_password` and points `DB_HOST` at pgbouncer. That is server, workflow-worker, email-service and temporal-worker in `docker-compose.ce.yaml`, `docker-compose.prebuilt.ce.yaml`, `docker-compose.ee.yaml`, `docker-compose.prebuilt.ee.yaml`, `docker-compose.imap.ce.yaml`, `docker-compose.e2e-emulators.yaml` and the root `docker-compose.yaml` shared env. Each service needs `depends_on: postgres` (healthy) where it does not already have one.
2. EE dev setup (`docker-compose.ee.yaml:151` and `ee/setup/entrypoint.sh`): route it straight to Postgres the way CE setup does. Either set `DB_HOST: postgres`/`DB_PORT: 5432`/`DB_HOST_ADMIN: postgres`, or reuse the pgbouncer→postgres rewrite from `setup/entrypoint.sh:57-65`. Migrations and `CREATE DATABASE` then stop going through transaction pooling. The hocuspocus DB setup also starts working.
3. `pgbouncer/entrypoint.sh`: write only `app_user` to the userlist. Drop the `postgres` line and the `postgres_password` secret requirement. `pgbouncer/docker-compose.yaml`: drop the `postgres_password` secret and `POSTGRES_USER`.
4. `pgbouncer.ini.template`: remove the `postgres = …` database entry. After step 2 no client uses it, and keeping it would let `app_user` sessions open the maintenance DB.
5. `e2e-tests/harness/create-upgrade-pgbouncer.mjs`: check that it doesn't depend on the `postgres` user or DB, and adjust if it does.
6. Host-run dev servers (wire-in). `.env.local` gets `DB_HOST_ADMIN=127.0.0.1` and `DB_PORT_ADMIN=<published postgres port>` (5472 on `alga-psa-local-test`). Update the `alga-local-wirein`/`alga-env-*` skill scripts and `.env.example` so new wire-ins set these. Without them, the job scheduler and admin paths fail with "password authentication failed" for `postgres` through PgBouncer. This tooling lives outside the repo; flag it to the XO for coordination.

### C. Out of scope (note in PR, do not fix here)

- `docker-compose.e2e.yaml` / `docker-compose.e2e-local.yaml` `pgbouncer-test`: `server_test` is not routed, and our entrypoint ignores the `DATABASES_*` env. These stacks are already broken under trust and not in CI. Open a follow-up card to make the DB list configurable or retire these files.
- Moving compose to SCRAM (Q2).
- Helm: its plaintext userlist does not escape `"` in passwords. That is a separate robustness issue and not a security hole.

## 6. Tests and regression checks

1. **`scripts/tests/ce-postgres-auth.test.sh` T8** (runs in `ce-postgres-auth.yml` on any `pgbouncer/**` or compose change). Remove the `auth_type = trust` skip branch, then assert:
   - `app_user` with its secret → `server` succeeds;
   - **no password** (`-w`, no `PGPASSWORD`) is rejected for `app_user` and `postgres`;
   - **wrong password** is rejected for `app_user` and `postgres`;
   - with B: `postgres` with the *correct* secret through 6432 is rejected, and `-d postgres` as `app_user` is rejected (DB not routed);
   - `sibling_psql` currently hard-codes `-d postgres`. Add a db parameter so the 6432 checks target `server`.
   - Add **T9**: PgBouncer exits non-zero with an empty `db_password_server`, and with an ini forced to `auth_type = trust` (mount override), mirroring T5/T6. Add a trailing-`\r` secret case that still authenticates.
   - Make T8 mandatory in CI (`CE_POSTGRES_AUTH_T8=1` in the workflow) so a build problem cannot quietly skip it.
2. **`.github/workflows/e2e-fresh-install-tests.yaml`**: after "Wait for pgbouncer to be ready" (~:516-540), add a step "PgBouncer requires password authentication". It runs psql from a throwaway container on `alga-e2e-test_app-network` and asserts that no-password and wrong-password are rejected for `app_user` and `postgres`, and that `app_user` with `secrets/db_password_server` succeeds. The rest of the job then proves server, workers, email-service and temporal-worker work end to end on a fresh install with auth on. The upgrade-pooler stage (~:1074-1100) covers the upgrade path.
3. **Static guard**: a check in `scripts/tests/compose-port-exposure.test.mjs`, or a sibling `compose-pgbouncer-auth.test.mjs` if that reads better, that fails if any `pgbouncer*.ini*` in the repo sets `auth_type = trust`. With B, it also fails if any compose service has `DB_HOST` → pgbouncer, mounts `postgres_password`, and lacks `DB_HOST_ADMIN`.
4. **Manual matrix** (evidence in the PR), each run with `docker compose up -d --build`:
   - fresh CE prebuilt (`prebuilt.base + prebuilt.ce`): setup completes, login works, a job runs (pg-boss), and hocuspocus collaborates on a document;
   - fresh EE prebuilt (`prebuilt.base + prebuilt.ee`): the same, plus temporal-worker activity and the hocuspocus fix;
   - dev stack (`docker-compose.yaml + base + ee`, `alga-psa-local-test`): rebuild pgbouncer, restart setup, workers and hocuspocus, and confirm the host-run dev server at :3172 (wire-in env updated for B) logs in and the job scheduler initialises;
   - upgrade: an existing CE volume from v1.6.0 → this branch. Postgres repair runs, pgbouncer rebuilds, and the app works.

## 7. Release / upgrade note (draft)

> PgBouncer now requires password authentication for every connection. PgBouncer is built locally, so existing Docker Compose installs must run `docker compose … up -d --build` (with the same `-f` files as usual) to pick this up. A plain `up -d` keeps running the old image. Bundled services already send the right credentials. External tools that connect to PgBouncer must use the `app_user` password from `secrets/db_password_server`. [With B:] The `postgres` superuser is no longer reachable through PgBouncer; connect to Postgres directly for administration.

Keep the commit, PR and branch wording neutral, with no exploit detail and no advisory id, until the advisory is published.

## 8. Order of work

1. A1–A3 plus T8/T9 harness changes. Run `scripts/tests/ce-postgres-auth.test.sh`.
2. A4 (hocuspocus). Verify on the dev stack and on prebuilt EE.
3. B1–B6 if Q1 = yes. Rerun the harness, then the dev-stack wire-in.
4. The CI fresh-install regression step and the static guard.
5. Manual matrix and release note. PR.

## Open questions

- **Q1 (XO/captain):** ship B (superuser off PgBouncer) in this card? Recommended: yes. The card's acceptance says "rejected for every user", and B is env-only plus one entrypoint line. Its main cost is that every existing host-run wire-in `.env.local` needs `DB_HOST_ADMIN`/`DB_PORT_ADMIN`, which means a skill and tooling update outside this repo. If no, B becomes a follow-up card and A ships alone; A by itself already closes the critical hole.
- **Q2:** md5 is chosen to match the merged Postgres card. Should a follow-up card move compose to SCRAM end to end (Postgres `password_encryption`, wrapper, `create_database.js`, PgBouncer)?
