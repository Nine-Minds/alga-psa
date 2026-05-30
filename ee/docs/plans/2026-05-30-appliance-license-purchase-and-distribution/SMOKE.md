# SMOKE.md — post-implementation live validation

These checks are validated **live** (on the VM / in a running env) after implementation, not as
automated tests — consistent with the team norm of smoke-testing appliance work rather than
unit-testing it. The automated set in `tests.json` (`kind: "auto"`) is the ~80% correctness floor;
this list is the eyeball-able remainder. Existing harnesses to lean on:
`ee/appliance/tests/kubernetes-hosted-fresh-install-smoke.sh`, `ee/appliance/tests/local-utm-smoke.sh`.

**85 smoke checks** across 8 areas.

## C4 — alga-license service
- [ ] T001 — C4 /healthz returns 200 when the service is up  (F002)
- [ ] T002 — C4 boots with all required env present  (F003)
- [ ] T005 — Signed token header carries the expected kid  (F007)
- [ ] T009 — Ported signer output parity with ee/tools/alga-license/sign.mjs (same shape/claims)  (F005)
- [ ] T010 — Entitlement row is created/updated for a subscription on /sign  (F008, F014)
- [ ] T011 — Claim code persisted with TTL and consumed flag  (F009)
- [ ] T013 — Entitlement-store migrations create the expected schema  (F011)
- [ ] T014 — /sign returns a JWT for valid params  (F012)
- [ ] T016 — /sign rejects an invalid tier  (F015)
- [ ] T017 — /sign rejects non-numeric/negative seats  (F015)
- [ ] T018 — /sign rejects essentials/solo tiers (never sold)  (F015)
- [ ] T022 — /register rejects an unknown code  (F018, F030)
- [ ] T023 — /register rejects an expired code  (F018, F030)
- [ ] T027 — /register binds the appliance to the subscription  (F019)
- [ ] T029 — /check-in with a valid credential returns the current JWT  (F023, F024)
- [ ] T031 — /check-in returns 'no change' when the appliance holds the current version  (F025)
- [ ] T032 — /check-in returns a fresh JWT after a re-sign (renewal)  (F024, F066)
- [ ] T034 — /check-in updates last_checkin_at  (F027)
- [ ] T036 — /revoke marks a subscription entitlement inactive  (F029)
- [ ] T037 — Structured error returned for an invalid claim code  (F030)
- [ ] T038 — Structured error returned for a revoked appliance at check-in  (F030, F026)
- [ ] T039 — Structured error returned for bad sign params  (F030, F015)
- [ ] T136 — A second appliance registration under the same subscription rebinds/replaces (single-appliance v1)  (F019, F022)
- [ ] T137 — The C4 container image builds and starts, serving /healthz (scaffold + Dockerfile/k8s)  (F001, F004, F002)

## C1 — license-order request
- [ ] T040 — License-order service-request type is registered/discoverable  (F031, F038)
- [ ] T041 — License-order form renders tier/seats/term fields  (F032, F033, F034)
- [ ] T044 — Form validation rejects an invalid term  (F036)
- [ ] T046 — The license-order provider is registered in the enterprise registry  (F038)
- [ ] T047 — A license-order request appears in the portal service-request list/status  (F039)
- [ ] T048 — The portal entry point starts a license-order request  (F035)

## C2 — Stripe checkout
- [ ] T050 — A Stripe Checkout Session is created from a license-order submission  (F041)
- [ ] T052 — Connected term maps to subscription mode  (F044)
- [ ] T053 — Air-gap term maps to an annual/one-time term  (F044)
- [ ] T054 — Operator is redirected to the hosted Checkout URL  (F045)
- [ ] T055 — Success URL returns to the portal  (F046)
- [ ] T056 — Cancel URL returns to the portal  (F046)
- [ ] T057 — Webhook handles checkout.session.completed for a license order  (F047)
- [ ] T061 — Webhook fires the issuance workflow  (F050)
- [ ] T062 — Expired/canceled checkout produces no issuance  (F051)
- [ ] T063 — Webhook signature verification is enforced  (F047)

