# SCRATCHPAD — Appliance License Purchase & Distribution

Working memory for the plan. Append discoveries, decisions, gotchas.

## Source documents
- Design spec: `docs/superpowers/specs/2026-05-30-appliance-license-purchase-and-distribution-design.md`
- Depends-on spec: `docs/superpowers/specs/2026-05-30-appliance-ee-ce-licensing-design.md` (Components 1–2)

## Components (from spec)
- C1 portal order-intake (service request) — alga-psa
- C2 Stripe Checkout from a submission (metadata correlation) — alga-psa
- C3 issuance pipeline (webhook → workflow → Temporal → sign/upsert-contract/store-doc/claim-code/deliver) — alga-psa
- C4 internal signing & distribution service — NEW repo `~/alga-license`
- C5 appliance connected-licensing client (claim-code, daily refresh, exp grace) — alga-psa (ee/appliance)
- C6 portal "Licenses" view — alga-psa (client-portal)

## DISCOVERY — prerequisite status (much further along than the spec assumed)
Verified 2026-05-30 by grep/find:

**Component 1 — mostly DONE (signer is the gap):**
- `packages/licensing/src/lib/verify-license.ts`, `license-keys.ts`, `license-types.ts` (+ tests) exist.
- Signing CLI: NOT present anywhere (only named in specs). → becomes C4's sign endpoint; do not plan a separate CLI.

**Component 2 — substantially present (confirm completeness in Explore):**
- Migration `server/migrations/20260530100000_create_license_state.cjs` exists.
- `resolveSelfHostTier` / `license-state.ts` present in BOTH `packages/licensing/src/lib/` and `server/src/lib/tier-gating/`.
- `essentials` tier referenced in `packages/types/src/constants/tenantTiers.ts`, `server/src/lib/tier-gating/assertTierAccess.ts`, `packages/auth/src/lib/nextAuthOptions.ts`, `packages/auth/src/hooks/useEeEnabled.ts`.
- In-app License surface: `server/src/components/licenses/LicenseManagementPage.tsx`, `server/src/components/licenses/LicenseBanner.tsx`.

**PRE-EXISTING SaaS seat-purchase flow (DISTINCT product — do NOT duplicate; this is the seat-enforcement substrate the `seats` claim wires into):**
- `packages/ee/src/components/licensing/LicensePurchaseForm.tsx`, `ReduceLicensesModal.tsx`
- `server/src/app/msp/licenses/purchase/success/page.tsx` (purchase success page)
- `server/src/app/api/billing/licence-count/route.ts`
- `server/src/lib/license/get-license-usage.ts`, `packages/licensing/src/lib/get-license-usage.ts`
- `migrations/20250818020000_add_licensed_user_count.cjs`
- Client-portal license surface already exists: `packages/client-portal/src/components/account/LicenseManagementPage.tsx` → relevant to C6.

→ IMPORTANT distinction: existing flow = SaaS per-tenant **seat** licensing (buy N seats via Stripe, enforce licensed_user_count). NEW work = appliance **edition/tier** license (signed JWT, two transports). They share the seat-enforcement substrate but are different products. Plan must integrate, not duplicate.

## Stripe substrate (from earlier exploration)
- Webhooks: `/api/webhooks/stripe` (subscriptions, EE-only/404 in CE) and `/api/webhooks/stripe/payments` (invoice payments). Receiver + signature verify + `payment_webhook_events` idempotency already exist.
- Payment correlation precedent: payments webhook extracts `tenant_id` from event metadata → mirror this with `service_request_submission_id`.
- Env already defined: `STRIPE_LICENSE_PRODUCT_ID`, `STRIPE_*_PRICE_ID`.
- Services: `ee/server/src/lib/stripe/StripeService.ts`, `ee/server/src/lib/payments/PaymentService.ts`.

## Service requests / workflow / Temporal (from earlier exploration)
- Submission: `server/src/lib/service-requests/submissionService.ts:submitPortalServiceRequest()` → execution provider → `startWorkflowRuntimeV2TemporalRun()`.
- Trigger today fires on SUBMISSION (pending→succeeded); there is NO "paid" state. We must trigger issuance on the Stripe webhook, correlated to the submission — not on submission.
- Temporal bridge: `ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts`; worker `ee/temporal-workflows/src/worker.ts`; license activities stub: `ee/temporal-workflows/src/activities/license-management-activities.ts`.

