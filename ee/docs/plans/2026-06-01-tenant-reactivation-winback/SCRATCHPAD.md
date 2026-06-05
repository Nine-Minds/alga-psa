# SCRATCHPAD — Tenant Reactivation / Win-Back

Working memory for the effort. Spans two repos: `alga-psa` (app/auth/billing/temporal)
and `nm-store` (marketing + order/checkout site).

## Core insight (why this is feasible)

Tenant deletion is **not destructive up front**. `customer.subscription.deleted`
→ `tenantDeletionWorkflow` runs a *staged, reversible* process: export data → deactivate
users (`is_inactive=true`) → tag client "Canceled" → write `pending_tenant_deletions`
row (`scheduled_deletion_date = now + 90d`) → **`await condition(…, 90 days)`**. Data
stays intact and the workflow stays alive/listening for up to 90 days. There is already a
`rollbackDeletion` signal that un-does it (reactivate users, remove tag, reactivate master
client). That 90-day window IS the reactivation window.

**Point of no return:** when the pending-deletion `status` flips to `deleting`/`deleted`.
Before that → reactivatable. After that → data gone (only S3 export remains; out of scope).

## Product decisions (user-confirmed 2026-06-01)

- **Payment policy:** reactivation requires a **new paid subscription at full price —
  NO first-month/intro discount and no trial.** (Mechanism: omit `introCouponId` and any
  `trial_period_days` when building the reactivation checkout.)
- **Login UX:** **email-only.** Keep the generic "invalid credentials" response; do NOT
  add a distinguishable pending-deletion login screen. Silently fire a (throttled) win-back
  email on a login *attempt* to an inactive + mid-deletion account — password is NOT verified
  (the gate short-circuits before verifyPassword); intent is confirmed downstream by payment.
  (Superseded the earlier "correct-password" framing — see §8 / Review-1 correction.)
- **Both entry points funnel into one reactivation funnel:** paid re-subscribe (no discount)
  → rollback signal (reactivate, data preserved) → link new subscription to the EXISTING
  tenant → password reset.

## File map (verified)

### Deletion lifecycle (alga / ee)
- Workflow: `ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts`
  - rollback handler ~`:432-476` (reactivate users, remove Canceled tag, reactivate master
    client, status `rolled_back`); grace wait `await condition(…, DAYS_90_MS)`.
- Activity `recordPendingDeletion`: `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts:1032-1086`
  → table **`pending_tenant_deletions`** (col `tenant` uuid, `status`, `workflow_id`,
  `workflow_run_id`, `subscription_external_id`, `canceled_at`, `scheduled_deletion_date`,
  `stats_snapshot`). Migration: `ee/server/migrations/20260113120000_create_pending_tenant_deletions.cjs`
  (`table.unique(['tenant'])` → one active deletion per tenant; status lifecycle
  `pending|awaiting_confirmation|confirmed|deleting|deleted|rolled_back|failed`).
- Status query pattern (active row): `whereNotIn('status', ['deleted','rolled_back','failed'])`
  — already used in `start-deletion/route.ts:110-113`.

### Cancellation → deletion triggers
- Stripe: `ee/server/src/lib/stripe/StripeService.ts` — dispatch `case 'customer.subscription.deleted'`
  `:1106-1107`; `handleSubscriptionDeleted` `:1514-1585` → `startTenantDeletionWorkflow({…
  triggerSource:'stripe_webhook'…})` `:1560-1565` (failures swallowed).
- Apple IAP: `server/src/app/api/v1/mobile/iap/notifications/route.ts:228-233`.
- Manual/extension: `ee/server/src/app/api/v1/tenant-management/start-deletion/route.ts:150-155`.

### Signaling a live deletion workflow (reactivation mechanism)
- `ee/server/src/lib/tenant-management/workflowClient.ts`
  - `startTenantDeletionWorkflow` `:169-212` (workflowId = `tenant-deletion-${tenantId}-${Date.now()}`)
  - `rollbackTenantDeletion(workflowId, reason, rolledBackBy)` `:301-339` → `handle.signal('rollbackDeletion', …)`
  - `getTenantDeletionState(workflowId)` `:217-253` (query 'getState')
  - **DUP COPY** at `packages/ee/src/lib/tenant-management/workflowClient.ts` — keep in sync.
- HTTP (master-tenant auth only): `ee/server/src/app/api/v1/tenant-management/rollback-deletion/route.ts`
  (rejects if status already `deleted`/`rolled_back`/`deleting`).
  - nm-store can't use master-tenant auth → need a new **HMAC service-to-service** entry.

