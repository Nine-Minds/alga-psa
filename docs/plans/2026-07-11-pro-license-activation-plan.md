# Pro license activation: reachable UI + working appliance redemption

**Branch:** `feature/setup-ui-pro-license`
**Date:** 2026-07-11
**Status:** Approved design; implementation pending

## Problem

A customer who buys AlgaPSA Pro receives an activation email pointing at
"Settings → License → Activate with claim code". That flow is broken in two
independent ways:

1. **The intended in-app page is unreachable.** `/msp/licenses`
   (`LicenseManagementPage`, which already has a working "Activate with claim
   code" section backed by `connectAppliance`) has no menu entry anywhere —
   not in the main sidebar, not in `settingsNavigationSections`, not in the
   settings tabs. The only links to it are the conditional, dismissible
   `LicenseBanner` and a seat-limit purchase link.
2. **The discoverable fallback is a no-op.** The appliance Manage → License
   tab (`ee/appliance/status-ui/app/manage/ManageView.tsx`) only accepts a
   pasted JWS, so the short claim code fails format validation. Worse, its
   apply path (`applyLicense` in `ee/appliance/host-service/manage-engine.mjs:112`)
   patches the `appliance-license-seed` secret and does a
   `rollout restart deploy/alga-core-sebastian` — but nothing in the running
   app reads that secret. Its only consumer is the first-boot bootstrap job,
   whose `license_state` seeding is guarded by
   `WHERE NOT EXISTS (SELECT 1 FROM license_state)`
   (`helm/templates/appliance-bootstrap-configmap.yaml:368`). The runtime
   source of truth is the `license_state` DB row; the restart is vestigial.
   The Manage tab's status display also reads the secret, so it can show a
   license the app is not actually enforcing.

No changes are needed in the alga-license service (C4): `/register` already
handles re-registration of an existing `appliance_id`
(`onConflict('appliance_id').merge` — updates entitlement, issues fresh
credential/JWT, returns the full paid response), and the daily check-in
re-signs from the current entitlement.

## Design summary

Three parts, one architectural rule: **runtime license mutations happen in the
appliance's EE temporal worker**, which already owns the only legitimate
runtime `license_state` write (the daily check-in activity,
`ee/temporal-workflows/src/activities/appliance-check-in-activities.ts`), has
admin DB access (`getAdminConnection()`), and has proven egress to the license
service.

1. **In-app menu entry** — a self-host-gated "License" item in the settings
   navigation pointing at `/msp/licenses`, making the email's instructions true.
2. **Appliance Manage-tab claim-code redemption** — claim code primary, JWS
   paste demoted to air-gapped fallback. Host-service triggers a new
   `applianceLicenseRedeemWorkflow` by `kubectl exec`-ing a small starter
   script in the app container (the bootstrap-proven pattern of
   `server/scripts/appliance-create-tenant.mjs`), then patches the seed secret
   from the result. DB first, secret second; no restart.
3. **Fix the lying surfaces** — the JWS apply path also routes through a
   worker activity (gaining cryptographic verification via
   `@alga-psa/licensing`), and `readLicenseStatus` reads the live
   `license_state` row via a read-only exec script, falling back to the
   secret-derived view (labeled) only when the app is unreachable.

Trigger-mechanism rationale: host-service has no Temporal client and stays a
kubectl orchestrator. Every operation it performs is already a queued kubectl
invocation (`server.mjs:555`), and exec'ing into containers is established
capability (`pod-exec-manager.mjs`). The starter script uses
`@temporalio/client` from the app image (`TEMPORAL_ADDRESS` is already in the
app deployment env, `helm/templates/deployment.yaml:269`).

---

## Phase A — In-app settings menu entry

**A1. Menu config** — `server/src/config/menuConfig.ts`
- Extend `MenuItem` with `requiresSelfHost?: boolean`.
- Add to `settingsNavigationSections` → "Organization & Access":
  `{ name: 'License', translationKey: 'settings.tabs.license', icon: BadgeCheck, href: '/msp/licenses', requiresSelfHost: true }`.

**A2. Gating** — `server/src/components/layout/SidebarWithFeatureFlags.tsx`
- The `settingsSections` memo (line ~124) currently applies only
  `filterMenuSectionsByProduct`. Add a self-host filter: obtain
  `selfHostMode` the same way `LicenseBanner` does (client call to the
  `getLicenseStatus` action, `server/src/components/licenses/LicenseBanner.tsx:36`),
  via a small hook. Items with `requiresSelfHost` are hidden until the flag
  resolves true (no flash for cloud tenants).

**A3. i18n** — add `settings.tabs.license` to the locale files that define the
other `settings.tabs.*` keys.

**A4. Tests** — extend the existing menu/sidebar unit tests: item present in
self-host mode, absent otherwise; product filtering unaffected.

## Phase B — Temporal workflows + activities (`ee/temporal-workflows`)

**B1. Dependency** — add `"@alga-psa/licensing": "file:../../packages/licensing"`
alongside the existing `@alga-psa/db` dependency.

**B2. Redeem activity** — new
`src/activities/appliance-license-redeem-activities.ts`, modeled on
`appliance-check-in-activities.ts`:
- Read the `license_state` singleton via `getAdminConnection()`; fail
  non-retryably if absent ("not a self-hosted install").
- Resolve current tenant: `aud` claim of the current `license_token` if
  present, else the sole row of `tenants`.
- Resolve `applianceId`: prefer `license_state.appliance_id`, else derive the
  `appliance-<rowid>-<hash>` form `connectAppliance` uses
  (`server/src/lib/actions/licenseManagementActions.ts:236`).
- Resolve service URL: `ALGA_LICENSE_SERVICE_URL` env → origin of
  `license_state.check_in_url` → `https://license.nineminds.com`.
- `POST /register` with `{ claim_code, appliance_id, tenant_id }` (code
  normalized: trim, uppercase, strip spaces/dashes).
- Error mapping: `invalid_claim_code` / `expired_claim_code` /
  `consumed_claim_code` / superseded → **non-retryable** `ApplicationFailure`
  with a stable `code`; network errors / 5xx → retryable.
- **Tenant guard:** if the response `tenant_id` and the resolved current
  tenant are both present and differ → non-retryable `tenant_mismatch`
  failure, **nothing written**. (The code is consumed server-side by then;
  the user-facing message points at portal reissue.)
- Verify the returned `first_jwt` with `verifyLicense` (defense in depth).
- Upsert `license_state`: `license_token`, `appliance_id`, `check_in_url`,
  `appliance_credential`, `last_checkin_at = now()`, `updated_at`
  (column parity with `connectAppliance`, `licenseManagementActions.ts:266-272`).
- Return `{ edition, tenantId, licenseToken, applianceCredential, checkInUrl }`
  for the host-service seed-secret patch.

**B3. Apply activity** — `applianceLicenseApplyActivity({ licenseKey })` in the
same file: `verifyLicense` (signature, expiry, `aud` vs current tenant — the
same three checks as `submitLicense`, `licenseManagementActions.ts:108-126`),
then write `license_token` + `updated_at`. Return `{ edition, expiresAt }`.

**B4. Workflows** — new `src/workflows/appliance-license-redeem-workflow.ts`
(and a sibling apply workflow, or one file exporting both): thin
`proxyActivities` wrappers mirroring `appliance-check-in-workflow.ts`'s shape
and retry policy. Export from `workflows/non-authored-index.ts` and
`activities/non-authored-index.ts`.

**B5. Tests** — activity unit tests under `src/activities/__tests__/` (mock
fetch + knex): happy path column writes, each error-code mapping, tenant
mismatch writes nothing, appliance-id preference order, service-URL fallback
chain. Update `worker-registration.test.ts` expectations for the new exports.

## Phase C — Starter scripts (`server/scripts/`, ship in app image)

All modeled on `appliance-create-tenant.mjs` (Temporal connection with retry,
env defaults) and `appliance-reset-admin-password.mjs` (injectable deps for
tests; no secrets on argv).

**C1. `appliance-redeem-claim-code.mjs`** — read `{ claimCode }` as JSON on
stdin; start `applianceLicenseRedeemWorkflow` on `tenant-workflows` with a
unique workflow id (`appliance-license-redeem-<entropy>`); await the result;
print exactly one JSON line: `{ ok: true, result }` or
`{ ok: false, code, error }`; nonzero exit on failure.

**C2. `appliance-apply-license-key.mjs`** — same shape for
`{ licenseKey }` → apply workflow.

**C3. `appliance-license-status.mjs`** — **no Temporal**: build an admin DB
connection the way the reset script does, read the `license_state` row, print
`{ ok: true, row: { edition_choice, license_token, appliance_id, check_in_url,
last_checkin_at, trial_started_at, updated_at } }`. Host-service derives the
display status with its existing `decodeLicenseClaims` /
`licenseStatusFromClaims` (`manage-engine.mjs:52,64`).

**C4. Tests** — unit tests for the exported core functions (injected client/db),
following the reset script's test pattern.

## Phase D — Host-service (`ee/appliance/host-service`)

**D1. Exec-with-stdin support** — the kubectl queue
(`kubectl-queue.mjs` / the `kube` adapter in `server.mjs:579`) runs shell
strings with no stdin. Add an option to pass stdin content to the spawned
process, so claim codes/license keys never appear on argv. Invocation shape:
`kubectl exec -i deploy/alga-core-sebastian -c sebastian -- node /app/server/scripts/<script>.mjs`.

**D2. `redeemClaimCode()`** — new function in `manage-engine.mjs`:
- Normalize + basic-validate the code; exec C1 with stdin JSON; parse the
  single-line JSON result.
- Map failure codes to operator-friendly messages (invalid / expired /
  already used / superseded; `tenant_mismatch` → "this code belongs to a
  different account — reissue a code from your licensing portal"; exec/pod
  unavailable → "the app is still starting — try again shortly", retryable).
- On success, patch `appliance-license-seed` with the full connected set by
  reusing `licenseSeedFromRedeem()` (`install-code.mjs:96`) — keeps
  DR/re-bootstrap seeding correct. Secret-patch failure after a successful
  workflow returns a distinct "license active; recovery seed not yet updated —
  retry" error (retry is idempotent).
- **No rollout restart.**

**D3. `applyLicense()` rework** — keep the fast well-formedness check
(`JWS_RE`) for immediate feedback, then exec C2 (which cryptographically
verifies before writing `license_state`), then patch `LICENSE_TOKEN` in the
seed secret. Remove the `rollout restart` and its error branch.

**D4. `readLicenseStatus()` rework** — try C3 first and derive
edition/status/expiry from the live row (plus `last_checkin_at`); on exec
failure fall back to the current secret-derived path, marking the result
`source: 'seed-fallback'`. Thread `source` through the manage-status assembly
(`manage-engine.mjs:379-414`).

**D5. Route** — `POST /api/license/redeem` in `server.mjs` next to the
existing `/api/license/apply` (line 1227), same auth middleware, body
`{ claimCode }`.

**D6. Tests** — extend `tests/manage-engine.test.mjs`: redeem happy path
(fake kube exec returning result JSON → correct secret literals patched, no
restart command issued), each error mapping, tenant-mismatch patches nothing,
apply path execs + patches without restart, status prefers exec result and
falls back with `source: 'seed-fallback'`. Add stdin coverage to the kubectl
queue tests.

## Phase E — Appliance status-ui (`ee/appliance/status-ui/app/manage/ManageView.tsx`)

**E1. `LicenseTab` restructure** (component at line 417):
- **Primary: "Activate with claim code"** — single input (normalized on
  submit), "Activate" button → `POST /api/license/redeem`, inline error
  banner with the server's friendly message, success state showing the new
  edition and refreshed status. Helper copy: "Enter the activation code from
  your Nine Minds email."
- **Secondary: "Air-gapped: paste a signed license key"** — existing textarea
  + apply flow, retitled, with the "The app will restart to apply it" copy
  replaced (changes apply immediately; no restart).
- Status block: when `source === 'seed-fallback'`, label the values ("as of
  last activation — live status unavailable").

**E2. Tests** — a UI-contract test following
`tests/admin-password-reset-ui-contract.test.mjs` (route + payload shape the
UI depends on).

## Phase F — Drive-by correctness fix

**F1. `connectAppliance` appliance-id reuse** —
`server/src/lib/actions/licenseManagementActions.ts:236` always derives a
fresh appliance id, so re-registering an already-installed appliance creates a
duplicate appliance row in C4 and orphans the old credential. Prefer
`row.appliance_id` when present, falling back to the derived form. Unit test
both branches.

## Verification (manual smoke on the appliance VM)

1. In-app: settings menu shows "License" (self-host); page loads at
   `/msp/licenses`.
2. Issue a Pro claim code from the portal; redeem it on the appliance
   Manage → License tab: edition flips to Pro **without any pod restart**;
   in-app license page agrees; Manage-tab status shows live values (not
   `unknown`).
3. Force a check-in ("Refresh license now" / temporal schedule trigger):
   succeeds with the new credential.
4. Redeem error paths: garbage code, reused code, and a code for a different
   tenant (expect the portal-reissue message, no state change).
5. Air-gapped path: paste a signed JWS → applied without restart; paste a
   tampered JWS → rejected with a verification error (new behavior).
6. Kill the app deployment and open the License tab: status falls back with
   the "as of last activation" label; redeem attempt returns the retryable
   "app is starting" error.

## Out of scope / follow-ups

- **nm-store email copy** — "Settings → License → Activate with claim code"
  becomes true for the in-app path after Phase A; consider also mentioning the
  appliance Manage tab. Separate repo/PR.
- **C4 pre-consumption tenant validation** — validate the code's tenant
  binding before consuming it, so a mismatched code isn't burned. Separate
  alga-license change.
- **Layering notes** — `license_state` connected-registration logic now exists
  in `connectAppliance` (app action) and the redeem activity (worker); drop a
  `// LEVERAGE: pattern license-state-writers` marker at both sites. The
  settings-nav gating extension touches the existing
  `LEVERAGE: settings-tabs-twice` friction; extend, don't restructure, here.
