# PRD — Ticket Audit Logs / Unified Activity Timeline

- Slug: `ticket-audit-logs`
- Date: `2026-05-25`
- Status: Draft

## Summary
Add an internal, user-facing unified activity timeline to tickets so MSP staff can quickly understand what happened on a ticket and when. The timeline combines comments, internal notes, customer replies, ticket field changes, status/assignment changes, inbound email actions, document activity, and system-generated ticket events into one chronological stream.

This is an operational history feature for v1, not a compliance-grade immutable ledger.

## Problem
Ticket work currently spans several code paths and user-visible surfaces: ticket updates, comments/internal notes, API updates, client portal responses, inbound email processing, workflow/admin transactions, document uploads, and bundle/reopen behavior. Staff need a reliable time-ordered story of ticket activity without piecing together comments, fields, emails, and system behavior manually.

Without a unified timeline:
- Dispatchers and technicians cannot easily answer “what changed, who did it, and when?”
- Inbound email side effects, reopen behavior, and system updates can be hard to discover.
- Field changes such as assignment, status, priority, and response state are not presented as part of the same ticket narrative as comments.
- Debugging customer escalations requires database/log investigation instead of using the ticket itself.

## Goals
1. Provide an internal-only unified ticket timeline for MSP users.
2. Capture important ticket lifecycle events synchronously with the underlying mutation where practical.
3. Show comments, internal notes, customer replies, and operational events in one chronological stream.
4. Capture curated, user-meaningful ticket field changes rather than every low-level database column update.
5. Support inbound email and system/admin-transaction paths that may not have normal request tenant GUC context.
6. Preserve comment edit privacy/storage posture by logging edit metadata only, not old/new full comment bodies.
7. Create a schema and helper layer that can later support broader audit/compliance requirements without making v1 compliance-grade.

## Non-goals
- Compliance-grade immutable audit trail with tamper-evidence or cryptographic guarantees.
- Historical backfill for existing ticket activity.
- Exposing the activity timeline in the client portal in v1.
- Logging every persisted ticket column or implementation detail.
- Replacing the generic `audit_logs` table used by other domains/RBAC.
- Rebuilding the notification/event bus system.
- Full SLA timeline coverage unless existing mutation/event paths make specific entries inexpensive.

## Target Users and Primary Flows

### Dispatcher / Service Coordinator
- Opens a ticket and reviews the unified timeline.
- Sees when the ticket was created, assigned, moved, updated, replied to, reopened, and closed.
- Uses the timeline to understand ownership and customer communication history.

### Technician
- Reviews customer replies and internal notes in the same context as status/assignment changes.
- Adds a comment or internal note and sees it appear chronologically in the activity stream.
- Can understand whether an event originated from UI, API, client portal, inbound email, or system automation.

### Manager / Escalation Reviewer
- Reviews the timeline during escalations to understand a ticket’s operational story.
- Sees key field transitions and actor/source metadata without needing raw database access.

### Inbound Email Flow
- Incoming email creates a ticket or adds a reply/comment.
- Timeline records the inbound source and relevant email metadata without exposing unnecessary raw content.
- If inbound reply reopens a ticket, the reopen appears as an event in the same timeline.

## UX / UI Notes
- The ticket detail experience should expose a unified internal timeline.
- Comments, customer-visible messages, internal notes, and operational events should be chronologically interleaved.
- Timeline entries should use human-readable copy, for example:
  - “Alex created the ticket”
  - “Morgan changed status from New to In Progress”
  - “Customer replied by inbound email”
  - “Sam added an internal note”
  - “Ticket reopened by inbound reply”
- Existing comment/internal note authoring may remain in place, but rendered ticket history should move toward a unified timeline presentation.
- V1 can use simple grouping/formatting by timestamp and actor; advanced filters/search can be deferred unless already easy.
- Interactive UI elements must follow existing component and ID standards from `docs/AI_coding_standards.md`.

