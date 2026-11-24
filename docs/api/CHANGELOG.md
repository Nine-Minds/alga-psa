# API Changelog

Notable, externally visible changes to the Alga PSA REST API, newest first.

## 2026-11-21 — Board team default, Admin team creation and category trees

**Affected endpoints:** `PUT /api/v1/boards/{id}`, `GET /api/v1/boards/{id}`, `POST /api/v1/teams`, `GET /api/v1/categories/ticket/tree`, `GET /api/v1/categories/ticket/tree/{boardId}`, and the role, permission, team and metadata routes

Three REST calls failed for administrator API keys even though the same actions worked in the app.

**Changes:**

- Board update accepts `default_assigned_team_id` (a team id, or `null` to clear it), and board responses return it. The update schema did not accept the field before.
- An API key belonging to an Admin can now create teams. The REST permissions behind the team, role, permission and metadata routes (`team:create`, `role:*`, `permission:*`, `metadata:read`) are now in the permission catalog, and a migration adds them to every tenant's Admin role. Existing custom role grants are left as they are. Keys whose user lacks the permission still get `403`.
- Both category tree routes return `200` with the category hierarchy. The unscoped route returns the tenant's ticket categories, and the `{boardId}` route returns only that board's categories. Both used to fail with `500`.
- If a request hits a database column the server expects but does not have, the response is `500` with `error.code` `INTERNAL_CONFIGURATION` and a fixed message instead of `INTERNAL_ERROR`. Outside production, `error.details` names the table and column.

## 2026-11-20 — Attaching a non-template contract line returns `400`, not `500`

**Affected endpoints:** `POST /api/v1/contracts/{contractId}/contract-lines`, and contract creation that passes lines in the same call

The attach endpoint copies a line that belongs to a contract template onto the contract; it does not move an existing line. Passing the id of an ordinary (non-template) contract line used to fail with an opaque `500`.

**Changes:**

- An existing contract line that is not a contract-template line returns `400 VALIDATION_ERROR`, with a message naming the line id.
- An id that does not exist at all still returns `404`.
- The same translation applies when lines are supplied while creating a contract.

## 2026-11-20 — `POST /api/v1/users/bulk/create` and `PUT /api/v1/users/bulk/deactivate` work as documented

**Affected endpoints:** `POST /api/v1/users/bulk/create`, `PUT /api/v1/users/bulk/deactivate`

Both routes were wired to the single-user handlers. Bulk create validated against the single-user schema, so it created at most one user, and bulk deactivate failed on the literal path segment `bulk`, so it could not be used. Both now have their own handlers and request schemas.

**Changes:**

- Bulk create takes `users` (1–100 single-user create bodies) and optional `options`. A single-user body is rejected with `400`. Omitting `options` gives the same defaults as sending `{}`: `skip_invalid: true`, `send_welcome_email: true`, `force_password_reset: false`, `dry_run: false`.
- The batch runs in one transaction with a savepoint per user. With `skip_invalid: true` a rejected user rolls back only its own rows and is listed in `errors` by `index`; with `skip_invalid: false` the whole batch rolls back. Users created earlier in a batch are visible to later ones.
- `dry_run: true` validates every entry and returns the summary without opening a transaction.
- `force_password_reset` now sets the account's must-change-password preference. `send_welcome_email` now sends each new account a password-setup link after the batch commits, so a mail failure never undoes an account.
- A duplicate email that stops the batch returns `409` (as single-user create does) instead of `500`. A seat-limit refusal still returns `403 LICENSE_LIMIT_REACHED`. Success returns `201` with `total_processed`, `successful`, `failed`, `errors` and `results`.
- New users can no longer be given a role from the other portal, for example an MSP role on a client-portal user. This applies to single and bulk create.
- Bulk deactivate takes `user_ids` (1–100) and `deactivate` (default `true`; `false` reactivates). Reactivating internal users is checked against the seat limit, and an over-limit request fails as a whole.

## 2026-11-19 — Bulk client portal invitations

**New endpoints:** `POST /api/v1/clients/{id}/portal-invitations`, `POST /api/v1/portal-invitations/bulk`

Integrations could only invite one contact at a time. Both endpoints send invitations one by one, so a bad address or a contact the caller may not invite never blocks the rest of the batch.

**Changes:**

