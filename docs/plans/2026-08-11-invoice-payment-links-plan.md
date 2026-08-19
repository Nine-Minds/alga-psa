# Invoice payment links and portal checkout reliability

- Date: 2026-08-11
- Workflow card: `56b90b8a-e5b7-4f0c-b63d-5ebe2e533968`
- Status: implementation-ready

## Problem

Alga has two live invoice-email paths with different behavior. The scheduled invoice job asks the payment service for a Stripe Checkout URL, while the MSP-facing **Send Invoice Email** dialog sends the invoice without asking for either a payment URL or a client-portal URL. Recipient selection is also duplicated and disagrees about whether a billing contact without an email should fall through to `clients.billing_email` or a billing/default location.

The portal payment entry point has a separate failure mode. When Checkout creation fails, the server action collapses the provider error into a generic result and the route redirects back to Billing with a query message that no component renders. The client sees no explanation and cannot retry from the failure screen.

These gaps leave a finalized, unpaid invoice harder to pay depending on how it was sent, make a valid billing contact unusable to `PaymentService`, and leave the most important portal failure silent.

## Goals

1. Make direct MSP invoice email and scheduled invoice email use the same recipient and link-building rules.
2. For an eligible finalized, unpaid invoice, include a working Stripe Checkout link when payment links are enabled and available, and always include a client-portal fallback link when a portal URL can be built.
3. Let a portal user open Stripe Checkout from **Pay Now**, complete or fail a simulated payment, and receive an actionable in-product error when link creation cannot start.
4. Preserve the original server/provider cause for logging and tests while returning only a stable, safe error code and message to the browser.
5. Resolve the billing-recipient email once, with the same precedence for delivery and Stripe customer creation.
6. Add DB-backed behavioral coverage around the live direct-email and portal-payment boundaries.
7. Add a deterministic Stripe-like package to the existing service-emulator suite so tests exercise the Stripe SDK wire contract and hosted-checkout behavior instead of only mocking the SDK.

## Non-goals

- Replacing Stripe, introducing a second production payment provider, or refactoring `PaymentService` onto `PaymentProviderRegistry`.
- Changing invoice finalization, payment accounting, refunds, credit application, reconciliation, or the existing webhook ledger design.
- Redesigning the MSP send dialog or payment settings. The only new product UI is the portal payment-error state, behind `release-v1-5-feature`.
- Retrofitting the inactive `server/src/utils/email/emailService.tsx` copy or the stub `InvoiceService.sendInvoiceEmail` in `server/src/lib/api/services/InvoiceService.ts`.
- Solving concurrent first-writer races when two requests create a link at exactly the same time. Sequential active-link reuse remains required and covered.
- Adding production deployment, operational controls, dashboards, metrics, alerts, or logging beyond preserving the existing server error cause.
- Using the emulator outside local/test configuration.

## Current-flow findings

### Direct MSP send

- `SendInvoiceEmailDialog.handleSend` in `packages/billing/src/components/billing-dashboard/invoicing/SendInvoiceEmailDialog.tsx` calls `sendInvoiceEmailAction`; it does not enqueue `InvoiceEmailHandler`.
- `getInvoiceEmailRecipientAction` in `packages/billing/src/actions/invoiceJobActions.ts` prefers a billing contact with an email, then `clients.billing_email`, then `client.location_email`.
- `sendInvoiceEmailAction` in the same file repeats recipient lookup differently. If `billing_contact_id` exists, it assigns `contact.email` even when that value is empty and does not try `clients.billing_email`; without a billing contact it starts from `location_email`.
- `getInvoiceEmailTemplate` and `sendInvoiceEmailAction` compile invoice, client, recipient, company, and custom-message fields, but neither supplies nor renders a payment or portal URL. The hardcoded fallback template has the same omission.
- The direct action already has invoice `status`, `finalized_at`, `invoice_type`, `total_amount`, and `credit_applied` through its rendering data, so link eligibility can be decided without another unscoped invoice read.

### Scheduled send

