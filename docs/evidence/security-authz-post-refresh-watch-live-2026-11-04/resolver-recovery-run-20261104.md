# Resolver recovery and fresh runtime verification — 2026-11-04

This follow-up supersedes the runtime-blocked observations in `takeover-run-20261104T1938Z.md` for events after the scheduler restart.

## Revision and repair

- Checkout: `/home/robert/alga-copies/feature-security-authz-in-post-3`
- Branch: `feature-security-authz-in-post-3`
- Base before this follow-up: `2efc64a2617bc10ed8012f4101a6c30cade12dbb`
- Resolver repair commit: `c0e8f89593779d8d7ac11c8f9f78f2f5903246eb`.
- `server/next.config.mjs` keeps the service-principal entry alias server-relative and adds the exact enterprise `@ee/lib/service-principals` target. Turbopack had otherwise followed the CE tsconfig path.
- `server/src/test/unit/nextConfigServicePrincipalsAlias.contract.test.ts` now runs a minimal Turbopack compile fixture. For community and enterprise, compiling with the former absolute entry target fails; the configured server-relative target compiles. Enterprise also resolves the EE implementation import. The isolated fixture and output are removed after each test.

## Local verification

Commands and results from the repaired source revision:

- `cd server && npx vitest run src/test/unit/nextConfigServicePrincipalsAlias.contract.test.ts --reporter=verbose` — exit 0; 2/2 edition resolver fixtures.
- `cd server && npx vitest run src/app/api/email/refresh-watch/route.test.ts src/test/unit/middleware.apiKeyAuth.test.ts src/test/unit/nextConfigServicePrincipalsAlias.contract.test.ts --reporter=dot` — exit 0; 41/41.
- `cd server && NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck` — exit 0.
- `node scripts/guard-service-principals-boundary.mjs` — exit 0.
- Logs: `turbopack-resolver-fixture-20261104.log`, `final-focused-tests-20261104.log`, `final-typecheck-20261104.log`, and `service-principal-boundary-20261104.log`.

## Scheduler-managed runtime

Supported recovery used `alga-dev workflow-restart-service --projectId=bc0ab06c-5ada-5c35-95a7-37f75d01a131 --name=dev-server`, followed by `alga-dev workflow-ensure-service`. No alternate server was started. The service registration reports session `card-service:bc0ab06c-5ada-5c35-95a7-37f75d01a131:dev-server:6`, checkout `/home/robert/alga-copies/feature-security-authz-in-post-3/server`, command `PORT=3594 npm run dev`, and restart at `2026-11-04T20:15:54.045Z`. At `20:24:35Z`, a fresh GET to `http://127.0.0.1:3594/api/health` returned HTTP 200 with `{"status":"ok","version":"1.0.0"}`. Full transcript: `runtime-health-resolver-recovery.txt`.

The scheduler has no served-revision attestation. The registered checkout is this worktree, but the response itself cannot prove which source SHA it served. Startup also logged credential-vault and Temporal initialization warnings; the health endpoint nevertheless returned 200. These observations are not represented as full application initialization success.

## Fresh authenticated behavior

Real browser sessions on the scheduler runtime were confirmed with `/api/auth/session` before requests. An isolated reader and client session were created, then removed.

| Session / case | Valid JSON | Malformed JSON | Empty body |
| --- | ---: | ---: | ---: |
| Internal read-only reader | 403 | 403 | 403 |
| Client user (with `ticket_settings:update`) | 403 | 403 | 403 |
| Anonymous after sign-out | 401 | 401 | 401 |

With the authenticated administrator:

- Foreign-tenant provider `31000000-0000-4000-8000-000000000002`: 404.
- After reader/client denials against same-tenant provider `31000000-0000-4000-8000-000000000003`, first admin request: 409 at the Google public-HTTPS configuration boundary; immediate retry: 429. This demonstrates that denials did not consume throttle capacity.
- Settings UI `/msp/settings/email`, Inbound Email tab, provider `refresh-watch-3100@example.test`: Refresh Pub/Sub & Watch returned 409 at `20:22:55Z`; immediate retry returned 429 at `20:23:03Z`; post-window click returned 409 at `20:24:14Z`.
- The 409 responses show that authorized requests reached configuration; the HTTP-origin validation means they do not establish successful Google registration.

The browser network captures are `resolver-recovery-admin-network.json` and `resolver-recovery-denial-network.json`. Fixture setup and cleanup SQL are retained as `smoke-setup.sql` and `smoke-cleanup.sql`; `cleanup-check-resolver-recovery.json` records zero fixture users, roles, providers, Google configs, sessions, and preferences. A stale isolated Turbopack fixture directory was also removed, and a follow-up check found none remaining under `server/.next`.

## Remaining dependencies

The production build was not started. Host snapshots at 20:26:58Z showed 13 GiB available and 62 GiB swap effectively full (177 MiB free); the prior controlled production build peaked near 17.4 GiB RSS and caused the managed service to exit. This is inadequate headroom for another full build. Snapshot: `build-resource-admission-20261104.txt`. The owner handoff requests an admitted build window or explicit accepted disposition.

The canonical `security-finding-resolved` gate remains unavailable: existing searches found no repository or installed `alga-dev` runner and no matching workflow-template verification. Security Review owner card `bcf52eba-4ee9-5da6-b031-1555619d898c` was updated in annotation `3d3278af-a259-4094-ba89-64462098936f` with the repair, fresh evidence, and explicit requests for the canonical acceptance check and build disposition. No acceptance pass is claimed.
