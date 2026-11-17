# Scratchpad — Microsoft calendar subscription renewal

PSA ticket: alga-2026-0003322. Found during alga-2026-0003151.

## Research (2026-11-16)

- Stub: `ee/temporal-workflows/src/activities/calendar-webhook-maintenance-activities.ts`, since commit 997bf033dc (2025-12-12). Logs a warning, returns `[]`. It was the only "not implemented ... server-free build" stub found under `ee/temporal-workflows/src`.
- Legacy schedule: `ee/temporal-workflows/src/schedules/setupSchedules.ts` about lines 434-451, id `calendar-webhook-maintenance-schedule`, every 30m, `lookAheadMinutes: 180`, `EMAIL_WORKFLOW_TASK_QUEUE`. `deleteScheduleIfExists(client, 'premium-trial-expiry-schedule')` in the same file is the retirement pattern.
- Exports to remove: `workflows/index.ts:13`, `workflows/non-authored-index.ts:13`, `activities/index.ts:16`, `activities/non-authored-index.ts:17`, `client.ts:3` and `:266-273`.
- Real handler chain: `server/src/lib/jobs/registerAllHandlers.ts` (about line 672, name list about line 1054) -> `packages/jobs/src/lib/handlers/calendarWebhookMaintenanceHandler.ts` (CE-safe delegator, lazy-loads EE) -> `ee/packages/calendar/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts` -> `CalendarWebhookMaintenanceService.renewMicrosoftWebhooks({ tenantId, lookAheadMinutes })`.
- Fan-out: `packages/types/src/constants/maintenanceFanoutSchedules.ts` (`verify-google-calendar-pubsub` at `15 * * * *`), `packages/jobs/src/lib/maintenanceJobFanout.ts` (`MAINTENANCE_JOBS`, `TenantSelector`, `tenantsWithInboundEmail` as the selector pattern). `defineJob` in `packages/jobs/src/lib/jobDescriptors.ts` registers schedule and job together; names must not collide with native ones.
- Candidates (`findRenewalCandidates`): active Microsoft providers where `webhook_expires_at` is null or within the look-ahead, or `webhook_subscription_id` is null. Providers in status `error` are still candidates as long as `is_active`.
- `processCandidate`: no subscription id -> `registerWebhookSubscription`; else `renewWebhookSubscription` (PATCH), not-found -> `recreateSubscription`. Writes `calendar_provider_health`; sets provider status `error` after 3 consecutive failures. `analytics` is a hard-coded `null`.
- `MicrosoftCalendarAdapter` about lines 573-720: registration uses `getWebhookBaseUrl`, 60h expiry, resource `<calendarBase>/events`. `fetchDeltaChanges(deltaLink?)` about line 724.
- Delta sync today: inline in `CalendarWebhookProcessor.processMicrosoftWebhook` about lines 400-430 (reads `provider.provider_config.deltaLink`, resets when `resetRequired`). Nothing runs it on recreate, so the gap is only closed by the next notification.
- Tests that will need touching: `server/src/test/unit/maintenanceJobFanout.unit.test.ts` (mocks the handler module about line 50), `packages/jobs/src/lib/jobDescriptors.test.ts`, `server/src/test/unit/jobs/calendarWebhookMaintenanceHandler.delegator.test.ts`, `server/src/test/unit/jobs/ceMaintenanceSchedules.unit.test.ts:117` (asserts CE catalog lacks the job; keep).
- Docs: `docs/architecture/job_scheduler.md:155`, `ee/docs/temporal-workflows/job-runner-abstraction.md:255`, `docs/integrations/calendar-sync-operations.md:49`. `docs/plans/2026-10-06-ce-scheduler-cron-cadence-plan.md:262` had already flagged the gap.

## Production evidence (identifiers stripped)

- 40 Microsoft calendar connections, all with `webhook_expires_at` in the past.
- No `calendar_provider_health` renewal attempt after 2026-01-14.
- Outbound push unaffected; Google unaffected.

