# Instruction 7c — Stripe / licensing / Microsoft Graph acceptance scope

This has been left ambiguous three times. It is stated plainly here, and the
same statement appears in `draftSummary`, in the PR description, and in the
review guide's blocker section.

## Live acceptance was NOT obtained

**No part of this card was exercised against live Stripe, live licensing, or
live Microsoft Graph.** That is **out of scope for this card** and remains
outstanding for whoever takes the feature to production.

## Specifically: the USD 11.49 seat SKU

**The USD 11.49 co-managed seat SKU has never been exercised against a real
Stripe price.**

The number is a hard-coded constant:

```ts
// ee/server/src/lib/stripe/coManagedSubscription.ts
export const CO_MANAGED_MONTHLY_SEAT_CENTS = 1149;
```

Everywhere it is "verified", the price is supplied by the test:

| Where | What backs the price |
|---|---|
| `ee/server/src/__tests__/unit/coManagedPurchases.test.ts` | a literal mock object `{ unit_amount: 1149 }` |
| `ee/server/src/__tests__/unit/coManagedSubscription.test.ts` | a literal mock subscription item |
| `server/src/test/unit/product/coManaged*.test.tsx` | `mocks.preview.mockResolvedValue({ unitAmount: 1149, … })` |
| `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts` | the test seeds it: `control('seed/price', { id: CO_MANAGED_PRICE_ID, unitAmount: 1149, … })` |

No Stripe account has been checked for a product or price at $11.49/seat/month.
If the real price is wrong, missing, in another currency, or on a different
billing interval, **nothing in this branch would notice**.

## What the emulator DOES cover, and it is not nothing

`coManagedPurchaseEmulator.integration.test.ts` passes (1/1, 397 ms) against the
in-repo `algasim` Stripe vendor surface, and it is a real end-to-end flow
through the **real `StripeService`**, not a mock of it:

- `previewCoManagedSeats` arithmetic — 3 seats × $11.49 = `monthlyTotal 3447`,
  `amountDue 3447`, proration against an existing Pro subscription;
- `purchaseCoManagedSeats` opening a hosted Checkout session (`mode:
  'subscription'`, `status: 'open'`);
- completing that session, which creates the subscription and emits a **signed
  webhook**;
- the deliberate property that **capacity is granted only after verification** —
  immediately after session completion `getCoManagedEntitlementState` is still
  `{ capacity: 0 }`;
- operation-id replay returning `{ kind: 'updated' }` rather than double-charging.

So the **purchase flow, the webhook path, the reconciliation and the money
arithmetic are covered**. What is *not* covered is that the SKU exists in Stripe
with that price. Those are different claims and have been conflated in previous
rounds.

## Licensing

Co-managed entitlement is enforced in-process through
`packages/licensing` (`assertCoManagedOperationalWrite`,
`getCoManagedEntitlementState`, `countCoManagedCommittedSeats`) against database
state. No signed production licence was verified, and no licensing server was
contacted. Out of scope for this card.

## Microsoft Graph

Co-managed touches Graph only through meeting sync
(`nativeScheduleMeetingSync`, `appointmentMeetingCreation`). There is emulator
coverage for the calendar surface generally
(`microsoftCalendarEmulator.integration.test.ts`), but **no co-managed-specific
Graph acceptance was run in this round**, live or emulated. Out of scope for
this card.

## To close this, a human must do exactly these things

Concretely, so nobody has to re-derive the list:

**Stripe (the USD 11.49 seat SKU)**

1. In the live Stripe account, confirm or create a recurring **Product** with a
   **Price** of `unit_amount = 1149`, `currency = usd`, `recurring.interval =
   month`, `usage_type = licensed`. If it already exists, confirm nothing else
   is attached to it that would change the charge (coupons, tax behaviour,
   tiered pricing).
2. Put its price id in `STRIPE_CO_MANAGED_USER_PRICE_ID`. This environment sets
   it **nowhere** — `grep -rn STRIPE_CO_MANAGED_USER_PRICE_ID` finds only the
   reader — so today the live purchase path cannot run at all.
3. Re-run the seat-purchase journey from the review guide against live Stripe in
   test mode, with a real card, and confirm the invoice line reads
   `quantity × $11.49` and that capacity is granted only after the webhook
   verifies — the property the emulator already proves.

**Licensing**

4. Point the build at a real licensing server, install a signed production
   licence that includes the co-managed entitlement, and confirm
   `getCoManagedEntitlementState` reflects it. Everything in this branch reads
   entitlement from database rows that the fixtures write directly, so a licence
   that fails to parse or to grant the entitlement would not be noticed here.

**Microsoft Graph**

5. Run `microsoftCalendarEmulator.integration.test.ts` **and** a co-managed
   meeting-sync case through `nativeScheduleMeetingSync` /
   `appointmentMeetingCreation` against the Graph emulator
   (`test-harness/graph-emulator`, `docker-compose.e2e-emulators.yaml`). The
   emulator exists and the calendar surface is covered generally; what is
   missing is a co-managed-specific case, which is buildable today without a
   tenant. Only after that does live-Graph acceptance against a real tenant make
   sense.

Item 5 needs no external account and could be done on this branch by anyone;
items 1–4 need credentials this environment does not have.

## What a reviewer should do with this

Treat the seat-purchase journey in the review guide as **demonstrating the
product flow against an emulated payment provider**. Do not treat a green
purchase walkthrough as evidence that a customer could be billed correctly
today. Standing up the real Stripe product/price and re-running the journey
against it is a separate piece of work.
