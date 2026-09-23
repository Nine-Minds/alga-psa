# Scratchpad — Payment Method per Client Billing Profile

## Discoveries (2026-09-22)

- **Billing profiles.** They shipped in PR #3180. The plan is
  `ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/`, and the
  payment-method features there are F102–F106. The design doc is
  `docs/plans/2026-08-15-billing-profiles-sub-account-billing-plan.md` §5.3.
- **Profile settings pattern.** Each setting is a nullable column on
  `client_billing_profiles`, added in migration
  `20260818040000_add_billing_profile_bill_to_and_tax.cjs`. Values are resolved
  per field, profile first and then client, by `resolveEffectiveBillingIdentity`
  in `shared/billingClients/billingProfileSettings.ts`. They are edited through
  `SETTINGS_FIELDS` in `packages/clients/src/actions/clientBillingProfileActions.ts`
  and shown in the UI by `ClientBillingProfileSettings.tsx`.
- **Client-level method.**
  - `clients.preferred_payment_method` is free text. Its options (credit_card,
    bank_transfer, check) are defined inline in `BillingConfigForm.tsx:116`.
  - `clientActions.ts:1881` saves `''` when it is unset.
  - Nothing reads it to affect billing.
- **Saved cards (`payment_methods`).**
  - They already have a NOT NULL `billing_profile_id`, and one default per
    profile (`20260818060000_add_billing_profile_to_payments_and_ar.cjs`).
  - Card management is only in the client portal
    (`packages/client-portal/src/actions/account.ts:358-501`,
    `BillingSection.tsx`). The card-entry form there is a mock
    (`processPaymentDetails` returns `'mock_payment_token'`).
  - `getPaymentMethodForInvoice` is only called from tests.
- **Stripe.** Invoices are paid only through a Checkout payment link. There is
  no auto-charge. `client_payment_customers` is per client, not per profile.
- **Known gap (out of scope, Q3).** `invoiceGeneration.ts:3518` works out the
  due date from the client's `payment_terms` through `getDueDate(clientId)`,
  even though the billing identity for the profile has already been resolved.
  The profile's `payment_terms` is also free text in the UI.
- **Invoice view model.** `po_number` reaches the renderer through
  `invoiceAdapters.ts:646` and `fieldCatalog.ts:50` (`invoice.poNumber`). Use
  the same path for `paymentMethod`.

## Decisions

- **D1.** The per-profile method follows the same pattern as the other profile
  settings: a nullable column, NULL meaning inherit, and per-field resolution.
  Consistency matters more than a new mechanism.
- **D2.** The method list stays at the existing three keys and moves into one
  shared constant, so the client and profile dropdowns can't drift apart. Add
  CHECK at the DB level for the profile column only; the legacy client column
  stays unconstrained.
- **D3.** The invoice records the method at generation time
  (`invoices.payment_method`) instead of resolving it when rendering. An issued
  invoice must not change when a profile is edited, just as PO number works.
- **D4.** The saved card is shown read-only on the MSP side. Collecting a card
  and charging it automatically wait on real Stripe card capture (non-goal).

## Commands

- Run migrations: `cd server && npx knex migrate:latest --knexfile knexfile.cjs`,
  run against the `alga-psa-local-test` stack.
- Dev server: port 3421.