- `POST /clients/{id}/portal-invitations` takes `contact_ids` (1–500) or `all_eligible: true` (every active contact of the client with no portal user yet). One is required; `all_eligible` is ignored when `contact_ids` is given. Ids that do not belong to the client in the path are skipped.
- `POST /portal-invitations/bulk` takes `contact_ids` (1–500) across any clients; each contact is authorized against its own client.
- Both require `user:invite`. Explicit ids are checked against the caller's client scope the same way as "all eligible", and a contact outside that scope is reported as not found.
- The response is always `200` with `total`, `sent`, `skipped`, `failed` and a per-contact `results` array (`contact_id`, `email`, `status` of `sent`/`skipped`/`failed`, `invitation_id`, `error_code`, `message`). Skips cover missing or invalid email, an existing portal user, a shared mailbox, or a contact outside the client.
- `400` for an empty target set (`NO_TARGETS_SELECTED`), more than 500 contacts (`BATCH_LIMIT_EXCEEDED`), an invalid payload, or a tenant not configured to send invitations. `403` when the caller lacks `user:invite`.
- Both routes are marked `x-chat-approval-required`, so the AI assistant and MCP clients must get approval before calling them.

## 2026-11-19 — `DELETE /api/v1/contacts/{id}` checks dependencies

**Affected endpoint:** `DELETE /api/v1/contacts/{id}`

The REST delete removed the contact row without the dependency check or the cleanup that the MSP app runs. A contact with a portal user could be deleted, leaving an account that could neither sign in nor be invited again.

**Changes:**

- A contact with dependent records (portal user, tickets, interactions, documents, survey records, asset links and similar) is no longer deleted. The call returns `409 CONFLICT` with `details.code`, `details.dependencies` and `details.alternatives`.
- A successful delete now runs the same cascade as the MSP app: phone numbers, additional email addresses, comments, portal invitations, asset and group links, RMM mapping, notes document and Entra reconciliation entries.
- Portal accounts already orphaned this way are recovered rather than blocked: inviting or creating a portal user for a contact with the same email relinks the existing account to that contact.

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
- Webhook templates are not implemented. `GET /webhooks/templates` returns `200` with an empty list, and `GET /webhooks/templates/{id}` returns `404`. `POST /webhooks/templates`, `PUT` and `DELETE /webhooks/templates/{id}`, and `POST /webhooks/templates/{id}/create` return `501 NOT_IMPLEMENTED`.
- Still `403` for every caller, including Admin: `/api/v1/rbac/permissions`, and endpoints that check the `category`, `country` or `search` permissions. These permissions are not declared yet.

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

## 2026-11-09 — Inbound webhook receiver: `429 evaluator_busy` and mapping limits

**Affected endpoint:** `POST /api/inbound/{tenantSlug}/{webhookSlug}`

The workflow expression engine evaluates inbound webhook idempotency expressions and field mappings. It now has hard resource limits and a shared admission queue, so a flood of requests or one runaway expression can no longer exhaust the server. Senders can see two new receiver responses.

**Changes:**

- **`429` with `Retry-After`.** When every expression slot is busy and the request cannot get one in time, the receiver returns `429` with body `{"error": "evaluator_busy"}`, plus `delivery_id` once the delivery has been recorded. This error is retryable. Senders should wait the number of seconds in `Retry-After` and resend the same payload. A `429` delivery is recorded as failed, so the duplicate check does not block the retry, even when it carries the same idempotency key.
- **Per-delivery mapping budget.** All expression work for one delivery, including idempotency-key extraction and every field mapping, is capped at about 3 seconds of CPU time and 15 seconds of elapsed time. Each single evaluation is also capped (250 ms CPU, 2 s elapsed). A delivery that exceeds a cap returns `400` with `{"error": "mapping_failed"}` and is recorded as a failed delivery. Retrying it does not help; simplify the mapping instead.
- **Expression size limits.** Workflow and mapping expressions are now limited to 8 KB of source, 1,024 syntax nodes, nesting depth 64, 4,096 evaluation steps, 4,096 items for range expressions, 4 MB of intermediate data and 256 KB of output. Expressions over these limits are rejected when a workflow is validated or published. At runtime they fail like any other expression error. The old configurable wall-clock timeout for expressions was removed.

Self-hosted operators can tune the shared admission queue with `WORKFLOW_EVAL_MAX_CONCURRENCY` (default 6, range 1–64) and `WORKFLOW_EVAL_QUEUE_TIMEOUT_MS` (default 2000).

## 2026-11-09 — Quote status can no longer be set with PUT; new cancel command

**Affected endpoints:** `PUT /api/v1/quotes/{id}`, new `POST /api/v1/quotes/{id}/cancel`

