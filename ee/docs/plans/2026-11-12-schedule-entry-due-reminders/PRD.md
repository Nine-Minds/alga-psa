# PRD — Schedule entry due reminders

- Slug: `schedule-entry-due-reminders`
- Date: `2026-11-12`
- Status: Draft
- Source ticket: alga0002339

## Summary

When a schedule entry is about to start, remind each assigned user at the lead times they chose: in AlgaPSA (bell plus a live toast), on their phone (server push), and in Microsoft Teams. The reminder names the work and links straight back to it, which for a ticket interaction is the ticket.

The trigger runs on the server and reads the schedule tables when it fires, so every way an entry is created, moved, reassigned or deleted is covered, including the paths that publish no schedule events today.

## Problem

Technicians make time-bound commitments on tickets: "I'll call you back at 3", "I'll check the backup tomorrow morning", "I'll test once provisioning finishes in an hour". AlgaPSA can already record these as schedule entries. Add to schedule on a ticket interaction books the follow-up on the chosen user's schedule, linked to the interaction and its ticket, and Outlook calendar sync copies it to Outlook when connected.

Nothing brings the commitment back in front of the technician when it comes due:

- The web app never notifies about a schedule entry starting.
- Teams receives only assignment, customer reply, approval, escalation and SLA risk notifications.
- The mobile app schedules on-device reminders, but only for entries it has synced in the last two weeks since it was last opened. The lead time is a device preference the server cannot see, and nothing reaches web or Teams.

The result is that "we owe the next action" work gets parked in a waiting status and relies on memory.

## Goals

1. Every assignee of a timed schedule entry gets one reminder per chosen lead time, at most once, within about a minute of the right moment.
2. Reminders are correct regardless of how the entry was written (UI, REST, workflows, client portal, calendar sync, co-managed, interactions, ad-hoc activities), and follow reschedules, reassignments, deletions, exceptions and recurring occurrences.
3. One reminder, three channels: an internal notification that the existing fan-out delivers to the bell, mobile push and Teams. No channel computes its own reminders.
4. A reminder links to where the work happens: the ticket for ticket entries and for interactions on a ticket, the task, the opportunity, the appointment request, or the entry itself on the schedule.
5. Lead times are a per-user server preference shared by web, mobile and Teams.
6. Mobile users get exactly one reminder per lead time: the app stops scheduling local reminders once the server delivers them.
7. Reminders are suppressed for work that is already done or cancelled.

## Non-goals

- Renaming "Schedule a visit" or the Next visit tile, or adding new interaction types. Interactions already carry the follow-up type (call, email, meeting, etc).
- Outlook or Google calendar placement. Calendar sync already copies every schedule entry to each assignee's connected calendar.
- Email reminders.
- Snooze, acknowledge, or "mark done" actions on the reminder itself.
- Reminders for users who are not assignees (watchers, group calendar viewers, client contacts).
- All-day entries. They have no start time to lead from.
- A workflow trigger for "schedule entry starting soon". The design leaves room for it (see Data / API) but does not ship it.
- Fixing the unrelated write-path bugs found during research (listed in SCRATCHPAD).

## Users and Primary Flows

Personas: MSP technician (assignee), dispatcher/service manager (books work for others), MSP admin (tenant notification and Teams settings).

1. Technician logs a Call interaction on a ticket for 3:00 PM with Add to schedule on. With the default 15-minute lead, at 2:45 PM they get a toast in AlgaPSA (if open), a bell item, a phone push and (if the tenant enabled it) a Teams notification: "Call in 15 min: Confirm VPN access works · Ticket TK-1042". Clicking any of them opens the ticket.
2. Dispatcher schedules a remote session for a technician tomorrow at 9:00. The technician has chosen 60 and 5 minute leads. They get reminders at 8:00 and 8:55.
3. The customer asks to move the call to 4:00 and the dispatcher drags the entry. The 2:45 reminder does not fire. A 3:45 reminder fires instead.
4. The technician closes the interaction before it comes due. No reminder fires.
5. A recurring weekly check-in: each occurrence reminds; a deleted single occurrence does not.
6. Technician opens Profile > Notifications and picks reminder lead times (at start, 5, 10, 15, 30, 60 minutes; several allowed; none turns reminders off). The phone's Settings > Calendar reminders edits the same preference.
7. Admin enables "Schedule reminders" in Teams integration settings and chooses activity feed, bot message, or both.

## UX / UI Notes

