# PRD — Workflow Client Actions

- Slug: `2026-04-25-workflow-client-actions`
- Date: `2026-04-25`
- Status: Draft pending scope confirmation

## Summary

Add the missing Client module workflow actions to Workflow Runtime V2 so workflow authors can create, update, archive, delete, duplicate, tag, link to tickets, note, and log interactions for clients from the Workflow Designer catalog.

The new actions should live in `shared/workflow/runtime/actions/businessOperations/clients.ts`, register through the existing `registerClientActions()` path, and appear automatically in the existing Client group of the grouped workflow action catalog via the `clients.*` action id prefix.

## Problem

The Client module currently exposes only read-oriented workflow actions:

- `clients.find`
- `clients.search`

Workflow authors can locate clients, but they cannot perform common client lifecycle mutations without falling back to generic/non-client actions or custom code. This creates an uneven workflow authoring experience compared with the Ticket module, which already exposes create/update/assign/comment/link operations.

## Goals

1. Add Client module actions for:
   - edit client
   - create client
   - archive client
   - delete client
   - duplicate client
   - add tag to client
   - assign client to ticket
   - add note to client
   - add interaction to client
2. Keep action registration consistent with the current business operations architecture.
3. Use Zod input/output schemas that work with the Workflow Designer input editor and downstream output pickers.
4. Enforce tenant scoping, permissions, validation, audit logging, and idempotency consistently with existing business operation actions.
5. Reuse existing model/service behavior where safe so workflow actions match product behavior.
6. Keep this as a workflow-action expansion only; do not redesign the broader client UI, API, or event system.

## Non-goals

1. Building new Workflow Designer UI components beyond schema metadata needed for existing pickers.
2. Adding new catalog groups or changing catalog grouping behavior.
3. Reworking client CRUD data models, billing setup, client portal onboarding, or deletion dependency rules.
4. Adding bulk client actions.
5. Replacing existing generic CRM activity note action (`crm.create_activity_note`).
6. Adding production observability/metrics beyond existing action logging/audit patterns unless requested later.

## Users and Primary Flows

### Workflow author

- Opens the Workflow Designer.
- Selects the Client group.
- Adds one of the new Client actions.
- Configures fixed values or mappings with existing picker-backed fields where applicable.
- Saves, publishes, and runs the workflow.

### Workflow runtime

- Executes an `action.call` step.
- Resolves mapped inputs and secrets.
- Calls the selected `clients.*` action handler.
- Validates inputs and outputs.
- Saves action output into the workflow envelope when `saveAs` is configured.

### MSP user represented by a workflow run

- The runtime resolves the workflow actor user.
- Actions run only if that actor has the required MSP permission for the target operation.

## UX / UI Notes

The new actions should appear under the existing Client catalog group; no catalog seed changes should be needed because `shared/workflow/runtime/designer/actionCatalog.ts` groups `clients.*` under Client.

Action labels should be clear and parallel to the user's requested verbs:

- `clients.create` → Create Client
- `clients.update` → Edit Client
- `clients.archive` → Archive Client
- `clients.delete` → Delete Client
- `clients.duplicate` → Duplicate Client
- `clients.add_tag` → Add Tag to Client
- `clients.assign_to_ticket` → Assign Client to Ticket
- `clients.add_note` → Add Note to Client
- `clients.add_interaction` → Add Interaction to Client

Picker metadata should be added where useful:

- client id fields: `x-workflow-picker-kind: client`
- ticket id fields: `x-workflow-picker-kind: ticket` if supported by the picker registry; otherwise use a UUID field and note the limitation
- contact id fields for interactions: `x-workflow-picker-kind: contact` with `client_id` dependency
- interaction type/status fields if the existing designer picker registry supports them; otherwise use UUID fields

## Requirements

### Functional Requirements

#### `clients.create`

- Create a tenant-scoped client.
- Minimum required input: `client_name`.
- Support the commonly used client fields already present in shared client interfaces/model validation:
  - `client_name`
  - `client_type`
  - `url`
  - `phone_no`
  - `email` / billing email mapping decision pending
  - `address`, `address_2`, `city`, `state`, `zip`, `country`
  - `default_currency_code`
  - `notes`
  - `properties`
  - `parent_client_id`
  - `contract_line_id`
  - `is_default` only if existing product behavior safely supports it; otherwise omit
- Optionally accept `tags` for initial client tags.
- Return a client summary suitable for downstream steps.
- Use action-provided idempotency key to prevent duplicate clients when a workflow retries.

#### `clients.update`

