# Ticket Bundling (Master/Child Tickets)

## Summary

Ticket bundling reduces queue noise caused by duplicate incoming issues by grouping related tickets into a single **bundle** represented by a **master ticket** with one or more **child tickets**. Technicians work primarily from the master ticket (status, assignment, SLA, time, resolution, and communication), while child tickets preserve per-requester/per-channel context and remain navigable for traceability.

Bundling supports two operational modes: **Link-only** (children are linked and follow master closure without copying content) and **Sync updates** (selected master events are mirrored onto children as system-generated entries). The default mode for this feature is **Sync updates**. The ticket list and ticket detail experiences include a toggle to view bundles as **collapsed** (single row) or **expanded** (individual child rows grouped under the master).

## Problem Statement

When many duplicate tickets arrive (email storms, monitoring alerts, outages), technicians must triage and update many identical work items. This increases operational overhead, clutters the ticket board, and risks inconsistent responses or closure states across duplicates.

## Goals

- Collapse duplicate tickets into a single working context without losing per-requester/per-source history.
- Provide a familiar “merge/parent-child” workflow comparable to other MSP PSAs: one master ticket, linked duplicates, optional update sync.
- Prevent notification/communication spam while still allowing customer updates to reach the correct recipients.
- Preserve traceability: technicians can always navigate to child tickets for requester/channel context.

## Non-Goals (for this plan)

- Full “problem/incident” management with separate Problem records and root-cause workflows.
- Automated ML-based duplicate detection.
- Cross-tenant bundling.

## Target Users / Personas

- **Dispatcher / Service Coordinator:** needs to reduce board noise quickly (manual bundle, bulk actions).
- **Technician:** needs one place to work and communicate, with the ability to inspect child context.
- **Manager:** wants consistent outcomes and clear audit trails for duplicates/outage storms.
- **Client / Requester (email + portal):** expects replies/updates to feel consistent and follow their thread.

## Primary User Flows

### 1) Manual Bundling (Dispatcher)

1. Select multiple tickets on the ticket list.
2. Choose **Bundle Tickets** action.
3. Select a master ticket (from selected tickets).
4. Choose mode:
   - **Link child tickets to master** (always enabled)
   - **Sync updates from master to children** (default)
5. Confirm.
6. Ticket list updates to show a single master row (collapsed view), with child count and rollups.

### 2) Working a Bundled Ticket (Technician)

1. Open the master ticket.
2. View bundle panel: child list (requester, channel, last activity, status), with quick navigation.
3. Add public reply/internal note; update status/assignment/priority; log time.
4. If **Sync updates** is enabled, children receive a system-generated mirrored update.

### 3) Inbound Reply on a Child Ticket (Email/Portal)

1. A requester replies via email to their original ticket thread (child).
2. System records the message against the child’s conversation record for traceability.
3. The message is surfaced in the master’s conversation as an **aggregated, view-only** item attributed to the child context (i.e., not duplicated as a new master conversation entry).
4. Notifications fire primarily for the master (de-duped for internal users).

### 4) Unbundle / Promote / Remove Child (Dispatcher/Technician)

- Remove a child from a bundle (restore normal behavior).
- Promote a child to become the new master (optional; maintains bundle membership).
- Split/clone conversation items as needed to preserve audit trails.

## UX / UI Notes

### Ticket List / Dashboard

- **Bundle view toggle:** “Bundled view” (collapsed bundles) vs “Individual view” (all tickets, grouped).
- **Collapsed bundles:** show the master ticket row with:
  - child count
  - rollups: highest priority, affected client/site(s), newest activity timestamp, status, assigned agent(s)
- **Expanded bundles:** master row followed by indented child rows (or grouped section UI).
- **Bulk action:** “Bundle Tickets” enabled when 2+ tickets selected.

### Ticket Details (Master)

- Bundle panel:
  - “This ticket is the master of a bundle (N children)”
  - Child list with requester, source, created, last activity, quick open
  - Actions: add child, remove child, promote child to master, unbundle
- Conversation view:
  - Unified stream showing master items and child-attributed inbound messages (visually labeled).

### Ticket Details (Child)

