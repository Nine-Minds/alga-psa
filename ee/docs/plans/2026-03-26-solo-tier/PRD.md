# PRD — Solo Tier

- Slug: `solo-tier`
- Date: `2026-03-26`
- Status: Draft

## Summary

Add a **Solo** tier below Pro for single-user hosted EE customers. Solo gets core PSA functionality at a flat-rate Stripe subscription (no per-user fee), limited to 1 user. AI is a cross-tier paid add-on (not bundled with any tier). Mobile app access is gated to Pro+.

Tier hierarchy: **Solo < Pro < Premium**. CE build is unaffected.

## Problem

New single-user MSP operators or freelancers need an affordable entry point into Alga PSA. The current Pro tier (base + per-user pricing) is priced for teams. There's no way to offer a stripped-down, single-user plan without creating a new tier.

Additionally, AI capabilities have different cost structures than core features and should be purchasable independently of tier level, allowing any customer to add AI when they need it.

## Goals

1. Introduce a Solo tier that provides core PSA functionality for 1 user at a flat rate
2. Gate Pro+ features (integrations, extensions, SSO, managed email, advanced assets, client portal admin, workflow designer, mobile access) behind tier checks
3. Make AI & Chat a purchasable add-on for any tier (Solo, Pro, Premium) — first activation of the add-on system
4. Block Solo users from mobile app authentication
5. Support Stripe checkout, upgrade (Solo->Pro), and downgrade (Pro->Solo) flows
6. Enforce 1-user license limit for Solo
7. Zero impact on existing Pro/Premium tenants or CE build

## Non-goals

- Changing the CE build behavior (all features remain unlocked in CE)
- Database migration for existing tenants (no plan column changes needed)
- Per-feature add-on store beyond AI (future work)
- Mobile app changes beyond blocking auth (no Solo-specific mobile UI)
- Monitoring/observability/metrics for tier usage
- Admin dashboard for tier management

## Users and Primary Flows

### Personas

1. **Solo user (new signup)**: Freelance MSP / solo technician signing up for Alga PSA. Wants tickets, billing, scheduling, basic asset management. May later want AI or to grow the team (upgrade to Pro).
2. **Pro user considering downgrade**: Existing Pro user who is the only active user and wants to save money by dropping to Solo.
3. **Any-tier user wanting AI**: Customer on any plan who wants to purchase the AI Assistant add-on.

### Primary Flows

**F1 — Solo signup & checkout**
1. New user selects Solo plan during signup
2. Stripe checkout creates single line item (base price only, no per-user) with 7-day trial
3. Tenant created with `plan = 'solo'`, trial active for 7 days
4. User logs in → sees core PSA features, sidebar hides Extensions, settings tabs show upgrade CTAs for gated features

**F2 — Solo user hits gated feature**
1. Solo user navigates to Settings → Integrations tab
2. Tab is visible but content replaced with `<FeatureUpgradeNotice>` showing upgrade CTA
3. If user tries gated API route directly, server returns tier access error

**F3 — Solo user tries mobile app**
1. Solo user attempts to set up mobile app (scan QR / enter OTT)
2. OTT exchange returns 403 with "Mobile app access requires Pro or higher"
3. Web UI optionally shows upgrade CTA on mobile setup page

**F4 — Upgrade Solo -> Pro**
1. Solo user clicks "Upgrade to Pro" in Account Management
2. Stripe subscription updated: per-user line item added, base price swapped
3. Tier refreshes immediately → all Pro features unlock

**F4b — Solo -> Pro trial (established customers)**
1. Established Solo customer (past their 7-day Solo trial) clicks "Try Pro free"
2. Pro trial activated for 15–30 days (duration TBD) — all Pro features unlock
3. At trial end, customer reverts to Solo unless they convert to paid Pro
4. Not available if customer is still in their Solo trial period (prevents trial stacking)

**F5 — Downgrade Pro -> Solo**
1. Pro user with exactly 1 active user clicks "Downgrade to Solo"
2. System validates user count = 1
3. Stripe subscription updated: per-user item removed, base price swapped
4. If user count > 1, downgrade blocked with message

**F6 — Purchase AI add-on (any tier)**
1. User clicks "Add AI Assistant" in Account Management
2. Stripe creates separate subscription item for AI add-on
3. `tenant_addons` row inserted → AI features unlock immediately
4. AI chat, document AI, AI sidebar, workflow AI all become available

