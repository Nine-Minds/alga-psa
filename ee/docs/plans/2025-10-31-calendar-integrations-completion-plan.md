# Calendar Integrations Completion Plan

## Purpose & Overview
Stabilize and complete the Google and Microsoft calendar integrations so MSPs can rely on the feature for production scheduling. The current implementation covers large portions of the happy path, but critical defects in OAuth persistence, tenant scoping, webhook processing, and UI compliance prevent real-world use. This plan hardens storage/security, fixes the sync pipeline, wires the event-driven flow, and adds the missing operational guardrails and tests.

---

## Current State Findings *(Completed)*
- **OAuth persistence breaks:** `CalendarProviderService.updateProvider` merges camelCase objects into snake_case tables (`server/src/services/calendar/CalendarProviderService.ts:202`), so OAuth callbacks fail to write client credentials or tokens.
- **Secrets exposed to clients:** `mapDbRowToProvider` returns access/refresh tokens and client secrets to the caller (`CalendarProviderService.ts:364`), and `getCalendarProviders` surfaces that data to the browser (`server/src/lib/actions/calendarActions.ts:90` via `CalendarIntegrationsSettings.tsx`).
- **Tenant authenticity unchecked:** `CalendarProviderService.deleteProvider` and `updateProvider` operate on raw IDs without verifying the caller’s tenant (`CalendarProviderService.ts:234`, `312`).
- **State/nonce unverified:** `initiateCalendarOAuth` issues base64 state blobs but never records or validates them on callback (`server/src/lib/actions/calendarActions.ts:12`), so cross-tenant or replay attacks are possible.
- **Manual sync placeholder:** `syncCalendarProvider` still returns a TODO stub (`calendarActions.ts:378`).
- **Webhook processing lacks tenant context:** `CalendarWebhookProcessor` pulls a random tenant from `createTenantKnex()` and never wraps downstream calls in `runWithTenant` (`CalendarWebhookProcessor.ts:163`), so schedule entry lookups fail.
- **New entry sync is invalid:** `mapExternalEventToScheduleEntry` never sets `work_item_type`, causing `ScheduleEntry.create` to violate the NOT NULL constraint when webhooks create entries (`eventMapping.ts:159`).
- **Event bus plumbing incomplete:** Schedule entry CRUD never publishes the `SCHEDULE_ENTRY_*` events the subscriber expects, so outbound sync is never triggered.
- **Data hygiene gaps:** `fetchUserIdsByEmail` lowercases keys but callers do not (`eventMapping.ts:134`), and `CalendarProviderService.getProviders` only honors `isActive` while the subscriber passes `active` (`CalendarProviderService.ts:60` + `calendarSyncSubscriber.ts:52`).
- **Provider state never advances:** Sync jobs do not update `calendar_providers.last_sync_at` or emit `CALENDAR_SYNC_*`/`CALENDAR_CONFLICT_DETECTED` events.
- **UI non-compliant:** Buttons and interactive elements in `CalendarIntegrationsSettings.tsx` and related forms lack required `id` attributes.
- **Operational safeguards missing:** No background job renews Microsoft webhook subscriptions; Google Pub/Sub provisioning remains manual/document-only; conflict notifications stop at console logs.

---

## Goals & Non-Goals
**Goals**
- Ensure OAuth flows reliably persist credentials, respect tenant boundaries, and keep secrets server-side.
- Make inbound/outbound sync resilient: tenant-aware, conflict-aware, and capable of creating or updating entries end-to-end.
- Deliver production-grade webhook + event bus behavior (including renewal jobs and conflict notifications).
- Align UI with internal standards (ID attributes, error handling) while keeping operators informed of sync status.
- Establish automated test coverage (unit/integration/e2e) and documentation so the feature can ship with confidence.

**Non-Goals**
- Adding new calendar providers beyond Google and Microsoft.
- Building advanced scheduling UX (bulk sync dashboards, multi-calendar UIs) beyond the existing settings surfaces.
- Implementing tenancy-wide scheduling analytics; focus remains on sync correctness and operability.

---

