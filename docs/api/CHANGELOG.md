# API Changelog

Notable, externally visible changes to the Alga PSA REST API, newest first.

## 2026-10-03 — Service category `display_order` now persisted on create/update

**Affected endpoints:** `POST /api/v1/categories/service`, `PUT /api/v1/categories/service/{id}`, `GET /api/v1/categories/service`, `GET /api/v1/categories/service/{id}`

Previously, creating a service category through the REST API always set `display_order` to `0`, regardless of the value supplied. Categories created entirely through the API therefore piled up with the same order value and sorted unpredictably.

**Changes:**

- `POST /api/v1/categories/service` now accepts an optional `display_order` integer (>= 0). When omitted, the new category is appended with `max(display_order) + 1` across the tenant — matching the behavior of the UI. An explicit `0` is honored as provided.
- `PUT /api/v1/categories/service/{id}` now persists `display_order` when supplied. A PUT that omits `display_order` leaves the existing value unchanged.
- `display_order` is present on all read responses for service categories (`GET` collection and single).

**Migration note:** Categories created via the API before this fix all have `display_order = 0`. Their relative order is unaffected by this change — the fix only applies to new creates and explicit updates. If you want to establish a deliberate order for existing categories, PUT each one with the intended `display_order` value.

## 2026-09-18 — Ticket bundle status propagation

**Affected endpoints:** `PUT /api/v1/tickets/{id}`, `PUT /api/v1/tickets/{id}/status`

- Both endpoints now accept an optional boolean `propagateToChildren`.
- `PUT /api/v1/tickets/{id}` and `PUT /api/v1/tickets/{id}/status` now propagate a status change to child tickets when the target is a `sync_updates` bundle master. Previously the REST path performed no propagation; this is a behaviour change for API callers that update such a master's status.
- A status change that crosses the open/closed boundary on a `sync_updates` master with at least one affected child returns `409 CONFLICT` when `propagateToChildren` is omitted. The error body is:
  ```json
  {
    "error": {
      "code": "CONFLICT",
      "message": "…",
      "details": {
        "reason": "bundle_propagation_confirmation_required",
        "crossesBoundary": "close" | "reopen" | null,
        "affectedChildren": [{ "ticket_id": "…", "ticket_number": "…", "title": "…", "is_closed": false }],
        "unaffectedChildren": [{ "ticket_id": "…", "ticket_number": "…", "title": "…", "is_closed": true, "reason": "already_closed" | "independently_closed" | "already_open" }]
      }
    }
  }
  ```
  Retry with `propagateToChildren: true` to close/reopen the affected children with the master, or `false` to change the master only.
- Reopening a master only reopens children that the master's close closed. Children closed independently (before bundling, or added closed) stay closed.
- No backfill: existing bundles have no propagation records, so the first master reopen after this deploy reopens no children via propagation. This is the safe direction — nothing is reopened unexpectedly.
