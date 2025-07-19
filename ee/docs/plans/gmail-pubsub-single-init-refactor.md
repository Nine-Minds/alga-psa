# Gmail Pub/Sub Initialisation – Single-Run Refactor Plan

## High-level Goal

Prevent multiple initialisations of the Gmail Pub/Sub topic & subscription that currently occur during OAuth callback **and** on every provider save.  Each logical trigger (OAuth callback or an explicit “Refresh Pub/Sub” action) must result in **exactly one** call to `setupPubSub`, ensuring Google Cloud does not disable the subscription for excessive creation attempts.

---

## Table of Contents

1. Background & Current Problem
2. Target Architecture (diagram & responsibilities)
3. Phased To-Do List
4. Acceptance Criteria / Testing
5. Roll-out Strategy

---

## 1. Background & Current Problem

Action flow today when a user connects Gmail via OAuth:

| Step | Stack Trace | Calls to `setupPubSub` |
|------|------------|-------------------------|
| 1 | `upsertEmailProvider → finalizeGoogleProvider` | ① |
| 2 | `finalizeGoogleProvider → initializeProviderWebhook → GmailWebhookService.setupGmailWebhook` | ② |
| 3 | UI `onSubmit` (provider **Save**) → `updateEmailProvider → finalizeGoogleProvider` | ③ |
| 4 | Same nested path as step 2 | ④ |

Result : **four** attempts to create/modify the exact same topic & subscription – Google rejects or eventually stops the subscription.

Root cause is split responsibility: both *orchestration* (`finalizeGoogleProvider`) and *Gmail layer* (`GmailWebhookService`) attempt to create Pub/Sub resources.

---

## 2. Target Architecture

```
OAuth Callback ─┬─ store tokens
               └─ configureGmailProvider()  ← the *only* place that calls setupPubSub

configureGmailProvider()
  ├─ generatePubSubNames()
  ├─ setupPubSub()   ← single invocation per logical trigger
  └─ GmailWebhookService.registerWatch() (watch only)

UI Save (settings form)
  └─ upsert / update provider (skipAutomation=true)  ← does *not* touch Pub/Sub

Admin “Refresh Pub/Sub”
  └─ configureGmailProvider() (force=true)
```

Responsibilities

* **configureGmailProvider** – orchestration; knows tenant / topic naming; idempotent.
* **GmailWebhookService** – Gmail-specific; *never* deals with Pub/Sub.
* **setupPubSub** – low-level GCP logic, unchanged.

Database adds `google_config.pubsub_initialised_at` timestamp for an extra idempotency guard.

---

## 3. Implementation Checklist

### Phase 1: Foundation & Database Schema
- [x] Create database migration to add `pubsub_initialised_at TIMESTAMPTZ` field to `google_email_provider_config` table
  - File: `server/migrations/20250719133450_add_pubsub_initialised_at_to_google_config.cjs`
- [x] Update `GoogleEmailProviderConfig` interface to include `pubsub_initialised_at?: string`
  - File: `server/src/components/EmailProviderConfiguration.tsx:73`
- [x] Create `server/src/lib/actions/email-actions/configureGmailProvider.ts`
  - Copy logic from `finalizeGoogleProvider` (`emailProviderActions.ts:280-337`)
  - Add `force?: boolean` parameter for admin refresh actions
  - Implement idempotency: return early if `pubsub_initialised_at` < 24h old and `!force`
  - Call `setupPubSub()` with existing interface
  - Call new `GmailWebhookService.registerWatch()` (not `setupGmailWebhook`)
  - Update `pubsub_initialised_at = NOW()` after successful Pub/Sub setup
- [x] Export `configureGmailProvider` from email-actions index barrel if present (no index barrel exists)

### Phase 2: Trim GmailWebhookService
- [x] Remove setupPubSub import and calls from `GmailWebhookService.ts:41-84`
  - Delete `import { setupPubSub }` and related imports
  - Remove Step 1 ("Set up Pub/Sub") from method
- [x] Rename `setupGmailWebhook()` → `registerWatch()` in `GmailWebhookService.ts`
  - Method now only registers Gmail watch via `GmailAdapter.registerWebhookSubscription()`
- [x] Update return type `GmailWebhookSetupResult` to remove `topicPath` and `subscriptionPath` fields
  - Renamed to `GmailWatchRegistrationResult` and removed topic/subscription fields
- [x] Update all call sites that reference `setupGmailWebhook` to use `registerWatch`

### Phase 3: Wire Up New Orchestrator
- [x] Replace `finalizeGoogleProvider` calls with `configureGmailProvider`:
  - In `upsertEmailProvider()` (`emailProviderActions.ts:419-454`)
  - In `updateEmailProvider()` (`emailProviderActions.ts:469-507`)
- [x] Remove or reduce `finalizeGoogleProvider` to thin wrapper (or delete entirely)

### Phase 4: UI & Automation Control
- [ ] Add `skipAutomation?: boolean = false` parameter to:
  - `upsertEmailProvider()` signature and implementation
  - `updateEmailProvider()` signature and implementation
- [ ] Only call `configureGmailProvider()` when `!skipAutomation`
- [ ] Update UI provider form `onSubmit()` in `GmailProviderForm.tsx:91-152`:
  - Modify to pass `skipAutomation: true` for normal saves
  - Keep OAuth flow with `skipAutomation: false`
- [ ] Add "Refresh Pub/Sub" button that calls `configureGmailProvider()` with `force: true`

## Current Architecture Analysis

**Files Involved:**
- `server/src/lib/actions/email-actions/emailProviderActions.ts` - Main provider CRUD, contains `finalizeGoogleProvider`
- `server/src/services/email/GmailWebhookService.ts` - Gmail webhook service, currently calls `setupPubSub`
- `server/src/services/email/EmailProviderService.ts` - Contains `initializeProviderWebhook` 
- `server/src/lib/actions/email-actions/setupPubSub.ts` - Low-level Pub/Sub setup
- `server/src/components/GmailProviderForm.tsx` - UI form for Gmail provider settings

**Current Problem Flow:**
1. OAuth: `upsertEmailProvider()` → `finalizeGoogleProvider()` → `setupPubSub()` ①
2. Webhook: `finalizeGoogleProvider()` → `EmailProviderService.initializeProviderWebhook()` → `GmailWebhookService.setupGmailWebhook()` → `setupPubSub()` ②
3. UI Save: `updateEmailProvider()` → `finalizeGoogleProvider()` → `setupPubSub()` ③
4. Nested: Same as step 2 ④

**Target Flow:**
- OAuth/Admin: `configureGmailProvider()` → `setupPubSub()` (once) + `registerWatch()` 
- UI Save: `updateEmailProvider(skipAutomation: true)` → (no Pub/Sub calls)


## 4. Roll-out Strategy

1. **Stage 1 – Dual Behaviour**  
   Backend supports `skipAutomation` but default is `false` (old behaviour).  
   Ship code; ensures no breakage if UI lags behind.

2. **Stage 2 – Frontend Update**  
   Release UI with `skipAutomation: true` on normal save and new “Refresh” button.

3. **Stage 3 – Final Toggle**  
   Change backend default of `skipAutomation` to `true` and delete old `finalizeGoogleProvider` dead code.

4. Monitor logs for unexpected additional Pub/Sub calls; once stable for a week, close ticket.

---

> **Outcome** – Every logical trigger performs **exactly one** Pub/Sub setup.  Google Cloud stays happy; our subscriptions remain active; and the codebase gains a clear separation of concerns that is easy for new contributors to understand.

