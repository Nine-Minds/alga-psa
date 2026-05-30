# Appliance License Purchase & Distribution — Design Spec

**Date:** 2026-05-30
**Status:** Approved design, pending implementation plan
**Depends on:** `2026-05-30-appliance-ee-ce-licensing-design.md` (Components 1–3)
**Scope:** The self-service purchase + license-distribution layer that the licensing spec
deferred (that spec's §3 / §10 "separate future project").

---

## 1. Goal

Let customers **buy and renew** appliance Enterprise licenses self-service, and get the signed
license **onto the appliance** by one of two transports:

- **Connected (default):** the appliance fetches its own license from a Nine Minds endpoint and
  auto-refreshes. If it cannot reach home, a grace window elapses and it drops to `essentials`.
- **Air-gapped (opt-in):** the customer chooses an annual plan, receives a long-lived signed
  license, and pastes it into the in-app License page. No phone-home, ever.

The licensing *mechanism* (signed ES256 JWT, baked-in public key, per-request tier resolution,
`license_state`, in-app License page) already exists from the licensing spec. This project adds
the **commerce** (how a license is bought) and **distribution** (how it reaches the box).

## 2. Where the storefront lives (and why)

Three options were weighed:

- **In the local appliance Alga** — rejected. The appliance's value proposition is that it runs
  locally; an order form that opens a socket to Nine Minds is a small technical thing but a large
  symbolic one, and erodes trust with exactly the buyers who chose the appliance. It is also
  unnecessary: licenses are applied offline, so the local app never needs to reach us to be
  licensed.
- **A separate standalone licensing site** — defensible and lowest-friction, but throws away the
  dogfooding proof point and adds a second product surface to build and maintain that does less.
- **The client portal (chosen)** — the same portal customers already use. The order is a
  **service request** (an order record), which makes "we run our own licensing through the same
  service-request flow we sell you" a live reference implementation. De-risked so Alga is *not*
  asked to be a license manager: order intake and delivery ride existing Alga primitives, signing
  stays in an internal service, and the delivered license is stored as a **document on the client**.

The local appliance phoning home for **its own license refresh** is categorically different from
the local app phoning home to **shop** — it is optional (air-gap buyers opt out entirely) and
carries no purchase traffic.

## 3. Key decisions

1. **Storefront = client-portal service request.** The submission is the order record.
2. **The local appliance never phones home to shop.** Purchase happens portal-side only.
3. **The signer stays out of the Temporal worker.** A small **internal signing & distribution
   service** holds the ES256 private key; the Temporal activity is a *client* of it. The trust
   root never enters the general-purpose worker or the open EE repo.
4. **One signed artifact, two transports.** The same ES256 JWT is either served on connected
   check-in or delivered for paste — identical verification on the appliance.
5. **Grace is the JWT `exp`, not a separate clock.** Connected licenses are short-lived
   (≈31-day `exp`, refreshed daily); air-gap licenses are 365-day. Worst case at disconnection
   is still ≈30 days. Signed `exp` is more tamper-resistant than a local "last check-in" file.
6. **Entitlement is driven by Stripe subscription status,** materialized as the current signed
   JWT the check-in endpoint serves. Subscription lapses → endpoint stops → box grace-expires.
7. **Binding via a one-time claim code.** Fulfillment mints a short code; the customer pastes it
   once into the appliance; the appliance registers and receives a per-appliance credential;
   subsequent check-ins are authenticated by that credential. The code is single-use.
8. **Issuance is idempotent and automatic on payment.** The Temporal workflow id is derived from
   the Stripe payment-intent id, backed by the existing `payment_webhook_events` table.
9. **Delivery = store-as-document + email + portal download.** Belt and suspenders, since email +
   offline paste is fiddly and people lose emails.
10. **The customer-facing entitlement is an Alga contract; the key is a client document.**
    Issuance upserts a `client_contracts` assignment (+ a license `contract_line`) carrying
    tier / term / expiry / renewal, and attaches the signed JWT as a document on the `client`.
    The portal shows licenses natively, so C4 holds only the cryptographic + refresh state.
    **Enforcement remains the JWT** (a connected box degrades on `exp` / grace regardless of
    contract status), so the contract is a customer-facing + renewal-workflow artifact, **not** a
    correctness-critical Stripe sync — which is why this stays cheap.

## 4. End-to-end flow

```
Portal service request (order: tier, seats, term, connected|air-gap)
        │
        ▼
Stripe Checkout Session  ──(metadata: service_request_submission_id, order params)
        │
        ▼  checkout.session.completed  (existing webhook receiver + signature verify)
Issuance workflow  (Alga workflow → Temporal, workflow id = license-issue:{payment_intent_id})
        │
        ├─ call internal signing service → signed JWT (exp = short for connected / 365d for air-gap)
        ├─ upsert customer-facing entitlement → client_contracts assignment (+ license line)
        ├─ store JWT as a document on the client  (redownloadable in the portal)
        ├─ record entitlement in C4 (subscription ↔ current JWT, for refresh)
        ├─ connected: mint one-time claim code
        └─ deliver: email + portal download
        │
   ┌────┴───────────────────────────────┐
   ▼ connected                          ▼ air-gap
Paste claim code into appliance      Paste JWT into in-app License page
   → register with check-in endpoint     → licensed until exp (renew annually)
   → receive per-appliance credential
   → daily refresh of short-exp JWT
   → subscription lapses ⇒ grace-expire to essentials
```

## 5. Components

- **C1 — Portal order intake.** A "license order" service-request type + form capturing tier,
  seats, term, and connected-vs-air-gap. Reuses the service-request submission system.
- **C2 — Stripe checkout for service requests.** Create a Checkout Session from a submission,
  stamping `service_request_submission_id` and order params into session metadata (the exact
  correlation pattern the payment webhook already uses for `tenant_id`). Adds a
  `checkout.session.completed` branch that fires the issuance workflow. Reuses existing webhook
  receiver, signature verification, `payment_webhook_events` idempotency, and the already-defined
  `STRIPE_LICENSE_PRODUCT_ID` / price-ID env config.
- **C3 — Issuance pipeline.** The Alga-workflow trigger off the paid webhook → Temporal workflow
  + activities: idempotent workflow id, call the signer, **upsert the `client_contracts`
  assignment + license `contract_line`** (the customer-facing entitlement), store the JWT as a
  client document, record the refresh-side entitlement in C4, mint the claim code (connected),
  deliver (email + portal). Renewal and cancellation events update the same contract via the same
  webhook → workflow path; no generic Stripe↔contract sync subsystem is built.
- **C4 — Internal signing & distribution service.** A **brand-new standalone repo at
  `~/alga-license`** (Nine Minds-hosted, *not* part of alga-psa). Holds the ES256 private key and
  the cryptographic + refresh state. Three surfaces: a **sign** endpoint (used by C3), a
  **check-in/refresh** endpoint (used by appliances), and a **claim-code registration** endpoint
  (exchanges a one-time code for a per-appliance credential). This is the licensing spec's
  "internal signing CLI" grown into a service so it can also serve refreshes. The customer-facing
  entitlement is *not* here — it lives in Alga as a contract (C3 / C6).
- **C5 — Appliance connected-licensing client.** Claim-code entry UI, registration, per-appliance
  credential storage, a daily refresh poller that overwrites `license_state.license_token`, and a
  thin inspectable heartbeat. Degradation is automatic via `exp`. Extends the appliance work from
  the licensing spec's Component 3; the air-gap path needs none of this (it reuses the existing
  in-app License page).
