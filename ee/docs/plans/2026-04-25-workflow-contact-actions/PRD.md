# PRD — Workflow Contact Actions

- Slug: `2026-04-25-workflow-contact-actions`
- Date: `2026-04-25`
- Status: Draft — product decisions resolved; ready for implementation planning

## Summary

Add first-class workflow designer actions in the Contact module for creating, editing, deactivating, deleting, duplicating, tagging, ticket-associating, note logging, interaction logging, and client assignment/movement of contacts.

These actions should appear in the existing Contact grouped action catalog and execute through the existing `action.call` runtime path. They should follow the established business operation action conventions in `shared/workflow/runtime/actions/businessOperations/*`: Zod schemas for designer forms, tenant-scoped transactional handlers, permission checks, idempotency declarations, structured outputs for downstream workflow steps, and workflow run audit records for side-effectful mutations.

## Problem

Workflow authors can currently find and search contacts, but cannot perform common contact mutations without falling back to generic API/webhook workarounds or indirect actions. This leaves contact-centric automations incomplete, especially for inbound email, onboarding, ticket triage, client hygiene, and CRM follow-up flows.

The requested missing operations are:

1. Edit contact
2. Create contact
3. Deactivate contact
4. Delete contact
5. Duplicate contact
6. Add tag to contact
7. Assign contact to ticket
8. Add note to contact
9. Add interaction to contact
10. Add contact to client
11. Move contact to different client

## Goals

1. Register designer-visible Contact actions for each requested operation.
2. Reuse existing contact, tag, ticket, and interaction domain behavior where practical instead of creating alternate data semantics.
3. Keep action schemas workflow-author friendly, with picker metadata for contact, client, ticket, interaction type/status, and tag-like inputs where supported.
4. Ensure every write is tenant-scoped, permission-checked, transactional, and fail-fast with standard workflow action errors.
5. Return compact but useful outputs, including affected IDs, current contact summary, previous/current client IDs where relevant, and explicit status fields for idempotent operations where useful.
6. Preserve current workflow designer grouping: all new `contacts.*` actions appear under the Contact group.

## Non-goals

1. Redesigning the workflow designer UI beyond schema metadata needed for pickers and structured fields.
2. Adding new database tables or migrations unless implementation discovers a schema gap.
3. Replacing the existing generic `crm.create_activity_note` action; `contacts.add_note` may wrap/parallel that behavior for contact-specific authoring.
4. Adding bulk contact actions in this phase.
5. Comprehensive contact merge/deduplication workflows beyond creating a duplicate contact from an existing contact.
6. Changing public REST API behavior for contacts.

## Users and Primary Flows

### Workflow author

- Builds automations from the grouped workflow action palette.
- Selects Contact actions without needing to know REST endpoints or table names.
- Maps values from prior steps (`contacts.find`, inbound email payloads, ticket creation outputs, form submissions) into contact action inputs.

### MSP operations user

- Benefits from automations that keep contacts, clients, tickets, and CRM records current.
- Expects workflows to obey the same tenant and permission boundaries as normal MSP actions.

### Primary flows

1. **Inbound email creates or updates a contact**
   - Find contact by email.
   - If missing, create contact.
   - Add the contact to the matched client.
   - Assign the contact to the created ticket.
   - Add a note/interaction documenting the source.

2. **Ticket triage assigns a contact**
   - Use client/contact search outputs.
   - Assign selected contact to a ticket.
   - Optionally tag the contact for follow-up.

3. **Client hygiene automation moves contacts**
   - Detect a contact associated with the wrong client.
   - Move the contact to a target client with an expected-current-client guard.
   - Return before/after client IDs for downstream notifications.

4. **CRM follow-up logging**
   - Add a contact note or richer interaction after a workflow milestone.
   - Use the contact’s client automatically when possible.

## UX / UI Notes

1. New actions should be registered with `id` values prefixed by `contacts.` so the existing catalog builder groups them under Contact.
2. Suggested labels:
   - `contacts.create` → Create Contact
   - `contacts.update` → Edit Contact
   - `contacts.deactivate` → Deactivate Contact
   - `contacts.delete` → Delete Contact
   - `contacts.duplicate` → Duplicate Contact
   - `contacts.add_tag` → Add Tag to Contact
   - `contacts.assign_to_ticket` → Assign Contact to Ticket
   - `contacts.add_note` → Add Note to Contact
   - `contacts.add_interaction` → Add Interaction to Contact
   - `contacts.add_to_client` → Add Contact to Client
   - `contacts.move_to_client` → Move Contact to Client
3. Picker metadata should be added where possible:
   - `contact_id` / `source_contact_id` → contact picker
   - `client_id` / `target_client_id` → client picker
   - `ticket_id` → ticket picker
   - `interaction_type_id` → interaction type picker if a picker kind exists or is added
   - `status_id` → interaction status picker if a picker kind exists or is added
