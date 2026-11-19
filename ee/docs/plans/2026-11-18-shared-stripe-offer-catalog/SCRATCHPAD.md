# Implementation notes

- In alga-psa at origin/main, ee/server/src/lib/stripe/StripeService.ts reads STRIPE_CO_MANAGED_USER_PRICE_ID during preview, checkout finalization, purchase and synchronization. Trace callers of the price assertion, sponsor-subscription filter, purchase-surface eligibility and subscription classifier before switching checkout. The active price currently serves several different decisions.
- In nm-store, packages/nm-store/src/lib/portal/seatChange.ts handles ordinary connected appliance seat quantity and calls the license client. Its single-item fallback is specific to ordinary seats. A co-managed add-on needs an explicit historical offer match and its own quantity. Air-gap purchases currently have a sales-led path.
- In alga-psa, packages/licensing/src/lib/co-managed-license.ts, co-managed-entitlements.ts and verify-license.ts define the consuming contract. Inspect the deployed licensing-service issuer alongside these consumers before finalizing a transport or payload change. Existing signed-license application and refresh are the acceptance boundary.
- Reference the companion 2026-11-18-co-managed-first-seat-purchase plan for navigation and review. Recheck paths after its merge and the EE boundary work. The operator catalog and cross-service contracts below are proposed work.

---

# Draft implementation notes (alga-2026-0003362)

Everything above this line is the board copy of the plan, unchanged. Below: the maintainer-facing decisions this draft made, where things live, and the contract nm-store must still implement.

## Decisions made in this draft (need maintainer sign-off)

1. **Catalog host: alga-psa EE platform tables.** `ee/server/migrations/20261118090000_create_stripe_offer_catalog.cjs`. No `tenant` column, never distributed on tenant, Citus *reference* tables (same treatment as `stripe_customer_bindings`), registered `scope: 'global'` in `tenantTableMetadata.ts` and `server/migrations/utils/tenantDb.cjs`. CE gets no catalog; CE route/stub files answer 403/501 and the surface probe module is empty in CE (F015).
   - `stripe_offer_versions` — one row per (account, mode, Price). `UNIQUE (account, livemode, price_id)` makes reverse lookup unambiguous; a partial unique index allows exactly one `is_current` per (account, livemode, offer_key, interval). Rows are never deleted.
   - `stripe_offer_publications` — append-only audit (seed / publish / restore).
   - `co_managed_portal_purchases`, `co_managed_fulfillments` — checkout→entitlement association and the delivery outbox for appliance fulfillment.
   - `server/migrations/20261118090100_pin_co_managed_purchase_offer_terms.cjs` adds nullable `offer_version_id` / `price_id` to the tenant-distributed `co_managed_purchase_operations` (inert on CE).
