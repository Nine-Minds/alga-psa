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
- (2026-03-26) Completed F007 feature: Add EXTENSIONS to TIER_FEATURES enum with min tier 'pro'
- (2026-03-26) Completed F008 feature: Add MANAGED_EMAIL to TIER_FEATURES enum with min tier 'pro'
- (2026-03-26) Completed F009 feature: Add SSO to TIER_FEATURES enum with min tier 'pro'
- (2026-03-26) Completed F010 feature: Add ADVANCED_ASSETS to TIER_FEATURES enum with min tier 'pro'
- (2026-03-26) Completed F011 feature: Add CLIENT_PORTAL_ADMIN to TIER_FEATURES enum with min tier 'pro'
- (2026-03-26) Completed F012 feature: Add WORKFLOW_DESIGNER to TIER_FEATURES enum with min tier 'pro'
- (2026-03-26) Completed F013 feature: Add MOBILE_ACCESS to TIER_FEATURES enum with min tier 'pro'
- (2026-03-26) Completed F014 feature: Rewrite tierHasFeature() to use TIER_RANK comparison instead of map lookup
- (2026-03-26) Completed F015 feature: Derive TIER_FEATURE_MAP from FEATURE_MINIMUM_TIER + TIER_RANK
- (2026-03-26) Completed F016 feature: Add AI_ASSISTANT to ADD_ONS enum
- (2026-03-26) Completed F017 feature: Add ADD_ON_LABELS record with AI_ASSISTANT -> 'AI Assistant'
- (2026-03-26) Completed F018 feature: Add ADD_ON_DESCRIPTIONS with marketing-friendly description for AI_ASSISTANT
- (2026-03-26) Completed F019 feature: resolveTier() returns 'pro' for null/invalid input (unchanged behavior, Solo is opt-in)
- (2026-03-26) Completed F020 feature: isValidTier('solo') returns true
- (2026-03-26) Completed F021 feature: Create getActiveAddOns(tenantId) service querying tenant_addons for non-expired add-ons
- (2026-03-26) Completed F022 feature: Create assertAddOnAccess(addOn) that throws if tenant lacks the add-on
- (2026-03-26) Completed F023 feature: assertAddOnAccess bypasses check in CE edition (all add-ons unlocked)
- (2026-03-26) Completed F025 feature: Add isSolo boolean to TierContextValue (tier === 'solo')
- (2026-03-26) Completed F026 feature: Add addOns array to TierContextValue populated from session/DB
- (2026-03-26) Completed F027 feature: Add hasAddOn(addOn) helper to TierContextValue
- (2026-03-26) Completed F028 feature: CE edition bypasses add-on checks (hasAddOn returns true for all)
- (2026-03-26) Completed F029 feature: Add requiredFeature?: TIER_FEATURES to MenuItem interface in menuConfig
- (2026-03-26) Completed F030 feature: Annotate Extensions menu item with requiredFeature: TIER_FEATURES.EXTENSIONS
- (2026-03-26) Completed F031 feature: Annotate Workflow Editor subitem with requiredFeature: TIER_FEATURES.WORKFLOW_DESIGNER
- (2026-03-26) Completed F032 feature: SidebarWithFeatureFlags filters out menu items where requiredFeature is set and tier lacks it
- (2026-03-26) Completed F033 feature: Sidebar filtering applies recursively to subItems
- (2026-03-26) Completed F034 feature: Add requiredFeature?: TIER_FEATURES to TabContent type in SettingsPage
- (2026-03-26) Completed F035 feature: Tag Integrations settings tab with TIER_FEATURES.INTEGRATIONS
- (2026-03-26) Completed F036 feature: Tag Extensions settings tab with TIER_FEATURES.EXTENSIONS
- (2026-03-26) Completed F037 feature: Tag Email settings tab with TIER_FEATURES.MANAGED_EMAIL
- (2026-03-26) Completed F038 feature: Render FeatureUpgradeNotice instead of content when tab's requiredFeature is gated
- (2026-03-26) Completed F039 feature: Gated settings tabs remain visible and clickable (not hidden)
- (2026-03-26) Completed F040 feature: Settings sidebar items remain visible regardless of tier (no requiredFeature filtering in settings mode)
- (2026-03-26) Completed T001 test: isValidTier('solo') returns true
- (2026-03-26) Completed T002 test: isValidTier('pro') and isValidTier('premium') still return true
- (2026-03-26) Completed T003 test: isValidTier('invalid') returns false
- (2026-03-26) Completed T004 test: TENANT_TIERS contains ['solo', 'pro', 'premium'] in order
- (2026-03-26) Completed T005 test: TIER_LABELS.solo equals 'Solo'
- (2026-03-26) Completed T006 test: TIER_RANK maps solo=0, pro=1, premium=2
- (2026-03-26) Completed T007 test: tierAtLeast('solo', 'solo') returns true
- (2026-03-26) Completed T008 test: tierAtLeast('solo', 'pro') returns false
- (2026-03-26) Completed T009 test: tierAtLeast('pro', 'solo') returns true
- (2026-03-26) Completed T010 test: tierAtLeast('premium', 'pro') returns true
- (2026-03-26) Completed T011 test: tierAtLeast('pro', 'premium') returns false
- (2026-03-26) Completed T012 test: resolveTier('solo') returns { tier: 'solo', isMisconfigured: false }
- (2026-03-26) Completed T013 test: resolveTier(null) defaults to { tier: 'pro', isMisconfigured: false }
- (2026-03-26) Completed T014 test: resolveTier('invalid') defaults to pro with isMisconfigured: true
- (2026-03-26) Completed T015 test: tierHasFeature('solo', INTEGRATIONS) returns false
- (2026-03-26) Completed T016 test: tierHasFeature('pro', INTEGRATIONS) returns true
- (2026-03-26) Completed T017 test: tierHasFeature('premium', INTEGRATIONS) returns true
- (2026-03-26) Completed T018 test: tierHasFeature('solo', EXTENSIONS) returns false
- (2026-03-26) Completed T019 test: tierHasFeature('pro', EXTENSIONS) returns true
- (2026-03-26) Completed T020 test: tierHasFeature('solo', MANAGED_EMAIL) returns false
- (2026-03-26) Completed T021 test: tierHasFeature('solo', SSO) returns false
- (2026-03-26) Completed T022 test: tierHasFeature('solo', ADVANCED_ASSETS) returns false
- (2026-03-26) Completed T023 test: tierHasFeature('solo', CLIENT_PORTAL_ADMIN) returns false
- (2026-03-26) Completed T024 test: tierHasFeature('solo', WORKFLOW_DESIGNER) returns false
- (2026-03-26) Completed T025 test: tierHasFeature('solo', MOBILE_ACCESS) returns false
- (2026-03-26) Completed T026 test: tierHasFeature('pro', MOBILE_ACCESS) returns true
- (2026-03-26) Completed T027 test: tierHasFeature('solo', ENTRA_SYNC) returns false (premium feature)
- (2026-03-26) Completed T028 test: tierHasFeature('pro', ENTRA_SYNC) returns false (premium feature)
- (2026-03-26) Completed T029 test: tierHasFeature('premium', ENTRA_SYNC) returns true
- (2026-03-26) Completed T030 test: TIER_FEATURE_MAP['solo'] is empty array (no features at solo level)
- (2026-03-26) Completed T031 test: TIER_FEATURE_MAP['pro'] contains all 8 pro-minimum features
- (2026-03-26) Completed T032 test: TIER_FEATURE_MAP['premium'] contains all 11 features (8 pro + 3 premium)
- (2026-03-26) Completed T033 test: ADD_ONS.AI_ASSISTANT equals 'ai_assistant'
- (2026-03-26) Completed T034 test: ADD_ON_LABELS[AI_ASSISTANT] equals 'AI Assistant'
- (2026-03-26) Completed T035 test: tenantHasAddOn(['ai_assistant'], ADD_ONS.AI_ASSISTANT) returns true
- (2026-03-26) Completed T036 test: tenantHasAddOn([], ADD_ONS.AI_ASSISTANT) returns false
- (2026-03-26) Completed T037 test: getActiveAddOns returns only non-expired add-ons from tenant_addons table
- (2026-03-26) Completed T038 test: getActiveAddOns returns empty array when no add-ons exist for tenant
- (2026-03-26) Completed T039 test: getActiveAddOns excludes expired add-ons (expires_at < now)
- (2026-03-26) Completed T040 test: assertAddOnAccess throws when tenant lacks the requested add-on
- (2026-03-26) Completed T041 test: assertAddOnAccess passes when tenant has the requested add-on
- (2026-03-26) Completed T042 test: assertAddOnAccess bypasses check in CE edition (never throws)
- (2026-03-26) Completed T043 test: assertAddOnAccess works for Solo tier with AI add-on active
- (2026-03-26) Completed T044 test: assertAddOnAccess works for Pro tier with AI add-on active
- (2026-03-26) Completed T045 test: assertAddOnAccess works for Premium tier with AI add-on active
- (2026-03-26) Completed T046 test: TierContext provides isSolo=true when tier is solo
- (2026-03-26) Completed T047 test: TierContext provides isSolo=false when tier is pro
- (2026-03-26) Completed T048 test: TierContext provides addOns array from session/DB
- (2026-03-26) Completed T049 test: TierContext hasAddOn returns true when add-on is in addOns array
- (2026-03-26) Completed T050 test: TierContext hasAddOn returns false when add-on is not in addOns array
- (2026-03-26) Completed T051 test: CE edition: hasAddOn always returns true regardless of addOns array
- (2026-03-26) Completed T052 test: CE edition: hasFeature always returns true regardless of tier
- (2026-03-26) Completed T053 test: MenuItem interface accepts optional requiredFeature field
- (2026-03-26) Completed T054 test: Sidebar hides Extensions item for Solo tier
- (2026-03-26) Completed T055 test: Sidebar hides Workflow Editor subitem for Solo tier
- (2026-03-26) Completed T056 test: Sidebar shows Extensions item for Pro tier
- (2026-03-26) Completed T057 test: Sidebar shows all items for Premium tier
- (2026-03-26) Completed T058 test: Sidebar items without requiredFeature are always shown
- (2026-03-26) Completed T059 test: Settings Integrations tab shows FeatureUpgradeNotice for Solo tier
- (2026-03-26) Completed T060 test: Settings Extensions tab shows FeatureUpgradeNotice for Solo tier
- (2026-03-26) Completed T061 test: Settings Email tab shows FeatureUpgradeNotice for Solo tier
- (2026-03-26) Completed T062 test: Settings tabs remain visible and clickable even when gated
- (2026-03-26) Completed T063 test: Settings Integrations tab shows normal content for Pro tier
- (2026-03-26) Completed T064 test: Settings sidebar items are never filtered by tier (all visible)
- (2026-03-26) Completed T107 test: npm run build:shared compiles with all new types/features/add-ons
- (2026-03-26) Completed F024 feature: Add STRIPE_AI_ADDON_PRICE_ID and STRIPE_AI_ADDON_ANNUAL_PRICE_ID env vars to Stripe config
