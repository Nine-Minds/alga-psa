# Move Stripe price selection to a shared billing catalog

## Outcome

A Nine Minds billing operator can change the recurring Stripe Price for new co-managed customer technician seat purchases in one place. A hosted Pro MSP account administrator and a connected Pro appliance license owner see the same offer for the same billing interval. A renewal on a previous price continues to recognize the customer’s paid seats.

This card follows **Make the first co-managed seat purchase discoverable** in the existing after stack. Build on the merged purchase flow. Account Management and the co-managed overview use the same hosted checkout. Ordinary MSP user seats, other SKUs, client allocation rules, new billing cadences and air-gap sales policy are outside this change.

## Platform catalog and operator flow

Maintain one database-backed catalog in a Nine Minds-operated service accessible to hosted EE and the licensing storefront. Identify an offer by stable product key and supported recurring interval within a Stripe account and test/live environment. Start with the existing co-managed seat cadence. A version binds that identity to one Stripe Price ID. Enforce one current version per key and unambiguous historical reverse lookup per Stripe account and mode. Preserve versions referenced by purchases or renewals indefinitely. Keep catalog records independent of tenant billing data.

Provide an authenticated platform operator command or administrative action to inspect the current binding and publish a replacement. Retrieve the candidate from Stripe in the intended account and mode. Check active status for new sales, product identity, recurring interval, billing scheme and compatibility with the seat quantity model. Show amount, currency and interval from Stripe for review. Reject ambiguous mappings, invalid candidates and unauthorized writes. Publish atomically with an expected current version so competing operators cannot silently supersede a change. Repeating a successful publication is harmless. To revert, publish the previously validated binding again if Stripe still sells it.

## Checkout and reconciliation contract

Both callers invoke the same server-owned resolver with an offer key and interval. The service derives account and mode from trusted configuration. Return the offer, version and selected Price ID with Stripe-derived terms for review. Fail a new checkout when there is no sellable mapping or the service cannot validate it. Browsers supply the quantity and reviewed offer reference. Bind authenticated customer, tenant or entitlement, absolute quantity and reviewed price to a durable purchase operation. If terms change before a new confirmation, show a fresh review. After confirmation, retries and checkout resumption use the same recorded terms and operation identity.

On a quantity change to an existing subscription, find the owned item by historical mapping and preview and bill using that item's price. A rotation never reprices an existing contract. The webhook and repair/reconciliation paths use a second lookup from Stripe account, mode and actual billed Price ID to the stable offer, including retired prices. Validate signature, ownership, subscription identity, paid state and billed quantity using existing billing rules. For delayed or repeated events reconcile the canonical current subscription and paid period. Unmapped or conflicting facts leave capacity unchanged and return an actionable reconciliation error.

## Appliance licensing

The Nine Minds portal authenticates the license owner and selects the eligible connected appliance entitlement. It resolves the same offer centrally and uses Nine Minds Stripe checkout. Show co-managed capacity separately from ordinary appliance seats. Persist the checkout-to-entitlement association before fulfillment. A return from checkout may display pending payment. Only verified payment may increase capacity.

The platform delivers an authenticated fulfillment request to the existing licensing service, identifying the bound entitlement, canonical purchase/subscription, effective paid period, and absolute verified co-managed seat count. The issuer deduplicates retries and rejects stale changes. Preserve base seat count and other claims when reissuing the signed license with co_managed_seats. Apply existing expiry and lapse rules to renewal, reduction and cancellation. Retry an issuance failure after payment without charging again. A connected appliance consumes the signed result through its existing check-in or manual refresh and verification. Keep Stripe credentials and editable catalog state on the platform.

## Deployment and rollback

1. Inventory all current environment bindings and distinct Price IDs on active subscriptions and open checkout operations in each Stripe account and mode. Resolve unexpected historical prices with the operator before cutover. Add the catalog schema and seed idempotently using verified bindings. If hosted by Alga PSA, use an EE migration. Keep any CE entry point inert.
2. Deploy historical recognition, operation binding and licensing fulfillment support before enabling either purchase writer. Compare catalog results with legacy selection, and replay representative paid renewals for both consumers. Legacy environment resolution may serve unmigrated offers during this stage. Once a binding is managed, an outage or invalid mapping fails closed.
3. Switch hosted and portal selection to the shared catalog. Enable the first rotation only after all readers, including recovery jobs, recognize retained prices. Retire the legacy variable for this offer after parity, reconciliation and signed-license refresh are verified.
4. Roll back a bad price by restoring the previous active binding. If necessary pause new purchases while continuing historical reconciliation and paid license delivery. After a rotation, rolling software back to a single-price reader would strand subscriptions.

## Acceptance and integration ownership

Exercise both storefronts in Stripe test mode across one rotation. A newly reviewed purchase uses the replacement, an old paid subscription renews at its original terms, and a pending purchase completes once at its reviewed terms. A portal payment updates only its linked appliance’s signed co-managed count. Verify that decline, replay and wrong ownership cannot grant seats. Validate the migrated DB under competing publications and repeat the seed.

Choose the authoritative service deployment and operator entry point with maintainers before implementation. Verify that both callers can use the same merchant scope for each supported environment and identify the issuing service’s existing authenticated mutation and signing path. Where repos deploy separately, ship their matching producer and consumer changes in the order above. Completion requires a real signed test-license refresh across the boundary.
