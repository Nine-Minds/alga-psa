# PRD: Tenant Reactivation / Win-Back

- **Status:** Draft (for review)
- **Owner:** Natallia Bukhtsik
- **Created:** 2026-06-01
- **Repos:** `alga-psa` (app/auth/billing/temporal) + `nm-store` (order/checkout site)
- **Related:** 2026-06-01 duplicate-tenant idempotency fix (reactivation must reuse its
  "one tenant per customer" guarantee — see §9)

## 1. Problem statement & user value

When a customer cancels their subscription, their tenant is **not deleted immediately**.
The `tenantDeletionWorkflow` deactivates users and schedules deletion up to **90 days** out,
keeping all data intact and the workflow alive and reversible (it already has a
`rollbackDeletion` signal). Today we do nothing with that window:

- A cancelled user who tries to **log back in** just gets "invalid credentials" — no nudge,
  no path back, and we don't even know they tried.
- A cancelled user who returns to the **order page** to sign up again is hard-blocked with
  "A tenant already exists for this email," with no way forward — and if they somehow push
  through, they'd get a brand-new empty tenant instead of their real one.

This effort turns that 90-day reversible window into a **win-back funnel**: detect returning
cancelled customers and route them to *reactivate their existing tenant* (with all their data)
via a paid re-subscribe, rather than losing them or duplicating their account.

## 2. Goals

- Detect that an email/tenant is **mid-deletion and still reactivatable** (within the window,
  before `status='deleting'`).
- **Reactivation funnel:** paid new subscription at **full price (no first-month/intro
  discount, no trial)** → `rollbackDeletion` (reactivate users + data) → link the new
  subscription to the **existing** tenant → password reset so they can log in.
- **Checkout interception (nm-store):** when a returning cancelled customer enters their email
  on the order form, divert from normal checkout to the reactivation funnel (start by emailing
  them a reactivation link).
- **Login win-back (alga, email-only):** when a *login attempt* (password NOT verified — see §8)
  hits an inactive + mid-deletion account, silently send a throttled "come back" email; keep the
  generic invalid-credentials response unchanged.
- **No duplicate tenants:** reactivation reattaches to the existing tenant and never runs the
  new-tenant provisioning path.

## 3. Non-goals

- **No data restore after the point of no return.** Once `status` is `deleting`/`deleted`,
  reactivation is refused and the user is treated as a brand-new signup. Restoring from the S3
  export is explicitly out of scope.
- **No change to who/when triggers deletion** (Stripe/IAP/manual triggers are untouched).
- **No distinguishable login screen / new login error state** (decision: email-only).
- **No free reactivation / win-back coupon** (decision: full price, no intro discount).
- No new monitoring/dashboards/analytics beyond what the flows need to function.
- **No reactivation for Apple IAP tenants** (decided) — they have no Stripe subscription to
  re-create, so there is no path back; IAP cancellations proceed to deletion as today.
- **No _auto_-refund machinery** (decided) — but the refuse path is NOT silent: if a payment was
  captured and reactivation is then refused (status crossed to `deleting` in the
  checkout→completion gap, which can be minutes — e.g. an `immediate` confirm or the 90-day
  auto-delete landing in that gap; not "negligible"), we **fire an ops alert flagging the payment
  for manual refund** (§10, F034). Manual refund, but visible — not an invisible financial liability.

## 4. Personas & primary flows

**Persona — Returning cancelled admin** (their tenant is mid-deletion, within 90 days).

**Flow A — Returns to the order page (nm-store):**
1. Enters email on the order form.
2. `check-tenant` reports `pendingDeletion: true, reactivatable: true`.
3. Order form does NOT proceed to normal checkout. Shows "Welcome back — we found your
   account" and triggers a reactivation email to the tenant's admin email.
4. Email → reactivation checkout (full price, no intro coupon/trial), metadata marks it a
   reactivation for `tenantId`.
5. On payment success: `rollbackDeletion` signal reactivates the tenant + users (data intact),
   the new subscription is linked to the existing tenant, and a **force password-reset**
   (set-password) email is sent — which also verifies the admin's email ownership after a
   payment that did not otherwise prove identity.
6. User sets a new password and logs into their restored tenant.

