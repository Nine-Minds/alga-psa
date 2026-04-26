# PRD — CRM Workflow Follow-up Actions

- Slug: `workflow-crm-followup-actions`
- Date: `2026-04-25`
- Status: Draft

## Summary

Add the remaining CRM workflow actions after the first-pass CRM plan (`workflow-crm-actions`) lands. This follow-up plan covers interaction taxonomy, simple activity status transitions, quote creation/search/conversion/approval, and CRM activity tagging.

Planned actions:

1. `crm.create_interaction_type`
2. `crm.update_activity_status`
3. `crm.create_quote`
4. `crm.add_quote_item`
5. `crm.create_quote_from_template`
6. `crm.find_quotes`
7. `crm.submit_quote_for_approval`
8. `crm.convert_quote`
9. `crm.tag_activity`

Explicitly out of scope: `crm.create_client_note`. Use `clients.add_note` for client notes and add a future `contacts.add_note` action under the Contact module if contact note automation is needed.

This plan intentionally builds on discoveries from the recent workflow updates and the first CRM plan: shared runtime actions must not import `withAuth` server action wrappers directly, picker metadata should follow current Workflow Designer conventions, event publication should use lazy shared-runtime-safe helpers, and DB-backed tests should validate real migrated schema behavior.

## Problem

The first-pass CRM plan unlocks activity lookup/update/scheduling and quote sending, but it leaves several high-value CRM automation gaps:

- MSPs cannot create their own CRM activity taxonomy from workflows.
- Workflows need a simple “mark this activity completed/closed/won” action without constructing a full patch object.
- Quote automation remains incomplete without create/search/item/approval/conversion actions.
- CRM activity tagging is not available for interactions/activities.

These gaps matter because MSP automations often span support, account management, and billing: identify a client state, tag/account-classify it, create or submit a quote, and convert accepted quote value along the way.

## Goals

- Complete the next CRM workflow action layer after first-pass activity and send-quote support.
- Keep action IDs under `crm.*` so the existing Designer CRM group continues to work.
- Provide quote pipeline actions that are safe, permission-checked, and consistent with existing quote lifecycle rules.
- Provide CRM taxonomy and status helpers that simplify common workflow authoring.
- Provide a dedicated tag action for CRM activities/interactions.
- Keep note creation on module-specific actions: existing `clients.add_note` and a future `contacts.add_note` if needed.
- Reuse existing model/service behavior where safe, extracting shared-safe helpers where necessary.

## Non-goals

- Replacing first-pass CRM actions (`crm.find_activities`, `crm.update_activity`, `crm.schedule_activity`, `crm.send_quote`).
- Replacing Client module workflow actions such as `clients.add_note` or `clients.add_interaction`.
- Adding a CRM-scoped client/contact note wrapper; note automation should use module-specific actions (`clients.add_note`, future `contacts.add_note`).
- Replacing quote UI/API behavior or adding new quote lifecycle states.
- Introducing a generic arbitrary-table patch action.
- Calling `withAuth` server actions directly from `shared/workflow/runtime`.
- Building new Workflow Designer controls beyond metadata-driven picker support.
- Adding broad quote item editing beyond the create-quote input scope described here.

## Prerequisites / Dependencies

- First-pass CRM plan should be implemented or at least its shared helper decisions should be resolved:
  - lazy workflow event publisher helper for CRM actions
  - CRM permission mapping
  - quote shared-helper/package-boundary approach
  - common CRM activity summary schemas
- Recent Client workflow action patterns remain the model for picker metadata, event publication, idempotency, and DB-backed tests.
- Quote actions must respect existing quote status transitions from `packages/billing/src/schemas/quoteSchemas.ts`.

## Users and Primary Flows

### Users

- MSP admin building cross-functional workflows.
- Account manager automating CRM follow-ups and QBR/upsell workflows.
- Sales/finance operator automating quote pipeline steps.
- Internal Alga PSA engineer maintaining Workflow Runtime V2 business operations.

### Primary flows

1. **Create CRM taxonomy automatically**
   - Workflow detects a new MSP process or onboarding template.
   - Workflow creates a custom interaction type such as `QBR`, `Site Visit`, or `Upsell Call` if it does not exist.

2. **Mark an activity status without a full patch**
   - Workflow finds or creates an activity.
   - Workflow runs `crm.update_activity_status` with a target status ID or status name.
   - The action validates the interaction status and returns the previous/current status.

3. **Create and build a quote**
   - Workflow creates a quote header for a client/contact after a qualifying ticket or opportunity event.
   - Workflow either creates a blank quote header with `crm.create_quote` and adds items with `crm.add_quote_item`, or creates a populated quote from a template with `crm.create_quote_from_template`.
   - Workflow optionally submits the quote for approval when tenant settings or business rules require it.

