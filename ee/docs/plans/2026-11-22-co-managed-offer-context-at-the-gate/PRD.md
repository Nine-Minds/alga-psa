# PRD — Co-managed offer availability resolved at the gate

- Slug: `co-managed-offer-context-at-the-gate`
- Date: `2026-11-22`
- Status: Draft

## Summary

`isCoManagedPurchaseSurfaceOpen` answers "is co-managed sellable for this tenant?" from a
request-scoped `BillingCatalogContext` (AsyncLocalStorage). The context exists only when the caller
wraps its work in `withBillingCatalogContext`. Callers that forget fall back to the legacy
`STRIPE_CO_MANAGED_USER_PRICE_ID` environment variable. On a deployment where the catalog lives
in the database and that variable is unset, every unwrapped caller reports "not sellable".
Nothing reports an error. The whole 15-day hosted Seat trial is hidden or refused as a result.

Make the gate resolve the context itself, so a caller cannot get a different answer by
forgetting a wrapper.

## Problem

Two PRs crossed:

- PR 4444 (15-day hosted co-managed Seat trial) was written against the old model. In that
  model, EE registered an offer-availability probe with `@alga-psa/licensing` once per process,
  so any caller of `isCoManagedPurchaseSurfaceOpen` got the catalog answer.
- PR 4452 (persist Stripe catalog accounts) removed that registration. It replaced it with
  `withBillingCatalogContext`, which loads the account and price per request with no process
  cache, and wrapped only the purchase paths. Those are the sidebar discovery, the preview,
  the purchase and the server `coManagedActions`.

The trial callers that run outside any context:

| Caller | Effect when the env var is unset |
| --- | --- |
| `ee/server/src/lib/actions/coManagedSeatTrialActions.ts` `getSeatTrialOfferAction` | Returns null, so the trial card renders nothing |
| `coManagedSeatTrialActions.ts` `withTrialIntake` (every trial mutation) | Throws "Trial intake is closed" |
| `ee/server/src/lib/co-managed/seatTrialDiscovery.ts` `canDiscoverSeatTrial` | Trial root access and sidebar discovery are false |
| `packages/co-managed/src/seatCapability.ts` `isCoManagedSeatEligible` | `admits('co-managed-seat')` is false through the trial path. Callers include `shared/lib/humanWork/seatEffortSummary.ts` and the Temporal worker |

Observed in production on 2026-11-22, on the 1.6.20 deploy (merge of PR 4475, staged on the
idle color). The tenant was an eligible trial sponsor: hosted Pro, an active base subscription,
no prior trial, and a catalog account and price persisted in `stripe_offer_catalog_settings`.
It saw the purchase pool but no trial card. The previous color had worked only because the
env var had been set by hand on its deployment, outside Helm.

There is a second, quieter hazard. Capability decisions are cached for 30 seconds per tenant.
An `admits('co-managed-seat')` computed inside a context and one computed outside it share a
cache key. So the same tenant can get either answer, depending on which path warmed the cache.

## Goals

1. Every caller of `isCoManagedPurchaseSurfaceOpen`, and of everything built on it, gets the
   catalog-backed answer whether or not it established a context.
2. Get the 15-day Seat trial working again on a deployment configured only through the
   database catalog.
3. Make a future omission impossible by construction, not by review.
4. Keep PR 4452's property: no process-lifetime cache of the account and price. They are read
   per request, so an operator's `set-account` takes effect without a restart.

## Non-goals

- Changing trial eligibility rules, the trial length or the purchase flow.
- The stale admin pool held by `StripeService.offerCatalogInstance`. That is XO card `a856b8c8`.
- Logging the error that `guarded()` hides. That is also card `a856b8c8`. This plan only makes
  sure a context load failure is not silent (see F009).
- Removing `STRIPE_CO_MANAGED_USER_PRICE_ID` support for CE and self-hosted deployments.

## Users and Primary Flows

- **Hosted Pro MSP admin, no seats yet:** opens Co-managed IT and sees the purchase pool *and*
  the 15-day trial card. They pick a client and invite one technician, and the trial starts
  when the technician accepts.
- **The same admin during a trial:** sees status, can replace the technician, cancel, or buy a
  seat to convert.
- **Background and shared code** (Temporal worker, human-work summaries): `admits('co-managed-seat')`
  returns the same answer as a browser request.

## UX / UI Notes

No UI change. The trial card (`CoManagedSeatTrial`) already renders when
`getSeatTrialOfferAction` returns an offer.

## Requirements

### Functional Requirements

- **Licensing owns resolution.** `@alga-psa/licensing` exposes
  `registerBillingCatalogContextLoader(loader)`. `currentBillingCatalogContext()` and
  `isCoManagedPurchaseSurfaceOpen` resolve the context in this order:
  1. The active AsyncLocalStorage store.
  2. The registered loader. The result is memoised for the rest of the request when a store
     can be entered, and never across requests.
  3. Only when no loader is registered (CE, or self-hosted without the EE catalog), the legacy
     env var.
- **EE registers the loader.** `surfaceProbe.ts` registers `loadBillingCatalogContext` as a side
  effect. It is imported from every EE entry that can reach the gate: the server instrumentation
  or EE bootstrap, and the Temporal worker.
- **No env fallback when a loader is registered.** If the loader fails, the gate reports "not
  sellable".
- **The wrapper becomes optional.** `withBillingCatalogContext` stays as a per-request memo, so a
  request that checks the gate several times loads once. Correctness no longer depends on it.
  The existing callers keep working unchanged.
- **Same answer everywhere.** The trial callers listed above return the same decision as the
  sidebar for the same tenant, with no code change at those call sites.

### Non-functional Requirements

- At most one catalog context load per request in the common page render, the same as today
  for wrapped paths.

## Data / API / Integrations

No schema or API change. The context is read from `stripe_offer_catalog_settings` and
`stripe_offer_versions` through the existing `OfferCatalog`.

## Security / Permissions

No change. Permission checks in the trial and purchase actions stay where they are.

## Observability

`loadBillingCatalogContext` currently catches every error and returns an unsellable context.
Log the caught error once per process per error code, with no tenant data in the message, so a
hidden trial or purchase surface can be traced from logs.

## Rollout / Migration

- No migration and no flag. Ship it in the next deploy.
- Once it ships, the hand-added `STRIPE_CO_MANAGED_USER_PRICE_ID` and `STRIPE_ACCOUNT_ID` on the
  hosted deployment are no longer needed. Remove them, or move them into Helm values, so the
  two colors cannot differ again.

## Open Questions

1. Should the Temporal worker register the loader? It runs the `co-managed-seat` capability
   resolvers. Proposed: yes. Its decisions must match the web server's.
2. Should the capability decision cache key include whether a context was present? Proposed:
   no. Once the gate always resolves the same way, the key is correct again.

## Acceptance Criteria (Definition of Done)

- With `STRIPE_CO_MANAGED_USER_PRICE_ID` and `STRIPE_ACCOUNT_ID` unset and the account and price
  persisted in the database catalog, an eligible hosted Pro tenant with no seats sees the trial
  card. It can start a trial (`prepareCoManagedSeatTrialAction`), and `admits('co-managed-seat')`
  is admitted.
- `isCoManagedPurchaseSurfaceOpen` returns the same value with and without a surrounding
  `withBillingCatalogContext`.
- With a loader registered and the catalog unconfigured, the gate is closed even if the legacy
  env var is set.
- CE, with no loader, keeps the legacy env behaviour.
- A failing context load is logged.