**Flow B — Tries to log in (alga):**
1. Submits any credentials to an account that is `is_inactive` and mid-deletion.
2. Auth returns the generic invalid-credentials response (no UX change) — **the password is NOT
   verified** (the `is_inactive` gate short-circuits before `verifyPassword`; see §8).
3. Behind the scenes, a throttled win-back email is sent: "We noticed a sign-in attempt — your
   account is scheduled for deletion on `<date>`. Reactivate now" → links into the same
   reactivation funnel (Flow A, steps 4–6). Intent is confirmed downstream by **payment**, not by
   the login attempt; the email is just an invitation.

**Persona — Past-the-window customer:** `status='deleting'`/`deleted` → not reactivatable →
checkout proceeds as a normal new signup; login win-back email is not sent.

## 5. Scope

### In scope
- Mid-deletion detection helper + `check-tenant` response extension (alga).
- HMAC service-to-service "request reactivation email" endpoint (alga) callable by nm-store.
- Extend the Temporal deletion workflow's `rollbackDeletion` signal + rollback handler to perform
  reactivation (subscription→existing-tenant link + password-reset) via new activities, plus a
  thin server trigger that fires the enriched signal on reactivation-checkout success.
- Reactivation checkout (nm-store): no intro coupon, no trial, reactivation metadata.
- Order-form divert (nm-store).
- Login win-back email trigger + throttle (alga auth path).
- Two email templates: reactivation invite + login win-back.

### Reactivation eligibility
Reactivatable iff an active `pending_tenant_deletions` row exists with
`status NOT IN ('deleting','deleted','rolled_back','failed')` (i.e. `pending`,
`awaiting_confirmation`, or `confirmed` but not yet executing).

**Confirmed deletions are reactivatable** (verified against
`tenant-deletion-workflow.ts:347-367`): after a `confirmDeletion` signal the workflow sets status
`confirmed` and waits `deletionDelay` (30 or 90 days) while **still listening for the rollback
signal**, so rollback succeeds throughout that window. The window simply shrinks to the confirmed
delay; status flips to `deleting` (point of no return) only when the delay elapses with no
rollback. Edge: an **`immediate`** confirmation has `deletionDelay = 0`, so the wait is skipped and
`confirmed → deleting` happens back-to-back — effectively **no reactivation window**.

The reactivation/win-back emails must display the **effective** deletion date =
`COALESCE(deletion_scheduled_for, scheduled_deletion_date)`. There are TWO columns (verified in
migration `20260113120000` + `updateDeletionStatus`): `scheduled_deletion_date` is the auto-delete
deadline (`canceled_at + 90d`, NOT NULL, never updated); on confirmation the actual date is written
to a **separate** column `deletion_scheduled_for` (e.g. `now + 30d`), NULL until confirmed.
`updateDeletionStatus` does NOT touch `scheduled_deletion_date`.

## 6. UX / UI notes

- **Order form:** replace the dead-end "A tenant already exists for this email." with a
  reactivation branch only when `reactivatable`. If `exists` but NOT reactivatable (active,
  healthy tenant), keep the existing block. If past the window, allow normal signup.
- **Reactivation email:** clear "Welcome back", what reactivation does (restores data,
  requires re-subscribe at standard price), scheduled deletion date, single CTA → reactivation
  checkout. From `info@nineminds.com`.
- **Win-back email:** "We noticed a sign-in attempt", scheduled deletion date, reactivate CTA.
  Throttled to at most once per 14 days per tenant.
- **Reactivation checkout success page:** "Your account is being restored — check your email to
  set a new password." (Mirrors the thank-you page but for reactivation.)

## 7. Data model / API integration notes

- **Detection:** `pending_tenant_deletions` (one row per tenant via `unique(['tenant'])`).
  Read `status`, `workflow_id`, `subscription_external_id`, and both date columns
  (`scheduled_deletion_date` = 90d auto deadline, `deletion_scheduled_for` = confirmed date, NULL
  until confirmed). `reactivatable` = status ∈ {`pending`,`awaiting_confirmation`,`confirmed`}.
