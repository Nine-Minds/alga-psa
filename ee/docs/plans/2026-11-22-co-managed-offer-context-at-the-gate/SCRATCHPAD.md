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

## Repair round: once per request at the entry points (2026-11-23, PR 4476 review)

- **Finding.** Unwrapped gate callers ran the loader (a Stripe price retrieve) on every check; one `/msp/co-managed`
  view measured 9 price lookups plus 1 subscription lookup. F004/T003 had been marked implemented on the strength of
  `runWithBillingCatalogContext` in isolation, which no entry point used.
- **Mechanism.** `runWithBillingCatalogRequest(work)` (licensing) opens an explicit `AsyncLocalStorage.run` scope
  holding an empty slot. It is lazy: the first gate check in the scope calls the loader and stores the pending promise
  in the scope's own holder, later and concurrent checks share it, and the scope ends with the work. An entry that never
  reaches the gate loads nothing. It joins a scope that is already open. A pinned `runWithBillingCatalogContext` still
  wins. This is not the rejected `enterWith`: the holder is created by `run` and cannot attach to a long-lived resource.
  The gate itself still memoises nothing without a scope.
- **Where it is opened.** `withAuth`, `withOptionalAuth` and `withAuthCheck` (every server action, one place; auth
  already depended on licensing, imported through the light `@alga-psa/licensing/billing-catalog-scope`), and
  `resolveCoManagedRootAccess` (server/src/lib/co-managed/commercialAccess.ts), which the layout, page and
  `generateMetadata` already share through React `cache()`, so the render makes one load. EE `withBillingCatalogContext`
  now joins an open scope instead of loading a second time.
- **Test.** `ee/server/src/__tests__/unit/coManagedCatalogLoadsPerRequest.test.ts` uses the real `withAuth`, real action
  bodies, real `isCoManagedSeatEligible`/capability engine (cache off) and a counting stub loader: 1 load per request
  for `getSeatTrialOfferAction`, `prepareCoManagedSeatTrialAction`, `getCoManagedPurchaseDiscoveryAction` and
  `resolveCoManagedRootAccess` (>=2 gate checks each), 1 more on a second request. With the scope disabled 6 of its 8
  cases fail.
- **One page view is several requests.** The server render is one scope (1 load). The client then makes its own
  server-action requests, each its own scope and its own load: the sidebar `getCoManagedPurchaseDiscoveryAction`
  (every page), `getSeatTrialOfferAction` from `CoManagedSeatTrial`, and `hasSeatTrialRecoveryAction` from client tabs
  (which returns before the gate when a `clientId` is given). So the overview trial view is about 3 loads, not 1.
  A single request-wide memo across them would be a cross-request cache and is deliberately not built.
- **Worker check.** `cd ee/temporal-workflows && npm run check:billing-catalog-loader -- --tenant <uuid>` imports the
  worker's own `workerRegistration` and prints the loader context plus `admits('co-managed-seat')`. It needs `DB_*`,
  a Stripe key (`STRIPE_SECRET_KEY`, plus `STRIPE_API_BASE_URL` for an emulator) and, with no PostHog,
  `FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE=<tenant>`. Exit 0 admitted, 1 closed.
- **Not covered.** API route handlers, other page renders and Temporal activities do not open a scope, so each gate check
  there loads per check; each such entry makes one or two checks. Candidates if they show up in measurements.

## Repair round 2: one Stripe price read per request, render included (2026-11-23, Implement)

- **Measured first.** The previous round (8ace84ebb4) was measured live for the first time: one cold `/msp/co-managed`
  trial view as tenant A against the card's Stripe emulator still made 9 Stripe requests (8 price, 1 subscription).
  Attribution by timing against the client's server-action requests: render 2, `getCoManagedPurchaseDiscoveryAction` 1,
  `getSeatTrialOfferAction` 3, `getCoManagedPurchaseState` 1, `previewCoManagedSeatsAction` 1 price + 1 subscription.
- **Why the scope was not enough.** (1) The context load is not the only price read: `StripeService.coManagedSeatPrice`
  called `resolveCurrentOffer` (a Stripe read) and then read the same price again, so a scoped action still made 3.
  (2) The server render is not one async call: the root layout's `resolveCapabilityBootstrap` evaluates
  `admits('co-managed-seat')`, which reaches the gate outside `resolveCoManagedRootAccess`'s scope, so the render loaded twice.
