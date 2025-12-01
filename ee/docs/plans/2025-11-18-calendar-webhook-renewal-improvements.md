# Microsoft Calendar Webhook Renewal Improvements

**Date:** November 18, 2025  
**Status:** In Progress - Phases 1, 2, 4.1, 4.2 Complete  
**Related:** [Email Subscription Renewal Plan](./2025-11-18-microsoft-email-subscription-renewal-plan.md), [Calendar Integrations Completion Plan](./2025-10-31-calendar-integrations-completion-plan.md)

---

## Executive Summary

The Microsoft calendar webhook renewal implementation (`calendarWebhookMaintenanceHandler.ts`) is functional but lacks the robustness and operational visibility of the email webhook renewal system. While calendar renewals run every 30 minutes (good), they lack fallback recovery, health tracking, and structured error handling that would prevent silent failures in production.

---

## Current State Analysis

### What Exists ✅
- **Scheduled renewal job**: Runs every 30 minutes via pg-boss (`*/30 * * * *`)
- **Basic renewal logic**: `MicrosoftCalendarAdapter.renewWebhookSubscription()` successfully renews active subscriptions
- **Tenant scoping**: Properly wrapped with `runWithTenant()`
- **Logging**: Errors are logged with tenant/provider context

### What's Missing ❌ → ✅ **Mostly Fixed**

#### 1. **No Fallback to Re-register on 404** ✅ **FIXED**
~~**Current behavior:**~~
- ~~If `renewWebhookSubscription()` throws a 404 (subscription deleted/expired), the handler logs an error and moves on~~
- ~~The provider remains broken until manual intervention~~

**✅ Fixed Implementation:**
- ✅ Detects 404/ResourceNotFound errors via `isResourceNotFoundError()`
- ✅ Automatically calls `registerWebhookSubscription()` to recreate the subscription
- ✅ Updates the stored subscription ID and expiration

**Status:** ✅ Implemented in `CalendarWebhookMaintenanceService.processCandidate()`

#### 2. **No Handling for Missing Subscriptions** ✅ **FIXED**
~~**Current behavior:**~~
- ~~Skips providers without `webhookExpiresAt`~~
- ~~No attempt to register a subscription if one doesn't exist~~

**✅ Fixed Implementation:**
- ✅ Checks for missing `webhook_subscription_id` in `findRenewalCandidates()`
- ✅ Automatically registers a new subscription if missing via `recreateSubscription()`

**Status:** ✅ Implemented in `CalendarWebhookMaintenanceService.findRenewalCandidates()` and `processCandidate()`

#### 3. **No Health Status Tracking** ✅ **FIXED**
~~**Current behavior:**~~
- ~~No equivalent to `email_provider_health` table~~
- ~~Renewal success/failure is only in logs~~
- ~~No way to query "which providers have failing renewals?"~~

**✅ Fixed Implementation:**
- ✅ `calendar_provider_health` table created with migration `20251118120000_create_calendar_provider_health.cjs`
- ✅ Tracks:
  - ✅ `subscription_status` (healthy, renewing, error)
  - ✅ `subscription_expires_at`
  - ✅ `last_renewal_attempt_at`
  - ✅ `last_renewal_result` (success/failure)
  - ✅ `failure_reason`
  - ✅ `last_webhook_received_at`
  - ✅ `consecutive_failure_count`
- ✅ Enables UI dashboards and alerting

**Status:** ✅ Fully implemented

#### 4. **No Service Layer Abstraction** ✅ **FIXED**
~~**Current behavior:**~~
- ~~Handler function directly calls adapter methods~~
- ~~Logic is tightly coupled to the job handler~~

**✅ Fixed Implementation:**
- ✅ `CalendarWebhookMaintenanceService` class created
- ✅ Encapsulates:
  - ✅ Candidate discovery with DB queries
  - ✅ Renewal/re-registration orchestration
  - ✅ Health status updates
  - ✅ Error classification (404 detection)
