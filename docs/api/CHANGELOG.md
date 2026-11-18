# API Changelog

Notable, externally visible changes to the Alga PSA REST API, newest first.

## 2026-11-18 — `POST /api/v1/tickets` applies board default user and team

**Affected endpoint:** `POST /api/v1/tickets`

Tickets created over REST used to ignore the board's default assignment and arrived unassigned, while the same board routed Quick Add and inbound-email tickets to its default user or team. Board-default routing now runs once in the shared ticket-creation path, so REST, Quick Add, and inbound email resolve assignment the same way.

**Changes:**

- New optional body field `assigned_team_id` (uuid or `null`). `assigned_to` now also accepts `null`.
- An **omitted** field is filled from the board: omitted `assigned_to` takes the board's default user; the board's default team is applied only when **both** `assigned_to` and `assigned_team_id` are omitted. Applying the default team uses the normal team-assignment semantics: the team lead becomes the primary assignee when none was resolved, and team members are added as additional agents.
- An **explicit** value always wins. A user id or team id is stored as sent. An explicit `null` keeps that field empty, and an explicit `assigned_to` (including `null`) also suppresses the board's default team, so a team lead never replaces the requested assignee.
- Sending only `assigned_team_id` still lets the board's default user fill the omitted `assigned_to`.
- Stale defaults soft-fail: a default user who is no longer a valid assignee, or a default team that no longer exists or has no lead, is skipped and the ticket is still created (`201`).
- Assignment events published after creation carry the persisted assignee.

**Migration note:** Integrations that relied on REST-created tickets landing unassigned on a board with a default assignment must now send `"assigned_to": null` (and, if needed, `"assigned_team_id": null`).

## 2026-11-14 — Recurring ticket definitions over REST (and MCP)

**New endpoints:** `GET|POST /api/v1/tickets/recurring`, `POST /api/v1/tickets/recurring/preview`, `GET|PUT|DELETE /api/v1/tickets/recurring/{definitionId}`, `POST /api/v1/tickets/recurring/{definitionId}/pause`, `POST /api/v1/tickets/recurring/{definitionId}/resume`, `GET /api/v1/tickets/recurring/{definitionId}/upcoming`, `GET /api/v1/tickets/recurring/{definitionId}/occurrences`, `POST /api/v1/tickets/recurring/{definitionId}/clients`, `PUT|DELETE /api/v1/tickets/recurring/{definitionId}/clients/{clientId}`, `POST /api/v1/tickets/recurring/{definitionId}/clients/{clientId}/pause|resume`

Recurring ticket schedules ("definitions") were UI-only. They can now be created, maintained and monitored over REST, and the same 15 operations are registered for the MCP integration, so an automation can set up "renew the APNs certificate every year for these clients" without opening the UI. A definition pairs a ticket template (which supplies the ticket content) with a recurrence rule, timing and a list of clients; one ticket is generated per client per occurrence.

**Changes:**

