# SCRATCHPAD — Workflow Event Catalog v2 Domain Events

Rolling notes for this plan: discoveries, decisions, links, commands, and gotchas.

## Source Material

- Event proposals inventory: `ee/docs/plans/2025-12-28-workflow-event-catalog/event-proposals.md`
- Existing Events Catalog v2 plan: `ee/docs/plans/2025-12-28-workflow-event-catalog/PRD.md`
- This plan: `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/PRD.md`
- Features/tests: `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/features.json` and `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/tests.json`

## Key Discovery: Event Bus Already Has a Large Event Surface

`shared/workflow/streams/eventBusSchema.ts` already defines many event types beyond what exists in `system_event_catalog` migrations, including:

- Ticket comment events (`TICKET_COMMENT_ADDED`, `TICKET_COMMENT_UPDATED`)
- Scheduling events (`SCHEDULE_ENTRY_CREATED`, `SCHEDULE_ENTRY_UPDATED`, `SCHEDULE_ENTRY_DELETED`)
- Accounting export and calendar sync events
- Document mention event (`USER_MENTIONED_IN_DOCUMENT`)
- RMM events (`RMM_*`)

Implication: adding events is not only “add catalog rows”; we must keep **catalog**, **event bus schema/types**, and **workflow schema registry refs** aligned.

## Key Discovery: Schema Registry (Workflow Runtime v2) Is Separate From Event Bus Zod Schemas

Workflow runtime v2 registers payload schemas in `shared/workflow/runtime/init.ts` (schema registry keys like `payload.TicketCreated.v1`).

Event bus has its own Zod payload schemas in `shared/workflow/streams/eventBusSchema.ts`.

Implication: for each new catalog entry we want form-mode simulation and trigger mapping, we likely need:

- `payload_schema_ref` → schema registry registration (`payload.*.v1`)
- and (if the event is published through the event bus) inclusion in `EventTypeEnum` + `EventPayloadSchemas` mapping.

## Current Event Publishing Path (observed)

- Workflow v2 simulation / submission path uses: `packages/workflows/src/actions/workflow-event-actions.ts` (`submitWorkflowEventAction`) which publishes to the event bus and validates `event_type` exists in catalog tables.
- There are multiple non-workflow publishers already in the repo (examples found via ripgrep):
  - `packages/billing/src/services/accountingExportService.ts`
  - `packages/integrations/src/services/calendar/CalendarSyncService.ts`
  - `server/src/services/email/EmailProcessor.ts` (publishes `INBOUND_EMAIL_RECEIVED`)

Implication: we should standardize on `@alga-psa/event-bus/publishers` helpers for new emissions, and ensure payload shapes match both schemas.

## Decisions Needed (Blocking)

1. **Ticket messages vs ticket comments**
   - Keep existing `TICKET_COMMENT_*` as canonical, and map proposed `TICKET_MESSAGE_*` onto those semantics?
   - Or introduce `TICKET_MESSAGE_*` and deprecate `TICKET_COMMENT_*`?
   - **Decision (2026-01-23):** Introduce `TICKET_MESSAGE_*` as canonical workflow v2 domain events; keep `TICKET_COMMENT_*` as legacy/back-compat (no automatic aliasing due to payload shape differences).
2. **Scheduling appointments vs schedule entries**
   - Reuse existing `SCHEDULE_ENTRY_*` as canonical?
   - Or introduce `APPOINTMENT_*` (and decide whether a schedule entry is an appointment)?
   - **Decision (2026-01-23):** Introduce `APPOINTMENT_*` as canonical workflow triggers; keep `SCHEDULE_ENTRY_*` for lower-level schedule entry changes and existing integrations.
3. **Client/company identifiers**
   - Standardize payloads on `clientId`, `companyId`, or include both?
4. **Payload casing**
   - **Decision (2026-01-23):** use camelCase payload keys for all new `payload.*.v1` schemas and event bus payloads (documented in `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/PRD.md` §6.2).
5. **Catalog-only events**
   - Which of SLA/approvals/dispatch/signatures are expected to be emitted now vs later?

## Work Log

- 2026-01-23: Completed `F001` (payload conventions) by expanding `PRD.md` §6.2 with:
  - camelCase key requirement
  - required `tenantId` + `occurredAt`
  - actor field guidance (`actorUserId` / `actorContactId` / optional `actorType`)
  - transition and mutation conventions (`previousX`/`newX`, `updatedFields`, `changes`)
- 2026-01-23: Completed `F002` (shared publishing helpers + hooks):
  - Added payload enrichment helper `shared/workflow/streams/workflowEventPublishHelpers.ts`:
    - ensures `tenantId` and `occurredAt`
    - enriches actor fields (`actorType`, `actorUserId`, `actorContactId`)
    - carries optional `idempotencyKey`
  - Added publish-time hooks for workflow stream conversion:
    - `shared/workflow/streams/eventBusSchema.ts` now supports `WorkflowPublishHooks` and `convertToWorkflowEvent(event, hooks)`
    - workflow `user_id` now prefers `payload.actorUserId` (falls back to `payload.userId`)
  - Wired hooks through both event bus implementations:
    - `packages/event-bus/src/eventBus.ts` and `server/src/lib/eventBus/index.ts` accept `{ workflow }` publish options
  - Added convenience publisher wrappers:
    - `packages/event-bus/src/publishers/index.ts` and `server/src/lib/eventBus/publishers/index.ts` export `publishWorkflowEvent(...)`