### Login / auth
- NextAuth: `packages/auth/src/lib/nextAuthOptions.ts` `authorize` `:1183-1408` → `authenticateUser(…)`.
- `authenticateUser`: `packages/auth/src/actions/auth.tsx:16-104`.
  - **CORRECTED (was wrong earlier):** the order is `:87 if (user.is_inactive) return null;` THEN
    `:97 verifyPassword(...)`. So the `is_inactive` gate short-circuits **before** the password is
    ever checked. The password is NOT verified for inactive users → at the hook point we CANNOT
    confirm identity. (My prior note claiming "password verified before the gate" was false.)
  - Implication: login win-back does NOT verify the password. At the `:87` gate, if an active
    pending deletion exists for `user.tenant`, fire the throttled reactivate-invite email
    (fire-and-forget), then return null as today. No reorder, no verifyPassword call. Intent is
    confirmed downstream by PAYMENT, not the login attempt. 14-day throttle = anti-spam (not intent).
  - Deactivation (`deactivateAllTenantUsers`) only sets `is_inactive=true` — `hashed_password` is
    preserved → keep-old-password would work, but we default to FORCE password-reset on reactivation
    (email-ownership check after payment).

### nm-store order/checkout + existing-tenant check
- alga endpoint: `server/src/app/api/billing/check-tenant/route.ts` (`GET …?email=`, HMAC
  `x-webhook-signature = HMAC-SHA256("email:timestamp", ALGA_WEBHOOK_SECRET)`). Returns
  `{exists, tenantId, tenantName}` / 404 `{exists:false}`. Does NOT currently consider
  `pending_tenant_deletions` or `is_inactive`.
- nm-store: `utils/alga-api.ts:119-178` `checkTenantExists`; `actions/email-validation.ts:11-26`
  `checkExistingTenant`; `components/OrderForm.tsx:755` `validateEmailAvailability` `:741-784`,
  hard block `:786-827` ("A tenant already exists for this email.").

### Password reset
- `packages/auth/src/actions/auth-actions/passwordResetActions.ts`
  `requestPasswordReset(email, userType)` `:40-234`. **CAVEAT:** filters `is_inactive:false`
  `:68-75` → must reactivate (rollback) BEFORE calling, or the user is skipped.
  - reset URL `${baseUrl}/auth/reset-password?token=…`. Service: `PasswordResetService.ts`.

### Email infra (Resend)
- Temporal email service: `ee/temporal-workflows/src/services/email-service.ts`
  (`createEmailService`, singleton `emailService`; provider via `EMAIL_PROVIDER`/`RESEND_API_KEY`).
  Cancellation email activity `tenant-deletion-activities.ts:1774-1840` (`from:'info@nineminds.com'`).
- App/auth branded mail: `getAuthEmailRegistry()` (used in passwordResetActions).

### First-month discount (to be skipped on reactivation)
- nm-store `app/(frontend)/actions/stripe.ts` passes an `introCouponId`; `utils/stripe.ts`
  `resolveCheckoutDiscounts(couponId)` → `discounts:[{coupon}]`, plus optional `trial_period_days`.
  Reactivation checkout: pass coupon = null and no trial.

## Idempotency tie-in (this week's duplicate-tenant fix)

Reactivation MUST reattach the new subscription to the EXISTING tenant — it must NOT run the
normal create-tenant provisioning (that mints a new tenant). The new subscription has a fresh
`sub_…` id with no `tenant_id` metadata, so Layer 3 (metadata pre-check) would NOT short-circuit
and Layer 2 (no `stripe_subscriptions` row for the new sub id) would NOT block → the standard
order checkout WOULD create a duplicate tenant. Therefore reactivation runs a dedicated path,
not `ensureOrderInstallWorkflowForCheckoutSession`.

## Verified: confirmation timing vs. reactivation window (tenant-deletion-workflow.ts:347-391)

- After `confirmDeletion`, status → `confirmed`, `scheduled_deletion_date` overwritten to
  `now + deletionDelay` (30d/90d), then `await condition(() => rollbackSignal !== null,
  deletionDelay)` — **rollback is still accepted during the entire post-confirmation wait** (lines
  352-356). So `confirmed` IS reactivatable; the window just shrinks to the confirmed delay.
- Point of no return = status `deleting` (line 371), set only after the delay elapses with no
  rollback, immediately before `deleteTenantData()`.