- `POST /tickets/recurring` creates a definition; `PUT /tickets/recurring/{definitionId}` is a **full replace** (omitted fields return to their defaults). The body is the same contract the UI uses: `name`, `ticket_template_id`, `overrides`, `status_id`, `assigned_to`, `assigned_team_id`, `additional_agent_ids`, `recurrence`, `start_date`, `create_time`, `due_time`, `lead_days`, `non_business_day_policy`, `open_previous_policy`, `notify_client_on_create` and `is_active`.
- `DELETE /tickets/recurring/{definitionId}` **archives** the definition (`204`); there is no unarchive. Writes to an archived definition return `409`.
- `GET /tickets/recurring` lists definitions, filtered by `status` (`active`, `paused`, `archived`, `all`; default `all`) and `search` (name substring), with `page`/`limit` paging.
- `POST /tickets/recurring/{definitionId}/pause` and `/resume` stop and restart generation for the whole schedule; the per-client variants under `/clients/{clientId}/pause|resume` do the same for one client.
- `GET /tickets/recurring/{definitionId}/upcoming` returns the next five due dates plus `definition_status`, so callers can tell that a paused schedule's dates will not actually fire. `POST /tickets/recurring/preview` computes dates for an unsaved draft. Both return five dates, even for a yearly rule, unless the rule ends sooner.
- `GET /tickets/recurring/{definitionId}/occurrences` is the run history: one row per generation attempt, filtered by `status` (`created`, `skipped`, `missed`, `failed`) and `client_id`. An unknown definition returns `404` rather than an empty page.
- Clients: `POST .../clients` adds clients with a `{ "client_ids": [...] }` body (up to 100); `PUT .../clients/{clientId}` sets that client's `overrides`, `contact_id`, `location_id` and `asset_ids`; `DELETE .../clients/{clientId}` removes the client from the schedule but keeps its occurrence history. `{clientId}` is the client's `client_id`; a client that is not on this definition returns `404`, while an unknown client named in the add-clients body returns `400`.
- Permissions: the `recurring_ticket` resource (`read`, `create`, `update`, `delete`; client management uses `update`). Because a definition decides the board, status and assignment of tickets it will create, any write that sets those fields or adds clients is also authorized as `ticket:create` for each affected client before anything is written; a refusal is `403`.

## 2026-11-14 — Documentation links on ticket templates

**Affected endpoints:** `POST /api/v1/tickets/templates`, `GET|PUT /api/v1/tickets/templates/{templateId}`, `POST /api/v1/tickets/templates/{templateId}/instantiate`

Ticket templates can now carry documentation links (for example Hudu articles or runbooks in another system), and every ticket created from the template gets a copy of those links. This applies to tickets from `instantiate`, from recurring schedules, and from the UI.

**Changes:**

- Template bodies accept an optional `links` array (up to 50). Each entry has `system` (a built-in key such as `hudu`, or a custom system key), `external_id`, and optional `realm`, `url` (http/https), `title` and `metadata`. There is no `relationship` field: template links are always copied onto tickets as **reference** links, hidden from the client portal by default. `PUT` replaces the stored list.
- Duplicate links (same `system` and `external_id`) in one template are rejected with `400`.
- Copied links appear in `GET /tickets/{id}/external-links` like any other reference link, and emit `TICKET_EXTERNAL_LINK_ADDED`. Editing the template later does not change links already copied onto existing tickets.
- `hudu` is a new built-in external system. It has no URL template, because each tenant runs its own Hudu host, so a `url` must be supplied.
- Reference links are now unique per ticket rather than per tenant: several tickets (for example every ticket from one recurring schedule) can cite the same external record. Origin and mirror links remain unique per external record across the tenant.

## 2026-11-14 — Row-level denials return 404 and redacted fields are omitted

**Affected endpoints:** project, ticket, quote and asset reads under `/api/v1/projects`, `/api/v1/tickets`, `/api/v1/quotes` and `/api/v1/assets`, including their sub-resources (ticket documents, comments, materials and agents; asset custody, notes, software, RMM data and summary; project links; inventory lookup), list, search, export and stats endpoints, and the records returned by writes.

Previously these endpoints checked whether a record could be read but then returned it whole, ignoring field-level redaction decided by the caller's authorization policy. Responses are now projected through the same authorization decision the UI uses.

**Changes:**

- A single-record read that the caller's policy denies or suppresses for that specific record now returns **`404 Not Found`**, so the response no longer confirms that the record exists. A caller that lacks the RBAC permission altogether still gets `403`. Integrations that treated `403` as "exists but hidden" should handle `404` instead.
- Fields hidden by the policy are left out of the record. Display values derived from a hidden field (for example a name resolved from a hidden ID) are returned as `null`, and nested records are projected with their own rules.
- Lists, search, export and stats apply the projection to each row before paging and aggregation: suppressed rows are not returned and not counted in totals, filters and searches on a hidden field match nothing, and stats omit aggregates computed from hidden fields.

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
