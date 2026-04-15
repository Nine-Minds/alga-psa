# PRD — Tier Bug Fixes, Trials, Annual Billing & Payment Enforcement

- Slug: `tier-trials-annual`
- Date: `2026-03-09`
- Status: Draft
- Depends on: `2026-03-03-tenant-tier-system`

## Summary

Extends the 2-tier system (Pro/Premium) with: (1) bug fixes and gaps identified in code review, (2) developer documentation for adding new tier-gated features, (3) annual billing at ~17% discount, (4) Stripe-managed trial periods (7-day Pro for new signups, 30-day Premium for paying Pro customers), (5) trial countdown UI in header + account page, (6) payment failure handling with reminders, and (7) a "Request Premium Trial" flow with manual fulfillment via Nine Minds extension.

## Pricing

| | Pro Monthly | Pro Annual | Premium Monthly | Premium Annual |
|---|---|---|---|---|
| Base fee | $89/mo | $890/yr (~$74.17/mo) | $349/mo | $3,490/yr (~$290.83/mo) |
| Per user | $12/user/mo | $120/user/yr (~$10/user/mo) | $25/user/mo | $250/user/yr (~$20.83/user/mo) |

Annual = pay for 10 months, get 12 (~17% discount, "2 months free").

## Problem

The tier system works but has bugs, no trials, no annual billing, no payment failure handling, and no documentation for extending it.

## Goals

1. Fix all identified bugs and gaps in the tier system
2. Document how to add new tier-gated features (developer guide)
3. Add annual billing option with 17% discount
4. Implement 7-day free Pro trial for new accounts (CC required, auto-charge after)
5. Implement 30-day free Premium trial for paying Pro customers
6. Show trial days remaining in header (every page) and account page
7. Handle payment failures with reminders and visual "shame" indicators
8. Allow Pro users to request a Premium trial via in-app message form
9. Enable Nine Minds admins to manually process Premium trial requests

## Non-goals

- Self-service downgrade flow (Premium → Pro)
- Automated Premium trial approval (intentionally manual)
- Public pricing page or tier comparison marketing page
- Refund processing (handled via Stripe dashboard)
- Free tier or freemium model

## Users and Primary Flows

### Personas

1. **New signup** — Visits website, picks Pro plan, enters CC, starts 7-day trial
2. **Paying Pro customer** — Wants to try Premium features, requests 30-day trial
3. **Trialing user (Pro)** — Sees countdown banner, decides to continue or cancel before charge
4. **Trialing user (Premium)** — Sees countdown with pricing breakdown, auto-charged at trial end unless they cancel back to Pro
5. **Delinquent customer** — Card declined, sees payment failure banner on every page
6. **Nine Minds admin** — Receives Premium trial requests, processes them via extension

### Flow 1: New Pro Trial (7-day)

1. User signs up on website → Stripe Checkout with `trial_period_days: 7`
2. CC captured but not charged
3. User lands in app → header shows "Trial: 7 days left"
4. Day 7 → Stripe auto-charges first month (Pro monthly or annual, depending on selection)
5. 24-48 hour grace period: user can cancel for full refund (manual via support or Stripe portal)
6. If charge fails → payment failure flow (see Flow 5)

### Flow 2a: Premium Trial for Paying Pro Customer (30-day)

1. Paying Pro customer (NOT on active trial) clicks "Upgrade to Premium" on account page
2. Instead of immediate upgrade, sees option to "Request 30-day Premium Trial"
3. Fills in message form (textarea) + "Send Request" button
4. Email notification sent to Nine Minds team
5. Admin activates 30-day Premium trial via Nine Minds extension
6. Customer gets Premium features immediately, header shows "Premium Trial: 30 days left"

### Flow 2b: Premium Trial for Pro-Trialing Customer (edge case)

1. Customer on 7-day Pro trial wants Premium immediately
2. They request via same form (or contacts support)
3. Admin processes via Nine Minds extension — single action that:
   - Ends Pro trial immediately
   - Charges first month of Pro (customer is now a paying Pro customer)
   - Converts to Premium subscription with 30-day trial
4. Customer gets Premium features, header shows "Premium Trial: 30 days left"

### Flow 3: Premium Trial Active & Ending

1. Admin activates trial → Stripe creates Premium subscription with `trial_period_days: 30`
2. Customer sees Premium features immediately, header shows "Premium Trial: 30 days left"
3. Account page shows pricing breakdown: "You'll be charged $X/mo when your trial ends on {date}"
4. Customer can cancel Premium trial early → reverts to Pro (cancel button on account page)
5. If customer does nothing → Stripe auto-charges for Premium at trial end, customer becomes paying Premium
6. If charge fails at trial end → payment failure flow (banner of shame)