4. **Find quotes before branching**
   - Workflow checks whether the client already has open quotes.
   - If none exist, it creates one; if one exists, it updates/sends/submits it through existing CRM quote actions.

5. **Convert an accepted quote**
   - Workflow receives a quote accepted event or polls/fetches accepted quote state.
   - Workflow converts quote content to a draft contract, draft invoice, or both based on selected items.

6. **Tag CRM activities**
   - Workflow applies tags like `Needs QBR`, `Upsell Candidate`, or `Onboarding Risk` to interactions/activities.
   - Client and contact tagging stay in their own module actions.
   - Tag definition creation and tag application events are emitted consistently.

## UX / UI Notes

- All actions should appear under the existing Workflow Designer CRM group via the `crm.*` prefix.
- Suggested labels:
  - `crm.create_interaction_type` → Create Activity Type
  - `crm.update_activity_status` → Update Activity Status
  - `crm.create_quote` → Create Quote
  - `crm.add_quote_item` → Add Quote Item
  - `crm.create_quote_from_template` → Create Quote from Template
  - `crm.find_quotes` → Find Quotes
  - `crm.submit_quote_for_approval` → Submit Quote for Approval
  - `crm.convert_quote` → Convert Quote
  - `crm.tag_activity` → Tag CRM Activity
- Use picker metadata where supported:
  - `client_id` → `client`
  - `contact_id` → `contact`, dependent on `client_id` where appropriate
  - `ticket_id` → `ticket`
  - `user_id` → `user`
  - `quote_id`, `interaction_id`, `interaction_type_id`, and `interaction_status_id` remain UUID fields in v1 unless picker support already exists or is separately introduced.
- Quote action outputs should include enough summary fields for branching: quote ID, number, status, client ID, totals, conversion target IDs, and approval/send state.

## Requirements

### `crm.create_interaction_type`

- Register action ID `crm.create_interaction_type`, version `1`.
- Inputs:
  - `type_name`
  - optional `icon`
  - optional `display_order`
  - optional `idempotency_key`
  - optional `if_exists`: `return_existing` or `error` (default `return_existing`)
- Validate non-empty type name and reasonable length.
- Enforce tenant uniqueness by normalized type name where possible.
- If `display_order` is omitted, assign next display order using existing `interaction_types` max order behavior.
- Set `created_by` to workflow actor.
- Require `settings:update` because activity types are tenant CRM taxonomy/configuration.
- Return interaction type summary and `created` boolean.
- Use action-provided idempotency.
- Write run audit.

### `crm.update_activity_status`

- Register action ID `crm.update_activity_status`, version `1`.
- Inputs:
  - `activity_id`
  - either `status_id` or `status_name`
  - optional `reason`
  - optional `no_op_if_already_status` default `true`
- Validate activity exists in tenant.
- Resolve/validate target status from `statuses` where `status_type = 'interaction'`.
- If already in target status and no-op is true, return no-op without duplicate audit/event noise.
- Update only `status_id` and timestamp/audit metadata as available.
- Return activity ID, previous/current status IDs/names, `no_op`, and updated activity summary.
- Implement as a dedicated wrapper around the same safe update path used by `crm.update_activity`.

### `crm.create_quote`

- Register action ID `crm.create_quote`, version `1`.
- Scope v1 to quote header creation only. Quote item creation is handled by `crm.add_quote_item`.
- Inputs should support a constrained, workflow-friendly subset of quote header creation:
  - `client_id`
  - optional `contact_id`
  - `title`
  - optional `description`
  - `quote_date`
  - `valid_until`
  - optional `po_number`
  - optional `internal_notes`
  - optional `client_notes`
  - optional `terms_and_conditions`
  - optional `currency_code` default `USD`
  - optional `idempotency_key`
- Validate non-template quotes require client ID.
- Validate `valid_until >= quote_date`.
- Validate contact belongs to client when provided.
- Use existing quote model/schema behavior where package-boundary safe.
- Return quote summary.
- Require billing create authorization and quote read authorization decisions equivalent to existing quote actions.
- Use action-provided idempotency and run audit.

### `crm.add_quote_item`

- Register action ID `crm.add_quote_item`, version `1`.
- Inputs:
  - `quote_id`
  - `description`
  - `quantity`
  - optional `unit_price`
  - optional `unit_of_measure`
  - optional `display_order`
  - optional `phase`
  - optional `is_optional` default `false`
  - optional `is_selected` default `true`
  - optional `is_recurring` default `false`
  - optional `billing_frequency`
  - optional `billing_method`: `fixed`, `hourly`, or `usage`
  - optional `is_discount` default `false`
  - optional `discount_type`: `percentage` or `fixed`
  - optional `discount_percentage`
  - optional `applies_to_item_id`
  - optional `applies_to_service_id`
  - optional `is_taxable` default `true`
  - optional `tax_region`
  - optional `tax_rate`
  - optional `location_id`
  - optional `cost`
  - optional `cost_currency`
  - optional `idempotency_key`
