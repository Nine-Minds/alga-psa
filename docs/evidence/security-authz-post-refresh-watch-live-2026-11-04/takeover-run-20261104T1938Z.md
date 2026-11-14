# Refresh-watch mitigation takeover verification

Checked 2026-11-04 at source revision `fc199cfa3ebb1104eb7c85171d292c2eee29662f` on `feature/security-authz-in-post-3`. The only pre-existing worktree edit is `package-lock.json`; it was not included in this report or task commit.

## Re-run checks

- `cd server && npx vitest run src/app/api/email/refresh-watch/route.test.ts src/test/unit/middleware.apiKeyAuth.test.ts --coverage.enabled=false` — exit 0, 39/39 (13 route, 26 middleware).
- `cd server && npx vitest run src/test/unit/nextConfigServicePrincipalsAlias.contract.test.ts --coverage.enabled=false` — exit 0, 2/2 (community and enterprise selected targets).
- `node scripts/guard-service-principals-boundary.mjs` — exit 0, `Service-principal edition boundary OK (.)`.
- `cd server && NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck` — exit 0.

No source change or new test was justified: the route authorizes via `requireOutboundEmailAdmin` before parsing JSON, tenant provider lookup, throttle consumption, or Google configuration. Existing tests cover anonymous 401; reader/client 403 for valid, malformed, and empty bodies; denied-call capacity preservation; tenant-scoped 404; per-tenant/provider throttling and window recovery. The middleware exemption is retained as required by the approved 2026-08-02 plan.

## Managed runtime

The existing `dev-server:6` registration reports cwd `/home/robert/alga-copies/feature-security-authz-in-post-3/server` and command `PORT=3594 npm run dev`. Supported `alga-dev workflow-ensure-service --projectId=bc0ab06c-5ada-5c35-95a7-37f75d01a131 --name=dev-server` found the existing registration and reported it live after a human-managed heal. A request to `http://feature-security-authz-in-post-3.localhost:3594/api/health` returned HTTP 500. The development compilation error names unresolved `@product/service-principals/entry`, aliased to `packages/product-service-principals/ee/entry.ts`. The response is retained in `health-takeover-20261104.txt` and `.json`. This is not healthy runtime evidence, and the scheduler provides no served-SHA attestation.

No fresh authenticated browser matrix was run against the unhealthy runtime. Existing real-session captures remain in this directory and the main mitigation report; they establish earlier observed responses against a route file byte-identical to the previously tested revision, but do not resolve the current runtime failure. Earlier administrator UI evidence reached the Google HTTP/HTTPS configuration boundary (409), immediate throttle (429), and post-window retry (409); this is not successful Google registration. Existing cleanup checks report zero isolated fixtures.

## Remaining checks and acceptance

The post-alias-repair production build was not rerun. The prior controlled build peaked near 17.4 GiB RSS and ended with the managed runtime down; this host showed only 14 GiB available and swap was substantially used before verification. The canonical `security-finding-resolved` runner/check remains unavailable: repository tooling, installed `alga-dev` commands, and available workflow-template verifications were searched in the earlier evidence run. The Security Review owner must supply or run the canonical acceptance check. No substitute gate is claimed.

The approved plan is `docs/plans/2026-08-02-email-refresh-watch-session-auth/PRD.md`; the broader authz ordering requirements are explicitly documented as mitigation scope in `docs/evidence/security-authz-post-refresh-watch-mitigation-2026-11-04.md`. No PR or push was made.

## Turbopack alias correction — 2026-11-04

The runtime 500 identified that `server/next.config.mjs` represented the selected `@product/service-principals/entry` target as an absolute filesystem path while neighboring package aliases use paths relative to the server project. The alias now uses the same `../packages/...` representation. The former alias contract only compared the configured value; it now compiles the selected entry and its imported dependency graph with the server TypeScript configuration for both community and enterprise. Enterprise compilation also supplies the existing `@ee/*` Next alias mapping. The new behavioral compilation cases pass 2/2; the combined route, middleware, and alias suites pass 41/41; server typecheck and `node scripts/guard-service-principals-boundary.mjs` pass. Transcripts are `runtime-alias-repair-tests.log`, `runtime-alias-repair-typecheck.log`, and `runtime-alias-repair-boundary.log` in this directory.

The corrected config has not yet been loaded by `dev-server:6`: its supported scheduler restart remains queued at position 17, so the current HTTP 500 belongs to the pre-restart process and does not verify or refute the repair. Host telemetry showed 16 GiB free, 12 GiB reserved, and an 8 GiB floor. The documented prior build peak was about 17.4 GiB; no production build was started under that admission state. The canonical acceptance request was handed to Security Review owner card `bcf52eba-4ee9-5da6-b031-1555619d898c`, annotation `0d74a37d-5c4d-4bcd-a8ab-823102f59de5`.
