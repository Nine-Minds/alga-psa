# Workflow Event Catalog v2 — Domain Events Expansion

| | |
|---|---|
| **Date** | 2026-01-23 |
| **Status** | Draft |
| **Owner** | Workflow Overhaul |

## 1. Summary

Expand the **Workflow Event Catalog (v2)** with a comprehensive, business-relevant set of **domain events** (tickets, scheduling, projects, billing, CRM, documents, email, integrations, assets/media), and implement end-to-end production emission of these events so customers can attach workflow v2 triggers reliably.

This plan implements the proposed catalog entries and runtime plumbing described in:

- `ee/docs/plans/2025-12-28-workflow-event-catalog/PRD.md`
- `ee/docs/plans/2025-12-28-workflow-event-catalog/event-proposals.md`

## 2. Problem / User Value

Today, the catalog exists and simulation tooling exists, but the catalog is incomplete and many valuable business moments are not emitted (or are emitted inconsistently across modules). Users cannot reliably automate real-world MSP flows (billing, dispatch, SLA, approvals, customer communication) because the event set is missing or not standardized.

Delivering a consistent, curated event set enables:

- Faster automation authoring (“when X happens, do Y”).
- Stronger observability and debugging (clear event types + stable payload shapes).
- Safer integrations (schema validation + versioning).

## 3. Goals

1. Add all proposed domain events to the system catalog with correct category/name/description and `payload_schema_ref`.
2. Provide stable, versioned payload schemas in the workflow schema registry for every catalog event (`payload.*.v1`).
3. Ensure the event bus accepts/validates these events (shared event bus schema/types).
4. Emit events from real business logic paths across modules (not only via simulation).
5. Add test coverage that ensures event emission + schema validation + catalog presence.

## 4. Non-goals

- New UI work for the Events Catalog screen (covered by the 2025-12-28 plan).
- Implementing entirely new product features solely to support events (e.g., building approvals if approvals don’t exist).
- Building “event replay” tooling beyond existing simulate.
- Backfilling historical events.

## 5. Scope (What “Implemented” Means)

For each event type in `event-proposals.md`, “implemented” means:

1. A catalog entry exists in `system_event_catalog` (or tenant `event_catalog` if intentionally tenant-only).
2. The catalog entry has a `payload_schema_ref` (schema registry key) and appropriate metadata (category, description).
3. The workflow schema registry has a registered schema at that ref (`payload.<Event>.v1`).
4. The event bus type/schema permits publishing that `eventType` and validates payload shape at publish/ingest boundaries (as applicable).
5. A real product path emits the event (or the plan explicitly marks it as “catalog-only” if it’s not yet backed by behavior).

## 6. Event Design Standards

### 6.1 Naming

- `event_type`: `SCREAMING_SNAKE_CASE` (existing convention).
- `payload_schema_ref`: `payload.<PascalCaseEventName>.v1` (versioned; changes require `.v2`).

### 6.2 Payload conventions

Payload schemas must use **camelCase** JSON keys (no `snake_case`). This aligns with existing event bus payload shapes and reduces mapping friction across the product.

Minimum recommended fields (where applicable):

- `tenantId` (always; required by schema)
- Entity identifiers: `ticketId`, `projectId`, `invoiceId`, etc. Prefer a single canonical ID per domain; do not embed full entity snapshots unless strictly necessary.
- Actor (when meaningful):
  - `actorUserId` (preferred when initiated by an internal user)
  - `actorContactId` (when initiated by an external/client contact)
  - `actorType` only when needed to disambiguate (`USER` / `CONTACT` / `SYSTEM`)
- State transitions:
  - Use `previousX` / `newX` (e.g. `previousStatus`, `newStatus`).
  - For assignment-style transitions, prefer explicit fields like `previousAssigneeUserId` / `newAssigneeUserId`.
- Mutations:
  - `updatedFields: string[]` with dot-paths (e.g. `["billingAddress.line1", "dueDate"]`) **and/or**
  - `changes: Record<string, { previous: unknown; new: unknown }>` keyed by the same dot-paths.
- Timestamps:
  - `occurredAt` (always; ISO 8601 string) — when the event happened.
  - Include domain timestamps such as `createdAt` / `updatedAt` only if they add meaningful context for workflows.

### 6.3 Catalog vs event bus vs schema registry

We maintain three related “sources of truth”:

- **Catalog tables** (`system_event_catalog`, `event_catalog`): which events are workflow-relevant and discoverable in UI.
- **Event bus schema/types** (`shared/workflow/streams/eventBusSchema.ts`): what event types can be published/ingested safely.
- **Workflow schema registry** (`shared/workflow/runtime/registries/schemaRegistry` + registrations): canonical payload schemas for trigger mapping + simulation.

This plan ensures these are consistent for the expanded event set.

## 7. Implementation Approach

### 7.1 Foundations (once)

