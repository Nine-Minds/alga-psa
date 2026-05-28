# Scratchpad — Ticket Audit Logs / Unified Activity Timeline

## Context
- Goal: add user-facing operational timeline for tickets.
- User confirmed this is not a compliance-grade immutable ledger for v1.
- User prefers a unified ticket timeline: comments, internal notes, customer replies, field changes, assignment/status changes, inbound email, and system events appear together chronologically.

## Source context
- Code context summary: `context.md` in this worktree.
- Existing generic audit helpers:
  - `packages/db/src/lib/auditLog.ts`
  - `server/src/lib/logging/auditLog.ts`
- Ticket/comment mutation areas identified in `context.md`.
- Existing ticket event schemas are in `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts`.

## Decisions
- V1 is a user-facing operational timeline, not a compliance-grade immutable ledger.
- Timeline UI is unified: comments/internal notes/customer replies and operational events appear together chronologically.
- Comment/internal-note edits are metadata-only in timeline entries; do not store full old/new comment body in audit/activity rows for v1.
- V1 timeline is internal-only for MSP users; client portal continues to show existing public comment-oriented experience.
- Ticket field update events are curated for v1. Meaningful fields are listed in `CURATED_TICKET_FIELDS`.
- Dedicated `ticket_audit_logs` table (not the generic `audit_logs`). Distributed by tenant for Citus.
- Helper accepts explicit tenant so it works inside admin transactions; no `app.current_tenant` GUC dependency.

## 2026-05-25 implementation summary

### Migration
- `server/migrations/20260525231145_create_ticket_audit_logs.cjs` — creates `ticket_audit_logs` with tenant-scoped primary key, FK to tickets, FK to users, and `(tenant, ticket_id, occurred_at, audit_id)` index. Distributes on tenant for Citus.

### Shared library
- `shared/lib/ticketActivity/types.ts` — enum constants (`TICKET_ACTIVITY_EVENT`, `TICKET_ACTIVITY_ACTOR`, `TICKET_ACTIVITY_ENTITY`, `TICKET_ACTIVITY_SOURCE`), `CURATED_TICKET_FIELDS`, and TS interfaces.
- `shared/lib/ticketActivity/writeTicketActivity.ts` — `writeTicketActivity(knex, input)` insert helper with explicit-tenant requirement.
- `shared/lib/ticketActivity/curatedTicketDiff.ts` — `buildCuratedTicketDiff` and `buildCuratedTicketDiffWithLabels`.
- `shared/lib/ticketActivity/readTicketActivity.ts` — `readTicketActivity` and `buildUnifiedTicketTimeline`.
- `shared/lib/ticketActivity/index.ts` — public surface barrel.
- `shared/tsup.config.ts` and `shared/package.json` updated with the new entry points.

### Integration points wired
- Ticket create (`packages/tickets/src/actions/ticketActions.ts::addTicket`).
- Ticket update (`packages/tickets/src/actions/optimizedTicketActions.ts::updateTicketWithCache`) — selects most specific event type from curated diff (CLOSED / REOPENED / STATUS_CHANGED / PRIORITY_CHANGED / ASSIGNED / UNASSIGNED / BOARD_MOVED / RESPONSE_STATE_CHANGED / UPDATED).
- Comment add (both MSP-side `addTicketCommentWithCache` and server-action `createComment`) — picks event by visibility + responseSource (INTERNAL_NOTE_ADDED / CUSTOMER_REPLIED / MESSAGE_ADDED).
- Comment edit (`commentActions.updateComment`) — metadata-only, no body stored.
- Inbound email ticket create (`shared/workflow/actions/emailWorkflowActions.ts::createTicketFromEmail`) — emits CREATED + INBOUND_EMAIL_RECEIVED with safe email metadata.
- Inbound email comment create (`createCommentFromEmail`) — emits CUSTOMER_REPLIED or COMMENT_ADDED with safe metadata.
- Inbound reply reopen (`shared/services/email/processInboundEmailInApp.ts::applyInboundReplyReopenTransition`) — emits REOPENED with reopen_trigger=inbound_email_reply.
- Bundle reopen (`packages/tickets/src/actions/ticketBundleUtils.ts::maybeReopenBundleMasterFromChildReply`) — emits BUNDLE_REOPENED on master with child reference.
- REST API ticket create + update (`server/src/lib/api/services/TicketService.ts::createTicket` and `update`) — curated diff for updates, CREATED for creates with source=api.
- Document attach/remove (`TicketService.uploadTicketDocument` and `deleteTicketDocument`).

### Read + UI
- `packages/tickets/src/actions/ticketActivityActions.ts` — `getTicketTimelineEntries` and `getTicketActivityRows` server actions; both enforce internal `ticket:read` permission and explicitly reject `user_type === 'client'`.
- `packages/tickets/src/components/ticket/TicketActivityTimeline.tsx` — internal-only unified timeline component (Alga UI components, unique IDs).
- `packages/tickets/src/components/ticket/TicketConversation.tsx` — added an "Activity" tab (id `activity`) that is shown only in MSP context; client portal tab list excludes it.

### Docs + tests
- `ee/docs/plans/2026-05-25-ticket-audit-logs/conventions.md` — conventions and safe metadata rules.
- `server/src/test/unit/ticketActivityCuratedDiff.test.ts` — unit tests for curated diff (no-op skip, label resolution, non-curated field filtering, null handling, date normalization).
- `server/src/test/integration/ticketActivityLog.integration.test.ts` — DB-backed coverage for migration shape, helper write inside normal transaction, helper write without GUC, ordering, tenant isolation, empty timeline, unified merge.

## Open / deferred
- REST endpoint surface for timeline read (not in v1; only server action + UI).
- Bundle child→master reopen test is not yet added (covered indirectly by the bundle reopen activity wiring).
- Playwright UI smoke test for the Activity tab not yet added.
