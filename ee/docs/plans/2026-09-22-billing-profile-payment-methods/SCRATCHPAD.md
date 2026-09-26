# Scratchpad — Payment Method per Client Billing Profile

## Discoveries (2026-09-22)

- **Billing profiles.** They shipped in PR #3180. The plan is
  `ee/docs/plans/2026-08-15-billing-profiles-sub-account-billing/`, and the
  payment-method features there are F102–F106. The design doc is
  `docs/plans/2026-08-15-billing-profiles-sub-account-billing-plan.md` §5.3.
- **Profile settings pattern.** Each setting is a nullable column on
  `client_billing_profiles`, added in migration
  `20260818040000_add_billing_profile_bill_to_and_tax.cjs`. Values are resolved
  per field, profile first and then client, by `resolveEffectiveBillingIdentity`
  in `shared/billingClients/billingProfileSettings.ts`. They are edited through
  `SETTINGS_FIELDS` in `packages/clients/src/actions/clientBillingProfileActions.ts`
  and shown in the UI by `ClientBillingProfileSettings.tsx`.
- **Client-level method.**
  - `clients.preferred_payment_method` is free text. Its options (credit_card,
    bank_transfer, check) are defined inline in `BillingConfigForm.tsx:116`.
  - `clientActions.ts:1881` saves `''` when it is unset.
  - Nothing reads it to affect billing.
- **Saved cards (`payment_methods`).**
  - They already have a NOT NULL `billing_profile_id`, and one default per
    profile (`20260818060000_add_billing_profile_to_payments_and_ar.cjs`).
  - Card management is only in the client portal
    (`packages/client-portal/src/actions/account.ts:358-501`,
    `BillingSection.tsx`). The card-entry form there is a mock
    (`processPaymentDetails` returns `'mock_payment_token'`).
  - `getPaymentMethodForInvoice` is only called from tests.
- **Stripe.** Invoices are paid only through a Checkout payment link. There is
  no auto-charge. `client_payment_customers` is per client, not per profile.
- **Known gap (out of scope, Q3).** `invoiceGeneration.ts:3518` works out the
  due date from the client's `payment_terms` through `getDueDate(clientId)`,
  even though the billing identity for the profile has already been resolved.
  The profile's `payment_terms` is also free text in the UI.
- **Invoice view model.** `po_number` reaches the renderer through
  `invoiceAdapters.ts:646` and `fieldCatalog.ts:50` (`invoice.poNumber`). Use
  the same path for `paymentMethod`.

## Decisions

- **D1.** The per-profile method follows the same pattern as the other profile
  settings: a nullable column, NULL meaning inherit, and per-field resolution.
  Consistency matters more than a new mechanism.
- **D2.** The method list stays at the existing three keys and moves into one
  shared constant, so the client and profile dropdowns can't drift apart. Add
  CHECK at the DB level for the profile column only; the legacy client column
  stays unconstrained.
- **D3.** The invoice records the method at generation time
  (`invoices.payment_method`) instead of resolving it when rendering. An issued
  invoice must not change when a profile is edited, just as PO number works.
- **D4.** The saved card is shown read-only on the MSP side. Collecting a card
  and charging it automatically wait on real Stripe card capture (non-goal).

## Commands

- Do not run `knex migrate:latest` against the shared `alga-psa-local-test`
  stack: it contains EE and other-branch migration records. The payment-method
  migration is already applied; verify its schema and migration row before
  considering any further migration action.
- Dev server: port 3421.

## Environment recovery (2026-09-26, takeover inspection)

Live acceptance remains blocked. No new payment-method defect was established.

- Storage has 7.5 GiB available on the shared 150 GiB filesystem. The builder
  moved this worktree's generated `server/.next` to
  `/tmp/alga-billing-profile-next-cache-20260926`; that directory exists on the
  separate root filesystem. Leave the old cache there while diagnosing the
  recovered server. Monitor free space during compilation.
- Port 3421 has no listener. Board project
  `279f76b9-5712-403a-b286-8ace5b62713f` remains at Draft Implementation with
  run `45ffabe3-d7ef-4d84-a9aa-34cffa4a0fd5` recorded as queued. Its annotations
  show that ensuring `dev-server` resumed it and the board suspended it three
  seconds later. The shared template declares `dev-server` for Implement and
  Smoke Test, but not Draft Implementation.
- An operator must enable the service through the supported board lifecycle
  while this verification runs, or reconcile the active run and hand off to
  a service-using step. Do not mark smoke verification passed to advance the
  card, change the shared template for all projects, or launch an unmanaged
  server to evade suspension. Once the lifecycle permits it, use:

  ```bash
  alga-dev workflow-restart-service --projectId=279f76b9-5712-403a-b286-8ace5b62713f --name=dev-server
  ```

