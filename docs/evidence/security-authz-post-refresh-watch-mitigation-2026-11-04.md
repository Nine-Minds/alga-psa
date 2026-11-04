# Security: authz in POST — refresh-watch mitigation evidence

Date: 2026-11-04  
Checkout: `feature/security-authz-in-post-3`  
Starting revision: `a6d28a6ce24f681f2b3f0498e3d4fadbb7f43d92`

## Scope and implementation review

The applicable primary specification is `docs/plans/2026-08-02-email-refresh-watch-session-auth/PRD.md` (implemented; authenticated UI smoke pending). The plan scoped the middleware API-key exemption and focused middleware coverage. This mitigation additionally requires verification of the route's shared outbound-email authorization ordering, per-tenant/provider throttle behavior, live user matrix, current-revision runtime, and build checks. The expansion is recorded as a discrepancy from the plan, not treated as already accepted.

The existing implementation is correct on inspection, so no application-code changes were made:

- `server/src/app/api/email/refresh-watch/route.ts#POST` obtains the session with `getCurrentUser`, then calls `requireOutboundEmailAdmin` before reading JSON, creating a tenant DB handle, looking up provider/configuration rows, consuming the limiter, or invoking `configureGmailProvider`.
- `packages/integrations/src/actions/email-actions/mspOutboundEmailAccess.ts` rejects client users before permission lookup and requires `ticket_settings:update` for MSP users.
- Provider/configuration reads use `tenantDb(knex, user.tenant)`; a provider not visible in that tenant returns 404. Throttle key remains `${user.tenant}:${providerId}` with one point per 60 seconds.
- `server/src/middleware.ts` retains the exact `/api/email/refresh-watch` API-key exemption; the middleware regression suite also confirms unrelated routes remain gated.

## Focused behavioral tests

Command: `cd server && npx vitest run src/app/api/email/refresh-watch/route.test.ts src/test/unit/middleware.apiKeyAuth.test.ts --coverage.enabled=false`

Result: **39 passed** (13 refresh-watch route cases; 26 middleware cases). Route tests exercise anonymous rejection, internal permission and client denial before provider/external work, malformed and empty bodies for denied callers, denial preserving capacity for a subsequent authorized request, tenant-scoped provider lookup/404, tenant/provider throttle isolation, and recovery after 60 seconds. Middleware tests cover the current exemption and API-key gating boundaries. No demonstrated coverage gap required a new test.

## Scheduler-managed runtime

The board registration is `card-service:bc0ab06c-5ada-5c35-95a7-37f75d01a131:dev-server:6`, host `ts:robert-X670E-Pro-RS`, cwd `/home/robert/alga-copies/feature-security-authz-in-post-3/server`, launch command `PORT=3594 npm run dev`. It is the required service and no competing server was started.

At checks between 13:20 and 13:25 UTC, the scheduler reported `recovering` with action `heal`, queue position 3. Its latest memory rationale reported 15 GiB free, 9 GiB reserved, an 8 GiB floor, and a 6 GiB service reservation. Host `free -h` showed 60 GiB total, 62 GiB swap with effectively no free swap, and memory pressure changed while other managed workloads ran. The port check `curl -i --max-time 3 http://127.0.0.1:3594/api/health` failed immediately with connection refused. I did not stop unrelated workloads or bypass scheduler memory policy. `workflow-resource-holds` was not implemented by the installed backend at first inspection, so I used the supported idempotent `workflow-ensure-service` control for the registered service rather than launching a competing server.

The recovery control was followed by a scheduler-owned restart at 13:39:08 UTC (`restartedBy=human`); service `dev-server:6` then reported `live` and health `running`. Port 3594 returned `200 {"status":"ok","version":"1.0.0"}` at 13:39 and again at 13:46 UTC. At the latter sample the host reported 60 GiB total RAM, 14 GiB available and 1.8 GiB swap free; scheduler telemetry showed seven queued starts, 11 GiB free on X670 and memory pressure. The launch and capacity issue is therefore resolved sufficiently for live observation, but the host remains pressured and the service can still be preempted. No unrelated workload was stopped.

The current registration identifies this worktree, but the scheduler does not attest a git SHA or artifact digest. The recovery process start is later than current HEAD `a6d28a6ce24f681f2b3f0498e3d4fadbb7f43d92`; combined with its exact checkout cwd and the current route hash below, this is strong process-timing/source inference, not direct scheduler revision attestation.