- 2026-01-23: Completed `F003` (schema registry payload schemas + registrations):
  - Added shared payload building blocks in `shared/workflow/runtime/schemas/commonEventPayloadSchemas.ts`:
    - `tenantId` + `occurredAt` required on all new payload schemas
    - optional actor fields (`actorUserId`, `actorContactId`, `actorType`)
    - shared `updatedFields[]` and `changes{path:{previous,new}}` helpers
  - Added `payload.*.v1` Zod payload schemas for every event in `event-proposals.md`:
    - tickets: `shared/workflow/runtime/schemas/ticketEventSchemas.ts`
    - scheduling: `shared/workflow/runtime/schemas/schedulingEventSchemas.ts`
    - projects: `shared/workflow/runtime/schemas/projectEventSchemas.ts`
    - billing: `shared/workflow/runtime/schemas/billingEventSchemas.ts`
    - CRM/tags: `shared/workflow/runtime/schemas/crmEventSchemas.ts`
    - documents: `shared/workflow/runtime/schemas/documentEventSchemas.ts`
    - email/notifications/surveys: `shared/workflow/runtime/schemas/communicationsEventSchemas.ts`
    - integrations: `shared/workflow/runtime/schemas/integrationEventSchemas.ts`
    - assets/media: `shared/workflow/runtime/schemas/assetMediaEventSchemas.ts`
    - company: `shared/workflow/runtime/schemas/companyEventSchemas.ts`
  - Centralized schema registrations in `shared/workflow/runtime/schemas/workflowEventPayloadSchemas.ts` and updated `shared/workflow/runtime/init.ts` to register the full map at init.
  - Verified registry coverage: all `payload.<PascalCase>.v1` refs implied by `event-proposals.md` are present in `workflowEventPayloadSchemas`.
- 2026-01-23: Completed `F004` (event bus schema/types + overlap resolution):
  - Expanded `shared/workflow/streams/eventBusSchema.ts`:
    - added all proposed domain `EventTypeEnum` values from `event-proposals.md`
    - mapped new domain event types to workflow runtime payload schemas (camelCase + `occurredAt`)
    - kept legacy event payloads working via Zod unions for overlapping “already present” events
    - added a runtime guard to ensure every `EVENT_TYPES` entry has a payload schema
  - Removed duplicate schema/type definitions by re-exporting shared schema from:
    - `packages/event-bus/src/events.ts`
    - `server/src/lib/eventBus/events.ts`
  - Aligned catalog typing with the shared event bus enum:
    - `shared/workflow/types/eventCatalog.ts`
  - Added focused test coverage:
    - `shared/workflow/streams/__tests__/eventBusSchema.expandedEvents.test.ts`
  - Documented overlap decisions in `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/PRD.md` §10.
- 2026-01-23: Completed `F005` (catalog migration upsert for expanded domain events):
  - Added idempotent system catalog upsert migration: `server/migrations/20260123150000_upsert_domain_workflow_event_catalog_v2.cjs`
    - Upserts **134** total events into `system_event_catalog`:
      - **122** proposed events parsed from `ee/docs/plans/2025-12-28-workflow-event-catalog/event-proposals.md`
      - **12** “already present” core events (Company/Ticket/Project/Invoice/Email provider)
    - Normalizes `name`, `description`, `category`, and `payload_schema_ref` for each row.
    - Sets `payload_schema_ref` as `payload.<PascalCase(event_type)>.v1` (e.g. `INBOUND_EMAIL_RECEIVED` → `payload.InboundEmailReceived.v1`).
    - Intentionally does **not** manage legacy `payload_schema` JSON in catalog rows (workflow v2 uses schema registry via `payload_schema_ref`).
- 2026-01-23: Completed `F006` (simulation uses `payload_schema_ref` + schema validation):
  - Server-side event ingestion now enriches simulator payloads and validates them against the schema registry:
    - `server/src/lib/actions/workflow-runtime-v2-actions.ts` now:
      - derives `sourcePayloadSchemaRef` from submission override or catalog `payload_schema_ref`
      - enriches payload via `buildWorkflowPayload(...)` (adds `tenantId`, `occurredAt`, `actorUserId`, `actorType`)
      - rejects invalid payloads with `400` including Zod `issues`, and records an error `workflow_runtime_event`
  - Added schema registry coverage tests (no DB required):
    - `shared/workflow/runtime/__tests__/workflowEventSimulatorSchemas.test.ts`
  - Attempted DB-backed integration test run, but this sandbox cannot connect to localhost Postgres (EPERM); kept verification to schema-level tests.

