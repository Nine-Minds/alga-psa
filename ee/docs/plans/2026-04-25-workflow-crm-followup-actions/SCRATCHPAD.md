# Scratchpad — CRM Workflow Follow-up Actions

- Plan slug: `workflow-crm-followup-actions`
- Created: `2026-04-25`

## What This Is

Rolling notes for the second CRM workflow action wave after first-pass CRM activity lookup/update/scheduling and quote send actions.

## Decisions

- (2026-04-25) This follow-up plan covers the remaining recommended actions: `crm.create_interaction_type`, `crm.update_activity_status`, `crm.create_quote`, `crm.add_quote_item`, `crm.create_quote_from_template`, `crm.find_quotes`, `crm.submit_quote_for_approval`, `crm.convert_quote`, and `crm.tag_activity`.
- (2026-04-25) Keep actions under `crm.*` so existing designer grouping places them in CRM without catalog seed changes.
- (2026-04-25) Do not directly import `withAuth` server actions from `packages/*/src/actions/*` into shared workflow runtime code. Extract or use shared-safe model/service helpers instead.
- (2026-04-25) Resolved: drop `crm.create_client_note` from CRM follow-up scope. Use `clients.add_note` for client notes and add a future `contacts.add_note` action if contact note workflow automation is needed. Rationale: module-specific note actions keep ownership clear and avoid duplicating newly merged Client workflow behavior under CRM.
- (2026-04-25) Use current Client workflow action conventions for picker metadata, lazy event publication, deterministic event idempotency keys, action idempotency, and DB-backed tests.
- (2026-04-25) Resolved: `crm.create_quote` creates the quote header only; quote item creation is a separate action named `crm.add_quote_item`. Rationale: keeps header creation simple while still supporting full quote-building workflows in this plan.
- (2026-04-25) Resolved: include a separate `crm.create_quote_from_template` action in this plan. Rationale: templates are important for standardized quote automation, but a dedicated action keeps semantics cleaner than overloading `crm.create_quote`.
- (2026-04-25) Resolved: `crm.create_interaction_type` requires `settings:update`. Rationale: activity types are tenant CRM taxonomy/configuration, so this should be admin-controlled rather than available to all CRM editors.
- (2026-04-25) Resolved: `crm.tag_activity` is interaction/activity-specific only. Client and contact tagging stay in their own module actions. Rationale: keeps CRM tag action focused and avoids turning it into a generic tag action.
- (2026-04-25) Resolved: quote pipeline actions emit quote-specific workflow events only if matching `QUOTE_*` schemas/builders already exist. Otherwise they remain audit-only plus existing quote activity records. Rationale: avoids inventing event contracts inside this plan while preserving event parity if contracts already exist.

## Discoveries / Constraints

- (2026-04-25) `packages/clients/src/actions/interactionTypeActions.ts` has `createInteractionType`, but it is a `withAuth` server action. Underlying behavior is simple: insert `interaction_types` with `type_name`, `icon`, `display_order`, tenant, and `created_by`.
- (2026-04-25) `packages/billing/src/schemas/quoteSchemas.ts` defines quote statuses and allowed transitions. Follow-up quote actions must respect these transitions.
- (2026-04-25) `packages/billing/src/models/quote.ts` exposes shared-looking model methods such as `getById`, `getByNumber`, `listByTenant`, `listByClient`, `create`, and `update`, but import safety from shared workflow runtime must still be confirmed.
- (2026-04-25) `packages/billing/src/models/quoteItem.ts` and quote item schema rules should be used or mirrored for `crm.add_quote_item`; shared runtime import safety must be confirmed.
- (2026-04-25) `packages/billing/src/services/quoteConversionService.ts` exposes conversion services for draft contracts/invoices/both. These are promising for `crm.convert_quote`, but package-boundary safety still needs confirmation.
- (2026-04-25) `packages/tags/src/actions/tagActions.ts` shows desired tag semantics: entity update permission, tag create permission for new definitions, tag definition creation, tag mapping insertion, and TAG event publication. It is a server action file and should be used as a behavior reference, not directly imported.
- (2026-04-25) `packages/clients/src/actions/clientNoteActions.ts` and `packages/clients/src/actions/contact-actions/contactNoteActions.ts` show client/contact notes document behavior and NOTE_CREATED publication. They remain useful references for a future Contact-module note action, but CRM follow-up will not implement a note wrapper.
- (2026-04-25) `shared/workflow/runtime/actions/businessOperations/clients.ts` already implements `clients.add_note` for client notes. Do not duplicate that implementation in CRM.

## Commands / Runbooks

- (2026-04-25) Discovery commands:
  - `rg -n "export const createInteractionType|updateInteractionType" packages/clients/src/actions/interactionTypeActions.ts`
  - `rg -n "export const createQuote|sendQuote|submitQuoteForApproval|convertQuote" packages/billing/src/actions/quoteActions.ts`
  - `rg -n "quoteStatusSchema|QUOTE_ALLOWED_STATUS_TRANSITIONS|canTransitionQuoteStatus" packages/billing/src/schemas/quoteSchemas.ts`
  - `rg -n "list\\(|QuoteListOptions|getByNumber|getById" packages/billing/src/models/quote.ts`
  - `rg -n "TAG_DEFINITION_CREATED|TAG_APPLIED|buildTagAppliedPayload" packages/tags/src/actions/tagActions.ts shared/workflow/streams/domainEventBuilders/tagEventBuilders.ts`
  - `rg -n "notes_document_id|saveClientNote|saveContactNote|NOTE_CREATED" packages/clients/src/actions shared/workflow/runtime/actions/businessOperations/clients.ts`