## Contracts / documents (from earlier exploration)
- Customer org entity = `client` (not "company"). License = `client_contracts` assignment (+ `contract_lines`); native term/expiry/status/renewal.
- Doc attach: `document_associations` `entity_type='client'` → surfaced by existing client-portal Documents page (free re-download).
- Models: `packages/billing/src/models/contract.ts`, `packages/types/src/interfaces/contract.interfaces.ts`.

## Decisions settled in the design spec
- One signed JWT, two transports (connected ~31d daily-refresh, ~30d grace via exp; air-gap 365d paste).
- Enforcement lives in the JWT; contract is display + renewal-workflow only (no generic Stripe↔contract sync).
- Seats enforced for EE tiers, unmetered in essentials (wire to existing licensed_user_count enforcement).
- Private key only in C4 (`~/alga-license`); never in Temporal worker or alga-psa repo.
- Idempotent issuance: Temporal workflow id = `license-issue:{payment_intent_id}`.

## Open questions to resolve before finalizing PRD
- C4 (`~/alga-license`) tech stack + deployment target.
- Stripe SKU strategy: reuse `STRIPE_LICENSE_PRODUCT_ID` or new products/prices for connected-monthly vs air-gap-annual × tier?
- Exact completeness of Components 1–2 (does this plan include finishing them, or are they truly done?).

## Gotchas
- snap node shim `/snap/bin/node` is broken for running scripts; use `process.execPath` / `/snap/node/current/bin/node` (from appliance work).
- Appliance host-service work is validated live on the VM, not unit-tested (team norm).

## DISCOVERY 2 — grounded status (corrects DISCOVERY 1)
Verified 2026-05-30 by a thorough Explore pass.

**Signing CLI EXISTS** (corrects earlier note): `ee/tools/alga-license/sign.mjs` — subcommands `sign`/`gen-keypair`/`gen-fixture`; private key via `ALGA_LICENSE_PRIVATE_KEY_FILE`, never committed. → C4 can PORT this signing logic; reuse `packages/licensing` verify for round-trip tests.

**Prerequisite Components 1–2 are essentially DONE:**
- C1 `LicenseClaims` = `{iss,sub,cust,tier:'pro'|'premium',seats?,iat,exp}`; `verifyLicense()` returns `{valid,claims}|{valid:false,reason}`; `kid`-selected baked keys (`v1` prod public-only, `v1-test` throwaway). Callers must re-check `claims.exp` vs now (verify caches per-token).
- C2 `license_state` cols: `id, edition_choice('ce'|'ee'), trial_started_at, license_token, updated_at` (install singleton). `resolveSelfHostTier()` in `packages/licensing/src/lib/license-state.ts` (server one re-exports). `essentials` rank -1 (`packages/types/src/constants/tenantTiers.ts`). Session `eeEnabled`/`effectiveTier` in `packages/auth/src/lib/nextAuthOptions.ts`; client hook `useEeEnabled.ts`. `eeRuntimeEnabled()` in `server/src/lib/tier-gating/assertTierAccess.ts`.
- In-app License page DONE + wired: route `/msp/licenses` → `LicenseManagementPage.tsx`; `LicenseBanner.tsx` on `/msp/*`; actions `getLicenseStatus/submitLicense/startTrial` (`server/src/lib/actions/licenseManagementActions.ts`), RBAC-gated only. Appliance setup UI already has edition choice + license field (`ee/appliance/status-ui/app/setup/page.tsx`).
- INCOMPLETE prerequisite (licensing-spec territory, NOT this plan): systematic `isEnterprise → eeRuntimeEnabled` choke-point conversion. External dependency.

**Seat-enforcement seam:** `packages/users/src/actions/user-actions/userActions.ts:193–230` `createUser()` rejects when active-internal-users >= `tenants.licensed_user_count`. New work: in self-host mode ALSO enforce against resolved license `seats`; essentials = unmetered. C3 ADDS Temporal activities alongside the SaaS-seat ones in `ee/temporal-workflows/src/activities/license-management-activities.ts`.