- ✅ Reusable by UI actions, CLI tools, and scheduled jobs

**Status:** ✅ Fully implemented and handler updated to use service

#### 5. **Limited Error Classification** ✅ **FIXED**
~~**Current behavior:**~~
- ~~All errors are treated the same~~
- ~~No distinction between recoverable (404) vs. permanent (invalid token) failures~~

**✅ Fixed Implementation:**
- ✅ `isResourceNotFoundError()` helper detects 404/ResourceNotFound
- ✅ Differentiates between recoverable and permanent failures
- ✅ Marks providers as `error` only after 3+ repeated failures

**Status:** ✅ Fully implemented

#### 6. **No Structured Renewal Results** ✅ **FIXED**
~~**Current behavior:**~~
- ~~Handler returns `void`~~
- ~~No way to track which providers were processed or their outcomes~~

**✅ Fixed Implementation:**
- ✅ Returns `RenewalResult[]` with:
  - ✅ `providerId`, `tenant`, `success`, `action` (renewed/recreated/failed)
  - ✅ `newExpiration`, `error` (if failed)
- ✅ Enables batch reporting and UI feedback

**Status:** ✅ Fully implemented

#### 7. **No Manual Renewal Action** ✅ **FIXED**
**✅ Fixed Implementation:**
- ✅ `retryMicrosoftCalendarSubscriptionRenewal()` server action created
- ✅ Includes RBAC permission checks
- ✅ Returns structured results for UI feedback

**Status:** ✅ Server action complete, UI integration pending

#### 8. **No PostHog Telemetry** ✅ **FIXED**
**✅ Fixed Implementation:**
- ✅ PostHog events emitted (EE only): `calendar_provider.subscription_renewal_success` / `_failure`
- ✅ Includes tenant/provider dimensions for dashboards

**Status:** ✅ Fully implemented (EE edition only)

---

## Recommended Improvements

### Phase 1: Service Layer & Fallback Recovery (High Priority) ✅ **COMPLETE**

**1.1 Create `CalendarWebhookMaintenanceService`** ✅
- ✅ Mirror `EmailWebhookMaintenanceService` structure
- ✅ Location: `server/src/services/calendar/CalendarWebhookMaintenanceService.ts`
- ✅ Methods:
  - ✅ `renewMicrosoftWebhooks(options)` - Main entry point
  - ✅ `findRenewalCandidates()` - Query with DB locking
  - ✅ `processCandidate()` - Renew or re-register per provider
  - ✅ `recreateSubscription()` - Fallback registration
  - ✅ `isResourceNotFoundError()` - Error classification
  - ✅ `updateProviderStatus()` - Update `calendar_providers.status` on failures

**1.2 Add 404 Fallback Logic** ✅
- ✅ In `processCandidate()`, catch 404 errors from `renewWebhookSubscription()`
- ✅ Call `adapter.registerWebhookSubscription()` to recreate
- ✅ Update `microsoft_calendar_provider_config` with new subscription ID

**1.3 Handle Missing Subscriptions** ✅
- ✅ In `findRenewalCandidates()`, include providers with:
  - ✅ `webhook_subscription_id` null/empty
  - ✅ `webhook_expires_at` null
- ✅ Attempt registration during `processCandidate()`

**Deliverables:**
- ✅ Service class created
- ✅ Updated handler to use service (`calendarWebhookMaintenanceHandler.ts`)
- ⏳ Integration tests for 404 recovery and missing subscription registration (pending)

---

### Phase 2: Health Tracking & Observability (Medium Priority) ✅ **COMPLETE**

