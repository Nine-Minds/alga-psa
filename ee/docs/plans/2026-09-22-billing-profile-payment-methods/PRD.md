# PRD — Payment Method per Client Billing Profile

- Slug: `billing-profile-payment-methods`
- Date: `2026-09-22`
- Status: Draft — implemented (first draft); human decisions on Q1–Q3 applied
- Builds on: `ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/` (PR #3180)

## Summary

Let an MSP set a payment method on each client billing profile. It works the
same way as the other profile settings (bill-to, tax, PO, delivery, terms):
leave it blank and the profile inherits the client's "Preferred payment method".
Set it and the profile overrides the client. Each invoice records the effective
method when it is generated, and invoice templates can print it.

## Problem

Billing profiles already give a client several billing identities, each with
its own bill-to, tax, PO, delivery method, billing cycle, payment terms and
invoice. The payment method is still client-wide:

- `clients.preferred_payment_method` (Credit Card / Bank Transfer / Check) is
  the only place to say how a client pays, and it applies to every profile.
- The profile settings panel already says a separately-billed profile has "its
  own bill-to, payment method, and balance". It has no field where you could
  set one.
- Saved cards (`payment_methods`) are already scoped per profile, but you can
  only see them in the client portal. An MSP looking at a profile can't tell
  what card is on file.

In a common setup, one site pays by card and another pays by check or bank
transfer. Today the MSP can't record that on the profile the invoices go out
under.

## Goals

1. Each billing profile can store a payment method, or inherit the client's.
2. The profile settings panel shows the method it will use, where that value
   comes from (the profile or the client), and the saved card on file for the
   profile, if there is one.
3. When an invoice is generated, its profile's effective payment method is
   stored on the invoice. Editing the profile later does not change invoices
   already issued.
4. Invoice templates can print the payment method.
5. A client with no profile override behaves exactly as it does today.

## Non-goals

- Charging a saved card automatically, or collecting a card through the MSP UI.
  The card-entry form in the client portal is still a mock (see scratchpad).
  That work belongs to the Stripe work, not this plan.
- Mapping payment methods to accounting systems (QBO `PaymentMethodRef`).
- A REST or OpenAPI surface for billing profiles, which doesn't exist yet.
- Letting a tenant define its own payment methods. The method list stays fixed.

## Users and Primary Flows

**MSP billing admin**
1. Open Client → Billing → General → Billing profiles, then a profile's settings.
2. Under "Payment method", choose Credit Card, Bank Transfer or Check, or
   choose "Inherit from client". When inheriting, the field shows the inherited
   value.
3. See the default saved card for this profile, if there is one (for example
   "Visa •••• 4242, exp 04/28"), or "No card on file".
4. Save. The next invoice generated for this profile records the method.

**Invoice recipient**
- Sees "Payment method: Check" (or whichever method applies) on invoices whose
  template includes the field.

## UX / UI Notes

- Component: `packages/clients/src/components/clients/ClientBillingProfileSettings.tsx`.
- Use a `CustomSelect` dropdown, not free text. The first option is
  "Inherit from client (<value>)", or "Inherit from client (Not set)" when the
  client has no preferred method. Choosing it saves `null`.
- The option labels come from the same source as `BillingConfigForm.tsx`, so
  the client and the profile show identical labels (see F003).
- The saved-card line is read-only and explains that cards are managed in the
  client portal. It shows only the profile's default card, and only cards that
  are not deleted.
- All new strings go through `msp/clients` i18n with `defaultValue`.

## Data Model / API

**Migration** `server/migrations/<ts>_add_billing_profile_payment_method.cjs`:
- `client_billing_profiles.preferred_payment_method text NULL`, with CHECK
  (`preferred_payment_method IN ('credit_card','bank_transfer','check')`).
  NULL means inherit.
- `invoices.payment_method text NULL`: a snapshot taken at generation, with no
  CHECK. It stores the resolved key, and existing rows stay NULL.
- Both tables are already distributed on Citus, so adding a column needs no
  distribution change.

**Shared code**
- One source for the method list, for example
  `PREFERRED_PAYMENT_METHODS = ['credit_card','bank_transfer','check'] as const`
  plus the type. `BillingConfigForm`, the profile settings, validation and the
  invoice adapter all read from it.
- `shared/billingClients/billingProfileSettings.ts`:
  - Add the column to `PROFILE_COLUMNS` and `CLIENT_COLUMNS`.
  - Add `preferredPaymentMethod: string | null` to `EffectiveBillingIdentity`
    and resolve it with `inherit()`.
  - Treat the client's legacy `''` as null.

**Actions** (`packages/clients/src/actions/clientBillingProfileActions.ts`):
- Add `preferred_payment_method` to `ClientBillingProfileSettingsInput` and
  `SETTINGS_FIELDS`.
- Reject any value outside the method list with an i18n'd action error.
- Add a read helper that returns the profile's default saved card (brand/type,
  last4, expiry), reusing `listPaymentMethods` from
  `shared/billingClients/billingProfilePayments.ts`.

