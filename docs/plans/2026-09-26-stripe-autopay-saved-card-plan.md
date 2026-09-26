# Stripe auto-pay (saved card) for invoices: implementation plan

- **Card:** alga-2026-0002559, "Stripe auto-pay (saved card) for recurring invoices"
- **Branch:** `feature/alga-2026-0002559-stripe-auto-pay-saved-card-for`
- **Base:** main @ 636c648b53 (+ version bump 9fd1ddb58b)
- **Source:** Discord #alga-support feature request (Andrew, 2026-09-02). Clients coming from Harvest want recurring invoices charged to a card on file automatically, instead of paying each emailed link. We need the same thing for Alga's own subscription invoicing, which runs through an Alga PSA tenant.

## 1. Goal

A client (or the MSP on the client's behalf) can save a card with Stripe for a **billing profile** and turn on auto-pay for it. When an invoice for that profile is finalized, Alga charges the saved card off-session:

- **On success,** the payment lands in AR through the same path Stripe Checkout payments use.
- **On failure,** Alga retries on a schedule, tells the client, and falls back to the existing hosted payment link.

## 2. What exists today (verified)

### Payment links only
- `ee/server/src/lib/payments/StripePaymentProvider.ts:createPaymentLink` creates a `mode: 'payment'` Checkout Session.
- `PaymentService.getOrCreatePaymentLink` owns the link lifecycle: reuse, stale expiry, and `expire_pending`.
- Payments land through `recordPaymentFromWebhook`, which calls `recordExternalPayment` (`packages/billing/src/services/accountingSync/recordExternalPayment.ts`).
- The provider reports `supportsSavedPaymentMethods: true`, but nothing implements saved methods.

### Stripe customers are mapped per client
- `client_payment_customers` has a unique key on `(tenant, client_id, provider_type)` (`ee/server/migrations/20251124120000_create_payment_provider_tables.cjs`).

### The saved-card layer is a stub
- The `payment_methods` table exists: `server/migrations/20241117193906_create_payment_methods_table.cjs`. `20260818060000_add_billing_profile_to_payments_and_ar.cjs` later added:
  - `billing_profile_id`, NOT NULL;
  - a unique "one default card per profile" index.
- `shared/billingClients/billingProfilePayments.ts:getPaymentMethodForInvoice` already encodes the correct rule: "an invoice is charged to its profile's default card, never a sibling's". Nothing calls it.
- The client portal `packages/client-portal/src/components/account/BillingSection.tsx` collects **raw card numbers and CVV** in a React form. It passes them to a mocked `processPaymentDetails` (returns `'mock_payment_token'`). `packages/client-portal/src/actions/account.ts:processPaymentToken` then invents last4/expiry.
- REST `FinancialService.createPaymentMethod` (`server/src/lib/api/services/FinancialService.ts`, around line 1045) inserts arbitrary rows.

### Off-session setup exists only for our own AI billing
- `ee/server/src/lib/aiGateway/checkout.ts` uses `setup_future_usage: 'off_session'` and never charges off-session. It is unrelated to tenant payment configs.

### How invoices reach "sent"
- Recurring invoices are generated as **drafts**. `finalizeInvoiceWithKnex` (`packages/billing/src/actions/invoiceModification.ts:1037`) is the single core path. It is used by:
  - the Drafts tab and the `finalizeInvoice` action;
  - REST `InvoiceService.finalizeInvoice`;
  - the zero-dollar auto-finalize;
  - prepaid auto-replenishment.
- Its tail already calls `enqueueInvoiceAutoExport` fire-and-forget (around line 1484). That is the precedent for a post-finalize producer.

### Webhooks
- Tenant resolution uses **only** `event.data.object.metadata.tenant_id` (`packages/integrations/src/webhooks/stripe/paymentsSignature.ts:extractTenantId`).
- `STRIPE_WEBHOOK_EVENTS` (`ee/server/src/lib/actions/payment-actions.ts:84`) subscribes only to:
  - `checkout.session.completed`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
- `checkout.session.expired` and `charge.refunded` are handled in code but never subscribed. This is an existing gap.

### Payment de-duplication is racy
- `recordExternalPayment` locks the invoice row but does **not** de-duplicate on `reference_number` inside the lock.
- `handlePaymentSucceeded` checks for an existing payment *outside* the lock. `checkout.session.completed` and `payment_intent.succeeded` can already race. Auto-pay adds a third writer: the synchronous charge result.

### Jobs
- pg-boss handlers are registered in `server/src/lib/jobs/index.ts`. `enqueueImmediateJob` handles one-off work.
- CE recurring sweeps use `scheduleRecurringJob`. EE sweeps are Temporal `MAINTENANCE_FANOUT_SCHEDULES` (`ee/temporal-workflows/src/schedules/setupSchedules.ts`), dispatched through `maintenanceJobSubscriber.ts`.

### Emails
- The `payment-received` template exists but nothing sends it. `PaymentSettings.sendPaymentConfirmations` is read only by the settings UI.
- There is no payment-failed template.
- The invoice email payment-link context is `packages/billing/src/actions/invoiceEmailLinkContext.ts`.

## 3. Key design decisions

### D1. The billing profile is the unit of auto-pay
Cards are already profile-scoped, and so are invoices (`invoices.billing_profile_id`). Enrollment, the default card and the Stripe customer all hang off `(client_id, billing_profile_id)`.

Invoices without a profile, which are legacy, use the client's default profile. This matches `getPaymentMethodForInvoice`'s documented fallback.

### D2. One Stripe customer per billing profile, not per client
- A Stripe customer is the paying identity. It owns receipt email, attached cards, and the name shown on the statement.
- Sibling profiles are different payers with different cards and billing emails, so sharing one customer would let one entity's cards appear on another's Checkout.
- `client_payment_customers` gains `billing_profile_id`, backfilled to the client's default profile. The unique key becomes `(tenant, client_id, billing_profile_id, provider_type)`.
- `getOrCreateCustomer` takes the profile and uses the profile's resolved billing email and name.
- Existing mappings keep their `cus_` id for the default profile, so no Stripe-side migration is needed.

### D3. Collect cards only through Stripe-hosted Checkout in `mode: 'setup'`
- Raw card data never touches Alga, which keeps us at PCI SAQ-A.
- This removes the current raw-PAN form, which is a live PCI liability even though it is mocked.
- It reuses the existing hosted-checkout, redirect and webhook machinery, and needs no Stripe.js/Elements bundle in the portal.
- A second capture path: the invoice pay link may offer "Save this card for future invoices". This uses `payment_intent_data.setup_future_usage: 'off_session'` plus Checkout's consent collection, and **only** when the payer ticks the checkbox.

### D4. `payment_methods` becomes the real store
It gains:
- `provider_type`
- `external_payment_method_id` (`pm_…`)
- `external_customer_id`
- `brand`
- `fingerprint`
- `status` (`active | expired | detached | requires_update`)

A row is **chargeable** only when it has a provider, an external id and `status = 'active'`.

Existing rows are fabricated (mock 4242, or REST-inserted without a token). They stay in the table but are never charged, and the UI shows them as "not chargeable". The migration does not delete data.

### D5. Enrollment is its own auditable record
New table `billing_profile_autopay`. It holds:
- the enrollment flag and the chosen payment method;
- authorization evidence: who, when, from which surface (portal or MSP), IP/user-agent for the portal, and the consent-text version.

Card networks require stored authorization for merchant-initiated transactions. This evidence is what an MSP needs to win a dispute, so it must not live as loose columns that are overwritten on the next toggle.

### D6. Every charge is an attempt row; one executor serves both the immediate path and the sweep
New table `invoice_autopay_attempts`, with one row per charge attempt:
- `scheduled_for` and `attempt_number`;
- `status`: `scheduled | processing | succeeded | failed | requires_action | cancelled`;
- `payment_intent_id`, `failure_code`, `failure_message`, `next_retry_at`.

The flow:
1. Finalization *schedules* an attempt.
2. The immediate job and the retry/due-date sweep both call the same `processDueAutopayAttempts`.

The row status transitions from `scheduled` to `processing` under `FOR UPDATE SKIP LOCKED`. Retries and due-date charging are therefore the same code path.

### D7. Charge timing is a tenant setting
`PaymentSettings.autopayChargeTiming` is `'on_finalize' | 'on_due_date'`, default `on_finalize`, which matches Harvest. It sets the first attempt's `scheduled_for`.

The retry schedule is also a tenant setting: `autopayRetryDays`, default `[3, 5, 7]` days after the previous failure, up to 3 retries.

### D8. Stripe idempotency key per attempt
The key is `autopay:{tenant}:{invoice_id}:{attempt_id}`. A crashed worker that re-runs the same attempt can never double-charge.

### D9. Settle synchronously, de-duplicate under the lock
When `paymentIntents.create({ confirm: true, off_session: true })` returns `succeeded`, the executor calls `recordExternalPayment` immediately. The later `payment_intent.succeeded` webhook becomes a no-op.

To make that safe, `recordExternalPayment` gains an in-lock existence check on `(invoice_id, payment_method=provider, reference_number)`. It then returns the existing `paymentId` with `paymentRecorded: false`. This also fixes the existing Checkout race.

### D10. No double-pay through an open link
When an attempt starts processing, active Checkout links for that invoice are retired through the existing `expireActiveLinksForInvoice`. A client can't pay a link while the card is being charged.

The invoice email for an auto-pay invoice says "Will be charged to Visa •••• 4242 on {date}" instead of showing a pay button. A pay link is issued only after a terminal failure.

### D11. Metadata carries `tenant_id` on every Stripe object we create
This covers the SetupIntent, the PaymentIntent, and the PaymentMethod (via `paymentMethods.update` after setup). Otherwise the webhook drops the event, because tenant resolution is metadata-only.

## 4. Changes, in build order

Each phase is independently mergeable and testable.

### Phase 0: Correctness groundwork (no feature surface)

1. **`recordExternalPayment` de-duplication (D9).** In `packages/billing/src/services/accountingSync/recordExternalPayment.ts`:
   - After the `forUpdate` lock, look up `invoice_payments` by `(invoice_id, payment_method, reference_number)`. If a row exists, return it with `alreadyRecorded: true` and skip the insert, transaction and status change.
   - Callers: `PaymentService.recordPaymentFromWebhook` must not publish `PAYMENT_RECORDED`/`PAYMENT_APPLIED` twice when `alreadyRecorded`.
   - Tests: `packages/billing/tests/...` unit test, plus an integration test next to `server/src/test/integration/payments/recordExternalPayment.coldStart.regression.integration.test.ts`.
2. **Webhook subscription reconciliation.** Extend `STRIPE_WEBHOOK_EVENTS` with:
   - `checkout.session.expired` and `charge.refunded` (the existing gap);
   - `setup_intent.succeeded`, `setup_intent.setup_failed`;
   - `payment_method.detached`, `payment_method.updated`, `payment_method.automatically_updated`.

   Add `reconcileStripeWebhookEvents(tenant)` in `payment-actions.ts`. It updates the tenant's existing endpoint's `enabled_events` (the list/update logic already exists in `connectStripeAction`). It runs:
   - on connect;
   - on enabling auto-pay;
   - via `retryStripeWebhookConfigurationAction`.

   Surface "webhook events out of date" in `StripeConnectionSettings.tsx` when the stored `webhook_events` differ.

### Phase 1: Schema (migrations under `ee/server/migrations/`, because the payment tables are EE)

3. **`client_payment_customers`:**
   - add `billing_profile_id` (FK `client_billing_profiles`), backfilled to the client's default profile, then NOT NULL;
   - swap the unique key to `(tenant, client_id, billing_profile_id, provider_type)`.
4. **`payment_methods`** (this table is in `server/migrations`, so the migration goes there): add nullable `provider_type`, `external_payment_method_id`, `external_customer_id`, `brand`, `fingerprint`, and `status` (default `'active'`, with a CHECK constraint).
   - Partial unique index on `(tenant, provider_type, external_payment_method_id) WHERE external_payment_method_id IS NOT NULL`.
5. **`billing_profile_autopay`** (EE): PK `(tenant, billing_profile_id)`. Columns:
   - `client_id`, `is_enabled`, `payment_method_id` (FK `payment_methods`);
   - `authorized_at`, `authorized_by_user_id`, `authorization_source` (`client_portal | msp`), `authorization_ip`, `authorization_user_agent`, `consent_text_version`;
   - `disabled_at`, `disabled_by_user_id`, `disabled_reason`, timestamps.
6. **`invoice_autopay_attempts`** (EE): PK `(tenant, attempt_id)`. Columns:
   - `invoice_id`, `billing_profile_id`, `payment_method_id`, `attempt_number`, `scheduled_for`, `status`;
   - `amount`, `currency`, `provider_type`, `payment_intent_id`, `idempotency_key` (unique), `failure_code`, `failure_message`, `decline_code`;
   - `processed_at`, timestamps.
   - Partial unique index: at most one non-terminal attempt per invoice.
   - Index on `(status, scheduled_for)` for the sweep.
7. **Register the tenant tables:**
   - `packages/db/src/lib/tenantTableMetadata.ts`
   - `server/migrations/utils/tenantDb.cjs`
   - tenant deletion in `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts`
   - the Citus distribution list, if payment tables are distributed (check how `invoice_payment_links` is handled and mirror it).
8. **Types:**
   - `packages/types/src/interfaces/payment.interfaces.ts`: `IBillingProfileAutopay`, `IInvoiceAutopayAttempt`, extended `PaymentSettings` (`autopayEnabled`, `autopayChargeTiming`, `autopayRetryDays`, `autopayConsentText`), `DEFAULT_PAYMENT_SETTINGS`.
   - Delete the duplicate `server/src/interfaces/payment.interfaces.ts` by re-exporting from `@alga-psa/types`. Otherwise every new field has to be written twice; leave a `// LEVERAGE: friction` marker if the delete is blocked.

### Phase 2: Provider and service layer (EE)

9. **`PaymentProvider` interface** (types package): add optional capabilities:
   - `createPaymentMethodSetupSession(req)`: returns `{ externalSessionId, url }`;
   - `retrieveSavedPaymentMethod(externalId)`: brand, last4, expiry, fingerprint, customer;
   - `detachPaymentMethod(externalId)`;
   - `chargeSavedPaymentMethod(req)`: returns `{ status: 'succeeded' | 'processing' | 'requires_action' | 'failed', paymentIntentId, failureCode?, declineCode?, message? }`.
10. **`StripePaymentProvider`:**
   - `getOrCreateCustomer(clientId, billingProfileId, email, name)` per D2. Fix its current behaviour of adopting *any* Stripe customer that shares the email (`customers.list({ email })`). Sibling profiles and different clients can share an accounts-payable address, so adopting a stranger's customer object is wrong. Only adopt when `metadata.client_id` and the profile match.
   - `createPaymentMethodSetupSession`: `checkout.sessions.create({ mode: 'setup', customer, currency, payment_method_types: ['card'], setup_intent_data: { metadata: { tenant_id, client_id, billing_profile_id, purpose: 'autopay_setup' } }, metadata: { same }, success_url, cancel_url })`.
   - `chargeSavedPaymentMethod`: `paymentIntents.create({ amount, currency, customer, payment_method, off_session: true, confirm: true, metadata: { tenant_id, invoice_id, client_id, billing_profile_id, autopay_attempt_id }, description: 'Invoice {n}' }, { idempotencyKey })`.
     - Catch `StripeCardError` and map it to `failed`, keeping `decline_code`.
     - Map `authentication_required` to `requires_action`.
   - `parseWebhookEvent`:
     - branch `checkout.session.completed` on `session.mode === 'setup'` and emit a setup event;
     - add `setup_intent.*` and `payment_method.*` cases;
     - carry `autopay_attempt_id` and `billing_profile_id` from metadata.
   - Setting capabilities stays `supportsSavedPaymentMethods: true`, which is now true.
11. **New `ee/server/src/lib/payments/SavedPaymentMethodService.ts`.** This service owns saved-card state:
   - `startSetup(clientId, billingProfileId, returnTo)`;
   - `completeSetup(externalSessionOrSetupIntentId)`, which is idempotent:
     - retrieve the SetupIntent and PaymentMethod;
     - stamp `tenant_id` into the PaymentMethod metadata;
     - upsert `payment_methods` by `external_payment_method_id`;
     - make it the profile default if the profile has none;
   - `removeMethod` (detach in Stripe, soft-delete; if it was the auto-pay method, disable auto-pay with reason `payment_method_removed` and notify);
   - `syncFromProviderEvent` (detached / updated / automatically_updated → update brand, expiry, status).
   - The portal success page and the webhook both call `completeSetup`, so it works even if the webhook is late or missing.
12. **New `ee/server/src/lib/payments/AutopayService.ts`:**
   - **`enroll(profile, paymentMethodId, authorization)` / `disenroll(profile, reason, actor)`.** Validates that the method is chargeable and belongs to the profile (fail fast, per coding standards). Checks that the tenant setting `autopayEnabled` is on.
   - **`scheduleForFinalizedInvoice(invoiceId)`.** Resolve the invoice profile, following D1's legacy fallback, then skip unless all of these hold:
     - a provider is enabled and auto-pay is enabled for the tenant;
     - the profile is enrolled with a chargeable method;
     - the invoice is not a credit note, not a zero or negative balance, and the currency is supported;
     - no non-terminal attempt exists.

     If all hold, insert attempt #1 with `scheduled_for` per D7. When the timing is `on_finalize`, also enqueue the immediate job.
   - **`processDueAttempts(limit)`.** Claim rows with `status = 'scheduled' AND scheduled_for <= now()` using `FOR UPDATE SKIP LOCKED` and mark them `processing`. For each:
     - Re-read the invoice. If it is paid, cancelled or void, or the balance is ≤ 0 (balance = total − credit_applied − payments, the same formula as `getOrCreatePaymentLink`), set it `cancelled`.
     - Re-verify enrollment and the method. If either is gone, cancel and notify.
     - Retire active links (D10).
     - Charge with the D8 key.
     - `succeeded`: call `recordExternalPayment` (provider `stripe`, reference `pi_…`, notes "Auto-pay"), mark the attempt `succeeded`, then publish `PAYMENT_RECORDED`/`PAYMENT_APPLIED` through the existing helpers in `paymentWorkflowEvents`.
     - `processing` (some card flows): leave it `processing`; the `payment_intent.succeeded`/`failed` webhook finalizes it.
     - `failed` or `requires_action`: record the failure and publish `PAYMENT_FAILED` with `failureCode`, `failureMessage` and `retryable`, fields the schema already has. Then:
       - if `retryable` and retries remain, insert the next attempt at `now + autopayRetryDays[n]`;
       - otherwise issue the payment link via `getOrCreatePaymentLink` and send the "auto-pay failed" email with the link.
       - Hard declines (`stolen_card`, `lost_card`, `fraudulent`, `do_not_honor` on the final retry, `expired_card`) mark the method `requires_update` and stop retrying.
   - **`handleProviderEvent`** for `payment_intent.succeeded`/`failed` carrying `autopay_attempt_id`: reconcile the attempt row. Recording goes through the Phase 0 de-duplicated path.
13. **`PaymentService`:**
   - Route setup and payment-method events to `SavedPaymentMethodService`, and events carrying `autopay_attempt_id` to `AutopayService`, before the existing invoice handlers.
   - `handleCheckoutCompleted` must early-return for setup-mode sessions. Today it would just no-op, because `payment_status` is not `'paid'`; make that explicit.
14. **Exports and CE stubs:**
   - Export both new services from `ee/server/src/lib/payments/index.ts`.
   - Add no-op stubs to `packages/ee/src/lib/payments/index.ts`. `scheduleForFinalizedInvoice` resolves with `'not_available'`, and the portal/MSP actions report "requires Enterprise".
   - Extend `packages/billing/src/actions/paymentActions.ts` with thin wrappers that use its existing `loadEnterprisePayments`. The dynamic-import loader is now copied in `paymentActions.ts`, `webhooks/stripe/payments.ts` and `invoiceTerminalStatusHandlers.ts`: add `// LEVERAGE: pattern ee-payments-loader`.

### Phase 3: Triggers and jobs

15. **Post-finalize producer.** At the tail of `finalizeInvoiceWithKnex`, next to `enqueueInvoiceAutoExport`, add `enqueueInvoiceAutopay(knex, tenant, invoiceId)`.
    - It is fire-and-forget. It never throws into finalize, logs failures, and enqueues the job `invoice_autopay_schedule`.
    - It must run after the finalize transaction commits, because the job reads committed state.
    - This one hook covers every finalize path: UI, REST, zero-dollar (which will skip on the zero balance) and prepaid replenishment. Replenishment invoices then get auto-paid, which is desirable because payment is what activates their credit. `settlePrepaidReplenishmentInvoice` already runs inside `recordExternalPayment`.
16. **Job handlers** in `server/src/lib/jobs/handlers/`, registered in `server/src/lib/jobs/index.ts`:
    - `invoice_autopay_schedule` calls `scheduleForFinalizedInvoice`;
    - `invoice_autopay_process` calls `processDueAttempts` for one tenant.
17. **Sweep:**
    - **CE path:** `scheduleRecurringJob` hourly, per tenant, in `initializeScheduledJobs.ts`. It is a no-op on CE because the stubs return nothing.
    - **EE path:** add an `autopay-due-attempts` entry to `MAINTENANCE_FANOUT_SCHEDULES` (hourly). Handle it in `maintenanceJobSubscriber.ts` by enqueueing `invoice_autopay_process` per tenant that has due attempts.
    - The sweep is what makes `on_due_date` and retries work. It also recovers attempts stuck in `processing` for more than 1 hour: query Stripe by `idempotency_key`/metadata before deciding anything, and never blindly re-charge.

### Phase 4: MSP UI (EE components loaded through `packages/product-billing/{ee,oss}/entry.tsx`)

18. **Payment settings** (`ee/server/src/components/settings/billing/PaymentSettingsConfig.tsx`, `updatePaymentSettingsAction`):
    - "Enable auto-pay" toggle; turning it on reconciles the webhook events;
    - charge timing (on finalize or on due date);
    - retry schedule;
    - editable authorization text, which bumps `consent_text_version`.
19. **Client → Billing → General** (`packages/clients/src/components/clients/billing-configuration/BillingConfiguration.tsx` stack). Add an `ClientAutopaySettings` card per billing profile. It shows:
    - the card on file (brand, last4, expiry, status) and the enrollment state with its authorization record;
    - "Send card setup link": emails the profile's billing contact a setup link, using a new email template. The link lands on an authenticated portal page;
    - "Copy setup link", for phone and onboarding flows;
    - enable/disable auto-pay. MSP-side enabling requires ticking "Client has authorized recurring charges", and is recorded as `authorization_source = 'msp'`;
    - recent attempts with failure reasons.

    All interactive elements get `id`s per `docs/AI_coding_standards.md`. Use theme tokens only.
20. **Invoice UI:** in the invoice detail and drafts/sent lists, show an "Auto-pay scheduled / failed / paid by auto-pay" badge from `invoice_autopay_attempts`. Add a manual "Charge card on file now" action (permission `billing:update`) that inserts an immediate attempt.

### Phase 5: Client portal

21. **Replace the mock payment-method flow.** Delete the raw card form, `processPaymentDetails` and `processPaymentToken`.
    - `BillingSection.tsx` gets an "Add card" button that calls a new action `startClientPortalCardSetup(billingProfileId)`. The action is permission-checked with `getPermittedBillingProfileIds` and redirects to Checkout setup.
    - New route `server/src/app/client-portal/billing/payment-methods/setup-complete/page.tsx`. It calls `completeSetup(session_id)` and shows the result.
    - Remove and set-default go through `SavedPaymentMethodService` (Stripe detach and the default rules).
22. **Auto-pay toggle per profile.** It shows the tenant's authorization text and requires an explicit checkbox. Enrolling records the portal user, IP (from request headers), user-agent and text version.
23. **Pay-link opt-in (D3).** The invoice pay page gets a "Save card for future auto-pay" option. `createPaymentLink` gains an optional `savePaymentMethod` flag, which sets `setup_future_usage: 'off_session'` and `consent_collection`. The `checkout.session.completed` handler then persists the PaymentMethod through `SavedPaymentMethodService`.
24. **Portal invoices tab:** show "Will be charged on {date} to •••• 4242" in place of the Pay button while an attempt is scheduled.

### Phase 6: Notifications and email

25. **Invoice email** (`invoiceEmailLinkContext.ts` plus a template refresh migration modelled on `20260811120000_refresh_invoice_email_payment_links.cjs`): add an `autopay` context (card brand/last4, scheduled date). The template renders it instead of the pay button when present.
26. **New templates** (`server/migrations/utils/templates/email/billing/`, seeded in `packages/notifications/.../seed.ts` and registered in `templateVariables/registry.ts`):
    - `autopay-card-setup-request`
    - `autopay-payment-failed` (client; includes the pay link when final)
    - `autopay-enrolled`
    - `autopay-disabled` (client and internal)
    - an internal MSP notification for final failure (`server/migrations/utils/templates/internal/invoices.cjs`)
27. **Wire the existing `payment-received` template** to send on successful auto-pay when `sendPaymentConfirmations` is on. Use a `PAYMENT_RECORDED` subscriber scoped to `method === 'stripe'`, so Checkout payments get receipts too. The setting currently does nothing, and this makes it truthful.

### Phase 7: Tests

- **Unit** (`packages/billing/tests/payments/`, EE unit tests), with a mocked Stripe client:
  - Stripe parameter construction (`off_session`, `confirm`, idempotency key, metadata including `tenant_id`);
  - decline mapping and the retryable/hard-decline classification;
  - the scheduling skip rules;
  - retry math;
  - D10 link retirement;
  - D9 de-duplication.
- **Integration** (`server/src/test/integration/payments/`, the Stripe emulator via `STRIPE_API_BASE_URL`, the same harness as `stripePaymentIntegration.test.ts`):
  - setup session → `completeSetup` → `payment_methods` row;
  - enroll → finalize → charge succeeds → invoice paid, and exactly one `invoice_payments` row even after the replayed `payment_intent.succeeded` webhook;
  - decline → retry scheduled → final failure → payment link issued;
  - a credit applied at finalize reduces the charge; a full credit means no charge;
  - sibling-profile isolation (profile B's invoice never charges profile A's card);
  - concurrent sweep workers claim each attempt once;
  - CE build: finalize is unaffected.
- **Playwright:** portal add-card redirect and return (emulator-backed), and the MSP enable-auto-pay flow.
- **Manual smoke** (use `alga-billing-smoke-investigator` / `alga-manual-smoke-tests`) against Stripe test mode, with these cards:
  - `4242…` succeeds;
  - `4000 0000 0000 0341` attaches but fails the charge;
  - `4000 0027 6000 3184` requires authentication (SCA).

## 5. Deliberately NOT being done

- **Auto-finalizing recurring invoices.** Recurring invoices are still created as drafts and charge only when finalized (by a person, the API, or an existing auto-issue path). A Harvest-style fully hands-off cycle also needs "auto-finalize and send on generation", with no scheduler caller today (`scheduleRecurringWindowInvoiceGeneration` is unused). That is a separate card. It will work automatically with this design because the hook is inside `finalizeInvoiceWithKnex`.
- **Stripe Subscriptions / Stripe Billing.** Alga stays the system of record for invoices, and Stripe is only the payment rail. This avoids the "reconcile Stripe subscriptions against Alga invoices" problem raised in the Discord interim suggestion.
- **ACH / SEPA / bank debits.** Card only in v1. The provider interface and `payment_methods.type` don't preclude it, but mandates and delayed settlement (`processing` for days) need their own design.
- **Partial auto-pay** (charging less than the balance) and **pre-authorization holds.**
- **MSP staff keying card numbers** (MOTO). The MSP can only send or copy a Stripe-hosted setup link.
- **Stripe Connect / platform-account charging.** Charges use the tenant's own connected Stripe keys, as payment links do today.
- **Our own AI/license billing** (`ee/server/src/lib/aiGateway/checkout.ts`, `StripeService`) is untouched. "Alga subscription payments" is served by Nine Minds' own Alga PSA tenant using this feature.
- **Proactive card-expiry reminders** (Stripe's `automatically_updated` covers most renewals). Recorded as a follow-up.
- **Multi-currency beyond the provider's `supportedCurrencies` list.**

## 6. Risks

1. **SCA / `authentication_required`.** EU/UK cards may still demand authentication off-session. Mitigation: store the SetupIntent with `usage: 'off_session'` (the Checkout setup-mode default) so exemptions apply. Map `requires_action` to the pay-link fallback. It is never silently retried.
2. **Double charge.** Three writers can record the same payment: the synchronous result, `payment_intent.succeeded` and `checkout.session.completed`. A client could also pay a link during a charge. Mitigation: D8 idempotency keys, D9 in-lock de-duplication, D10 link retirement, the single-open-attempt unique index, and `SKIP LOCKED` claiming. Stuck-`processing` recovery must query Stripe before any re-charge.
3. **Webhook subscription drift.** Existing tenants' endpoints only list 3 events. Without reconciliation (item 2), setup, detach and refund events never arrive. Mitigation: reconcile on enable-auto-pay and show drift in the settings UI. `completeSetup` is also called from the portal return page, so setup does not depend on the webhook.
4. **Customer re-keying (D2).** Changing the unique key on `client_payment_customers` touches the live payment-link path. `getOrCreateCustomer` callers must pass the invoice's profile. The backfill must map every existing row to the default profile *before* the constraint swap. Existing open Checkout Sessions are unaffected because they carry their own customer.
5. **Fabricated `payment_methods` rows.** Mock or REST-created rows could be mistaken for chargeable cards. Mitigation: chargeability requires `external_payment_method_id` plus `status = 'active'` plus a provider (D4), and enrollment validates this. The REST `createPaymentMethod` stays, but its rows are never chargeable. The API docs note this.
6. **Finalize-path coupling.** The hook must never break or slow finalize. It runs after commit, is fire-and-forget, and errors are only logged, the same contract as `enqueueInvoiceAutoExport`. If the enqueue itself is lost, the hourly sweep does *not* find unscheduled invoices, because it only processes attempt rows. Add a sweep clause: enrolled profiles with finalized, unpaid invoices from the last N days that have no attempt row.
7. **Consent and dispute exposure.** MSP-side enrollment relies on an attestation checkbox, so the product copy must be clear about the MSP's responsibility. The consent text is tenant-editable and versioned.
8. **EE/CE boundary.** All new tables and services are EE, and CE must compile and behave identically. The finalize hook and job handlers live in CE packages and reach EE only through the dynamic loader with stubs.
9. **Citus / tenant distribution.** New tenant tables need the same distribution and reference handling as the existing payment tables. Missing it breaks cross-table FKs in hosted environments.

## 7. Open questions for the captain

- **Default charge timing:** `on_finalize` (Harvest parity) or `on_due_date`? The plan defaults to `on_finalize` and supports both.
- **Portal enrollment:** should portal users be allowed to enroll without MSP approval? The plan says yes, gated by the tenant-level `autopayEnabled` and portal billing-profile permissions.
- **Auto-finalize follow-up card:** should it be opened now? Without it, "recurring" auto-pay still needs a human to click Finalize each cycle.