**2.1 Create `calendar_provider_health` Table** ✅
- ✅ Migration: `server/migrations/20251118120000_create_calendar_provider_health.cjs`
- ✅ Columns:
  - ✅ `calendar_provider_id` (UUID, FK to `calendar_providers.id`)
  - ✅ `tenant` (UUID, FK to `tenants.tenant`)
  - ✅ `subscription_status` (enum: healthy, renewing, error)
  - ✅ `subscription_expires_at` (timestamp)
  - ✅ `last_renewal_attempt_at` (timestamp)
  - ✅ `last_renewal_result` (string: success/failure)
  - ✅ `failure_reason` (text)
  - ✅ `last_webhook_received_at` (timestamp)
  - ✅ `consecutive_failure_count` (integer) - for threshold tracking
- ✅ Indexes: `(tenant, subscription_status)`, `(calendar_provider_id, tenant)`, `(subscription_expires_at)`

**2.2 Update Service to Track Health** ✅
- ✅ `updateHealthStatus()` method writes to `calendar_provider_health`
- ✅ Called after each renewal attempt (success or failure)
- ✅ Upsert pattern (insert or update)

**2.3 Instrument Webhook Route** ✅
- ✅ Update `server/src/app/api/calendar/webhooks/microsoft/route.ts`
- ✅ Write `last_webhook_received_at` to health table on successful webhook receipt
- ✅ Enables detection of silent failures (subscription exists but no notifications)

**Deliverables:**
- ✅ Migration with health table
- ✅ Service updates health on every renewal
- ✅ Webhook route instrumentation

---

### Phase 3: UI & Manual Controls (Medium Priority) 🔄 **PARTIAL**

**3.1 Server Action for Manual Renewal** ✅
- ✅ `server/src/lib/actions/calendarActions.ts`
- ✅ `retryMicrosoftCalendarSubscriptionRenewal(providerId: string)`
- ✅ Calls `CalendarWebhookMaintenanceService.renewMicrosoftWebhooks({ providerId })`
- ✅ Returns structured result for UI feedback
- ✅ Includes RBAC permission checks

**3.2 UI Updates** ⏳
- ⏳ `CalendarIntegrationsSettings.tsx` or related component
- ⏳ Show "Subscription expires in Xh" column (from health table)
- ⏳ Add "Retry Renewal" button per provider
- ⏳ Display last renewal result and failure reason if error
- ⏳ Disable button while renewal is in progress

**Deliverables:**
- ✅ Server action with error handling
- ⏳ UI components showing renewal status (pending)
- ⏳ Manual retry button with feedback (pending)

---

### Phase 4: Error Handling & Alerting (Low Priority) 🔄 **PARTIAL**

**4.1 Mark Providers as Error After Repeated Failures** ✅
- ✅ Track consecutive failure count in health table (`consecutive_failure_count`)
- ✅ After 3+ consecutive failures, set `calendar_providers.status = 'error'`
- ✅ Update `error_message` with actionable guidance

**4.2 Structured Logging & Events** ✅
- ✅ Emit PostHog events (EE): `calendar_provider.subscription_renewal_success` / `_failure`
- ✅ Include tenant/provider dimensions for dashboards
- ✅ Log renewal attempts with structured context (expiry time, action taken)
- ✅ Only enabled when `EDITION === 'enterprise'`

**4.3 Alerting Integration** ⏳
- ⏳ Hook into existing notification system for repeated failures
- ⏳ Alert operators when provider enters `error` state
- ⏳ Include remediation steps (re-authorize OAuth, check webhook URL)

**Deliverables:**
- ✅ Failure threshold logic
- ✅ PostHog instrumentation (EE)
- ⏳ Alert integration (pending)

---

## Comparison Table

