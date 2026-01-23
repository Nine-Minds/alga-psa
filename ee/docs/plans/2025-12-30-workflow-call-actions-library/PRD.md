# PRD — Workflow Call Actions Library (Business Operations)

- Slug: `workflow-call-actions-library`
- Date: `2025-12-30`
- Status: Draft
- Depends on:
  - `ee/docs/plans/2025-12-21-workflow-overhaul.md`
  - `ee/docs/plans/2025-12-27-workflow-trigger-payload-mapping/PRD.md`
  - `ee/docs/plans/2025-12-28-workflow-payload-contract-inference/PRD.md`

## Summary
Workflows become materially useful only when steps can *do business work* in Alga PSA: create/modify tickets, communicate with clients, schedule technicians, and write back operational records. This plan defines a first “business operations” library of workflow **call actions** (for the `action.call` step type) with consistent inputs/outputs, validation, permissions, and observability.

## Problem
The workflow system currently has limited “writeback” capability to core PSA objects. Builders can select triggers and arrange steps, but they cannot reliably execute common operational outcomes (ticketing, client communication, scheduling, time, and notes) without custom code or manual follow-up. This prevents adoption for real-world MSP automation.

## Goals
- Provide a **starter set of 15–20 business-relevant call actions** covering the majority of day-1 MSP automation needs.
- Ensure each action has:
  - a stable **action identifier** and **versioning** strategy
  - strongly-typed **input schema** and **output schema**
  - consistent **error model** (validation, permission, not-found, conflict, rate limit, transient failure)
  - consistent **audit/observability** in workflow runs (inputs redacted where needed; outputs recorded; correlation IDs)
- Make actions easy to discover and configure in the Workflow Designer (palette, searchable catalog, help text, examples).
- Ensure actions are safe by default (RBAC, tenant isolation, idempotency where applicable, retries only for transient failures).

## Non-goals
- Third-party app connectors marketplace (Slack, Teams, etc.) beyond basic email/in-app notifications.
- A complete CRM/PSA API surface (we start with a focused library and expand iteratively).
- Perfect schema coverage for every custom field/provider integration on day one.
- Replacing manual UI flows for edge-case ticket management; workflows should automate common paths first.

## Users and Primary Flows
### Users
- MSP owner / operations manager (defines automations)
- Dispatcher / service coordinator (monitors outcomes)
- Technician (receives assignments, sees ticket updates)
- Support/engineering (troubleshooting run failures)

### Primary flows
1. **Email → Ticket triage**
   - Trigger: inbound email received
   - Steps: find client/contact → create ticket → add initial public comment → assign queue/user → notify assignee
2. **SLA breach escalation**
   - Trigger: ticket SLA nearing breach
   - Steps: add internal note → change priority/status → notify manager
3. **Auto-scheduling dispatch**
   - Trigger: ticket moved to “Dispatch”
   - Steps: assign technician → create schedule entry → notify technician + requester
4. **Post-resolution follow-up**
   - Trigger: ticket closed
   - Steps: send email to requester → create activity note → record time entry (optional)

## UX / UI Notes
- Actions appear in the palette under “Business Operations”.
- Each action has a configuration panel with:
  - labeled fields with schema-driven inputs
  - expression editor + autocomplete for dynamic values
  - inline help (“What does this do?” + examples)
  - a compact “Outputs” section showing available `vars.<saveAs>` fields produced by the action
- Validation is surfaced as:
  - inline field errors for missing/invalid inputs
  - a run-time error view that includes an action-specific error code + remediation hints

## Requirements

### Functional Requirements
#### Action Registry + Versioning
- Each action is addressable via a stable id like `tickets.create` and a numeric version (start with `v1`).
- Registry metadata includes: name, description, category, input schema, output schema, required permissions, retryability hints, idempotency support, and secrets usage.
- Actions are callable as `action.call` steps and can be composed with mapping and expressions.

#### Execution + Data Context
- Each action:
  - validates inputs against schema before execution
  - executes within the tenant context
  - emits outputs into the workflow data context (e.g. `vars.ticket.*`)
- Actions that mutate records support idempotency where duplicates are likely (e.g. create ticket, send email).

#### Errors + Retries
- Standardize errors across actions:
  - `VALIDATION_ERROR`, `PERMISSION_DENIED`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `TRANSIENT_FAILURE`, `INTERNAL_ERROR`
- Only retry when the action declares the error retryable (e.g. transient provider failures).

#### Permissions + Audit
- Each action checks the appropriate permission(s) for the actor/service identity executing the workflow.
- Each action emits audit events tied to the workflow run and the target resource (ticket/client/etc.).

### Non-functional Requirements
- Connection pool safety: actions must not leak database connections; prefer short-lived queries and avoid unbounded parallelism.
- Performance: typical actions should complete within p95 < 2s in local/dev, excluding external providers.
- Observability: run timeline shows action start/end, duration, success/failure; sensitive fields redacted.

## Action Catalog
Below is the initial library (18 actions). Each action is specified at a high level here; implementation details and acceptance criteria live in `features.json` and `tests.json`.

### A01 — Tickets: Create Ticket (`tickets.create`)
- Inputs: client/contact identity, subject/description, priority/status, tags, custom fields, optional initial comment/attachments, optional external idempotency key.
- Outputs: ticket id/number/url, created timestamps, assigned entities.

