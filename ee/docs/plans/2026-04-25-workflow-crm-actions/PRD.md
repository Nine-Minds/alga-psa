# PRD — CRM Workflow Actions

- Slug: `workflow-crm-actions`
- Date: `2026-04-25`
- Status: Draft

## Summary

Expand the Workflow Runtime V2 CRM action module beyond its single existing action, `crm.create_activity_note`, so workflow authors can query and update CRM activities, schedule follow-up activities, and automate quote sending from workflow logic.

This plan treats the user-proposed CRM action list as a phased roadmap. The first implementation pass focuses on the four highest-value actions:

1. `crm.find_activities`
2. `crm.update_activity`
3. `crm.schedule_activity`
4. `crm.send_quote`

The remaining recommended actions are documented as follow-on scope so their naming, dependencies, and overlap with newly merged Client workflow actions are explicit before implementation begins.

## Problem

The CRM workflow module is sparse. Today it registers exactly one action in `shared/workflow/runtime/actions/businessOperations/crm.ts`:

- `crm.create_activity_note`

That leaves workflow authors unable to automate common CRM loops:

- Look up recent sales/account interactions before choosing an onboarding path.
- Update an activity after a ticket, quote, or project milestone changes.
- Schedule a follow-up call or meeting after work is completed.
- Send a prepared quote when a workflow reaches a business-ready state.

By comparison, Tickets and Clients now have much richer workflow action coverage. Recent main-branch updates added extensive Client workflow actions and established implementation conventions that CRM should follow.

## Goals

- Add first-pass CRM workflow actions for activity lookup, activity update, follow-up scheduling, and quote sending.
- Keep actions grouped under the existing Workflow Designer CRM tile via `crm.*` action IDs.
- Preserve current shared workflow runtime architecture: Zod schemas, registry registration, `action.call`, tenant transaction helpers, permission checks, audit logs, and schema-derived designer forms.
- Reuse existing data models/services where safe, but do not import server-only `withAuth` actions into shared runtime code.
- Follow recent main-branch workflow-action conventions:
  - picker metadata with `withWorkflowJsonSchemaMetadata`
  - lazy workflow event publisher imports from shared runtime action handlers
  - deterministic event idempotency keys
  - DB-backed shared-root action tests
- Clearly separate CRM activity/interactions from Client-module notes/interactions that now exist in `clients.*` workflow actions.

## Non-goals

- Replacing `crm.create_activity_note` or changing its persisted contract.
- Implementing every recommended CRM action in the first pass.
- Building new Workflow Designer UI controls beyond existing schema metadata and picker conventions.
- Calling Next.js server actions or `withAuth` action wrappers directly from shared workflow runtime code.
- Reworking quote lifecycle, quote PDF rendering, email templates, or approval logic outside the workflow-action wrappers.
- Duplicating `clients.add_note` or `clients.add_interaction` semantics under CRM without a clear CRM-wide abstraction.
- Adding new event schemas unless implementation discovers a hard gap that cannot be solved with existing CRM/tag/quote events.

## Users and Primary Flows

### Users

- MSP admin building workflow automations.
- Account manager or dispatcher whose CRM follow-up tasks are triggered by tickets, projects, or quote state.
- Internal Alga PSA engineer extending Workflow Runtime V2 business operations.

### Primary flows

1. **Find recent CRM activity before branching**
   - Workflow receives a client/contact/ticket event.
   - Workflow runs `crm.find_activities` with client/contact/date/type/status filters.
   - Workflow branches based on whether there were recent sales, QBR, onboarding, or support interactions.

2. **Update an existing CRM activity**
   - Workflow has an interaction ID from a trigger or prior lookup.
   - Workflow runs `crm.update_activity` to update status, notes, tags, visibility, or outcome-related fields.
   - The action returns before/after summaries and changed fields.

3. **Schedule a follow-up activity**
   - Workflow closes a ticket or completes onboarding.
   - Workflow runs `crm.schedule_activity` to create a future-dated interaction linked to a client/contact/ticket.
   - The activity appears as a CRM interaction/follow-up record and emits interaction logging events where appropriate.

4. **Send a quote from workflow**
   - Workflow identifies an existing quote that is ready to send.
   - Workflow runs `crm.send_quote` with optional recipients, subject, and message.
   - Existing quote send logic publishes the quote to the portal, stores/generates PDF best-effort, and sends email best-effort.