- 2026-01-23: Completed `F010` (ticket transition emission):
  - Emitted workflow v2 domain events from real ticket update paths:
    - `packages/tickets/src/actions/ticketActions.ts` now publishes: `TICKET_STATUS_CHANGED`, `TICKET_PRIORITY_CHANGED`, `TICKET_UNASSIGNED`, `TICKET_REOPENED`, `TICKET_ESCALATED`, `TICKET_QUEUE_CHANGED` via `publishWorkflowEvent(...)` and shared transition detection.
    - `packages/tickets/src/actions/optimizedTicketActions.ts` updated similarly (this is the main cached ticket update path).
  - Upgraded legacy ticket lifecycle emissions to include workflow v2 context:
    - `TICKET_UPDATED`, `TICKET_ASSIGNED`, `TICKET_CLOSED` now emit via `publishWorkflowEvent(...)` (adds `occurredAt` + `actorUserId`), and `TICKET_ASSIGNED` includes `previousAssignee*`/`newAssignee*` fields for domain-style payloads while keeping legacy `userId`.
  - Added a pure transition builder for testability: `packages/tickets/src/lib/workflowTicketTransitionEvents.ts`.
  - Extended ticket zod schemas to include ITIL escalation fields (present in DB): `packages/tickets/src/schemas/ticket.schema.ts`.
  - Added unit coverage for transition detection: `packages/tickets/src/lib/__tests__/workflowTicketTransitionEvents.test.ts` (runs without DB).

- 2026-01-23: Completed `F011` (ticket relationship/aggregation emission):
  - Implemented `TICKET_MERGED` / `TICKET_SPLIT` emissions via ticket bundling actions:
    - `packages/tickets/src/actions/ticketBundleActions.ts` now publishes:
      - `TICKET_MERGED` when child tickets are attached to a master bundle (bundle/add children/promote master).
      - `TICKET_SPLIT` when child tickets are detached (remove child/unbundle master).
    - Semantics note: these events represent **bundle attach/detach** in today’s product (there is no true destructive “merge tickets” feature yet); payload still follows proposed schema (`sourceTicketId`/`targetTicketId`, `originalTicketId`/`newTicketIds`) and includes `reason` for workflow authors.
  - Updated bundling integration test harness to mock `@alga-psa/event-bus/publishers` to keep DB-backed tests isolated from the event bus.

- 2026-01-23: Completed `F012` (ticket communication emission):
  - Added a shared builder for ticket communication domain events:
    - `packages/tickets/src/lib/workflowTicketCommunicationEvents.ts` builds additive `TICKET_MESSAGE_ADDED` plus:
      - `TICKET_INTERNAL_NOTE_ADDED` for internal visibility
      - `TICKET_CUSTOMER_REPLIED` when a contact id is available
  - Emitted these events from real comment creation paths (while keeping legacy `TICKET_COMMENT_*` unchanged):
    - `packages/tickets/src/actions/comment-actions/commentActions.ts` (primary comment creation flow)
    - `packages/tickets/src/actions/ticketActions.ts` and `packages/tickets/src/actions/optimizedTicketActions.ts` (legacy/server action flows)
  - Added unit coverage with schema validation via `buildWorkflowPayload(...)`:
    - `packages/tickets/src/lib/__tests__/workflowTicketCommunicationEvents.test.ts`

- 2026-01-23: Completed `F013` (ticket work tracking emission):
  - Emitted `TICKET_TIME_ENTRY_ADDED` when time entries are created for `work_item_type='ticket'`:
    - `server/src/lib/api/services/TimeEntryService.ts` publishes on both direct create (`create`) and time-tracking completion (`stopTimeTracking`).
  - Added a small pure builder for publish-time payload shaping:
    - `server/src/lib/api/services/timeEntryWorkflowEvents.ts`
  - Added unit coverage that validates the built payload against `payload.TicketTimeEntryAdded.v1` via `buildWorkflowPayload(...)`:
    - `server/src/test/unit/timeEntryWorkflowEvents.test.ts`

- 2026-01-23: Completed `F014` (ticket SLA stage emission):
  - Implemented ITIL-backed “resolution SLA” stage events when `itil_priority_level` is present:
    - `TICKET_SLA_STAGE_ENTERED` emitted on ticket create in:
      - `packages/tickets/src/actions/ticketActions.ts` (`addTicket`, `createTicketFromAsset`)
    - `TICKET_SLA_STAGE_MET` / `TICKET_SLA_STAGE_BREACHED` emitted on ticket close in:
      - `packages/tickets/src/actions/ticketActions.ts` (`updateTicket`)
      - `packages/tickets/src/actions/optimizedTicketActions.ts` (`updateTicketWithCache`)
  - Added pure builders and idempotency keys:
    - `packages/tickets/src/lib/workflowTicketSlaStageEvents.ts`
  - Notes/constraints:
    - Stage emitted is currently `resolution` only (no first-class response/custom stage model in product yet).
    - Uses `tenantId` as a stable `slaPolicyId` placeholder until a real SLA policy model exists.

