# PRD — Microsoft calendar subscriptions are renewed on hosted

- Slug: `microsoft-calendar-subscription-renewal`
- Date: `2026-11-16`
- Status: Draft
- PSA ticket: alga-2026-0003322 (found while investigating alga-2026-0003151)

## Summary

On EE (hosted and appliance), nothing renews Microsoft Graph subscriptions for Outlook Calendar providers. A subscription lasts about 60 hours, so changes made in Outlook stop reaching AlgaPSA about three days after a calendar is connected. This plan runs the existing renewal handler as a maintenance fan-out job, retires the dead Temporal path that was supposed to do it, and makes recovery of an expired subscription complete by catching up on the changes missed while it was dead.

## Problem

- `renewMicrosoftCalendarWebhooksActivity` in `ee/temporal-workflows/src/activities/calendar-webhook-maintenance-activities.ts` has been a stub that returns `[]` since commit 997bf033dc (2025-12-12, "decouple temporal workflows from server"). The Temporal schedule `calendar-webhook-maintenance-schedule` (`ee/temporal-workflows/src/schedules/setupSchedules.ts`, every 30 minutes) still starts `calendarWebhookMaintenanceWorkflow`, which calls the stub.
- The real handler exists and is registered on the server as `renew-microsoft-calendar-webhooks` (`server/src/lib/jobs/registerAllHandlers.ts`, delegating through `packages/jobs/src/lib/handlers/calendarWebhookMaintenanceHandler.ts` to `ee/packages/calendar/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts` and `CalendarWebhookMaintenanceService.renewMicrosoftWebhooks`). It is in neither `MAINTENANCE_FANOUT_SCHEDULES` (`packages/types/src/constants/maintenanceFanoutSchedules.ts`) nor `MAINTENANCE_JOBS` (`packages/jobs/src/lib/maintenanceJobFanout.ts`), so nothing runs it. The Google counterpart `verify-google-calendar-pubsub` is in both.
- `docs/plans/2026-10-06-ce-scheduler-cron-cadence-plan.md` already noted that the job is missing from the EE maintenance catalog.
- Evidence from production on 2026-11-16: all 40 Microsoft calendar connections, across every tenant that has one and regardless of which Microsoft app they use, had `microsoft_calendar_provider_config.webhook_expires_at` in the past. `calendar_provider_health` recorded no renewal attempt after 2026-01-14.
- User-visible effect: AlgaPSA to Outlook push keeps working, Outlook to AlgaPSA stops silently. Nothing in the product tells the user.

## Goals

1. Microsoft calendar subscriptions are renewed before they expire on every EE deployment, with no customer action.
2. Subscriptions that are already expired are recreated automatically the first time the job runs, and the changes made in Outlook while the subscription was dead are synced.
3. There is one renewal path. The dead Temporal workflow, activity and schedule are removed, including the schedule that already exists in live Temporal namespaces.
4. A missing or dead schedule for a registered recurring handler is caught by a test, not by a customer.

## Non-goals

- Changing CE scheduling. `packages/types/src/constants/ceMaintenanceSchedules.ts` deliberately omits both calendar jobs because calendar sync is EE; keep that and its test.
- Changing Google calendar maintenance.
- New UI. Provider health already has a status and an error surface; this plan only makes it truthful.
- Reworking how Microsoft calendar apps and consent are set up (separate plan, `2026-11-16-supplied-microsoft-app-calendar`).

## Users and Primary Flows

- An MSP technician with a connected Outlook calendar. They change or create an appointment in Outlook a week after connecting; it appears in AlgaPSA within the normal notification delay.
- An MSP whose calendar was connected before this fix. After deploy, the next job run recreates the subscription and pulls the changes missed since it expired. They do not reconnect.
- An operator. They can see in logs and `calendar_provider_health` that renewal ran, for how many providers, and which failed.

## UX / UI Notes

None. No screen changes.

## Requirements

### Functional Requirements

**Schedule the renewal through the maintenance fan-out**

- Add `renew-microsoft-calendar-webhooks` as a tenant-scoped maintenance job, on a 30 minute cron with the existing 180 minute look-ahead. Use the mechanism the fan-out provides (a `MAINTENANCE_FANOUT_SCHEDULES` row plus a `MAINTENANCE_JOBS` entry, or `defineJob` in `packages/jobs/src/lib/jobDescriptors.ts` if the job name constraint allows it; the name is already a native handler name, so check the collision rule before choosing).
- Narrow the fan-out with a `TenantSelector` to tenants that have an active Microsoft calendar provider (`calendar_providers` with `provider_type = 'microsoft'` and `is_active`), following the `tenantsWithInboundEmail` pattern. Give `verify-google-calendar-pubsub` the equivalent selector for Google only if it is trivially the same shape; otherwise leave it.
- The job is EE-only. In CE the delegator already no-ops; the CE catalog stays unchanged.

**Recover expired subscriptions completely**

