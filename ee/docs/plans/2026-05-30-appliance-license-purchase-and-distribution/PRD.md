# PRD — Appliance License Purchase & Distribution

**Date:** 2026-05-30
**Status:** Draft (pending user confirmation of scope)
**Design spec:** `docs/superpowers/specs/2026-05-30-appliance-license-purchase-and-distribution-design.md`
**Depends on:** `docs/superpowers/specs/2026-05-30-appliance-ee-ce-licensing-design.md` (Components 1–2 — already built)
**Plan folder:** `ee/docs/plans/2026-05-30-appliance-license-purchase-and-distribution/`

---

## 1. Problem statement & user value

Today an appliance operator can only get licensed out-of-band: a Nine Minds operator runs the
signing CLI by hand and emails a JWT for the operator to paste into the in-app License page. There
is no self-service purchase, no automated issuance, no customer-visible record of what was bought,
and no way to keep a connected appliance's license fresh without manual re-pasting.

This project adds the **commerce + distribution** layer on top of the already-built licensing
mechanism (signed ES256 JWT, `license_state`, per-request tier resolution, in-app License page):

- Customers **buy and renew** appliance licenses self-service in the client portal.
- Payment **automatically** signs and delivers a license — no human in the loop.
- The license appears as a **contract** the customer can see, with the key as a **re-downloadable
  document**.
- The license reaches the appliance one of two ways: **connected** (auto-refresh, no re-pasting)
  or **air-gapped** (paste an annual key).

## 2. Goals / Non-goals

### Goals
1. Self-service appliance-license purchase + renewal via the client portal (a "license order"
   service request → Stripe Checkout).
2. Automatic, idempotent, exactly-once issuance on payment.
3. Issuance: sign an ES256 JWT via the new `~/alga-license` service, record the entitlement as an
   Alga **contract** (`client_contracts` + license line), store the JWT as a **client document**,
   and deliver it (email + portal).
4. Two transports for the same signed artifact:
   - **Connected** — a one-time claim code pasted into the in-app License page binds the appliance;
     it then auto-refreshes a short-`exp` JWT daily; grace via `exp`; lapse → `essentials`.
   - **Air-gap** — a 365-day JWT pasted into the existing License page; annual renewal.
5. A customer-facing **Licenses** view in the portal listing their license contracts (tier / term /
   expiry / renewal) with key download.
6. **Seat enforcement:** the license `seats` claim is enforced for EE tiers at the existing
   user-creation seam; `essentials` is unmetered.
7. The new **`~/alga-license`** service (C4): holds the ES256 private key + crypto/refresh state;
   exposes sign / check-in / claim-code-register endpoints.

### Non-goals (v1)
- Install-fingerprint binding of the air-gap JWT (it stays portable — accepted tradeoff).
- Per-tenant appliance licenses (the `license_state` install-global singleton stays).
- The Phase-2 "customers license their own / third-party software" abstraction.
- Heartbeat usage metering / analytics.
- Completing the `isEnterprise → eeRuntimeEnabled` choke-point conversion — that is licensing-spec
  Component 2 work and an **external dependency** here, not owned by this plan.
- Re-building Components 1–2 — already done (verify, keys, signing CLI, `license_state`, resolver,
  in-app License page, appliance setup edition choice/license field).

## 3. Personas & primary flows

**Personas**
- **Appliance operator** — the MSP admin running the on-prem appliance; buys, applies, renews.
- **Nine Minds (issuer)** — operates `~/alga-license`, custodian of the private key.
- (The customer organization entity in Alga is the **`client`**.)

**Primary flows**
- **A. Purchase — connected.** Operator opens the portal → submits a License-order service request
  (tier, seats, term=connected-monthly|connected-annual) → redirected to Stripe Checkout → pays →
  issuance pipeline signs the JWT, upserts the contract, stores the key document, **mints a
  one-time claim code**, emails it → operator pastes the claim code into `/msp/licenses` → the
  appliance registers with `~/alga-license`, receives a per-appliance credential + first JWT →
  daily refresh thereafter.
- **B. Purchase — air-gap.** Same through issuance, but term=air-gap-annual → a **365-day JWT** is
  emailed + stored as a document → operator pastes the JWT into `/msp/licenses` (existing path) →
  licensed.
- **C. Renewal — connected.** Subscription renews → check-in keeps serving fresh short-`exp` JWTs;
  no operator action. Subscription lapses → check-in stops → the held JWT grace-expires → tier
  drops to `essentials`.