- **Mechanism.** Licensing's request scope now also memoises other catalog reads: `memoiseInBillingCatalogRequest(key, work)`
  (once per scope, concurrent and failed calls share the promise; per call with no scope) and
  `forgetBillingCatalogRequest()` (drops the memo and a lazily loaded context; a pinned context stays). The EE offer catalog
  returns `resolveCurrentOffer` memoised under `offer-catalog:current-offer:<key>:<interval>` (keyed by fact, not instance,
  since Next can hold one StripeService per bundle) and wraps `setAccountSetting`/`publishBinding`/`pauseSales` to forget
  afterwards, success or not. The context loader already resolves through `resolveCurrentOffer`, so the gate and every
  display/preview/purchase read in the request share one Stripe read. `coManagedSeatPrice` now returns the resolved offer's
  terms: `resolveCurrentOffer` already validated the price as an active monthly licensed per-unit price in the catalog's
  account (a superset of `assertCoManagedPrice`'s shape checks); only the recognition check remains.
- **Render scope.** `registerBillingCatalogRenderScope(slot)`: the server registers `cache(() => ({}))` from
  `server/src/lib/co-managed/billingCatalogRenderScope.ts`, imported by the root layout (React `cache` is request-scoped
  only in the server-component layer). The active scope is the explicit ALS store, else the render slot. Outside a render
  React `cache` returns a new object per call; the slot is called twice and only a stable holder counts, so it can never
  become a process cache. `runWithBillingCatalogRequest` inside a render runs on the render's holder (joins it).
- **Measured after.** Same view, same method: 6 Stripe requests (5 price, 1 subscription). Render 1, discovery 1, seat trial
  offer 1, purchase state 1, preview 1 + subscription list. Repeated twice, same result. Pause -> the overview renders
  not-found; restore -> back (fail-closed intact). A page view is still five requests (one render, four client server
  actions) that each read the price once; one read per page view would need a cross-request cache or the render handing
  that data to the client components. Neither was built.
- **Measuring on the dev server.** The emulator's `GET :9826/control/stripe/requests` is a 1000-entry ring buffer: diff by
  `sequence`, not by array index. After a dev-server restart Turbopack's lazy compiles push HMR updates that full-reload a
  headless page in a loop (seen as hundreds of aborted navigations, and once a dev-server OOM); the measuring browser proxies
  `/_next/hmr` and drops update messages.
- **Card DB.** `app_user`'s password in the card Postgres no longer matched `secrets/db_password_server` (sign-in failed with
  CredentialsSignin, `initializeApp` failed at boot), most likely because a DB test run against port 5826 reset the
  cluster-wide role. Reset it to the checkout's secret.

## Implementation notes (2026-11-22)

- **Request memo (superseded by the repair round above: entry points now open the scope).** A "request" is one explicit `AsyncLocalStorage.run` scope: `runWithBillingCatalogContext` and
  EE `withBillingCatalogContext` (load once, then run). Unwrapped callers call the registered loader on every check.
  A lazy `enterWith` memo for unwrapped callers was built and rejected: in the T004 database test a slot entered
  inside one request was observed from an unrelated async chain once a lazily created shared resource (connection
  pool) had been touched inside it. On keep-alive HTTP connections the same attachment could carry a context into a
  later request. A context bleeding across requests defeats PR 4452's no-process-cache property, so the extra load
  per unwrapped check is accepted. The capability decision cache (30 s) already dedupes `admits()`.
- **`currentBillingCatalogContext()` is now async.** Its only readers were the gate and two tests.
- **Registered from:** `ee/server/src/instrumentation.ts` and `server/src/instrumentation.ts` (`@enterprise/...surfaceProbe`;
  the CE alias is a no-op, so CE keeps the env fallback). Registration runs before `initializeApp`.
- **Temporal worker (F007).** `worker.ts` `main()` imports `@ee/lib/stripe/offerCatalog/workerRegistration` next to the
  write-admission install, fail-open (logged, boot continues, gate keeps the env fallback). `surfaceProbe` imports
  StripeService, which does not typecheck under the worker's strict tsconfig, so the loader was split:
  `catalogContext.ts` (`loadBillingCatalogContextFrom(getCatalog)`, logging), `catalogFactory.ts` (the one
  `createBillingOfferCatalog` composition, also used by `StripeService.getOfferCatalog()`, plus
  `resolveStripeSecretKey`, also used by `getStripeConfig`), `surfaceProbe.ts` (server: passes StripeService's
  catalog) and `workerRegistration.ts` (worker: builds a Stripe client from the same key resolution and override,
  opens a fresh admin connection per load, holds no instance). Registration lives in `main()`, so importing
  `worker.ts` alone does not register; the contract test checks the try-guarded import. Also added
  `@alga-psa/tenancy/server/*` to the worker tsconfig paths: `verify-alias-rewrites` failed on
  `analyticsSettings.js` before this change, so `build:ts` could not pass at all.
- **Other processes.** `services/email-service` and `services/workflow-worker` register `co-managed-seat` but alias
  `@enterprise` to the CE stub (`packages/ee`), so they have no EE catalog and keep the env fallback. Not wired.