- **Edition placement (F042):** `pending_tenant_deletions` is an **EE-only** table (created only by
  `ee/server/migrations/20260113120000`). Every reader must therefore live in EE. The HMAC endpoints
  below (and the F035 password-reset endpoint) move to `ee/server/src/app/api/...` (mirroring the
  existing EE-only routes `internal/`, `provisioning/`, `v1/tenant-management/`), keeping the same URL
  paths nm-store signs against. Any pending-deletion read reachable in CE must fail-soft (table absent
  ⇒ "no pending deletion"), never throw.
- **`GET /api/billing/check-tenant`** (alga, HMAC; relocate to EE per F042): extend response with
  `pendingDeletion: boolean`, `reactivatable: boolean`, `deletionStatus?: string`, and
  `effectiveDeletionDate?: string` (= `COALESCE(deletion_scheduled_for, scheduled_deletion_date)`).
  Backward compatible (additive fields).
- **`POST /api/billing/request-reactivation`** (new, alga, HMAC same scheme; in EE per F042): body
  `{ email }`; looks up active pending deletion → sends reactivation email to tenant admin.
  Anti-enumeration: return 200 regardless; only email if reactivatable.
- **Reactivation checkout** (nm-store): Stripe Checkout for the plan's standard recurring price,
  `discounts` omitted (no `introCouponId`), no `trial_period_days`; `metadata` includes
  `reactivation: "true"`, `tenant_id`, `deletion_workflow_id`. **Created with the tenant's EXISTING
  Stripe customer** (`customer: cus_…`) — Stripe retains the customer after
  `customer.subscription.deleted`, so the new subscription attaches to the same customer rather than
  spawning a divergent one. nm-store does NOT set `customer` today (verified: `utils/stripe.ts` passes
  none → Stripe auto-creates one); it obtains the `cus_…` via F044 — a **non-PII** Stripe id returned
  by alga's token-exchange (the prior `subscription_external_id` and/or `cus_…`), or derived from
  Stripe with nm-store's own `STRIPE_SECRET_KEY`. The admin **email** is never sent to nm-store (F038).
- **Stripe customer reconciliation:** the existing tenant already has a `stripe_customers` row from
  the original subscription. Reactivation **reuses** it (F037 checkout + F019 link) — it must NOT
  create a second/divergent customer row, since the billing portal and future subscription webhooks
  key off the customer. Only a new `stripe_subscriptions` row is inserted.
- **Charged-but-refused ledger:** `pending_reactivation_refunds` table (F036) backs F034 — durable
  work queue of payments captured but not reactivated, for manual refund + an ops-inbox email.
- **Reactivation token ledger:** `tenant_reactivation_tokens` table (F040) backs F039 — durable
  single-use state for email links. Store `token_hash`, `tenant`, `deletion_id`, `expires_at`,
  `reserved_at`, `consumed_at`, `checkout_session_id`, and timestamps. The checkout route validates
  the signed token against this row and atomically reserves it before creating Stripe Checkout, so a
  replay cannot mint multiple sessions; completion consumes it on successful reactivation.
- **Stripe webhook branching:** `checkout.session.completed` handling must branch on
  `session.metadata.reactivation === "true"` **before** the normal subscription import/update path.
  Reactivation sessions run only the reactivation trigger/guard path (F041/F016); normal sessions
  continue through existing checkout handling. This prevents the webhook from importing the new
  subscription before the Temporal rollback handler owns the reactivation flow.