- `InvoiceEmailHandler.handle` in `server/src/lib/jobs/handlers/invoiceEmailHandler.ts` performs a third recipient lookup. It prefers the billing contact or default location and only consults `clients.billing_email` when no billing contact ID is set.
- For a status other than `paid` or `cancelled`, the handler calls `getInvoicePaymentLinkUrlForEmail` from `packages/billing/src/actions/paymentActions.ts`. It catches link-generation failure and continues sending the invoice.
- `EmailService.sendInvoiceEmail` and `EmailService.getInvoiceEmailTemplate` in `server/src/services/emailService.ts` render a hardcoded payment section when a payment URL is passed. They have no portal fallback and do not use the database invoice-email template selected by the direct action.

### Templates

- `server/migrations/utils/templates/email/invoices/invoiceEmail.cjs` is the source for the localized system `invoice-email` templates. `buildBodyHtml`, `buildText`, and `getTemplate` currently render invoice details, the optional custom message, and attachment copy, but no URL.
- `packages/notifications/src/lib/templateVariables/seed.ts` registers the `invoice-email` variables and currently documents that this template has no URL. The registry and the seed source therefore need to change together.
- Updating only the migration utility does not update installed databases. A forward migration must re-upsert the system template. Tenant-authored templates must not be overwritten.

### Payment service and provider

- `getInvoicePaymentLinkUrlForEmail` in `packages/billing/src/actions/paymentActions.ts` checks for an enabled provider and `PaymentSettings.paymentLinksInEmails`, then calls `PaymentService.getOrCreatePaymentLink`.
- `loadEnterprisePayments` and `getPaymentService` in that file turn module-load and initialization failures into `null`. This makes “EE service failed” indistinguishable from “payments are not configured” and discards the original cause before the portal action can preserve it.
- `PaymentService.getOrCreatePaymentLink` in `ee/server/src/lib/payments/PaymentService.ts` reuses an active, unexpired, tenant-scoped link and rejects paid/cancelled invoices. It does not currently require `finalized_at`, reject credit notes, or explicitly require a positive payable balance.
- `PaymentService.getClient` only loads an email from a billing location and then a default location. It does not use the billing contact or `clients.billing_email`, even though invoice delivery can use either.
- Checkout success points at the existing `/client-portal/billing/invoices/:invoiceId/payment-success` route. The cancel URL points at `/client-portal/billing/invoices/:invoiceId`, for which there is no page; the working invoice destination is the Billing page/invoices tab.
- `StripePaymentProvider.initialize` in `ee/server/src/lib/payments/StripePaymentProvider.ts` always uses the Stripe default API host. The installed Stripe SDK accepts `host`, `port`, and `protocol` client options, which gives tests a narrow endpoint override without changing the production provider contract.
- `CreatePaymentLinkRequest` and `PaymentProvider` in `packages/types/src/interfaces/payment.interfaces.ts` already cover the customer, Checkout-link, status, and webhook operations required here. No production interface expansion is necessary.

### Client portal

- `getClientPortalInvoicePaymentLink` in `packages/client-portal/src/actions/clientPaymentActions.ts` correctly authenticates the portal contact, tenant-scopes the invoice lookup, checks client ownership, and rejects draft, paid, cancelled, credit-note, and zero-balance invoices.
- The action returns `payment_not_configured` for a null service result but catches every thrown creation error and returns `Failed to get payment link`, losing the typed reason. The caller receives only a string.
- `PayInvoicePage` in `server/src/app/client-portal/billing/invoices/[invoiceId]/pay/page.tsx` wraps both work and Next.js `redirect()` calls in one `try/catch`. Because `redirect()` throws, intended redirects can also be caught and rewritten as `payment_error`.
- Link-creation failures redirect to `/client-portal/billing?tab=invoices&message=...`, but `BillingOverview` in `packages/client-portal/src/components/billing/BillingOverview.tsx` reads only `tab`; neither it nor `InvoicesTab` renders `message`. This is the silent failure.
- On success, `PaymentRedirect` in `packages/client-portal/src/components/billing/PaymentRedirect.tsx` assigns `window.location.href` and can open the hosted Checkout URL. `verifyClientPortalPayment` validates the returned session ID against the tenant-scoped invoice payment-link record before asking the provider for status.
- `useFeatureFlag` in `packages/ui/src/hooks/useFeatureFlag.tsx` supports the existing `NEXT_PUBLIC_FORCE_FEATURE_FLAGS` test override. No portal payment component currently uses `release-v1-5-feature`.