- Notification title: "{Work label} {in N min | starting now}: {entry title}". Examples: "Call in 15 min: …", "Visit starting now: …", "Task in 1 hour: …". Body: start time in the recipient's timezone plus the linked record ("Ticket TK-1042 – Reset VPN access"). Interactions use their interaction type as the work label; other entries use the work item type label already shown on the schedule.
- All strings localized in the 9 supported locales (template locale parity test).
- Web live toast: a small toast in the bottom corner with title, body and an Open action that follows the notification link. Uses the existing toast component and appears only for notifications that arrive while the app is open (never for the backlog on page load).
- Profile > Notifications (internal view): a "Schedule reminders" row with a multi-select of lead times, beside the existing category toggle. The category toggle turns reminders off without losing the lead selection.
- Mobile Settings > Calendar reminders: same options, now reading and writing the server preference. When the server does not support it (older server), the screen keeps today's local behaviour and copy.
- Teams settings: a new "Schedule reminders" category checkbox with the usual channel selector, off by default, with a hint that the activity feed channel requires re-uploading the updated Teams app package.
- New schedule deep link `/msp/schedule?entryId={id}[&occurrence={iso}]` opens the schedule at the entry's date and opens the entry. Used for ad-hoc entries and as the fallback link.

## Requirements

### Functional Requirements

Reminder computation
- R1. A reminder is due for (entry occurrence, assignee, lead) when `fire_at = occurrence_start − lead` has passed and the scan has not yet delivered it.
- R2. Eligible entries: `scheduled_start` not null, not all-day, at least one assignee, status not `closed`/`completed`/`cancelled`, and the linked work item is not done (see R6).
- R3. Recurring series are expanded with the shared recurrence engine (`generateOccurrences`) over the scan window, honouring exceptions and holidays exactly as the schedule view does. The ledger key uses the master `entry_id` plus the occurrence start.
- R4. Late delivery: a reminder whose `fire_at` is up to 10 minutes past is still delivered if the occurrence has not started more than 5 minutes ago. Older ones are dropped silently (no backlog burst after an outage).
- R5. Each (entry, occurrence start, user, lead) is delivered at most once, across concurrent scans, retries and both job backends. Moving an entry to a new start creates new keys, so the moved entry reminds again for its new time.
- R6. Work-item done rules: interaction whose status `is_closed`; ticket whose status is closed; project task in a closed status; appointment request not approved; opportunity step completed. Entries whose work item no longer exists are skipped.
- R7. Assignees are read at fire time. A user removed from the entry before `fire_at` is not reminded; a user added is.
- R8. Users who are inactive, or whose reminder preference is empty, or who have the reminder subtype disabled (user or tenant level), get nothing.

Delivery
- R9. A due reminder creates one internal notification per recipient via `createNotificationFromTemplateInternal` in the server process, with template `schedule-entry-reminder`, a link per R11, and metadata `{entryId, occurrenceStart, leadMinutes, workItemType, workItemId, ticketId?}`.
- R10. Existing fan-out delivers it: realtime signal to the bell, mobile push (new `schedule` push target), and Teams (new `schedule_reminder` category).
- R11. Link resolution (one shared work-item descriptor, also used for titles and done-state): ticket → ticket; interaction with ticket → ticket; interaction without ticket → schedule deep link; project_task → task; opportunity_step → opportunity; appointment_request → schedule `?requestId=`; ad_hoc → schedule deep link.
- R12. Push payload: `{kind:'schedule-reminder', entryId, workItemType, workItemId, url}` with no top-level `ticketId` (the foreground listener would navigate immediately). The app's existing reminder routing opens the ticket.
- R13. Push is sent only to devices whose app version understands server reminders (configured minimum version). Older devices keep their local reminders and receive no push for reminders.
- R14. Teams: new category `schedule_reminder` (off by default per tenant), new activity type `scheduleReminderDue` declared in the app manifest with a package version bump, bot DM via adaptive card. Deep link maps ticket links to the ticket tab, others to My Work.
- R15. Web toast for notifications that arrive live, for subtypes whose catalog entry marks them `toast_on_arrival`; the reminder subtype is the first.

Preferences
- R16. Per-user lead preference stored server-side (`user_preferences`, `schedule_reminder_lead_minutes`, JSON array). Allowed values: 0, 5, 10, 15, 30, 60. Default `[15]` when unset.
- R17. New internal notification category `schedule` with subtype `schedule-entry-reminder`, enabled by default, default priority normal; tenant admins can disable it like any other.
- R18. REST: `GET/PUT /api/v1/users/me/schedule-reminder-preferences` returning `{leadMinutes, enabled, serverDelivered: true}`. The mobile app uses a 200 response as the capability signal.

Mobile
- R19. When the server supports reminders, the app reads and writes the server preference, cancels all pending local `schedule-reminder:*` notifications and stops scheduling new ones. Against an older server it keeps today's local behaviour.
- R20. Logout cancels pending local schedule reminders (today it does not).

### Non-functional Requirements

- Firing accuracy: within ~60 seconds of `fire_at` in normal operation (per-minute scan).
- The scan must be cheap for tenants with no upcoming entries: the tenant selector only fans out to tenants that have a timed entry starting within the next 61 minutes plus grace, or an active recurring master.
- Works identically on CE (pg-boss) and EE (Temporal maintenance fan-out). Notifications are created in the server process, never in the Temporal worker (its notification shim skips broadcast, push and Teams).
- Citus: the ledger is tenant-distributed; no multi-shard locking; claims are per-tenant.

## Data / API / Integrations

Mechanism: due-signal scan plus delivery ledger (polling, not one job per reminder).

