# Scratchpad — Workflow Client Actions

- Plan slug: `2026-04-25-workflow-client-actions`
- Created: `2026-04-25`

## What This Is

Working notes for adding missing Client module workflow actions to Workflow Runtime V2.

## Decisions

- (2026-04-25) Draft action ids use `clients.create`, `clients.update`, `clients.archive`, `clients.delete`, `clients.duplicate`, `clients.add_tag`, `clients.assign_to_ticket`, `clients.add_note`, and `clients.add_interaction`. Rationale: keeps all requested actions in the Client module and allows current catalog prefix grouping to work automatically.
- (2026-04-25) Resolved: use `clients.update` as the implementation id for EDIT client, with UI label "Edit Client". Rationale: action ids are durable runtime/API-style contracts while UI labels can match user-facing wording.
- (2026-04-25) Resolved: `clients.add_note` appends to the client notes document, not the generic CRM activity note/interactions path. Rationale: `crm.create_activity_note` already exists and uses `interactions`; the requested action is explicitly for the Client module, and "add" should not replace existing notes.
- (2026-04-25) Resolved: `clients.delete` is validated hard delete and requires `confirm: true`; `clients.archive` is added now as a separate archive/deactivate action. Rationale: delete and archive are materially different operations and should not be overloaded, and hard delete should require explicit destructive-action confirmation.

## Discoveries / Constraints

- (2026-04-25) Existing client workflow actions are in `shared/workflow/runtime/actions/businessOperations/clients.ts` and currently register only `clients.find` and `clients.search`.
- (2026-04-25) Business operations registration path is already wired: `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts` calls `registerClientActions()`.
- (2026-04-25) The designer catalog already maps `clients.*` actions into the built-in Client group via `shared/workflow/runtime/designer/actionCatalog.ts`; no new catalog group should be needed.
- (2026-04-25) Existing helper patterns are in `shared/workflow/runtime/actions/businessOperations/shared.ts`: `withTenantTransaction`, `requirePermission`, `writeRunAudit`, `throwActionError`, `rethrowAsStandardError`, `actionProvidedKey`, `uuidSchema`, and `isoDateTimeSchema`.
- (2026-04-25) `shared/models/clientModel.ts` has shared create/update/get helpers, but `server/src/lib/api/services/ClientService.ts` has richer delete behavior, tag handling, inactive-client side effects, and workflow event publishing.
- (2026-04-25) `packages/clients/src/actions/clientNoteActions.ts` shows current client notes document behavior using `clients.notes_document_id`, `createBlockDocument`, and `updateBlockContent`.
- (2026-04-25) `packages/clients/src/actions/interactionActions.ts` and `packages/clients/src/models/interactions.ts` show current interaction creation/default-status/event behavior.
- (2026-04-25) Existing `crm.create_activity_note` creates an `interactions` row for target types including `client`; this may overlap conceptually with `clients.add_note` unless the latter is explicitly defined as client notes-document behavior.
- (2026-04-25) `tickets.link_entities` does not currently support linking clients to tickets; `clients.assign_to_ticket` should likely update `tickets.client_id` directly rather than using the generic ticket link table.
- (2026-04-25) No existing duplicate-client implementation was found in quick code search; duplicate semantics need scope confirmation.

## Commands / Runbooks

- (2026-04-25) Context reads/searches used while drafting:
  - `find ee/docs/plans -maxdepth 2 -type f | sort | tail -80`
  - `rg -n "register.*Actions|clients.find|clients.search|actionCatalog|x-workflow-picker-kind" shared ee server -g'*.ts' -g'*.tsx'`
  - `rg -n "class ClientModel|ClientModel|createClient|updateClient|deleteClient|interaction|tag_mappings" server/src shared packages -g'*.ts' -g'*.tsx'`
  - `rg -n "Duplicate Client|duplicateClient|client.*duplicate" packages/clients server/src -g'*.ts' -g'*.tsx'`

## Links / References