**F7 — Cancel AI add-on**
1. User clicks "Cancel AI Assistant" in Account Management
2. Stripe removes AI line item
3. `tenant_addons` row deactivated → AI features disabled

**F8 — Solo user tries to add second user**
1. Solo admin goes to Settings → Users → "Add User"
2. Button disabled with message: "Solo plan is limited to 1 user. Upgrade to Pro to add more users."
3. Server-side enforcement also rejects the action if bypassed

## UX / UI Notes

- **Sidebar**: Menu items with `requiredFeature` are hidden (not greyed out) for Solo users — Extensions and Workflow Editor disappear from nav
- **Settings tabs**: Gated tabs (Integrations, Extensions, Email) remain visible and clickable, but content replaced with `<FeatureUpgradeNotice>` component showing the required tier and an upgrade button
- **Account Management**: Shows current tier with Solo-specific messaging ("Your Solo plan includes core PSA features. Upgrade to Pro for integrations, mobile access, and more."). AI add-on section is separate from tier upgrade flow, showing "Add AI Assistant" or "AI Assistant (active)" status
- **Add User button**: Disabled with tooltip/CTA when `isSolo`

## Requirements

### Functional Requirements

#### Phase 1: Core Type System
- R1.1: Add `'solo'` to `TENANT_TIERS` array and `TenantTier` type
- R1.2: Add `TIER_RANK` mapping: `{ solo: 0, pro: 1, premium: 2 }`
- R1.3: Add `tierAtLeast(tier, minimum)` helper using rank comparison
- R1.4: Add 8 new `TIER_FEATURES` entries: INTEGRATIONS, EXTENSIONS, MANAGED_EMAIL, SSO, ADVANCED_ASSETS, CLIENT_PORTAL_ADMIN, WORKFLOW_DESIGNER, MOBILE_ACCESS (all min tier: `pro`)
- R1.5: Rewrite `tierHasFeature()` to use rank comparison instead of map lookup
- R1.6: Derive `TIER_FEATURE_MAP` from `FEATURE_MINIMUM_TIER` + `TIER_RANK`
- R1.7: Add `AI_ASSISTANT` to `ADD_ONS` enum with labels and descriptions
- R1.8: `resolveTier()` defaults to `'pro'` for null/invalid (Solo is opt-in only)

#### Phase 1b: Add-On Wiring
- R1b.1: Create `getActiveAddOns(tenantId)` service querying `tenant_addons` table
- R1b.2: Create `assertAddOnAccess(addOn)` server-side check, similar to `assertTierAccess()`
- R1b.3: Wire AI add-on Stripe products with env vars for monthly/annual pricing

#### Phase 2: Context & Session
- R2.1: Add `isSolo` boolean to `TierContextValue`
- R2.2: Add `addOns` array and `hasAddOn()` helper to `TierContextValue`
- R2.3: CE bypass unchanged — Solo restrictions are EE-only

#### Phase 3: Sidebar & Navigation Gating
- R3.1: Add `requiredFeature` to `MenuItem` interface
- R3.2: Annotate Extensions and Workflow Editor menu items with their required features
- R3.3: Filter sidebar items where `requiredFeature` is set and tier doesn't have it (recursive for subItems)

#### Phase 4: Settings Tab Gating
- R4.1: Add `requiredFeature` to `TabContent` type in SettingsPage
- R4.2: Tag Integrations, Extensions, Email tabs with their required features
- R4.3: Render `<FeatureUpgradeNotice>` instead of content when feature is gated
- R4.4: Settings sidebar items remain visible (no hiding, only content gating)

#### Phase 5: EE Route Handler Tier Checks
- R5.1: Add `assertTierAccess()` to ~20 EE route handlers for tier features
- R5.2: Add `assertAddOnAccess(ADD_ONS.AI_ASSISTANT)` to AI routes (chat, document-assist, etc.)
- R5.3: Gate client components with `<TierGate>` / `useTierFeature()` / `hasAddOn()`

#### Phase 5b: Mobile Access Gating
- R5b.1: Check tenant tier in `exchangeOttForSession()` — reject Solo with 403
- R5b.2: Return upgrade message in error response for Solo mobile auth attempts

