# Ticket resource authorization mitigation: live evidence

## Scope and revision

This evidence run exercises the existing repair at code revision `b3611c905a0d2fe4d56ec35f22fef44825faa6a8`. The repair authorizes resource actions through the ticket record policy, resolves a removal assignment to its owning ticket before authorization, and retains the core human-assignee eligibility checks. No authorization code defect was observed and no application code was changed during this mitigation round.

No approved plan was present in `git log main..HEAD --name-only -- docs/plans/`. The run followed the dossier at `/tmp/alga-smoke-evidence/security-authz-addticketresource-20261104/plan.md`.

## Existing board-managed server and readiness

The existing `dev-server:11` service was admitted through `workflow-ensure-service` without a command override. The final response is recorded in `ensure-service-final.json`; the service remained live in `services-final.json` with no launch queue. Its registered command was `PORT=3751 npm run dev` in this worktree's `server` directory. The requested URL `http://feature-security-authz-in-addticketresource.localhost:3751/auth/signin` redirected to `/auth/msp/signin`; following the redirect returned HTTP 200. See `readiness-headers.txt` and `readiness-body.html`.

### Unresponsive control diagnosis

The first Quick Add interaction raced route loading/navigation. Browser network capture `portal-browser-network.json` records `_rsc` requests returning HTTP 200 but being aborted by navigation (`net::ERR_ABORTED`); the browser console capture `portal-browser-console.json` contains a Next hydration mismatch for injected `data-cli-uid`, with no functional JavaScript exception. Existing board-server history is preserved at `/tmp/security-authz-addticketresource-20261104-server-history.json` and `/tmp/security-authz-addticketresource-20261104-server-history-after-create.json`: normal authenticated ticket routes returned 200, and `POST /msp/create-ticket` returned 200. After allowing the route to settle and retrying through this same board service, Quick Add completed and persisted the expected ticket and additional-agent row. There was no evidence of an application defect behind the earlier unresponsive control.

## Quick Add: authenticated MSP user

Acting identity was `qa@emeraldcity.oz` (internal user `20a52aa7-137c-4a42-ab3e-5b75050d54d7`). Quick Add created ticket `TIC001273`, ID `02f7c632-38d8-45b6-8dc3-13e6550e572e`, titled `Security authz mitigation QA 2026-11-04`, on board `Portal Sharing Review`, for client `Smoke Deferred 1755`. Primary assignee was Dorothy Gale (`6fb0c1d5-c732-45b2-96a1-96bbc6a639f1`); additional agent was QA Tester (`20a52aa7-137c-4a42-ab3e-5b75050d54d7`). The browser closed the dialog and returned to `/msp/tickets`; the POST returned HTTP 200. The persisted resource row is `052c12f1-230b-4fe7-aab0-da3837c56a81`, and ticket-created activity is present. See `quick-add-browser-result.json`, `quick-add-created-ticket-state.json`, and `quick-add-server-log.txt`.

## Live record-level authorization evidence

The denial tests used a real authenticated client portal session for `smoke-authz-3039@example.com` (client user `2582ac47-d979-4d61-8a58-cc79b944de80`, tenant `6d178771-ad9a-4d43-8809-83992745f8f9`). Its client Admin role has tenant-wide `ticket:read` and `ticket:update` permissions. The contact's visibility group, `Authz 3039 General only`, exposes the General Support board. This avoids treating missing tenant-wide permissions as record-level authorization. The browser session and portal list visibility are recorded in `portal-session-and-visibility.json`; screenshot: `portal-dashboard.png`.

Visible ticket: `SMK3039-visible` (`b9c37b04-7c26-4c10-a0d2-737c6b77278c`), on the allowed General Support board. Hidden same-client ticket: `SMK3039-hidden` (`aa569323-8532-4812-8423-fb0bfd9dd505`), on a board outside the contact's visibility group. The portal listed the visible ticket and did not list the hidden one.

| Action | Visible ticket | Hidden ticket | Evidence |
| --- | --- | --- | --- |
| Read ticket resources | Allowed; returned resource row | Denied with `Permission denied: Cannot access ticket` | `authorized-read-remove-response.json`; `denied-read-add-eligibility-responses.json` |
| Add QA Tester as an additional resource | Allowed; assignment `e77c8da5-1298-4683-ae56-f8188ae8d347` | Denied on an unassigned ticket; request that would promote the agent to primary did not mutate it | `authorized-add-response.json`; `denied-read-add-eligibility-responses.json` |
| Eligibility check for QA Tester | `true` | `false` | `denied-read-add-eligibility-responses.json` |
| Remove by assignment ID | Allowed; visible resource removed | Denied for known hidden assignment `257bc13e-e9d5-45c6-ad58-fd5cf3ca79d6` with `Permission denied: Cannot access ticket` | `authorized-read-remove-response.json`; `denied-known-assignment-remove-response.json` |