- **Reactivation completion** runs **inside the Temporal deletion workflow's rollback handler**
  (not a server orchestrator). The `rollbackDeletion` signal payload is extended with an optional
  `reactivation` block `{ stripeCustomerId, stripeSubscriptionId, stripeSubscriptionItemId,
  stripePriceId, sendPasswordReset }`. On checkout success a thin server trigger fires this
  enriched signal; the (already durable, retried) rollback handler then, in order:
  1. Reactivates users (`is_inactive=false`), removes Canceled tag, reactivates master client
     and contacts in the master tenant (existing rollback behavior).
  2. If a `reactivation` block is present: links the new Stripe subscription to the **existing**
     tenant by **reusing `createTenantInDB`'s exact stripe_customers/stripe_subscriptions insert
     path** (shared helper) so Citus shard routing is identical (`tenant` set explicitly), **without
     creating a tenant**, and stamps `subscription.metadata.tenant_id`. **Idempotency is keyed on
     the tenant, not the sub id:** if the tenant already has an active linked subscription, do not
     insert a second (two genuine payments → two distinct `sub_…` ids); the duplicate routes to the
     charged-but-refused/duplicate-payment alert (§10, F034).
  3. If `sendPasswordReset` (default for reactivation): force a **password-reset (set-password)**
     email — necessarily **after** step 1 (`requestPasswordReset` skips `is_inactive` users). The
     worker does **not** mint the link itself (it lacks `NEXT_PUBLIC_BASE_URL`/`NEXTAUTH_URL` and
     uses a different sender); it calls an **app-side HMAC endpoint** (F035) that runs the existing
     `requestPasswordReset` in app context (correct `baseUrl` + branded auth email). This also
     verifies email ownership after a payment that didn't prove identity. (Alternative if chosen:
     keep-old-password — omit `sendPasswordReset`; preserved hash lets the owner log in.)
  - The trigger must handle a **closed workflow**: once status is `rolled_back` the deletion
    workflow has returned, so signaling it throws — detect and route to the duplicate-payment alert
    instead of signaling.
  - The **admin** rollback endpoint passes **no** `reactivation` block → unchanged behavior
    (back-compat).
- **Win-back throttle:** add `last_winback_email_at timestamptz` to `pending_tenant_deletions`.

## 8. Login win-back integration

**Important (corrected):** `authenticateUser` (`packages/auth/src/actions/auth.tsx`) returns
`null` at the `is_inactive` gate (`:87`) **before** `verifyPassword` (`:97`). So the password is
NOT verified for inactive users, and the win-back hook **cannot and does not** confirm identity at
login. We do not attempt to authenticate the user — intent is confirmed downstream by **payment**.

Behavior: at the `is_inactive` gate, if an active `pending_tenant_deletions` row exists for
`user.tenant`, fire the throttled win-back email (respecting `last_winback_email_at`, ≤ once / 14
days per tenant) as a fire-and-forget side effect, then `return null` exactly as today. We do NOT
reorder the gate, do NOT call `verifyPassword`, and make no other behavior change for active users
or non-deletion inactive users. The email is sent on the login *attempt* regardless of password
correctness; it is merely an invitation to the (paid) reactivation funnel.

**Consequence — abuse surface:** because there is no password check, anyone who submits a known
mid-deletion email triggers (at most one per 14 days per tenant) a "your account is scheduled for
deletion — reactivate" email to the tenant admin. This is a mild spam/enumeration vector, bounded
by the per-tenant 14-day throttle, and the email contains no information the owner doesn't already
know. The 14-day throttle therefore exists for **anti-spam**, not as an intent signal (the login
attempt is an unverified signal; real intent = payment).

**Recipient:** detection keys on `user.tenant`, but the email is sent to the tenant's
**billing/admin email** (the party who can re-subscribe), not necessarily the user who attempted —
so a non-admin internal user's attempt emails the admin. The throttle is intentionally per-tenant,
so one user's attempt can consume the window for another's. This is by design (the admin owns
billing); just noted explicitly.

## 9. Idempotency / duplicate-tenant guard (critical)

Reactivation creates a **new** Stripe subscription (`sub_…`) for an **existing** tenant. It must
NOT go through the nm-store provisioning entry — `ensureOrderInstallWorkflowForCheckoutSession`
(`orderInstallFromCheckoutSession.ts`) → `startOrderInstallWorkflow` (`orderInstallTrigger.ts`) →
the tenant-creation workflow — because that path provisions a *new* tenant. The new subscription id
has no `tenant_id` metadata, so neither the metadata pre-check (Layer 3) nor the DB guard (Layer 2)
from the duplicate-tenant fix would stop it. Reactivation is a distinct, explicit "attach to
existing tenant" path; the reactivation checkout metadata (`reactivation:"true"`, `tenant_id`) is
the discriminator that keeps it off the provisioning path. (Related real symbols in that module:
`buildOrderInstallWorkflowInputFromCheckoutSession`, `isCheckoutSessionReadyForProvisioning`,
`buildOrderInstallWorkflowId`.)

## 10. Risks, rollout, open questions

