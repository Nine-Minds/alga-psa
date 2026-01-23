# Workflow Event Catalog v2 (Automation Hub)

| | |
|---|---|
| **Date** | 2025-12-28 |
| **Status** | Draft |
| **Owner** | Workflow Overhaul |

## 1. Summary

Add a new **Workflow Event Catalog (v2)** screen in **Automation Hub** aligned with workflow runtime v2:

- Events are catalog entries (system + tenant) with a `payload_schema_ref` (schema registry key).
- Workflows attach to events via **workflow v2 triggers** (`workflow_definitions.trigger.eventName`), not legacy v1 trigger/attachment tables.

The screen lists all workflow-relevant events grouped by application modules (tickets, billing, CRM, email, etc.). Each event has:

- A **schema** (via `payload_schema_ref` / schema registry) used as the basis of workflow triggers.
- A **simulate** flow to emit a synthetic event (and optionally start workflows) for testing.
- A **metrics + audit trail** view to understand volume and recent occurrences.
- An **attach** flow to create a new workflow preconfigured with the event trigger and open the designer.
- A **detach** flow to remove event triggers from workflows currently attached to the event.

The UI is card-first (grid/list toggle) similar to the provided mockup: searchable catalog, per-event quick metrics on each card, and primary actions (Simulate, Metrics, Attach).

This PRD is aligned with the “stable workflow payload + trigger mapping” behavior:

- Workflows keep a stable `payloadSchemaRef`.
- Event trigger schemas may change, and trigger mappings (`event.payload` → workflow payload) reconcile changes.

## 2. Goals

1. **Discoverability:** Users can browse/search events and understand what data each event carries.
2. **Testability:** Users can simulate an event with a schema-driven builder and observe workflows started (or errors).
3. **Observability:** Users can see high-level metrics and a recent audit trail of runtime events.
4. **Fast authoring:** Users can attach an event to a brand-new workflow and land in the designer with the correct trigger and schema defaults.
5. **Governance:** Users can see what workflows are currently attached to an event and can detach them.

## 3. Non-goals (for this change set)

- Editing/authoring event schemas from the UI (catalog is curated by system + tenant admins).
- Full event “replay” tooling beyond manual simulation.
- Cross-tenant global analytics dashboards.
- A compatibility layer with legacy workflow-runtime v1 triggers/attachments.

## 4. Users & Permissions

### 4.1 Roles

- **Workflow read:** Can view catalog, schemas, attached workflows, metrics, and recent events.
- **Workflow manage:** Can simulate events; can create workflows from events; can detach workflows (via publishing a new version without a trigger).
- **Workflow admin:** Required to detach/edit system workflows (or any workflow marked `is_system`).

### 4.2 Security constraints

- Simulated event submission should be tenant-scoped and audited.
- Event audit trail should redact sensitive payload fields consistently with run/event redaction rules.
- Detach operations should not silently change published workflows; it must be an explicit publish of a new version (or a safe equivalent).

## 5. UX / UI Notes

### 5.1 Page layout (Automation Hub → Events Catalog)

**Top header**
- Title: “Workflow Event Catalog”
- Subtitle: “Explore, manage, and design workflows for system events and triggers.”
- Right-side controls:
  - System Status pill (Operational / Degraded / Down) (v1 can be hardcoded Operational)
  - Primary CTA: “Define Custom Event” (tenant-only)

**Filters row**
- Search input (name, `event_type`, description; supports deep-link query `?eventType=...`)
- Category dropdown (All categories)
- Status dropdown (Active / Draft / Beta / Deprecated; semantics depend on catalog entry)
- Source toggle (All / System / Tenant)
- View toggle (Grid / List)

**Grid/List**
- Each event card shows:
  - Icon (category-based)
  - Name + `event_type`
  - Status badge (Active/Beta/Draft/Deprecated)
  - Short description (2–3 lines)
  - Quick metrics (last 7 days by default):
    - executions (event count)
    - success rate (runs started from events; definition below)
    - avg latency (event→run completion or run duration; definition below)
  - Buttons:
    - Simulate
    - Metrics
    - Attach (icon button)

**Pagination**
- Default page size 24 in grid, 50 in list (configurable later)
- Shows “Showing X to Y of Z results”

### 5.2 Event details drawer/panel

