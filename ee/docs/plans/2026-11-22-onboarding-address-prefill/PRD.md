# Onboarding wizard: company address prefill from billing

## Problem

The first onboarding step shows a Company Address section that says
"Prefilled from your billing details — review and correct if needed." For every
tenant created from a website order the fields are empty. The captain saw this
on a fresh signup (screenshot on the card).

The prefill was built in 7bea7ec1eb (2026-08-18): tenant creation reads the
billing address from the Stripe checkout session, writes it to the MSP client's
default location, and the wizard loads that location.

## Root cause

`ee/temporal-workflows/src/workflows/shared/tenant-creation-steps.ts` only calls
`fetchStripeDetailsFromCheckout` under

    if (input.checkoutSessionId && !input.stripeCustomerId)

The guard dates from October 2025, when the fetch only resolved Stripe IDs. The
address lookup was later added inside the same branch. nm-store
(`packages/nm-store/src/lib/orderInstallFromCheckoutSession.ts`) always sends
both `checkoutSessionId` and `stripeCustomerId`, and never sends
`billingAddress`. So the fetch is skipped, `createTenant` writes the
placeholders (`N/A` / `XX` / `Unknown`), and `getOnboardingInitialData` blanks
them. The wizard code itself behaves as written.

Separately, the copy is static. It claims a prefill for tenants that can never
have one: trials without a card, Apple IAP tenants, tenants created outside the
website. Website checkout also does not require a full billing address, so even
after the fix most signups will have country and postal code only.

## Goals

1. Tenant creation resolves the billing address from Stripe whenever a checkout
   session is known and the caller supplied no address, whether or not the
   caller supplied Stripe IDs.
2. The wizard never claims a prefill that did not happen.

## Non-goals

- No change to nm-store. Checkout keeps its current address collection
  (`billing_address_collection` stays unset). The captain decided not to add
  address fields to the payment form.
- No backfill of existing tenants' locations.

## Design

### Temporal workflow (EE)

In `tenant-creation-steps.ts`, decouple the address lookup from the ID lookup:

- Call `fetchStripeDetailsFromCheckout` when `checkoutSessionId` is present and
  either the Stripe customer ID or the billing address is missing from the
  input.
- Values the caller supplied win: the fetched result fills only fields the
  input left undefined. Today the fetched IDs overwrite the input; that only
  ran when the input had none, so behaviour for existing callers is unchanged.
- A failed fetch stays non-fatal (warn and continue), as today.
- The step is shared by `tenantCreationWorkflow` and
  `algadeskTenantCreationWorkflow`; both get the fix.

This changes which activities a workflow run schedules. Tenant creation runs
are short (30 minute run timeout), but check whether the change needs a
`patched()` marker for runs in flight during the worker rollout and add one if
replay would otherwise break.

### Onboarding wizard

`getOnboardingInitialData` (`packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts`)
reports whether the default location carries a real address value (any
non-placeholder field or a real country) that the user has not yet saved
through the wizard. `ClientInfoStep` uses it:

- Always: "This address appears on your invoices and quotes."
- Only when values were prefilled from billing and this is not a revisit of
  the user's own saved address: add a sentence saying the address was filled
  in from billing details and should be reviewed. With partial data (country
  and postal code only) the sentence must still read true, so do not say the
  whole address was prefilled.

Update `clientInfoStep.address.description` and add the new key in every locale
file under `server/public/locales/*/msp/onboarding.json`, plus the
`defaultValue` strings in `ClientInfoStep.tsx`. Follow the alga-tech-doc-writing
conventions for the copy.

## Acceptance

- A tenant created with both `checkoutSessionId` and `stripeCustomerId` in the
  input gets a default location carrying the Stripe checkout address fields.
- Caller-supplied Stripe IDs are passed to `createTenant` unchanged.
- A tenant with no Stripe address sees the neutral sentence only and empty
  fields.
- A tenant with a Stripe address sees the fields filled and the prefill
  sentence.
- Returning to the step after saving shows the saved address without the
  prefill sentence.