### Emulator and tests

- The emulator host contract is `EmulatorPackage` in `packages/emulators/host/src/types.ts`; current packages use a pure state core, a wire adapter, and registration through `packages/emulators/suite/src/index.ts`.
- The suite currently exposes Microsoft Graph (4010), QuickBooks (4020), webhook sink (4030), SMTP sink (4040), and control (9500). `packages/emulators/compose.yml`, `build-image.sh`, `Dockerfile`, the suite CLI, suite tests, and README enumerate those packages explicitly.
- `server/src/test/integration/payments/stripePaymentIntegration.test.ts` uses a migrated database and real `PaymentService` logic but mocks the `stripe` package. It does not validate Stripe-compatible HTTP encoding, Checkout redirection, or the app’s webhook through a hosted payment UI.
- `server/src/test/unit/jobs/invoiceEmailHandler.test.ts` protects scheduled-handler behavior with mocks. There is no behavioral test of `sendInvoiceEmailAction`; `server/src/test/integration/journeys/README.md` identifies invoice email delivery as a mocked-only gap.
- The existing portal Playwright harness in `server/src/test/e2e/helpers/testSetup` can create tenant/client users and authenticate the portal. `server/playwright.config.ts` already forwards environment overrides to the test server.

## Design decisions

### 1. One tenant-scoped billing-recipient resolver

Add `resolveInvoiceBillingRecipient` in a new `packages/billing/src/services/invoiceBillingRecipientService.ts` and export it from `packages/billing/src/services/index.ts`. It accepts a Knex connection/transaction plus `tenantId` and `clientId`, performs only tenant-scoped reads, trims and validates candidates with `isValidEmail`, and returns the client identity, recipient name/email, and a source enum.

Use this precedence everywhere:

1. Valid email on `clients.billing_contact_id`.
2. Valid `clients.billing_email`.
3. Valid active billing-location email (`is_billing_address = true`).
4. Valid active default-location email (`is_default = true`).
5. No recipient.

The direct preview action, direct send action, scheduled handler, and `PaymentService` must call the resolver. Stripe customer creation uses the resolved billing email while retaining the client company name as the customer name. A billing contact row with a blank/invalid email never blocks the next candidate.

Update `ContactEmailDefaultConsumer.contract.test.ts` in `server/src/test/unit/contacts` to assert that the three delivery/payment consumers invoke the shared resolver, replacing its brittle assertions about the old duplicated assignment text.

### 2. Central link context with explicit eligibility

Add a billing-layer helper, `getInvoiceEmailLinkContext`, alongside `paymentActions.ts`. It returns `{ paymentUrl?: string, portalUrl?: string, paymentError?: Error }` for a tenant/invoice and is shared by the direct action and scheduled handler.

An invoice is link-eligible only when all are true:

- `finalized_at` is present and status is not `draft`, `paid`, or `cancelled`;
- `invoice_type` is not `credit_note`;
- `total_amount - credit_applied` is positive (with `PaymentService` continuing to subtract recorded payments for the final Checkout amount).

For an eligible invoice, build the portal URL first. Reuse `getPortalDomainStatusForTenant` from `@alga-psa/tenancy/server`, as `portalInvitationActions.ts` already does: prefer an active tenant vanity domain, then `NEXT_PUBLIC_BASE_URL`, then `NEXTAUTH_URL`, then a configured `HOST`. Append `/client-portal/billing?tab=invoices&invoiceId=<id>` with `URL`/`URLSearchParams`; do not create a bearer link or expose tenant identity in the query.

Only request a Stripe URL when an enabled provider exists and `paymentLinksInEmails` is true. A disabled/unconfigured provider produces a portal-only email. A creation failure is retained in `paymentError` for server logging but also produces a portal-only email. Direct and background sending therefore have the same graceful-degradation rule.