## Functional Requirements

### Timeline Scope
- FR-01: Internal MSP users can view a unified chronological timeline for a ticket.
- FR-02: The timeline includes ticket comments, internal notes, customer replies, and selected operational events.
- FR-03: Client portal users do not see the new unified timeline in v1.
- FR-04: Timeline entries are tenant-scoped and ticket-scoped.
- FR-05: Timeline entries include enough actor/source metadata to distinguish user, contact, API, inbound email, workflow, and system actions.

### Audited / Timeline Events
- FR-06: Ticket creation creates a timeline entry.
- FR-07: Curated ticket updates create timeline entries when user-meaningful fields change.
- FR-08: Status changes create timeline entries with previous and new status references/names when available.
- FR-09: Ticket closed and reopened transitions create clear timeline entries.
- FR-10: Priority changes create timeline entries.
- FR-11: Assignment/user/team changes create timeline entries.
- FR-12: Board/status moves create timeline entries.
- FR-13: Category/subcategory changes create timeline entries when supported by the mutation path.
- FR-14: Client/contact changes create timeline entries when supported by the mutation path.
- FR-15: Due date and title changes create timeline entries.
- FR-16: Response state changes create timeline entries.
- FR-17: Public/customer-visible comments create timeline entries.
- FR-18: Internal notes create timeline entries.
- FR-19: Customer replies from client portal create timeline entries.
- FR-20: Inbound email ticket creation and reply/comment creation create timeline entries with inbound-email source metadata.
- FR-21: Inbound email reopen transitions create timeline entries.
- FR-22: Bundle/master reopen from child reply creates a timeline entry.
- FR-23: Document attachment/removal creates timeline entries where those ticket flows currently exist.
- FR-24: Comment/internal-note edits create metadata-only timeline entries.
- FR-25: Comment/internal-note edit timeline entries do not store full old/new comment bodies.

### Data and API Behavior
- FR-26: Activity entries are persisted in a dedicated ticket activity/audit table rather than the generic `audit_logs` table.
- FR-27: Activity write helpers accept explicit `tenant` and therefore work in admin transactions and normal tenant-bound transactions.
- FR-28: Activity writes happen in the same transaction as the ticket/comment mutation where practical.
- FR-29: Activity entries use event names aligned with existing ticket domain events where possible.
- FR-30: The timeline read path returns entries sorted by occurrence time with stable tie-breaking.
- FR-31: The timeline read path enforces existing ticket visibility/permission rules for internal users.
- FR-32: Timeline rendering can link activity entries to the current related entity, such as a comment or document, without duplicating sensitive content unnecessarily.

### Field Diff Rules
- FR-33: V1 logs only curated ticket fields, not every `tickets` column.
- FR-34: Curated field diffs include old/new IDs and, where practical, display labels resolved for statuses, priorities, users/teams, boards, clients, contacts, categories, and subcategories.
- FR-35: No-op updates do not create noisy timeline entries.
- FR-36: Multiple curated field changes in one ticket update can be represented as one grouped entry or multiple entries, provided the UI remains understandable and the data is structured.

## Non-functional Requirements
- NFR-01: The feature must be multi-tenant safe and never leak entries across tenants.
- NFR-02: The timeline should be efficient for normal ticket sizes, using indexes on tenant/ticket/time.
- NFR-03: Activity helper failures inside the main transaction should fail fast unless a path is explicitly designated best-effort.
- NFR-04: Actor display name enrichment should not be required for correctness; IDs and source should be stored even if display lookup fails.
- NFR-05: Inbound email activity should avoid storing raw full email bodies in the activity table.
- NFR-06: The design should be backward-compatible for tickets with no activity rows yet.
- NFR-07: The timeline should not require historical backfill to function.

## Data / API / Integration Notes

### Recommended Table
Create a dedicated table, tentatively `ticket_audit_logs` or `ticket_activity_logs`.

