# Scratchpad — Workflow Contact Actions

- Plan slug: `2026-04-25-workflow-contact-actions`
- Created: `2026-04-25`

## What This Is

Working notes for adding Contact module workflow actions: create, edit, deactivate, delete, duplicate, add tag, assign to ticket, add note, add interaction, add to client, and move to client.

## Decisions

- 2026-04-25: Draft plan uses one workflow action per requested operation (`contacts.create`, `contacts.update`, etc.) instead of a single mode-based generic contact mutation action. Rationale: better workflow designer UX and clearer downstream output schemas.
- 2026-04-25: Draft plan keeps actions additive under the existing `contacts.*` prefix so the current designer catalog grouping should place them under Contact.
- 2026-04-25: Draft plan recommends requiring a new unique email for `contacts.duplicate` because contact primary emails are tenant-unique.
- 2026-04-25: Draft plan treats `contacts.add_to_client` and `contacts.move_to_client` as separate author-facing actions even though both ultimately update `contacts.client_id`; their conflict/idempotency semantics differ.
- 2026-04-25: User approved separating contact deactivation and hard deletion into two actions instead of using a flag. `contacts.deactivate` should be the safe idempotent action requiring `contact:update`; `contacts.delete` should remain destructive guarded hard delete requiring `contact:delete`.
- 2026-04-25: After merging latest main with workflow Client actions, contact actions should mirror the new Client runtime conventions where applicable: action-provided idempotency for create/duplicate/add_tag/add_note/add_interaction; engine-provided idempotency for update/deactivate/delete/assignment; destructive delete requires `confirm: true`; delete supports explicit `on_not_found` behavior.
- 2026-04-25: Updated `contacts.add_note` plan to be document-backed via `contacts.notes_document_id`, not interaction-backed. Rationale: latest `clients.add_note` establishes module-specific notes as append-only notes-document behavior, while `contacts.add_interaction` and generic `crm.create_activity_note` cover interaction rows.
- 2026-04-25: User resolved remaining product questions: duplicate contact requires a new unique email; contact-to-ticket should not set ticket client unless the existing app action does; contact add-tag should match client add-tag behavior; contact create/update/deactivate should publish domain events with the same lazy best-effort pattern as Client actions.

## Discoveries / Constraints

- 2026-04-25: Existing contact workflow actions live in `shared/workflow/runtime/actions/businessOperations/contacts.ts` and currently register `contacts.find` and `contacts.search`.
- 2026-04-25: Runtime bootstrap calls `registerBusinessOperationsActionsV2()`, which calls `registerContactActions()`, so new actions in `contacts.ts` should flow into the catalog automatically after runtime initialization.
- 2026-04-25: `ContactModel.createContact` requires both `full_name` and `email`; it validates phone numbers, additional email addresses, primary email type, duplicate email, and client existence.
- 2026-04-25: `ContactModel.updateContact` supports patch-like update input but has strict primary-email promotion behavior. Changing primary email requires promoting an existing/additional email path rather than blindly swapping.
- 2026-04-25: Existing contact search in workflow uses `tag_definitions` / `tag_mappings` for contact tags (`tagged_type = 'contact'`).
- 2026-04-25: `server/src/lib/api/services/ContactService.ts` has a private `handleTags()` that references `contact_tags`, but `rg` did not find a migration creating `contact_tags`. Implementation should verify and likely use `tag_mappings`/`TagModel` instead.
- 2026-04-25: Existing contact delete server action in `packages/clients/src/actions/contact-actions/contactActions.tsx` uses `deleteEntityWithValidation('contact', ...)` and performs cleanup for entity tags, phone rows, comments, portal invitations, notes document content/associations, Entra reconciliation queue references, then deletes from `contacts`.
- 2026-04-25: Contact deletion config in `packages/core/src/config/deletion/index.ts` lists dependencies: tickets, interactions, document associations, portal users, survey invitations/responses, and asset associations.
- 2026-04-25: Generic CRM note workflow action `crm.create_activity_note` already creates rows in `interactions` using system `Note` type and supports contact targets. After reviewing new Client actions, `contacts.add_note` should not wrap this path; it should append to the contact notes document, leaving interaction rows to `contacts.add_interaction`/`crm.create_activity_note`.
- 2026-04-25: Existing `packages/clients/src/actions/interactionActions.ts` has `addInteraction` behavior: requires either `client_id` or `contact_name_id`, derives client from contact if needed, and uses default interaction status when omitted.
- 2026-04-25: Permission resources exist for `contact:create/read/update/delete`, `interaction:create/read/update/delete`, and `tag:create/read/update/delete` in migrations/seeds.
- 2026-04-25: Existing ticket workflow actions define local picker metadata helpers in `tickets.ts`; contact actions may need similar helpers or shared extraction to keep schemas designer-friendly.
- 2026-04-25: Latest `clients.assign_to_ticket` uses a direct ticket update contract with previous/current outputs and relationship validation. `contacts.assign_to_ticket` should follow that style rather than requiring an `expected_current_contact_id` guard in v1.
- 2026-04-25: Quick app-path discovery found `packages/tickets/src/components/ticket/TicketDetails.tsx` contact-change code calls `updateTicket(ticket_id, { contact_name_id: newContactId })` only, so the workflow contact assignment plan should not auto-set `tickets.client_id` in v1.
- 2026-04-25: Latest `clients.add_tag` avoids duplicate-insert error control flow because a caught `23505` still aborts the Postgres transaction. Contact tag implementation should pre-check mappings/definitions and return existing mappings idempotently.
- 2026-04-25: Latest Client actions use best-effort lazy workflow event publication for create/update/archive/note/interaction paths. Contact implementation should either match this pattern where event builders exist or document any intentional gap.