## C3 — issuance pipeline
- [ ] T065 — Issuance workflow is triggered on a completed payment  (F052)
- [ ] T070 — Activity calls C4 /sign and receives a JWT  (F055)
- [ ] T071 — A failed /sign is retried by Temporal  (F065)
- [ ] T074 — A license contract_line is upserted with tier/seats  (F058)
- [ ] T075 — renewal_mode is set on the contract for air-gap annual  (F059)
- [ ] T076 — The signed JWT is stored as a client document (entity_type='client')  (F060)
- [ ] T077 — The document is associated to the contract (entity_type='contract')  (F061)
- [ ] T078 — Connected issuance mints a claim code via /claim-codes  (F062)
- [ ] T079 — Air-gap issuance does NOT mint a claim code  (F062)
- [ ] T080 — Connected issuance email contains the claim code  (F063, F069)
- [ ] T081 — Air-gap issuance email contains the JWT  (F063, F069)
- [ ] T082 — Issuance email contains a portal link  (F063)
- [ ] T083 — Renewal event extends contract end_date and re-signs (connected)  (F066)
- [ ] T084 — Renewal event re-delivers an annual JWT (air-gap)  (F066, F068)
- [ ] T086 — Air-gap pre-expiry nudge re-delivers a fresh annual JWT respecting notice_period_days  (F068)
- [ ] T087 — Document content is the JWT and is retrievable + valid  (F060, F091)
- [ ] T135 — License contract status auto-expires off end_date (contract behavior)  (F057)

## Seat enforcement
- [ ] T093 — Reaching the appliance seat limit returns a clear error  (F074)
- [ ] T095 — Existing SaaS seat-purchase flow (LicensePurchaseForm / licence-count) still works (regression)  (F073)

## C5 — appliance connected client
- [ ] T096 — Migration adds appliance_id, check_in_url, appliance_credential, last_checkin_at to license_state  (F075)
- [ ] T097 — The 'Connect this appliance' claim-code control redeems a code  (F076, F077)
- [ ] T099 — Register response (credential, check_in_url, first JWT) is stored in license_state  (F077)
- [ ] T102 — license_state remains a single row after connect (singleton invariant)  (F078, F075)
- [ ] T103 — The refresh job calls C4 /check-in on schedule  (F079)
- [ ] T104 — Refresh overwrites license_token when a new JWT is returned  (F080)
- [ ] T106 — Refresh no-ops on a 'no change' result  (F081)
- [ ] T107 — Refresh leaves the current token on a revoked result (grace)  (F082)
- [ ] T110 — License page shows connected status + last check-in time  (F084)
- [ ] T111 — Entering a new claim code rebinds (replaces the stored credential)  (F085)
- [ ] T112 — Air-gap paste still works alongside connect  (F086)
- [ ] T113 — Invalid/expired/consumed claim code at connect shows a clear error  (F087)
- [ ] T114 — Connected vs air-gap state is shown distinctly on the License page  (F084)

## C6 — portal Licenses view
- [ ] T116 — The Licenses tab/route renders at a route distinct from the account stub  (F089)
- [ ] T117 — The list shows tier/term/expiry/renewal status  (F090)
- [ ] T118 — The 'Download key' action links to the stored document  (F091)
- [ ] T119 — Key download is served via the existing portal Documents mechanism  (F092)
- [ ] T120 — Empty state shows when the client has no license contracts  (F093)
- [ ] T121 — A portal nav entry for Licenses is present  (F094)
- [ ] T124 — Existing client-portal Documents page still works (regression)  (F092)

## Cross-cutting / end-to-end
- [ ] T125 — Shared C4 contract types round-trip between alga-psa and the service shapes  (F096)
- [ ] T126 — The C4 client module calls /sign with the service credential  (F097)
- [ ] T127 — The C4 client module surfaces structured errors to callers  (F097, F030)
- [ ] T131 — Documentation lists the appliance SKUs and the C4 API contract  (F099)
- [ ] T132 — E2E connected happy path: order -> pay -> issue -> connect -> refresh  (F100)
- [ ] T133 — E2E air-gap happy path: order -> pay -> issue -> paste -> licensed  (F100)