### A02 — Tickets: Add Comment (`tickets.add_comment`)
- Inputs: ticket identity, comment body, visibility (public/internal), optional mentions/attachments, optional idempotency key.
- Outputs: comment id, created timestamp.

### A03 — Tickets: Update Fields (`tickets.update_fields`)
- Inputs: ticket identity, patch object (status/priority/tags/custom fields), optional optimistic concurrency token.
- Outputs: updated ticket summary (status, priority, updated_at).

### A04 — Tickets: Assign (`tickets.assign`)
- Inputs: ticket identity, assignee type (user/team/queue), optional reason.
- Outputs: assignment result (assigned_to, updated_at).

### A05 — Tickets: Close (`tickets.close`)
- Inputs: ticket identity, resolution code/text, optional public closure note, optional “notify requester”.
- Outputs: closed status, closed_at, resolution.

### A06 — Tickets: Link Entities (`tickets.link_entities`)
- Inputs: ticket identity, target entity (project/task/asset/contract/etc.), link type.
- Outputs: link id / link summary.

### A07 — Tickets: Add Attachment (`tickets.add_attachment`)
- Inputs: ticket identity, attachment source (upload reference / URL), optional visibility, optional comment to attach with.
- Outputs: attachment id, filename, storage reference.

### A08 — Tickets: Find / Read (`tickets.find`)
- Inputs: ticket id/number/external ref; optional include (comments, attachments, custom fields).
- Outputs: ticket record and requested includes.

### A09 — Clients: Find (`clients.find`)
- Inputs: client id / external ref / exact name.
- Outputs: client record (id, name, status, primary contact summary).

### A10 — Clients: Search (`clients.search`)
- Inputs: query, filters (status, tags), pagination.
- Outputs: list of clients + paging metadata.

### A11 — Contacts: Find (`contacts.find`)
- Inputs: contact id / email / phone; optional client scope.
- Outputs: contact record (id, name, email, phone, client id).

### A12 — Contacts: Search (`contacts.search`)
- Inputs: query, client scope, pagination.
- Outputs: list of contacts + paging metadata.

### A13 — Email: Send (`email.send`)
- Inputs: to/cc/bcc, subject/body (templated), from identity, attachments, provider override, idempotency key.
- Outputs: message id, provider, delivery status (queued/sent), tracking metadata.

### A14 — Notifications: In-App Notify User(s) (`notifications.send_in_app`)
- Inputs: recipients (users/roles), title/body, severity, deep link, dedupe key.
- Outputs: notification ids.

### A15 — Scheduling: Create Assignment / Schedule Entry (`scheduling.assign_user`)
- Inputs: user, time window, location (optional), link to ticket/project, conflict handling mode.
- Outputs: schedule event id, assigned user, final window.

### A16 — Projects: Create Task (`projects.create_task`)
- Inputs: project id, title/description, due date, assignee, link-to-ticket.
- Outputs: task id, url, status.

### A17 — Time: Create Time Entry (`time.create_entry`)
- Inputs: user, date/time duration, billable flags, link to ticket/project/task, notes.
- Outputs: time entry id, totals.

### A18 — CRM: Create Activity Note (`crm.create_activity_note`)
- Inputs: target (client/contact/ticket/project), note body, visibility, category/tags.
- Outputs: note id, created timestamp.

## Data / API / Integrations
- Actions should build on existing internal models/services (tickets, clients, contacts, email system, scheduling, projects, time entries).
- Action schemas should align with existing workflow registry schema patterns (schema refs, `vars.*` output typing).
- Where external providers exist (email), outputs should include provider metadata and capture common failure reasons.

## Security / Permissions
- Each action declares a required permission set, enforced at runtime.
- Inputs that can contain secrets (email SMTP creds, API keys) must be referenced via secrets system; values are never logged.
- Audit entries must include: tenant, actor (service identity), action id/version, target resource identifiers, run id.

## Observability
- Action execution spans appear in run timeline with:
  - start/end timestamps, duration, status
  - structured error code + message
  - correlation id for cross-service tracing
- Redaction policy:
  - redact secrets
  - redact email bodies by default (configurable) while retaining metadata

## Rollout / Migration
- Roll out behind a feature flag for “Business Operations Actions”.
- Enable actions in phases:
  1) read-only actions (find/search)
  2) ticket mutation actions
  3) communications + scheduling + time
- Provide seed/example workflows for common automations (triage, escalation, dispatch).

## Open Questions
- What is the authoritative permission taxonomy for tickets/clients/contacts/projects/time actions (names + scopes)?
- Which ticket field model should v1 standardize on (status enum, priority enum, categories, custom fields)?
- Email: do we send via “system email” only, or also per-tenant outbound domains? How do we select provider?
- Scheduling: what is the canonical schedule object in Alga PSA (shift vs appointment vs calendar event), and how do we handle conflicts?
- Idempotency: which actions must support idempotency from day one (create ticket, send email, create schedule)?

## Acceptance Criteria (Definition of Done)
- Each action in the catalog is:
  - available in the workflow designer action picker
  - has schema-driven configuration UI
  - executes successfully in a workflow run and produces typed outputs
  - enforces permissions and emits audit/telemetry
  - has at least basic coverage in `tests.json` (including failure cases)