4. Keep schemas structured and explicit. Avoid raw JSON-only fields for contact updates, phone numbers, additional emails, or interaction metadata when a typed structure is feasible.

## Requirements

### Functional Requirements

#### Shared contact output shape

All contact-mutating actions should return a compact normalized contact object, at minimum:

```ts
{
  contact_name_id: string,
  full_name: string | null,
  email: string | null,
  phone: string | null,
  client_id: string | null,
  is_inactive: boolean
}
```

Actions may include richer fields where useful, but downstream mapping should not require a full `IContact` payload.

#### Create contact — `contacts.create`

1. Creates a contact using existing contact validation semantics.
2. Requires `full_name` and `email`, matching `ContactModel.createContact` requirements.
3. Accepts optional `client_id`, role, notes, inactive state, phone numbers, primary email type, additional email addresses, and optional tags.
4. Validates referenced client exists in the tenant when provided.
5. Fails on duplicate primary/additional email conflicts using standard workflow error categories.
6. Returns the created contact and `created: true`.

#### Edit contact — `contacts.update`

1. Updates an existing contact by `contact_id`.
2. Accepts a `patch` object with the same updateable fields as the contact API/model.
3. Uses patch semantics: omitted fields are unchanged; explicit nullable fields clear only where the underlying model permits clearing.
4. Preserves existing primary-email promotion rules from `ContactModel.updateContact`.
5. Optionally supports tag replacement only if included deliberately in the update schema; otherwise tag changes stay in `contacts.add_tag`/future tag actions.
6. Returns before/after contact summaries and list of updated fields.

#### Deactivate contact — `contacts.deactivate`

1. Sets `contacts.is_inactive = true` without deleting the contact record.
2. Is idempotent: if the contact is already inactive, return `noop: true` and leave the record unchanged.
3. Requires `contact:update`.
4. Returns the contact ID, previous inactive state, current inactive state, `deactivated: true`, and a compact contact summary.
5. This action is the safe default for workflow authors who want to remove a contact from active use without destroying records.

#### Delete contact — `contacts.delete`

1. Performs a guarded hard delete, distinct from deactivation.
2. Requires `confirm: true` as an explicit destructive-action guard.
3. Supports explicit missing-record behavior via `on_not_found` (`error` by default, optional `return_false`).
4. Matches the existing UI/server delete behavior as closely as shared runtime boundaries allow.
5. Cleans up owned child rows consistently with existing server action behavior.
6. Fails with dependency details when associated records prevent deletion, such as tickets, interactions, documents, portal users, survey records, or asset associations.
7. Requires `contact:delete`.
8. Returns `{ deleted: true, contact_id }` on success and `{ deleted: false, contact_id }` only for `on_not_found: return_false`.
9. This action should be labeled and described as destructive in the designer.

#### Duplicate contact — `contacts.duplicate`

1. Creates a new contact using fields copied from a source contact.
2. Requires a new unique primary email by default because contact primary emails are tenant-unique.
3. Allows overrides for `full_name`, `email`, `client_id`, role, notes, phone numbers, additional emails, inactive state, and whether to copy tags.
4. Defaults target client to the source contact’s client unless `target_client_id` is supplied.
5. Does not copy contact notes documents, tickets, interactions, portal users, invitations, external integration mappings, or other historical relationships in v1.
6. Supports an optional external `idempotency_key` using action-provided idempotency.
7. Returns source and duplicate contact summaries plus copied tag counts.

#### Add tag to contact — `contacts.add_tag`

1. Adds one or more tag mappings for a contact without replacing existing tags.
2. Reuses the `tag_definitions` / `tag_mappings` model used by existing contact CSV import/search behavior.
3. Is idempotent: existing mappings are returned as `existing` rather than failing or duplicating rows.
4. Requires contact exists and tag text passes existing tag validation.
5. Requires `contact:update`; missing tag definitions may be created under the same permission policy as `clients.add_tag`.
6. Supports an optional external `idempotency_key` using action-provided idempotency.
7. Returns added/existing tag summaries and counts.

#### Assign contact to ticket — `contacts.assign_to_ticket`

1. Sets `tickets.contact_name_id` for a ticket.
2. Validates ticket and contact exist in the tenant.
3. Mirrors the new client-assignment action style: a direct ticket update with relationship validation and previous/current output fields.
4. Requires a non-null contact to belong to the ticket’s existing client when the ticket has a client.
5. If the ticket has no client and the contact has a client, do not automatically set `tickets.client_id` unless the existing application action path does so. Current implementation discovery shows the ticket UI updates contact via `updateTicket(..., { contact_name_id })` only, so v1 should only set `tickets.contact_name_id`.
6. Supports optional `reason` / `comment` fields for audit detail only; do not create a ticket comment in v1 unless explicitly implemented.
7. Returns ticket ID, previous contact ID, and current contact ID. Re-running with the same contact is naturally idempotent through the same previous/current output shape.
8. Requires `ticket:update` and `contact:read`.

