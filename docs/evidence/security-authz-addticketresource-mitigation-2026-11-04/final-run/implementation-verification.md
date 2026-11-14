# `addTicketResource` mitigation: reproducible implementation evidence

## Scope and revision

This mitigation round preserves the existing authorization repair and the Quick Add atomic staffing repair. It adds behavioral regressions at the real action/component entry points and records what this run verified. No production source files changed in this round. No approved plan appears in `git log main..HEAD --name-only -- docs/plans/`; work followed the supplied dossier at `/tmp/alga-smoke-evidence/security-authz-addticketresource-20261104/plan.md` and the user's mitigation work order.

## Action-to-core trace

- The exported `addTicketResource`, `getTicketResources`, `removeTicketResource`, and `canAddAsAdditionalAgent` server actions are in `packages/tickets/src/actions/ticketResourceActions.ts`. They check tenant-wide permission and open a transaction; user operations pass an explicit callback to `authorizeTicketRecordAccess`.
- `shared/services/tickets/ticketResourceCore.ts` requires an authorization context at its resource entry points. Add authorizes `update` before ticket/assignee reads or writes; read authorizes `read` before looking up the ticket/resources. Remove resolves `assignment_id` through tenant-scoped `ticket_resources`, obtains its `ticket_id`, authorizes that owning ticket for `update`, then deletes and writes activity.
- `addTicketResourceCore` calls `assertHumanWorkAssignee` before either writing an additional-agent row or promoting an assignee to primary. TicketService REST methods use the same core and user authorization context at `server/src/lib/api/services/TicketService.ts:1022`, `:1062`, `:1085`, and `:1219`; REST create/update primary assignment eligibility also calls the human-work guard at `:2098`.
- Quick Add serializes its selected agents as `additional_agent_ids` in `packages/tickets/src/components/QuickAddTicket.tsx:1237-1238`, then submits the form to `addTicket` at `:1271`. `packages/tickets/src/actions/ticketActions.ts:596` parses and validates creation extras; `:817-824` adds every agent through `addTicketResourceCore` within the ticket's transaction and registers its event for after commit. `shared/services/tickets/createTicketWithSideEffects.ts:239-270` is the other creation caller; it filters duplicate staffing and calls the same core with a matching creation context.
- The core's trusted `system` context remains available to internal service flows; user-facing actions and REST handlers construct `user` contexts. Creation contexts are ticket-ID-bound and used only by the create flows. Missing/invalid contexts fail closed in the core.

## Checks run in this mitigation round

Commands were run from the paths shown; full stdout is retained beside this file.

| Command | Result | Concrete assertions |
| --- | --- | --- |
| From `server/`: `npx vitest run src/test/integration/ticketAssignmentResources.integration.test.ts src/test/integration/T043.humanWorkGuard.integration.test.ts src/test/integration/ticketClientPortalAbac.integration.test.ts src/test/integration/ticketCreateExtras.integration.test.ts --coverage.enabled=false` | Passed, 4 files / 71 tests. See `server-focused-regressions.log`. | Exported resource server actions run against a real PostgreSQL fixture. A client principal can read/check eligibility/add/remove resources on a visible same-tenant ticket. Hidden-board resource read, eligibility, add, and known-assignment-ID removal are denied; primary assignment, resource rows, audit activity, and published events remain unchanged. Creation persists selected additional staffing even when the creator's later ticket updates are denied. Invalid later staffing rolls the ticket and earlier staffing back; no creation/assignment audit rows or published events result. Existing human-work tests reject ineligible assignees. |
| From `packages/tickets/`: `npx vitest run src/components/__tests__/QuickAddTicket.template.test.tsx --coverage.enabled=false` | Passed, 1 file / 10 tests. See `quick-add-ui.log`. | The Quick Add component serializes selected agents into `additional_agent_ids` on the call to `addTicket` and displays the returned actionable staffing failure without treating creation as successful. |
| From `packages/tickets/`: `npm run typecheck` | Passed. See `tickets-typecheck.log`. | TypeScript check for the affected tickets package. |
| From `packages/tickets/`: `npm run build` | Failed before compiling: configured `tsup` reports `No input files`. | Package has no usable `tsup` input/config for this script; this is not counted as a successful build. |
| From `server/`: `npm run typecheck` and `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | Both hit Node heap exhaustion (4 GB and 8 GB respectively). | The server-wide check did not complete. The second process reached about 8 GB RSS before aborting. |

The client-action integration fixture uses the production `authorizeTicketRecordAccess` and authorization kernel against PostgreSQL, including the real contact visibility group and visible/hidden boards. Its `hasPermission` seam is mocked to grant the client tenant-wide permissions; database-backed role-to-permission resolution is therefore not part of this particular record-authorization regression. The create-extras integration suite uses real RBAC fixture rows and the exported `addTicket` action/core/database path.

The `TestContext` in the create-extras suite owns an outer transaction, so successful create after-commit callbacks are queued until suite cleanup. In this harness, the rollback test directly verifies that failed staffing produces no published events, but successful creation event delivery after the owning transaction commit is not observed. The standalone authorized `addTicketResource` action regression does observe its assignment event after its transaction commits. The production create path registers its creation and assignment events with `registerAfterCommit` at `ticketActions.ts:824` and `:829`.

## Controlled mutation

The action's `authorizeTicketRecordAccess` callback was temporarily replaced with a no-op in `packages/tickets/src/actions/ticketResourceActions.ts`; the source was restored immediately afterward. The command `npx vitest run src/test/integration/ticketClientPortalAbac.integration.test.ts -t "authorizes client ticket-resource actions" --coverage.enabled=false` failed as expected: the hidden-ticket resource read returned its assignment row instead of a permission error. The test passed against the restored source in the final 71-test run. This comparison demonstrates that the new regression detects removal of the action-level record policy.

## Not run / review notes

No app server was started and no live browser checks were run because this assignment prohibited starting the app. The historical browser observations in the parent evidence report are not repeated or treated as current-run verification. `security-finding-resolved` was not found or executed, so no such check is claimed as passing.

First review: this file and the adjacent focused logs, then `ticketClientPortalAbac.integration.test.ts`'s resource-action case, `ticketAssignmentResources.integration.test.ts`'s authorized post-commit/denial cases, `ticketCreateExtras.integration.test.ts`'s create/rollback cases, and `QuickAddTicket.template.test.tsx`'s submit/failure case.