## Phase 1 – Provider Auth & Storage Hardening
- [x] **Fix vendor config updates**: Normalize vendor payloads to snake_case before persistence and remove camelCase keys in `CalendarProviderService.updateProvider` (`server/src/services/calendar/CalendarProviderService.ts`).
- [x] **Stop leaking secrets**:
  - Store access/refresh tokens encrypted via the secret provider or another at-rest mechanism.
  - Update `mapDbRowToProvider` / `getCalendarProviders` to omit sensitive fields; expose token status via derived booleans instead.
- [x] **Enforce tenant ownership**: Require tenant filters on `getProvider`, `updateProvider`, and `deleteProvider`; add guard clauses in `calendarActions` to abort cross-tenant access.
- [x] **Persist & validate OAuth state**: Record nonce+tenant keys (Redis or DB) when `initiateCalendarOAuth` is called; reject callbacks whose state is missing, expired, or mismatched.
- [x] **Confirm redirect URI hygiene**: Centralize redirect URI derivation and ensure it is stored once the provider is connected.

### Deliverables
- Updated provider service with secure storage semantics and tenant guards.
- OAuth callback flow that succeeds end-to-end with secrets left server-side.
- Regression & smoke tests for both providers exercising OAuth + provider creation.

---

## Phase 2 – Core Sync Pipeline Retrofit
- [x] **Tenant scoping**: Wrap webhook handlers, manual sync, and subscriber invocations with `runWithTenant(provider.tenant, ...)` before touching schedule data (`CalendarWebhookProcessor.ts`, `calendarSyncSubscriber.ts`).
- [x] **Complete schedule entry mapping**:
  - Default `work_item_type` to `ad_hoc` (or tenant-configured default) when absent.
  - Normalize attendee emails before lookup; tighten null/undefined guards in `eventMapping.ts`.
- [x] **Provider status updates**: Push `last_sync_at` and connection status via `CalendarProviderService.updateProviderStatus` after successful syncs; emit `CALENDAR_SYNC_STARTED/COMPLETED/FAILED` events.
- [x] **Implement manual sync**: Replace the TODO in `syncCalendarProvider` with batch logic that enumerates recent schedule changes and pushes/pulls events per provider.
- [x] **Repair filtering**: Add an `active` alias (or fix caller) when requesting providers from background jobs (`CalendarProviderService.ts`, `calendarSyncSubscriber.ts`).
- [x] **Conflict event emission**: Raise `CALENDAR_CONFLICT_DETECTED` through the event bus from `CalendarSyncService.detectConflict`, capturing metadata for downstream notifications.

### Deliverables
- Successful manual sync (both directions) verified via integration tests.
- Provider rows reflect current sync status/time after manual or webhook-driven cycles.
- Event bus receives conflict + sync lifecycle events suitable for notifications/metrics.

---

## Phase 3 – Event Bus & Webhook Reliability
- [x] **Publish schedule entry events**: Emit `SCHEDULE_ENTRY_CREATED/UPDATED/DELETED` from schedule entry CRUD paths (`server/src/lib/models/scheduleEntry.ts` or service layer) so outbound sync triggers automatically.
- [x] **Harden subscriber**:
  - Normalize filter usage (`isActive` vs `active`).
  - Ensure log messages include tenant and provider context.
  - Short-circuit on inactive/error providers.
- [x] **Webhook resilience**:
  - Acknowledge and retry logic for Google Pub/Sub + Microsoft Graph failure cases.
  - Persist and reuse sync tokens (Google `syncToken`, Microsoft delta links) instead of re-querying 24h windows.
- [x] **Background jobs**:
  - Implement scheduled renewal for Microsoft webhook subscriptions (~50 hour cadence).
  - Provide tooling/docs (or code paths) to initialize Google Pub/Sub topics/subscriptions per tenant.
- [x] **Conflict notifications**: Wire the emitted conflict events into the notification system (in-app toast, email, or queue hooking) per product decision.

### Deliverables
- Event bus dashboards show schedule entry events flowing; subscriber actions succeed under load.
- Webhook renewer job documented and running (with observability).
- Conflict events surface to users/operators with actionable messaging.

---