Tighten `PaymentService.getOrCreatePaymentLink` to enforce the same finalized/payable invariants rather than relying on every caller. Fix its cancel URL to the real Billing/invoices destination. Preserve the existing active-link reuse and expiration behavior.

### 3. Template variables plus a compatibility fallback

Extend the direct action’s context with `invoice.paymentUrl` and `invoice.portalUrl`. Update every locale in `invoiceEmail.cjs` so HTML and text render:

- a primary **Pay now** action when `paymentUrl` exists;
- a secondary **View invoice in client portal** action when `portalUrl` exists;
- only the portal action when payments are disabled/unconfigured or Checkout creation fails.

Register both variables in `templateVariables/seed.ts` and add a forward migration such as `server/migrations/20260811120000_refresh_invoice_email_payment_links.cjs` that re-upserts the system `invoice-email` template from the utility. The migration updates system-owned rows only and leaves tenant-authored content intact.

Tenant-authored templates may not reference the new variables. After template compilation, a small shared `ensureInvoiceEmailLinks` renderer checks whether each generated URL appears in the rendered HTML/text and appends the missing safe CTA(s), inserting HTML before `</body>` when present. Escape labels and URLs through the existing template/HTML utilities. This gives existing custom templates the behavior immediately without overwriting them and avoids duplicate buttons when they adopt the variables.

Use the same renderer in the hardcoded direct fallback and in `server/src/services/emailService.ts` so scheduled email gains the portal fallback and equivalent labels. Do not broaden the work into unifying the two entire template engines.

### 4. Preserve causes and return stable portal errors

Introduce a narrow payment-link error type in the billing payment action layer with a stable code and native `cause`. In EE, module/service/provider initialization and Checkout creation failures throw this error without replacing the original exception. CE’s intentional lack of the EE service and a tenant with no enabled provider remain `payment_not_configured`; do not turn expected absence into an exception.

Change `PaymentActionResult` in `clientPaymentActions.ts` to return a typed, non-sensitive code (for example `already_paid`, `payment_not_configured`, `payment_link_creation_failed`, `invoice_unavailable`, or `access_denied`) plus a safe display message and `retryable` boolean. In the catch path, log the error object and its cause server-side rather than only a reconstructed string. Never serialize Stripe response bodies, credentials, stack traces, or raw provider messages to the portal.

Refactor `PayInvoicePage` so `redirect()` is not inside a broad catch. Successful link creation still renders `PaymentRedirect`; already-paid invoices can redirect to Billing outside the work catch; link configuration/creation failures render a new `PaymentUnavailable` component.

`PaymentUnavailable` belongs in `packages/client-portal/src/components/billing`, is exported by that package, and calls `useFeatureFlag('release-v1-5-feature')`:

- while the flag resolves, show the existing loading treatment;
- when enabled, show a localized heading, safe reason-specific explanation, **Try again** action for retryable creation failures, and **Back to billing** link retaining the invoices tab/invoice ID;
- when disabled, replace the location with the current Billing redirect target, preserving the pre-feature UI.

Add strings to each supported `server/public/locales/{en,fr,es,de,nl,it,pl,pt}/features/billing.json` file (and pseudo-locales only if required by the locale validation script). No MSP UI changes are needed; email-link visibility remains governed by invoice eligibility and `paymentLinksInEmails`, not the release flag.

### 5. Stripe-like emulator, not a production provider

Add `packages/emulators/stripe` as `@alga-psa/emulator-stripe`, package ID `stripe`, default port 4050. Follow the current emulator split:

- `core.ts`: deterministic customers, Checkout sessions, payment intents, fault rules, webhook deliveries, IDs, expiration, and state transitions using `HostEnv.clock`/`rng` only;
- `wire.ts`: Stripe-shaped HTTP request parsing/responses and the hosted checkout form;
- `notifier.ts`: outbound signed webhook delivery and delivery recording, keeping I/O outside the pure core;
- `register.ts`/`index.ts`: standard seeder, action, fault, view, and package registration;
- package tests and smoke script: validate the contract independently of Alga.

