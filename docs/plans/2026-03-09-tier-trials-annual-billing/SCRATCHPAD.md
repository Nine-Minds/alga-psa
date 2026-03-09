# Scratchpad — Tier Trials, Annual Billing & Bug Fixes

- Plan slug: `tier-trials-annual`
- Created: `2026-03-09`
- Updated: `2026-03-09`

## What This Is

Rolling notes for implementing trials, annual billing, bug fixes, and documentation on top of the existing tier system.

## Decisions

- (2026-03-09) **Pricing confirmed**: Pro $89/mo base + $12/user/mo, Premium $349/mo base + $25/user/mo
- (2026-03-09) **Annual = pay for 10, get 12** (~17% discount, marketed as "2 months free")
- (2026-03-09) **Pro trial = 7 days**, CC upfront, Stripe auto-charges after
- (2026-03-09) **Premium trial = 30 days**, only for paying Pro customers (not during active Pro trial)
- (2026-03-09) **Premium trial is manual**: customer requests via form, Nine Minds processes via extension
- (2026-03-09) **Premium trial = auto-charge at end**: Stripe charges for Premium when trial ends. Customer must actively cancel to revert to Pro. No "commit" step needed — accepting the trial IS the commitment.
- (2026-03-09) **Cancel Premium Trial**: customer can cancel during trial → reverts to Pro. Cancel button on account page.
- (2026-03-09) **Payment failure = "banner of shame"**: persistent banner in header, not dismissible. No automated lockout — Nine Minds manually monitors and contacts delinquent accounts.
- (2026-03-09) **24-48hr grace period**: support policy only, not enforced in code
- (2026-03-09) **Annual cancellation refund**: case-by-case manual process via support, no automated refunds
- (2026-03-09) **Trial state from Stripe**: use subscription.trial_end and status, no custom trial tables
- (2026-03-09) **Trial request storage**: email notification only (no DB table for requests initially)

## Discoveries / Constraints

- (2026-03-09) Stripe subscription status already includes 'trialing' in schema enum
- (2026-03-09) No existing trial_end or trial columns in DB — need to pull from Stripe subscription
- (2026-03-09) JWT already refreshes plan every 5 min — trial_end and subscription_status can piggyback on same query
- (2026-03-09) Header component at `server/src/components/layout/Header.tsx` — trial banner goes next to tenant badge (left side)
- (2026-03-09) CancellationFeedbackModal at `ee/server/src/components/settings/account/CancellationFeedbackModal.tsx` — pattern for Premium trial request form
- (2026-03-09) NineMinds extension TenantManagementView at `ee/extensions/nineminds-reporting/src/iframe/main.tsx` (lines ~2908-3700)
- (2026-03-09) Extension API calls go through WASM proxy: UI → bridge → handler.ts → uiProxy → Next.js API
- (2026-03-09) All tenant management APIs require master billing tenant auth
- (2026-03-09) `sendEventEmail` at `server/src/lib/notifications/sendEventEmail.ts` — for trial request emails
- (2026-03-09) Existing `buildPhaseItems` price bug: picks first configured price ID, not tenant's actual tier

## Key File Paths

| File | Purpose |
|------|---------|
| `packages/types/src/constants/tenantTiers.ts` | Tier types + resolveTier (BF1) |
| `packages/types/src/constants/addOns.ts` | Add-ons scaffolding (BF8) |
| `ee/server/src/lib/stripe/StripeService.ts` | buildPhaseItems (BF2), upgradeTier, checkout |
| `ee/server/src/lib/stripe/stripeTierMapping.ts` | tierFromStripeProduct (BF5) |
| `packages/billing/src/actions/invoiceTemplates.ts` | saveInvoiceTemplate (BF3) |
| `packages/auth/src/lib/nextAuthOptions.ts` | JWT plan logic (BF4), trial fields (TR1-3) |
| `server/src/components/tier-gating/TierGate.tsx` | Loading state (BF6) |
| `server/src/context/TierContext.tsx` | Trial state (TR4-5) |
| `server/src/components/layout/Header.tsx` | Trial banner (TR7), payment banner (TR10) |
| `ee/server/src/components/settings/account/AccountManagement.tsx` | Trial status, request form |
| `ee/server/src/components/settings/account/CancellationFeedbackModal.tsx` | Pattern for request form |
| `ee/server/src/lib/actions/license-actions.ts` | Server actions for trials |
| `ee/extensions/nineminds-reporting/src/iframe/main.tsx` | Extension UI for trial management |
| `ee/extensions/nineminds-reporting/src/handler.ts` | Extension handler routing |

## Stripe Trial Implementation Notes

### How Stripe Trials Work
- `subscription_data.trial_period_days: 7` on checkout session = 7-day trial
- CC captured at checkout but not charged
- Stripe automatically charges when `trial_end` passes
- If charge fails → subscription goes to `past_due`
- `subscription.status` = `'trialing'` during trial, `'active'` after
- `subscription.trial_end` = Unix timestamp of trial end

### Premium Trial Activation (Manual via Extension)
`startPremiumTrialAction(tenantId)` detects tenant state and handles:

**Path A — Paying Pro customer:**
1. Creates Premium subscription with `trial_period_days: 30`
2. Sets `tenants.plan = 'premium'`

**Path B — Pro trial customer (wants Premium from day 1):**
1. Ends Pro trial: `stripe.subscriptions.update(sub, { trial_end: 'now' })` → triggers immediate charge for first month of Pro
2. Verifies Pro charge succeeded
3. Creates Premium subscription with `trial_period_days: 30`
4. Sets `tenants.plan = 'premium'`

Both paths end with: customer sees Premium features + countdown banner + pricing breakdown on account page.

**No direct plan override API** — manual overrides (courtesy access etc.) are done directly in DB.

### Premium Trial End States
- **Customer does nothing** → Stripe auto-charges at trial end → `trialing` → `active` → customer is paying Premium
- **Customer cancels** → Cancel Premium subscription → `trialing` → `canceled` → webhook reverts `tenants.plan` to `'pro'`
- **Charge fails** → `trialing` → `past_due` → banner of shame, Nine Minds contacts manually

## Open Questions

- What if a paying Pro customer's card fails during Premium trial activation? (Premium trial is free, so this shouldn't matter — they keep Pro subscription active)
- Should we track trial request messages in a DB table for audit, or is email sufficient? (Starting with email only)
