# PR #4194 ticket review evidence and walkthrough

This supplements the approved [design](2026-11-03-apply-current-redactions-to-remaining-c-design.md) with fresh evidence for the ticket readers. It does not claim a live C2 demonstration or that the automatic review hold is cleared.

## Current-revision evidence

This signal-regression repair round started from branch `feature/security-apply-current-redactions-to-remaining-c` at `f336b0a7b781ae920fa2060205d961a3d22c4eaf`, equal to its remote tracking branch. The checkout was clean at start. There was no inherited `package-lock.json` modification.

**Tested implementation and regression revision:** `8d731599eeea7b10944c7f5bf696ad816f7e0a90`. The review-note update is documentation-only and follows this tested code revision.

At that exact revision, results were:

- `npm -w @alga-psa/co-managed test -- --coverage.enabled=false` — 208 passed across 18 files on the tested revision.
- `npm -w @alga-psa/co-managed run typecheck` — passed on the tested revision.
- The ticket PostgreSQL integration command below — 9 passed on the tested revision, including the repaired non-vacuous signal regression.
- The task PostgreSQL integration command below — 12 passed on the tested revision, including snapshot, history, list, conflict, and tightened-attribution protections.
- The two task editor/queue UI unit suites below — 17 passed on the tested revision.
- Mutation checks on the same test fixture independently forced the escalated-signal and awaiting-signal visibility guards to `true`. Each run failed at the post-redaction signal-count assertion with the corresponding leaked signal (`escalatedUnassigned: 1` and `awaitingReply: 1`); both guards were restored and the final ticket PostgreSQL run passed.
- `npm -w server run typecheck` on implementation commit `2b98fd0e8f8fbd12d78fe16447f84495de7351b4` (before the test-only metadata assertions in `94f153911d6ee33202ceb28cdb4b99dd2a9c03e9`) did not pass: the full server TypeScript process hit Node's default 4 GB heap limit and aborted. The implementation source was unchanged by the test-only commit. The co-managed package typecheck and affected runtime suites passed; this full-server result is a resource limitation, not a passing check.

The PostgreSQL suite creates an isolated scratch database named `l3b1_queue_test` through `createTestDbConnection`; it runs migrations and test fixtures there. It does not use the app server. The local test connection comes from `.env.localtest` (`localhost:5472`). The test fixture removes its bundle rule and restores relationship redactions in `finally`; the next run recreates the scratch database.

The focused database scenario exercises `getCoManagedTicketQueue`, `exportCoManagedTicketQueue`, `getCoManagedTicketAssignment`, and `getCoManagedSharedTicketDetails` against PostgreSQL. It uses three distinct tickets to keep each workflow condition live: A:a4 is unassigned and MSP-responsible, A:a3 is assigned and MSP-responsible with `awaiting_internal`, and B:b1 is assigned and customer-responsible with `awaiting_internal`. Immediately before each bundle or relationship policy is tightened, it asserts one escalated-unassigned signal and two awaiting-reply signals, including the filtered ticket IDs. It checks:

- Unredacted reads return the current assignment names. A:a4 remains in Working and contributes to `escalated_unassigned`; A:a3 and B:b1 contribute to `awaiting_reply` while the customer-responsible B:b1 also remains in Working because it is assigned.
- A published authorization bundle redacting `tickets.assignee_name` and `values.organization_name` removes assignment names and assignment presence from responses. Both signals return zero when their assignment dependency is hidden. The assigned customer-responsible ticket drops from Working because hidden assignment is its only Working-membership reason; the MSP-responsible ticket remains because responsibility independently admits it. Oversight membership and counts, and the active staff relationship count, remain unchanged.
- Whole queue, oversight, export, assignment, and detail responses are checked for both seeded assignee names so names cannot escape through other returned metadata.
- After assignment, relationship redactions are tightened independently for two customers. The reference rows, work rows, and owner-ticket assignment/response state are compared with their pre-tightening values. A:a4 and A:a3 remain in Working because their responsibility is MSP; B:b1 leaves Working because its customer responsibility makes its assignment the only membership reason and that source is hidden. Both signal counts and both filtered signal results are empty after each policy change. The assignment response suppresses its MSP name; the ticket details response follows its own sources, so an organization-name redaction does not hide the separately permitted customer-assignee name.
- Export uses the same redacted relation. Cross-customer actor access and a ticket ID paired with the wrong relationship are denied.