- **C6 — Portal "Licenses" view.** A new customer-facing read surface in the client portal: a
  `getClientContracts()` action + a Licenses tab/card listing the company's license contracts with
  tier / term / expiry / renewal status, each linking to its stored key document. The customer org
  is the **`client`** entity here; the key is attached with `entity_type='client'`, so re-download
  rides the **existing portal Documents page** with no new download plumbing. Native contract
  renewal (`renewal_mode`, `notice_period_days`, renewal work items) drives the annual air-gap
  re-delivery + pre-expiry nudge.

## 6. Data model touchpoints

- **Reused as-is:** `service_request_submissions` (the order); `contracts` / `client_contracts` /
  `contract_lines` (the **customer-facing entitlement** — term/expiry/status/renewal all native);
  `documents` / `document_associations` with `entity_type='client'` (the redownloadable key,
  surfaced by the existing portal Documents page); `payment_webhook_events` (idempotency);
  `license_state` (appliance-side effective tier).
- **The customer-facing entitlement lives in Alga as a contract + document — no separate mirror.**
  Open question #1 is resolved this way: the `client_contracts` row *is* the mirror, and a
  first-class one. A small extension may add a `stripe_subscription_id` reference to
  `client_contracts` for traceability, but enforcement does not depend on it.
- **New, server-side, owned by C4 (not the Alga DB):** the cryptographic + refresh state only —
  current license token per subscription, appliance registrations, per-appliance credentials, and
  outstanding claim codes. Keeping this in the signing service colocates the trust root with the
  refresh state and keeps the open repo clean.
- **New, appliance-side (small):** an install id, the check-in endpoint URL, the per-appliance
  credential, and a display-only `last_checkin_at`. Effective tier still comes from the existing
  `license_state` resolver — the poller just refreshes `license_token`.

## 7. The JWT contract is unchanged

The connected and air-gap transports both carry the licensing spec's existing claim shape
(`iss, sub, cust, tier, seats, iat, exp`). Connected refresh issues short-`exp` instances; air-gap
issues a 365-day instance. No verifier changes; no new claims required. The air-gap JWT remains a
portable, pasteable artifact (not install-bound) — consistent with the accepted license-sharing
tradeoff. The claim code binds the *connected appliance to the subscription* for refresh; it does
not restrict the JWT itself.

