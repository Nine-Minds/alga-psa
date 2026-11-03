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