- Define/confirm canonical payload field naming (camelCase vs snake_case) and align new schemas accordingly.
- Add shared helpers to reduce duplication when publishing events (including a single place to apply `tenantId`/actor enrichment).
- Add schema registry definitions and registrations for new payload refs.
- Update `shared/workflow/streams/eventBusSchema.ts` to include event types and payload schema mappings for the expanded set.
- Add migrations that insert/update catalog entries (idempotent upserts by `event_type`).

### 7.2 Domain emission (by module)

Implement emission in the closest “business action” layer (server actions/services) where the state change is authoritative, using the event bus publisher utilities so the workflow worker ingests events via the shared global stream.

Modules in scope:

- Tickets: status/priority/assignment, messages/comments, SLA stages, approvals (if present).
- Scheduling: schedule entries/appointments, blocks, dispatch/field ops (if present), capacity thresholds.
- Projects: project lifecycle, tasks, dependencies, approvals (if present).
- Billing: invoice lifecycle, payments, credits, contracts, recurring billing runs.
- CRM: clients/contacts, interactions/notes, tags.
- Documents: upload/delete, associate/detach, generated docs, signatures (if present).
- Email: inbound/outbound lifecycle, delivery/bounce/complaint/unsubscribe signals (where supported).
- Notifications: send/deliver/fail/read (where supported).
- Surveys/CSAT: sent/response/reminder/expired, CSAT alerts.
- Integrations: sync lifecycle, token health, webhooks, mapping changes.
- Assets/media: asset lifecycle and assignment, media processing.

### 7.3 Compatibility / de-duping

Some proposed names overlap with existing event bus types (e.g., `TICKET_COMMENT_ADDED` vs proposed `TICKET_MESSAGE_ADDED`; scheduling `SCHEDULE_ENTRY_*` vs proposed `APPOINTMENT_*`). This plan requires an explicit decision per overlap:

- Either standardize on existing event types and treat the proposal name as an alias/deprecated proposal, or
- Introduce the new event type and deprecate the old one, with clear mapping guidance.

## 8. Risks

- Overlaps/renames can break existing workflows if we replace event types rather than add new ones.
- Some events depend on behavior that may not exist across all tenants (SLA, approvals, dispatch/field ops).
- Email delivery/bounce/complaint events are provider-dependent and may require additional webhook ingestion.
- Large surface area increases maintenance burden if payload standards drift across domains.

## 9. Rollout / Migration Notes

- Use idempotent catalog upsert migrations (safe to re-run).
- Prefer additive changes (new event types) over renames; if deprecating, keep old event types operational for a defined window.
- Ship in phases by module so customers can start using early events while later modules are implemented.

## 10. Open Questions (please confirm)

1. **Canonical identifiers:** Should CRM use `clientId` everywhere, or do we also standardize on `companyId`? (The existing catalog already has both concepts in different places.)
2. **Message vs comment:** Should we keep existing `TICKET_COMMENT_*` event types and map the proposed `TICKET_MESSAGE_ADDED` to those (or vice versa)?
   - **Decision (2026-01-23):** Introduce `TICKET_MESSAGE_*` as the canonical domain event set for workflow v2; keep `TICKET_COMMENT_*` as legacy/back-compat (no automatic aliasing due to payload shape differences).
3. **Appointments vs schedule entries:** Should the scheduling layer expose `APPOINTMENT_*` events, or reuse/expand `SCHEDULE_ENTRY_*`?
   - **Decision (2026-01-23):** Introduce `APPOINTMENT_*` as canonical workflow triggers; keep `SCHEDULE_ENTRY_*` for lower-level schedule entry changes and existing calendar-sync integrations.
4. **Catalog-only events:** Are SLA/approval/dispatch events expected to exist as real product behavior today, or should they be cataloged but emitted only when those modules are enabled?
   - **Decision (2026-01-23):** `TICKET_APPROVAL_*` and `PROJECT_APPROVAL_*` events are **catalog-only** for now. The product does not currently have a ticket/project approval request/decision subsystem (no authoritative create/approve/reject path to hook), so we will not emit these events until that behavior exists.
5. **Payload field casing:** Confirm we’re standardizing on camelCase payload keys for new schemas (matches much of `shared/workflow/streams/eventBusSchema.ts` today).
   - **Decision:** use camelCase payload keys for all new `payload.*.v1` schemas and event bus payloads.

## 11. Acceptance Criteria / Definition of Done

- All events in `event-proposals.md` are either:
  - Implemented end-to-end (catalog + schema registry + event bus + emission), **or**
  - Explicitly marked as deferred/catalog-only with rationale and tracked follow-up.
- The workflow v2 simulator can simulate every catalog event using its `payload_schema_ref`.
- Integration tests validate that representative business actions publish the expected event type with a valid payload and that the workflow worker ingests it without schema errors.