The `seats` claim is now **enforced for EE tiers** — wired to the app's existing seat /
licensed-user enforcement — and **not metered in `essentials`** (the community-equivalent floor
imposes no seat limit). This refines the licensing spec's §6.5; no claim-shape change is needed.

## 8. Security & trust model

- **Private key only in C4.** It never enters the Temporal worker or the repo. C3 sends issuance
  parameters and receives a finished token.
- **Thin, inspectable heartbeat.** Connected check-in sends the appliance credential + current
  license version and receives a signed JWT — no telemetry. The connected path is only defensible
  to trust-sensitive buyers if they can watch the traffic; air-gap remains the full opt-out.
- **Soft online revocation, for free.** Because entitlement gates what check-in serves, ceasing to
  serve fresh tokens grace-expires a connected box — the "online revocation" the licensing spec
  deferred. Air-gap licenses remain expiry-bound only.
- **Claim code** is single-use and short-lived, exchanged for a longer-lived per-appliance
  credential; reinstall re-issues a code and revokes the old credential.
- **Idempotent issuance** prevents double-mint on Stripe webhook retries.
- **Public-doc neutrality.** Describe the model neutrally in any public material; do not publish
  bypass instructions.

## 9. Defaults (please confirm in review)

- Connected `exp` ≈ **31 days**, poll **daily** (⇒ ≥30-day grace). Air-gap `exp` = **365 days**.
- **Automatic-on-payment** issuance (no human-in-the-loop approval).
- **Trial → paid conversion** reuses the same two transports: a trialing appliance enters a claim
  code (connected) or pastes a JWT (air-gap); no separate conversion flow.
- **Air-gap renewal:** rides the contract's native renewal workflow (`renewal_mode`,
  `notice_period_days`) — email a fresh annual JWT + a pre-expiry nudge; no auto-refresh.
- **Reinstall/rebind:** the portal re-issues a claim code and revokes the prior appliance
  credential.

## 10. Open questions for review

1. **Entitlement state location — RESOLVED.** The customer-facing entitlement is an Alga
   **contract** (`client_contracts` + license `contract_line`) and the key is a **client
   document**; the portal renders licenses natively via a new Licenses view (C6). C4 holds only
   cryptographic + refresh state. See §3.10 and §5 C3/C6.
2. **C4 shape — RESOLVED.** A brand-new standalone service in a new repo at `~/alga-license`
   (not part of alga-psa). See §5 C4.
3. **Seat enforcement — RESOLVED.** The license `seats` claim **is enforced for EE tiers** (wired
   to the app's existing seat / licensed-user enforcement); **`essentials` is not metered**. This
   refines the licensing spec's §6.5 (which had left `seats` informational). See §7.

All open questions are resolved.

## 11. Testing strategy

- **Checkout → trigger:** Stripe test events drive `checkout.session.completed`; assert the
  submission is correlated via metadata and the issuance workflow starts.
- **Idempotency:** a duplicated/retried webhook yields a single issuance (Temporal workflow-id
  dedupe + `payment_webhook_events`).
- **Issuance pipeline:** with a mocked signer, assert document stored, entitlement written, claim
  code minted, delivery attempted; real-signer wiring tested against C4 separately.
- **Connected client (live on VM):** claim-code entry → registration → daily refresh produces a
  fresh short-`exp` JWT; simulated subscription lapse → grace-expire to `essentials`.
- **Air-gap (live on VM):** paste annual JWT → licensed; expiry → `essentials`.
- Appliance behavior is validated live, not unit-tested, per the team's standing approach.

## 12. Out of scope (v1)

- True install-fingerprint binding of the air-gap JWT (it stays portable — accepted tradeoff).
- Per-tenant appliance licenses.
- The customer-facing abstraction that would let *our customers* license their own / third-party
  software through the same mechanism — a deliberate **Phase 2**; the C1/C3 seams should not
  preclude it, but it is not built now.
- Usage metering / analytics on the heartbeat.

## 13. Relationship to the licensing spec & sequencing

This project **depends on** the licensing spec's Component 1 (JWT contract + verification) and
Component 2 (`license_state`, `resolveSelfHostTier`, in-app License page), and **extends** its
Component 3 (appliance integration). It **fulfills** that spec's deferred self-service portal /
Stripe auto-issuance (§10) and, via connected refresh, its deferred online revocation (§8).

Suggested order once the licensing spec's Components 1–2 are in place:

1. **C4** — internal signing & distribution service, **new repo `~/alga-license`** (trust root +
   sign / check-in / register).
2. **C1 + C2 + C3 + C6** — portal order intake, Stripe checkout from a submission, issuance
   pipeline (now upserting the contract), and the portal Licenses view.
3. **C5** — appliance connected-licensing client.

The **air-gap path is shippable** as soon as C4's sign endpoint and the in-app License page exist;
the **connected path** additionally needs C5 and C4's check-in/register endpoints.