- The target worktree lacks `secrets/alga_auth_key`,
  `secrets/ninjaone_client_id`, and `secrets/ninjaone_client_secret`, all mounted
  by the EE Compose `temporal-worker`. Docker labels identify
  `feature-alga-2026-0002516-ticket-timeline-shows-0m-for-a` as the local-test
  stack's source worktree; those files are absent there too. Restore the
  existing values from the authorized development source. Do not generate a
  replacement authentication key.
- Port 7233 belongs to `temporal-workflows-temporal-1`, whose Compose working
  directory is `fix-marketing-workflow-fanout-routing/ee/temporal-workflows`.
  Port 7429 belongs to `alga-2578-temporal`. Neither establishes this card's
  worker readiness. No invoice-email worker container is running.
- `packages/jobs/src/lib/jobs/runners/TemporalJobRunner.ts` defaults to
  `localhost:7233`, namespace `default`, and queue `alga-jobs`. Configure the
  server and worker explicitly for the same intended Temporal service and
  namespace. The worker configuration in
  `ee/temporal-workflows/src/workerConfig.ts` always includes `alga-jobs` and
  `sla-workflows`; avoid accidentally polling another project's queues.
  Host and container addresses may differ while identifying the same service.
  Confirm worker pollers and job completion, not just an open TCP port.

### Checks to finish after recovery

1. Verify sign-in on localhost and 127.0.0.1 after compilation. For a remaining
   431, capture request-header sizes without recording cookie values. Compare
   with a clean browser context before attributing the failure to cookies.
   For the translation spinner, inspect failed translation/script requests,
   console errors, and HMR alongside current server logs. Historical evidence
   does not establish either cause.
2. Save and reload profile overrides and inheritance for payment method and
   terms. Generate invoices for sibling profiles, verify method snapshots and
   due dates, then verify that later profile edits leave snapshots unchanged.
3. Check portal row menus, invoice details, and direct pay routes for Check
   and Bank Transfer; verify retained Credit Card and null-snapshot behavior.
4. Submit invoice emails through the EE job path to the development SMTP sink
   (previously SMTP 3035, control 9187). Confirm captured recipients and content:
   offline invoices keep their portal link and omit Stripe Pay Now. Verify
   card behavior with the intended test payment-provider configuration.

## Deploy-fix verification handoff (2026-09-26)

The implementation stayed unchanged. `git status --short` was clean at the
start of this pass, and the initial handoff was `df161e6faf`. Storage currently
has 7.6 GiB available (95% used); Btrfs reports 7.59 GiB free estimated and
only 1 MiB unallocated device space. `server/.next` is only 12 KiB. The
previously moved 6.0 GiB cache remains at
`/tmp/alga-billing-profile-next-cache-20260926`; it was not removed. The
board-managed service log has no matching ENOSPC, 431, translation, or ready
entries, but it contains no new app run to validate. No service listener is on
3421, and HTTP to localhost:3421 fails to connect.

The board reports `dev-server` suspended with reason `"Draft Implementation"
does not use it`. The single requested `workflow-restart-service` attempt was
rejected: `No live service "dev-server" for project`. The service remains
suspended. An operator must transition this card to a service-using lifecycle
step (or apply the supported lifecycle override) before browser acceptance.
Browser 431 and translation-spinner behavior could not be reproduced, and no
sign-in or authenticated billing screen is claimed as verified.

Fresh automated evidence:

- `cd server && npx vitest run src/test/integration/billing/billingProfilePaymentMethod.integration.test.ts --coverage.enabled=false` — 7/7 passed. The fixture explicitly targets the dedicated `test_db_billing_profile_payment_method`, not `server`.
- `cd server && npx vitest run ../packages/billing/src/actions/invoiceEmailLinkContext.offlinePayment.test.ts ../packages/billing/src/lib/adapters/invoiceAdapters.test.ts ../packages/client-portal/src/actions/clientPaymentActions.offlinePayment.test.ts ../packages/client-portal/src/components/billing/InvoicesTab.paymentMethods.test.tsx --coverage.enabled=false` — 32/32 passed.
- `cd server && NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck` — passed.
- `cd packages/billing && npm run typecheck && npm run build` — passed (typecheck and tsup build).
- `cd packages/client-portal && npm run typecheck` — passed. `npm run build` still fails with `No input files, try "tsup <your-file>" instead`, the known package build configuration issue; no new client-portal build claim is made.