- **D. Renewal — air-gap.** The contract's native renewal workflow nudges before expiry and
  re-delivers a fresh annual JWT → operator re-pastes.
- **E. View licenses.** Operator opens the portal **Licenses** tab → sees their license contracts
  with tier / term / expiry / renewal → downloads the key document.
- **F. Seat enforcement.** Creating an internal user checks the resolved license `seats` (EE tiers);
  `essentials` imposes no limit.

## 4. Components & status

| Component | Repo | Status going in | This plan builds |
|---|---|---|---|
| **C1** License-order service-request type + form | alga-psa | greenfield (SR provider/template infra exists) | new SR type, form schema (tier/seats/term), portal entry |
| **C2** Stripe Checkout from a submission | alga-psa | greenfield (webhook receiver exists) | Checkout Session w/ metadata correlation; `checkout.session.completed` branch → issuance |
| **C3** Issuance pipeline (workflow + Temporal activities) | alga-psa | greenfield (Temporal infra exists) | idempotent workflow; sign-call / contract-upsert / doc-store / claim-code / deliver activities |
| **C4** Signing & distribution service | **`~/alga-license` (new repo)** | greenfield | scaffold repo; port `sign.mjs`; sign / register / check-in endpoints; entitlement store |
| **C5** Appliance connected client | alga-psa (in-app) | partial (setup UI done) | claim-code entry on `/msp/licenses`; registration; app-side daily refresh job; `license_state` columns |
| **C6** Portal Licenses view | alga-psa (client-portal) | greenfield (stub only) | `getClientContracts()`; Licenses tab at a distinct route; key download |
| **Seat enforcement** | alga-psa | seam exists (`createUser`) | enforce license `seats` in self-host mode; essentials unmetered |

Prerequisite (external dependency, not built here): the `isEnterprise → eeRuntimeEnabled`
choke-point conversion from licensing-spec Component 2.

## 5. UX / UI notes

- **License-order service request (C1):** a new request type with fields — tier (`pro`/`premium`),
  seats (number), term/transport (`connected-monthly` | `connected-annual` | `air-gap-annual`). On
  submit, the portal redirects the operator to the Stripe-hosted Checkout for the matching SKU.
- **In-app License page `/msp/licenses` (C5):** add a **"Connect this appliance"** claim-code entry
  (a short code field) beside the existing paste-a-license control. After connecting, the page
  shows connected status + last check-in time; the existing paste-license path remains for air-gap.
- **Portal Licenses view (C6):** a new **Licenses** tab in the client portal at a route distinct
  from the existing `account/LicenseManagementPage` stub, listing the client's license contracts
  (tier / term / expiry / renewal status) with a **Download key** action that links to the stored
  document (served by the existing portal Documents mechanism).
- **Emails:** issuance email containing the **claim code** (connected) or the **JWT** (air-gap),
  plus a link to the portal Licenses view.

## 6. Data model / API integration notes

- **Stripe (new, dedicated appliance SKUs):** products/prices for tier × term —
  `pro/premium` × `{connected-monthly, connected-annual, air-gap-annual}`. New env keys (separate
  from the SaaS-seat `STRIPE_LICENSE_*`). The exact price *values* are config, set later.
- **Checkout Session metadata:** `service_request_submission_id`, `tier`, `seats`, `term`,
  `transport`, `client_id` — mirroring the existing `tenant_id` metadata-correlation pattern in
  `/api/webhooks/stripe/payments`.
- **Idempotency:** reuse `payment_webhook_events`; the Temporal workflow id is
  `license-issue:{payment_intent_id}` (exactly-once).
- **Contract:** upsert `client_contracts` (+ a license `contract_line`) carrying tier / term /
  `start_date`/`end_date`; set `renewal_mode` for air-gap annual so the native renewal workflow
  drives re-delivery.
- **Document:** the signed JWT is attached with `document_associations.entity_type='client'`
  (optionally also `'contract'`), so it surfaces in the existing portal Documents page.
- **`license_state` additions (app admin DB, for C5):** `appliance_id` (install id), `check_in_url`,
  `appliance_credential`, `last_checkin_at` (display). The refresh job overwrites `license_token`;
  tier still resolves through the existing `resolveSelfHostTier`.
