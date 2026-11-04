# Client ticket privacy verification retry

## Revision and scope

Code revision reviewed and checked: `5fa3c78f2899d3b7403dca67ff0b4e2b21206333` (2026-11-04). No application code changed in this retry. No approved client-ticket plan exists in `git log main..HEAD --name-only -- docs/plans/`; the existing live checklist is `/tmp/alga-smoke-evidence/client-tickets-security-20261103T1610/plan.md` (checklist revision `3d640890b7433ea8a09753b0aba06abc8ecccb09`). The pre-existing `package-lock.json` modification was preserved.

Review reconfirmed that list, detail, and document actions pass data through explicit client-facing projections; detail attributes expose only `description`; document selection is tenant scoped and filters unreadable documents; comment authors are projected; and deletion capability follows `ticket:update` while the server independently checks authenticated ownership, visibility, and interaction. Existing behavioral tests cover raw-field sentinels, comment ownership/capabilities, and document projection. No concrete implementation defect was found, so no repair was made.

## Checks executed on this revision

- In `packages/client-portal`: `npx vitest run src/actions/client-portal-actions/client-tickets.visibility.test.ts src/components/tickets/TicketDetails.delete.test.tsx` — 38 passed. Output: `client-portal-tests.txt`.
- In `packages/tickets`: `npx vitest run src/components/ticket/CommentItem.portalOwnership.test.tsx src/lib/commentAuthorResolution.test.ts src/lib/commentVisibility.test.ts` — 30 passed. Output: `tickets-tests.txt`.
- In `packages/client-portal`: `npm run typecheck` — passed. Output: `client-portal-typecheck.txt`.
- In `packages/tickets`: `npm run typecheck` — passed. Output: `tickets-typecheck.txt`.
- From the repository root: `npx nx run @alga-psa/client-portal:build` and `npx nx run @alga-psa/tickets:build` — passed; Nx reported all 51 and 29 tasks satisfied from cache. Outputs: `client-portal-build.txt`, `tickets-build.txt`.

## Live service and external blocker

`workflow-ensure-service --projectId=048ad00b-cb75-582b-a997-ac9f1fd2b202 --name=dev-server` resumed the existing registration `card-service:048ad00b-cb75-582b-a997-ac9f1fd2b202:dev-server:3`. The board reported it live with command `PORT=3456 npm run dev`; the listener PID's `/proc` cwd resolves to this checkout's `server/`; the card origin returned HTTP 307 to the signin route. No separate server was launched. Same-card service state was rechecked before recovery; all other same-card services were concluded. No unrelated workloads or scheduler safeguards were changed. See `service-health.txt`.

The client portal sent the ordinary login flow to `/auth/client-portal/signin`. A login-link request for the ticket's Dorothy account reached the running app, which displayed the generic “Check Your Email” response. The server log records that the email provider is disabled/unconfigured and the link could not be sent (`portal-login-email-blocker.txt`). Therefore the ordinary Dorothy session and the live ticket flow could not proceed. The app itself remained available.

The exact checklist's first required deletion was not performed. Read-only database evidence confirms retained comment `bc934302-b215-4878-b0f9-2d2bf8856b71` on ticket `29930000-0000-4000-8000-0000000000a7` remains undeleted (`retained-comment-state.json`). There is no database-removal or refreshed-conversation evidence. No ticket fixtures were changed. The canonical QA login helper was run to repair the designated QA account; the portal login-link request made no ticket or fixture mutation.

Still blocked: ordinary Dorothy deletion plus DB/refresh proof; real comment create/edit and non-owner denial; actual authenticated list-action/detail-RSC payload capture; document-bearing and no-document detail, private-document exclusion; shared-workspace read-only UI and server enforcement. The live service has been resumed, but the remaining external requirement is an enabled delivery path for the normal client portal login link (or operator-provided approved login path). Do not treat local behavioral checks as live evidence.