- **`immediate` confirm** → `deletionDelay = 0` → the `if (deletionDelay > 0)` wait is skipped →
  `confirmed → deleting` back-to-back → **no reactivation window**.
- TWO date columns (RESOLVED — `updateDeletionStatus` + migration `20260113120000`):
  - `scheduled_deletion_date` NOT NULL = auto-delete deadline `canceled_at + 90d`, NEVER updated.
  - `deletion_scheduled_for` = confirmed actual date (e.g. `now + 30d`), NULL until `confirmDeletion`.
  - `updateDeletionStatus` writes `deletion_scheduled_for`, NOT `scheduled_deletion_date`.
  - Effective deletion date for emails/UI = `COALESCE(deletion_scheduled_for, scheduled_deletion_date)`.

## Detection (the query the helper wraps)

`pending_tenant_deletions` has `unique(['tenant'])` → at most one row per tenant. By email:
resolve email→tenant (check-tenant lookup), then:

```sql
SELECT deletion_id, status, workflow_id, workflow_run_id, canceled_at,
       scheduled_deletion_date, deletion_scheduled_for,
       COALESCE(deletion_scheduled_for, scheduled_deletion_date) AS effective_deletion_date,
       confirmation_type, trigger_source, subscription_external_id
FROM pending_tenant_deletions WHERE tenant = :tenantId;   -- 0 or 1 row
```

`reactivatable` = row exists AND `status IN ('pending','awaiting_confirmation','confirmed')`
(stricter than the existing `whereNotIn(['deleted','rolled_back','failed'])` in
start-deletion/route.ts — we also exclude `deleting`). Sub-states for messaging:
`awaiting_confirmation` = "waiting for confirmation" (show 90d auto date);
`confirmed` = "waiting for deletion date" (show `deletion_scheduled_for`).

## Resolved decisions (2026-06-01, user-confirmed)

- **IAP tenants: no reactivation** — no Stripe sub to re-create, no path back.
- **No refund machinery** for the point-of-no-return race (negligible probability); refuse + message.
- **Reactivation orchestration lives INSIDE the Temporal deletion workflow**, not a server handler.
  Rationale (user caught this): the `rollbackDeletion` signal is fire-and-forget and the actual
  reactivation runs asynchronously inside the still-running deletion workflow; a server handler
  would have to poll for `rolled_back`. Instead, extend the `rollbackDeletion` signal payload with
  an optional `reactivation` block `{ stripeCustomerId, stripeSubscriptionId, stripeSubscriptionItemId,
  stripePriceId, sendPasswordReset }`; the rollback handler (already durable/retried) does
  reactivate → link-subscription (new activity) → stamp metadata → password-reset (new activity).
  Server side = thin trigger that fires the enriched signal on checkout success. Admin rollback
  passes no reactivation block (back-compat).
  - New activities needed in the temporal worker: `linkSubscriptionToExistingTenant`,
    `triggerPasswordReset` (calls the password-reset service).
  - Signal payload type lives in `tenant-deletion-types.ts` (`RollbackDeletionSignal`).

## Review-2 fixes (2026-06-01, second pass)

1. **Charged-but-refused / no alerting gap (F034):** checkout→completion gap is minutes; if status
   crosses to `deleting` (immediate confirm, or 90d auto-delete landing then) Stripe already
   captured payment. Refuse path now fires an ops alert flagging the payment for MANUAL refund (no
   auto-refund). Don't pair "refuse + message" with silence.
2. **Double-payment idempotency (F022):** key on "tenant already has an active linked subscription",
   NOT the sub id — two real payments = two distinct `sub_…`. Also: once `rolled_back` the deletion
   workflow is CLOSED → signaling it throws; the trigger (F016) must detect closed/already-reactivated
   and route to F034 instead of signaling.
3. **Password reset from worker (F021→F035):** `requestPasswordReset` builds the link from
   `NEXT_PUBLIC_BASE_URL||NEXTAUTH_URL||HOST` (app env) and uses `getAuthEmailRegistry` (branded,
   app). The temporal worker is a separate deployment without those + a different Resend sender —
   it CANNOT mint a correct link. Resolution: worker activity calls an app-side HMAC endpoint that
   runs `requestPasswordReset` in app context. (Verified: passwordResetActions.ts:182-183.)
