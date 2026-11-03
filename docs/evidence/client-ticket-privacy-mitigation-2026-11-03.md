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

**Infrastructure intervention required:** a host/board operator must either provision at least 6 GB of additional schedulable memory while preserving the 8 GB floor, or identify and release at least 6 GB of reservations from services they explicitly approve for suspension. This agent has no safe project-scoped control to release other projects' reservations, and did not disturb unrelated services. Once capacity is restored, re-run the existing board-managed ensure for this service and complete the live checklist above.

The requested Dorothy UI deletion, database row check, refreshed conversation, comment create/edit/denial checks, live action/RSC payload capture, and document visibility/read-only scenarios remain unverified. No fixtures were changed or removed. No conclusion about live behavior is claimed.