#### Add note to contact — `contacts.add_note`

1. Appends note content to the contact’s notes document (`contacts.notes_document_id`), matching the module-specific notes-document pattern now used by `clients.add_note`.
2. Creates the notes document when missing, links it to the contact, and appends a workflow-created note block rather than replacing existing notes.
3. Does not create an `interactions` row; richer activity history belongs in `contacts.add_interaction` or the existing generic `crm.create_activity_note` action.
4. Publishes or preserves existing `NOTE_CREATED` behavior when a new notes document is created, using the same best-effort/lazy event approach as the new client actions where feasible.
5. Supports body and optional external `idempotency_key` using action-provided idempotency.
6. Returns contact ID, document ID, whether a document was created, and updated timestamp.
7. Requires `contact:update`.

#### Add interaction to contact — `contacts.add_interaction`

1. Creates a richer interaction row linked to the contact.
2. Derives `client_id` from the contact and fails if the contact is not associated with a client.
3. Accepts interaction type, title/subject, notes/description, status, start/end/duration or occurred-at timestamp according to existing interaction schema.
4. Uses default interaction status when none is supplied, matching existing `addInteraction` and the new `clients.add_interaction` behavior.
5. Uses the workflow actor as `user_id` in v1. Do not expose arbitrary user attribution until a permission-gated future version defines target-user validation and audit semantics.
6. Validates optional ticket relationship when supplied; the ticket must belong to the derived client when it already has a client.
7. Supports an optional external `idempotency_key` using action-provided idempotency.
8. Publishes or preserves `INTERACTION_LOGGED` behavior using the same best-effort/lazy event approach as the new client action where feasible.
9. Returns interaction ID, contact ID, client ID, type/status details, timestamps, duration, notes, title, ticket ID, and actor user ID.
10. Requires `contact:update` for parity with `clients.add_interaction`.

#### Add contact to client — `contacts.add_to_client`

1. Sets `client_id` for a contact that currently has no client.
2. Fails with a conflict if the contact is already assigned to a different client, directing workflow authors to `contacts.move_to_client`.
3. Is idempotent when contact is already assigned to the target client.
4. Returns previous and current client IDs plus `noop`.
5. Requires `contact:update`.

#### Move contact to different client — `contacts.move_to_client`

1. Moves a contact from one client to another by updating `contacts.client_id`.
2. Validates target client exists and is tenant-scoped.
3. Supports optional `expected_current_client_id` to prevent moving from an unexpected source client.
4. Is idempotent when already on the target client.
5. Returns previous and current client IDs plus `noop`.
6. Requires `contact:update`.

### Non-functional Requirements

1. All database operations must include tenant filters and run inside `withTenantTransaction`.
2. Every side-effectful action must write a workflow run audit record using the existing `writeRunAudit` helper.
3. Error handling must map validation, not-found, conflict, permission, and transient cases to standard workflow action errors.
4. Action schemas should be versioned at `version: 1` for new action IDs.
5. Side-effectful actions should follow the idempotency split established by the new Client actions:
   - `actionProvided` with `actionProvidedKey` for create/duplicate/add_tag/add_note/add_interaction actions that create records or append content and need retry-safe caller semantics.
   - `engineProvided` for update/deactivate/delete and relationship reassignment actions that are deterministic state transitions.

## Data / API / Integrations

### Existing code paths to reuse/reference

