# Client-ticket privacy mitigation verification

## Revision and scope

The implementation checks below ran against code revision `8d84e1fe7cab7afdcb06593420b33b1e7bcdbb92` on 2026-11-03. The branch contains the shared client-ticket projection, ownership-aware comment controls, document-association loading, and `ticket:update` authorization for own-comment deletion. No approved client-ticket plan was found under `docs/plans/` in this checkout.

## Local behavioral checks

- `packages/client-portal`: `client-tickets.visibility.test.ts` and `TicketDetails.delete.test.tsx` — 38 tests passed. These exercise the allowlisted list/detail/document response projections and deletion UI behavior.
- `packages/tickets`: `CommentItem.portalOwnership.test.tsx` and `commentAuthorResolution.test.ts` — 17 tests passed.
- A new `getClientTicketDocuments` action regression passed in `client-tickets.visibility.test.ts`. It supplies private user/contact/creator identity, storage path, and an unexpected field; only supported document fields remain. The action now selects explicit columns, takes `ticket_id` from tenant-scoped `document_associations`, inherits `client_id` from the authorized ticket row, filters readable attachments, then applies `projectClientTicketDocument`.
- `npm run typecheck` passed in both `packages/client-portal` and `packages/tickets`.
- `npx nx run @alga-psa/client-portal:build` and `npx nx run @alga-psa/tickets:build` passed, including dependency builds.
- The direct client-portal `npm run build` script failed with `No input files`; its Nx build target is the configured workspace target.

## Live smoke status