Do not add a fake Alga `PaymentProvider`. Add a test-only `STRIPE_API_BASE_URL` override in `StripePaymentProvider.initialize`; when set, parse it and pass `host`, `port`, and `protocol` to the real Stripe SDK. With the variable absent, construction is byte-for-byte equivalent in behavior to the current production path and uses Stripe’s normal endpoint.

## Emulator boundary and API

The first emulator increment implements only calls made by `StripePaymentProvider` and the hosted flow needed by behavioral tests.

| Surface | Request/behavior | Result/state |
| --- | --- | --- |
| `GET /v1/customers?email=...` | Bearer-authenticated Stripe list request | Stripe list envelope filtered by email |
| `POST /v1/customers` | Stripe form-encoded customer fields/metadata | Creates and returns `cus_*` |
| `GET /v1/customers/:id` | Bearer-authenticated retrieval | Customer object or Stripe-shaped not-found error |
| `POST /v1/checkout/sessions` | Stripe form encoding, including line items, URLs, metadata, and customer | Creates open `cs_*` plus `pi_*`; returns a hosted `url` on the emulator origin |
| `GET /v1/checkout/sessions/:id` | Supports the SDK’s `expand[]` query | Current session with payment intent/status |
| `GET /checkout/sessions/:id` | Browser-facing simulated Checkout | Summary with deterministic **Pay**, **Decline**, and **Cancel** controls |
| hosted **Pay** | Completes session/intent, delivers signed event | Emits `checkout.session.completed`, substitutes `{CHECKOUT_SESSION_ID}`, then 303-redirects to `success_url` |
| hosted **Decline** | Records a failed attempt and leaves retry/cancel available | Emits `payment_intent.payment_failed` and renders a simulated actionable decline |
| hosted **Cancel** | Does not mark payment successful | 303-redirects to `cancel_url` |

Emulator controls follow the uniform host API:

- Seeder/config: accepted test API key, public hosted base URL when request-origin discovery is insufficient, app webhook target, and test signing secret.
- Actions: `complete-session` and `fail-session` for non-browser tests.
- Operation fault: `{ operation, status, code, message, remaining }`, initially supporting `customers.list`, `customers.create`, `customers.retrieve`, `checkout.sessions.create`, and `checkout.sessions.retrieve` with Stripe error envelopes.
- Views: configuration, customers, checkout sessions, payment intents, webhook deliveries, and operation faults.
- Reset: restore deterministic empty state; generic emulator-host transport delay/drop/status faults continue to work unchanged.

The notifier signs each event with the configured `whsec_*` secret using Stripe’s expected timestamp/signature header. Each delivery records event ID, target, attempt, status, and response; retries are deterministic and only implemented to the extent the existing host policy requires. Secrets are never returned by normal state views.

## Test-environment wiring

1. Add the Stripe package to the workspace/lockfile, `packages/emulators/suite` dependencies and `SUITE_EMULATORS`, CLI port mapping, `compose.yml`, `build-image.sh`, `Dockerfile` copy/build stages and `EXPOSE`, suite tests, and the emulator README/port table.
2. Standard local/test values are `STRIPE_SECRET_KEY=sk_test_algasim`, `STRIPE_PAYMENT_WEBHOOK_SECRET=whsec_algasim`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_algasim`, and `STRIPE_API_BASE_URL=http://127.0.0.1:4050`. They are fixtures, not usable credentials.
3. Integration tests start an `EmulatorHost` in-process on an ephemeral API port, configure the base URL before importing/constructing `StripePaymentProvider`, and reset emulator state between cases.
4. The portal Playwright setup starts the Stripe emulator on 4050 (control may use an ephemeral port), passes the four Stripe variables into the Next.js `webServer.env`, and sets `NEXT_PUBLIC_FORCE_FEATURE_FLAGS=release-v1-5-feature:true` for the changed error UI.
5. Configure the emulator notifier target to the test app’s existing `/api/webhooks/stripe/payments` route and use the same signing secret in both processes. The browser success test must therefore traverse the simulated hosted page, the real webhook handler, `PaymentService.processWebhookEvent`, the existing payment/event ledgers, and the success page.
6. Keep the broad mocked-SDK integration suite for fast provider edge coverage. The emulator-backed cases are the smaller behavioral layer that proves wire compatibility and user flow.

