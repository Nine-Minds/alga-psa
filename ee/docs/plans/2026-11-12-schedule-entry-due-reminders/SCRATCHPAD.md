# Scratchpad — Schedule entry due reminders

Research done against main @ 2da15f2be2 (2026-11-12). Paths are repo-relative.

## Decisions

- **Polling scan + delivery ledger, not one timer job per reminder.** `IJobRunner.scheduleJobAt` (packages/jobs/src/lib/jobs/interfaces/IJobRunner.ts:132) fires exactly on both CE and EE, and scheduled comments use it with reschedule/cancel (packages/tickets/src/actions/comment-actions/commentActions.ts:930-975). It does not fit here:
  - Neither backend cancels or replaces by key. pg-boss `scheduleJobAt` ignores `singletonKey` (server/src/lib/jobs/runners/PgBossJobRunner.ts:303-307); Temporal ids are `job-<name>-<jobId>` (TemporalJobRunner.ts:228).
  - Temporal `scheduleJobAt` sets `workflowExecutionTimeout: '1h'` next to `startDelay` (TemporalJobRunner.ts:243-244). Unverified whether the delay counts against it.
  - About fifteen write paths change schedule entries without any SCHEDULE_ENTRY_* event (list below). Per-reminder timers would need all of them hooked.
  - Recurring occurrences are virtual (computed at read time), so they can't be armed ahead indefinitely.
  Reading tables at fire time avoids all of that. Cost is ≤60 s latency, acceptable for reminders.
- **Ledger uses the shared delivery claim protocol** (shared/lib/deliveryLedger.ts): a new ledger table, not a new protocol.
- **One notification, existing fan-out.** `createNotificationFromTemplateInternal` (packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts:94-184) registers after-commit: NOTIFICATION_SENT, `broadcastNotification` (realtime + Teams), and post-creation hooks (push). Must run in the server process. The Temporal worker's typings shim only inserts the row (ee/temporal-workflows/src/typings/notifications/actions/internal-notification-actions/internalNotificationActions.ts:9-33).
- **Lead preference on the server** (`user_preferences`), replacing the device-only preference (ee/mobile/src/settings/notificationPreferences.ts:10-45).
- **Work-item descriptor** as one shared resolver: there is no schedule link helper today, and the search indexer links to a route that does not exist (packages/search/src/indexers/schedule_entry.ts:36 → `/msp/schedule/{entry_id}`).
- **Teams off by default:** a new activity type needs a manifest change (ee/packages/microsoft-teams/src/lib/actions/integrations/teamsPackageActions.ts:266-274, TEAMS_PACKAGE_VERSION :134) and each tenant must re-upload. Bot DM needs no re-upload.

## Discoveries

Schedule model
- `schedule_entries` PK (tenant, entry_id); `scheduled_start/end` timestamptz; `status` free text; `is_all_day`; `calendar_id`; `is_private`. Assignees only in `schedule_entry_assignees` (tenant, entry_id, user_id). Both tables are distributed by tenant.
- work_item_type CHECK (20260804120100): project_task, ticket, interaction, ad_hoc, appointment_request, opportunity_step. Ad-hoc entries may have no times (20260605120000).
- Recurrence: master row plus virtual occurrences (shared/models/scheduleEntry.ts:235-379 → shared/utils/recurrenceUtils.ts:263-403). Virtual id `${masterId}_${epochMs}`. SINGLE edits insert a standalone entry and add an exception to the master; FUTURE splits the series.
- Possible bug: the master's own date is only included for all-day series (recurrenceUtils.ts:358, `includeMaster` scheduleEntry.ts:343). Timed series may lose their first occurrence. Open question 5.
- Expansion without `pattern.timeZone` uses server-local `setHours` (recurrenceUtils.ts:292, 360). Only calendar imports set a timezone.
- Done signals: `status` 'closed' (ad-hoc done), 'completed'/'cancelled' (workflow actions). Pending appointment requests have status 'scheduled' and title "[Pending Request]"; check `appointment_requests.status`.
- Interactions: `createInteractionScheduleEntry` (packages/clients/src/actions/interactionCreateHelper.ts:319-367) sets work_item_type 'interaction', work_item_id = interaction_id, status 'scheduled'. Completing an interaction does not touch the entry. The interaction's done state is `statuses.is_closed` via `interactions.status_id`. No interaction detail route exists; link via `interactions.ticket_id`.
- Timezone: `resolveEffectiveTimeZone` (packages/db/src/lib/workDate.ts:93-117). Per-recipient formatting precedent: server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts:2973-2992, 3043.
- Private entries: assignees always see full details (packages/scheduling/src/lib/calendarAccess.ts:259-306).