Not run. `alga-dev workflow-ensure-service --projectId=048ad00b-cb75-582b-a997-ac9f1fd2b202 --name=dev-server` recognized the existing board-managed registration (`card-service:048ad00b-cb75-582b-a997-ac9f1fd2b202:dev-server:3`, cwd this checkout's `server`, command `PORT=3456 npm run dev`) and queued its resume. The latest accepted ensure response reported 14 GB free, 6 GB reserved, an 8 GB floor, a 6 GB requirement, and queue position 39: there is no schedulable capacity for this request. Port 3456 remained closed. `workflow-list-services` timed out with no hub responder; another state read returned JetStream unavailable. Host-level `free -h` showed 2.3 GiB free and 1.5 GiB available swap. No separate server was started and memory reservations were not bypassed.

**Infrastructure intervention estimated at the builder's final check:** a host/board operator needed either 6 GB of additional schedulable memory while preserving the 8 GB floor, or release of 6 GB of reservations from services explicitly approved for suspension. No other projects' reservations were changed. The takeover snapshot below updates this estimate. Once capacity is restored, re-run the existing board-managed ensure for this service and complete the live checklist.

The requested Dorothy UI deletion, database row check, refreshed conversation, comment create/edit/denial checks, live action/RSC payload capture, and document visibility/read-only scenarios remain unverified. No fixtures were changed or removed. No conclusion about live behavior is claimed.

## Takeover check at 18:25 UTC

Code remains at `8d84e1fe7cab7afdcb06593420b33b1e7bcdbb92`; the takeover started from documentation revision `c1a4a5e74993bc14c30fd1f3d95f9090b916cd92`. No implementation changes or repeated test runs were needed.

The board controls responded. Two same-card review jobs (`draft-review-evidence` and `draft-review-evidence2`) had failed health checks confirming that their processes had exited. Both stale registrations were concluded through `workflow-conclude-service`. The same card's temporary `dr-evidence-http2` snapshot server was also concluded; its evidence files were preserved. No other project's services or reservations were changed.

After this cleanup, `workflow-ensure-service` still returned `suspended`, queue position 36, with a 6 GB request, 20 GB free, 9.5 GB reserved, and an 8 GB floor. Earlier retries were also blocked by host memory-pressure throttling. At this snapshot, only 2.5 GB was schedulable, a 3.5 GB shortfall before accounting for competing queued work. The earlier 6 GB intervention estimate is therefore not a fixed requirement: an operator must provide enough unreserved capacity to admit this service through the queue and allow memory pressure to settle. Reservations and host safeguards were preserved.

A new card-space browser pane was created, but the app did not become available. A direct request to `http://127.0.0.1:3456/auth/signin` failed to connect. A read-only PostgreSQL query confirmed that retained comment `bc934302-b215-4878-b0f9-2d2bf8856b71` on ticket `29930000-0000-4000-8000-0000000000a7` still belongs to Dorothy Gale, has `deleted_at = null`, and is neither internal nor system-generated. This confirms the reproduction fixture remains available; it does not prove deletion works. No database writes, login, portal mutations, or payload captures were performed.

Raw service responses, the scoped SQL query, and its result are saved at `/tmp/alga-smoke-evidence/client-tickets-security-takeover-20261103T1824/`. The remaining live checklist is environment-blocked. The app's routes, controls, and session identity could not be verified live.

## Verification retry at 18:31 UTC

The checkout was at `47d96cd79d99a949f735e718a9b68fb41ee49df9`; the only pre-existing working-tree change was `package-lock.json`, which was preserved. No approved plan was present under `docs/plans/`; the smoke checklist used was `/tmp/alga-smoke-evidence/client-tickets-security-20261103T1610/plan.md`.

The registered `dev-server` still points at this checkout's `server` directory and `PORT=3456 npm run dev`. `workflow-ensure-service` accepted the resume request but left it suspended in the queue at position 35, requiring 6 GB with 18 GB free, 8.6 GB reserved, and the 8 GB host floor. A subsequent service read showed it still suspended with no active queue entry; `ss` found no port-3456 listener and `curl http://127.0.0.1:3456/auth/signin` returned HTTP 000. A card-space browser navigated to the prescribed origin and remained unavailable; screenshot: `/tmp/ghostty-pane-ide/screenshots/client-tickets-service-unavailable-current.png`. No independent server, fixture mutation, or live portal action was attempted.

At this revision, focused behavioral regressions passed: 55 tests across `client-tickets.visibility.test.ts`, `TicketDetails.delete.test.tsx`, `CommentItem.portalOwnership.test.tsx`, and `commentAuthorResolution.test.ts`; 13 `commentVisibility.test.ts` cases passed separately. `npm --prefix ../packages/client-portal run typecheck` and `npm --prefix ../packages/tickets run typecheck` passed from `server/`. `npx nx run @alga-psa/client-portal:build` and `npx nx run @alga-psa/tickets:build` passed. These checks verify the local implementation; they do not replace the blocked browser payload or ordinary-permission deletion checks. Dorothy's retained comment, create/edit persistence, non-owner live enforcement, document visibility, and shared-workspace read-only behavior remain unverified at this revision.

## Verification retry at 18:33 UTC

The live retry targeted code revision `868fa8686e2bf8b273c57efdf3005a7c7f2d365e`. `workflow-ensure-service` again addressed only the registered `dev-server` (`card-service:048ad00b-cb75-582b-a997-ac9f1fd2b202:dev-server:3`) at this checkout's `server` directory. The board reported it suspended with a resume request queued at position 39: 16 GB free, 6.6 GB reserved, an 8 GB floor, and 6 GB required. No port-3456 listener was present and the signin endpoint returned HTTP 000. `workflow-list-services --live=true` returned no live services. The other same-card suspended one-shot registrations had no current health evidence, so none were treated as stale or retired. No other project reservations were changed.

At that snapshot, the host had only 1.4 GB schedulable above its floor, leaving a baseline shortfall of 4.6 GB for this service, before the effect of 38 queued jobs or memory-pressure throttling. Operator intervention must provide enough additional schedulable capacity for the board to admit the request while keeping the 8 GB floor intact, or explicitly release at least the required reservation from verified, approved services; the scheduler's queue and memory-pressure gate may require more than 4.6 GB. The registered service remains suspended. All ordinary-permission portal deletion, database-removal/refresh, live payload privacy, comment create/edit, non-owner enforcement, document, and shared-workspace checks remain incomplete. This retry made no code or fixture changes and does not establish a verification pass.

## Takeover at 18:34 UTC

Reviewed revision `4863ea5c510f14fc0197cd7677cbd5a9270b0d85`. Only the evidence document has changed since implementation revision `8d84e1fe7cab7afdcb06593420b33b1e7bcdbb92`. The preceding independent review ran 52 behavioral tests across ticket visibility, deletion UI, and author resolution; all passed. Builds and typechecks were not repeated for this documentation-only takeover. The existing `package-lock.json` modification remains untouched.

The board's suspension logs explicitly record process exits for `draft-review-evidence3`, `draft-review-probe`, and `dr-final-evidence`. No matching user systemd scope remained. These three same-card one-shot registrations were concluded, preserving their evidence files. All same-card evidence services are now concluded; no other project's resources were changed.

After cleanup, the registered service resume remained suspended at queue position 40, requiring 6 GB with 20 GB free, 11 GB reserved, and the 8 GB host floor. This leaves 1 GB schedulable and a baseline shortfall of 5 GB, before competing requests or memory-pressure gating. Port 3456 still had no listener and the signin request returned HTTP 000. Raw service responses and connection checks are saved in `/tmp/alga-smoke-evidence/client-tickets-security-takeover-20261103T1834/`.

The card is flagged for blocked attention with an authority requirement: an operator must provide enough capacity or approve suspending other project reservations while preserving the host floor. No independent server was launched and no portal or database mutation was performed. Dorothy's retained deletion and the remaining live checklist are incomplete. This takeover does not establish a live verification pass.

## Draft Implementation verification at 00:13 UTC

Inspected code revision `ac18bfcaaf062d9c26d0a96b8a2d992759139b39`. The relevant implementation and behavioral coverage are already present: ticket list/detail use the shared explicit projection, detail attributes contain only `description`, origin/original-email availability are derived before projection, comment authors are display-only, document lookup uses tenant-scoped `document_associations`, and own-comment deletion is authorized by `ticket:update` plus server-side ownership and visibility checks. Existing behavioral regressions cover serialized list/detail privacy sentinels, display-only comment author resolution, own versus non-owner deletion, ordinary `ticket:update` permission, shared-workspace and read-only capabilities, and document projection. No new code defect was demonstrated in this review, so no implementation change was made.

There is no approved client-ticket plan in `git log main..HEAD --name-only -- docs/plans/`. The previously recorded checklist at `/tmp/alga-smoke-evidence/client-tickets-security-20261103T1610/plan.md` is available, but cannot be executed until the service is admitted.

Current local validation at code revision `ac18bfcaaf062d9c26d0a96b8a2d992759139b39`:

- From `packages/client-portal`: `npx vitest run src/actions/client-portal-actions/client-tickets.visibility.test.ts src/components/tickets/TicketDetails.delete.test.tsx` — 38 tests passed.
- From `packages/tickets`: `npx vitest run src/components/ticket/CommentItem.portalOwnership.test.tsx src/lib/commentAuthorResolution.test.ts src/lib/commentVisibility.test.ts` — 30 tests passed.
- From `packages/client-portal`: `npm run typecheck` — passed.
- From `packages/tickets`: `npm run typecheck` — passed.
- From the repository root: `npx nx run @alga-psa/client-portal:build` and `npx nx run @alga-psa/tickets:build` — both passed; Nx reported all 51 and 29 tasks respectively satisfied by cache.

The authorized current service operation targeted only `card-service:048ad00b-cb75-582b-a997-ac9f1fd2b202:dev-server:3`, whose registration names this checkout's `server` directory and command `PORT=3456 npm run dev`. On the latest ensure at 00:12:36 UTC it remained suspended in queue position 12: it needs 6 GB, while the host reported 11 GB free, 12 GB reserved, and an 8 GB floor; the scheduler says competing runs go first and reports 5.9 GB above the floor after those runs finish. The latest direct service read had no live health and no queue entry before re-ensure. `ss -ltnp '( sport = :3456 )'` showed no listener and `curl http://127.0.0.1:3456/auth/signin` returned HTTP 000. Therefore the service process cwd, stable readiness, login, real action/RSC bodies, and every live checklist item remain unverified. The operator action required is to provide enough schedulable capacity for this queued 6 GB service while preserving the 8 GB floor, or explicitly approve release of sufficient reservations from other services; do not bypass the memory gate.

The same-card one-shot evidence registrations observed in the board registry are concluded. The earlier evidence dossier records board health/process-exit evidence for the jobs it retired; no new same-card job was concluded in this verification. No other project was suspended or modified. The pre-existing `package-lock.json` modification remains preserved.

## Draft Implementation verification retry at 20:50 UTC

Code revision: `4864772c1f89b5232567ad75005353cafcbb27b1`. The approved plan history remains absent from `git log main..HEAD --name-only -- docs/plans/`. The available existing smoke checklist is `/tmp/alga-smoke-evidence/client-tickets-security-20261103T1610/plan.md` (historical checklist revision `3d640890b7433ea8a09753b0aba06abc8ecccb09`).

Current review confirmed the shared explicit projection at `packages/client-portal/src/actions/client-portal-actions/clientTicketProjection.ts`, list/detail/document consumers in `client-tickets.ts`, projected author and comment capabilities, and own-comment deletion guarded by `ticket:update`, ownership, visibility, and interaction checks. No concrete defect was found. No implementation changes were made. The pre-existing `package-lock.json` modification was preserved.

Checks run against this checkout:

- In `packages/client-portal`, `npx vitest run src/actions/client-portal-actions/client-tickets.visibility.test.ts src/components/tickets/TicketDetails.delete.test.tsx` — 38 passed.
- In `packages/tickets`, `npx vitest run src/components/ticket/CommentItem.portalOwnership.test.tsx src/lib/commentAuthorResolution.test.ts src/lib/commentVisibility.test.ts` — 30 passed.
- `npm run typecheck` in both `packages/client-portal` and `packages/tickets` — passed.
- `npx nx run @alga-psa/client-portal:build` and `npx nx run @alga-psa/tickets:build` — passed; Nx satisfied all 51 and 29 tasks from cache.

The currently registered board service `card-service:048ad00b-cb75-582b-a997-ac9f1fd2b202:dev-server:3` has cwd `/home/robert/alga-copies/feature-security-2-findings-in-client-tickets-ts/server` and command `PORT=3456 npm run dev`. A command-free `alga-dev workflow-ensure-service --projectId=048ad00b-cb75-582b-a997-ac9f1fd2b202 --name=dev-server` resumed that registration but returned it suspended in queue position 25, reason `needs 6 GB memory on robert-X670E-Pro-RS (24 GB free, 15 GB reserved, 8 GB floor)`. `ss -ltnp '( sport = :3456 )'` found no listener; `GET http://127.0.0.1:3456/auth/signin` returned HTTP 000. No same-card stale registration was acted on; no other project's reservations were touched. The live deletion, refreshed conversation, live payload, document, collaborator, and shared-workspace checks remain unverified. Do not treat the local regressions as live smoke evidence.

## Reviewer-requested retry at 01:52 UTC

A fresh command-free `alga-dev workflow-ensure-service --projectId=048ad00b-cb75-582b-a997-ac9f1fd2b202 --name=dev-server` again targeted only the existing `dev-server:3` registration for this checkout. The scheduler returned it suspended at queue position 26 with reason `needs 6 GB memory on robert-X670E-Pro-RS (23 GB free, 14 GB reserved, 8 GB floor)`. That leaves about 1 GB above the floor before competing queued work, a baseline 5 GB shortfall. `ss -ltnp '( sport = :3456 )'` showed no listener and `GET http://127.0.0.1:3456/auth/signin` returned HTTP 000.

Operator intervention required: restore enough schedulable capacity for the queued 6 GB service while retaining the 8 GB host floor, by adding capacity or explicitly approving release of sufficient reservations from services approved for suspension. The scheduler's queued work may require additional headroom beyond the 5 GB baseline. Do not bypass the scheduler, memory-pressure safeguards, or change unrelated reservations. The current live deletion, database removal, refreshed conversation, payload privacy, document, collaborator, and shared-workspace checks remain blocked and unverified.