#### Phase 6: Stripe Integration
- R6.1: Add `'alga-psa-solo': 'solo'` to stripe tier mapping
- R6.2: Solo checkout: single line item (base only), `userPriceId: null`, with 7-day trial
- R6.3: Solo webhook handling: set `licensed_user_count = 1` when no per-user item
- R6.4: `upgradeTier()`: Solo -> Pro adds per-user line item
- R6.5: New `downgradeTier()`: Pro -> Solo validates user count = 1, removes per-user item
- R6.6: AI add-on purchase/cancel creates/removes separate subscription item
- R6.7: AI webhook activates/deactivates `tenant_addons` row
- R6.8: Solo->Pro trial: activate Pro features for 15–30 days for established Solo customers (not during Solo trial). Revert to Solo at trial end if not converted.

#### Phase 7: License Enforcement
- R7.1: Block adding users when Solo and `used >= 1`
- R7.2: Disable "Add User" button in UI with upgrade CTA for Solo

#### Phase 8: AccountManagement UI
- R8.1: Add display names for 8 new tier features
- R8.2: Solo-specific messaging on account page
- R8.3: "Upgrade to Pro" card for Solo tenants
- R8.4: "Downgrade to Solo" option for Pro tenants with 1 user
- R8.5: AI add-on purchase/status card (separate from tier flow)

### Non-functional Requirements

- Existing Pro/Premium tenants must experience zero behavior change (except AI now requires add-on)
- CE build must remain fully unlocked regardless of tier or add-ons
- `resolveTier()` must default to Pro for any null/invalid plan (backward compatibility)
- Type system changes must pass `npm run build:shared`

## Data / API / Integrations

**Database**: No migration needed. `tenants.plan` is already an unconstrained text column. `tenant_addons` table already exists (created via migration `20260303100000`).

**Stripe**: New price IDs for Solo base (monthly/annual) and AI add-on (monthly/annual). No new Stripe products needed — just new prices under existing product.

**Session**: `session.user.plan` already carries the plan string. Add-ons will be fetched from DB per-request or added to session.

## Security / Permissions

- Tier checks are runtime-only (not build-time) — `isEnterprise` check is untouched
- Server-side enforcement via `assertTierAccess()` and `assertAddOnAccess()` prevents API bypass
- Mobile auth blocked at OTT exchange level — Solo users never receive API tokens
- License limit enforced server-side in `addUser` action

## Rollout / Migration

- No database migration required
- All existing tenants keep `plan = 'pro'` (grandfathered)
- Solo is opt-in only — new signups or manual downgrades
- Feature flag `'tier-upgrade-flow'` already gates upgrade UI — extend for Solo
- AI add-on: existing Pro/Premium tenants need awareness that AI is now separately purchased (comms/migration strategy TBD by product team)

## Open Questions

1. ~~**AI add-on rollout for existing tenants**~~ — RESOLVED: No grandfathering. AI is new — nobody has it yet. It's addon-only from day one for all tiers.
2. ~~**Solo trial**~~ — RESOLVED: 7-day free trial for new Solo purchases.
3. **AI add-on pricing**: Monthly/annual Stripe price IDs to be added later. Implementation should support the env vars but they won't be populated at launch.
4. ~~**Solo -> Pro upgrade trial**~~ — RESOLVED: Established Solo customers (past their initial 7-day trial) can trial Pro features. Duration TBD — either 15 or 30 days. Not available during the Solo trial period itself.

## Acceptance Criteria (Definition of Done)

1. `npm run build:shared` passes with new tier/feature/add-on types
2. Existing Pro tenant login — no behavior change, all tier features available
3. Solo tenant — sidebar hides gated items, settings tabs show upgrade CTAs, EE API routes return tier error
4. AI add-on — disabled without add-on for any tier; enabled when `tenant_addons` row active
5. Mobile — Solo OTT exchange returns 403; Pro/Premium succeeds
6. License — Solo cannot add second internal user
7. Stripe — Solo checkout has single line item; upgrade adds per-user; downgrade removes it
8. AI add-on — separate Stripe item; webhook creates/removes `tenant_addons` row
9. CE build — all features unlocked regardless of tier/add-ons
10. All unit tests pass (`npm run test:unit`)
