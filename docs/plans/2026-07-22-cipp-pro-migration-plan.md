# CIPP → Pro Tier Migration — Implementation Plan

**Date:** 2026-07-22
**Branch:** `feature/cipp-pro-migration`
**Status:** Draft implemented

## Intent

Move the entire Microsoft 365 / Entra integration baseline — connect (Direct **and** CIPP), tenant discovery, client mapping, user→contact sync, field sync, reconciliation queue — from Premium / Enterprise-add-on down to the **Pro tier**. Reinstate the CIPP connection option in the UI, gated by **PostHog flag + tier** for a soft launch. Leave all add-on machinery **dormant but intact** for the future per-client-tenant metered product (strategy: `nineminds-vault/Inbox/2026-07-22-m365-per-tenant-metering-strategy.md`).

**Explicitly out of scope:** per-tenant metering, license reconciliation, contract-change drafts, CIPP Pro API endpoints/auth modernization, grandfathering/refunds of existing Enterprise add-on subscriptions (billing ops), Teams add-on changes, CE edition changes.

## Key discovery that shapes the diff

The server-side gate for all Entra routes is **not** `TIER_FEATURES.ENTRA_SYNC` — it is `assertAddOnAccess(ADD_ONS.ENTERPRISE)` in `ee/server/src/app/api/integrations/entra/_guards.ts`. `ENTRA_SYNC`/`CIPP` tier features currently only drive UI display. The migration is therefore: one guard swap server-side, constant changes in the tier map, and re-wiring two UI gates that already receive the right inputs but ignore them.

## Changes

### 1. Tier model — `packages/types/src/constants/tierFeatures.ts`

- `FEATURE_MINIMUM_TIER[ENTRA_SYNC]`: `'premium'` → `'pro'`
- `FEATURE_MINIMUM_TIER[CIPP]`: `'premium'` → `'pro'`
- Remove `TIER_FEATURES.ENTRA_SYNC` from `ADD_ON_ONLY_FEATURES` (it becomes a normal Pro tier feature, included in `TIER_FEATURE_MAP` for pro/premium).
- **Do not touch:** `TEAMS_INTEGRATION` (stays add-on-only), the `ADD_ON_ONLY_FEATURES` mechanism itself, `assertAddOnAccess`, `ADD_ONS.ENTERPRISE`, `tenantHasAddOn`, the tenant add-ons table, Stripe price mappings in `ee/server/src/lib/stripe/StripeService.ts`. All dormant plumbing for the future metered product.

### 2. Server route guard — `ee/server/src/app/api/integrations/entra/_guards.ts`

- In `requireEntraUiFlagEnabled`, replace `await assertAddOnAccess(ADD_ONS.ENTERPRISE)` with `await assertTierAccess(TIER_FEATURES.ENTRA_SYNC)`.
- Keep the existing try/catch shape: `TierAccessError` → 403 "Microsoft Entra integration is not available for this workspace." `AddOnAccessError` import/handling may be dropped from this file only if it becomes unused; unexpected errors must still rethrow (existing behavior, locked by test).
- This single swap opens every Entra route (connect, validate, discovery, mappings, sync, reconciliation queue) to Pro+ tenants. The `entra-integration-ui` PostHog master flag and EE edition gating are unchanged.

### 3. Integrations settings body — `server/src/app/msp/settings/integrations/IntegrationsSettingsBody.tsx`

- Replace `const canUseEntraSync = hasAddOn(ADD_ONS.ENTERPRISE)` with `const canUseEntraSync = useTierFeature(TIER_FEATURES.ENTRA_SYNC)`.
- `canUseCipp = useTierFeature(TIER_FEATURES.CIPP)` is already correct (line 13) — after change #1 it yields true for Pro+.
- `canUseTeams` stays on `hasAddOn(ADD_ONS.TEAMS)`.

### 4. CIPP UI reinstatement — `ee/server/src/components/settings/integrations/entraIntegrationSettingsGates.ts`

- `buildEntraConnectionOptions(isCippEnabled)` honors its parameter again: return `[DIRECT_CONNECTION_OPTION, CIPP_CONNECTION_OPTION]` when true, `[DIRECT_CONNECTION_OPTION]` when false. Replace the descope comment with a note that CIPP is gated by `entra-integration-cipp` flag + `TIER_FEATURES.CIPP` tier.
- **No other UI change needed.** `EntraIntegrationSettings.tsx:239` already computes `buildEntraConnectionOptions(cippFlag.enabled && canUseCippTier)`; the connect dialog, CIPP status display, discovery/mapping/sync flows are all CIPP-aware and live in EE only.
- PostHog flag `entra-integration-cipp` stays default-off; soft launch is an ops action (flip per-tenant, then globally).

### 5. Account Management add-ons — `ee/server/src/components/settings/account/AccountManagement.tsx`

- The `ADD_ONS.ENTERPRISE` card (line ~887) offers purchase of an add-on that after this migration grants nothing extra. Change the card list so the Enterprise card is shown **only when the add-on is already active** for the tenant (existing subscribers keep their "active" state and cancel path); do not offer it for new purchase.
- Keep the `ADD_ONS.ENTERPRISE` enum, labels, descriptions, Stripe price config, and i18n keys in place (dormant). The tier-feature display entries (`features.entraSync`, `features.cipp`, lines 72–73) now naturally show as included for Pro+ — verify the labels read correctly in that context.

### 6. Tests — update what locked the old behavior