## Ordered implementation steps

1. **Extract recipient resolution.** Add `resolveInvoiceBillingRecipient`, unit-test precedence/invalid-email fallthrough/tenant isolation, export it, and replace lookup blocks in `getInvoiceEmailRecipientAction`, `sendInvoiceEmailAction`, `InvoiceEmailHandler.handle`, and `PaymentService.getClient`/customer construction. Update the existing source-contract test.
2. **Align eligibility and URLs.** Add the shared invoice-email link-context helper, tenant vanity-domain-aware portal URL builder, finalized/payable checks, and corrected Checkout cancel URL. Make direct and scheduled send use the helper and log retained link errors while continuing with the portal fallback.
3. **Extend email rendering.** Add payment/portal variables to the direct context, localized migration template, registry seed, hardcoded fallbacks, scheduled `EmailService`, and compatibility renderer for tenant-authored templates. Add the forward system-template migration.
4. **Make payment failures typed.** Preserve EE initialization/provider/creation causes in `paymentActions.ts`; return stable safe codes from `clientPaymentActions.ts`; retain all current portal tenant, ownership, invoice, and session-ID checks.
5. **Add the flagged portal failure state.** Refactor `PayInvoicePage` redirect control flow, implement/export/localize `PaymentUnavailable`, and gate the new UI with `release-v1-5-feature`. Keep successful `PaymentRedirect` behavior unchanged.
6. **Implement the emulator.** Add the pure core, Stripe wire endpoints, hosted Checkout, signed notifier, standard controls/state, tests/smoke script, and suite/container/documentation registration. Add only the opt-in API-base override to the production Stripe adapter.
7. **Add DB-backed behavior tests.** Cover direct delivery, shared recipient precedence, link fallback/reuse, portal link creation, hosted success/webhook settlement, creation failure UI/retry, and tenant/access boundaries. Update the journey README to remove the direct-email behavioral gap.
8. **Run focused validation, then broader affected suites.** Run formatter/type checks for changed packages, template/locale validation, migration tests, emulator tests/smoke, payment integration tests, invoice-email journey, job unit tests, and the focused Playwright spec before the normal affected CI lanes.

## Error and UX behavior

| Condition | Email behavior | Portal **Pay Now** behavior | Server cause |
| --- | --- | --- | --- |
| Eligible invoice; provider enabled; Checkout created | Payment CTA plus portal CTA | Opens simulated/real Stripe Checkout | No error |
| Provider disabled or not configured | Portal CTA only | Flagged UI explains online payment is unavailable and links back to Billing | Expected typed `payment_not_configured`; no provider internals |
| Checkout creation/provider call fails | Send continues with portal CTA only | Flagged UI explains payment could not be started, offers **Try again** and **Back to billing** | Original exception retained as `cause` and logged as an error object |
| Invoice paid meanwhile | No payment CTA; portal CTA may remain | Redirect to Billing/invoice state | Stable `already_paid` result |
| Draft, cancelled, credit note, or no positive balance | No payment CTA; portal link only where viewing is valid | Server rejects payment before provider call | Stable non-retryable code |
| Cross-client/cross-tenant invoice or mismatched returned session | No externally generated link | No disclosure; existing access-denied/not-found behavior | Scoped diagnostic only on server |
| `release-v1-5-feature` disabled | Email behavior unchanged because it is not UI | Preserve current Billing redirect instead of rendering new failure UI | Cause still preserved server-side |

## Security, tenancy, and idempotency