- Update a tenant-scoped client by `client_id`.
- Accept a `patch` object for editable client fields.
- Reject empty patches.
- Preserve existing behavior for setting clients inactive, including associated contact/client-user deactivation if reusing `ClientService.update` is feasible; otherwise explicitly document any difference before implementation.
- Optionally accept tag replacement only if the action name/schema makes replacement semantics obvious; otherwise leave tagging to `clients.add_tag`.
- Return before/after or updated client summary plus changed fields.

#### `clients.archive`

- Archive/deactivate a tenant-scoped client by setting `is_inactive = true` through the same semantics as editing the client inactive.
- Required input: `client_id`.
- Preserve the client record and historical relationships.
- Deactivate associated contacts and client users if this matches the existing `ClientService.update(..., { is_inactive: true })` behavior or an equivalent shared implementation.
- Return client id, archived flag, previous inactive state, and archived timestamp.
- Treat already-inactive clients as a successful idempotent no-op by default.

#### `clients.delete`

- Hard-delete a client by `client_id` using the same dependency checks as product/API deletion.
- Require `confirm: true` as an explicit destructive-action guard.
- Refuse deletion for default clients and clients with blocking dependencies.
- Clean related client-owned artifacts using existing service/helper behavior where possible.
- Return `{ deleted: true, client_id }` on success.
- Treat missing clients according to an explicit `on_not_found` option (`error` default, optional `return_false`).

#### `clients.duplicate`

- Create a new client using an existing client as a template.
- Required inputs:
  - `source_client_id`
  - `client_name` for the duplicate, or a deterministic default naming strategy if confirmed
- Copy safe profile fields such as client type, URL, phone, billing email/email, address fields, default currency, properties, and notes by default.
- Provide explicit copy options for related records:
  - `copy_tags` default `true`
  - `copy_locations` default `false`
- Do not copy contacts, notes documents, billing contracts, invoices, tickets, projects, interactions, payment customer records, portal users, or external integration mappings in v1.
- Return source and duplicate client summaries.

#### `clients.add_tag`

- Add one or more tags to a client.
- Create missing `tag_definitions` for `tagged_type = 'client'`.
- Insert missing `tag_mappings` idempotently.
- No-op existing mappings by default rather than failing on duplicates.
- Return added/existing tag summaries and counts.

#### `clients.assign_to_ticket`

- Set a ticket's `client_id` to the selected client.
- Validate that the ticket and client both exist in the tenant.
- Optional inputs:
  - `contact_id` to set/replace ticket contact, or explicit `null` to clear it, with validation that a non-null contact belongs to the selected client
  - `location_id` to set/replace ticket location, or explicit `null` to clear it, with validation that a non-null location belongs to the selected client
  - `comment` or `reason` for an optional internal comment/audit detail, only if consistent with ticket update patterns
- Preserve omitted contact/location fields; only update or clear them when the workflow input explicitly provides the field.
- Return ticket id, previous client id, new client id, previous/current contact id, and previous/current location id.

#### `clients.add_note`

- Add or save client note content on the client's notes document.
- Use the existing client notes document pattern (`clients.notes_document_id`, `createBlockDocument`, `updateBlockContent`) where feasible.
- Append a new workflow-created paragraph-like block to the client notes document. Do not replace the entire notes document in this action.
- Publish or preserve the existing NOTE_CREATED behavior if creating a new notes document.
- Return document id, created/updated timestamp, and client id.

#### `clients.add_interaction`

- Log an interaction linked to a client.
- Required inputs:
  - `client_id`
  - `type_id`
  - `title`
- Optional inputs:
  - `contact_id`
  - `ticket_id`
  - `notes`
  - `start_time`
  - `end_time`
  - `duration`
  - `status_id`
  - `interaction_date`
- Validate contact/ticket relationships when provided.
- Use the current workflow actor as `user_id` in v1. Do not expose a `user_id` override in the initial action schema.
- Decision rationale: interactions are attribution-bearing business records. Allowing arbitrary `user_id` input could misattribute activity to another MSP user unless the broader permission model explicitly supports "create interaction for another user" semantics. The workflow actor is already resolved for permissions/audit, so using that actor keeps v1 safe and predictable.
- Future goal: add a permission-gated user override in a later action version if product needs workflows to log interactions on behalf of another active internal user. That future version should define the exact permission/admin requirement, validate the target user, and preserve clear audit attribution for both the workflow actor and target interaction user.
- Set a default interaction status when omitted, matching existing `addInteraction` behavior.
- Publish or preserve existing INTERACTION_LOGGED behavior if feasible.
- Return interaction summary.

