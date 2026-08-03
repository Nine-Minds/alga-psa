# Eliminate the Premium tier (alga0002213)

## Intent

Make Pro the only paid tier above Solo while preserving existing customer access. Remove Premium from active tier types, feature minima, trials, billing configuration, account UI, and documentation. This is a tier consolidation, not a Pro-versus-Premium comparison and not a removal of unrelated uses of the ordinary words “premium” or “professional”.

## Decisions

1. **Existing `premium` tenant records migrate to `pro`.** Add an idempotent data migration before tightening TypeScript/runtime validation. This keeps every former Premium tenant valid and avoids `resolveTier()` silently treating a legacy database value as a generic misconfiguration.
2. **Former Premium-only features become Pro features.** `ADVANCED_AUTHORIZATION_BUNDLES` and `OPPORTUNITY_MANAGEMENT` move to minimum tier `pro`; all other existing Pro entitlements remain unchanged. The Teams integration continues to be add-on-only.
3. **Premium trials end as a product concept.** Remove the start/confirm/cancel Premium-trial flow and UI. Existing Premium-trial metadata must be normalized during migration: preserve access by resolving the tenant to Pro, then clear/ignore `premium_trial*` metadata so no banner, billing transition, or stale session claim survives.
4. **Legacy Stripe Premium price keys are compatibility-only, then removable.** Stop reading or requiring `STRIPE_PREMIUM_*` for new checkout/subscription paths. If deployed environments may still contain those variables, document them as ignored legacy keys for one release rather than continuing active Premium billing behavior.
5. **Keep unrelated terminology.** Do not rename “Professional Services Automation”, Salesforce Professional sample data, generic “premium service” test fixtures, or the `premium` visual tone in license UI unless they represent the Alga tenant tier.

## Implementation sequence

### 1. Inventory and migrate persisted state

- Locate the tenant plan schema/check constraints and add an idempotent migration that updates `tenants.plan = 'premium'` to `pro`, then narrows any constraint/default to the real set (`essentials`, `solo`, `pro`).
- Inventory `premium_trial`, `premium_trial_end`, `premium_trial_confirmed`, and `premium_trial_effective_date` in tenant/subscription metadata. Clear or retire those keys after converting affected tenants to Pro. Do not leave a confirmed future billing transition capable of recreating Premium.
- Verify offline/self-host license state and product-code resolution do not emit `premium`; normalize legacy incoming license values to `pro` at the persistence/decoding boundary if backward compatibility is required.

### 2. Collapse the tier model

- In `packages/types/src/constants/tenantTiers.ts`, remove `premium` from `TENANT_TIERS`, `TenantTier`, `TIER_LABELS`, and `TIER_RANK`; update comments and `resolveTier` behavior/tests. Add an explicit legacy normalization helper or boundary mapping where external/persisted values can still arrive—do not re-admit `premium` as an active `TenantTier`.
- In `packages/types/src/constants/tierFeatures.ts`, change the two Premium minima (`ADVANCED_AUTHORIZATION_BUNDLES`, `OPPORTUNITY_MANAGEMENT`) to `pro`. The derived `TIER_FEATURE_MAP` will then expose the full paid feature set through Pro. Update behavioral tests to assert the three-tier model and Pro access.
- Update dependent typecheck and gating tests that currently construct `plan: 'premium'`; replace them with Pro assertions or targeted legacy-normalization tests.

### 3. Remove Premium trial/session behavior

- In `server/src/context/TierContext.tsx`, remove `isPremium`, all Premium-trial fields/calculations, and their memo dependencies. Keep Solo-to-Pro trial behavior intact.
- Remove Premium branches from `server/src/components/layout/TrialBanner.tsx` and its localization tests/copy.
- Remove the CE stub and EE implementation for `app/api/v1/tenant-management/start-premium-trial`, associated actions/email templates, and exports when no callers remain.
- In `packages/auth/src/lib/nextAuthOptions.ts`, session types, and OpenAPI auth schema, stop exposing `premium_trial*` claims after the migration/compatibility boundary is in place.

### 4. Remove active Premium billing plumbing

- In `packages/ee/src/lib/stripe/StripeService.ts` and callers, remove Premium plan/price selection and environment validation. New and changed subscriptions select only Solo or Pro pricing.
- Remove Premium-trial confirmation/scheduling logic from Stripe webhook/payment handlers and license actions. Ensure an old Premium Stripe product/price is mapped safely to Pro during webhook reconciliation rather than rejected or mapped to a nonexistent tier.
- Retain unrelated Enterprise add-on price plumbing called out by `docs/tier-gating-guide.md`; it is a separate future metered product.

### 5. Correct account UI and customer-facing copy

- In `packages/ee/src/components/settings/account/AccountManagement.tsx`, remove Premium controls/comparisons and make every paid-tier fallback label `Pro` (eliminating the stray `Professional` product-tier fallback).
- Update upgrade notices, onboarding/billing setup, trial banners, translations, and customer-facing email copy so they name only Essentials, Solo, and Pro where applicable.
- Update `docs/tier-gating-guide.md`: describe the three active tiers, make Pro the minimum for every paid feature, remove Premium examples and the stale “Visual Invoice Designer — Premium” row, while preserving the separate dormant Enterprise add-on note.

## Verification

- Behavioral unit tests: `TENANT_TIERS`/labels/ranks contain only Essentials, Solo, Pro; `resolveTier` handles supported values; all former Premium feature gates pass for Pro; Teams remains add-on-only.
- Migration test: legacy Premium tenant and Premium-trial metadata become Pro with no pending Premium billing transition; rerunning the migration is harmless.
- Auth/API tests: sessions and OpenAPI responses no longer expose Premium-trial fields; legacy external license/Stripe values normalize to Pro at the intended boundary.
- UI tests and smoke: Account Management, trial banner, upgrade notices, and gated former-Premium features show Pro-only language and access on the running app.
- Repository search scoped to product-tier contexts finds no active `TenantTier = 'premium'`, Premium price selection, Premium-trial route, or customer-facing Alga Premium label. Review remaining matches individually as unrelated terminology or intentional compatibility notes.
- Run focused type/tests for `@alga-psa/types`, auth, tier gating, account management, Stripe/webhook logic, and migrations; then the repository build/typecheck appropriate to the worktree.

## Out of scope

- No redesign of the tier model beyond eliminating Premium.
- No Pro-versus-Premium comparison UI.
- No removal of the Enterprise add-on plumbing or ordinary business-domain uses of “premium”/“professional”.
- No unrelated cleanup of the pre-existing `package-lock.json` and `packages/core/src/workSchedule.ts` wire-up changes.

## Risks

- Tightening `TenantTier` before migrating stored values can strand existing tenants or misclassify them.
- Removing session fields without clearing metadata can leave hidden stale state and confusing billing transitions.
- Broad text replacement would corrupt unrelated domain copy and fixtures; every match requires classification.
- Stripe webhooks may deliver legacy Premium price IDs after deployment, so the compatibility mapping must precede complete configuration removal.
