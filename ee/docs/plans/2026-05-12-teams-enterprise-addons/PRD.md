# Teams and Enterprise Add-ons

## Problem
Teams integration and Microsoft Entra Sync are currently unlocked by tier. We want them purchased and activated as independent add-ons, matching the AI Assistant add-on model.

## Goals
- Add a Teams add-on that gates Microsoft Teams integration.
- Add an Enterprise add-on that gates Microsoft Entra Sync.
- Stop granting either feature solely because a tenant is on Pro or Premium.
- Reuse the existing `tenant_addons`, session, `TierContext.hasAddOn`, and Stripe add-on lifecycle.

## Non-goals
- No migration/backfill for existing Pro or Premium tenants.
- No changes to Entra sync data model or Teams integration data model.
- No removal of existing edition checks, RBAC checks, or PostHog feature flags.

## User Value
Tenants can buy targeted capabilities without upgrading their entire plan, and product packaging can price Teams and Entra Sync independently.

## Requirements
- Define `ADD_ONS.TEAMS` and `ADD_ONS.ENTERPRISE` with labels and descriptions.
- Client settings surfaces must use add-on entitlement for Teams and Entra visibility/access decisions.
- Server-side Entra guard must require the Enterprise add-on in addition to existing permissions and UI flag.
- Teams runtime/actions must require the Teams add-on in addition to EE/tenant availability checks.
- Stripe add-on purchase/cancel must support AI, Teams, and Enterprise add-ons using per-add-on monthly/annual env vars.
- Account Management must show Teams and Enterprise add-ons alongside AI.

## Rollout Notes
No automatic `tenant_addons` rows are created. Existing tier-entitled tenants lose access until an add-on row is created by purchase or manual grant.

## Acceptance Criteria
- Pro/Premium tier alone does not unlock Teams or Entra Sync.
- Active `teams` add-on unlocks Teams integration surfaces and runtime paths.
- Active `enterprise` add-on unlocks Entra Sync surfaces and API paths.
- CE bypass behavior remains intact.
- Stripe checkout metadata uses the selected add-on key.
