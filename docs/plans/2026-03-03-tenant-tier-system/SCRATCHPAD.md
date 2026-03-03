# Scratchpad — Tenant Tier System

- Plan slug: `tenant-tiers`
- Created: `2026-03-03`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-03-03) NULL plan → error state (basic access + warning banner), NOT silent default to pro. Rationale: prevents accidentally granting expensive features; makes misconfigurations visible.
- (2026-03-03) No DB column DEFAULT on `plan`. NULL is intentional error state caught by the UI.
- (2026-03-03) CE tenants always get `plan: 'pro'` — CE has no Stripe/tiers, should never be gated.
- (2026-03-03) Temporal workflow updated in Phase A (not deferred). All EE tenant creation paths funnel through `createTenantInDB()`.
- (2026-03-03) Pre-map future Stripe product names (`alga-psa-basic`, `alga-psa-pro`, `alga-psa-premium`) so they work automatically when created.
- (2026-03-03) Three horizons: (1) Stripe product mapping now, (2) new Stripe products per tier later, (3) internal contracts way later.
- (2026-03-03) Plan throttle at 5 min (separate from session revocation check at 30s).
- (2026-03-03) Gated nav items hidden (not grayed out).

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
- (2026-03-03) `FeatureFlagContext` already has `subscriptionPlan` field — but tier system is separate from PostHog feature flags.
- (2026-03-03) License count gating uses `if (limit !== null && used >= limit)` — NULL = no limit. Tier gating is additive.

## Commands / Runbooks

- Verify migration: `SELECT tenant, plan FROM tenants WHERE plan IS NULL OR plan = '';` (should return 0 rows after migration)
- Test misconfigured state: `UPDATE tenants SET plan = NULL WHERE tenant = '<test-tenant-id>';`
- Test basic gating: `UPDATE tenants SET plan = 'basic' WHERE tenant = '<test-tenant-id>';`
- Inspect JWT: Browser DevTools → Application → Cookies → next-auth.session-token → decode at jwt.io
- Force session refresh: Call `refreshTier()` from TierContext or wait 5 min

## Links / References

- Detailed design reference: `.ai/tiers/tenant-tier-system-plan.md`
- Tenant model: `packages/db/src/models/tenant.ts`
- Auth types: `packages/auth/src/types/next-auth.ts`
- Auth options: `packages/auth/src/lib/nextAuthOptions.ts`
- Menu config: `server/src/config/menuConfig.ts`
- Sidebar: `server/src/components/layout/SidebarWithFeatureFlags.tsx`
- Layout client: `server/src/app/msp/MspLayoutClient.tsx`
- Tenant operations: `ee/temporal-workflows/src/db/tenant-operations.ts`
- Stripe service: `ee/server/src/lib/stripe/StripeService.ts`
- Account management: `ee/server/src/components/settings/account/AccountManagement.tsx`
- Registration: `packages/auth/src/actions/useRegister.tsx`
- Feature flags: `server/src/lib/feature-flags/featureFlags.ts`
- Edition check: `server/src/lib/features.ts`
- Dev seeds: `server/seeds/dev/01_tenants.cjs`
- Test factory: `server/test-utils/testDataFactory.ts`

## Tenant Creation Paths Coverage

| Path | How Plan Is Set | Phase |
|------|----------------|-------|
| Stripe checkout → Temporal workflow | `createTenantInDB()` resolves tier from Stripe product | A9 |
| Nine Minds reporting extension | Same Temporal workflow → same `createTenantInDB()` | A9 |
| Provisioning API | Same Temporal workflow | A9 |
| CE self-registration (`useRegister.tsx`) | `plan: 'pro'` in `Tenant.insert()` | A4 |
| Dev seeds | Already `plan: 'pro'` | — |
| Test data factory | `plan: 'test'` → `plan: 'pro'` | A5 |
| Migration backfill | NULL/empty → `'pro'` | A5 |

## Open Questions

- (resolved) NULL plan handling → error state with basic access + warning banner
- (resolved) CE mode → always Pro, never gated
- (resolved) Dev seeds → already set `plan: 'pro'`
- (resolved) Nine Minds extension → same Temporal workflow, covered by A9