## Phase 4 – UI & Operator Experience
- [x] **Bring components into compliance**: Add unique `id` attributes to every interactive element in `CalendarIntegrationsSettings.tsx`, `GoogleCalendarProviderForm.tsx`, `MicrosoftCalendarProviderForm.tsx`, and `CalendarSyncStatusDisplay.tsx`.
- [x] **Surface sync health**: Expand the settings UI to display last sync time, error messages, and manual sync progress (spinners/toasts) using the new backend status fields.
- [x] **Guard destructive actions**: Replace `window.confirm` with the standardized dialog component for provider deletion.
- [x] **Hide secrets**: Ensure provider details render only non-sensitive metadata; add explicit badges for “OAuth complete” or “Action required.”
- [x] **Documentation**: Captured operational onboarding steps in `docs/integrations/calendar-sync-operations.md` (covers OAuth app prerequisites, webhook endpoints, and cron jobs).

### Deliverables
- Calendar settings page passes internal UX/ID lint checks.
- Operators can see sync status, trigger manual sync, and resolve conflicts without developer tooling.
- Up-to-date runbook for onboarding new tenants to calendar sync.

---

## Phase 5 – Testing & Rollout
- [ ] **Unit coverage**: Add tests for vendor config normalizers, event mapping helpers, and webhook processors (including failure branches).
- [ ] **Integration tests**: Simulate full OAuth + sync flows with mocked Google/Microsoft APIs to confirm mapping creation, updates, deletions, and conflict handling.
- [ ] **End-to-end smoke**: Extend Playwright (or Cypress) suites to authorize a provider and validate UI-driven manual sync.
- [ ] **Monitoring & alerts**: Instrument success/error counters for sync events, webhook renewals, and conflict occurrences; hook alerts into the existing observability stack.
- [ ] **Release plan**: Stage rollout (internal tenants → beta tenants → GA), with feature flags toggled once telemetry shows stability.

---

## Release Readiness Acceptance Tests
- **OAuth Connection Flow**
  - Create Google and Microsoft providers via the UI, complete OAuth, and verify provider rows persist encrypted credentials without leaking secrets to the client.
  - Restart the server and confirm providers remain in `connected` state and refresh tokens are valid.
- **Manual Sync Both Directions**
  - Create a schedule entry in Alga, trigger manual sync, and verify the external calendar event appears with correct metadata.
  - Modify an external event and confirm manual sync updates the corresponding schedule entry.
- **Webhook Processing**
  - Receive Google Pub/Sub and Microsoft Graph notifications for create/update/delete and observe tenant-scoped processing, including automatic deletion of local entries when the external event is removed.
  - Force webhook failure scenarios (invalid client state, expired subscription) and confirm retries plus surfaced operator alerts.
- **Conflict Handling**
  - Simultaneously change an event in Alga and the external calendar, ensure conflict detection fires, `CALENDAR_CONFLICT_DETECTED` is emitted, the mapping is marked `conflict`, and the user sees a notification with resolution options.
- **Provider Lifecycle & Security**
  - Delete a provider and validate vendor configs, event mappings, and webhooks are removed while external events remain untouched.
  - Attempt cross-tenant access to provider IDs or OAuth callbacks and confirm permission denials with audit logs.
- **UI Compliance & UX**
  - Run automated checks asserting every interactive element has a unique `id` and that sync status, last sync timestamps, and error messages render correctly.
  - Validate the manual sync button displays progress feedback and disables while work is in-flight.
- **Background Jobs**
  - Advance time to validate Microsoft webhook renewal runs at the expected cadence and logs renewal outcomes.
  - Confirm cron failures emit alerts and do not silently disable webhooks.
- **Telemetry & Observability**
  - Trigger successful and failed syncs/webhook renewals and confirm metrics, logs, and alerts reach the observability stack with provider/tenant dimensions.
- **Regression / Multi-Tenant Isolation**
  - Run automated integration tests across two tenants to ensure no external events or schedule entries bleed between tenants during syncs.

### Exit Criteria
- All automated suites green (unit/integration/e2e) for calendar sync domains.
- Observability dashboards in place with alert thresholds agreed upon by ops.
- Product sign-off after beta tenants complete validation without data loss.

---

## Dependencies & Coordination
- Secret provider team for token encryption strategy and storage limits.
- SRE/Infra for webhook domain exposure, Pub/Sub topic provisioning, and cron job scheduling.
- Notifications team for conflict alert surfaces.
- QA for multi-tenant testing (ensure no cross-tenant data bleed).

Success requires tight coordination between platform (security/infra), backend (sync/webhook), and frontend teams to land all phases before declaring GA.
