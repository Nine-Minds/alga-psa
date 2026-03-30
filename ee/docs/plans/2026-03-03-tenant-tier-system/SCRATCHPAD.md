# Scratchpad — Tenant Tier System

- Plan slug: `tenant-tiers`
- Created: `2026-03-03`
- Updated: `2026-03-05` (narrowed to 2-tier model: Pro/Premium)

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-03-05) **2-tier model only: Pro and Premium.** No basic tier — users who want only basic features can run the open-source CE. This simplifies the tier system significantly.
- (2026-03-05) **Existing customers grandfathered at Pro with $0 base fee.** They keep full access to all standard features.
- (2026-03-05) **Invoice Designer is the POC gated feature.** Only premium tenants get the visual drag-and-drop designer. Code view remains available to all.
- (2026-03-05) **Add-ons infrastructure built.** `tenant_addons` table + constants/utilities ready for future per-tenant purchasable features.
- (2026-03-05) **Phase C removed.** There's no basic tier to gate self-registration into.
- (2026-03-03) NULL plan → error state (pro access + warning banner), NOT a lower tier. Rationale: prevents accidentally restricting features for misconfigured customers.
- (2026-03-03) No DB column DEFAULT on `plan`. NULL is intentional error state caught by the UI.
- (2026-03-03) CE tenants always get `plan: 'pro'` — CE has no Stripe/tiers, should never be gated.
- (2026-03-03) Temporal workflow updated in Phase A (not deferred). All EE tenant creation paths funnel through `createTenantInDB()`.
- (2026-03-03) Pre-map future Stripe product names (`alga-psa-pro`, `alga-psa-premium`) so they work automatically when created.
- (2026-03-03) Three horizons: (1) Stripe product mapping now, (2) new Stripe products per tier later, (3) internal contracts way later.
- (2026-03-03) Plan throttle at 5 min (separate from session revocation check at 30s).

## Discoveries / Constraints

- (2026-03-03) `ITenant` already has `plan?: string` field — just needs narrowing to `TenantTier`.
- (2026-03-03) `Tenant.updatePlan(knex, tenant, plan)` already exists in `packages/db/src/models/tenant.ts`.
- (2026-03-03) Dev seeds at `server/seeds/dev/01_tenants.cjs` already set `plan: 'pro'` — no change needed.
- (2026-03-03) Test factory at `server/test-utils/testDataFactory.ts` sets `plan: 'test'` — needs update to `'pro'`.
- (2026-03-03) Two `buildAuthOptions` paths in `nextAuthOptions.ts` — BOTH must be updated (enterprise and non-enterprise).
- (2026-03-03) Nine Minds reporting extension → `/api/v1/tenant-management/create-tenant` → Temporal workflow → `createTenantInDB()`. Same path as Stripe checkout.
- (2026-03-03) Provisioning API (`/api/provisioning/tenants`) also uses Temporal workflow. Same path.
- (2026-03-03) CE AccountManagement stub returns null. Account page enhancements are EE-only.
- (2026-03-03) `isEnterprise` check in `server/src/lib/features.ts` uses `EDITION` / `NEXT_PUBLIC_EDITION` env vars.
- (2026-03-03) Existing `FeaturePlaceholder` component shows "under construction" — distinct from new `UpsellPlaceholder`.
- (2026-03-03) License count gating uses `if (limit !== null && used >= limit)` — NULL = no limit. Tier gating is additive.

## Commands / Runbooks

- Verify migration: `SELECT tenant, plan FROM tenants WHERE plan IS NULL OR plan = '';` (should return 0 rows after migration)
- Test misconfigured state: `UPDATE tenants SET plan = NULL WHERE tenant = '<test-tenant-id>';`
- Test premium gating: `UPDATE tenants SET plan = 'premium' WHERE tenant = '<test-tenant-id>';`
- Inspect JWT: Browser DevTools → Application → Cookies → next-auth.session-token → decode at jwt.io
- Force session refresh: Call `refreshTier()` from TierContext or wait 5 min

## Links / References

- Detailed design reference: `.ai/tiers/tenant-tier-system-plan.md`
- Tenant model: `packages/db/src/models/tenant.ts`
- Auth types: `packages/auth/src/types/next-auth.ts`
- Auth options: `packages/auth/src/lib/nextAuthOptions.ts`
- Layout client: `server/src/app/msp/MspLayoutClient.tsx`
- Tenant operations: `ee/temporal-workflows/src/db/tenant-operations.ts`
- Stripe service: `ee/server/src/lib/stripe/StripeService.ts`
- Account management: `ee/server/src/components/settings/account/AccountManagement.tsx`
- Registration: `packages/auth/src/actions/useRegister.tsx`
- Edition check: `server/src/lib/features.ts`
- Dev seeds: `server/seeds/dev/01_tenants.cjs`
- Test factory: `server/test-utils/testDataFactory.ts`