- A per-minute maintenance job `schedule-reminder-scan` (`defineJob`, `scope: 'tenant'`, cron `* * * * *`, tenant selector as above). Same substrate as `recover-comment-publications`.
- Per tenant: query timed, non-recurring entries with `scheduled_start` in `[now − 5 min, now + 60 min + 10 min]` joined to assignees, plus active recurring masters expanded over the same window. Compute candidates `(entry, occurrence_start, user, lead)` with `fire_at` in `[now − 10 min, now]`, filter by R2/R6/R8, then claim and deliver.
- Ledger table `schedule_entry_reminder_deliveries`: `tenant, entry_id, occurrence_start, user_id, lead_minutes, state, attempts, notification_id, created_at, updated_at`. PK/unique `(tenant, entry_id, occurrence_start, user_id, lead_minutes)`. Distributed by tenant. Uses the existing delivery claim protocol (`shared/lib/deliveryLedger.ts`): claim → create notification → finish `sent`/`failed`. Retention: rows older than 30 days are purged by the same job.
- Why polling over `scheduleJobAt` per reminder: about fifteen write paths change schedule entries without publishing `SCHEDULE_ENTRY_*` events (interaction edit/delete, ad-hoc activities, client portal, workflow runtime, inbound calendar sync, Teams occurrence materialization). A per-reminder timer would need every one of them hooked to re-arm, and recurring occurrences are virtual. Reading the tables at fire time is correct by construction.
- Work-item descriptor: `describeScheduleWorkItems(knex, tenant, items[])` returns `{label, title, link, ticketId?, done}` per item, batched. Used by the reminder scan and the new schedule deep link. It replaces the ad-hoc link building and fixes the search indexer's dead `/msp/schedule/{entry_id}` URL.
- Notification catalog: new category and subtype in `server/migrations/utils/templates/internal/categoriesAndSubtypes.cjs`, a new template file in 9 locales, a migration modelled on `20260922200100_add_calendar_share_internal_notification.cjs`, dev seed update, a `toast_on_arrival` column on `internal_notification_subtypes`.
- Push: `resolvePushTarget` gains a `schedule` kind; `expoPushService` gains `buildScheduleReminderPushMessage`; `getActivePushTokensForUser` selects `app_version` for the R13 gate.
- Teams: one exported category list replacing the nine duplicated copies, plus the new category, activity type, manifest entry and `TEAMS_PACKAGE_VERSION` bump.
- Future (not in scope): the scan could emit a catalogued domain event per due reminder so workflows can trigger on "schedule entry starting in N minutes". The date-trigger engine has the same source-plus-emission-ledger shape at day granularity.

## Security / Permissions

- Only assignees are reminded, and assignees always have full visibility of their entries, including private ones (`evaluateEntryAccess`). No masked content leaks.
- The REST preference endpoint is self-only (`/users/me`).
- Links are permission-checked on open as today. A reminder never includes data the recipient could not read on the linked record.

## Observability

Out of scope beyond the structured logs the scan already gets from the maintenance job framework and the ledger's state column.

## Rollout / Migration

- Migrations: ledger table (distributed), notification category/subtype/templates, `toast_on_arrival` column.
- Default on with a 15-minute lead, matching the mobile default.
- Mobile: ships in the next app release. The server push gate (R13) prevents double reminders for users still on older app versions.
- Teams: off by default. Tenants enable it and re-upload the app package for the activity feed. The bot DM channel works without re-upload.
- Suggested slicing for the breakdown (each lands on main alone): 1) work-item descriptor and schedule `?entryId=` deep link; 2) ledger, scan, catalog, preference storage and in-app notification; 3) web live toast; 4) server push target, version gate, preference REST and mobile adoption; 5) Teams category, activity type and package bump.

## Open Questions

1. Default: on for every user at 15 minutes, or off until a user picks lead times? Plan assumes on.
2. Should ticket entries remind when the ticket is closed? Plan assumes no.
3. Should "starting now" (lead 0) be offered? Plan includes it.
4. Minimum mobile app version for the push gate. Set when the app release is cut.
5. Verify whether timed recurring series lose their first occurrence in `generateOccurrences` (master date only included for all-day series). If so, fix in slice 2, since reminders would inherit the gap.
6. Recurrence expansion without `pattern.timeZone` uses the server's local time. Confirm prod servers run in UTC so reminders match the schedule view.

## Acceptance Criteria (Definition of Done)

- A ticket interaction scheduled with Add to schedule produces a bell notification, a live web toast, a phone push and (when enabled) a Teams notification at each assignee's lead times. Each opens the ticket.
- Rescheduling, reassigning, deleting the entry, deleting one occurrence, or closing the interaction before `fire_at` changes or suppresses reminders accordingly, whichever path made the change.
- No (entry, occurrence, user, lead) is ever delivered twice, including under concurrent scans and retried jobs.
- Mobile on a new app version gets server push only; mobile on an old app version gets local reminders only.
- Lead times set on web are what mobile shows, and vice versa.
- CE and EE both fire within ~60 seconds.