## Commands / Runbooks

- 2026-04-25: Context discovery commands used:
  - `find ee/docs/plans -maxdepth 2 -type f \( -name 'PRD.md' -o -name 'features.json' -o -name 'tests.json' -o -name 'SCRATCHPAD.md' \) | head -40`
  - `git log --oneline -5 && git status --short`
  - `rg -n "class ContactModel|createContact|updateContact|deleteContact|ContactModel\." shared server packages ee -g '*.ts' -g '*.tsx' | head -200`
  - `rg -n "contact_name_id|contacts|interaction|tag_mappings|tag_definitions" server shared packages ee -g '*.ts' -g '*.tsx' -g '*.cjs' | head -240`
  - `rg -n "createTable\\('contact_tags'|contact_tags" server/migrations ee/server/migrations -g '*.cjs'`

## Links / References

- `shared/workflow/runtime/actions/businessOperations/contacts.ts`
- `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- `shared/workflow/runtime/actions/businessOperations/crm.ts`
- `shared/workflow/runtime/actions/businessOperations/clients.ts`
- `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`
- `shared/models/contactModel.ts`
- `shared/models/tagModel.ts`
- `server/src/lib/api/schemas/contact.ts`
- `server/src/lib/api/services/ContactService.ts`
- `packages/clients/src/actions/contact-actions/contactActions.tsx`
- `packages/clients/src/actions/contact-actions/contactNoteActions.ts`
- `packages/clients/src/actions/interactionActions.ts`
- `packages/core/src/config/deletion/index.ts`
- `docs/AI_coding_standards.md`

## Resolved Questions

- `contacts.duplicate` requires a new unique email override.
- `contacts.assign_to_ticket` should only set `tickets.contact_name_id` in v1 unless an existing app action path is found to set `tickets.client_id` too. Current discovery indicates the app updates only `contact_name_id`.
- `contacts.add_tag` should create missing tag definitions exactly like `clients.add_tag`, under the same update-style permission policy.
- Contact create/update/deactivate workflow actions should publish contact domain events using the same lazy best-effort pattern as Client actions.

## Implementation Log

- 2026-04-26: Implemented full `contacts.*` mutation action surface in `shared/workflow/runtime/actions/businessOperations/contacts.ts`:
  - Added registrations/schemas/handlers for `contacts.create`, `contacts.update`, `contacts.deactivate`, `contacts.delete`, `contacts.duplicate`, `contacts.add_tag`, `contacts.assign_to_ticket`, `contacts.add_note`, `contacts.add_interaction`, `contacts.add_to_client`, `contacts.move_to_client`.
  - Added workflow picker metadata helper usage for contact/client/ticket IDs and compact normalized contact summary output schema reuse.
  - Added tenant-scoped helper loaders and validations for contact/client/ticket lookups with standard workflow error categories.
  - Added action-provided idempotency for create/duplicate/add_tag/add_note/add_interaction and engine-provided idempotency for update/deactivate/delete/assignment/client-move actions.
  - Added permission checks per PRD (`contact:create/read/update/delete`, `ticket:update`) before mutation paths.
  - Added workflow run audit writes for all side-effectful contact actions via `writeRunAudit`.
  - Added guarded hard-delete implementation using `deleteEntityWithValidation` plus contact-owned artifact cleanup (`tag_mappings`, phone/email rows, comments, portal invitations, notes documents, enterprise queue references).
  - Added best-effort lazy workflow domain event publishing for contact create/update/deactivate plus note/interaction events.
- 2026-04-26: Implemented duplicate-contact constraints/behavior:
  - Requires explicit new primary email (`input.email` required in schema).
  - Supports field overrides and optional tag copy via canonical `tag_definitions` + `tag_mappings`.
  - Does not copy historical relationships (tickets/interactions/notes docs/etc.).
  - Additional emails are only copied when explicitly provided as an override. Rationale: current schema enforces tenant-unique normalized additional emails, so blind copying source additional emails can violate unique constraints.
- 2026-04-26: Added tests:
  - `shared/workflow/runtime/actions/__tests__/registerContactActionsMetadata.test.ts` for registration/catalog labels/idempotency and picker + compact output schema checks (T001/T002).
  - `shared/workflow/runtime/actions/__tests__/businessOperations.contacts.db.test.ts` for DB-backed integration + permission + audit/event coverage across `contacts.*` mutations (T003-T015).

## Verification

- 2026-04-26: Ran targeted suites with shared Vitest config:
  - `pnpm vitest --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/registerContactActionsMetadata.test.ts shared/workflow/runtime/actions/__tests__/businessOperations.contacts.db.test.ts shared/workflow/runtime/actions/__tests__/businessOperations.contacts.emailSearch.test.ts`
  - Result: pass (`3` files, `16` tests).

## Gotchas

- 2026-04-26: `tickets.client_id` in current schema is non-null in this test environment, so no-client ticket scenarios are not representable in DB setup. Assignment tests validate that `contacts.assign_to_ticket` only updates `tickets.contact_name_id` and preserves existing `tickets.client_id` unchanged.
