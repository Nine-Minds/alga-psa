# PRD — Consistent ticket closure state in API update responses

- Slug: `ticket-status-api-response`
- Date: 2026-09-12
- Status: Draft for implementation handoff
- Tracking: alga-2026-0002374

## Summary

Make ticket update responses reflect the final closure values written by the same transaction. Cover both `PUT /api/v1/tickets/{id}/status` and `PUT /api/v1/tickets/{id}` when a status is changed.

## Problem

The shared `TicketService.update` captures a ticket with `UPDATE ... RETURNING *`, subsequently writes denormalized closure fields, and returns the first snapshot. A successful close can therefore return `is_closed: false` and `closed_at: null` even though a subsequent GET shows a closed ticket. Integrations may retry a successful operation, report false failures, or retain incorrect local state.

## Goals

- Return `status_id`, `is_closed`, `closed_at`, and `closed_by` consistent with the completed update.
- Fix both public PUT paths through their shared service.
- Preserve current status-transition rules, response shape, authorization, and validation.

## Non-goals

No UI changes, schema migration, historical data repair, GET field renaming, event lifecycle redesign, broad closure-policy refactor, or changes to bundling/server-action behavior. Do not add a feature flag or observability project for this correction.

## Users and Primary Flows

API integration developers and automation consumers update a ticket status and immediately use the returned ticket. An open-to-closed transition returns the persisted closure timestamp and actor; reopening returns a false close flag and null closure metadata. Consumers of the general ticket update endpoint receive the same guarantees while updating other supported fields alongside status.

## UX / UI Notes

No visual design is needed. Keep the current success envelope and rendered description fields. Consumers should not need an extra GET to learn whether their update closed the ticket.

## Requirements

### Closure response contract

| Transition | is_closed | closed_at / closed_by |
| --- | --- | --- |
| Open to closed | true | Persisted closure timestamp and acting user |
| Closed to open | false | Both null |
| Closed to another closed status | true | Preserve existing closure timestamp and actor |
| Open to another open status | false | Preserve normal open metadata (null in valid fixtures) |
| Same status, or no status in update | Preserve existing state | Preserve existing metadata |

The response must use the actual stored timestamp, not a separately generated response timestamp. Consistency means the row produced by this transaction; it does not promise a later GET cannot observe a subsequent concurrent update.

### Data / API / Integrations

Implement the correction in `TicketService.update`, which both controllers already call. After all relevant writes, re-read the ticket through `tenantScopedTable(trx, 'tickets', context.tenant)` with `ticket_id: id`, within the existing transaction, and pass that row through `withDescriptionHtml`. Prefer refreshing on an actual status change to avoid an extra read for unrelated updates. If the expected row is missing, fail the transaction rather than silently returning the stale snapshot.

Do not call the public GET service after committing: it changes the read boundary and may return an enriched shape instead of the established update contract. Do not add controller-specific denormalization or reconstruct closure timestamps in memory. Keep the existing database writes and transition predicates unless regression evidence requires a tightly scoped correction.

### Security / Permissions

Retain tenant scoping on the refresh query, API access checks, ticket read/update authorization, board/status validation, and close-rule enforcement. Invalid transitions must still fail without partial ticket writes. Existing event and activity behavior remains intact.

## Validation

Add a DB-backed regression suite exercising the real service against migrated schema, with a happy-path close/reopen sequence and a guard case proving a rejected status update leaves the ticket unchanged. Exercise both controller response paths, either using the DB-backed endpoint harness or focused controller serialization tests alongside the DB suite. Source-string assertions alone are insufficient.

Cover closed-to-closed, same-status, open-to-open, and non-status updates in one representative transition sequence where practical. Compare response metadata to the persisted ticket and GET projection, accounting for timestamp serialization. Confirm the response retains its existing envelope and description fields.

Run the focused new suite and relevant existing status-read/close-rule tests. During the later smoke step, exercise both real PUT endpoints and capture response/GET evidence for closing and reopening. Runtime tests are deferred to implementation; this plan does not claim they passed.

## Risks

A read outside the transaction can observe another update or change the response shape. A separately generated timestamp can differ from storage. Overwriting closure metadata on closed-to-closed or repeated status requests would introduce a behavior regression. Existing triggers may affect returned fields, so real database tests must compare actual stored values. Shared-service changes require both route paths to be verified.

## Rollout / Migration

Ship as a normal API bug fix. No schema changes or backfill are expected because the reported defect is the returned snapshot. Preserve existing public fields, including the distinction between PUT `is_closed` and GET `status_is_closed`.

## Open Questions

No product-scope question blocks this plan. During implementation, confirm the available endpoint test harness and migrated database behavior; use the service DB suite plus controller tests if a full route harness is impractical. A discovered persistence defect beyond this snapshot issue should be documented separately before broadening scope.

## Acceptance Criteria (Definition of Done)

1. Both PUT endpoints return closure state matching their final persisted row on close and reopen.
2. Returned closure timestamps equal stored timestamps, and actors are set/cleared according to the existing transition rules.
3. Closed-to-closed, repeated status, open-to-open, and unrelated updates preserve expected metadata.
4. Tenant scoping, response shape, close-rule rejection, and status validation retain their existing behavior.
5. Focused DB and controller regression coverage passes, and real API smoke evidence is recorded during the smoke assignment.