### Flow 4: Annual Billing

1. During checkout (new signup) or from account page (existing customer)
2. Toggle between monthly/annual pricing
3. Annual shows "2 months free" / "Save 17%"
4. Stripe handles annual recurring billing

### Flow 5: Payment Failure ("Banner of Shame")

1. Stripe charge fails (card declined, expired, etc.)
2. Stripe subscription enters `past_due` status
3. App detects `past_due` from subscription data
4. Header banner: "Payment failed — update your payment method" (persistent, not dismissible)
5. Stripe retries per its retry schedule (Smart Retries)
6. Nine Minds team manually monitors delinquent accounts and contacts them
7. No automated feature lockout — banner of shame is the enforcement for now

## UX / UI Notes

### Trial Banner (Header)

- Position: left side of header, next to tenant UUID badge
- Style: consistent with existing UI (not a disruptive alert bar)
- Content: "{Plan} Trial: {N} days left" with link to account page
- Color: neutral/info for >3 days, warning for ≤3 days
- Always visible during trial, not dismissible

### Payment Failure Banner (Header)

- Position: same area as trial banner (replaces trial banner if both apply)
- Style: destructive/error variant
- Content: "Payment failed — Update payment method" with link to billing portal
- Always visible, not dismissible

### Account Page — Trial Section

- Shows trial status: plan name, days remaining, start/end dates
- Progress bar showing trial progress
- CTA varies by state:
  - Pro trial: "You'll be charged $X on {date}" + cancel option
  - Premium trial: "You'll be charged $X/mo for Premium on {date}" + "Cancel & revert to Pro" option
  - Payment failed: "Update payment method" link to billing portal

### Premium Trial Request Form

- Location: Account Management page, in the Plan & Tier section
- Shown when: user is on Pro (paid or trialing) and clicks "Upgrade to Premium"
- UI: Simple textarea ("Tell us what you'd like to try with Premium") + "Send Request" button
- Confirmation: toast "Request sent! We'll be in touch."
- No dropdown, no complex form — just a message

### Nine Minds Extension — Premium Trial Activation

- Existing Status column enhanced to show: current plan (Pro/Premium), trial status if trialing, subscription status (active/past_due/etc.)
- **"Start Premium Trial"** action button per tenant. Behavior depends on tenant state:
  - **Paying Pro**: creates Premium subscription with 30-day trial directly
  - **Pro trial**: ends Pro trial → charges first month of Pro → creates Premium subscription with 30-day trial (all in one action)
  - Button disabled/hidden for tenants already on Premium or Premium trial
- Premium trial request inbox: list of pending requests with tenant name, email, message, date
- Manual plan overrides (e.g. courtesy access) done directly in DB — no API exposed

## Requirements

### Bug Fixes

#### BF1: Fix stale JSDoc in tenantTiers.ts
- Replace references to `'basic'` with `'pro'` in docstrings for `resolveTier()` and `ResolvedTier`

#### BF2: Fix buildPhaseItems using wrong price for scheduled reductions
- `buildPhaseItems()` in StripeService must resolve price IDs based on the tenant's CURRENT tier, not pick first configured price
- Fetch tenant's plan, then use matching tier's price IDs

#### BF3: Add server-side assertTierAccess to invoice template save
- Verify `assertTierAccess(TIER_FEATURES.INVOICE_DESIGNER)` is called in `saveInvoiceTemplate` action
- If missing, add it (scratchpad says it was applied but analysis found gap — verify and fix)

#### BF4: Deduplicate JWT plan logic in nextAuthOptions.ts
- Extract shared plan-fetching logic into a helper function used by both `buildAuthOptions()` and static `options`

#### BF5: Add warning log for unknown Stripe product names
- In `tierFromStripeProduct()`, log a warning when product name doesn't match any known mapping
- Include product name and ID in the log for debugging

#### BF6: Add loading skeleton to TierGate
- Replace `return null` while loading with a skeleton placeholder
- Prevents empty flash during slow session loads

#### BF7: Add FK on stripe_base_price_id
- New migration adding foreign key from `stripe_subscriptions.stripe_base_price_id` to `stripe_prices.stripe_price_id`

