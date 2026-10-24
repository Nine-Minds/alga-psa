# Asset maintenance workflows

Asset maintenance uses a **plan** (`asset_maintenance_schedules`) and individual
**occurrences** (`asset_maintenance_occurrences`). Workflow actions operate on
these same records and use the same lifecycle operations as the Maintenance UI.

## Actions

| Action ID | Purpose |
| --- | --- |
| `assets.get_maintenance` | Get a plan and occurrence using exactly one of `schedule_id`, `occurrence_id`, or linked `ticket_id`. |
| `assets.create_maintenance_ticket` | Create a ticket for an open occurrence and link it atomically. Requires `occurrence_id`, `board_id`, an open `status_id` on that board, and `priority_id`. |
| `assets.complete_maintenance` | Complete an occurrence, write history, and create the next occurrence. Accepts `performed_at`, `notes`, and structured `maintenance_data`. |
| `assets.skip_maintenance` | Skip an occurrence with a required `reason` and create the next occurrence. |
| `assets.set_maintenance_paused` | Pause (`paused: true`) or resume (`paused: false`) a plan using its `schedule_id`. |

The lookup returns `found`, `schedule`, and `occurrence`. Looking up a plan may
return a null occurrence if none is open. An unrelated ticket returns
`found: false` and null records by default; set `on_not_found: error` to fail
instead. If multiple occurrences reference a ticket, the lookup fails explicitly:
use an occurrence ID rather than completing an arbitrary occurrence.

Ticket creation defaults its title to the plan name and derives the client from
the asset. The action uses the normal shared ticket-creation service, including
events and asset associations, then the same linking operation used by
`createOccurrenceTicket` in the UI. The occurrence and plan are locked for the
transaction. A retry returns the existing linked ticket with
`already_linked: true`, rather than creating another ticket. Customer creation
notifications are suppressed; internal notifications and workflow events remain
enabled. Additional assignment or comments can use the existing ticket actions.

## Due maintenance to linked ticket

1. Select the `asset.maintenance_due` date-trigger source.
2. Map the trigger's occurrence ID to `assets.get_maintenance.occurrence_id` if
   plan information is needed for subsequent conditions or fields.
3. Add **Create Asset Maintenance Ticket**, mapping that occurrence ID and
   selecting a board, open status, and priority.
4. Use the returned `ticket_id` for any ticket-assignment or comment actions.

## Closed ticket to completed maintenance

Closing a ticket does **not** automatically complete maintenance. Configure a
second workflow explicitly:

1. Trigger on `TICKET_CLOSED`.
2. Pass the event's `ticketId` to **Get Asset Maintenance** (`ticket_id`).
3. Continue only when `found` is true and `occurrence.status` is `open`.
4. Pass `occurrence.occurrence_id` to **Complete Asset Maintenance**.
5. Optionally map the event's `closedAt` to `performed_at`. Existing
   `tickets.find` can provide ticket details for `notes` or `maintenance_data`.

The lookup also finds tickets linked manually through the Maintenance UI.
Completion records the workflow actor as the performer. The performed date is
stored as a calendar date at UTC midnight, matching the UI; the next due date is
based on the actual performed date, not the old due date. Monthly/yearly cadence
clamps at month end. Unsupported custom recurrence fails without closing the
occurrence.

Completion returns the completed `occurrence_id`, `history_id`, and
`next_occurrence`. A duplicate completion returns `already_completed: true`
and a null `next_occurrence`, without writing history or advancing again.
Skipping has analogous `already_skipped` behavior. An occurrence closed in a
different state cannot be completed or skipped.

Skipping advances from the current time and does not record performed
maintenance. Pausing cancels the open occurrence but does not close its linked
ticket. Resuming creates an open occurrence at the plan's stored next due date;
it does not reopen a cancelled occurrence. Completing or skipping inactive or
archived plans fails.

## Permissions and transactions

Actions run as the workflow's resolved internal actor. Lookup requires
`asset:read`; ticket lookup also requires `ticket:read`. Mutations require
`asset:read` and `asset:update`. Ticket creation additionally requires
`ticket:create` and `ticket:read`. Asset relationship/bundle read restrictions
are evaluated for the specific asset, and all queries use tenant scoping.

Mutations and workflow audit entries share one transaction. Ticket events are
published after commit, so downstream workflows see the occurrence link.
The actions do not call session-bound server actions or perform Next.js UI
cache invalidation.