`PUT /api/v1/quotes/{id}` used to accept a `status` field. A caller with only `billing:update` could therefore move a quote from `pending_approval` to `approved` or `sent` and skip the `/approve` route, which requires `quotes:approve` and applies the self-approval policy. Quote status is now changed only through the named lifecycle commands, each with its own permission check and activity row.

**Changes:**

- `PUT /quotes/{id}` no longer accepts `status`, and the request body is now strict. A body that contains `status`, or any other unknown field, returns `400 VALIDATION_ERROR` (`unrecognized_keys`) and nothing is written, including the other fields in the same request. This applies to every role. Editable fields such as `title` or `po_number` behave as before.
- To change status, use the command for that transition: `/submit-for-approval`, `/approve`, `/send`, or the new `/cancel`.
- `POST /quotes/{id}/cancel` cancels a quote. It takes an optional `reason` (up to 2000 characters) and requires `billing:update`. A quote can be cancelled from `draft`, `pending_approval`, `approved`, `sent`, `accepted`, `rejected` or `expired`. Cancelling an already-cancelled quote returns `200` and changes nothing. Cancelling a `converted`, `superseded` or `archived` quote returns `409`. A successful cancel records `status_changed` and `cancelled` entries in `GET /quotes/{id}/activities`.

**Migration note:** If an integration cancels quotes with `PUT {"status": "cancelled"}`, switch it to `POST /quotes/{id}/cancel`. Any integration that sends `status` on `PUT` now gets `400`.

## 2026-11-09 — Bulk invoice operations limited to finalize and cancel

**Affected endpoint:** `POST /api/v1/financial/bulk/invoices`

The bulk invoice endpoint now runs each invoice through the same service operation and permission checks as the single-invoice endpoints. Before this change, the bulk path wrote invoice status directly and bypassed those checks.

**Changes:**

- `operation` accepts only `finalize` and `cancel`. Any other value returns `400` before an invoice is processed.
  - `finalize` runs the normal finalize operation and requires `invoice:finalize`.
  - `cancel` voids each invoice through the normal void operation. When an accounting integration is connected, the void also requires `accounting_integrations:remote_mutate`.
- The caller also needs `invoice:update`. `invoice:update` and the operation's permission are checked once, before any invoice in the batch is processed; `accounting_integrations:remote_mutate` is checked per invoice when it is voided.
- `send` was removed. Requests with `operation: "send"`, including those that pass `email_addresses`, now fail validation. Bulk invoice email will return once it uses the same recipient delivery as single invoices. Until then, send invoices one at a time.
- `apply_credit` is still unsupported, because the earlier bulk command reported success without applying credit. Apply credit per invoice with `POST /api/v1/invoices/{id}/credit`.
- `invoice_ids` must contain 1 to 50 IDs. Each invoice is processed independently. Each entry in `results` reports `success` and `error`, plus an `outcome` of `finalized` or `voided` when the operation succeeds.

## 2026-11-09 — Time-sheet status changes through PUT follow the approval rules

**Affected endpoint:** `PUT /api/v1/time-sheets/{id}`

`PUT /time-sheets/{id}` used to write `approval_status` like an ordinary field, so a technician could approve their own time sheet through the API. `approval_status` is now derived state. When a `PUT` carries a different `approval_status`, the change goes through the same transition rules as `/submit`, `/approve` and `/request-changes`, in the same transaction as the other fields.

**Changes:**

- `SUBMITTED` is allowed from `DRAFT` or `CHANGES_REQUESTED`, only by the sheet's owner, and only when the sheet has at least one time entry.
- `APPROVED` is allowed from `SUBMITTED` and requires `time_sheet:approve`. It sets `approved_at` and `approved_by` and approves the sheet's entries.
- `CHANGES_REQUESTED` is allowed from `SUBMITTED` and requires a non-blank `change_reason`. Without one, the request returns `400` before anything is written.
- Any other target status returns `409`. A refused transition returns `403`, `400` or `409` and rolls back every field in the request, not just the status.
- Acting on another user's time sheet requires `time_sheet:manage`, and so does any change to an `APPROVED` sheet. `time_sheet:update` covers only the caller's own sheets. Holding `time_sheet:approve` alone does not allow a status change through `PUT` on someone else's sheet; use `/approve` or `/request-changes` instead.

## 2026-11-08 — Time-sheet write endpoints fixed; submission and approval notes become a history