**Risks**
- **Point-of-no-return race (with money on the line):** the checkout→completion gap can be
  minutes; if `status` flips to `deleting` in it, Stripe has already captured payment. Re-check
  status at the trigger; if refused after capture → surface "too late, sign up fresh" to the user
  AND fire the F034 ops alert flagging the payment for manual refund. (No auto-refund — see §3.)
- **Double payment / duplicate linking:** two genuine payments produce two distinct `sub_…` ids; a
  sub-id-keyed guard would link both → double billing. Idempotency is keyed on "tenant already has
  an active linked subscription" (F022); the second payment is refused-and-alerted (F034). The
  trigger must also not signal an already-closed (`rolled_back`) workflow (F016).
- **Email correctness ordering:** password reset before rollback would silently no-op
  (`is_inactive` filter). Enforce ordering (test).
- **Double trigger:** repeated reactivation-email requests or checkout reloads — make the
  email idempotent (throttle) and the completion idempotent (rollback is safe to call once;
  guard re-entry by checking status).
- **workflowClient.ts duplication** (`ee/server` + `packages/ee`) must stay in sync.

**Rollout**
- Additive endpoints + additive `check-tenant` fields → safe to deploy alga first; nm-store
  divert is gated on the new fields.
- Migration: add `last_winback_email_at` to `pending_tenant_deletions` (nullable).

**Resolved decisions (2026-06-01)**
1. **IAP-only tenants:** not supported — no path back (see §3).
2. **Refund/abort on the point-of-no-return race:** no refund machinery; refuse + message (see §3).
3. **Reactivation orchestration:** lives **inside the Temporal deletion workflow's rollback
   handler** via an enriched `rollbackDeletion` signal — NOT a server-side orchestrator (see §7).
4. **Win-back throttle:** at most **once per 14 days** per tenant. (Corrected rationale: the login
   attempt is NOT identity-verified — the password is never checked at the gate — so the throttle
   is an **anti-spam/anti-enumeration** cap, not an intent signal. Real intent = payment. See §8.)
5. **Login win-back does NOT verify the password** (decided): the `is_inactive` gate short-circuits
   before `verifyPassword`; we just send the reactivate invite on the attempt and confirm intent via
   payment downstream. No reordering of the auth flow.
6. **Reactivation password handling: force password-reset** (set-password email) by default — also
   verifies email ownership after a payment that didn't prove identity. Keep-old-password is a
   documented, lower-friction alternative (the hash is preserved through deactivation).

**Open questions:** none — plan is review-complete.

## 11. Acceptance criteria / definition of done

- A mid-deletion, in-window email entered on the order form does NOT start a normal checkout;
  it triggers a reactivation email to the tenant admin.
- Completing the reactivation checkout (a) reactivates the existing tenant and its users with
  all prior data intact, (b) links the new subscription to the existing tenant with NO new
  tenant created, (c) applies NO first-month/intro discount or trial, and (d) sends a
  password-reset email; the user can set a password and log into their restored tenant.
