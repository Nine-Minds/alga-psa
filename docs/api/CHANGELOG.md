# API Changelog

Notable, externally visible changes to the Alga PSA REST API, newest first.

## 2026-11-15 — Client billing profiles over REST (read-only)

**New endpoints:** `GET /api/v1/clients/{id}/billing-profiles`, `GET /api/v1/clients/{id}/billing-profiles/{profileId}`

Before this, an integration could manage a billing profile's contacts but could not list a client's billing profiles or read their settings. You can now read them, which is also how you discover `billing_profile_id` values. Nothing can be created, updated or deleted through these endpoints, and the client detail response is unchanged.

**Changes:**

- Both endpoints require `client:read`, not a separate billing-profile permission.
- The list includes inactive profiles. The default profile comes first, then the rest by name, then by `billing_profile_id`.
- A profile that belongs to another client returns `404`, never `403`.
- Each profile carries its invoicing settings: bill-to name and location, billing contact and email, tax exemption and certificate, tax ID, PO number and whether a PO is required, invoice delivery method and template, billing cycle, payment terms, preferred payment method, plus `is_default`, `is_system_managed_default`, `is_active` and `bills_separately`. A `null` setting means the profile inherits it from the client; it is returned as stored, not resolved.
- `bill_to_location_name`, `billing_contact_name` and `invoice_template_name` are display names for the matching IDs. Each is `null` when its ID is unset, and `invoice_template_name` is also `null` when the referenced template has since been deleted.

## 2026-11-15 — Admin API keys can call `/meta`, `/roles` and `/webhooks`; webhook calls are tenant-scoped

**Affected endpoints:** `/api/v1/meta/*`, `/api/v1/roles*`, `/api/v1/webhooks*`

These routes checked the permissions `metadata`, `role` and `webhook`, but those permissions did not exist, so every caller got `403`, including an MSP Admin API key. They now exist and are granted by default to the MSP Admin role only. Admin keys get `200`; other roles still get `403` unless you add the permission to them.

**Changes:**

- New permissions: `metadata:read`; `role:read|create|update|delete`; and `webhook:read|create|update|delete|test|trigger|retry|verify|analytics|export|bulk_update|manage_security|manage_subscriptions|system_settings`. A migration adds them to every existing tenant's Admin role. Technician and Manager gain nothing.
- `metadata:read` also exists on co-managed seats, since `/api/v1/meta` is reachable there. The roles and webhooks routes are not available on co-managed seats.
- Every webhook operation is now scoped to the caller's tenant. A webhook ID from another tenant returns `404`. Deleting a webhook removes its deliveries and its signing secret. Before this change, delete did not filter by tenant.
- `GET /webhooks/{id}/deliveries` returns `404` for an unknown webhook. Test sends are recorded as deliveries with `is_test`.
- `PUT /webhooks/{id}` persists only fields that have a column. Event types are stored on the webhook's `event_types`.
- Webhook templates are not implemented. `GET /webhooks/templates` returns `200` with an empty list, and `GET /webhooks/templates/{id}` returns `404`. `POST /webhooks/templates` and `POST /webhooks/templates/{id}/create` return `501 NOT_IMPLEMENTED`.
- Still `403` for every caller, including Admin: `/api/v1/rbac/permissions`, and endpoints that check the `category`, `country` or `search` permissions. These permissions are not declared yet.

## 2026-11-13 — Role floors: every user keeps a role, every tenant keeps an MSP Admin

**Affected endpoints:** `POST /api/v1/users`, `PUT /api/v1/users/{id}` (deactivation), `DELETE /api/v1/users/{id}`, and `POST|PUT|DELETE /api/v1/users/{id}/roles`

A tenant could previously lock itself out by removing roles, deactivating or deleting users until no active MSP Admin was left, or leave a user with zero roles. Two invariants are now enforced on every write path (UI server actions, the shared user and role services, the `User` model and the REST API), checked inside the caller's transaction under a per-tenant advisory lock so concurrent requests cannot race past them:

- **Every interactive user keeps at least one role.** A change that would leave an internal or client user with no roles is refused with `400` (`A user must keep at least one role. …`). This includes a role replacement with an empty `role_ids`.
- **The tenant keeps at least one active internal user with the built-in MSP Admin role.** Removing that role from, deactivating, or deleting the last such user is refused with `409` (`A tenant must keep at least one active MSP Admin user.`). Bulk deactivation counts the other users in the same request as already gone, so deactivating every admin at once is also refused.

**Changes:**

- `role_ids` is now **required** on `POST /api/v1/users` and must contain at least one role id; omitting it or sending `[]` returns `400`. Integrations that created a user and assigned roles in a second call must send the roles on create.
- To change a user's only role, assign the new role first and then remove the old one, or replace the set in one `PUT /users/{id}/roles` call with a non-empty `role_ids`.
- To hand MSP Admin to someone else, grant it to the new admin before removing it from, deactivating, or deleting the old one.

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