Subsequent forensic review found retained prior-session evidence and narrows that statement: `/home/robert/.alga-dev/smoke-evidence-backup/security-authz-refresh-watch-20261104T1211Z/runtime.txt` records `dev-server:6`, the exact worktree cwd/command, a process start at 2026-11-04T11:04:43Z, and a healthy scheduler record at 12:20Z. The current authorization-ordering implementation landed in commit `30384ef266658c9a32398e4467a4f5be9797469c` at 07:59Z; its route file is byte-identical to current HEAD (`sha256 be59f3218638cdfedc919f91dca52401686e2b9a85086900691bb4bb9c533e44`). The scheduler does not attest a git SHA or artifact digest, so this is process-path/start-time plus source-content inference, not direct revision attestation. The service logs also retain health/application requests and end at exit status 137. Current runtime remains down and queued.

The retained 12:11Z evidence bundle contains real-session reader/client valid, malformed, and empty POST results (each 403), anonymous valid/malformed/empty results (each 401), foreign-tenant 404, administrator first 409 then immediate 429 and post-window 409. Those session results were captured before the scheduler recovery, but used the same worktree and the identical production route SHA `be59f3218638cdfedc919f91dca52401686e2b9a85086900691bb4bb9c533e44`; no source edit to that route occurred afterward. Current post-recovery browser network evidence independently shows authorized admin calls returning 409 then 429 and a post-window 409. The current settings UI was opened and its `Refresh Pub/Sub & Watch` action clicked. Captures and fixture cleanup verification are in `docs/evidence/security-authz-post-refresh-watch-2026-11-04/`. This UI run reached the HTTP/HTTPS configuration error and cannot establish Google registration success.

The isolated smoke fixtures were cleaned after the post-recovery UI replay; database verification reports zero fixture users, roles, providers, Google configuration, sessions, and preferences. The original real-session matrix used the same fixture provider for the denied attempts and then the authorized call: the authorized call reached the Google-origin 409 rather than 429, and its immediate retry returned 429, demonstrating that denials had not consumed throttle capacity. The settings UI's repeated action also returned 409 then 429; the rendered alert text `Gmail provider refresh rate limit exceeded` was present in the browser DOM. After the window, an actual UI action again returned the Google-origin 409. No live successful Google registration is claimed: HTTP origin validation returns 409 before Google provisioning.

## Full checks

- Initial `cd server && npm run typecheck` failed because Node reached its default approximately 4 GiB heap limit.
- Retry `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` failed after about 104 seconds at approximately 8.05 GiB live heap (`Ineffective mark-compacts near heap limit`). It emitted no source type diagnostics before the resource failure.
- Root `npm run build` completed AssemblyScript skip and the Nx dependency build (63 cached tasks), then Next.js Turbopack compilation failed with three unresolved `@product/service-principals/entry` imports in `packages/auth/src/services/apiKeyService.ts`, `server/src/lib/api/middleware/apiMiddleware.ts`, and `server/src/lib/services/apiKeyServiceForApi.ts`. These paths are outside this finding; the build does not certify the full tree.
- Unlike the original report's characterization, the failing import and resolver/configuration files differ from `main` (confirmed with `git diff main -- package.json tsconfig.base.json server/tsconfig.json server/next.config.mjs` and the three importer files). This is a branch-tree failure whose relationship to this mitigation is not established. I have requested an explicit baseline/external disposition from the owning security-review workflow; I do not label it unrelated.

The reproducible focused-test transcript is retained at `docs/evidence/security-authz-post-refresh-watch-2026-11-04/focused-tests.log` (39/39 passed at current HEAD). Current recovered-runtime browser API status captures, UI screenshots, a UI/matrix summary, focused typecheck, full-check outcomes, and database cleanup check are adjacent.

## Acceptance mechanism and status

Repository-wide search found no configured `security-finding-resolved` command/check. `alga-dev workflow-list-templates` returned Alga Task Office, PR Security Review, Alga Task, Alga Task Home, Med Chat Pro Template, New NextJS Project, and Nine Minds Website; walking their serialized verification entries found no label `security-finding-resolved`. The existing plans' mentions of that label do not define an executable acceptance mechanism. No unrelated gate or invented pass was substituted.

The missing check was handed to the finding's owning security-review card `bcf52eba-4ee9-5da6-b031-1555619d898c` using its supported note route. Annotation `83848227-509c-47c3-a5c3-0f1a871bf585` requests the canonical check/runner/evidence contract; follow-up annotation `b5cd13c6-618a-4f00-b7e7-fc819f98fff3` specifically requests an equivalent typecheck/build baseline or explicit disposition. No owner response or acceptance grant was present at the time of this update.

**Acceptance remains incomplete.** The managed runtime is healthy now and the route/source revision inference, authenticated API matrix, current admin UI throttle/recovery evidence, and fixture cleanup are recorded. Remaining: direct scheduler revision attestation, successful required typecheck/build or precise externally accepted baseline disposition, and the real `security-finding-resolved` check or its owner-provided definition. No PR was opened or push performed.

Reviewer should first inspect the route and its test, then this report's scheduler and full-check sections. The pre-existing `package-lock.json` edit was left untouched and excluded from any task commit.