#### BF8: Mark add-ons scaffolding as intentional
- Add clear JSDoc to `addOns.ts` explaining it's intentional scaffolding for future use
- Add `// Scaffolding: not yet integrated into access checks` comment

### Documentation

#### DOC1: Tier Gating Developer Guide
- Create `docs/tier-gating-guide.md`
- Step-by-step: how to add a new feature to the tier gate
  1. Add feature to `TIER_FEATURES` enum
  2. Add to `TIER_FEATURE_MAP` for appropriate tiers
  3. Add to `FEATURE_MINIMUM_TIER` reverse map
  4. Gate UI with `TierGate` or `ServerTierGate`
  5. Gate server actions with `assertTierAccess()`
  6. Add display name in AccountManagement `FEATURE_DISPLAY_NAMES`
  7. Test: unit test for feature mapping, integration test for gating
- Include code examples from existing INVOICE_DESIGNER implementation
- Document CE bypass behavior

### Annual Billing

#### AB1: Create annual Stripe prices
- Env vars: `STRIPE_PRO_BASE_ANNUAL_PRICE_ID`, `STRIPE_PRO_USER_ANNUAL_PRICE_ID`, `STRIPE_PREMIUM_BASE_ANNUAL_PRICE_ID`, `STRIPE_PREMIUM_USER_ANNUAL_PRICE_ID`
- Stripe prices created with `recurring.interval: 'year'` and 10-month pricing

#### AB2: Add billing_interval to subscription tracking
- Migration: add `billing_interval` column to `stripe_subscriptions` (`'month'` | `'year'`, default `'month'`)
- Update subscription import/create to track interval

#### AB3: Checkout supports annual option
- Modify checkout session creation to accept `interval` parameter
- Pass annual price IDs when `interval === 'year'`

#### AB4: Account page billing interval toggle
- Show monthly/annual toggle with savings callout
- Switching interval creates new subscription schedule or updates at period end

#### AB5: Upgrade flow supports annual billing
- `upgradeTier()` accepts `interval` parameter
- Uses annual price IDs when `interval === 'year'`

### Trial System

#### TR1: Add trial fields to JWT/Session
- Add `trial_end`, `subscription_status` to JWT token and Session.user
- Refresh alongside plan (5-minute throttle)

#### TR2: Update TierContext with trial state
- Add to TierContextValue: `isTrialing`, `trialDaysLeft`, `trialEndDate`, `subscriptionStatus`
- Compute from session fields
- Add `isPaymentFailed` derived from `subscriptionStatus === 'past_due'`

#### TR3: Pro trial on new signup (7-day)
- Modify checkout session creation: add `subscription_data.trial_period_days: 7`
- CC captured via Checkout, not charged until trial ends
- Stripe auto-charges on trial end

#### TR4: Trial banner in header
- New `TrialBanner` component in Header
- Position: left side, next to tenant badge
- Shows: "{Plan} Trial: {N} days left"
- Links to `/msp/account`
- Warning color when ≤3 days remaining

#### TR5: Payment failure banner in header
- New `PaymentFailedBanner` component in Header
- Shows when `subscriptionStatus === 'past_due'` or `'unpaid'`
- "Payment failed — Update payment method" linking to Stripe billing portal
- Error/destructive styling, not dismissible

#### TR6: Trial status on account page
- New "Trial Status" card in Account Management
- Shows: plan, days remaining, progress bar, start/end dates
- CTA varies by state (continue, upgrade, update payment)

#### TR7: Handle trial end → auto-charge
- Stripe handles this natively via `trial_end` on subscription
- Webhook `customer.subscription.updated` fires when trial ends and billing starts
- Ensure `handleSubscriptionUpdated` correctly processes trial → active transition

#### TR8: Handle trial end → payment failure
- If charge fails at trial end, subscription goes to `past_due`
- Payment failure banner appears
- Stripe Smart Retries handle retry logic

#### TR9: Premium trial (30-day) — manual activation
- New server action: `startPremiumTrialAction(tenantId)` (admin-only, master billing tenant)
- Detects tenant's current state and handles accordingly:
  - **Paying Pro**: creates Premium subscription with `trial_period_days: 30`
  - **Pro trial**: (a) ends Pro trial by removing `trial_end` on subscription, (b) Stripe charges first month of Pro immediately, (c) then creates Premium subscription with `trial_period_days: 30`
- Updates `tenants.plan` to `'premium'`
- Customer sees Premium features immediately