2. **Operator entry point: CLI over a master-tenant-gated endpoint.** `npm run billing-catalog -- inspect|inventory|seed|publish|restore|pause|retry-fulfillments` (in `ee/server`) is a thin HTTP client for `POST /api/v1/billing-catalog/operator`; the platform runs the command with its own Stripe credential and the admin DB connection. (A standalone script cannot load the app's API-key validation: it pulls in UI/Next modules.) Authority is the existing master-tenant gate (`assertMasterTenantAccess`: `x-api-key` of `MASTER_BILLING_TENANT_ID`, or a master-tenant internal user with the tenant-management permission); `publishBinding` re-checks the tenant. Needs `ALGA_PSA_URL` + `ALGA_OPERATOR_API_KEY`. No admin UI. Dry run is the default; `--confirm --expect=<current version id|none>` publishes (optimistic concurrency). The endpoint is deliberately *not* under a `platform-*` path, so it is not in the operator-route inventory/matrix test; a maintainer may prefer to move it there.
3. **Merchant-scope parity.** The resolver derives (Stripe account, test/live) from trusted config: `STRIPE_ACCOUNT_ID` if set, otherwise the account of the platform secret key; mode from the key prefix. nm-store must either use the same Stripe account or call the resolve endpoint, which returns `merchant` so both sides can assert parity. **Not verified against nm-store's actual Stripe configuration.**
4. **Legacy fallback** (`STRIPE_CO_MANAGED_USER_PRICE_ID`) serves only an offer key that has *no* version in the catalog (or a catalog that is not migrated yet). Once any version exists the key is managed: a missing current version, an invalid mapping, a Stripe outage or a catalog outage fails closed for new sales and the env var is ignored. Recognition (webhook / sync / reconcile / quantity change) reads only the catalog's version table, never Stripe's active flag, so it keeps working while sales are paused. The env var read is *not* deleted: retirement is a later rollout step (see below).
5. **Companion plan** `2026-11-18-co-managed-first-seat-purchase` is not in `ee/docs/plans/`. This builds on the co-managed purchase flow already on the branch (S35 pool purchase review/resume, S36 seat technicians, S37 capability gating). That work looks merged.

## Former `STRIPE_CO_MANAGED_USER_PRICE_ID` call sites, classified

| Site | Question | Now |
|---|---|---|
| `coManagedPaymentHandlers` `priceId()` (claim + admission) | recognition | `recognizedPrices()` cache of all bound prices + `refreshRecognition()` before admission; `subscription_kind` metadata remains the primary claim |
| `syncCoManagedSubscription` | recognition | `recognizedCoManagedPrices()`; unmapped price → `UnmappedPriceError`, capacity unchanged |
| `finalizeCoManagedCheckout` | recognition + pin | billed price must equal the operation's pinned `price_id`, else any recognized price |
| `previewCoManagedSeats` | new sale **or** recognition | existing pool: that item's own price (F008). New pool: `resolveCurrentOffer` (fails closed) |
| `purchaseCoManagedSeats` | new sale **or** recognition + pin | new operation: resolve current, compare reviewed `offerRef` (`OfferTermsChangedError` → fresh review), pin version+price on the operation. Resume: recorded terms, catalog not consulted. Existing pool: item's own price |
| sponsor-subscription filter (`currentProSubscriptionExpiry`) and subscription classifier (`isCoManagedSubscription`) | recognition | recognized set |
| `assertCoManagedPrice` | recognition (shape only) | accepts any recognized price; no active check |
| `isCoManagedPurchaseSurfaceOpen` (`packages/licensing`) | new-sale eligibility | `registerCoManagedOfferAvailability` probe, registered by EE (`offerCatalog/surfaceProbe.ts`); without a probe only the legacy env binding opens it |

Not touched on purpose: `coManagedUpgradeCheckout.ts` reads the *Pro PSA* user price env vars, which are a different offer.

## Server-to-server contract for nm-store (not implemented in nm-store)

Auth: header `x-api-key` of the master billing tenant (the credential nm-store already uses against alga-psa); anything else is 403. All bodies JSON; success `{success:true,data}`.

- `POST /api/v1/billing-catalog/offers/resolve` `{offerKey:"co_managed_technician_seat", interval:"month"}` → `{offerRef, source, offerKey, interval, versionId, versionNumber, priceId, terms:{unitAmount,currency,interval,intervalCount}, merchant:{stripeAccount,livemode}}`. 404 `no_current_version|not_configured`, 503 `stripe_unavailable|invalid_mapping|catalog_unavailable|scope_unavailable` → show "unavailable", do not create a checkout. Render terms with the existing currency components; never hardcode a currency.
- `POST /api/v1/billing-catalog/offers/classify` `{priceId}` → mapping or `null` (unmapped: leave capacity unchanged).
- `POST /api/v1/billing-catalog/portal-purchases` `{entitlementId, licenseTenantId, offerKey, interval, offerRef, quantity, checkoutSessionId}` → 201 `{purchaseId, priceId, offerVersionId, quantity}`; 409 `OFFER_TERMS_CHANGED` with the fresh offer (show a new review); 403 if the checkout is already bound to another entitlement. Call it **before** the customer pays.
- `POST /api/v1/billing-catalog/portal-purchases/:purchaseId/reconcile` → re-reads Stripe, verifies, queues and delivers. Safe to repeat from a webhook, the return page or a repair job.

Platform webhook: when the portal checkout runs in the same Stripe account the platform's webhook endpoint listens to, `StripeService.handleWebhookEvent` routes any checkout / subscription / invoice event carrying `portal_purchase_id` to the same reconciliation BEFORE tenant resolution and before the appliance lifecycle mirror (so an add-on subscription is never mistaken for the appliance base subscription). Forged, foreign or unmapped facts are consumed and logged (capacity unchanged; fix, then call `reconcile`). A transient failure, or a fulfillment the issuer has not accepted yet, answers 5xx (`retryable`), so Stripe redelivers and the outbox retries delivery without any Stripe write. `retry-fulfillments` re-delivers anything still pending after Stripe stops retrying.

The Stripe Checkout session and the subscription must carry metadata `portal_purchase_id` (= purchaseId) and `entitlement_id`; ownership is verified against it.

### Required nm-store changes

1. Replace its own price selection with `offers/resolve` (portal checkout), and bind the checkout to the eligible connected appliance entitlement with `portal-purchases` before payment.
2. `src/lib/portal/seatChange.ts`: add a separate co-managed pool. Its single-item fallback is ordinary-seat behaviour; the co-managed item must be found by historical offer match (`offers/classify`), carry its own quantity and be shown apart from base seats.
3. Call `reconcile` from its return flow (and after its own payment events if its checkout is in a Stripe account the platform webhook does not receive); the browser return alone grants nothing.
4. Confirm it uses the same Stripe account and mode as `merchant`.

### Issuer (alga-license / "C4") — required, outside this repo

The signing path is **not in alga-psa**: signing and entitlements live in the separate `alga-license` service (`src/signing.ts`; alga-psa reaches it through `ee/server/src/lib/applianceConsole/algaLicenseAdminClient.ts`, Bearer `ALGA_LICENSE_SERVICE_SECRET`). alga-license currently knows nothing about `co_managed_seats`. This draft adds the platform producer and the shared decision rules but not the issuer route. alga-license must implement:

`PUT /entitlements/:entitlementId/co-managed-fulfillment` body `{idempotency_key, license_tenant_id, purchase_id, stripe_subscription_id, sequence, paid_period_end, co_managed_seats}` → `{result:'applied'|'duplicate'|'stale', license_exp}`, using `decideCoManagedFulfillment` / `reissueCoManagedClaims` semantics from `packages/licensing/src/lib/co-managed-fulfillment-contract.ts`: dedupe on key, reject older sequence or paid period, re-sign preserving `seats`, `aud`, `cust`, `tier`, `sub`, `exp`, set `co_managed_seats` (absence = 0), and let the existing check-in re-sign deliver it. Appliances need no change.

## Rollout order and env var retirement (F014)

1. Deploy migrations, then this code (legacy fallback keeps behaviour unchanged: the offer is unmanaged).
2. `npm run billing-catalog -- inventory` in each Stripe account/mode; resolve every `UNMAPPED` price with the operator (`seed --historical=...` after verifying it). Inventory never maps anything.
3. `seed --confirm` from the current env binding. Compare `inspect` with legacy selection; replay representative paid renewals.
4. Only now enable portal selection; first rotation after every reader (webhook, sync, repair, portal reconcile) recognizes retained prices.
5. After parity, reconciliation and a real signed-license refresh are verified, remove `STRIPE_CO_MANAGED_USER_PRICE_ID` and its fallback branches (`legacyEnvPriceId`, `LEGACY_ENV_BINDINGS`, the surface-probe env branch). **Not done in this change.**
6. Rollback of a bad price: `restore --version=<id> --expect=<current|none> --confirm`. To stop new sales without choosing a replacement: `pause --expect=<current version id> --confirm` (audited as `pause`; new checkouts fail closed with `no_current_version`, the legacy env var is NOT revived, and re-running `seed` will not reopen sales). Historical recognition, renewals, reconciliation and paid licence delivery continue regardless. Resume with `restore`. Do not roll software back to a single-price reader after a rotation.

## What was not exercised

T003, T005, the environment half of T007 and a real signed-license refresh across the boundary need Stripe test mode, nm-store and a live appliance. The platform half of T007 is rehearsed against a migrated Postgres (`stripeOfferCatalog.integration.test.ts`, "rehearses the rollout end to end"): legacy env selling with an unpinned in-flight operation, inventory, seed twice, parity in `inspect`, first rotation with the retired price still recognised, pause (dry run, stale expectation, idempotent repeat), fail-closed new sales with recognition intact, a re-seed that does not reopen sales, and restore. Portal webhook routing (F009) is covered in `coManagedPortalFulfillment.integration.test.ts`.