- `shared/workflow/runtime/actions/businessOperations/clients.ts`
- `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- `shared/workflow/runtime/actions/businessOperations/crm.ts`
- `shared/workflow/runtime/actions/businessOperations/shared.ts`
- `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`
- `shared/workflow/runtime/designer/actionCatalog.ts`
- `shared/models/clientModel.ts`
- `server/src/lib/api/services/ClientService.ts`
- `packages/clients/src/actions/clientNoteActions.ts`
- `packages/clients/src/actions/interactionActions.ts`
- `packages/clients/src/models/interactions.ts`
- `shared/workflow/runtime/actions/__tests__/registerTicketActionPickerMetadata.test.ts`
- `server/src/test/unit/workflowTicketAssignmentModelRuntime.test.ts`

## Open Questions

- Resolved: EDIT client action id is `clients.update`, with UI label "Edit Client".
- Resolved: `clients.add_note` appends to the client notes document; it does not replace notes and does not create an activity note interaction.
- Resolved: `clients.duplicate` copies safe core profile fields, copies tags by default, supports optional `copy_locations`, and leaves contacts/notes out of v1.
- Resolved: `clients.delete` is validated hard delete with required `confirm: true`; add `clients.archive` now for archive/inactivate semantics.
- Resolved: `clients.assign_to_ticket` preserves omitted contact/location fields; explicit `null` clears them, and non-null provided values must belong to the selected client.
- Resolved: `clients.add_interaction` uses the workflow actor as `user_id` in v1. Future versions may add a permission-gated user override after target-user validation and audit semantics are designed.

## Implementation Log

- (2026-04-25) Implemented Client runtime action expansion in `shared/workflow/runtime/actions/businessOperations/clients.ts`:
  - Added and registered all requested mutating actions: `clients.create`, `clients.update`, `clients.archive`, `clients.delete`, `clients.duplicate`, `clients.add_tag`, `clients.assign_to_ticket`, `clients.add_note`, `clients.add_interaction`.
  - Added picker metadata helper usage for client/ticket/contact/location fields in new action schemas.
  - Added idempotency metadata (`actionProvided`) for create/duplicate/add_tag/add_note/add_interaction.
  - Added audit logging (`writeRunAudit`) across mutating handlers.
  - Added standardized error classification pathways via `throwActionError` and `rethrowAsStandardError` in mutation handlers.

- (2026-04-25) Implemented create/update/archive/delete semantics:
  - `clients.create`: tenant-scoped create, optional location bootstrap from address/phone/email inputs, optional initial tags, and client summary output.
  - `clients.update`: non-empty patch, changed-field reporting, tenant-scoped mutation, and inactive-side-effect deactivation for contacts/client users.
  - `clients.archive`: idempotent inactive transition with no-op behavior when already inactive.
  - `clients.delete`: `confirm: true` guard, default-client protection, explicit `on_not_found` behavior, dependency-validated deletion path via `deleteEntityWithValidation`, and cleanup of client-owned artifacts.

- (2026-04-25) Implemented duplicate/tag/ticket-assignment/notes/interactions:
  - `clients.duplicate`: safe profile duplication with required new client name, `copy_tags` default true, and opt-in `copy_locations`.
  - `clients.add_tag`: tag definition upsert + idempotent tag mappings with added/existing counts and summaries.
  - `clients.assign_to_ticket`: validates ticket/client existence, validates provided contact/location belongs to selected client, preserves omitted contact/location, and supports explicit `null` clear semantics.
  - `clients.add_note`: append-only note block behavior on client notes document with create-if-missing path.
  - `clients.add_interaction`: validates optional contact/ticket relationships, defaults interaction status when omitted, and always uses workflow actor as `user_id`.

- (2026-04-25) Added workflow event publication parity in runtime action handlers where feasible:
  - `CLIENT_CREATED` on create.
  - `CLIENT_UPDATED` on update when effective updated fields exist.
  - `CLIENT_ARCHIVED` on first archive transition.
  - `NOTE_CREATED` when add-note creates a new notes document.
  - `INTERACTION_LOGGED` on add-interaction.
  - Event publishing is implemented as best-effort lazy import (`publishWorkflowDomainEvent`) to keep shared runtime tests stable when event-bus module resolution is unavailable in test-only contexts.

- (2026-04-25) Added unit coverage for registration/catalog/picker metadata:
  - `shared/workflow/runtime/actions/__tests__/registerClientActionsMetadata.test.ts`
  - `shared/workflow/runtime/__tests__/workflowDesignerClientCatalogRuntime.test.ts`
  - Coverage scope:
    - action registration IDs/labels/side-effect/idempotency metadata (`T001`)
    - Client group catalog exposure from runtime registrations (`T002`)
    - picker metadata on assign/note/interaction schemas (`T003`)

## Verification

- (2026-04-25) Build/compile validation:
  - `npm run -s build:shared`

- (2026-04-25) Targeted unit tests (shared runtime root):
  - `npx vitest run --root shared workflow/runtime/actions/__tests__/registerClientActionsMetadata.test.ts workflow/runtime/__tests__/workflowDesignerClientCatalogRuntime.test.ts`
- (2026-04-25) Follow-up hardening: switched workflow-event publishing in runtime client actions to lazy dynamic import helper (`publishWorkflowDomainEvent`) to avoid shared-root test module-resolution failures while preserving runtime publication behavior.
- (2026-04-25) Follow-up hardening: standardized not-found/internal error signaling in helper paths (`ensureClientExists`, `ensureTicketExists`, default interaction status lookup) to use `throwActionError` categories/codes directly.

## Implementation Log — 2026-04-25 (Checkpoint 2)

- Expanded DB-backed workflow client action coverage in `shared/workflow/runtime/actions/__tests__/businessOperations.clients.db.test.ts` to cover:
  - `T004` create + tags + action-provided idempotency-key fallback behavior
  - `T005` update + cross-tenant not-found
  - `T006` delete guardrails (`confirm`, default-client guard, dependency conflict)
  - `T007` duplicate copy semantics (tags by default, optional locations, contacts excluded)
  - `T008` add_tag idempotent no-duplicate behavior
  - `T009` assign_to_ticket preserve/clear semantics
  - `T010` assign_to_ticket relationship validation for contact/location
  - `T011` add_note create-if-missing + append semantics
  - `T012` add_interaction default status + relationship validation + actor ownership
  - `T013` permission-denied coverage for all mutating client actions
  - `T015` archive semantics + associated contact/client-user deactivation and idempotent second run
- Left `T014` pending because it requires runtime-level `action.call` smoke execution with `saveAs` and downstream expression usage (separate harness from direct action handler DB tests).
- Marked `F024` implemented because DB-backed mutation + guard coverage is now added across representative success/failure paths.

## Implementation Log — 2026-04-25 (Checkpoint 2, code fix)

- Updated `ensureClientTagMappings` in `shared/workflow/runtime/actions/businessOperations/clients.ts` to avoid using insert-error control flow for duplicate mappings/definitions in the same transaction.
- Rationale: catching `23505` inside a PostgreSQL transaction still leaves the transaction aborted; subsequent audit writes fail with "current transaction is aborted".
- New behavior: pre-check existing mappings first, insert only when missing, and classify duplicates as `existing` without relying on failed inserts.

## Commands / Verification — 2026-04-25 (Checkpoint 2)

- `npx vitest run --root shared workflow/runtime/actions/__tests__/businessOperations.clients.db.test.ts`
  - Result: passing (10 tests).
- `npx vitest run --root shared workflow/runtime/actions/__tests__/registerClientActionsMetadata.test.ts workflow/runtime/__tests__/workflowDesignerClientCatalogRuntime.test.ts`
  - Result: passing (3 tests).
- `npm run -s build:shared`
  - Result: passing.
- Added runtime smoke coverage for `T014` with `shared/workflow/runtime/nodes/__tests__/actionCallClientSaveAsRuntime.test.ts`.
  - Uses real `action.call` and `transform.assign` node handlers.
  - Invokes representative `clients.create` action id (handler stubbed in-test for deterministic runtime behavior).
  - Verifies `saveAs` output becomes available under `vars.<saveAs>` and is consumed by downstream expression assignments.
- Verification:
  - `npx vitest run --root shared workflow/runtime/nodes/__tests__/actionCallClientSaveAsRuntime.test.ts workflow/runtime/actions/__tests__/businessOperations.clients.db.test.ts`