Suggested fields:
- `audit_id` / `activity_id` UUID primary key
- `tenant` UUID not null
- `ticket_id` UUID not null
- `event_type` text not null
- `entity_type` text not null, e.g. `ticket`, `comment`, `document`, `email`, `system`
- `entity_id` UUID/text nullable
- `actor_type` text not null, e.g. `user`, `contact`, `system`, `api`, `email_sender`, `workflow`
- `actor_user_id` UUID nullable
- `actor_contact_id` UUID nullable
- `actor_display_name` text nullable
- `source` text not null, e.g. `ui`, `api`, `client_portal`, `inbound_email`, `workflow`, `system`
- `occurred_at` timestamp not null
- `changes` JSONB not null default `{}`
- `details` JSONB not null default `{}`
- `created_at` timestamp not null

Recommended indexes:
- `(tenant, ticket_id, occurred_at desc, audit_id desc)`
- Optional event/source indexes only if needed after usage is known.

### Write Integration Points
Likely mutation paths from discovery:
- `packages/tickets/src/actions/optimizedTicketActions.ts`
- `packages/tickets/src/actions/ticketActions.ts`
- `packages/tickets/src/actions/comment-actions/commentActions.ts`
- `packages/tickets/src/actions/board-actions/boardTicketStatusActions.ts`
- `packages/tickets/src/actions/ticketBundleUtils.ts`
- `server/src/lib/api/services/TicketService.ts`
- `shared/models/ticketModel.ts`
- `shared/workflow/actions/emailWorkflowActions.ts`
- `shared/services/email/processInboundEmailInApp.ts`

### Existing Related Infrastructure
- Generic audit helpers exist in both `packages/db/src/lib/auditLog.ts` and `server/src/lib/logging/auditLog.ts`, but they depend on `app.current_tenant` and are not sufficient for admin transaction paths.
- Ticket domain event schemas in `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts` should inform event names and payload shape.
- Real-time ticket update publishing exists in `packages/tickets/src/lib/liveUpdates.ts`, but the activity log should be persisted independently of Redis pub/sub.

## Security / Permissions
- Timeline read access follows internal ticket read permissions.
- Client portal does not receive the unified activity timeline in v1.
- Internal notes remain internal-only.
- Activity rows must always include tenant and ticket scoping.
- Activity details should avoid raw secret/sensitive payloads and raw inbound email bodies.

## Rollout / Migration
- Add a new migration for the activity table and indexes.
- No backfill required; existing tickets show activity only from rollout forward.
- Existing comments can continue rendering through current paths until the unified timeline read/render path is complete.
- Because this is internal-only, rollout can be guarded by normal deployment and permissions rather than a customer-facing migration.

## Open Questions
1. Should the table be named `ticket_audit_logs` to match user language, or `ticket_activity_logs` to emphasize operational timeline semantics?
2. Should v1 include a REST API endpoint for timeline retrieval, or only the internal app/server-action path?
3. Should comment deletion be supported as a timeline event if the current product does not expose comment delete broadly?
4. Should activity entries be shown newest-first or oldest-first by default in the ticket detail UI?

## Acceptance Criteria / Definition of Done
1. Internal MSP users can view a unified chronological timeline on a ticket.
2. Timeline includes comments/internal notes/customer replies and key operational ticket events.
3. Ticket create, curated update, status, priority, assignment, close/reopen, and response-state changes create activity rows.
4. Comment add and comment edit create activity rows; edits are metadata-only and do not store full old/new bodies.
5. Inbound email ticket/comment/reopen paths create timeline entries with explicit tenant/source handling.
6. Activity rows are persisted in a dedicated ticket-scoped table with tenant-safe indexes.
7. Timeline read access follows existing internal ticket permissions and is not exposed in client portal v1.
8. Automated DB-backed tests cover representative writes, curated diff behavior, inbound/admin transaction support, permissions, and chronological read ordering.