The current `3035`/`9187` SMTP sink belongs to the unrelated
`feature-alga-2026-0002521-quote-list-send-dialog-lacks-t` worktree (state file
under its private review directory); it was not used or inspected for this
feature's delivery. The target `.env.localtest` has no SMTP or Temporal
settings, so no target SMTP route to that sink is configured. Port 7233
belongs to `fix-marketing-workflow-fanout-routing/ee/temporal-workflows`, and
the local test stack's Compose labels point to a different worktree. No
invoice-email worker container is running for this target. The target EE
checkout still lacks root `secrets/alga_auth_key`,
`secrets/ninjaone_client_id`, and `secrets/ninjaone_client_secret`; restore those existing
values from the authorized development secret source before worker execution.
The target worker is defined in root `docker-compose.ee.yaml`, with secret
file declarations in `docker-compose.base.yaml`. Its defaults are namespace
`default`, address `temporal-dev:7233`, and job queue `alga-jobs` (from
`TEMPORAL_JOB_TASK_QUEUE`). It explicitly polls `tenant-workflows`,
`portal-domain-workflows`, `email-domain-workflows`, and `alga-jobs`.
The standalone `ee/temporal-workflows/docker-compose.yaml` uses different
defaults and is not the target local-test stack configuration. The server job runner
defaults to `localhost:7233`, namespace `default`, queue `alga-jobs`. The
intended shared Temporal address and matching SMTP sink route must be provided
before a worker/job delivery check.
No Temporal queue polling, job execution, SMTP delivery, or email Pay Now
behavior was verified.

Takeover recheck at 2026-09-26 03:42Z: disk still has 7.5 GiB available,
and the board service remains suspended. The requested restart returned
`No live service "dev-server" for project`; port 3421 has no listener.
The three root secret files above are absent. The four focused suites listed
above were rerun independently and all 32 tests passed. No product code
changed, so the builder's successful typechecks and billing build remain the
latest build evidence; they were not rerun during this documentation correction.
An operator lifecycle adjustment and an authorized source for the existing
secrets have been requested. No unmanaged server or unrelated Temporal stack
was started or modified. Live acceptance is still incomplete.

The live acceptance items still outstanding are the profile edit/save and
inheritance screens, invoice finalization/snapshot persistence after profile
changes, authenticated portal behavior, and delivered EE invoice emails. The
fresh integration and unit evidence covers backend profile persistence,
terms, snapshots, invoice adapters, offline invoice email link selection, and
portal payment action/list controls, but does not replace those live flows.

The builder reported passing integration checks (7 profile tests and T004),
email-link tests (5), portal controls (4), adapters (19), and billing,
client-portal, and server typechecks in round 2. These were not rerun during
takeover because product code is unchanged. They do not establish live
browser behavior or SMTP delivery. No fresh browser acceptance is claimed.

## Deploy-fix mitigation round (2026-09-26)

The plan in this folder is the primary feature specification, but its PRD is
marked `Draft — implemented (first draft)` and no approval record is present in
this directory. Its human Q1–Q3 decisions and acceptance criteria were followed;
this round did not reopen the feature design.

### Portal invitation setup and acceptance still pending

`portalInvitationActions.ts` resolves the tenant's MSP/default client by joining
`tenant_companies.is_default = true` to `clients`. The supported configuration
path is **General Settings → Default Client**, which calls
`packages/tenancy/src/actions/coreTenantActions.ts:setDefaultClient`.
The retained contact `3d727620-6baa-4219-babc-25c2259e7574` belongs to client
`a3ad6e99-5ed9-4a1c-9cf3-b0b49c1c3d84`; this association does not prove that
client is the tenant's intended MSP/default client. No shared tenant default was
changed. With the app server required for the supported UI/action and prohibited
from starting in this step, no live invitation or activated portal identity was
created. Do not fabricate one in the database.

Server-enabled smoke procedure:

1. In General Settings, identify the tenant's actual MSP company record and
   select it as Default Client. Confirm it has an active default location with
   an email, or configure Client Portal support email in tenant settings.
2. Open the retained contact under client
   `a3ad6e99-5ed9-4a1c-9cf3-b0b49c1c3d84`, initiate the supported portal
   invitation, and verify success (no `NO_DEFAULT_CLIENT`, location, or support
   email error). Deliver the invitation through the configured mail path; open
   its link, set the password, sign in, and confirm the resulting portal session
   represents this contact. Record the actual activated contact, not a seeded
   user row.
3. Use unpaid, finalized invoices whose immutable snapshots are respectively
   `check`, `bank_transfer`, `credit_card`, and `NULL`. In the portal invoice
   list row menus and invoice details, verify Check and Bank Transfer have no
   Pay Now control; Card and NULL retain existing controls.