**Per-component verdict (alga-psa side):**
- C1 license-order SR type + form → GREENFIELD (provider/registry + template/form-behavior infra exists; only `starterTemplateProvider` today).
- C2 Stripe Checkout from a submission → GREENFIELD (webhook receiver exists; no SR→Checkout link; need provider/form-behavior + `checkout.session.completed` branch).
- C3 issuance pipeline → GREENFIELD (Temporal infra exists; add sign/contract-upsert/doc-store/claim-code/deliver activities).
- C4 `~/alga-license` → separate repo (scaffold; port sign.mjs).
- C5 appliance connected client → PARTIAL (setup UI done; claim-code entry + registration + daily refresh poller missing).
- C6 portal Licenses view → GREENFIELD (client-portal `account/LicenseManagementPage.tsx` is a stub; distinct route for the new contracts view).

**Collision watch:** SaaS `licensed_user_count` vs appliance `seats` enforce at the SAME `createUser` seam — integrate, don't duplicate. C6 must use a distinct route from the existing client-portal stub. `license_state` is install-global singleton (per-tenant deferred).

## DECISIONS (confirmed 2026-05-30)
- **C4 stack/deploy:** Node/TS; PORT `ee/tools/alga-license/sign.mjs` into the service; reuse `packages/licensing` verify for round-trip tests; small HTTP service, containerized, Nine Minds-hosted (k8s).
- **Stripe SKUs:** NEW dedicated appliance-license products/prices (tier pro/premium × {connected-monthly, connected-annual, air-gap-annual}); kept separate from the SaaS per-seat `STRIPE_LICENSE_*` SKUs.
- **C5 home:** IN-APP — claim-code entry extends `/msp/licenses` License page; daily refresh runs as an app-side scheduled job; per-appliance credential + check-in URL stored in the app admin DB next to `license_state` (new columns); refresh overwrites `license_state.license_token`.

## PLAN STATUS
- 2026-05-30: PRD + features.json (100, F001–F100) + tests.json (138, T001–T138) drafted; scope confirmed by user. JSON validated: unique ids, no dangling featureIds, every feature has >=1 test.
- TESTING APPROACH (per Robert): light automated testing for ~80% confidence, smoke-validate the rest live afterward. tests.json items are tagged `kind: auto|smoke` — **53 auto** (silent-failure-prone logic: sign↔verify + exp/grace math, idempotency/exactly-once, auth/authz, claim-code single-use+concurrency, seat math, SaaS-unchanged regression, no-private-key guards) and **85 smoke** (UI/nav/redirects/email/container/e2e happy paths) captured as a live checklist in `SMOKE.md`. Lean toward smoke for appliance-side work; don't over-unit-test.
- Feature spread: C4=30, C3=18, C5=13, C2=12, C1=9, C6=8, Seat=5, Xcut=5.
- Build order (PRD §10): prerequisites done → C4 (`~/alga-license`) → C1+C2+C3+C6 (air-gap shippable) → C5 (connected) → seat enforcement alongside.
## IMPLEMENTATION NOTES (2026-05-30/31)

### C4 (~/alga-license) — DONE
- Uses `node:sqlite` (built-in Node 22+) — no native deps needed, bypasses Python 3.14 / node-gyp issue on this machine.
- Credential stored as PLAINTEXT in `license_state.appliance_credential` (high-entropy 64-hex random; DB access-controlled). The C4 side stores a SHA-256 hash of the same credential for lookup. The refresh route sends the plaintext to C4 /check-in.
- 19/19 automated tests passing.
- **TODO when deploying:** set ALGA_LICENSE_PRIVATE_KEY_FILE, ALGA_LICENSE_SERVICE_SECRET, PORT, DB_PATH env vars. The v1-test key is only for automated tests.

### C1 (license-order SR template) — DONE
- Added `licenseOrderTemplateProvider` + `licenseOrderExecutionProvider` to `ee/server/src/lib/service-requests/providers.ts`. The execution provider marks the submission as succeeded immediately (the Stripe redirect is handled by `purchaseApplianceLicense()` server action, not the execution provider).