### Non-functional Requirements

- Fail fast with clear `throwActionError` categories/codes for validation, not-found, permission, conflict, and transient failures.
- Avoid silently swallowing tag/tax/note setup failures in workflow actions unless the existing product behavior explicitly does so and the behavior is documented.
- Keep action outputs stable and typed for downstream workflow expression use.
- Keep implementation in shared workflow runtime code where the existing business operation actions live.

## Data / API / Integrations

Key existing files and patterns:

- `shared/workflow/runtime/actions/businessOperations/clients.ts` — current `clients.find` and `clients.search`; target file for new actions.
- `shared/workflow/runtime/actions/businessOperations/shared.ts` — tenant transaction, permissions, audit, errors, idempotency helpers.
- `shared/models/clientModel.ts` — shared client create/update/get helpers and validation.
- `server/src/lib/api/services/ClientService.ts` — API service with richer create/update/delete/tag behavior and workflow event publication.
- `packages/clients/src/actions/clientNoteActions.ts` — client notes document behavior.
- `packages/clients/src/actions/interactionActions.ts` and `packages/clients/src/models/interactions.ts` — interaction creation behavior.
- `shared/workflow/runtime/actions/businessOperations/crm.ts` — existing generic CRM activity note action.
- `shared/workflow/runtime/actions/businessOperations/tickets.ts` — ticket update/link/comment/idempotency/picker patterns.

Expected tables touched:

- `clients`
- `contacts`
- `tickets`
- `client_locations`
- `tag_definitions`
- `tag_mappings`
- `documents`
- `document_block_content`
- `document_associations`
- `interactions`
- `interaction_types` / `system_interaction_types`
- `statuses` for interaction defaults
- `audit_logs`

## Security / Permissions

Proposed permission checks:

- `clients.create` → `client:create`
- `clients.update` → `client:update`
- `clients.archive` → `client:update`
- `clients.delete` → `client:delete`
- `clients.duplicate` → `client:read` on source and `client:create` for duplicate
- `clients.add_tag` → `client:update`
- `clients.assign_to_ticket` → `client:read` and `ticket:update`
- `clients.add_note` → `client:update`
- `clients.add_interaction` → `client:update` or a more specific interaction permission if one exists; verify before implementation

All queries and mutations must include the current tenant. Cross-tenant ids must behave as not found.

## Rollout / Migration

No database migration is expected for the baseline plan. The work is primarily action registration and handler implementation.

If duplicate-client behavior requires cloning related records not currently supported by shared helpers, implement only safe direct-table duplication for explicitly selected related records or defer those copy options.

## Open Questions

1. Resolved: use `clients.update` as the durable action id for the EDIT client action, with UI label "Edit Client", to match CRUD/runtime naming while preserving user-facing wording.
2. Resolved: `clients.add_note` appends a workflow-created note block to the client notes document. It does not replace the document and does not create an interaction/activity note.
3. Resolved: `clients.duplicate` requires an explicit duplicate `client_name`, copies safe core profile fields, copies tags by default, supports optional `copy_locations`, and does not copy contacts or notes in v1.
4. Resolved: `clients.delete` is validated hard delete, and `clients.archive` is added now as a separate archive/deactivate action.
5. Resolved: `clients.assign_to_ticket` preserves omitted contact/location fields. Explicit `null` clears those fields; non-null values are validated against the selected client.
6. Resolved: `clients.add_interaction` always uses the workflow actor as `user_id` in v1. Future versions may add a permission-gated target-user override after the exact permission and audit semantics are designed.

## Acceptance Criteria (Definition of Done)

1. The Client catalog group includes all nine new actions plus existing find/search actions.
2. `initializeWorkflowRuntimeV2()` registers the new actions through the existing business operations registration path without extra bootstrap changes.
3. Each new action has a versioned action definition with input schema, output schema, UI metadata, side-effect metadata, idempotency metadata, and handler.
4. Each handler validates tenant-scoped entity existence before mutation.
5. Each handler enforces the proposed permissions or an explicitly confirmed replacement permission.
6. Create, duplicate, tag, note, and interaction actions are retry-safe through action-provided idempotency keys or idempotent no-op semantics.
7. Delete uses existing client deletion dependency/default-client guardrails.
8. Assign-to-ticket validates client/contact/location relationships and preserves omitted ticket fields.
9. Notes and interactions follow existing product data shapes closely enough to render in existing client detail screens.
10. Tests cover registration/catalog exposure, schema metadata, successful DB-backed mutations, and high-risk failure cases.