Selecting a card opens a details drawer:
- Full description + metadata
- Schema preview + “View full schema”
- Attached workflows section:
  - list of published workflows whose trigger matches this event type
  - per workflow: name, version, status, paused/system badges
  - actions: “Open in designer”, “Detach”

### 5.2 Simulate event dialog

Dialog shows:
- Event name/type and schemaRef.
- Builder modes:
  - **Form** (schema-driven)
  - **JSON** (raw)
- Optional fields:
  - correlation key (for event waits)
  - payload schemaRef override (advanced; defaults to catalog schemaRef)
- Submit action:
  - Calls event ingestion action (v2): `submitWorkflowEventAction`
  - Shows result summary: event id, matched wait/run (if any), started run ids.

### 5.3 Metrics + audit

Within an event “Metrics” panel:
- Date range picker (default last 7 days).
- Summary:
  - total events
  - matched/unmatched/error counts
- “Volume over time” (daily buckets; later can be hourly).
- “Recent events” table (last N) with status, correlationKey, createdAt, processedAt.
- “Open event details” (deep link to workflow event list filtered by event name/type).

**Definitions (v1)**
- *Executions*: count of `workflow_runtime_events` for that `event_name` in range.
- *Success rate*: among workflow runs started from those events, percent with `status = SUCCEEDED`. (If run linkage is unavailable, v1 can omit success rate or compute from runs where `event_type = event_name`.)
- *Avg latency*: average run duration (`completed_at - started_at`) for runs started from these events.

### 5.4 Attach workflow (create new)

From an event row:
- **Attach → New workflow**
  - creates a draft workflow definition with:
    - `trigger.type = "event"`
    - `trigger.eventName = <event_type>`
    - `payloadSchemaRef = <event.payload_schema_ref>` if present, else an explicit “unknown” placeholder requiring selection
    - optional: set `trigger.sourcePayloadSchemaRef` from catalog schemaRef
  - navigates to the workflow designer with this workflow selected.

### 5.5 Detach workflow

From an event’s “attached workflows” list:
- Detach confirms intent.
- Detach operation:
  - creates a new draft version based on latest published
  - removes `trigger` (or sets it to null)
  - publishes the new version
  - audit logs the detach action (who/when/from what event type)

## 6. Data / API / Integrations

### 6.1 Existing data sources

- Event catalog tables:
  - `event_catalog` (tenant)
  - `system_event_catalog` (system)
- Workflow runtime v2:
  - `workflow_definitions` (trigger stored on definition)
  - `workflow_runtime_events` (audit trail)
  - `workflow_runs` (provenance, status)

### 6.2 New/updated server actions (v2)

Proposed server actions:

1. **List events** (existing)
   - `getEventCatalogEntries`
2. **List attached workflows for event type**
   - query `workflow_definitions` where `trigger->>'eventName' = <event_type>` and `status='published'`
3. **Create workflow from event**
   - wraps `createWorkflowDefinitionAction` with prefilled trigger/schema
4. **Detach workflow from event**
   - wraps:
     - load latest published definition
     - create new version with trigger removed
     - publish
5. **Event metrics**
   - queries `workflow_runtime_events` aggregates by day + summary counts
6. **Simulate event**
   - wraps `submitWorkflowEventAction` and surfaces started runs/waits.

### 6.4 Custom events (tenant)

Allow tenant users to define custom events:
- create/update/delete entries in `event_catalog` (tenant table)
- choose category, name, event_type, description
- set `payload_schema_ref` (preferred) or inline `payload_schema` (advanced/legacy)

### 6.3 Auditing

All simulate/attach/detach operations should emit audit entries, consistent with other workflow runtime actions.

## 7. Risks / Open Questions

- We must avoid mixing legacy “workflow-trigger-actions / workflow-event-attachment-actions” with v2 triggers in the same UI; this screen is v2-only.
- “Detach” implies publishing a new workflow version. We need to ensure the UX and permission checks align with publish permissions.
- Metrics volume could be large; aggregate queries should be indexed and bounded by time ranges.

## 8. Acceptance Criteria / Definition of Done

- Event catalog lists tenant + system events with category filtering and search.
- Selecting an event shows schema preview and attached workflows.
- Simulate event dialog emits an event via v2 ingestion and shows resulting started runs.
- Metrics panel shows counts and recent events for the selected event and time range.
- Attach → New workflow creates a draft workflow with the correct trigger and schema defaults and opens the designer.
- Detach removes trigger by publishing a new version and is audited; system workflows require admin.