**Invoice generation**
- In `packages/billing/src/actions/invoiceGeneration.ts` (around L3530–3565,
  where `billingIdentity` is already resolved), write
  `invoices.payment_method = billingIdentity.preferredPaymentMethod`.
- Check whether there is a manual invoice path that also sets
  `billing_profile_id` (for example `InvoiceService`). If there is, make it do
  the same.

**Rendering**
- Add `paymentMethod?: string | null` to `WasmInvoiceViewModel`.
- The adapter (`packages/billing/src/lib/adapters/invoiceAdapters.ts`) maps the
  key to a localized label.
- Register an `invoice.paymentMethod` field in the designer `fieldCatalog.ts`
  and in the preview bindings/sample scenarios.
- Standard templates stay as they are. The field is opt-in.

**Type hygiene**
- Add `billing_profile_id` to the `PaymentMethod` interface in
  `packages/types/src/interfaces/billing.interfaces.ts`, which the saved-card
  display needs.

## Risks

- **Legacy client values.** `clients.preferred_payment_method` is unconstrained
  free text and is often `''`. The resolver has to normalize values: `''` or an
  unknown value becomes null for display and for the snapshot. Never throw on
  it.
- **Confusion with "saved card".** The profile carries both a *method* (how
  this profile pays) and possibly a *card on file*. The UI has to keep them
  apart. The method is authoritative, and the card is informational.
- **Snapshot drift.** Existing invoices keep `payment_method` NULL. Templates
  have to render NULL as the empty value, not "undefined".

## Rollout / Migration

- The migration is additive. No backfill: NULL on a profile means inherit, which
  is exactly today's behavior.
- No feature flag. The field has no effect until someone sets it or a template
  uses it.

## Decisions (human, 2026-09-23)

These replace the open questions and their "no change" defaults.

- **Q1 → yes.** An invoice whose payment-method snapshot is Check or Bank
  Transfer leaves out the Stripe "Pay now" link: the invoice email (direct
  send and scheduled job) gets the portal link only, the client-portal pay
  page shows "Payment unavailable", and the portal list disables Pay Now.
  Credit Card and invoices with no recorded method keep today's behaviour.
- **Q2 → keep the same three options.** Credit Card, Bank Transfer, Check.
- **Q3 → fix it here.** Due dates follow the profile's effective payment terms
  (profile first, then client) in generation, preview, manual invoices, and
  `getDueDate`. The profile panel's free-text terms input becomes a select
  sharing the client's options plus "Inherit from client"; unrecognized legacy
  values resolve as unset and are cleared on the next save.

## Acceptance Criteria

- A profile's settings panel shows a Payment method dropdown. Setting it and
  saving persists the value, and choosing Inherit persists NULL.
- With no override, the effective method equals the client's preferred method.
  With an override, the profile's value wins and `overriddenFields` contains
  `preferred_payment_method`.
- The server action rejects an invalid method, and the DB CHECK rejects it too.
- The panel shows the profile's default saved card, or "No card on file".
- A generated invoice stores the profile's effective method in
  `invoices.payment_method`. Changing the profile afterwards does not change
  that invoice.
- The invoice designer offers "Payment method", and a rendered invoice shows the
  localized label.
- A single-profile client with no overrides generates byte-identical invoice
  data, apart from the new `payment_method` snapshot, which equals the client's
  preference.
- A check or bank-transfer invoice's email and portal offer no "Pay now".
- A profile set to Due on Receipt produces invoices due on the invoice date
  while a sibling inheriting Net 30 is due 30 days later.