The server-action transport returned HTTP 200 for both allowed and denied calls; the action result envelope is the authorization outcome. Full same-origin authenticated browser requests and responses are retained in the referenced JSON artifacts.

### State and side-effect checks

For the unassigned hidden ticket, before/after snapshots show `assigned_to=null`, zero resource rows, and zero activity rows after denied read/add. For known-ID removal, before/after snapshots show the primary still assigned to Dorothy, assignment ID `257bc13e-e9d5-45c6-ad58-fd5cf3ca79d6` still present, and zero activity rows. Automated structural comparisons passed; see `hidden-before-denials.json`, `hidden-after-denied-add.json`, `hidden-before-known-assignment-remove.json`, `hidden-after-denied-remove.json`, and `denied-state-comparison.txt`.

On the visible ticket, the allowed add/read/remove sequence completed. The final action snapshot includes the expected assignment and unassignment activity records; see `visible-after-authorized-actions.json`. After evidence collection, fixture ticket assignments/resources and the visible-ticket test activity rows were restored/removed. Cleanup state is captured in `cleanup.json`, `visible-after-cleanup.json`, and `hidden-after-cleanup.json`. The Quick Add ticket remains as the creation evidence.

## Checks and gate status

No source changes were made, so no build, typecheck, or regression suite was rerun in this evidence-only round. The prior recorded baseline is 42/42 focused assignment/human-work regressions passing and the tickets package typecheck passing; those are prior results, not checks run for this report.

The `security-finding-resolved` executable was not available, and the active project template contains no configured verification specification/label. `security-finding-gate.txt` records this discovery. No security-finding verdict or verification grant is claimed.

## Evidence bundle

Live artifacts are in `/tmp/security-authz-addticketresource-20261104/live-retry/`. The request was run against code revision `b3611c905a0d2fe4d56ec35f22fef44825faa6a8`; this documentation is committed separately after that revision. The most useful first review items are `authorization-evidence-summary.json`, the before/after snapshots and `denied-state-comparison.txt`, followed by the browser action responses and Quick Add state.

## Current-head mitigation review (2026-11-04)

The source revision checked in this review was `de8677f4979841bc8949b1d4be7a1cd4ae2a7d67`. Its diff from repair SHA `b3611c905a0d2fe4d56ec35f22fef44825faa6a8` contained only this evidence document, so the live workflow evidence above exercises the same application code as the checked revision, at implementation SHA `b3611c905a0d2fe4d56ec35f22fef44825faa6a8`. The current-head output bundle was committed afterward as documentation and run logs.

Reviewed the full call graph. The server actions and REST methods perform their tenant-wide permission checks inside a transaction and pass a user authorization context whose callback invokes `authorizeTicketRecordAccess`. The core applies `read` authorization before resource enumeration and `update` authorization before assignment writes, activity records, or returned events. Removal first finds the assignment through the tenant-scoped `ticket_resources` table, authorizes its `ticket_id`, then deletes and writes activity. The other core caller is ticket creation: `createTicketWithSideEffects` supplies a matching `{ kind: 'creation', ticketId }` context while adding requested agents in the ticket-creation transaction. Both user and system contexts are explicit; a missing context is rejected. Assignee eligibility still runs through `assertHumanWorkAssignee` for both additional-agent and primary-promotion paths.

At current HEAD, the focused integration suites passed again (24 ticket-resource tests plus 18 human-work guard tests, 42 total) and `packages/tickets` `npm run typecheck` passed. The current revision, exact origin, fresh redirect-following HTTP 200, authenticated client-portal session identity, and command outputs are in `docs/evidence/security-authz-addticketresource-mitigation-2026-11-04/current-head/`. No source change or additional build was needed.

The new current-head HTTP and authenticated-session observations were collected during this review. The complete mutating live scenarios remain the separately identified execution at application SHA `b3611c905a0d2fe4d56ec35f22fef44825faa6a8`; they were not repeated because the current revision changes only this documentation file. This distinction is intentional. The actual project exit-criteria query still reports only an unrecorded `draft-review` verification and a running envelope; it does not expose `security-finding-resolved`. The executable is also absent from PATH. No external finding verdict is claimed.