| File | Change |
|---|---|
| `packages/types/src/constants/tierFeatures.test.ts` | Min tiers now `pro` for `ENTRA_SYNC`/`CIPP`; `tierHasFeature('pro', …)` → true for both; `TIER_FEATURE_MAP` pro/premium include both; `ENTRA_SYNC` no longer excluded as add-on-only. |
| `server/src/test/unit/integrations/entraAddOnGuard.test.ts` | Semantics invert. T103 becomes: guard passes for a tenant whose **tier** assertion passes, with **no** add-on assertion made; solo/tier-failure → 403 with the same error body; unexpected errors still rethrow. T104 becomes: premium tier alone still does **not** unlock `TEAMS_INTEGRATION` (control), and `ENTRA_SYNC` is now tier-unlocked. Rename the file/describes if the add-on framing no longer fits (e.g. `entraTierGuard.test.ts`). |
| `ee/server/src/__tests__/unit/entraIntegrationSettingsGates.test.ts` | Invert: CIPP option appears when `isCippEnabled` is true, hidden when false. |
| `server/src/test/unit/context/TierContext.test.tsx` | Audit line ~129 (`hasFeature(TIER_FEATURES.ENTRA_SYNC)`) — update fixture expectations for the new tier mapping. |
| `packages/types/src/constants/tierExports.test.ts` | Audit for ENTRA_SYNC assumptions. |

Unaffected: `cippProviderAdapter.normalization.test.ts`, `entraValidateCippRoute.test.ts`, `entraProviderFactory.test.ts`, `entraSecretKeys.test.ts`, `entraActions.directConnect.test.ts`, all addOns constants tests, Teams guard tests.

**New test worth adding:** a guard test asserting a **Pro tier tenant with no add-ons** passes `requireEntraUiFlagEnabled` — this is the behavior the branch exists to create.

### 7. Docs

- `docs/tier-gating-guide.md` — move `CIPP`/`ENTRA_SYNC` rows to Pro; add a short "Dormant add-on plumbing" note: `ADD_ONS.ENTERPRISE`, `assertAddOnAccess`, and the Stripe price config are retained intentionally for the future per-client-tenant metered product (see vault strategy note); do not delete them as "dead code."
- `ee/docs/guides/entra-integration-phase-1.md` — the CIPP section is stale (documents classic CIPP setup, PRD descoped it). Update to describe: CIPP available at Pro tier, behind `entra-integration-cipp` flag; connection via base URL + API token; classic CIPP API.

## Audit step (first task for the implementer)

Before editing, run a fresh sweep to confirm no enforcement point was missed:

```
grep -rn "ADD_ONS.ENTERPRISE\|TIER_FEATURES.ENTRA_SYNC\|TIER_FEATURES.CIPP" \
  ee/server/src server/src packages --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Every hit must be either (a) changed per this plan, (b) verified UI-display-only, or (c) deliberately dormant add-on machinery. As of 2026-07-22 the known non-test hits are exactly the files listed above.

## Verification

1. `npm run test` (or targeted vitest runs) for all touched test files; full tier-gating + integrations suites green.
2. Typecheck EE + CE (`@enterprise` resolves to `ee/server` in EE, `packages/ee` stubs in CE — CE is untouched and must stay green).
3. i18n parity check (no keys added or removed; the Enterprise card keys stay).
4. Manual smoke on the dev server (port 3164): with a Pro-tier tenant and `entra-integration-ui` on —
   a. flag `entra-integration-cipp` off → only "Direct Microsoft Partner" offered;
   b. flag on → CIPP option appears; connect dialog accepts base URL + token; validation runs; status shows `cippBaseUrl`.
5. Confirm a Solo-tier tenant still gets 403 from Entra routes and no Entra UI.

### CIPP emulator follow-up

Build later CIPP smoke and integration automation around a small, deterministic CIPP
API emulator rather than requiring a live CIPP deployment for every run. Follow the
same test-double approach used by the QuickBooks harnesses and the checked-in
`test-harness/graph-emulator/`:

- Add a growable `test-harness/cipp-emulator/` with a standalone server, Compose
  entry point, seeded fixtures, README, and self-contained smoke test.
- Start with the classic CIPP endpoints the current adapter calls for managed
  tenants and tenant users. Emulate static-token authorization, representative
  response shapes, pagination if the live API requires it, and deterministic
  authentication/rate-limit/server failures.
- Point the existing configurable CIPP base URL at the emulator; do not add a
  production-only bypass or weaken token validation for tests.
- Use emulator-backed automation for connect/validate, discovery, mapping, and
  sync flows. Keep one opt-in live-CIPP smoke as a fidelity check before rollout.

The emulator itself is not required for this tier-gating draft, but it is the
preferred prerequisite for expanding CIPP smoke coverage beyond the focused unit
tests in this branch.

## Rollout

1. Merge with `entra-integration-cipp` default-off everywhere (Pro tier access to Direct path goes live immediately — intended).
2. Ops: enable flag for internal/early tenants, validate CIPP connect → discover → map → sync end-to-end against a real CIPP instance.
3. Enable flag globally.
4. Billing ops (separate): handle existing Enterprise add-on subscriptions (the add-on becomes inert; subscribers keep active state/cancel path in the UI).

## Risks / notes

- **Direct path becomes Pro on merge** (no flag on it). That's the intent ("everything into Pro"), but it is a packaging change that takes effect at deploy, not at flag flip.
- **Grandfathering is unresolved by design** — existing Enterprise add-on subscribers see no functional change; billing treatment is an ops decision tracked in the vault note.
- The `entra-integration-cipp` flag must exist in PostHog bootstrap (it is already read in `EntraIntegrationSettings.tsx`); confirm it's registered for the environments before smoke testing.
- Do not "clean up" the dormant add-on machinery — it is the substrate for the metered follow-up. If a future agent is tempted, the tier-gating guide note (change #7) is the guardrail.