| Feature | Email Implementation | Calendar Implementation | Gap |
|---------|---------------------|------------------------|-----|
| Scheduled renewal | ✅ Daily (pg-boss) | ✅ Every 30 min (pg-boss) | None |
| 404 fallback | ✅ Auto re-register | ✅ Auto re-register | ✅ **Fixed** |
| Missing subscription handling | ✅ Auto register | ✅ Auto register | ✅ **Fixed** |
| Health tracking table | ✅ `email_provider_health` | ✅ `calendar_provider_health` | ✅ **Fixed** |
| Service layer | ✅ `EmailWebhookMaintenanceService` | ✅ `CalendarWebhookMaintenanceService` | ✅ **Fixed** |
| Manual renewal action | ✅ `retryMicrosoftSubscriptionRenewal` | ✅ `retryMicrosoftCalendarSubscriptionRenewal` | ✅ **Fixed** |
| UI status display | ✅ Subscription expiry column | ⏳ Pending | **Medium** |
| Error classification | ✅ 404 vs. permanent | ✅ 404 vs. permanent | ✅ **Fixed** |
| Structured results | ✅ `RenewalResult[]` | ✅ `RenewalResult[]` | ✅ **Fixed** |
| Failure threshold | ✅ 3+ failures → error | ✅ 3+ failures → error | ✅ **Fixed** |
| PostHog events | ✅ EE telemetry | ✅ EE telemetry | ✅ **Fixed** |

---

## Implementation Priority

1. **Phase 1** (Critical): Service layer + 404 fallback + missing subscription handling
   - Prevents silent failures
   - Enables automatic recovery
   - **Estimated effort:** 1 sprint

2. **Phase 2** (High): Health tracking table + service updates
   - Enables observability
   - Foundation for UI/alerting
   - **Estimated effort:** 0.5 sprint

3. **Phase 3** (Medium): UI + manual controls
   - Operator self-service
   - Better UX
   - **Estimated effort:** 0.5 sprint

4. **Phase 4** (Low): Error thresholds + alerting
   - Production hardening
   - Proactive incident response
   - **Estimated effort:** 0.5 sprint

---

## Testing Strategy

### Unit Tests
- Mock `MicrosoftCalendarAdapter` responses (success, 404, permanent error)
- Verify service handles all cases correctly
- Test error classification logic

### Integration Tests
- WireMock fixtures for Microsoft Graph (renew success, 404, throttling)
- Simulate expired/missing subscriptions
- Verify DB updates (health table, provider config)

### End-to-End Smoke
- Configure test tenant with Microsoft calendar
- Wait for renewal window
- Verify automatic renewal + health tracking
- Manually trigger renewal via UI action

---

## Migration Considerations

- **Backfill health table**: For existing providers, create initial health rows with current expiry times
- **Gradual rollout**: Enable service layer first, then add health tracking, then UI
- **Monitoring**: Watch renewal success rates before/after changes to validate improvements

---

## Open Questions

1. Should calendar providers also support Temporal workflows (EE) like email, or is pg-boss sufficient?

Answer: We should use temporal

2. Do we need a separate health table, or can we extend `calendar_providers` with renewal fields?

Answer: you decide

3. Should we track webhook receipt timestamps in health table (like email) to detect silent failures?

Answer: yes

4. What's the desired failure threshold before marking provider as `error`? (Email uses 3+ consecutive failures)

Answer: let's match email

---

## Success Criteria

- ✅ Calendar webhook renewals automatically recover from 404 errors
- ✅ Providers with missing subscriptions are automatically registered
- ⏳ Operators can see renewal status and last renewal time in UI (pending UI work)
- ✅ Manual renewal action available from settings page (server action ready)
- ✅ Health table enables alerting on repeated failures
- ⏳ Integration tests cover all renewal scenarios (pending)

---

**Next Steps:** 
- ✅ Phase 1 Complete - Service layer + 404 fallback + missing subscription handling
- ✅ Phase 2 Complete - Health tracking table + service updates + webhook instrumentation
- ✅ Phase 3 Partial - Server action complete, UI updates pending
- ✅ Phase 4 Partial - Failure thresholds + PostHog events complete, alerting integration pending

**Remaining Work:**
- UI components for displaying renewal status and manual retry button (Phase 3.2)
- Alert integration for repeated failures (Phase 4.3)
- Integration tests for renewal scenarios
- Temporal workflow support for EE (per plan answer #1)

