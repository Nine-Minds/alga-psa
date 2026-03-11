# PRD — Tenant Tier System (Basic, Pro, Premium)

- Slug: `tenant-tiers`
- Date: `2026-03-03`
- Status: Draft

## Summary

Add tenant-wide tiers (Basic, Pro, Premium) alongside the existing license count model. Tiers control feature access — Basic restricts billing, projects, technician dispatch (and more later), showing an upsell placeholder. Existing customers are grandfathered into Pro. The tier source evolves over three horizons: Stripe product mapping → new Stripe products per tier → internal contracts system.

**Design principle**: The `plan` column on the `tenants` table is the **single source of truth** for a tenant's tier. The gating infrastructure only reads this column. What *writes* it changes over time, but the read side stays stable.

## Problem

Currently all tenants have equal access to all features regardless of their subscription level. There is no mechanism to:
- Differentiate feature access between free/trial and paying customers
- Offer a tiered product (Basic → Pro → Premium) with progressive feature unlock
- Show upgrade prompts when users encounter gated features
- Map Stripe products to feature tiers automatically

## Goals

1. Define three tiers (Basic, Pro, Premium) with a clear feature-to-tier mapping
2. Gate features at navigation, page, and server-action levels
3. Backfill all existing tenants to Pro (grandfathered)
4. Map Stripe products to tiers so new tenants get the correct tier automatically
5. Show upsell placeholders on gated features directing users to upgrade
6. Deploy in phases with zero disruption to production
7. Design for future horizons: new Stripe products per tier → internal contracts system

## Non-goals

- Tier upgrade/downgrade self-service flow (Horizon 2)
- Internal contracts managing tiers (Horizon 3)
- Pricing page or public tier comparison
- Per-feature billing or usage-based gating
- Admin UI for managing tier-to-feature mappings
- Monitoring, metrics, or analytics for tier usage

## Users and Primary Flows

### Personas

1. **Existing MSP customer** — Currently using all features. After deployment, sees no change (grandfathered to Pro).
2. **New EE customer via Stripe** — Signs up through NM-Store checkout. Tier is resolved from Stripe product (`alga-psa-preview` → Pro).
3. **CE self-registration user** — Registers without Stripe. Gets Pro (no gating in CE).
4. **Basic-tier tenant** (future) — Sees core features only. Billing, Projects, Technician Dispatch are hidden. Upsell placeholders guide to upgrade.

### Primary Flows

1. **Login → Session loads tier from JWT → TierProvider makes it available client-side**
2. **Navigate sidebar → Items filtered by tier → Gated items hidden**
3. **Direct URL to gated page → UpsellPlaceholder shown instead of content**
4. **Server action on gated feature → TierAccessError thrown**
5. **Stripe product change → Webhook updates `tenants.plan` → Session refreshes within 5 min (or instant via `refreshTier()`)**

## UX / UI Notes

- **Navigation**: Gated items are hidden from sidebar (not grayed out)
- **Page-level**: Full-page `UpsellPlaceholder` with icon, heading ("{Feature} requires {Tier Label}"), description, and CTA button linking to `/msp/account`
- **Misconfigured state**: Warning banner ("Subscription not configured — contact support") when `plan` is NULL/invalid
- **Account page**: Shows current tier badge, tier comparison card, upgrade action

## Requirements

### Functional Requirements

#### FR1: Tier Constants & Type System
- Three tiers: `basic`, `pro`, `premium` as const tuple
- `TenantTier` type derived from the tuple
- `resolveTier(plan)` returns `{ tier, isMisconfigured }` — NULL → basic + misconfigured flag
- `isValidTier()` type guard
- `TIER_LABELS` for display names

#### FR2: Tier-to-Feature Mapping
- `TIER_FEATURES` enum: `BILLING`, `PROJECTS`, `TECHNICIAN_DISPATCH`, `EXTENSIONS` (extensible)
- `TIER_FEATURE_MAP`: basic = [], pro = [BILLING, PROJECTS, TECHNICIAN_DISPATCH], premium = [...pro, EXTENSIONS]
- `tierHasFeature(tier, feature)` → boolean
- `FEATURE_MINIMUM_TIER` reverse mapping

#### FR3: ITenant Interface Update
- Narrow `plan?: string` to `plan?: TenantTier` in both interface locations

#### FR4: Registration Flow
- Both `Tenant.insert` calls in `useRegister.tsx` set `plan: 'pro'`
- CE tenants always get Pro (never gated)