- Contact workflow actions: `shared/workflow/runtime/actions/businessOperations/contacts.ts`
- Registration: `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`
- Contact model: `shared/models/contactModel.ts`
- Contact API schema/service: `server/src/lib/api/schemas/contact.ts`, `server/src/lib/api/services/ContactService.ts`
- Contact delete server action: `packages/clients/src/actions/contact-actions/contactActions.tsx`
- Contact notes document action: `packages/clients/src/actions/contact-actions/contactNoteActions.ts`
- Tag model: `shared/models/tagModel.ts`
- Ticket assignment/update patterns: `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- Client workflow action expansion template: `shared/workflow/runtime/actions/businessOperations/clients.ts`
- CRM activity-note action for generic interaction-backed notes: `shared/workflow/runtime/actions/businessOperations/crm.ts`
- Interaction server action/model: `packages/clients/src/actions/interactionActions.ts`, `packages/clients/src/models/interactions.ts`

### Known schema considerations

1. `contacts` uses `contact_name_id` as the primary contact ID field.
2. Primary contact emails are tenant-unique.
3. Existing contact search filters tags through `tag_definitions` / `tag_mappings` with `tagged_type = 'contact'`.
4. `ContactService.handleTags` references `contact_tags`, but no migration was found for that table during planning. Implementation should prefer `tag_mappings` unless further investigation proves otherwise.
5. Existing delete configuration identifies contact dependencies across tickets, interactions, documents, portal users, survey records, and asset associations.
6. Interactions have evolved over migrations; implementation must confirm the current required columns and default interaction status/type behavior before writing handlers.
7. Contact module notes are document-backed through `contacts.notes_document_id`; do not conflate `contacts.add_note` with interaction-backed activity notes.

## Security / Permissions

Recommended permission checks:

| Action | Permission(s) |
| --- | --- |
| `contacts.create` | `contact:create` |
| `contacts.update` | `contact:update` |
| `contacts.deactivate` | `contact:update` |
| `contacts.delete` | `contact:delete` |
| `contacts.duplicate` | `contact:read` + `contact:create` |
| `contacts.add_tag` | `contact:update` (including creation of missing tag definitions, matching `clients.add_tag`) |
| `contacts.assign_to_ticket` | `ticket:update` + `contact:read` |
| `contacts.add_note` | `contact:update` |
| `contacts.add_interaction` | `contact:update` for parity with `clients.add_interaction` |
| `contacts.add_to_client` | `contact:update` |
| `contacts.move_to_client` | `contact:update` |

All permission checks must be based on the workflow actor resolved by `withTenantTransaction`.

## Approaches Considered

### Approach A — One designer action per requested operation, shared helpers inside `contacts.ts` (recommended)

Pros:
- Matches the user’s requested mental model and designer catalog expectations.
- Keeps Contact group discoverable.
- Allows focused schemas, labels, and outputs per operation.
- Can still share validation/output/helper code internally.

Cons:
- More action definitions to maintain.
- Some overlap between `add_to_client`, `move_to_client`, and generic update.

### Approach B — Fewer generic contact actions with operation modes

Pros:
- Less registry surface area.
- Fewer handlers.

Cons:
- Worse workflow author UX.
- More conditional schemas and confusing designer forms.
- Harder downstream output typing.

### Approach C — Implement wrappers that call existing REST/API services directly

Pros:
- Maximizes reuse of API behavior.
- Potentially preserves domain events without duplicating logic.

Cons:
- Workflow runtime lives in shared code and may not safely import server-only service layers.
- Existing server action code can depend on Next/auth/revalidation concerns inappropriate for runtime actions.
- May introduce circular package boundaries.

Recommendation: Approach A, while extracting small shared helpers where repeated logic is unavoidable. Use models/shared utilities directly in runtime actions and copy only the minimal server-action delete/tag logic needed after boundary review.

## Rollout / Migration

1. No database migration is expected.
2. Actions are additive; existing workflows should not break.
3. New actions should appear automatically in the designer catalog after runtime initialization.
4. Delete and deactivate are additive but separate actions; designer labels/descriptions must make the destructive hard-delete behavior clear.

## Resolved Decisions

1. `contacts.duplicate` must require a new unique primary email override; do not generate placeholder/suffix emails automatically.
2. `contacts.assign_to_ticket` should only set `tickets.contact_name_id` in v1 unless the existing application action path also sets `tickets.client_id`. Current discovery indicates the UI contact-change path updates only `contact_name_id`.
3. `contacts.add_tag` should create missing tag definitions exactly like `clients.add_tag`, using the same `contact:update`-style permission policy rather than a stricter separate tag-create permission.
4. Contact create/update/deactivate actions should publish `CONTACT_CREATED` / `CONTACT_UPDATED` / `CONTACT_ARCHIVED` domain events using the same best-effort lazy import pattern used by Client actions.

## Acceptance Criteria (Definition of Done)

1. The Contact workflow catalog includes all eleven requested/planned actions under the Contact group, including separate Deactivate Contact and Delete Contact actions.
2. Each action has a Zod input/output schema, UI label/description/category, side-effect metadata, and idempotency declaration.
3. All write actions are tenant-scoped, permission-checked, transactional, and audited.
4. Create/update/duplicate use existing contact validation for email, phone, additional email, primary email type, and client existence rules.
5. Deactivate and delete behavior are implemented as separate actions: deactivate is idempotent and reversible via update/reactivation, while delete is guarded hard delete with blocked-dependency behavior covered by tests.
6. Tagging uses the same storage model that contact search reads (`tag_definitions` / `tag_mappings`) unless implementation proves a different canonical path.
7. Ticket assignment validates both entities and returns deterministic before/after output.
8. Note and interaction actions are intentionally separate: `contacts.add_note` appends to the contact notes document, while `contacts.add_interaction` creates a valid `interactions` row linked to the contact and derived client.
9. Add-to-client and move-to-client actions distinguish idempotent no-op, conflict, and successful move cases.
10. Runtime tests cover the highest-risk mutations and validation failures against a real or realistically mocked tenant transaction.