- Validate quote exists in tenant and is editable.
- Reject adding items to quote templates in v1 unless template support is explicitly resolved later.
- Validate line item fields using existing quote item schema rules where package-boundary safe:
  - recurring items require billing frequency.
  - discount items require discount type.
  - percentage discounts require discount percentage.
- Assign `display_order` deterministically when omitted.
- Persist item through shared-safe quote item model/helper behavior.
- Recalculate quote financials after insertion.
- Return quote item summary plus refreshed quote summary/totals.
- Require billing update/read authorization equivalent to existing quote item behavior.
- Use action-provided idempotency and run audit.

### `crm.create_quote_from_template`

- Register action ID `crm.create_quote_from_template`, version `1`.
- Inputs:
  - `template_id`
  - `client_id`
  - optional `contact_id`
  - optional `title` override
  - optional `quote_date` override
  - optional `valid_until` override
  - optional `po_number`
  - optional `internal_notes` override/append decision if supported safely
  - optional `client_notes` override/append decision if supported safely
  - optional `currency_code` override if supported safely
  - optional `idempotency_key`
- Validate `template_id` points to a tenant quote template (`is_template = true`).
- Validate target client exists and contact belongs to that client when supplied.
- Reuse/extract shared-safe behavior from existing quote template creation logic; do not import `withAuth` server action wrappers directly into shared runtime.
- Copy safe template header fields and template items to the new quote.
- Apply supplied overrides after template defaults.
- Recalculate quote financials after copying items.
- Return created quote summary and created item summaries.
- Require billing create/read authorization equivalent to existing quote template creation behavior.
- Use action-provided idempotency and run audit.

### `crm.find_quotes`

- Register action ID `crm.find_quotes`, version `1`.
- Side-effect-free.
- Inputs:
  - optional `quote_id`
  - optional `quote_number`
  - optional `client_id`
  - optional `status`
  - optional `date_from`
  - optional `date_to`
  - optional `is_template` default `false`
  - pagination and sorting fields aligned with `Quote.listByTenant`
  - optional `on_empty`: `return_empty` or `error`
- Require at least one meaningful filter or an explicit bounded date range unless a small page size is enforced.
- Enforce billing read authorization and quote authorization-kernel filtering equivalent to existing quote list/read behavior.
- Return paginated quote summaries and first quote.

### `crm.submit_quote_for_approval`

- Register action ID `crm.submit_quote_for_approval`, version `1`.
- Inputs:
  - `quote_id`
  - optional `comment` or `reason`
  - optional `no_op_if_already_pending` default `true`
- Validate quote exists, is readable/updatable by workflow actor, is not a template, and is in draft status unless no-op applies.
- Transition status to `pending_approval` using existing quote status rules.
- Record quote activity if existing behavior does or if a shared helper is extracted.
- Return quote summary, previous status, new status, and no-op flag.
- Write run audit.

### `crm.convert_quote`

- Register action ID `crm.convert_quote`, version `1`.
- Inputs:
  - `quote_id`
  - `target`: `contract`, `invoice`, or `contract_and_invoice`
  - optional `no_op_if_already_converted` default `true`
- Validate quote exists, is not a template, and is eligible for conversion.
- Enforce billing create + update authorization equivalent to existing conversion actions.
- Reuse shared-safe conversion services:
  - `convertQuoteToDraftContract`
  - `convertQuoteToDraftInvoice`
  - `convertQuoteToDraftContractAndInvoice`
- Validate selected quote items support the requested target and return clear errors from conversion service as workflow action errors.
- Return quote summary plus created contract ID and/or invoice ID.
- Write run audit.

### `crm.tag_activity`

- Register action ID `crm.tag_activity`, version `1`.
- Scope v1 to interactions/activities only. Client and contact tagging stay in their own module actions.
- Inputs:
  - `activity_id`
  - `tags`: non-empty array of tag text values
  - optional `if_exists`: `no_op` or `error` (default `no_op`)
  - optional `idempotency_key`
- Validate target interaction/activity exists in tenant.
- Validate tag text using current tag validation rules.
- Create missing tag definitions and insert missing tag mappings idempotently.
- Require CRM interaction/activity update permission and tag create permission when creating new tag definitions, matching existing tag behavior where possible.
- Emit `TAG_DEFINITION_CREATED` for newly created definitions and `TAG_APPLIED` for newly applied mappings through lazy event publishing with deterministic keys.
- Return added/existing tag summaries and counts.
- Use action-provided idempotency and run audit.

### Explicitly dropped: `crm.create_client_note`