#### FR5: Migration Backfill
- All existing tenants with NULL or empty plan → `'pro'`
- No column default — NULL is intentional error state

#### FR6: Test Data Fix
- `testDataFactory.ts`: change `plan: 'test'` → `plan: 'pro'`

#### FR7: Session Integration
- `plan` field added to JWT, Session.user, User, ExtendedUser interfaces
- JWT callback fetches plan on initial sign-in
- Throttled refresh every 5 minutes on subsequent requests
- Session callback propagates plan to client

#### FR8: Client-Side Tier Context
- `TierProvider` wraps app inside `AppSessionProvider`
- `useTier()` hook: tier, isMisconfigured, isBasic, isPro, isPremium, hasFeature(), refreshTier()

#### FR9: Stripe Product → Tier Mapping
- `STRIPE_PRODUCT_TIER_MAP` config: `alga-psa-preview` → pro, future products pre-mapped
- `tierFromStripeProduct()` function, unknown products default to pro

#### FR10: Tenant Creation Workflow Integration
- `createTenantInDB()` resolves tier from Stripe price → sets `tenantData.plan`
- Covers: Stripe checkout, Nine Minds extension, Provisioning API (all same Temporal workflow)

#### FR11: Checkout Webhook Integration
- `handleCheckoutCompleted()` and `handleSubscriptionUpdated()` resolve product → tier → update `tenants.plan`

#### FR12: Upsell Placeholder Component
- Full-page placeholder: icon, heading, description, CTA to `/msp/account`

#### FR13: TierGate Components
- Client-side `TierGate` wrapper (uses TierContext)
- Server-side `ServerTierGate` (reads session directly)

#### FR14: Navigation Gating
- `requiredFeature` field on `MenuItem` interface
- Sidebar filters items by tier
- Gated: Billing → BILLING, Projects → PROJECTS, Technician Dispatch → TECHNICIAN_DISPATCH

#### FR15: Page-Level Gating
- Billing, Projects, Technician Dispatch pages wrapped with gate components

#### FR16: Server Action Gating
- `assertTierAccess(tenant, feature)` throws `TierAccessError` if tier lacks feature
- Applied to billing, project, technician dispatch server actions

#### FR17: Account Page Enhancement
- Replace hardcoded `plan_name: 'Professional'` with actual tier
- Add tier badge, tier comparison card, upgrade action

### Non-functional Requirements

- Zero disruption deployment — Phase A changes nothing visible, Phase B deployed while all tenants are Pro
- Session plan refresh throttled to 5-minute intervals (avoids DB queries on every request)
- Pure TypeScript tier config — no DB or PostHog dependency for feature mapping

## Data / API / Integrations

- **Database**: `tenants.plan` column (varchar, already exists, nullable — NULL = error state)
- **Stripe**: Product name → tier mapping via `STRIPE_PRODUCT_TIER_MAP`
- **NextAuth**: JWT carries `plan` and `last_plan_check` fields
- **Temporal**: `createTenantInDB()` sets plan from Stripe product

## Security / Permissions

- Server-side `assertTierAccess()` prevents API-level bypass of client gating
- Tier is read from DB in server actions, not trusted from client

## Rollout / Migration

### Phase A: Foundation (deploy first, no behavior change)
- Migration backfills all tenants to Pro
- Session carries tier info
- TierProvider available but everyone is Pro — no visible change

### Phase B: Gating Infrastructure (deploy second, still no behavior change)
- Gate components, navigation filtering, server action guards deployed
- Since all tenants are Pro, no one is gated

### Phase C: EE Registration Gating (deploy when ready)
- EE self-registration sets `plan: 'basic'` (CE stays `'pro'`)

## Open Questions

None — all questions resolved during planning:
- NULL plan handling: error state (basic access + warning banner)
- CE mode: always Pro, never gated
- Dev seeds: already set `plan: 'pro'`
- Nine Minds extension: same Temporal workflow, covered by A9
- Test factory: updated to `'pro'`

## Acceptance Criteria (Definition of Done)

1. All existing production tenants have `plan = 'pro'`
2. New tenants via Stripe checkout get tier resolved from product
3. JWT contains `plan` field, refreshed every 5 minutes
4. Basic-tier tenant sees gated features hidden from sidebar
5. Direct navigation to gated page shows upsell placeholder
6. Server actions on gated features throw TierAccessError
7. Account page shows actual tier (not hardcoded 'Professional')
8. CE self-registration creates tenants with `plan = 'pro'`
9. NULL plan shows warning banner + basic-level access