Write paths that publish no SCHEDULE_ENTRY_* event
- Interaction edit/delete (interactionCreateHelper.ts:374-415)
- Ad-hoc activities (packages/user-activities/src/actions/adHocActivityCore.ts)
- activityStatusActions.ts
- Client portal appointment requests (packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts)
- Workflow runtime scheduling actions (shared/workflow/runtime/actions/businessOperations/scheduling.ts)
- workItemActions.ts `createWorkItem`
- Teams occurrence materialization (onlineMeetingSchedulingActions.ts:376)
- Inbound calendar sync creates/deletes/exceptions (ee/packages/calendar/src/lib/services/calendar/CalendarSyncService.ts)

Job substrate
- Per-minute maintenance fan-out precedent: `recover-comment-publications`, `inbound-email-recovery` (packages/types/src/constants/maintenanceFanoutSchedules.ts). Define with `defineJob({ scope: 'tenant', schedule: { cron } })` (packages/jobs/src/lib/jobDescriptors.ts). Do not add another per-tenant pg-boss cron (LEVERAGE ce-per-tenant-runner-schedules, server/src/lib/jobs/initializeScheduledJobs.ts:92).
- EE maintenance runs come back to the server as MAINTENANCE_JOB_REQUESTED (server/src/lib/eventBus/subscribers/maintenanceJobSubscriber.ts), so after-commit hooks fire in-process.
- Tenant selectors: packages/jobs/src/lib/maintenanceJobFanout.ts:83-141.
- Date triggers (packages/jobs/src/lib/dateTriggers, dateTriggerScanHandler.ts) have the same source + emission-ledger shape at day granularity, consumed by the workflow launcher. Candidate for unification if a "starting soon" workflow trigger is wanted later.

Notifications
- Catalog: server/migrations/utils/templates/internal/categoriesAndSubtypes.cjs; template files per domain; `_shared/upsertInternalTemplates.cjs`. Example migration: 20260922200100_add_calendar_share_internal_notification.cjs. Default priorities: 20260811120000_add_notification_priorities.cjs. Dev seed: server/seeds/dev/87_internal_notification_templates.cjs. Locale parity test: server/src/test/unit/migrations/templateLocaleParity.test.ts (9 locales).
- Enablement order: tenant subtype → tenant category → user subtype → user category → tenant default (createNotificationCore.ts:144-209).
- Realtime signal is content-free `notifications.changed` (hocuspocus/NotificationExtension.js). Hook useInternalNotifications.ts refreshes on it. The toast must diff the refreshed list.
- No web toast exists for new notifications today.
- Schedule page only reads `?requestId=` (packages/scheduling/src/components/schedule/SchedulePage.tsx:24-25).

Push / mobile
- Dispatcher allowlists: server/src/lib/pushNotifications/pushNotificationDispatcher.ts:5-30; `resolvePushTarget` :85-100.
- Mobile routing already handles `kind:'schedule-reminder'` with workItemType/workItemId (ee/mobile/src/notifications/notificationRouting.ts:13-58, reminderTarget.ts).
- Gotcha: the foreground listener navigates immediately on top-level `ticketId`/`taskId` (ee/mobile/src/notifications/useNotifications.ts:156-162). Keep them out of the reminder payload.
- Push token rows store `app_version` but `getActivePushTokensForUser` does not select it (pushTokenService.ts:94). Re-registration happens at most every 24 h, so app_version can lag a day after an upgrade.
- Local reminders: cap 48 (iOS 64 pending limit), 2-week sync window, resync on login, resume (hourly), Schedule tab, booking, settings change. Logout does not cancel them (app/AppRoot.tsx:336-345).

Teams
- Category list is duplicated in nine places: ee/packages/microsoft-teams/src/lib/teams/teamsShared.ts:15; packages/integrations/src/actions/integrations/teamsShared.ts:16; packages/notifications/src/realtime/teamsNotificationDelivery.ts:15; packages/ee/src/lib/notifications/teamsNotificationDelivery.ts:3; packages/ee/src/lib/actions/integrations/teamsActions.ts:13; TeamsIntegrationSettings.tsx:74; TeamsDeliveryLogViewer.tsx:17; registerTeamsWorkflowActions.ts:17,152; teamsWorkflowRuntimeSupport.ts:14.
- Classification: `classifyTeamsNotificationCategory` (teamsNotificationDelivery.ts:190-218). Unclassified → skipped `unsupported_category`. Missing link → skipped.
- Deep links: teamsDeepLinks.ts:70-111. Unknown URLs fall back to My Work.

## Out-of-scope bugs found

- activityStatusActions.ts:590-595 writes `assigned_user_ids`, a column that does not exist.
- SINGLE-occurrence edits publish UPDATED for the virtual id and no CREATED for the new standalone entry.
- `IWorkItem` types list `non_billable_category`, which the DB CHECK does not allow.
- Dead copies of CalendarSyncService: packages/integrations/src/services/calendar/ and server/src/services/calendar/.

## Commands

- Validate plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-11-12-schedule-entry-due-reminders`
