# Store-only service request submissions implementation plan

## Intent

Add an explicit `store-only` execution mode to the existing service-request/questionnaire pipeline. A completed form remains a normal, immutable `service_request_submissions` record with its published definition version, payload, attachments, requester, client, timestamps, search event, and existing MSP/client history views, but no ticket or workflow execution is created.

The existing `ticket-only` behavior remains the default for old and newly created definitions unless an administrator deliberately selects store-only.

## Code-grounded design

The current pipeline already separates persistence from execution in `server/src/lib/service-requests/submissionService.ts`: it creates the submission first, then looks up a provider and calls `execute`. Provider registration lives in `server/src/lib/service-requests/providers/registry.ts`; the ticket implementation is `providers/builtins/ticketOnlyExecutionProvider.ts`; definition validation and the editor already consume registered provider metadata. Submission history is already exposed through `submissionHistory.ts`, the MSP definition editor, and client portal My Requests.

Use that seam instead of adding a parallel storage model:

1. Add `STORE_ONLY: 'store-only'` to the execution-provider domain constants.
2. Add a built-in `storeOnlyExecutionProvider` with a human-facing label/description, empty configuration, and an `execute` result of `succeeded` with no ticket id, workflow id, redirect, notification, or ticket event.
3. Register it beside `ticket-only`. The existing definition-validation and provider-option plumbing should then accept and display it.
4. Update the definition editor so ticket-routing fields and ticket-only validation are shown only for `ticket-only`; store-only presents a concise explanation that the response is retained without creating a ticket.
5. Keep `ticket-only` as the creation/default value in `definitionManagement.ts` and `starterTemplateProvider.ts`. Published definition versions continue to snapshot the selected provider, making behavior version-stable.
6. Keep submission completion in the common service: store-only moves the persisted row from `pending` to `succeeded`, with `created_ticket_id` and `workflow_execution_id` null. Existing history/detail/search paths remain the retrieval surface.

## Idempotent retry

The present submission path has no durable duplicate key. Add a nullable `client_submission_key` to `service_request_submissions` and a tenant-scoped unique index over `(tenant, requester_user_id, definition_id, client_submission_key)` for non-null keys.

- Generate one opaque UUID when the portal form instance is created and submit it with the payload.
- Accept and validate the key in the server action and `SubmitPortalServiceRequestInput`.
- Before inserting, return the existing submission for the same scoped key.
- Handle concurrent unique-key races by loading and returning the winning row; never execute the provider twice for one key.
- Do not deduplicate submissions that omit the key, preserving compatibility for internal callers until migrated.
- A replay returns the stored terminal/pending result and existing redirect/ticket reference where applicable; it never re-runs ticket, workflow, notification, or store-only completion side effects.

## Implementation sequence

1. Add the migration, tenant-table metadata/type updates, domain constant, and submission input/result support for the idempotency key.
2. Extract or add a small lookup/result-mapping helper so pre-insert replay and unique-race recovery share behavior.
3. Implement and register `storeOnlyExecutionProvider`.
4. Update editor copy/conditional ticket-routing UI and translations; retain ticket-only defaults.
5. Update portal form submission to create and reuse a UUID across retries for the same rendered attempt.
6. Confirm MSP and client history/detail screens render store-only rows with no ticket link and a successful status; add neutral copy where the absence of a ticket currently looks exceptional.
7. Add the behavioral coverage below and run focused typecheck/tests.

## Behavioral coverage

- DB-backed integration: store-only submission persists the exact definition version, raw payload, attachments, requester/client/contact, succeeds, and creates zero tickets and zero workflow executions.
- DB-backed integration: ticket-only still creates exactly one ticket and retains the same submission record.
- DB-backed concurrency/retry: two requests with the same client submission key return one submission and produce one provider execution/ticket at most; a different key creates a distinct submission.
- Authorization: a client can read only submissions for its own client/account, while authorized MSP users retain definition-scoped access.
- UI: administrator can select and publish store-only, reload the editor, and see the saved mode; older definitions remain ticket-only.
- History/detail: store-only responses remain visible with submitted time, respondent, version snapshot, answers, attachments, and no ticket link.
- Side-effect guard: store-only emits no ticket creation, ticket notification, ticket-domain event, or workflow start. Submission search/update events remain allowed because they index the retained response itself.
- Failure guard: validation and attachment failures persist nothing; an unsupported provider remains a visible failed submission under existing behavior.

## Deliberate non-goals

- No synthetic/hidden ticket.
- No structured account/asset field mapping; that is the follow-on card.
- No generic multi-destination orchestration framework. The provider registry is already the extensibility seam.
- No change to deletion/retention policy beyond the existing service-request submission model.
- No customer communication or alga0002313 update without Robert's explicit approval.

## Risks and checks

- The idempotency unique index must be Citus-compatible and tenant-distributed; follow existing migration conventions and validate on the integration bootstrap.
- Replays observed while the original row is still `pending` must not trigger a second execution. Return a stable pending response and let the original request finish.
- Provider labels and explanatory text must be translated, not raw internal keys.
- Tests must assert persisted records and user-visible/side-effect behavior; do not add source-string assertions.

## Done when

An administrator can publish a service request in store-only mode, a portal user can submit it once or safely retry it, the full immutable response is visible in the existing account-scoped history, and database/event evidence proves no ticket-specific side effect occurred. Ticket-only remains backward compatible and creates exactly one ticket under the same retry test.