#### TR10: Premium trial end — auto-charge or cancel
- **Default (customer does nothing)**: Stripe auto-charges for Premium at trial end → customer becomes paying Premium
- **Customer cancels during trial**: "Cancel Premium Trial" button on account page → reverts subscription, sets `tenants.plan` back to `'pro'`
- Webhook `customer.subscription.updated` handles both transitions:
  - `trialing` → `active`: auto-charge succeeded, customer is now paying Premium
  - `trialing` → `canceled`: customer cancelled during trial, revert to Pro
  - `trialing` → `past_due`: charge failed, show payment failure banner

#### TR11: Premium trial request form
- Textarea in Account Management (Plan & Tier section)
- Shown when: `isPro && !isTrialing` and user clicks "Upgrade to Premium"
- Server action: `sendPremiumTrialRequestAction(message)`
- Sends email to Nine Minds support with tenant info + message

#### TR12: Premium trial request — NineMinds extension
- Add "Trial Requests" section to TenantManagementView
- List pending requests with: tenant name, email, message, date
- "Start Premium Trial" action button per request
- Action calls API: `POST /api/v1/tenant-management/start-premium-trial`
- API endpoint: validates admin, calls `startPremiumTrialAction(tenantId)`

### Payment Enforcement

#### PE1: Track subscription_status in session
- Already covered by TR1 (subscription_status in JWT)

#### PE2: Payment failure detection
- `handleSubscriptionUpdated` webhook sets local `status` to match Stripe
- Status propagates to JWT on next refresh (≤5 min)

#### PE3: Visual payment reminder
- Already covered by TR5 (payment failure banner)

#### PE4: Grace period documentation
- Document 24-48 hour cancellation window after first charge post-trial
- This is handled via Stripe billing portal / support — no custom code needed

## Data / API / Integrations

### New Database Columns

**stripe_subscriptions:**
- `billing_interval` (text, default 'month') — 'month' | 'year'

**No new tables needed.** Trial state comes from Stripe subscription fields (`trial_end`, `status`).

### New JWT/Session Fields
- `trial_end: number | null` — Unix timestamp of trial end
- `subscription_status: string | null` — 'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled'

### New API Endpoints
- `POST /api/v1/tenant-management/start-premium-trial` — Admin-only, starts 30-day Premium trial

- `POST /api/v1/tenant-management/trial-requests` — List pending trial requests
- Server action: `sendPremiumTrialRequestAction(message)` — Sends email notification

### New Env Vars
- `STRIPE_PRO_BASE_ANNUAL_PRICE_ID`
- `STRIPE_PRO_USER_ANNUAL_PRICE_ID`
- `STRIPE_PREMIUM_BASE_ANNUAL_PRICE_ID`
- `STRIPE_PREMIUM_USER_ANNUAL_PRICE_ID`
- `TRIAL_REQUEST_EMAIL` — Email address for Premium trial requests (default: support@nineminds.com)

## Security / Permissions

- `startPremiumTrialAction` restricted to master billing tenant only
- Trial state read from Stripe (authoritative) via webhooks, not client-editable
- Payment failure banner cannot be dismissed (prevents ignoring payment issues)

## Rollout

### Phase 1: Bug Fixes & Documentation
- All BF* and DOC* items — safe to deploy, no behavior change

### Phase 2: Annual Billing
- AB* items — new Stripe prices must be created in Stripe Dashboard first
- Feature-flagged: `annual-billing` flag controls visibility of annual toggle

### Phase 3: Trial System
- TR* and PE* items — requires Stripe price configuration
- Feature-flagged: `trial-system` flag controls trial creation on checkout
- Premium trial is manual-only, no flag needed

## Resolved Questions

1. **What happens when subscription goes `unpaid`?** → Banner of shame + manual monitoring/outreach by Nine Minds. No automated lockout for now.
2. **Annual mid-year cancellation refund?** → Case-by-case manual process via support.
3. **24-48hr grace period after first charge?** → Support policy only. Handled via Stripe portal/support, no custom code.

## Acceptance Criteria

1. All 8 bugs fixed and verified
2. Developer guide published and covers full tier-gating workflow
3. Annual billing toggle works on checkout and account page
4. New signups get 7-day Pro trial with CC capture
5. Trial countdown visible in header on every page
6. Payment failure banner visible when subscription is past_due
7. Pro customers can request Premium trial via in-app form
8. Nine Minds admins can activate Premium trials from extension
9. Premium trial auto-charges at end unless customer cancels back to Pro
10. Customer can cancel Premium trial and revert to Pro from account page