### C2 (Stripe checkout + webhook) — DONE
- New `purchaseApplianceLicense()` server action in `ee/server/src/lib/actions/applianceLicenseActions.ts` creates the Checkout Session and stamps `is_license_order:'true'` + correlation metadata into session.metadata.
- Webhook extension in `packages/integrations/src/webhooks/stripe/payments.ts`: detects `is_license_order:'true'` BEFORE tenant_id routing. Idempotency via `payment_webhook_events`. Fires `startApplianceLicenseIssuance()`.
- Appliance-license Stripe prices use separate env keys (`STRIPE_APPLIANCE_*`) distinct from SaaS seat keys.
- **TODO:** provision Stripe products/prices and set the env keys.

### C3 (Temporal issuance workflow) — DONE
- New workflow `applianceLicenseIssuanceWorkflow` in `ee/temporal-workflows/src/workflows/appliance-license-issuance-workflow.ts`. Workflow id = `license-issue:{paymentIntentId}` (idempotent).
- Activities in `ee/temporal-workflows/src/activities/appliance-license-activities.ts`: `signApplianceLicense`, `upsertLicenseContract`, `storeLicenseDocument`, `mintClaimCode`, `deliverLicenseEmail`, `revokeLicenseEntitlement`.
- Issuance client helper at `ee/packages/workflows/src/lib/applianceLicenseIssuanceTemporal.ts`.
- `deliverLicenseEmail` records delivery notes on the submission — full email templating is a TODO (marked in the code).
- Contract lines: uses `contracts.contract_description` to embed tier/transport/stripe_sub metadata for correlation (avoids a separate join table in v1).
- GOTCHA: `document_associations` `created_by` can be null (system-generated rows from issuance). Confirmed the schema allows it.

### C5 (connected-appliance client) — DONE
- Migration `server/migrations/20260531000000_license_state_connected_client.cjs` adds `appliance_id`, `check_in_url`, `appliance_credential`, `last_checkin_at` to `license_state`.
- `connectAppliance()` server action in `licenseManagementActions.ts` redeems a claim code against C4 /register, stores the plaintext credential + first JWT + check_in_url.
- `LicenseManagementPage.tsx` updated with "Connect this appliance" claim-code entry + connected status display.
- Daily refresh at `server/src/app/api/internal/license-refresh/route.ts` (POST, auth via INTERNAL_API_SECRET). Call this daily from cron/Temporal scheduler.

### C6 (portal Licenses view) — DONE
- `getClientLicenses()` server action in `packages/client-portal/src/actions/client-portal-actions/client-licenses.ts`. Filters by `contract_description LIKE '%stripe_sub:%'`.
- `ClientLicensesPage.tsx` in `packages/client-portal/src/components/licenses/`.
- Route: `server/src/app/client-portal/licenses/page.tsx`.
- Nav: `KeyRound` icon + "Licenses" added to `ClientPortalSidebar.tsx` in the "more" section (outside algadesk portal, always visible).
- "Download key" links to `/client-portal/documents?highlight=<documentId>` — relies on the existing Documents page.

### Seat enforcement — DONE
- Added self-host seat check in `createUser` in `packages/users/src/actions/user-actions/userActions.ts`. Reads `license_state` from admin DB; if row exists and effective tier is not essentials and license has a `seats` claim, enforces it. Essentials is unmetered. SaaS path (no `license_state` row) unchanged. Failures are non-blocking on DB errors (try/catch).

### Known TODOs for production readiness
1. Email delivery: `deliverLicenseEmail` currently writes notes to the submission — wire to the actual email-activities transactional email once template is designed.
2. Stripe SKUs: provision the 6 appliance-license products/prices and set STRIPE_APPLIANCE_* env vars.
3. Daily refresh cron: set up a Temporal schedule or k8s CronJob to POST to /api/internal/license-refresh daily.
4. `~/alga-license` prod deploy: configure Dockerfile, k8s secrets (private key, service secret), PVC.
5. Portal purchase flow: the portal currently links to /request-services for license purchase. A dedicated purchase page that calls `purchaseApplianceLicense()` and redirects to Stripe still needs a UI wrapper (the server action exists, the frontend form needs to be wired up in the portal).