- **`~/alga-license` (C4) API:**
  - `POST /sign` — issuance params (`tier, seats, cust, sub, exp/term`) → signed JWT. Authenticated
    by a service credential held by alga-psa (Temporal activity). Private key never leaves C4.
  - `POST /register` — one-time claim code → `{ appliance_credential, first_jwt, check_in_url }`;
    consumes the code, binds the appliance to the Stripe subscription.
  - `POST /check-in` — appliance credential + current license version → current signed JWT (or
    "no change" / "revoked"). Thin, inspectable.
  - **Entitlement store** (C4-owned): subscription ↔ current token, claim codes, appliance
    registrations + credentials.
- **Seat enforcement:** `createUser` (`packages/users/.../userActions.ts`) consults
  `resolveSelfHostTier()` seats when a `license_state` row exists (self-host mode); `essentials`
  imposes no limit; SaaS path (`tenants.licensed_user_count`) unchanged.

## 7. Security model

- The ES256 **private key lives only in C4**; alga-psa's Temporal activity calls `POST /sign` with
  a service credential. The key never enters the Temporal worker or the alga-psa repo.
- **Claim code** is single-use and short-lived, exchanged at `/register` for a longer-lived
  per-appliance credential; reinstall re-issues a code and revokes the prior credential.
- **Check-in** is authenticated by the appliance credential; the heartbeat carries only the
  credential + current license version in and a signed JWT out — no telemetry.
- **Soft revocation:** C4 ceasing to serve a fresh token grace-expires a connected appliance.
- **Air-gap JWT** is a portable, pasteable artifact (not install-bound) — accepted tradeoff.
- **Enforcement always lives in the JWT**; the contract is display + renewal-workflow only.

## 8. Risks, rollout & open questions

**Risks**
- *Shared seat-enforcement seam.* The appliance `seats` enforcement and the SaaS
  `licensed_user_count` enforcement share `createUser`; the new check must branch on self-host mode
  so SaaS behavior is untouched.
- *Choke-point conversion incomplete.* `essentials` surface-gating depends on the (external)
  choke-point conversion; if incomplete, `essentials` may over-expose EE surfaces. Tracked as a
  dependency, not fixed here.
- *Cross-repo contract.* C4 lives in a separate repo; the `/sign`, `/register`, `/check-in`
  request/response contracts must be versioned and kept in lock-step with alga-psa.

**Rollout / migration**
- New migration adds C5 columns to `license_state`.
- New Stripe products/prices + env keys provisioned in test mode first, then production.
- Air-gap path is shippable as soon as C4 `/sign` exists + the in-app License page (already built);
  the connected path additionally needs C5 + C4 `/register` + `/check-in`.

**Open questions (non-blocking; resolve during build)**
- Exact appliance-license **price matrix** values.
- **Claim-code format** (length / charset / TTL).
- Email templating specifics (reuse existing transactional email infra).

## 9. Acceptance criteria / Definition of Done

1. An operator can complete a License-order purchase in the portal and, on payment, **automatically**
   receive a working license — a claim code (connected) or a 365-day JWT (air-gap) — with no manual
   Nine Minds action.
2. Pasting the **claim code** into `/msp/licenses` connects the appliance; it then **auto-refreshes**
   daily and **grace-expires to `essentials`** when the subscription lapses.
3. Pasting the **air-gap JWT** licenses the appliance; the contract renewal workflow nudges +
   re-delivers before annual expiry.
4. The portal **Licenses** view lists the customer's license contracts (tier / term / expiry /
   renewal) and offers a working **key download**.
5. **Seat enforcement** honors the license `seats` for EE tiers; `essentials` is unmetered; SaaS
   seat behavior is unchanged.
6. Issuance is **idempotent** — a duplicated/retried Stripe webhook yields exactly one license,
   one contract, one document.
7. The ES256 **private key is never present** in alga-psa or the Temporal worker; alga-psa only
   calls C4's `/sign`.

## 10. Implementation sequencing

0. **(Prerequisite, external)** Components 1–2 are in place; the choke-point conversion is tracked
   separately.
1. **C4** — scaffold `~/alga-license`; port `sign.mjs`; `/sign`, `/register`, `/check-in`;
   entitlement store. (Unblocks both transports.)
2. **C1 + C2 + C3 + C6** — License-order SR type + form; Stripe Checkout from the submission;
   issuance pipeline (sign / contract / document / claim-code / deliver); portal Licenses view.
   (Air-gap path end-to-end shippable here.)
3. **C5** — claim-code entry + `license_state` columns + app-side refresh job. (Connected path
   end-to-end.)
4. **Seat enforcement** — wire the `seats` claim at `createUser` (can land alongside step 2/3).