4. For each offline invoice, navigate directly to
   `/client-portal/billing/invoices/<invoiceId>/pay`. Verify the supported page
   calls `getClientPortalInvoicePaymentLink` and displays the unavailable
   payment state with action error code `offline_payment_method`; a 404 alone
   is not evidence. Confirm no checkout/payment link was created. For Card and
   NULL snapshots, verify the existing payment action reaches the configured
   checkout behavior.

### Recurring profile live acceptance still pending

Existing automated T004 in
`server/src/test/integration/billing/billingProfileAttribution.integration.test.ts`
uses the isolated database `test_db_billing_profile_recurring_acceptance` and
already covers the required profile/charge attribution, inherited Credit Card
and overridden Check snapshots, Net 30 and Due on Receipt effective terms and
due dates, charge isolation between sibling profiles, and unchanged issued
payment method/date snapshots after editing both profiles. No meaningful T004
coverage gap was found, so no recurring tests were added.

For live browser acceptance after the server is enabled, use a dedicated test
tenant and create one client with two billing profiles. Set the client method
to Credit Card and terms to Net 30; leave profile A inheriting, and set profile
B to Check and Due on Receipt. Assign separate recurring contract lines to
each profile, generate each profile's recurring invoice, and verify in the UI
that charges and invoice snapshots stay with their assigned profile, A is Card
and due 30 days after its invoice date, and B is Check and due on its invoice
date. Edit the client/profile methods and terms after issue, reload both
invoices, and verify their snapshots and due dates did not change. Confirm each
profile's generated charges remain isolated from its sibling. This browser run
is separate from the automated T004 database result.

### Validation receipts for this mitigation round

- Passed: server Vitest focused component regression
  `../packages/billing/tests/FinalizedTab.deepLinkEmail.test.tsx` (2/2,
  off-page and ordinary on-page selection).
- Passed: isolated integration suites
  `billingProfilePaymentMethod.integration.test.ts` and
  `billingProfileAttribution.integration.test.ts` (12/12 total); the latter
  recreated only `test_db_billing_profile_recurring_acceptance`.
- Passed: offline-payment invoice email link, portal action, invoice-list UI,
  and adapter suites (32/32); supported portal pay-page route suite (4/4).
- Passed: billing and client-portal typechecks; billing tsup build; server
  typecheck with `NODE_OPTIONS=--max-old-space-size=12288`.
- Known package build failure reproduced: `packages/client-portal npm run build`
  exits 1 with tsup `No input files, try "tsup <your-file>" instead`. This
  package baseline/configuration failure is independent of the billing
  regression.
- A billing typecheck without a heap cap once exited 134 near Node's default
  4 GiB heap limit. The captured rerun with a 12 GiB cap passed along with its
  build; no TypeScript diagnostic was emitted by the resource-limited attempt.

All integration and component results above are automated checks. No server
was started; invitation/activation, the live payment controls/direct route,
recurring browser acceptance, and the specified deep-link reproduction remain
pending the server-enabled smoke step.

### Off-page email regression

`FinalizedTab` now uses the selected `invoiceId` URL parameter for the Send
Email action, so server-side page membership is not required. The focused
component regression supplies a current page that excludes the deep-linked
invoice and asserts the dialog opens with that URL-selected ID; a paired case
keeps ordinary on-page selection covered. The previously
reported live reproduction is
`/msp/invoices/9a8ca509-d042-42e0-8182-4391c0484e53`; authenticated browser
reproduction remains deferred to the server-enabled smoke step.

## Implementation notes (2026-09-23)

- Shared vocabulary: `shared/billingClients/paymentPreferences.ts` (methods,
  terms, normalizers, `isOfflinePaymentMethod`, `paymentTermDays`). UI labels:
  `packages/clients/src/components/clients/paymentPreferenceOptions.ts`.
- Due dates: `packages/billing/src/lib/billing/invoiceDueDate.ts`.
  `getDueDate` now resolves the (default) profile identity, so a client with
  no overrides is unchanged.
- Manual invoices snapshot the default profile's method (beyond F014's
  literal scope) so client-wide invoices follow Q1 the same way.
- Not covered: `server/src/lib/api/services/InvoiceService.ts` (REST API
  invoice creation) still computes due dates from `clients.payment_terms` and
  does not snapshot `payment_method`; hour-block and sales-order invoices get
  default-profile terms via `getDueDate` but no method snapshot.
- Rendered `invoice.paymentMethod` uses authored English labels; it is not
  translated to the document locale yet.
- `knex migrate:latest` refuses on the shared local-test DB (EE and
  other-branch migrations recorded); the migration was applied with a script
  calling its `up()`.
