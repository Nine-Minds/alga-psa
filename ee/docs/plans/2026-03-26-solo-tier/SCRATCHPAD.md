# Scratchpad — Solo Tier

- Plan slug: `solo-tier`
- Created: `2026-03-26`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-03-26) AI is a cross-tier add-on, not a tier feature. Even Pro users must purchase AI separately. This is the first real activation of the `ADD_ONS` enum which was previously scaffolded but empty.
- (2026-03-26) Mobile app access is gated to Pro+ via the `MOBILE_ACCESS` tier feature. Block happens at OTT exchange in `mobileAuthService.ts`, so Solo users never receive API tokens.
- (2026-03-26) No DB migration needed — `tenants.plan` is already an unconstrained text column, `tenant_addons` table already exists (migration `20260303100000`).
- (2026-03-26) `resolveTier()` keeps defaulting to `'pro'` for null/invalid — Solo is opt-in only, existing tenants are unaffected.
- (2026-03-26) No AI grandfathering needed — feature is brand new, no existing users have it.
- (2026-03-26) Solo trial: 7 days for new signups.
- (2026-03-26) Solo->Pro trial: available to established Solo customers (past their 7-day trial), duration 15–30 days TBD. Prevents trial stacking (can't trial Pro while still on Solo trial).
- (2026-03-26) Settings tabs stay visible but show `<FeatureUpgradeNotice>` instead of content — user can see what they're missing. Sidebar items with `requiredFeature` are hidden entirely.

## Discoveries / Constraints

- (2026-03-26) Current tier system: only `pro` and `premium` exist. 3 features gated at premium (ENTRA_SYNC, CIPP, TEAMS_INTEGRATION). No rank system — plan uses map lookup.
- (2026-03-26) `ADD_ONS` enum is empty, `tenantHasAddOn()` exists but is unused at runtime. `tenant_addons` table exists in DB.
- (2026-03-26) `TierContextValue` has: tier, isPro, isPremium, hasFeature, trial state, premium trial state, subscription status. No isSolo, no addOns.
- (2026-03-26) `MenuItem` interface has no `requiredFeature` field. Sidebar currently filters by RBAC permissions and PostHog feature flags only.
- (2026-03-26) Mobile auth: `exchangeOttForSession()` validates OTT + rate limiting but has zero tier checks. Solo users could currently auth to mobile.
- (2026-03-26) `getTierPriceIds()` returns `{ basePriceId: string; userPriceId: string }` — return type needs updating to allow `userPriceId: null` for Solo.
- (2026-03-26) Upgrade flow gated behind `'tier-upgrade-flow'` feature flag in AccountManagement.

## Commands / Runbooks

- Build shared packages: `npm run build:shared`
- Run unit tests: `npm run test:unit`
- Test Solo locally: Set tenant plan to 'solo' in DB: `UPDATE tenants SET plan = 'solo' WHERE tenant = '<id>'`
- Test AI add-on: Insert into tenant_addons: `INSERT INTO tenant_addons (tenant, addon_key, activated_at) VALUES ('<id>', 'ai_assistant', NOW())`

## Links / References

- Source plan: `.ai/tiers/solo-tier-implementation-plan.md`
- Tier constants: `packages/types/src/constants/tenantTiers.ts`
- Feature constants: `packages/types/src/constants/tierFeatures.ts`
- Add-on constants: `packages/types/src/constants/addOns.ts`
- Tier context: `server/src/context/TierContext.tsx`
- Tier gating: `server/src/lib/tier-gating/assertTierAccess.ts`
- Menu config: `server/src/config/menuConfig.ts`
- Sidebar: `server/src/components/layout/SidebarWithFeatureFlags.tsx`
- Settings page: `server/src/components/settings/SettingsPage.tsx`
- Mobile auth: `server/src/lib/mobileAuth/mobileAuthService.ts`
- Stripe service: `ee/server/src/lib/stripe/StripeService.ts`
- Stripe tier mapping: `ee/server/src/lib/stripe/stripeTierMapping.ts`
- License actions: `ee/server/src/lib/actions/license-actions.ts`
- Account management: `ee/server/src/components/settings/account/AccountManagement.tsx`
- User actions: `packages/users/src/actions/user-actions/userActions.ts`
- Grandfathering plan: `.ai/tiers/early-adopters-grandfathering.md`

## Resolved Questions

- (2026-03-26) No AI grandfathering — nobody has it yet, it's new. Addon-only from day one for all tiers.
- (2026-03-26) Solo gets 7-day free trial for new purchases.
- (2026-03-26) Established Solo customers (past their 7-day trial) can trial Pro features for 15–30 days (duration TBD). Not available during Solo trial.
- (2026-03-26) AI add-on pricing TBD — implement env var plumbing but price IDs won't be set at launch.

## Open Questions

- Solo->Pro trial duration: 15 or 30 days? (Awaiting final decision)
- (2026-03-26) Completed F001 feature: Add 'solo' to TENANT_TIERS array so it becomes ['solo', 'pro', 'premium']
- (2026-03-26) Completed F002 feature: Update TenantTier type to include 'solo'
- (2026-03-26) Completed F003 feature: Add TIER_LABELS entry: solo -> 'Solo'
- (2026-03-26) Completed F004 feature: Add TIER_RANK record: { solo: 0, pro: 1, premium: 2 }
- (2026-03-26) Completed F005 feature: Add tierAtLeast(tier, minimum) helper using TIER_RANK comparison
- (2026-03-26) Completed F006 feature: Add INTEGRATIONS to TIER_FEATURES enum with min tier 'pro'