- A login attempt (password NOT verified) to an inactive, in-window account sends one win-back
  email (subject to the per-tenant throttle, to the tenant's billing/admin email) and still returns
  the generic invalid-credentials response.
- An out-of-window (`deleting`/`deleted`) email is treated as a normal new signup; no
  reactivation email and no win-back email are sent.
- No code path in the funnel creates a duplicate tenant (regression-tested against the
  idempotency guards).
- The reactivation email is sent only to the tenant's billing/admin email; a non-admin login
  attempt or order-form email entry never receives the link, and nm-store never sees the admin
  address. The reactivation checkout cannot be created without a valid, single-use reactivation
  token.

## 12. Authorization model — who may reactivate

Reactivation spends money on the org's behalf, so it must be gated on **authority**, not just
payment. The authority anchor is **control of the tenant's billing/admin email** — the same anchor
Stripe (billing contact) and our password-reset flow already rely on. We cannot gate via login/RBAC
because all users are deactivated (`is_inactive`) during the deletion window.

- **Recipient (F038):** the reactivation/win-back email goes ONLY to the tenant's billing/admin
  email (the original owner/`adminEmail` / Stripe customer email), resolved server-side. **Never**
  to the attempter (a non-admin's login attempt nudges the admin, not themselves) and never to the
  arbitrary email typed on the order form. nm-store never receives the admin address (anti-enumeration).
- **Token (F039):** the email link carries a signed, single-use, expiring token bound to
  `tenant_id`. The reactivation checkout cannot be created without a valid token (validated
  server-side against the durable token ledger); it is atomically reserved before Checkout creation
  and consumed on success (replay rejected before or after payment). So only someone with access to
  the admin inbox can *initiate* reactivation — payment alone cannot.
- **Access (F021):** after payment, the force password-reset link also goes to the admin inbox — so
  even completing payment grants no access without inbox control.

Authority chain: **admin-inbox control → token → checkout → payment → password-reset (same inbox) →
access.** Threat notes: a random payer without the token cannot initiate (no griefing/data
resurrection of arbitrary tenants, no enumeration). An attacker who controls the admin inbox is
already effectively the admin (could reset any password regardless), so email-ownership is an
acceptable and consistent anchor. Finer-grained billing RBAC is a possible future refinement but is
out of scope for v1 (a single billing/admin email is the authority).

## 13. Review-5 (2026-06-05) — edition placement, Stripe-customer resolution, residual findings

A fifth pass after verifying the claims against both repos. The first three items were already folded
into §5/§7; the rest are new (F042–F048). All file/line claims below are code-verified.

- **Edition placement — `pending_tenant_deletions` is EE-only (F042).** It is created only by
  `ee/server/migrations/20260113120000_create_pending_tenant_deletions.cjs` (exact table name
  `pending_tenant_deletions`). check-tenant currently lives in **CE** (`server/src/app/api/billing/`)
  and the login path is **shared** (`packages/auth`); reading the table from there throws where it
  doesn't exist. Resolution: move the HMAC endpoints (check-tenant, request-reactivation F006,
  reactivation-password-reset F035) into `ee/server/src/app/api/...` at the same URL paths, and make
  any CE-reachable read fail-soft. EE routes resolve via aliases (`scripts/build-enterprise.sh`).
- **Login win-back via the EE injection pattern (F043).** Don't inline an EE-table query in shared
  `auth.tsx`. Reuse the existing `@enterprise/*` dynamic-import + `isEnterprise` pattern
  (`loadEnterpriseSsoProviderRegistryImpl` / `enterpriseSsoRegistryInitPromise` in `nextAuthOptions.ts`,
  CE-stub fallback). The shared gate (`auth.tsx:87`) invokes a hook that is a no-op in CE.
- **nm-store resolves `cus_…` from Stripe, not alga's DB (F044) — confirms the "it comes from Stripe"
  intuition.** nm-store passes no `customer` today (`utils/stripe.ts`) and holds `STRIPE_SECRET_KEY`.
  alga's token-exchange returns a **non-PII** Stripe id (prior `subscription_external_id` / `cus_…`);
  nm-store sets `customer: cus_…` or derives it via `subscriptions.retrieve(sub_…).customer`. The admin
  email never crosses the boundary — F038 holds. F037 updated to stop shipping alga's DB row.
- **Reactivated-but-unbilled partial failure (F045).** `handleRollback` flips status to `rolled_back`
  and reactivates users before linking the subscription. A permanent link failure after a captured
  payment leaves a live tenant with no subscription — a gap not covered by F034's prior reasons. Raise
  F034 with a distinct `reactivated_unbilled` reason on exhausted retries.
- **F019 is a refactor, not a literal reuse (F046).** In `tenant-operations.ts` the customer and
  subscription inserts are coupled (sub FK uses the just-inserted internal customer; rows carry
  `billing_tenant = MASTER_TENANT_ID`). Extract a shared helper taking an existing internal
  `stripe_customer_id` that inserts only the sub row (preserving `tenant` + `billing_tenant`).
- **Throttle atomicity (F047)** — conditional `UPDATE … WHERE last_winback_email_at IS NULL OR <
  now()-14d RETURNING`, email only on a returned row (read-check-update double-sends under concurrency).
- **Admin-email source of truth (F048)** — the authority model hinges on this; pin the canonical field
  + fallback order behind one resolver shared by F008 and F025.

**Status:** review-complete pending implementation; no open questions.
