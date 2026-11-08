# API Changelog

Notable, externally visible changes to the Alga PSA REST API, newest first.

## 2026-11-08 — Ticket priority must match the board's priority type

**Affected endpoints:** `POST /api/v1/tickets`, `PUT /api/v1/tickets/{id}`, `POST /api/v1/tickets/from-asset`

Each board uses either ITIL priorities or custom priorities (its `priority_type`). The API previously accepted any priority on any board, so integrations could create tickets whose priority the board's UI could not display or edit. Ticket writes now validate the priority against the effective board.

**Changes:**

- Creating a ticket with an ITIL priority on a custom-priority board, or a custom priority on an ITIL board, returns `400 VALIDATION_ERROR` on `priority_id`. The message names both, in the form "Priority ‘<priority>’ is an ITIL priority but board ‘<board>’ uses custom priorities" (or the reverse).
- On update, the check runs whenever `board_id` or `priority_id` changes, including an explicit `null`. Moving a ticket to a board of the other type while it keeps an incompatible priority is refused, so send a compatible `priority_id` in the same request. An update that changes neither field, or re-sends the stored values, still succeeds on an older ticket whose pair already mismatches.
- Ticket templates and recurring schedules apply the same rule. A template or schedule whose priority no longer matches its effective board is refused on save, and a recurring occurrence that would generate a mismatched ticket fails instead of creating it.

## 2026-11-08 — Opportunity stage evidence can cite an interaction or document

**Affected endpoint:** `POST /api/v1/opportunities/{id}/evidence`

A qualification declaration can now point at the record that supports it, such as the call where the budget was confirmed or the proposal that was sent, so reviewers can see why a stage was reached.

**Changes:**

- The request body accepts optional `refType` (`interaction` or `document`) and `refId` (UUID). Send both or neither; sending only one returns `400`.
- The cited source must belong to the opportunity: an interaction linked to the deal, or a document attached to it. A source from another deal or tenant returns `400`.
- A citation is context only. It does not advance the opportunity's stage, and omitting it keeps the previous request shape.
- A new declaration replaces the active user declaration for the same checkpoint. If the cited interaction or document is later deleted, the evidence entry stays and is shown as **Source removed** in the app.

## 2026-11-07 — Contracts API: client assignment on create, full CRUD, and assignment routes

**Affected endpoints:** `POST /api/v1/contracts`; new `GET|PUT|PATCH|DELETE /api/v1/contracts/{contractId}`; new `GET|POST /api/v1/contracts/{contractId}/assignments` and `GET|PUT|PATCH|DELETE /api/v1/contracts/{contractId}/assignments/{clientContractId}`

A contract only shows up in **Billing > Client Contracts** when it has a client assignment (a `client_contracts` row). The old `POST /contracts` wrote the contract header alone, so contracts created over REST existed but were invisible in the product. The contracts API now creates contracts the way the UI wizard does and exposes the assignment as its own sub-resource.

**Changes:**

- `POST /contracts` now **requires** `client_id` and `start_date` (missing either returns `400`). In one transaction it writes the contract header, the client assignment, and any contract lines passed in the optional `lines` array (`contract_line_id`, optional `custom_rate`, `display_order`; up to 100). If any line is invalid, nothing is written. The body also accepts the assignment terms the wizard stores: `billing_profile_id`, `renewal_mode` (`none`/`manual`/`auto`), `notice_period_days`, `renewal_term_months`, `use_tenant_renewal_defaults`, the `renewal_ticket_*` and `renewal_due_date_action_policy` settings, and `po_required`/`po_number`/`po_amount`. `start_date` and `end_date` accept a full ISO datetime or a plain `YYYY-MM-DD`.
- `GET /contracts/{contractId}` returns the contract with its assignments and contract lines (`404` if unknown).
- `PUT /contracts/{contractId}` (and its alias `PATCH`) updates header fields only: `contract_name`, `contract_description`, `billing_frequency`, `status`, `is_active`. The body is strict, so sending `client_id` or `owner_client_id` returns `400`; ownership is not editable, matching the UI. The UI's rules apply: a system-managed contract returns `422`, and invoiced or expired restrictions return `409`.
- `DELETE /contracts/{contractId}` returns `204`, or `409` when invoices reference the contract, `422` for a system-managed default contract, and `404` when it does not exist.
- **Assignments:** `POST /contracts/{contractId}/assignments` assigns an existing contract to its owning client (`client_id` defaults to, and must equal, the owner). A second assignment returns `409` with the existing `client_contract_id`. `PUT`/`PATCH` on an assignment updates dates, renewal and PO terms; `is_active: true` activates a draft assignment **and** its contract header, like **Set to Active** in the UI. `DELETE` on an assignment returns `204`, or `409` when invoices reference it (end it with an update instead).
- **HATEOAS links** in contract responses now point at real routes. Links no longer double the path (`/contracts/contracts/{id}`), and no `patch` link is advertised where no PATCH route exists. `/contract-lines` item links also resolve.