**Affected endpoints:** `POST /api/v1/time-sheets`, `PUT /api/v1/time-sheets/{id}`, `POST /api/v1/time-sheets/{id}/submit`, `/approve`, `/request-changes`, `/reverse-approval`, `GET /api/v1/time-sheets/{id}`, `/search`, `/export`

The time-sheet submit, approve, request-changes and reverse-approval endpoints wrote `submission_notes` and `approval_notes` columns that do not exist on `time_sheets`, so those steps failed over REST with `500`. (`POST` and `PUT` were already fixed on 2026-10-27.) All of them now persist correctly. Notes written along the way are kept as a per-sheet history instead of a single overwritten field.

**Changes:**

- **Notes history.** `submission_notes` on `/submit`, `approval_notes` on `/approve`, `change_reason` and `detailed_feedback` on `/request-changes`, and `reversal_reason` on `/reverse-approval` are each stored as a separate history entry. `GET /time-sheets/{id}` returns them as a `notes` array. Each entry has `note_id`, `kind` (`submission`, `approval`, `request_changes`, `reverse_approval` or `legacy`), `note`, `detail`, `created_by`, `user_name` and `created_at`. Approval notes, change requests and reversals are also posted as approver comments.
- **Removed fields.** `notes` sent on `POST` or `PUT /time-sheets` is ignored and is no longer returned on a time sheet; `created_at` and `updated_at` are no longer returned either, because the table has no such columns. Existing `time_sheets.notes` values are migrated into the history as `kind: "legacy"`.
- **Guarded status changes.** `/submit` and `PUT` with `approval_status` follow the same lifecycle rules as the UI; see the 2026-11-09 entry for the details.
- **Search** now matches the `query` against the owner name and note history text (`fields=user_name,note`).
- **Export** returns every matching time sheet instead of stopping at 25 rows. Its array filters (`approval_statuses`, `user_ids`, `period_ids`, `fields`) accept repeated keys or comma-separated values, like search.

**Migration note:** Stop sending `notes` on create or update; send `submission_notes` on submit instead. Read the latest reviewer feedback from the `notes` history on `GET /time-sheets/{id}`.

## 2026-11-08 — Ticket API: historical `entered_at` and comment `created_at` for imports

**Affected endpoints:** `POST /api/v1/tickets`, `PUT /api/v1/tickets/{id}`, `PUT /api/v1/tickets/{id}/status`, `POST /api/v1/tickets/{id}/comments`

Migrating ticket history from another PSA used to stamp every imported ticket and comment with the time of the import, and fire the same SLA timers, notifications, webhooks and workflows as live work. The ticket API now accepts the original timestamps and records the data silently as history.

**Changes:**

- `POST /tickets` accepts `entered_at`, an ISO 8601 datetime with an explicit offset (`Z` or `+hh:mm`; date-only values are rejected) that is not in the future. Supplying it marks the ticket as a **historical import**: it is stored with that open date and `source=api_import`, no SLA clock starts, and `TICKET_CREATED` is not published, so no notifications, webhooks or workflows run.
- A historical ticket can be imported already closed with `closed_at` and optional `closed_by` (defaults to the API user). Both require `entered_at`. `closed_at` is required for a closed status, rejected for an open one, and must satisfy `entered_at <= closed_at <= now`. The ticket is stored closed without firing `TICKET_CLOSED`.
- `POST /tickets/{id}/comments` accepts a historical `created_at` (same format rules, not before the ticket's `entered_at`, and for a reply not before its parent comment). The comment keeps that timestamp and publishes nothing: no `TICKET_COMMENT_ADDED`, notifications, webhooks, workflows, SLA first response or response-state change. It cannot be combined with `scheduled_publish_at`, `scheduled_publish_tz`, `cc` or `bcc` (`400`).
- `PUT /tickets/{id}` accepts `entered_at` to correct an existing ticket's open date. The value must not be in the future or later than the ticket's closure or earliest comment. A correction that changes only `entered_at` does not publish `TICKET_UPDATED` or change SLA state; the original creation audit timestamp is kept.
- `closed_at` on `PUT /tickets/{id}/status` is honored when that status change closes the ticket and must not be in the future or before `entered_at`. Unlike a historical create, this still fires `TICKET_CLOSED`; use the notification suppression flags to silence it.
- Historical writes require an internal MSP user with `ticket:create` (tickets) or `ticket:update` (comments and corrections). Client-portal callers get `403`.
- The ticket CSV import uses the same path, so imported tickets get their historical dates at insert time rather than being rewritten afterwards.

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