- 2026-01-23: Completed `F015` (ticket approvals — catalog-only):
  - Marked `TICKET_APPROVAL_REQUESTED` / `TICKET_APPROVAL_GRANTED` / `TICKET_APPROVAL_REJECTED` as **catalog-only** for now (no ticket approval subsystem exists to emit these events from).
  - Documented the decision in `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/PRD.md` (Open Questions #4).

- 2026-01-23: Completed `F020` (appointment lifecycle/assignment emission):
  - Emitted workflow v2 appointment domain events from real scheduling/appointment flows:
    - `packages/scheduling/src/actions/scheduleActions.ts` emits `APPOINTMENT_CREATED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_CANCELED`, `APPOINTMENT_COMPLETED`, `APPOINTMENT_NO_SHOW`, `APPOINTMENT_ASSIGNED` when schedule entries represent appointments (`work_item_type='appointment_request'` or `ticket`).
    - `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts` emits `APPOINTMENT_CREATED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_CANCELED`, `APPOINTMENT_ASSIGNED` for client portal appointment requests (actor is `CONTACT`).
    - `packages/scheduling/src/actions/appointmentRequestManagementActions.ts` emits `APPOINTMENT_CREATED`/`APPOINTMENT_ASSIGNED` for the legacy “approve request creates schedule entry” fallback; emits `APPOINTMENT_ASSIGNED` on reassignment during approval.
  - Added shared payload builders:
    - `shared/workflow/streams/domainEventBuilders/appointmentEventBuilders.ts`
  - Added schema-compat unit test coverage:
    - `shared/workflow/streams/domainEventBuilders/__tests__/appointmentEventBuilders.test.ts`
  - Notes/constraints:
    - `timezone` is emitted as `UTC` (schedule UI and storage treat times as UTC today).
    - `APPOINTMENT_NO_SHOW` is emitted only when a schedule entry status is set to a no-show variant; `party` defaults to `customer` until the product captures who no-showed explicitly.

- 2026-01-23: Completed `F021` (schedule block create/delete emission):
  - Implemented `SCHEDULE_BLOCK_CREATED` / `SCHEDULE_BLOCK_DELETED` emission for “availability blocks” represented today as **private ad-hoc schedule entries**:
    - `is_private=true`, `work_item_type='ad_hoc'`, `work_item_id=null`, exactly one `assigned_user_ids` owner.
  - Added shared payload builders:
    - `shared/workflow/streams/domainEventBuilders/scheduleBlockEventBuilders.ts`
  - Emitted events from scheduling actions:
    - `packages/scheduling/src/actions/scheduleActions.ts` publishes on create/delete, and on update when an entry becomes/ceases a private ad-hoc block.
  - Added schema-compat unit test coverage:
    - `shared/workflow/streams/domainEventBuilders/__tests__/scheduleBlockEventBuilders.test.ts`
  - Notes/constraints:
    - `timezone` is emitted as `UTC`.
    - No “block updated” domain event exists yet; time changes to an existing block do not emit a domain event unless the entry crosses the block/non-block boundary.

- 2026-01-23: Completed `F022` (capacity threshold emission):
  - Emitted `CAPACITY_THRESHOLD_REACHED` from real scheduling mutations:
    - `packages/scheduling/src/actions/scheduleActions.ts` publishes after create/update/delete via `maybePublishCapacityThresholdReached(...)`.
  - Implemented team/day capacity math (UTC date) based on existing data model:
    - Capacity limit = sum of `resources.max_daily_capacity` for active team members.
    - Current booked = sum of schedule-entry overlap hours per assignee for that team/date.
    - Event emits only on a threshold **crossing** (previousBooked < limit && currentBooked >= limit).
  - Added shared payload builder + unit coverage:
    - `shared/workflow/streams/domainEventBuilders/capacityThresholdEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/capacityThresholdEventBuilders.test.ts`
  - Added scheduling unit coverage for threshold/date math:
    - `packages/scheduling/src/lib/__tests__/capacityThresholdWorkflowEvents.test.ts`

- 2026-01-23: Completed `F023` (technician dispatch lifecycle emission):
  - Added shared payload/status helpers:
    - `shared/workflow/streams/domainEventBuilders/technicianDispatchEventBuilders.ts`
  - Emitted dispatch lifecycle workflow events from real scheduling updates:
    - `packages/scheduling/src/actions/scheduleActions.ts` now publishes:
      - `TECHNICIAN_DISPATCHED` when technicians are newly assigned to a ticket/appointment schedule entry
      - `TECHNICIAN_EN_ROUTE` / `TECHNICIAN_ARRIVED` when schedule entry `status` transitions to an en-route / arrived value (case-insensitive, supports common variants)
      - `TECHNICIAN_CHECKED_OUT` when schedule entry `status` transitions to a checked-out value **or** when the appointment is marked completed
  - Added schema-compat unit test coverage:
    - `shared/workflow/streams/domainEventBuilders/__tests__/technicianDispatchEventBuilders.test.ts`

- 2026-01-23: Completed `F030` (project lifecycle emission):
  - Added shared payload builders:
    - `shared/workflow/streams/domainEventBuilders/projectLifecycleEventBuilders.ts`
  - Emitted domain events from real project update paths:
    - `packages/projects/src/actions/projectActions.ts` publishes `PROJECT_UPDATED` (with `updatedFields` + `{previous,new}` `changes`) and `PROJECT_STATUS_CHANGED` on status transitions via `publishWorkflowEvent(...)`.
    - `server/src/lib/api/services/ProjectService.ts` publishes the same domain events for REST API updates.
  - Kept legacy email notifications working with the new payload shape:
    - `server/src/lib/eventBus/subscribers/projectEmailSubscriber.ts` now supports both legacy `{ changes: Record<string, unknown> }` and domain `{ changes: Record<string, {previous,new}> }` shapes and uses `actorUserId` when `userId` is absent.
  - Added schema-compat unit test coverage:
    - `shared/workflow/streams/domainEventBuilders/__tests__/projectLifecycleEventBuilders.test.ts`
  - Cleanup: removed forbidden feature-to-feature import (projects → clients) by querying contacts directly in `packages/projects/src/actions/projectActions.ts`.

- 2026-01-23: Completed `F031` (project task lifecycle emission):
  - Added shared payload builders + schema-compat unit tests:
    - `shared/workflow/streams/domainEventBuilders/projectTaskEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/projectTaskEventBuilders.test.ts`
  - Emitted workflow v2 domain events from real task creation/update paths:
    - `packages/projects/src/actions/projectTaskActions.ts` publishes:
      - `PROJECT_TASK_CREATED` on task create/duplicate
      - `PROJECT_TASK_ASSIGNED` on primary assignee changes (domain payload with `assignedToId/assignedToType`)
      - `PROJECT_TASK_STATUS_CHANGED` + `PROJECT_TASK_COMPLETED` when status mapping transitions (completed = enters a closed status)
    - `packages/projects/src/actions/phaseTaskImportActions.ts` publishes `PROJECT_TASK_CREATED` (+ `PROJECT_TASK_ASSIGNED` when assigned) for imported tasks.
    - `server/src/lib/api/services/ProjectService.ts` publishes the same task lifecycle events for REST API create/update paths.
    - `server/src/lib/models/scheduleEntry.ts` now publishes domain-shaped `PROJECT_TASK_ASSIGNED` when schedule-driven dispatch assigns a task.
  - Updated legacy notification/email subscribers to tolerate domain payloads:
    - `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts` (PROJECT_TASK_ASSIGNED)
    - `server/src/lib/eventBus/subscribers/projectEmailSubscriber.ts` (PROJECT_TASK_ASSIGNED)
  - Verification:
    - `npx vitest run shared/workflow/streams/domainEventBuilders/__tests__/projectTaskEventBuilders.test.ts`

- 2026-01-23: Completed `F032` (project dependency events emission):
  - Added shared payload builders + schema-compat unit tests:
    - `shared/workflow/streams/domainEventBuilders/projectTaskEventBuilders.ts` (dependency blocked/unblocked payload builders)
    - `shared/workflow/streams/domainEventBuilders/__tests__/projectTaskEventBuilders.test.ts`
  - Emitted dependency lifecycle workflow events from real dependency CRUD paths:
    - `packages/projects/src/actions/projectTaskActions.ts` publishes:
      - `PROJECT_TASK_DEPENDENCY_BLOCKED` when a blocking relationship is created (`dependency_type` in {`blocks`,`blocked_by`})
      - `PROJECT_TASK_DEPENDENCY_UNBLOCKED` when a blocking relationship is removed
  - Notes/constraints:
    - Only blocking relationships emit events; `related_to` dependencies remain non-workflow.

- 2026-01-23: Completed `F033` (project approvals — catalog-only):
  - Discovery: there is no authoritative “project approval request/decision” subsystem today (no project approval model/service/actions to hook).
  - Decision: treat `PROJECT_APPROVAL_*` events as **catalog-only** (mirrors `TICKET_APPROVAL_*` rationale) until a real project approval feature exists.
  - Updated `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/PRD.md` Open Questions #4 to reflect `PROJECT_APPROVAL_*` catalog-only status.

- 2026-01-23: Completed `F040` (invoice lifecycle emission):
  - Added billing workflow payload builders:
    - `server/src/lib/api/services/invoiceWorkflowEvents.ts`
  - Emitted invoice lifecycle workflow v2 domain events from real invoice operations:
    - `server/src/lib/api/services/InvoiceService.ts` now publishes:
      - `INVOICE_SENT` on `sendInvoice` (delivery method inferred; includes `clientId`, `sentByUserId`, `sentAt`)
      - `INVOICE_STATUS_CHANGED` on all invoice status transitions across `update`, `finalizeInvoice`, `sendInvoice`, `recordPayment`, `applyCredit`, `recordRefund`, `bulkUpdateStatus`, and soft-cancel in `delete`
      - `INVOICE_DUE_DATE_CHANGED` from `update` when due date changes
      - `INVOICE_OVERDUE` when status transitions into `overdue` (amount due computed from payments + credits)
      - `INVOICE_WRITTEN_OFF` when transitioning `overdue` → `cancelled` with a remaining balance (maps “write off” onto today’s available status model)
  - Added schema-compat unit coverage:
    - `server/src/test/unit/invoiceWorkflowEvents.test.ts`

- 2026-01-23: Completed `F041` (payment events emission):
  - Added billing workflow payload builders:
    - `server/src/lib/api/services/paymentWorkflowEvents.ts`
  - Emitted workflow v2 payment domain events from real payment paths:
    - Manual invoice payments/refunds in `server/src/lib/api/services/InvoiceService.ts` now publish:
      - `PAYMENT_RECORDED` + `PAYMENT_APPLIED` on `recordPayment`
      - `PAYMENT_REFUNDED` on `recordRefund`
    - Stripe webhook processing in `ee/server/src/lib/payments/PaymentService.ts` now publishes:
      - `PAYMENT_RECORDED` + `PAYMENT_APPLIED` on successful payment recording
      - `PAYMENT_REFUNDED` on refund recording
      - `PAYMENT_FAILED` on `payment_intent.payment_failed` events (when amount is present)
  - Added schema-compat unit coverage:
    - `server/src/test/unit/paymentWorkflowEvents.test.ts`
  - Verification:
    - `npx vitest run server/src/test/unit/paymentWorkflowEvents.test.ts`

- 2026-01-23: Completed `F042` (credit events emission):
  - Added shared billing payload builders + schema-compat tests:
    - `shared/workflow/streams/domainEventBuilders/creditNoteEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/creditNoteEventBuilders.test.ts`
  - Emitted workflow v2 credit note domain events from real credit flows:
    - `packages/billing/src/actions/creditActions.ts` now publishes:
      - `CREDIT_NOTE_CREATED` when prepayment credit tracking entries are created
      - `CREDIT_NOTE_APPLIED` per credit source used when applying credits to an invoice (supports multi-credit allocation)
    - `packages/billing/src/actions/invoiceModification.ts` now publishes:
      - `CREDIT_NOTE_CREATED` when finalizing a negative invoice that issues credit (`credit_issuance_from_negative_invoice`)
      - `CREDIT_NOTE_VOIDED` when hard-deleting a negative invoice that issued unused credit (maps delete → void)
  - Verification:
    - `npx vitest run shared/workflow/streams/domainEventBuilders/__tests__/creditNoteEventBuilders.test.ts`

- 2026-01-23: Completed `F043` (contract events emission):
  - Added shared contract payload builders + renewal timing helper:
    - `shared/workflow/streams/domainEventBuilders/contractEventBuilders.ts`
    - Renewal “upcoming” window default: **30 days** (`computeContractRenewalUpcoming`)
  - Emitted workflow v2 contract domain events from real client-contract paths:
    - `packages/clients/src/actions/clientContractActions.ts` publishes:
      - `CONTRACT_CREATED` on `assignContractToClient` and `createClientContract`
      - `CONTRACT_UPDATED` + `CONTRACT_STATUS_CHANGED` + `CONTRACT_RENEWAL_UPCOMING` (on threshold crossing) on `updateClientContract`
      - `CONTRACT_STATUS_CHANGED` on `deactivateClientContract`
    - `packages/billing/src/actions/contractWizardActions.ts` publishes:
      - `CONTRACT_CREATED` (+ optional `CONTRACT_RENEWAL_UPCOMING`) on `createClientContractFromWizard`
  - Added schema-compat unit test coverage:
    - `shared/workflow/streams/domainEventBuilders/__tests__/contractEventBuilders.test.ts`

- 2026-01-23: Completed `F044` (recurring billing run events emission):
  - Added shared payload builders + schema-compat unit tests:
    - `shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/recurringBillingRunEventBuilders.test.ts`
  - Implemented a billing “run” action that publishes workflow v2 events around invoice generation:
    - `packages/billing/src/actions/recurringBillingRunActions.ts` publishes `RECURRING_BILLING_RUN_STARTED` / `COMPLETED` (with `invoicesCreated`, `failedCount`) and `FAILED` for unexpected fatal failures.
  - Updated billing dashboard invoice generation flows to use the run action (batch + preview generation):
    - `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`
  - Verification:
    - `npx vitest run shared/workflow/streams/domainEventBuilders/__tests__/recurringBillingRunEventBuilders.test.ts`
    - Note: `npx tsc -p packages/billing/tsconfig.json --noEmit` currently fails due to existing TS errors in `packages/billing/src/actions/contractWizardActions.ts` and `packages/billing/src/actions/creditActions.ts` (pre-existing; not addressed in this item).

- 2026-01-23: Completed `F050` (CRM client events emission):
  - Added shared payload builders:
    - `shared/workflow/streams/domainEventBuilders/clientEventBuilders.ts`
  - Emitted workflow v2 domain events from real client create/update/archive paths:
    - `packages/clients/src/actions/clientActions.ts` now publishes:
      - `CLIENT_CREATED` on create
      - `CLIENT_UPDATED` on update (with `updatedFields` + `{previous,new}` `changes`)
      - `CLIENT_STATUS_CHANGED` when `properties.status` transitions
      - `CLIENT_OWNER_ASSIGNED` when `account_manager_id` changes to a user
      - `CLIENT_ARCHIVED` when `is_inactive` transitions to true (including `markClientInactiveWithContacts`)
    - `server/src/lib/api/services/ClientService.ts` now publishes the same domain events for REST API create/update paths.
  - Added schema-compat unit test coverage:
    - `shared/workflow/streams/domainEventBuilders/__tests__/clientEventBuilders.test.ts`
  - Notes/constraints:
    - `CLIENT_MERGED` remains catalog-only for now (no authoritative client merge/consolidate path exists to emit from today).

- 2026-01-23: Completed `F051` (CRM contact events emission):
  - Added shared payload builders + schema-compat unit tests:
    - `shared/workflow/streams/domainEventBuilders/contactEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/contactEventBuilders.test.ts`
  - Emitted workflow v2 contact domain events from real contact create/update/archive paths:
    - `packages/clients/src/actions/contact-actions/contactActions.tsx` publishes `CONTACT_CREATED`, `CONTACT_UPDATED`, `CONTACT_ARCHIVED` (when `is_inactive` transitions `false → true`) via `publishWorkflowEvent(...)`.
    - `server/src/lib/api/services/ContactService.ts` publishes the same domain events for REST API create/update paths.
  - Implemented `CONTACT_PRIMARY_SET` emission from the authoritative client billing contact change:
    - `packages/clients/src/actions/clientActions.ts` publishes when `billing_contact_id` changes to a non-empty contact id.
    - `server/src/lib/api/services/ClientService.ts` publishes the same event for REST API updates.
  - Notes/constraints:
    - `CONTACT_MERGED` remains catalog-only for now (no authoritative “merge contacts” path exists in product code today).

- 2026-01-23: Completed `F052` (CRM interaction/note events emission):
  - Added shared payload builders + schema-compat unit tests:
    - `shared/workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/crmInteractionNoteEventBuilders.test.ts`
  - Emitted workflow v2 domain events from real CRM activity paths:
    - `packages/clients/src/actions/interactionActions.ts` publishes `INTERACTION_LOGGED` on interaction creation (derives `channel` from interaction type; ensures interactions are linked to a `clientId`).
    - `packages/clients/src/actions/clientNoteActions.ts` publishes `NOTE_CREATED` when a notes document is first created/linked to a client.
    - `packages/clients/src/actions/contact-actions/contactNoteActions.ts` publishes `NOTE_CREATED` when a notes document is first created/linked to a contact.

- 2026-01-23: Completed `F053` (tags events emission):
  - Added shared payload builders + schema-compat unit tests:
    - `shared/workflow/streams/domainEventBuilders/tagEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/tagEventBuilders.test.ts`
  - Emitted workflow v2 tag domain events from tag actions:
    - `packages/tags/src/actions/tagActions.ts` publishes `TAG_DEFINITION_CREATED`, `TAG_DEFINITION_UPDATED`, `TAG_APPLIED`, `TAG_REMOVED` (uses definition id as `tagId`, and `entityType/entityId` from `tagged_type/tagged_id`).
  - Added `getOrCreateWithStatus` to detect definition creates reliably:
    - `packages/tags/src/models/tagDefinition.ts`

- 2026-01-23: Completed `F060` (document storage lifecycle emission):
  - Added shared payload builders:
    - `shared/workflow/streams/domainEventBuilders/documentStorageEventBuilders.ts`
  - Emitted workflow v2 document storage domain events from the authoritative storage service:
    - `packages/documents/src/storage/StorageService.ts` publishes:
      - `DOCUMENT_UPLOADED` after file record creation (includes `documentId`, `fileName`, `contentType`, `sizeBytes`, `storageKey`)
      - `DOCUMENT_DELETED` after storage delete + soft delete (includes `documentId`, `deletedAt`)
  - Verification:
    - `npx tsc -p packages/documents/tsconfig.json --noEmit`
    - `npx vitest run packages/documents/tests/storageConfig.test.ts`
  - Notes/constraints:
    - `documentId` maps to the file storage record id (`external_files.file_id`) today.
    - Publishing is best-effort (errors are logged but do not fail the upload/delete).

- 2026-01-24: Completed `F061` (document association/detach emission):
  - Added shared payload builders + schema-compat unit tests:
    - `shared/workflow/streams/domainEventBuilders/documentAssociationEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/documentAssociationEventBuilders.test.ts`
  - Emitted workflow v2 document association events from real document flows:
    - `packages/documents/src/actions/documentActions.ts` publishes:
      - `DOCUMENT_ASSOCIATED` on association creation (bulk associate and upload-time associations; also client/contract-specific helpers)
      - `DOCUMENT_DETACHED` on manual detach and on document deletion (reason=`document_deleted`)
    - `packages/documents/src/actions/documentBlockContentActions.ts` publishes `DOCUMENT_ASSOCIATED` when a block-document is created and linked to an entity
  - Verification:
    - `npx vitest run shared/workflow/streams/domainEventBuilders/__tests__/documentAssociationEventBuilders.test.ts`

- 2026-01-24: Completed `F062` (document generation emission):
  - Added shared payload builder + schema-compat unit test:
    - `shared/workflow/streams/domainEventBuilders/documentGeneratedEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/documentGeneratedEventBuilders.test.ts`
  - Emitted `DOCUMENT_GENERATED` from the authoritative PDF generation path (covers invoice PDFs and document-to-PDF conversion):
    - `server/src/services/pdf-generation.service.ts` publishes `DOCUMENT_GENERATED` after storing the generated PDF in `external_files`
    - `sourceType` is `invoice` when generating an invoice PDF, otherwise `document`
    - `sourceId` is the invoice id / source document id
  - Notes/constraints:
    - Publishing is best-effort (errors are logged but do not fail PDF generation/storage).

- 2026-01-24: Completed `F063` (document signatures — catalog-only):
  - Discovery: there is no authoritative “document signature request/fulfillment” subsystem today (no signature request model/service/actions and no provider callback/webhook ingestion path to hook).
  - Decision: treat `DOCUMENT_SIGNATURE_REQUESTED`, `DOCUMENT_SIGNED`, and `DOCUMENT_SIGNATURE_EXPIRED` as **catalog-only** until an e-sign feature is implemented.
  - Updated `ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events/PRD.md` Open Questions #4 to record the decision.

- 2026-01-24: Completed `F070` (inbound email reply emission):
  - Emitted `INBOUND_EMAIL_REPLY_RECEIVED` when the system email processing workflow matches an inbound email to an existing ticket and successfully creates the ticket comment.
  - Implemented best-effort publishing from `shared/workflow/actions/emailWorkflowActions.ts` (`createCommentFromEmail`) behind an optional `inboundReplyEvent` input.
  - Updated both workflow definitions to pass `matchedBy` (`reply_token` vs `thread_headers`) and normalized `receivedAt` for action schema validation:
    - `shared/workflow/workflows/system-email-processing-workflow.ts` (+ `.generated.js`)
    - `services/workflow-worker/src/workflows/system-email-processing-workflow.ts` (+ `.generated.js`)
  - Added a domain payload builder + schema-compat unit test:
    - `shared/workflow/streams/domainEventBuilders/inboundEmailReplyEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/inboundEmailReplyEventBuilders.test.ts`

- 2026-01-24: Completed `F071` (outbound email lifecycle emission):
  - Emitted workflow v2 outbound lifecycle events from the authoritative outbound send abstraction:
    - `server/src/lib/email/BaseEmailService.ts` now publishes best-effort:
      - `OUTBOUND_EMAIL_QUEUED` immediately before provider send attempt
      - `OUTBOUND_EMAIL_SENT` or `OUTBOUND_EMAIL_FAILED` after provider result
  - Notes/constraints:
    - Uses a generated workflow `messageId` (UUID) per send attempt, and includes provider message id when available.
    - Publishing failures do not block email delivery (events are best-effort).
  - Added unit coverage:
    - `server/src/test/unit/outboundEmailWorkflowEvents.test.ts`

- 2026-01-24: Completed `F072` (email delivery/feedback emission):
  - Implemented Resend delivery/feedback webhook ingestion (Svix signature verification):
    - `server/src/app/api/email/webhooks/resend/route.ts`
    - `server/src/services/email/webhooks/resendWebhookEvents.ts` (signature verify + mapping)
  - Added correlation tags/headers so provider callbacks can map back to `tenantId` + workflow `messageId`:
    - `server/src/lib/email/BaseEmailService.ts` now sets `X-Alga-Workflow-Message-Id`/`X-Alga-Tenant-Id` headers and `alga_*` tags on provider messages.
  - Emits workflow v2 domain events (best-effort) when Resend provider support exists:
    - `EMAIL_DELIVERED`, `EMAIL_BOUNCED`, `EMAIL_COMPLAINT_RECEIVED`, `EMAIL_UNSUBSCRIBED`
  - Added schema-compat unit coverage:
    - `shared/workflow/streams/domainEventBuilders/emailFeedbackEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/emailFeedbackEventBuilders.test.ts`
    - `server/src/test/unit/resendWebhookEvents.test.ts`

- 2026-01-24: Completed `F073` (notification delivery lifecycle emission):
  - Implemented workflow v2 notification lifecycle events for **in-app internal notifications**:
    - `NOTIFICATION_SENT` when an internal notification row is created
    - `NOTIFICATION_DELIVERED` / `NOTIFICATION_FAILED` based on Redis Pub/Sub broadcast success/failure
    - `NOTIFICATION_READ` when a user marks a notification as read
  - Wired emissions into the authoritative internal notification paths:
    - `packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts`
    - `packages/notifications/src/realtime/internalNotificationBroadcaster.ts`
  - Added shared payload builders + schema-compat unit test coverage:
    - `shared/workflow/streams/domainEventBuilders/notificationEventBuilders.ts`
    - `shared/workflow/streams/domainEventBuilders/__tests__/notificationEventBuilders.test.ts`

## Next Up

- `F074`: emit survey/CSAT lifecycle events (`SURVEY_*`, `CSAT_ALERT_TRIGGERED`).

## Suggested Phasing (to reduce risk)

Phase 1 (authoritative CRUD/state transitions; low provider dependency):
- Tickets transitions + assignment
- Projects task/status
- Billing invoice lifecycle + payments
- CRM client/contact changes
- Tags generic apply/remove

Phase 2 (integration/provider dependent):
- Email delivery/bounce/complaint/unsubscribe
- Notifications delivered/read
- Integrations token lifecycle + webhook receipt

Phase 3 (feature dependent / optional modules):
- SLA stages, approvals, dispatch/field ops, signatures

## Commands / Runbooks

- Validate plan JSON shape: `python3 scripts/validate_plan.py ee/docs/plans/2026-01-23-workflow-event-catalog-domain-events`
- Local verification for this plan (until NX worker issue is resolved):
  - Lint changed files: `npx eslint shared/workflow/streams/eventBusSchema.ts shared/workflow/streams/workflowEventPublishHelpers.ts packages/event-bus/src/eventBus.ts packages/event-bus/src/publishers/index.ts server/src/lib/eventBus/index.ts server/src/lib/eventBus/publishers/index.ts`
  - Note: `npx nx build @alga-psa/shared` fails in this sandbox with `NX   Failed to start plugin worker.`

## Gotchas

- (Resolved in this worktree) Earlier sandbox runs had `git add` / `git commit` failing with `.../.git/worktrees/.../index.lock` permission errors. As of 2026-01-23 in `/Users/roberisaacs/alga-psa.worktrees/feature/workflow-events-catalog`, commits succeed normally.
- DB-backed vitest integration tests (e.g. `server/src/test/integration/ticketBundling.integration.test.ts`) require a local Postgres instance matching `.env.localtest` (observed `ECONNREFUSED` on `localhost:5438` when not running).
- `npm run test:nx` currently fails on `tools/nx-tests/editionSwapping.test.ts` (CE alias `ee` resolves to `packages/ee/src` instead of `server/src/empty`). This appears unrelated to workflow event changes; use targeted vitest runs for verification until fixed.
- Some older unit tests import deep, non-exported subpaths (e.g. `@alga-psa/projects/actions/projectActions`) and fail under Vite import-analysis with `Missing "./actions/projectActions" specifier...`; use source-relative imports in tests or prefer shared-schema-level tests until package exports are updated.