## UX / UI Notes

- New actions should appear under the existing Workflow Designer CRM group. No catalog seed change should be needed because `crm.*` action IDs map to the built-in CRM group.
- First-pass labels:
  - `crm.find_activities` → Find CRM Activities
  - `crm.update_activity` → Update CRM Activity
  - `crm.schedule_activity` → Schedule CRM Activity
  - `crm.send_quote` → Send Quote
- Schema descriptions should use MSP language: activity, interaction, follow-up, client, contact, quote.
- Picker-backed fields should use current metadata conventions where supported:
  - `client_id` → `client`
  - `contact_id` → `contact` with `client_id` dependency when applicable
  - `ticket_id` → `ticket`
  - `user_id`/owner fields → `user`
  - `quote_id` can remain UUID in v1 unless a quote picker already exists or is introduced separately
  - interaction type/status can remain UUID fields in v1 unless a supported picker kind exists
- Output schemas should be rich enough for downstream branches: found counts, activity summaries, quote status, email sent flag where available, and changed fields.

## Requirements

### Functional Requirements — First Pass

#### `crm.find_activities`

- Register action ID `crm.find_activities`, version `1`.
- Side-effect-free.
- Inputs:
  - optional `client_id`
  - optional `contact_id`
  - optional `ticket_id`
  - optional `user_id`
  - optional `type_id`
  - optional `status_id`
  - optional `date_from`
  - optional `date_to`
  - optional `limit` defaulted and capped
  - optional `on_empty`: `return_empty` or `error`
- Require at least one meaningful filter or date range to avoid unbounded CRM scans.
- Enforce `client:read`, `contact:read`, or a CRM/read-equivalent permission decision documented before implementation. If no CRM-specific permission exists, use the safest existing resource permission based on supplied filters.
- Return:
  - `activities`: array of normalized activity summaries
  - `count`
  - `matched_filters`
- Summaries should include interaction ID, type, status, client/contact/ticket IDs and names where available, title, notes preview, interaction date, start/end time, user ID/name, visibility, category, and tags where available.

#### `crm.update_activity`

- Register action ID `crm.update_activity`, version `1`.
- Inputs:
  - `activity_id`
  - `patch` object for editable fields:
    - `title`
    - `notes`
    - `status_id`
    - `visibility`
    - `category`
    - `tags`
    - `interaction_date`
    - `start_time`
    - `end_time`
    - `duration`
    - optionally `type_id` if changing type is product-safe
  - optional `reason`
- Reject empty patches.
- Validate activity exists in tenant.
- Validate status IDs are tenant statuses with `status_type = 'interaction'`.
- Validate interaction type IDs against tenant `interaction_types` or `system_interaction_types`.
- Preserve immutable fields such as `tenant`, `interaction_id`, and workflow actor attribution unless explicitly designed otherwise.
- Write run audit with before/after summary and changed fields.
- Return before/after summaries and changed fields.

#### `crm.schedule_activity`

- Register action ID `crm.schedule_activity`, version `1`.
- Inputs:
  - `client_id` or `contact_id` (at least one required; resolve client from contact when omitted)
  - optional `ticket_id`
  - `type_id`
  - `title`
  - optional `notes`
  - optional `status_id` (default to tenant default interaction status)
  - `start_time`
  - optional `end_time`
  - optional `duration`
  - optional `visibility`
  - optional `category`
  - optional `tags`
  - optional `assigned_user_id`/`owner_user_id`; default workflow actor in v1
  - optional `idempotency_key`
- Validate linked client/contact/ticket relationships.
- Validate `start_time <= end_time` when both are supplied.
- If duration is omitted and start/end are supplied, derive duration consistently with current interaction behavior.
- If status is omitted, use the tenant default `interaction` status or fail with a clear setup error if missing.
- Insert into `interactions` as a future-dated interaction/follow-up.
- Emit `INTERACTION_LOGGED` using existing payload builders through a lazy event publisher helper and deterministic idempotency key.
- Write run audit.
- Return created activity summary.

#### `crm.send_quote`