4. **Citus routing (F019):** tenant-scoped inserts from outside the normal path have bitten before
   (memory: insert routing can't be trigger-fixed). `createTenantInDB` ALREADY inserts
   stripe_customers/stripe_subscriptions from the worker with `tenant` set explicitly — that is the
   proven path. linkSubscriptionToExistingTenant must REUSE that exact insert code (shared helper),
   not hand-roll, so shard placement is identical. Test T058 asserts rows land under the tenant.
5. **Naming (F023/§9):** real nm-store symbols are `ensureOrderInstallWorkflowForCheckoutSession`
   (orderInstallFromCheckoutSession.ts) → `startOrderInstallWorkflow` (orderInstallTrigger.ts), plus
   `buildOrderInstallWorkflowInputFromCheckoutSession` / `isCheckoutSessionReadyForProvisioning` /
   `buildOrderInstallWorkflowId`. The not-called spy (T035) targets `startOrderInstallWorkflow`.
6. **Win-back recipient (F025):** detection keys on `user.tenant`; email goes to the tenant
   billing/admin email (not the attempter); per-tenant throttle is shared across users. By design.

## Review-3 fixes (2026-06-01, third pass — polish + 1 substantive)

- **Stale prose scrub:** §2 Goals + §11 acceptance criteria still said "correct-password" login —
  contradicted §8/decision-5. Scrubbed to "login attempt (password not verified)".
- **T006 field name:** aligned to `effectiveDeletionDate`/`deletionStatus` (was `scheduledDeletionDate`).
- **F034 sink made concrete (was hand-wavy "emit an alert"):** durable row in NEW
  `pending_reactivation_refunds` (F036, migration group) + email a monitored ops/billing inbox via
  the existing email service. Row = work queue, email = nudge. Avoids degrading to an unwatched log.
- **Stripe customer reconciliation (substantive — was missing):** the existing tenant already has a
  `stripe_customers` row from the original sub. createTenantInDB INSERTS a customer → blindly
  reusing it would create a DUPLICATE/divergent customer for the tenant (billing portal + webhooks
  key off it). Fix: (F037) reactivation checkout is created with the tenant's EXISTING `cus_…`
  (Stripe keeps the customer after `customer.subscription.deleted`); (F019) link reuses the existing
  `stripe_customers` row (match on tenant) and inserts ONLY the new `stripe_subscriptions` row;
  fall back to create only if no customer row exists. Idempotency was keyed on the subscription;
  the customer record is now explicitly covered too.

## Review-4: authorization model (2026-06-01) — who may reactivate

Question raised: a non-admin login attempt triggers the email — how do we accept their
confirmation / ensure billing authority? Answer (now §12, F038/F039):
- **Authority anchor = control of the tenant billing/admin email.** Can't use login/RBAC (all users
  are `is_inactive`). Same anchor Stripe + password-reset already use.
- **Recipient (F038):** email ALWAYS to the tenant billing/admin email (resolved server-side),
  NEVER the attempter or the order-form-entered email. A non-admin's attempt nudges the admin.
  nm-store never sees the admin address (anti-enumeration).
- **Token (F039):** signed, single-use, expiring, bound to tenant_id, in the email link; the
  reactivation checkout can't be created without it; consumed on success. Payment ≠ authority.
- **Access (F021):** force password-reset to the same admin inbox → payment alone grants no access.
- Chain: admin-inbox → token → checkout → payment → reset(to inbox) → access. Random payer w/o token
  can't initiate (blocks griefing/resurrection + enumeration); inbox-compromise = already-admin.
- v1 = single billing/admin email is the authority; finer billing-RBAC deferred.

## Review-5 fixes (2026-06-05)

1. **Single-use token needs durable state:** F039 now depends on F040
   `tenant_reactivation_tokens` with `token_hash`, `tenant`, `deletion_id`, `expires_at`,
   `reserved_at`, `consumed_at`, `checkout_session_id`, and timestamps. A signed token alone can
   expire but cannot enforce single-use; checkout creation must atomically reserve the row before
   creating Stripe Checkout, and completion consumes it.
2. **Stripe webhook branch made explicit:** F041 requires `checkout.session.completed` to branch on
   `session.metadata.reactivation === "true"` before normal `handleCheckoutCompleted` subscription
   import/update behavior. Reactivation sessions go to the reactivation trigger/guard path only.
3. **Stale refund wording scrubbed:** F032 no longer says refund policy is an open question; charged
   but refused payments route to F034 (ledger + ops/billing email, manual refund).