- Require tenant context for every client, contact, location, invoice, provider-config, payment-link, payment, and webhook-ledger query. Continue using `tenantDb`; never infer a tenant from an invoice ID alone.
- Keep the portal contact-to-client ownership check before any provider request. Keep `verifyClientPortalPayment`’s check that the returned `session_id` belongs to that tenant and invoice.
- Portal email URLs lead to the authenticated portal; they contain no token or provider secret. Checkout URLs remain opaque provider URLs.
- Construct URLs with the platform `URL` APIs, validate supported `http`/`https` bases, encode invoice IDs, and escape values inserted into email HTML. Do not place raw provider errors in email, redirects, query strings, or browser payloads.
- The test endpoint override is activated only by explicit `STRIPE_API_BASE_URL`; production defaults remain Stripe. Do not automatically trust arbitrary request hosts as the provider API endpoint.
- Preserve sequential idempotency by reusing the active, unexpired `invoice_payment_links` row. Add a behavioral assertion that two direct sends reuse one Checkout session/link. Do not add a new lock/schema until a concurrent-creation test demonstrates a required fix.
- Preserve `payment_webhook_events.external_event_id` idempotency and the existing payment-record checks. The emulator emits a stable unique event ID per transition so duplicate-delivery tests can assert one applied payment.
- Emulator state and credentials are test-only, deterministic, reset between cases, and must never be populated from production secrets or enabled by default in production manifests.

## Rollout

1. Land the resolver, email behavior, payment cause preservation, emulator, and tests together so direct/scheduled parity is protected from the first release.
2. Apply the forward template migration through the normal application migration path; it updates system invoice-email templates without rewriting tenant custom templates.
3. Deploy with `STRIPE_API_BASE_URL` unset. Existing Stripe configuration and webhook paths remain unchanged.
4. Release backend/email behavior normally. Keep the new portal failure component disabled until `release-v1-5-feature` is enabled for the intended cohort; successful Checkout redirection remains the existing behavior.
5. After the flag is enabled, failures show the new retry/back state. Rollback consists of disabling the flag for UI and reverting application code/template migration through the normal release process; no new business-data table is introduced.

## Risks and open questions

- **Tenant custom-template layout:** appending missing CTAs can be visually less integrated than an authored template. Exact-URL detection prevents duplication; document the two new variables so tenants can place them intentionally later.
- **Vanity-domain availability:** `getPortalDomainStatusForTenant` can fail. Match invitation behavior by falling back to configured public app URLs, log the resolution failure, and omit the portal CTA only when no valid public base exists. Do not send a link to an internal worker hostname.
- **Background/direct template divergence:** this plan aligns recipient/link behavior and CTA rendering without replacing both delivery engines. Full template-engine convergence is a separate project.
- **Sequential versus concurrent creation:** current active-link reuse covers repeated sends but not simultaneous first creation. Keep the narrow scope; capture a follow-up only if a deterministic concurrency test proves duplicates.
- **Declined card semantics:** a declined attempt should not mark the invoice paid and should remain retryable in hosted Checkout. The existing app currently learns final success through the webhook/status path; do not invent production decline accounting.
- **Portal access:** a client without a portal user can receive a portal URL but must authenticate or complete the normal portal setup. The payment CTA remains the direct-pay option when configured; this work does not auto-provision portal users.

## Pareto behavioral test matrix

The starred cases are the smallest high-value set that must be DB-backed and exercise a real action/route plus the emulator where indicated.