- `CalendarWebhookMaintenanceService.processCandidate` already recreates a subscription when there is no subscription id or the renew call answers not-found. Keep that.
- After a subscription is recreated (not after an ordinary renewal), run a catch-up delta sync for that provider so changes made during the gap are applied. Today the delta fetch from the stored `deltaLink` lives inline in `CalendarWebhookProcessor.processMicrosoftWebhook` and only runs when a notification arrives. Extract that into one provider-level "sync Microsoft delta" operation that both the webhook processor and the maintenance service call. The existing reset behaviour when the delta link is invalid must be preserved, since a delta link that has sat for months will often be rejected.
- Tighten `isResourceNotFoundError`: it currently treats any error whose message contains `404` as not-found. Decide on status code and Graph error code (`ResourceNotFound`), so an unrelated error is not turned into a recreate.
- A provider whose refresh token is no longer valid cannot be recovered by the job. It must end in the existing failure path (health row updated, provider status `error` after three consecutive failures) and must not be retried in a tight loop or block other providers in the tenant.

**Retire the dead Temporal path**

- Delete `calendar-webhook-maintenance-workflow.ts`, `calendar-webhook-maintenance-activities.ts`, their exports in `workflows/index.ts`, `workflows/non-authored-index.ts`, `activities/index.ts`, `activities/non-authored-index.ts`, and the start helper in `ee/temporal-workflows/src/client.ts`.
- Remove the schedule creation in `setupSchedules.ts` and delete the live schedule with `deleteScheduleIfExists(client, 'calendar-webhook-maintenance-schedule')`, as is already done for `premium-trial-expiry-schedule`.

**Guard against the same failure again**

- Extend the parity test in the server suite so that every recurring handler name in the registered-handler name list (`registerAllHandlers.ts`) is either in the EE maintenance catalog or in an explicit, commented exemption list. `renew-microsoft-calendar-webhooks` must not be exempt.
- Confirm no other activity under `ee/temporal-workflows/src` is a silent no-op left by 997bf033dc. Research found this stub to be the only "not implemented" one; the implementer re-checks and records the result in the scratchpad.

### Non-functional Requirements

- One provider failing must not fail the tenant's run or the fan-out.
- The job must be safe to run concurrently with an inbound notification for the same provider (the extracted delta sync is the shared path; a duplicate run must not create duplicate schedule entries, which the existing mapping logic already prevents and a test should confirm).
- First run after deploy touches every existing connection at once. Graph calls stay sequential per tenant; fan-out concurrency stays at its default.

## Data / API / Integrations

- No schema change. Uses `calendar_providers`, `microsoft_calendar_provider_config` (`webhook_subscription_id`, `webhook_expires_at`), `calendar_provider_health`, and the provider's stored `deltaLink`.
- Microsoft Graph: `POST /subscriptions`, `PATCH /subscriptions/{id}`, `calendarView/delta` through `MicrosoftCalendarAdapter` (`registerWebhookSubscription`, `renewWebhookSubscription`, `fetchDeltaChanges`).
- Docs to update: `docs/architecture/job_scheduler.md`, `ee/docs/temporal-workflows/job-runner-abstraction.md`, `docs/integrations/calendar-sync-operations.md`.

## Security / Permissions

The job runs as a system maintenance job inside `runWithTenant`; tenant isolation comes from the fan-out and the existing tenant-scoped queries. No new permission.

## Observability

- Keep the handler's per-tenant totals log (renewed, recreated, failed) and add the catch-up result (changes applied) for recreated subscriptions.
- `calendar_provider_health` continues to record each attempt.

## Rollout / Migration

- No data migration. The first run after deploy finds every existing connection as a candidate (all are expired) and recreates them.
- The legacy Temporal schedule is deleted by `setupSchedules` on worker start.
- After deploy, verify in production that `webhook_expires_at` moves into the future for existing connections and that `calendar_provider_health` shows new attempts. Connections whose tokens have been revoked will show as `error` and need the customer to reconnect; count them and decide separately whether to notify.

## Open Questions

- Four renewal attempts were recorded on 2026-01-13/14, a month after the stub commit. Unexplained; possibly a manual run. Not blocking.
- A two hour sample of temporal-worker logs did not contain the stub's warning, so it is not confirmed that the legacy schedule is still firing. The schedule delete is safe either way.
- Whether to tell affected users that Outlook changes made during the gap are now imported. Product decision, not part of this plan.

## Acceptance Criteria (Definition of Done)

- On an EE environment, a Microsoft calendar provider whose subscription expires within the look-ahead is renewed by the scheduled job with no manual action.
- A provider with an expired or missing subscription gets a new subscription and the events changed in Outlook during the gap appear in AlgaPSA after one job run.
- `calendar-webhook-maintenance-schedule` no longer exists in Temporal after the worker starts, and the stub workflow and activity are gone from the codebase.
- The parity test fails if a recurring registered handler has no EE schedule and no exemption.
- CE behaviour and the CE catalog test are unchanged.