**Migration note:** Contracts created through the old API without a client assignment are still invisible in the UI. Repair each one with `POST /api/v1/contracts/{contractId}/assignments` (with a `start_date`); it then appears under **Billing > Client Contracts**. Update any client that relied on `client_id` being the only required field to also send `start_date`.

## 2026-11-03 — Ticket templates over REST (and MCP)

**New endpoints:** `GET|POST /api/v1/tickets/templates`, `GET|PUT|DELETE /api/v1/tickets/templates/{templateId}`, `POST /api/v1/tickets/templates/{templateId}/instantiate`

Ticket templates (title, description, board, category, priority, ITIL values, tags, custom fields and a checklist) were a UI-only feature. They are now readable and writable over REST, and therefore visible to the MCP integration, so an automation can create a template once and apply it instead of creating a ticket and then posting each checklist item.

**Changes:**

- `POST /tickets/templates` takes the template fields plus the whole `checklist` array in one request. `PUT` replaces the template wholesale: omitted fields are reset and the checklist you send replaces the stored items, so read the template, edit it, and send it back. `PUT` also accepts `is_active` to activate or deactivate a template.
- `DELETE` returns `204`. It returns `409` ("Used by N recurring schedules …") while any non-archived recurring schedule still uses the template; deactivate it instead if you want to keep the schedules running.
- `POST /tickets/templates/{templateId}/instantiate` creates one ticket and returns it in the same shape as `POST /tickets`. Body: `client_id` (required), `contact_name_id`, `location_id`, `asset_ids`, `assigned_to`, `status_id`, `due_date`, `suppressContactNotifications`, `suppressInternalNotifications`. The ticket gets the template's tags, custom fields and checklist items and records `created_from_template_id`. Title tokens (`{{client}}`, `{{contact}}`, `{{due_date}}`, `{{month}}`, `{{year}}`) are filled in from the request.
- Templates can now be bound to one client: `client_id` on a template is `null` (every client) or one client UUID. `GET /tickets/templates?client_id=…` returns that client's templates plus the tenant-wide ones, and instantiating a client-bound template for a different client is refused with `400`. Deleting a client deactivates and detaches its templates; merging clients moves them to the surviving client.
- Permissions: `ticket_template:read` to list and read, `create`/`update`/`delete` for the writes, and `ticket:create` plus `ticket_template:read` to instantiate. Internal (MSP) callers only — the endpoints are not part of the client-portal API.

## 2026-10-28 — Duplicate time sheets blocked per user and period

**Affected endpoint:** `POST /api/v1/time-sheets`

A time sheet is now unique per **tenant + effective owner + period**, where the effective owner is `user_id` from the body, or the caller when it is omitted (an explicit `user_id` equal to the caller is the same owner). The rule applies to sheets in every approval status, not only `DRAFT`, and is enforced by a database unique index as well as the endpoint.

**Changes:**

- The first `POST` for an owner and period is unchanged: `201` with the detailed time sheet payload.
- A further `POST` for the same owner and period (including a concurrent loser) creates nothing and returns `409`:
  ```json
  {
    "error": {
      "code": "CONFLICT",
      "message": "A time sheet already exists for this user and period"
    }
  }
  ```
- Previously it created an additional `DRAFT` sheet. Authorization is checked first: a caller without act-on-behalf rights for another `user_id` still gets `403`, never `409`.
- **Client recovery:** `GET /api/v1/time-sheets` filtered by `user_id` and `period_id` (when authorized) returns the existing sheet.
- The existing sheet's id, status, entries, comments and review history are preserved; a rejected duplicate request never resets it to `DRAFT`.

**Migration note:** On upgrade, surplus empty duplicate `DRAFT` sheets (no entries, comments, change requests or submission/approval data) are removed, keeping the sheet with history, or the lowest id when all are empty. If any owner and period holds two or more sheets with history, the migration stops without changing data and lists them for manual reconciliation.

## 2026-10-27 — Asset maintenance schedule request contract corrected

**Affected endpoints:** `POST /api/v1/assets/{id}/maintenance`, `PUT /api/v1/assets/maintenance/{scheduleId}`