## Decisions

- Renewal belongs on the server-side maintenance fan-out, not in the Temporal worker, because the worker cannot load the calendar domain graph (the reason the activity was stubbed).
- Catch-up sync is part of this fix: recreating without it leaves the user's data silently stale.

## Unconfirmed

- Whether the legacy schedule still fires in production (stub warning not found in a 2h log sample).
- The four renewal attempts on 2026-01-13/14.

## Implementation notes (2026-11-16)

- Mechanism chosen: a `MAINTENANCE_FANOUT_SCHEDULES` row (`*/30 * * * *`) plus a `MAINTENANCE_JOBS` entry with a `TenantSelector`, not `defineJob`. `defineJob` does not collide with the name (the job is in neither the native fan-out map nor the native schedule catalog), but a `defineJob` row is only visible to a scheduler in the process that registered it, and the Temporal worker cannot load the server's job graph. The worker reads the static catalog, as it does for `verify-google-calendar-pubsub`.
- Selector: `tenantsWithActiveCalendarProvider(type)` over `calendar_providers (provider_type, is_active)`. Applied to Microsoft and, being the same shape, to Google.
- Delta sync: `ee/packages/calendar/src/lib/services/calendar/MicrosoftDeltaSyncService.ts` is the one operation. `CalendarWebhookProcessor.processMicrosoftWebhook` passes its notification-derived changes as `additionalChanges`. `CalendarWebhookMaintenanceService` calls it only after a recreate, on a provider reloaded from the database. A catch-up failure does not undo the recreate; the stored `deltaLink` only advances after a successful fetch, so the next notification replays the gap.
- `isResourceNotFoundError`: HTTP 404 or Graph code `ResourceNotFound` only.
- Duplicate entries under concurrency: `calendar_event_mappings` has a unique index on `(tenant, external_event_id, calendar_provider_id)`; the schedule entry and mapping are written in one transaction, so the loser of a race rolls back and retries as an update. Asserted at the schema level in `microsoftSubscriptionRenewal.integration.test.ts`; a concurrent run of the real `CalendarSyncService` was not exercised.
- Stale copies: `server/src/services/calendar/*` and `packages/integrations/src/services/calendar/*` hold older copies of the processor and maintenance service. They are not on the EE path and were not changed.
- Parity test exemption list (`maintenanceJobFanout.unit.test.ts`): every name `getAvailableJobHandlers()` returns for EE must be in the EE catalog or in `NOT_AN_EE_MAINTENANCE_JOB` with a reason.

## F010 result: other silent no-op stubs under `ee/temporal-workflows/src`

Scanned for "not implemented", "server-free", "stub", warn-and-return and empty-result patterns, and read the other changes in commit 997bf033dc (`job-activities.ts`, `portal-domain-activities.ts`, `generic-job-workflow.ts`).

- `calendar-webhook-maintenance-activities.ts`: the only silent stub left by 997bf033dc. Deleted.
- `services/email-service.ts` (`AWS SES`, `SendGrid`, `SMTP` "integration not implemented"): throw, so they fail loudly. Not from 997bf033dc.
- `db/product-upgrade-operations.ts` ("Stripe product swap is not implemented; refusing to continue"): refuses loudly by design.
- `typings/notifications/.../internalNotificationActions.ts`: was a throwing stub, already replaced by a working implementation (907702138d).
- `job-activities.ts`: 997bf033dc replaced the full server handler registry with a small map. A name that is not registered returns `{ success: false, error: 'No handler registered' }` instead of doing nothing, and the recurring server jobs are forwarded to the server explicitly. No recurring job found that silently does nothing.
- `return []` / `return {}` hits in `portal-domain-activities.ts`, `entra-sync-activities.ts` and others are input-parsing defaults, not stubs.

Result: nothing else to fix or ticket.