| Priority | Layer | Seed/state | Action | Expected behavior |
| --- | --- | --- | --- | --- |
| P0 ★ | DB journey + Stripe emulator + captured email transport | Finalized unpaid invoice; enabled provider/email links; billing contact email; active portal domain | Call real `sendInvoiceEmailAction` | Captured HTML/text contains emulator Checkout URL and tenant portal URL; Stripe customer uses billing-contact email; invoice PDF remains attached |
| P0 ★ | DB journey + Stripe emulator | Same invoice, valid contact row with blank email, valid `clients.billing_email` | Direct send twice | Recipient and Stripe customer use `billing_email`; both sends reuse one active DB payment link and one emulator Checkout session |
| P0 ★ | DB journey + emulator operation fault + captured email | Eligible invoice; `checkout.sessions.create` returns Stripe-shaped 500/decline error | Direct send | Email still succeeds with portal CTA and no broken payment CTA; logged/wrapped error retains emulator code/message as `cause` |
| P0 ★ | Portal Playwright + migrated DB + hosted emulator + real webhook | Authenticated contact owns eligible invoice; feature flag on | Click **Pay Now**, click emulator **Pay** | Browser opens hosted Checkout, redirects to payment-success route, signed webhook is accepted once, DB payment/invoice state becomes paid, success UI renders |
| P0 ★ | Portal Playwright + migrated DB + emulator creation fault | Same ownership; feature flag on | Click **Pay Now** | No silent Billing redirect; actionable localized failure appears with **Try again** and **Back to billing**; after clearing one-shot fault, retry opens Checkout |
| P0 ★ | DB integration/action | Contact belongs to another client/tenant or invoice ID belongs elsewhere | Request payment link and verify foreign session ID | Provider/emulator receives no request; action discloses no invoice data; no payment/link row changes |
| P1 | DB journey + captured email | Payment links setting off or provider disabled | Direct send | Portal CTA is present, payment CTA absent, no provider call occurs |
| P1 | Job unit/integration | Eligible invoice and link-context success/failure | Run `InvoiceEmailHandler.handle` | Scheduled path follows the same recipient/CTA/fallback rules and retains current send-on-link-failure behavior |
| P1 | DB integration | Draft, cancelled, paid, credit note, fully credited, and zero balance invoices | Direct email/link request and portal Pay Now | No Checkout session is created; each path returns/renders its stable non-retryable outcome |
| P1 | Portal Playwright | Creation fault; feature flag off | Navigate to pay route | Browser follows legacy Billing redirect; new error component is not visible |
| P1 | Emulator package tests | Test auth, form-encoded nested line items, expand query, success/failure/cancel | Call wire API/hosted form directly | Stripe-shaped objects/errors, deterministic state, correct redirects, valid webhook signature and delivery record |
| P1 | Webhook DB integration | Duplicate completed event for one session | Deliver same signed event twice | One payment is applied; webhook-event idempotency record prevents a duplicate |
| P2 | Template/locale tests | Every supported system locale and a custom template omitting variables | Render payment+portal, portal-only, and no-link contexts | Localized CTAs are valid in HTML/text; compatibility renderer adds only missing URLs and never duplicates them |
| P2 | Recipient resolver unit/DB tests | Valid/invalid candidates at each priority plus two tenants | Resolve recipient | Exact precedence, normalization, no cross-tenant read, and explicit no-recipient result |

## Acceptance criteria

- [ ] Direct **Send Invoice Email** and the scheduled invoice handler call the same recipient resolver and link-context rules.
- [ ] An enabled, finalized, unpaid, positive-balance, non-credit invoice email includes a working Stripe Checkout URL and an authenticated client-portal URL.
- [ ] If payments are disabled, unconfigured, or fail to create a link, invoice delivery still succeeds with a working portal fallback when a public portal base is available.
- [ ] System HTML/text templates in every supported locale render the new CTAs; existing tenant custom templates receive missing CTAs without being overwritten or duplicating URLs.
- [ ] Portal **Pay Now** opens Stripe Checkout for an eligible owned invoice, and successful hosted payment completes through the signed webhook/status path.
- [ ] Checkout creation failures show a localized retry/back state when `release-v1-5-feature` is enabled; the legacy redirect remains when it is disabled.
- [ ] The browser receives only stable safe error codes/messages, while server logging/tests retain the original provider or initialization exception through `cause`.
- [ ] Billing contact, `clients.billing_email`, billing location, and default location precedence is identical for email preview, email delivery, scheduled delivery, and Stripe customer creation.
- [ ] All invoice/payment/session lookups remain tenant-scoped and client ownership is checked before any external provider request.
- [ ] Repeated direct sends reuse the active payment link; duplicate webhook delivery applies one payment.
- [ ] `@alga-psa/emulator-stripe` runs in the existing emulator suite, supports the required Stripe wire surface and hosted success/failure/cancel interface, and is selected only through explicit test configuration.
- [ ] DB-backed journey and Playwright coverage protects direct email happy/fallback behavior and portal creation-success, payment-success, and creation-failure flows.
- [ ] No new production operations or observability surface is introduced, and all changed portal UI is behind `release-v1-5-feature`.