- Register action ID `crm.send_quote`, version `1`.
- Inputs:
  - `quote_id`
  - optional `email_addresses`
  - optional `subject`
  - optional `message`
  - optional `no_op_if_already_sent` default `true`
- Validate quote exists in tenant and is not a template.
- Enforce billing update/read authorization equivalent to existing quote send behavior.
- Respect existing approval settings and quote status rules:
  - if approval is required, only approved quotes can be sent
  - otherwise only draft or approved quotes can be sent
- Prefer shared-safe reuse of underlying billing quote send services/models. Do not import `withAuth` server action wrappers directly into shared runtime. If direct package import is unsafe, extract a shared-safe quote send helper first.
- Preserve existing send behavior: transition quote to `sent`, set `sent_at`, store quote PDF best-effort, send quote email best-effort, record quote activity.
- Return quote summary plus send metadata such as previous status, new status, sent timestamp, recipients, email_sent, and message ID where available.
- Write run audit with quote ID, previous/new status, and email metadata.

### Functional Requirements — Roadmap / Follow-on Scope

These are explicitly useful but not required for the first implementation pass unless scope is expanded.

- `crm.create_interaction_type`: create tenant-specific CRM activity types such as QBR, Site Visit, or Upsell Call.
- `crm.update_activity_status`: dedicated status-transition wrapper around `crm.update_activity` for simple “mark completed/closed” workflows.
- `crm.create_quote`: create a quote from workflow, including template-based creation where safe.
- `crm.convert_quote`: convert quote to draft contract, invoice, or both using existing quote conversion services.
- `crm.find_quotes`: search quotes by client, status, date range, template flag, and pagination options.
- `crm.submit_quote_for_approval`: move eligible draft quotes into quote approval flow.
- `crm.tag_entity`: apply tags to client, contact, or interaction using existing tag definitions/mappings and TAG events.
- `crm.create_client_note`: only if a CRM-wide note action is still needed after the newly merged `clients.add_note` action; otherwise prefer Client/Contact module note actions.

### Cross-cutting Requirements

- Register all first-pass actions in `shared/workflow/runtime/actions/businessOperations/crm.ts` via existing `registerCrmActions()` and `registerBusinessOperationsActionsV2()` wiring.
- Use `withTenantTransaction`, `requirePermission`, `writeRunAudit`, `throwActionError`, and `rethrowAsStandardError` from `businessOperations/shared.ts`.
- Use `withWorkflowJsonSchemaMetadata` from `shared/workflow/runtime/jsonSchemaMetadata.ts` for supported picker fields.
- Use action-provided idempotency for create/send operations where retry duplicates are possible; use engine-provided idempotency for reads and deterministic updates.
- Use lazy dynamic import for workflow event publication from shared runtime action handlers, mirroring the new Client workflow actions.
- Use deterministic event idempotency keys for emitted workflow events.
- Keep implementation additive and backward compatible with existing workflows.

## Data / API / Integrations

### Current workflow files

- `shared/workflow/runtime/actions/businessOperations/crm.ts`
- `shared/workflow/runtime/actions/businessOperations/clients.ts`
- `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`
- `shared/workflow/runtime/designer/actionCatalog.ts`
- `shared/workflow/runtime/jsonSchemaMetadata.ts`
- `shared/workflow/runtime/actions/businessOperations/shared.ts`

### Existing CRM/client files and patterns

- `packages/clients/src/actions/interactionActions.ts`
  - `getInteractionsForEntity`
  - `getRecentInteractions`
  - `updateInteraction`
  - `addInteraction`
- `packages/clients/src/models/interactions.ts`
  - `getForEntity`
  - `getRecentInteractions`
  - `updateInteraction`
  - `getById`
- `packages/clients/src/actions/interactionTypeActions.ts`
  - `createInteractionType`
- `shared/workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders.ts`
  - `buildInteractionLoggedPayload`
  - `buildNoteCreatedPayload`

### Existing quote files and patterns

- `packages/billing/src/actions/quoteActions.ts`
  - `createQuote`
  - `sendQuote`
  - `submitQuoteForApproval`
  - `convertQuoteToContract`
  - `convertQuoteToInvoice`
  - `convertQuoteToBoth`
- `packages/billing/src/models/quote.ts`
  - `getById`
  - `getByNumber`
  - `listByTenant`
  - `listByClient`