4. **Edition placement (F042) — `pending_tenant_deletions` is EE-only.** VERIFIED: the table is created
   solely by `ee/server/migrations/20260113120000_create_pending_tenant_deletions.cjs` (exact name
   `pending_tenant_deletions`, `createTable('pending_tenant_deletions')`). But check-tenant lives in
   **CE** at `server/src/app/api/billing/check-tenant/route.ts`, and the login hook is in **shared**
   `packages/auth`. Reading an EE-only table from CE/shared code throws where the table is absent.
   Move the HMAC endpoints (check-tenant + request-reactivation F006 + reactivation-password-reset
   F035) under `ee/server/src/app/api/...` (mirroring `internal/`, `provisioning/`,
   `v1/tenant-management/`), keeping the same HMAC URL paths nm-store calls. EE routes resolve via
   aliases (`scripts/build-enterprise.sh:23` "EE code resolved via aliases"; no filesystem overlay).
   Any pending-deletion read reachable in CE must fail-soft (table-absent ⇒ no pending deletion).
5. **Login hook via the EE injection pattern (F043).** VERIFIED pattern: `nextAuthOptions.ts` already
   lazy-loads EE impls through `loadEnterpriseSsoProviderRegistryImpl()` (`sso/enterpriseRegistryEntry.ts`,
   `@enterprise/*` dynamic import that resolves to a CE stub) behind `isEnterprise` +
   `enterpriseSsoRegistryInitPromise`. Do the same for the win-back hook — DON'T inline the
   `pending_tenant_deletions` query in `packages/auth/src/actions/auth.tsx`. Shared auth just calls the
   (no-op in CE) hook at the `is_inactive` gate (`auth.tsx:87`) and returns null as today.
6. **nm-store gets `cus_…` from Stripe, not alga's DB (F044) — answers "comes from stripe".** VERIFIED:
   nm-store's `createCheckoutSession`/`createTieredCheckoutSession` (`packages/nm-store/src/utils/stripe.ts`)
   pass **no** `customer` field today → Stripe mints a new customer each checkout. nm-store holds
   `STRIPE_SECRET_KEY` (`utils/stripe.ts:8`). Resolution: alga's token-exchange (F014/F039) returns a
   NON-PII Stripe id (the prior `subscription_external_id`, and/or `cus_…` read server-side from
   `stripe_customers` by tenant); nm-store sets `customer: cus_…` directly or derives it via
   `subscriptions.retrieve(sub_…).customer`. The admin EMAIL never crosses to nm-store (preserves F038).
   F037 updated: it does NOT ship alga's `stripe_customers` row across the boundary.
7. **Reactivated-but-unbilled partial failure (F045).** `handleRollback` sets status `rolled_back` +
   reactivates users at the TOP, then (new steps) links the sub + resets password. If
   `linkSubscriptionToExistingTenant` permanently fails after users are active and payment captured,
   the tenant is live with no linked subscription — uncovered by F034's existing reasons. On exhausted
   retries, raise F034 with a distinct `reactivated_unbilled` reason (durable row + email). Temporal
   activity retries cover transient failures first.
8. **F019 "reuse exact insert path" is a refactor, not a literal call (F046).** VERIFIED in
   `tenant-operations.ts`: customer insert (`:142-147`, `tenant`, `stripe_customer_external_id`,
   `billing_tenant: MASTER_TENANT_ID`) and subscription insert (`:221-222`) are coupled — the sub's
   `stripe_customer_id` FK uses the just-inserted internal customer (`:191`). Extract a shared helper
   that takes an EXISTING internal `stripe_customer_id` and inserts ONLY the sub row with `tenant` +
   `billing_tenant = MASTER_TENANT_ID`; createTenantInDB calls the same helper (no behavior change).
9. **Throttle atomicity (F047) + admin-email source of truth (F048).** (a) F026 must be a conditional
   `UPDATE ... WHERE last_winback_email_at IS NULL OR < now()-14d RETURNING`, emailing only when a row
   comes back — a read-check-update double-sends under concurrent attempts. (b) The whole authority
   model rests on resolving the billing/admin email; F048 pins the canonical field + fallback order
   (tenant owner/adminEmail → master-tenant client billing contact / Stripe customer email) behind one
   resolver used by both F008 and F025.

## Open questions / gotchas

- Win-back email throttle store: `last_winback_email_at` column on `pending_tenant_deletions`.
  Interval = **once per 14 days** (decided 2026-06-01), per login attempt.
- Anti-enumeration: checkout reactivation reveals account existence (user types their own
  email — acceptable). Win-back email is silent (no enumeration leak).
- Keep both `workflowClient.ts` copies in sync if a helper is added.