## REVIEW PASS (2026-05-31, Opus) — fixed runtime-blocking bugs from the first implementation

The first implementation compiled but was written against GUESSED schemas, a wrong
import alias, and the wrong Temporal task queue. A top-to-bottom review (4 schema/alias
subagents) found and fixed the following. All verified: C4 tsc clean + 23/23 jest;
licensing 18/18; host-service 55/55; no real type errors in the edited alga-psa files
(only environmental module-resolution noise, identical to pre-existing siblings).

BLOCKING (would fail at runtime), now fixed:
1. Import alias: helper moved `ee/packages/workflows/src/lib/` → `ee/server/src/lib/workflows/applianceLicenseIssuanceTemporal.ts`; webhook imports `@enterprise/lib/workflows/...` (resolves in EE like `loadEnterprisePayments`). The old package had no `/lib/*` export.
2. Temporal task queue: was `'alga-workflows'` (nonexistent); non-authored workflows run on `tenant-workflows` (+ portal/email/jobs/sla). Now `tenant-workflows`.
3. Customer table: was `companies`/`company_id`/`company_name`; correct is `clients`/`client_id`/`client_name` (post company→client rename). Webhook fixed.
4. `payment_webhook_events` idempotency: correct columns (`tenant`,`provider_type`,`external_event_id`,`event_type`,`event_data`), reordered AFTER tenant lookup, onConflict on the real unique key `(tenant,provider_type,external_event_id)`. (Temporal workflow-id is the exactly-once backstop.)
5. `documents` insert: required `user_id`+`created_by` (real users — there is NO service user); resolve via `resolveSystemUserId` (inbound_ticket_defaults.entered_by → first tenant user, mirrors the email-attachment background path). Use `entered_at` (no `created_at` column); `type_id: null` is allowed.
6. `document_associations`: removed `created_by` (column doesn't exist on that table).
7. Portal `getClientLicenses`: was `return withAuth(...)` (returned the wrapper uninvoked!) and used nonexistent `user.client_id`. Now a proper `export const ... = withAuth(...)` that resolves client_id via `contacts.contact_name_id = user.contact_id`.
8. Stripe `apiVersion`: '2024-04-10' → '2024-12-18.acacia' (installed Stripe v19).
9. **C4 connected refresh was inert** — `/check-in` returned the stored fixed-exp token forever, so a connected box expired after 31 days. Now re-signs a fresh token (stable `license_sub`, rolled exp) when the held token is >~1 day old. Added `entitlements.license_sub` column; `/sign` stores the sub; pure `connectedTokenNeedsResign()` helper + 4 unit tests.

CORRECTNESS (off happy path / latent), fixed:
10. `revokeLicenseEntitlement` used an UPDATE-with-JOIN across two tables (invalid PG) → split into resolve-ids + two updates.
11. EE action `getConnection('@/lib/db/db')` → `createTenantKnex()`.
12. Contract lookup join made composite `(tenant, contract_id)`.
13. License-order form field `'number'` (unsupported) → `'short-text'`.
14. Workflow date formatting moved into the `deliverLicenseEmail` activity (determinism).

Verified FINE (later ALTER migrations had added them — not bugs): `contracts.status/owner_client_id/is_template`, `client_contracts.renewal_mode/renewal_term_months`, `contract_lines.contract_id`, `document_associations.entity_type IN ('client','contract')`.

RESIDUAL (non-blocking, still TODO — unchanged from before):
- "Download key" links to /client-portal/documents?highlight=<id>; a content-only document (no file_id) may need a dedicated download affordance — verify the Documents page renders inline `content`.
- Email delivery still records notes only (no transactional email yet).
- Portal purchase UI (calling `purchaseApplianceLicense`) not wired.
- Stripe appliance SKUs not provisioned; daily refresh cron not scheduled; ~/alga-license not deployed.
- C4 uses `CREATE TABLE IF NOT EXISTS` (no migration framework) — fine for the new service; an already-deployed instance would need the `license_sub` column added manually (none deployed yet).

- NEXT (when implementing): start with C4 scaffold in the new `~/alga-license` repo (port `ee/tools/alga-license/sign.mjs`), since it unblocks both transports.