The ticket reference schema stores routing and principal IDs, not cached assignee names. Assignment and ticket detail readers resolve names from live user/team/customer rows. Their current callback `redactedFields` are applied before names leave the readers. The queue returns no raw reference columns: assignment presence is either a visible boolean or absent, and its signals, membership and counts are computed in the same SQL relation.

This run also exposed and repaired a reader admission defect: `withCoManagedSharedWork` had omitted the MSP routing board from the authorization record, so a `selected_boards` bundle policy rejected assignment/detail reads that the queue admitted. It now loads `board_id` only from a reference qualified by customer tenant, relationship, ticket, matching work ID, and sponsor client. The real-PostgreSQL test exercises that policy through the assignment and detail readers.

### Reproduce the checks

From the repository root:

```sh
npm -w @alga-psa/co-managed test -- --coverage.enabled=false
npm -w @alga-psa/co-managed run typecheck
```

From `server/`:

```sh
node --env-file=../.env.localtest ../node_modules/vitest/vitest.mjs run src/test/integration/coManagedTicketQueue.db.test.ts --coverage.enabled=false
node --env-file=../.env.localtest ../node_modules/vitest/vitest.mjs run src/test/integration/coManagedL3cTaskEditing.integration.test.ts --coverage.enabled=false
SKIP_DB_TESTS=1 npx vitest run src/test/unit/product/coManagedProjectTaskEditor.test.tsx src/test/unit/product/coManagedProjectTaskQueue.test.tsx --coverage.enabled=false --maxWorkers=1
```

## Ticket walkthrough for the next review owner

The executable path is the real-PostgreSQL test above. It is the only existing ticket-reader path found in this checkout: repository search found definitions for the server actions but no UI component caller. The public entry points are:

- `getCoManagedTicketQueueAction`, `getCoManagedWorkSignalsAction`, and `exportCoManagedTicketQueueAction` in `server/src/lib/actions/coManagedTicketQueueActions.ts`.
- `getSharedTicketAssignmentAction` in `server/src/lib/actions/coManagedTicketAssignmentActions.ts`.
- `getSharedTicketDetailsAction` in `server/src/lib/actions/coManagedSharedWorkActions.ts`; it combines the admitted screen and details reads.

No navigation path is documented because no caller exists in this revision. The database integration test calls the exported package reader functions directly; it does not claim to exercise the Next.js action wrapper or a browser.

The test's concrete sequence is:

1. Read the unredacted queue and details. Confirm A:a4 is unassigned and MSP-responsible, A:a3 is assigned and MSP-responsible, and B:b1 is assigned and customer-responsible. Confirm signal counts `{ escalatedUnassigned: 1, awaitingReply: 2 }` and filtered results `[A:a4]` and `[A:a3, B:b1]`.
2. Publish the temporary bundle redactions. Confirm A:a4 and A:a3 remain in Working, B:b1 leaves Working, both signal counts become zero, and both filtered results are empty. Re-read export, assignment, and detail responses for omitted/masked assignment fields and unchanged Oversight totals. Compare all stored work, reference, assignment, and response-state rows with their pre-policy values.
3. Remove the bundle, reassert positive signal counts and filtered IDs, then tighten each relationship after assignment. Repeat the Working, signal, count, export, assignment, and detail assertions and compare stored rows/state again.
4. Exercise unauthorized actor and wrong-relationship reads, then run `finally` cleanup. The isolated scratch database is recreated on the next run.

The approved design intentionally couples redaction of assignment sources with assignment-presence disclosure. Therefore Working membership and counts can change for a customer-responsible ticket admitted only by assignment; this is expected, not a side effect of name masking. A ticket still admitted by visible MSP responsibility remains in Working. Signals that depend on hidden assignment are disabled. Oversight remains governed by its authorized relation.

## Remaining live review work

The app server was deliberately left stopped for this repair. No replacement app server, production review app, live ticket read, browser payload inspection, or live C2 check was performed. The next smoke/review owner must use an approved running environment and demonstrate the ordinary ticket read, queue, signal/count responses, and the same relationship-policy tightening through an actual caller once one exists; record the app revision and inspect both serialized response payloads and rendered output. Since this revision has no UI caller and the redaction policy has no customer configuration screen, the owner must state which authenticated action/integration harness was used and how the test relationship policy was changed. Do not infer a product navigation path from these server-action definitions.

For task protections, keep the existing regression evidence in view: task snapshot, list, history, and conflict behavior must remain green. In particular, a hidden assignee remains assigned with a non-null masked assignment representation and the editor displays “Assigned (name hidden)”; assignment kind handling and independently permitted actor attribution remain as currently covered.