## Links / References

- First-pass CRM plan: `ee/docs/plans/2026-04-25-workflow-crm-actions/`
- `shared/workflow/runtime/actions/businessOperations/crm.ts`
- `shared/workflow/runtime/actions/businessOperations/clients.ts`
- `shared/workflow/runtime/actions/businessOperations/shared.ts`
- `shared/workflow/runtime/jsonSchemaMetadata.ts`
- `packages/clients/src/actions/interactionTypeActions.ts`
- `packages/billing/src/actions/quoteActions.ts`
- `packages/billing/src/models/quote.ts`
- `packages/billing/src/schemas/quoteSchemas.ts`
- `packages/billing/src/services/quoteConversionService.ts`
- `packages/tags/src/actions/tagActions.ts`
- `shared/workflow/streams/domainEventBuilders/tagEventBuilders.ts`
- `packages/clients/src/actions/clientNoteActions.ts`
- `packages/clients/src/actions/contact-actions/contactNoteActions.ts`
- `shared/workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders.ts`

## Open Questions

- Resolved: drop `crm.create_client_note`; use module-specific note actions instead.
- Resolved: `crm.create_quote` is header-only and quote item creation is handled by separate `crm.add_quote_item`.
- Resolved: template-based quote creation is included as separate `crm.create_quote_from_template`.
- Resolved: interaction type creation requires `settings:update`.
- Resolved: `crm.tag_activity` is interaction/activity-specific only; clients/contacts use their own module tag actions.
- Resolved: quote pipeline actions emit existing quote events only if matching schemas/builders already exist; otherwise audit-only plus quote activities.

## Implementation Log — 2026-04-26

- Implemented follow-up CRM workflow actions in `shared/workflow/runtime/actions/businessOperations/crm.ts`:
  - `crm.create_interaction_type`
  - `crm.update_activity_status`
  - `crm.create_quote`
  - `crm.add_quote_item`
  - `crm.create_quote_from_template`
  - `crm.find_quotes`
  - `crm.submit_quote_for_approval`
  - `crm.convert_quote`
  - `crm.tag_activity`
- Confirmed these actions are all registered at version `1`, side-effect metadata is set, and action-provided idempotency is used for retry-sensitive create/tag/item/template mutations.
- Added picker metadata for follow-up quote fields:
  - `crm.create_quote.client_id` / `contact_id`
  - `crm.create_quote_from_template.client_id` / `contact_id`
- Kept first-pass actions intact (`crm.create_activity_note`, `crm.find_activities`, `crm.update_activity`, `crm.schedule_activity`, `crm.send_quote`) and did not remove/rename existing IDs.
- Quote pipeline event stance preserved: no new quote event schema contracts were added; quote follow-up actions are audit-driven (plus existing quote model/service activity behavior).
- `crm.tag_activity` remains interaction/activity scoped; client/contact tagging remains module-specific.

## Test and Runtime Updates — 2026-04-26

- Updated unit/runtime metadata tests:
  - `shared/workflow/runtime/actions/__tests__/registerCrmActionsMetadata.test.ts`
  - `shared/workflow/runtime/__tests__/workflowDesignerCrmCatalogRuntime.test.ts`
  - `shared/workflow/runtime/nodes/__tests__/actionCallCrmSaveAsRuntime.test.ts` (switched representative runtime smoke to follow-up action `crm.find_quotes`)
- Expanded DB-backed CRM action suite with follow-up tests in:
  - `shared/workflow/runtime/actions/__tests__/businessOperations.crm.db.test.ts`
  - Added helper `createQuoteItemRecord` for conversion/template/add-item test setup.

## Vitest Aliasing Discovery — 2026-04-26

- Shared-runtime tests importing billing/authorization modules required additional aliases in `shared/vitest.config.ts`:
  - `@shared/*`
  - `@alga-psa/core/*`
  - `@alga-psa/db/*`
- Without these aliases, `crm.ts` imports of billing models/services failed test resolution due unresolved package paths.

## Commands Run — 2026-04-26

- `npx vitest run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/registerCrmActionsMetadata.test.ts shared/workflow/runtime/__tests__/workflowDesignerCrmCatalogRuntime.test.ts`
- `npx vitest run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/registerCrmActionsMetadata.test.ts shared/workflow/runtime/__tests__/workflowDesignerCrmCatalogRuntime.test.ts shared/workflow/runtime/nodes/__tests__/actionCallCrmSaveAsRuntime.test.ts`
- `npx vitest run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/businessOperations.crm.db.test.ts`

## Test Environment Gotcha

- DB-backed CRM suite currently aborts before execution in this shell because `businessOperations.crm.db.test.ts` guards against production DB names and detects `DB_NAME_SERVER=server` from environment bootstrap.
- Command-level overrides (`DB_NAME_SERVER=test_database ...`) did not take effect in this run context; follow-up is to run the DB suite in a sanitized env where `DB_NAME_SERVER` resolves to a safe test DB before release sign-off.