- `packages/billing/src/services/quoteConversionService.ts`
  - `convertQuoteToDraftContract`
  - `convertQuoteToDraftInvoice`
  - `convertQuoteToDraftContractAndInvoice`

### Existing tag/event files

- `packages/tags/src/actions/tagActions.ts`
- `shared/workflow/streams/domainEventBuilders/tagEventBuilders.ts`
- `shared/workflow/runtime/schemas/crmEventSchemas.ts`

### Existing tables likely touched

- `interactions`
- `interaction_types`
- `system_interaction_types`
- `statuses` where `status_type = 'interaction'`
- `clients`
- `contacts`
- `tickets`
- `quotes`
- quote activity/document/email-related tables used by existing quote send behavior
- `audit_logs`

## Security / Permissions

- All queries and mutations must filter by tenant.
- Activity reads must require a safe read permission. Exact permission mapping must be documented before implementation if no CRM-specific permission exists.
- Activity updates and scheduling must require update/create permissions for the relevant CRM resource or safest existing client/contact permission.
- Quote send must require the same effective billing read/update authorization as existing quote send behavior, including authorization-kernel checks where applicable.
- Workflow actor should remain the actor for audit/event attribution unless a future action version explicitly supports permission-gated actor override.
- Do not allow workflow inputs to set `tenant`, `interaction_id`, quote ownership, or other system-managed fields.

## Observability

- Write `audit_logs` rows with `writeRunAudit` for all side-effectful actions.
- Include action ID/version, target IDs, changed fields, before/after status where relevant, and event/send metadata.
- Use existing workflow event builders and lazy publication helpers for `INTERACTION_LOGGED` where new interactions are created.
- Do not add new metrics in this plan.

## Rollout / Migration

- No database migration is expected for the first pass.
- Runtime/catalog additions are additive and should not break existing workflow definitions.
- Existing `crm.create_activity_note` remains available and unchanged.
- Designer catalog should expose the new CRM actions automatically after runtime initialization.
- If implementation discovers missing status/type constraints or missing quote-safe helper boundaries, update the plan before adding migrations or package refactors.

## Open Questions

1. What is the correct permission resource/action for CRM interactions? Candidate mappings: `client:read/update`, `contact:read/update`, or a CRM/activity-specific permission if one exists.
2. Should `crm.update_activity` emit a workflow event? There is `INTERACTION_LOGGED` for creation, but no obvious `INTERACTION_UPDATED` schema in current CRM event schemas.
3. Should `crm.schedule_activity` be considered a normal `INTERACTION_LOGGED` event even when the interaction date is in the future?
4. Is quote send safe to extract into a shared helper callable from `shared/workflow/runtime`, or should the workflow action perform equivalent persistence while avoiding server-only action imports?
5. Should `crm.send_quote` no-op for already sent quotes, or should it support resend semantics in a later `crm.resend_quote` action?
6. Should `crm.create_client_note` be dropped from the CRM roadmap because `clients.add_note` now exists, or retained as a cross-entity CRM note wrapper?

## Acceptance Criteria (Definition of Done)

- Runtime initialization registers `crm.find_activities`, `crm.update_activity`, `crm.schedule_activity`, and `crm.send_quote` at version `1`.
- Designer catalog shows the new actions under the CRM group with meaningful labels, descriptions, input schemas, output schemas, and supported picker metadata.
- `crm.find_activities` returns tenant-scoped filtered interaction summaries and rejects unsafe unbounded queries.
- `crm.update_activity` validates editable fields, status/type IDs, and tenant ownership, then returns before/after summaries and changed fields.
- `crm.schedule_activity` creates a future-dated interaction linked to valid client/contact/ticket records, audits the change, and emits `INTERACTION_LOGGED` through the shared-runtime-safe event publishing pattern.
- `crm.send_quote` sends/publishes an eligible quote using existing quote send semantics or a shared-safe extraction of that logic, audits the result, and returns send metadata.
- All side-effectful actions enforce permissions and write run audit rows.
- DB-backed tests cover representative success and guard/failure paths for activity update/schedule and quote send eligibility.
- Unit tests cover action registration, designer CRM grouping, picker metadata, and event payload compatibility.
- No existing workflow runtime, Client workflow action, Ticket workflow action, or CRM activity note tests regress.