- Banner: “This ticket is bundled under [Master #]”
- Read-only/locked fields (depending on mode/policy) with clear explanation.
- Conversation remains visible; inbound replies still allowed.

## Functional Requirements

### Bundling Semantics

- A ticket can be either:
  - **Standalone** (not in a bundle)
  - **Master** (bundle root)
  - **Child** (linked to one master)
- A ticket can belong to at most one bundle at a time.
- Master and children must share tenant. Bundles may span multiple companies/clients (e.g., multi-tenant incidents like an O365 outage). UI should clearly indicate “multiple clients” and may warn before confirming.
- Bundle mode is stored and governs update propagation and notifications.

### Update Propagation (Sync Updates)

When enabled, selected master events are mirrored to children as **system-generated** entries:

- Public replies (outbound)
- Status transitions
- Assignment changes
- Resolution/closure

Mirrored entries must be idempotent.

### Notifications & Communication

- Internal notifications should be **de-duplicated**: one notification for the master event, not N notifications for mirrored child events.
- Customer email behavior is tenant-configurable and defaults to notify **all child requesters** for master public updates:
  - notify only the master requester/contact
  - notify all child requesters
  - notify a selected subset per update
- Inbound replies on child tickets:
  - are recorded on the child
  - are surfaced on the master conversation as aggregated, view-only items
  - may reopen the master based on policy

### Time, SLA, and Billing Considerations

- Default: time entries attach to the master ticket.
- Child tickets can optionally be time-locked (no time entries) to prevent accidental double billing.
- SLA timers and aging calculations are driven by the master in bundled view; child SLAs may be suppressed or marked “bundled”.

### Permissions

- Only users with ticket update permissions (and optional “bundle tickets” permission) can create/modify bundles.
- Client portal users cannot bundle; they only experience consistent communication and visibility.

## Data Model & APIs (Proposed)

### Minimal Schema

- Add `master_ticket_id` (nullable) to `tickets`:
  - `NULL` => standalone or master
  - non-`NULL` => child pointing to master
- Add `ticket_bundle_settings` table keyed by master ticket:
  - mode: `link_only | sync_updates`
  - policy flags (e.g., reopen_on_child_reply)

### Indices / Constraints

- Index on `(tenant, master_ticket_id)` for child lookup.
- Constraint: child and master must share tenant; enforce in application and/or DB constraint if feasible with RLS.

### APIs

- Bundle create/update endpoints:
  - create bundle (set master, attach children, mode)
  - add/remove children
  - promote child to master
  - unbundle
- Query endpoints:
  - get ticket bundle summary for list view (rollups)
  - get bundle membership for ticket detail (master + children)

## Rollout / Migration

- Backfill not required (new fields nullable).
- Add admin settings for default bundle behavior and notification rules.

## Risks & Edge Cases

- Preventing notification spam when syncing updates.
- Email threading: inbound replies must map correctly to a child even when master is primary work item.
- Avoiding accidental data loss when unbundling or changing master.
- Ensuring permissions and RLS tenant isolation for bundle queries.

## Decisions (Confirmed)

1. UI terminology: **Bundle**.
2. Default mode: **sync_updates**.
3. Child workflow fields (status/assignment/priority): **locked by default**.
4. Default customer notification scope for master public updates: **all child requesters**.
5. Bundle membership: **same-tenant only** (cross-client bundling allowed).
6. Inbound child replies: **surface on master as view-only (no duplication onto master)**.
7. Sync updates: **do not mirror internal notes** (internal notes stay on master).
8. On bundle creation: children **keep their current status** (with locked workflow fields).

## Remaining Open Questions

1. Should child inbound replies also reopen children when reopen-on-reply is enabled, or only the master?
2. For bundles spanning multiple clients, should “Email all affected requesters” require an extra confirmation step by default?

## Acceptance Criteria / Definition of Done

- Users can create a bundle from 2+ tickets by selecting a master and mode.
- Ticket list supports collapsed bundle view and expanded individual view with grouping.
- Master ticket clearly displays bundle membership and allows navigation and bundle management actions per permissions.
- Child tickets show a clear banner and correct linkage; inbound replies are handled predictably.
- Sync mode reliably mirrors selected master updates to children without spamming internal notifications.
- All functionality is tenant-isolated and respects existing permission patterns.