## Tenant Creation Paths Coverage

| Path | How Plan Is Set | Phase |
|------|----------------|-------|
| Stripe checkout → Temporal workflow | `createTenantInDB()` resolves tier from Stripe product | A |
| Nine Minds reporting extension | Same Temporal workflow → same `createTenantInDB()` | A |
| Provisioning API | Same Temporal workflow | A |
| CE self-registration (`useRegister.tsx`) | `plan: 'pro'` in `Tenant.insert()` | A |
| Dev seeds | Already `plan: 'pro'` | — |
| Test data factory | `plan: 'test'` → `plan: 'pro'` | A |
| Migration backfill | NULL/empty → `'pro'` | A |

## Implementation Log

### Phase A Complete (2026-03-03)
- Created `packages/types/src/constants/tenantTiers.ts` with TENANT_TIERS ['pro', 'premium'], TenantTier, TIER_LABELS, isValidTier(), resolveTier()
- Created `packages/types/src/constants/tierFeatures.ts` with TIER_FEATURES enum (INVOICE_DESIGNER), TIER_FEATURE_MAP, tierHasFeature(), FEATURE_MINIMUM_TIER
- Created `packages/types/src/constants/addOns.ts` with ADD_ONS enum (empty placeholder), tenantHasAddOn()
- Updated ITenant.plan to use TenantTier type in both interface files, added addons?: string[]
- Updated useRegister.tsx to set plan: 'pro' in both Tenant.insert() calls
- Created backfill migration: 20260303100000_backfill_tenant_plan_to_pro.cjs
- Created add-ons table migration: 20260305100000_create_tenant_addons.cjs
- Updated testDataFactory.ts: plan 'test' → 'pro'
- Updated next-auth types with plan in User, Session.user, and JWT interfaces
- Updated ExtendedUser interface in nextAuthOptions.ts
- Added plan fetching on initial sign-in in both buildAuthOptions paths
- Added 5-minute throttled plan refresh in JWT callback
- Added plan propagation from JWT to session in session callback
- Created TierContext with TierProvider and useTier() hook
- Wrapped MspLayoutClient content with TierProvider
- Created stripeTierMapping.ts with STRIPE_PRODUCT_TIER_MAP and tierFromStripeProduct()
- Wired tier resolution in createTenantInDB() from Stripe product
- Updated handleCheckoutCompleted() and handleSubscriptionUpdated() to set tenant plan

### Phase B Complete (2026-03-03)
- Created UpsellPlaceholder in `packages/ui/src/components/tier-gating/UpsellPlaceholder.tsx` with icon, heading, description, CTA to /msp/account
- Created TierGate client component in `server/src/components/tier-gating/TierGate.tsx` using TierContext
- Created ServerTierGate in `server/src/lib/tier-gating/ServerTierGate.tsx` reading session directly
- Created assertTierAccess utility with TierAccessError class in `server/src/lib/tier-gating/assertTierAccess.ts`
- Applied assertTierAccess to invoice template save/delete actions (invoiceTemplates.ts)
- Gated Invoice Designer visual tab in InvoiceTemplateEditor with canUseVisualDesigner prop
- Computed canUseVisualDesigner server-side in billing page from session tier
- Updated AccountManagement to use useTier() hook for tier display
- Added tier badge with TIER_LABELS[tier] to account page
- Added tier features list showing TIER_FEATURE_MAP[tier] features

### Tests Implemented (2026-03-03)
- T001-T011: Tier constants unit tests in `packages/types/src/constants/tenantTiers.test.ts`
- T012-T017: Tier features unit tests in `packages/types/src/constants/tierFeatures.test.ts`
- T018: Export verification in `packages/types/src/constants/tierExports.test.ts`
- T019: ITenant.plan type check in `packages/types/src/interfaces/tenant.interface.typecheck.test.ts`
- T020: Test data factory check in `server/src/test/unit/testDataFactory.test.ts`
- T021-T024: Stripe tier mapping tests in `ee/server/src/__tests__/unit/stripeTierMapping.test.ts`
- T025-T027: assertTierAccess tests in `server/src/lib/tier-gating/assertTierAccess.test.ts`
- Total: 28 unit tests implemented and passing (verified with `vitest run`)

### Remaining Tests (Integration/E2E)
The remaining tests require:
- Database connections for migration tests
- NextAuth session mocking for JWT/session tests
- React component rendering for UI tests
- Playwright for E2E tests
These are out of scope for initial unit test coverage and should be implemented as integration tests.

## Open Questions

- (resolved) NULL plan handling → error state with pro access + warning banner
- (resolved) CE mode → always Pro, never gated
- (resolved) Dev seeds → already set `plan: 'pro'`
- (resolved) Nine Minds extension → same Temporal workflow, covered by A8/A9
- (resolved, 2026-03-05) No basic tier → users wanting basic features use open-source CE
