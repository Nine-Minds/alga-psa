# Ticket Activity Conventions

Author: Robert Isaacs · Date: 2026-05-25

This document captures the conventions any new ticket mutation path must follow to participate in the unified ticket activity timeline. It complements `PRD.md`.

## Where to write activity rows

Use the shared helper:

```ts
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
```

Write inside the same transaction as the underlying ticket/comment/document mutation. This keeps activity rows atomically consistent with the data they describe.

```ts
await writeTicketActivity(trx, {
  tenant,
  ticketId,
  eventType: TICKET_ACTIVITY_EVENT.STATUS_CHANGED,
  entityType: TICKET_ACTIVITY_ENTITY.TICKET,
  entityId: ticketId,
  actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: user.user_id },
  source: TICKET_ACTIVITY_SOURCE.UI,
  changes: curatedDiff,
  details: { ...optionalMetadata },
});
```

## Explicit tenant — required

`writeTicketActivity` never reads `app.current_tenant`. This is intentional so it works inside `withAdminTransaction()` paths (inbound email, workflow runner) which do not set the GUC.

If you are tempted to "let the helper figure out tenant," stop and pass it explicitly.

## Field diffs — use the curated helper

For ticket updates, use `buildCuratedTicketDiffWithLabels` (or `buildCuratedTicketDiff` if you already have labels resolved). The helper:

- Returns only the user-meaningful fields listed in `CURATED_TICKET_FIELDS`.
- Skips no-op updates (deep-equal old and new).
- Optionally attaches `oldLabel`/`newLabel` resolved against the relevant lookup table.

If no curated fields changed, the helper returns `{}`. Use `hasCuratedChanges()` and skip the activity write — the UI does not want noise from updates that only touched `updated_at` or internal denormalized flags.

If you need to log a new field, add it to `CURATED_TICKET_FIELDS` (in `shared/lib/ticketActivity/types.ts`). Do not bypass the helper.

## Safe metadata rules

`details` and `changes` are JSONB. They are read by the timeline UI and may be returned through internal APIs. They must NOT contain:

- Raw inbound email bodies (text/html). Store only `messageId`, `threadId`, `from`, `subject`, `provider`, `receivedAt`.
- Full old/new comment body content for edits. Store only edit-metadata (e.g., `{ edited: true, is_internal: false }`).
- Secrets, API tokens, or PII not already visible on the ticket.

Comment edits are metadata-only by design. If a future feature needs body history, it should live in a separate body-snapshot table, not in `ticket_audit_logs`.

## Event-type vocabulary

Use the constants in `TICKET_ACTIVITY_EVENT`. Names mirror the existing domain events in `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts` where one exists. If you need a new event, add it to the constant set rather than inventing strings at call sites; the UI formatter dispatches on these names.

When picking the event for a curated-diff update, prefer the most specific match:

- single status_id change → `TICKET_STATUS_CHANGED` (or `TICKET_CLOSED`/`TICKET_REOPENED` when transitioning the `is_closed` boundary)
- single priority_id → `TICKET_PRIORITY_CHANGED`
- single assigned_to → `TICKET_ASSIGNED` / `TICKET_UNASSIGNED`
- single board_id → `TICKET_BOARD_MOVED`
- single response_state → `TICKET_RESPONSE_STATE_CHANGED`
- multiple curated fields → `TICKET_UPDATED`

## Actor and source

- `actor.actorType` should be the actor classification, not the channel. A request originating from the REST API is `API`; an inbound email parsed to a contact is `EMAIL_SENDER`; a bundle-master reopen triggered by a child reply is `SYSTEM`.
- `source` is the origin channel and is independent of actor type. For example, an inbound-email reply uses `actor=EMAIL_SENDER` and `source=INBOUND_EMAIL`.

## Failure semantics

Activity writes are intended to fail fast inside the surrounding transaction (NFR-03). If you need a path to tolerate write failure as best-effort, wrap your call in `try/catch` and document the reason at the call site. Do not change the helper.

Display-name enrichment failures are best-effort: the helper logs and falls back to the actor's IDs without throwing.

## Read paths

- `readTicketActivity(knex, tenant, ticketId)` — activity rows only, ordered newest-first.
- `buildUnifiedTicketTimeline(knex, tenant, ticketId)` — activity + comments merged chronologically (internal-only in v1; do NOT call from the client portal).
- `getTicketTimelineEntries` (server action) — production entry point used by the MSP UI. Enforces internal `ticket:read` permission and blocks client portal users.

## Generic `audit_logs` is untouched

The legacy `packages/db/src/lib/auditLog.ts` (and its `server/src/lib/logging/auditLog.ts` copy) remain in place and continue to serve RBAC-style logging. Do not consolidate the two in v1. They have different scope, schema, and tenant-context contract than `ticket_audit_logs`.