Both endpoints previously advertised request fields that do not exist on `asset_maintenance_schedules`, so every create failed with a `500` database error. The request contract now matches the UI and database columns. See [asset-maintenance-schedules.md](asset-maintenance-schedules.md) for the full contract.

**Changes:**

- `POST` now requires `schedule_name`, `maintenance_type`, `frequency`, `frequency_interval`, `schedule_config`, and `next_maintenance`. `description` and `is_active` are optional.
- Field renames: `schedule_type` → `maintenance_type`, `notes` → `description`, `start_date` → `next_maintenance` (stored as supplied, not advanced by the interval). `end_date` and `assigned_to` are removed; `created_by` is taken from the authenticated caller.
- `maintenance_type` gains `corrective`.
- Legacy and unknown fields now return `400 VALIDATION_ERROR` instead of being dropped. On `PUT`, response-only fields (`schedule_id`, `asset_id`, `tenant`, `created_by`, `created_by_name`, `created_at`, `updated_at`, `last_maintenance`, `archived_at`) are accepted and ignored, so a row read from `GET` can be sent back as-is.
- `frequency: "custom"` now has recurrence logic. It requires a rule at `schedule_config.recurrence` (`unit` of `days`/`weeks`/`months`/`years`, multiplied by `frequency_interval`, with optional `weekdays` for weeks or `days_of_month` for months). The rule is validated on `POST`, and on `PUT` against the merged row; a `custom` schedule without a rule returns `400`. Recording maintenance against a `custom` schedule previously failed with a validation error.
- `next_maintenance` must be an ISO 8601 UTC timestamp with a `Z` suffix. Values with a numeric offset (for example `-04:00`) return `400`.
- `POST` creates the schedule, its upcoming notification, and the initial open occurrence (when active) in one transaction. `PUT` changes to `next_maintenance` move the open occurrence and unsent notifications; disabling cancels the open occurrence and re-enabling an unarchived schedule opens one.
- Response objects now expose `schedule_name`, `description`, `maintenance_type`, `created_by`, `archived_at`, and `created_by_name`; `start_date`, `end_date`, `notes`, `assigned_to`, and `assigned_user` are gone.

**Migration note:** Update clients and MCP tools to send the corrected field names. Existing `custom` schedules that have no `schedule_config.recurrence` still cannot be completed; add a rule with `PUT` to make them recur.

## 2026-10-27 — Time sheet create/update fixed; act-on-behalf enforced on create

**Affected endpoints:** `POST /api/v1/time-sheets`, `PUT /api/v1/time-sheets/{id}`

**Changes:**

- API keys/users without act-on-behalf rights can no longer create time sheets for other users. `POST` with a `user_id` other than the caller's now returns `403` unless the caller has `time_sheet:approve` and either `time_sheet:read_all` or manages that user. Creating a time sheet for yourself is unchanged.
- `POST` and `PUT` no longer fail with a database error: they wrote `created_at`/`updated_at` columns that `time_sheets` does not have.

## 2026-10-17 — Time entries resolve contract lines; delete reverses billing usage

**Affected endpoints:** `POST /api/v1/time-entries`, `PUT /api/v1/time-entries/{id}`, `DELETE /api/v1/time-entries/{id}`, `DELETE /api/v1/time-entries/bulk`

Time entries written through the REST API now use the same write path as the UI: billable entries are linked to a contract line, the origin of the link is recorded, and bucket usage is drawn.

**Changes:**

- `POST` and `PUT` accept new optional body fields `contract_line_id` (uuid) and `tax_rate_id` (uuid, nullable). When `contract_line_id` is omitted and exactly one contract line is eligible, it is chosen automatically; with no eligible line the entry is saved unresolved.
- `POST` and `PUT` can now return `400` when the line cannot be chosen:
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "…",
      "details": {
        "reason": "contract_line_ambiguous" | "contract_line_not_eligible",
        "eligible_contract_lines": [{ "contract_line_id": "…", "contract_line_name": "…", "contract_line_type": "…", "contract_id": "…", "contract_name": "…", "has_bucket": true }]
      }
    }
  }
  ```
  Retry with `contract_line_id` set to one of the listed candidates.
- `DELETE /api/v1/time-entries/{id}` and `DELETE /api/v1/time-entries/bulk` now reverse the bucket usage draw and the hour-block burn made by the deleted entry (same as deleting in the UI). Previously they left the usage in place, so bucket totals overstated what was still linked.

**Migration note:** Bucket usage left stale by earlier API deletes is not corrected retroactively.

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