- Do not implement `crm.create_client_note` in this follow-up plan.
- Use `clients.add_note` for client note automation.
- Add a future `contacts.add_note` Contact-module action if workflows need contact note automation.
- Rationale: module-specific note actions keep ownership clearer and avoid duplicating the newly merged Client workflow note behavior under CRM.

### Cross-cutting Requirements

- Implement in `shared/workflow/runtime/actions/businessOperations/crm.ts` or extracted shared-safe helper modules.
- Do not directly import `packages/*/src/actions/*` server action wrappers into shared runtime action code.
- Use `withTenantTransaction`, `requirePermission`, `writeRunAudit`, `throwActionError`, and `rethrowAsStandardError`.
- Use `withWorkflowJsonSchemaMetadata` for picker-backed fields.
- Use deterministic idempotency and no-op behavior for retry-sensitive mutations.
- Keep all actions tenant-scoped and actor-attributed.
- Preserve `crm.create_activity_note` and first-pass CRM actions.

## Data / API / Integrations

### Key files

- `shared/workflow/runtime/actions/businessOperations/crm.ts`
- `shared/workflow/runtime/actions/businessOperations/clients.ts`
- `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- `shared/workflow/runtime/actions/businessOperations/shared.ts`
- `shared/workflow/runtime/jsonSchemaMetadata.ts`
- `packages/clients/src/actions/interactionTypeActions.ts`
- `packages/clients/src/actions/clientNoteActions.ts` (reference only; CRM note wrapper dropped)
- `packages/clients/src/actions/contact-actions/contactNoteActions.ts` (reference for future `contacts.add_note`, not this plan)
- `packages/tags/src/actions/tagActions.ts`
- `packages/billing/src/actions/quoteActions.ts`
- `packages/billing/src/models/quote.ts`
- `packages/billing/src/models/quoteItem.ts`
- `packages/billing/src/actions/quoteActions.ts` (`createQuoteFromTemplate` as behavior reference; do not import wrapper directly)
- `packages/billing/src/schemas/quoteSchemas.ts`
- `packages/billing/src/services/quoteConversionService.ts`
- `shared/workflow/streams/domainEventBuilders/tagEventBuilders.ts`
- `shared/workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders.ts`

### Tables likely touched

- `interaction_types`
- `interactions`
- `statuses`
- `quotes`
- `quote_items`
- `quote_activities`
- quote conversion target tables for contracts/invoices
- `tag_definitions`
- `tag_mappings`
- `clients`
- `contacts`
- `audit_logs`

## Security / Permissions

- `crm.create_interaction_type` requires `settings:update` because activity types are tenant CRM taxonomy/configuration.
- Resolve and document CRM interaction mutation permission for `crm.update_activity_status`.
- Quote actions, including `crm.add_quote_item`, must enforce billing create/read/update and quote authorization-kernel decisions equivalent to existing quote actions.
- `crm.tag_activity` must enforce CRM interaction/activity update permission and tag create permission when creating new definitions.
- Workflow actor remains the created_by/performed_by/audit actor unless a future version explicitly supports override.

## Observability

- Write run audit for all side-effectful actions.
- Emit existing events where supported:
  - `TAG_DEFINITION_CREATED`
  - `TAG_APPLIED`
- Quote pipeline actions should emit quote-specific workflow events only when matching `QUOTE_*` event schemas/builders already exist. If no matching quote event contract exists, remain audit-only plus existing quote activity records.
- Do not invent new `QUOTE_*` or `INTERACTION_UPDATED` events in this plan; new event contracts require a separate event-schema plan.
- Capture no-op outcomes in action outputs and audit where useful.

## Rollout / Migration

- No database migration is expected by default.
- All actions are additive.
- If quote helper extraction changes package exports, keep it backward compatible and covered by existing quote tests.
- `crm.create_client_note` is dropped in favor of module-specific actions; no migration or runtime registration is needed for it.

## Open Questions

All planning decisions for this follow-up scope are resolved. Implementation may still discover package-boundary details that need scratchpad updates.

## Acceptance Criteria (Definition of Done)

- Runtime initialization registers the selected follow-up actions at version `1`.
- Designer catalog shows the selected actions under CRM with labels, schema metadata, and output schemas.
- Interaction type creation is idempotent and permission-checked.
- Activity status update provides a simple validated transition/no-op wrapper.
- Quote create/add-item/template/find/submit/convert actions respect quote lifecycle, billing permissions, and authorization-kernel behavior.
- Quote pipeline actions emit only already-defined quote workflow events; when no matching quote event schema/builder exists, they remain audit-only plus quote activity records.
- CRM activity tagging creates definitions/mappings idempotently for interactions and emits tag events for new changes.
- `crm.create_client_note` remains absent; client note automation uses `clients.add_note`, and contact note automation is deferred to a future Contact-module action.
- DB-backed tests cover representative happy paths and high-risk guard cases.
- Existing first-pass CRM, Client, Ticket, and quote tests do not regress.
