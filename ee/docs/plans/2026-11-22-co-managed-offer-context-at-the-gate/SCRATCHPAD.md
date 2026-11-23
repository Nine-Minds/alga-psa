# Scratchpad: Co-managed offer availability resolved at the gate

## How it was found (2026-11-22)

- 1.6.20 (merge of PR 4475, commit `9ce478a1`) was staged on the idle color. An eligible hosted
  Pro tenant with no seats saw the purchase pool but no 15-day trial card.
- The idle color's Helm values have no `STRIPE_CO_MANAGED_USER_PRICE_ID` or `STRIPE_ACCOUNT_ID`.
  The live color has both, but they were added to its Deployment by hand and aren't in Helm.
- The live catalog account and price were persisted in `stripe_offer_catalog_settings` with the
  operator command (`set-account`, through `POST /api/v1/billing-catalog/operator` with a
  master-tenant API key). That fixed the sidebar purchase entry. The trial card stayed empty.
- The tenant was confirmed in the `co_managed_trial_sponsors` view, with no
  `co_managed_seat_trials` row and no non-hosted entitlement.

## Root cause

- PR 4452 (`12aa43ef56`, "persist Stripe catalog accounts") replaced the process-wide
  `registerCoManagedOfferAvailability` probe with the request-scoped `withBillingCatalogContext`
  (AsyncLocalStorage), and wrapped only the purchase paths:
  - `purchaseDiscovery.ts`
  - `coManagedBillingActions.ts`
  - `server/src/lib/actions/coManagedActions.ts`
- PR 4444 (`d0ee216a0b`, 15-day Seat trial) calls `isCoManagedPurchaseSurfaceOpen` directly from:
  - `coManagedSeatTrialActions.ts` (`withTrialIntake`, `getSeatTrialOfferAction`)
  - `seatTrialDiscovery.ts`
  - `packages/co-managed/src/seatCapability.ts`

  With no store, `offerConfigured()` falls back to `Boolean(process.env.STRIPE_CO_MANAGED_USER_PRICE_ID)`.
- Both PRs merged cleanly. Their behavior conflicts: the omission is invisible because the
  fallback returns false with no error.

## Decision

- Resolve the context at the gate, through a loader registered by EE, instead of requiring every
  caller to wrap. That keeps PR 4452's goal (no process cache of the account or price) and makes
  forgetting a wrapper harmless.
- Rejected: wrapping the four trial call sites. It fixes today's callers but leaves the trap for
  the next one, and `admits()` is reached from shared code (`seatEffortSummary.ts`) and the
  Temporal worker, where a wrapper is awkward.

## Related

- XO card `a856b8c8`: the offer catalog holds a stale admin DB pool after a pool refresh, and
  `guarded()` hides the cause. Same catalog; separate fix.
- Capability decisions are cached for 30 seconds per tenant (`packages/core/src/lib/capability.ts`).
  Context and no-context paths currently share the cache key, so the answer can flip depending
  on which path warmed the cache.

## Commands

- Read effective catalog settings (master-tenant API key):
  `curl -X POST $BASE/api/v1/billing-catalog/operator -H "x-api-key: $KEY" -d '{"command":"inspect-account","args":[]}'`
- Check trial sponsor eligibility: `select * from co_managed_trial_sponsors where tenant = $1`
  (readable as `app_user`).

## Implementation notes (2026-11-22)

- **Request memo.** A "request" is one explicit `AsyncLocalStorage.run` scope: `runWithBillingCatalogContext` and
  EE `withBillingCatalogContext` (load once, then run). Unwrapped callers call the registered loader on every check.
  A lazy `enterWith` memo for unwrapped callers was built and rejected: in the T004 database test a slot entered
  inside one request was observed from an unrelated async chain once a lazily created shared resource (connection
  pool) had been touched inside it. On keep-alive HTTP connections the same attachment could carry a context into a
  later request. A context bleeding across requests defeats PR 4452's no-process-cache property, so the extra load
  per unwrapped check is accepted. The capability decision cache (30 s) already dedupes `admits()`.
- **`currentBillingCatalogContext()` is now async.** Its only readers were the gate and two tests.
- **Registered from:** `ee/server/src/instrumentation.ts` and `server/src/instrumentation.ts` (`@enterprise/...surfaceProbe`;
  the CE alias is a no-op, so CE keeps the env fallback). Registration runs before `initializeApp`.
- **F007 not done.** `ee/temporal-workflows/src/worker.ts` cannot import `surfaceProbe` today: it pulls
  `StripeService.ts` into the worker's `tsc -p tsconfig.build.json` graph, which reports 18 strict-mode type errors
  (e.g. `Record<string, any>` not assignable to `StripeSubscription`), and StripeService has never been in the
  worker's runtime graph. The worker keeps the legacy env fallback. Follow-up: make StripeService clean under the
  worker tsconfig, or extract an OfferCatalog factory that does not need it, then register in `worker.ts` and add
  it to the contract test list. T005 therefore covers the two server entries only and stays unimplemented.
- **Other processes.** `services/email-service` and `services/workflow-worker` register `co-managed-seat` but alias
  `@enterprise` to the CE stub (`packages/ee`), so they have no EE catalog and keep the env fallback. Not wired.
