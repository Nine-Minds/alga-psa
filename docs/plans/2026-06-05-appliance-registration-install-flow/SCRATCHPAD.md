# Scratchpad — Appliance registration → download → install flow

- Plan slug: `appliance-registration-install-flow`
- Created: `2026-06-05`
- Source spec: `docs/superpowers/specs/2026-06-05-appliance-registration-install-flow-design.md`

## What This Is

Working memory for the register → download → install (+ re-issue) flow. The spine
is a **direction inversion**: today the appliance generates its own tenant UUID and
sends it up at `/register`; the new flow mints `tenant_id` upstream at registration,
carries it down via a one-time install code, and the appliance **adopts** it via a
new `INITIAL_TENANT_ID`.

## Decisions

- (2026-06-05) **Reuse `/register`** for the friendly install code (decision 1) —
  one redeem path, reuse the claim-code machinery.
- (2026-06-05) **Extend `claim_codes`** (decision 2): `entitlement_id` → nullable,
  add `tenant_id` FK → `tenant_registry`. One code type for essentials (no
  entitlement) and paid. Chosen over a separate `install_tokens` table.
- (2026-06-05) **Presigned for all** downloads (decision 3) — registration-gated,
  not public; ISO isn't a secret, the code is the gate.
- (2026-06-05) **Re-issue in scope now** (decision 4) — portal action resolves an
  existing registry tenant and mints a fresh code for the same `tenant_id`.
- (2026-06-05) Test weighting is **smoke-first** (user directive): small automated
  set for the riskiest seams, everything else validated live on the VM. This
  deliberately inverts the software-planner default (tests longer than features) —
  `tests.json` is shorter and smoke-weighted on purpose.
- (2026-06-05) **The short code is the identity carrier for BOTH tiers** (not just
  paid). Essentials installs get a short code too and never type a raw tenant_id;
  the code's `tenant_id` is set for everyone, `entitlement_id` is null for
  essentials. One-liner framing: "a short code always resolves a tenant; for paid
  it additionally mints a bound license."
- (2026-06-05) **§16 open questions all resolved:** (1) alga-license presigns with
  object-store creds via **env vars**; the presigned URL is **emailed** to the user
  after registration/purchase (alongside the code) — not a public link. (2) Paid
  ordering: registry row at form submit, entitlement + code on
  `checkout.session.completed`. (3) Essentials edition from
  `tenant_registry.edition` (no edition on the code). (4) Reuse
  `generateClaimCode()` for install codes. Remaining impl detail (not a fork):
  which object-store key holds the current generic ISO + how the release process
  publishes it (F041).

## Discoveries / Constraints

- (2026-06-05) **`claim_codes` baseline is `entitlement_id NOT NULL`**
  (`alga-license/migrations/03_claim_codes.cjs`). Needs a new migration to relax it
  and add `tenant_id`.
- (2026-06-05) **alga-license accessors that already exist** (`src/db/db.ts`):
  `createRegistryTenant`, `getRegistryTenant`, `getRegistryTenantByEmail`,
  `insertClaimCode`, `getClaimCode`, `consumeClaimCode`,
  `revokeClaimCodesForEntitlement`, `upsertAppliance` (already takes `tenantId`),
  `setEntitlementLicenseSub`, `getEntitlementById`. Signing helpers exist:
  `signLicense` (takes `aud`), `generateClaimCode`, `generateApplianceCredential`,
  `generateLicenseId`.
- (2026-06-05) **New alga-license work:** the migration, `insertClaimCode` +
  `getClaimCode`/`ClaimCodeRow` for `tenant_id`/nullable entitlement, a new
  `revokeClaimCodesForTenant` (essentials reissue has no entitlement to key on),
  a `setRegistryTenantInstalled`, the `/register` essentials+response changes, the
  `/register-tenant` and `/install-codes/reissue` routes, and a MinIO presign
  helper.
- (2026-06-05) **`/register` today** (`src/routes/register.ts`): requires an
  entitlement (`getEntitlementById` → 500 if none), binds `aud` from the
  **request body** `tenant_id`, returns `{ appliance_credential, first_jwt,
  check_in_url }`. The new flow sources `tenant_id` from the **code row** and
  returns it (+ edition) to the appliance.
- (2026-06-05) **`/check-in`** (`src/routes/checkIn.ts`) already preserves
  `appliance.tenant_id` as `aud` across re-signs — no change needed.
- (2026-06-05) **The appliance tenant UUID is born in**
  `ee/server/src/lib/testing/tenant-creation.ts` `createTenant` (~line 80): it
  inserts into `tenants` without a `tenant` value, so the DB default
  (`gen_random_uuid()`) generates it and it's returned via `.returning('tenant')`.
  That insert is the exact `INITIAL_TENANT_ID` seam.
- (2026-06-05) **`connectAppliance`** (`server/src/lib/actions/licenseManagementActions.ts`,
  ~line 125) already POSTs `{ claim_code, appliance_id }` to `/register` and seeds
  `license_state` with `first_jwt`/`appliance_credential`/`check_in_url` — but
  AFTER the tenant exists. The install-time consumer generalizes this to run before
  create-tenant and adopt the returned `tenant_id`.
- (2026-06-05) **Licval WIP already in the working tree** (uncommitted, NOT part of
  this plan's deltas — treat as precondition F001): `create-tenant.ts` +
  `tenant-creation.ts` thread `INITIAL_ADMIN_PASSWORD`/`args.password` through to
  `createAdminUser` (uses `input.password ?? generateSecurePassword()`),
  initialize `tenant_settings` (onboarding pending), and honor
  `DB_HOST`/`DB_PORT`/`DB_USER_ADMIN`. `INITIAL_TENANT_ID` lands in the same two
  files. Do not revert this WIP.

## Build-step 1 — alga-license schema + /register (DONE on branch `feat/registration-install-flow`)

- (2026-06-05) **Two refinements discovered while implementing** (both fed back into
  the PRD/features):
  - `claim_codes.tenant_id` is **NULLABLE**, not NOT NULL. Migration alters
    `entitlement_id` NULLABLE via `knex.raw('ALTER TABLE … DROP NOT NULL')` (knex
    `.alter()` would try to rebuild the FK) and adds `tenant_id uuid` nullable FK +
    index (`migrations/05_claim_codes_registry.cjs`). `/register` resolves
    `tenant = row.tenant_id ?? body.tenant_id` — the body path is the clean legacy
    fallback, which only works because tenant_id is nullable.
  - **Essentials `/register` creates NO appliance row.** `appliances.entitlement_id`
    is `NOT NULL` (FK), and essentials has nothing to refresh (no license → no
    check-in), so the essentials branch returns `{ tenant_id, edition }` and does
    not call `upsertAppliance` or issue a credential. (Original F012 said "still
    upsertAppliance" — corrected.)
- (2026-06-05) `createRegistryTenant` already accepted a pinned `tenantId` and
  returns the row — `/register-tenant` (build step 3) is mostly wiring.
- (2026-06-05) `RegisterResponse` now returns `tenant_id` + `edition` +
  `company_name`/`contact_email`; `appliance_credential`/`first_jwt`/`check_in_url`
  are **optional** (paid only). The existing alga-psa `connectAppliance` destructures
  the three paid fields and ignores the rest, so paid back-compat holds.
- (2026-06-05) **Validated:** `tsc --noEmit` clean; migration applies + rolls back +
  re-applies on a throwaway `postgres:16` (5433); jest **28/28** incl. 3 new seam
  tests (claim_codes tenant_id round-trip, `revokeClaimCodesForTenant`,
  `setRegistryTenantInstalled`). The repo's `signing.test.ts` IS the gated-on-DB_HOST
  pg integration suite — extend that block, don't add a parallel harness.
- (2026-06-05) Test weighting note: `/register` HTTP behavior (T003/T004) is
  **smoke**, not Fastify route tests — validated in the build-step-4 live loop, per
  the light-automated directive.

## Build-step 2 — INITIAL_TENANT_ID seam (code in working tree, alga-psa; UNCOMMITTED w/ licval WIP)

- (2026-06-05) Implemented F050/F051/F052/F054/F055: `createTenant`
  (`ee/server/src/lib/testing/tenant-creation.ts`) takes optional `tenantId` →
  sets `tenantInsert.tenant` when present (else DB `gen_random_uuid()` default,
  unchanged); idempotency guard returns the existing tenant (+ its client) if the
  id already exists so a re-run doesn't error/duplicate. Threaded through
  `TenantCreationInput` → `createTenantComplete`. `create-tenant.ts` reads
  `INITIAL_TENANT_ID` (env or `--tenantId`) and passes it down.
- (2026-06-05) **Three `tenant-creation.ts` copies** — only
  `ee/server/src/lib/testing/tenant-creation.ts` is the live path (what
  `server/scripts/create-tenant.ts` imports). `packages/ee/src/lib/testing/…` is
  the CE stub (throws). No parallel edit needed.
- (2026-06-05) No caller breakage: the change is additive-optional;
  `tenant-test-factory.ts` (the only other `createTenantComplete` consumer) is
  unaffected. Other `createTenant(` matches are unrelated functions (temporal
  activities, server test-utils).
- (2026-06-05) **Not committed** — these two files also carry the user's licval
  WIP (password seam). Left uncommitted in the working tree to avoid committing
  in-flight work; appliance changes (steps 2+4) commit together when the user is
  ready. F053 (bootstrap passes the redeemed id) + full typecheck land in step 4.
- (2026-06-05) T007/T008 reclassified AUTO→SMOKE: exercising `createTenant`'s id
  adoption needs the full alga-psa `tenants`/`clients` schema (heavy), so it's
  validated in the live install loop, not a unit DB.

## Build-step 3 — /register-tenant + /install-codes/reissue + presign (DONE, alga-license branch)

- (2026-06-05) **Dependency-free SigV4 presigner** (`src/storage/presign.ts`) — the
  service had no AWS SDK and is intentionally lean (fastify/knex/pg only), so the
  S3/MinIO presigned-GET URL is hand-rolled with `node:crypto` (path-style,
  UNSIGNED-PAYLOAD, query-auth). `now` is injectable for deterministic tests.
- (2026-06-05) Object-store config is **env-driven and OPTIONAL**:
  `OBJECT_STORE_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY` + `APPLIANCE_ISO_KEY`
  (default `appliance/current/alga-appliance.iso`). `getPresignConfigFromEnv()`
  returns null when unset so existing deploys (and /sign /register /check-in) boot
  without it; only register-tenant/reissue need it, and they emit `download_url:''`
  if it's missing. TTL = `claimCodeTtlSeconds` (link expiry aligned to the code).
- (2026-06-05) New routes: `/register-tenant` (service-authed) creates the registry
  row, (paid) upserts the entitlement bound to the new tenant, mints the install
  code carrying tenant_id (+ entitlement), presigns. `/install-codes/reissue`
  resolves by tenant_id|email, `revokeClaimCodesForTenant`, re-attaches the active
  entitlement via new `getActiveEntitlementByTenant`, mints a fresh code + link.
- (2026-06-05) **Validated:** tsc clean; jest **31/31** (added presign structural
  test ×2 + getActiveEntitlementByTenant). Route HTTP behavior (T010/T018) is smoke.
- (2026-06-05) **DEPLOY FOLLOW-UP (relates to F041):** the alga-license Deployment
  (service `k8s/deployment.yaml` + nm-kube-config) must get the `OBJECT_STORE_*`
  env + `APPLIANCE_ISO_KEY`, and the appliance release process must publish the
  current ISO to that key. Not wired here (ops); register-tenant returns an empty
  download_url until it is.

## Commands / Runbooks

- (2026-06-05) **alga-license migration/db tests:** run against a throwaway
  `docker run postgres:16` (snap docker can't reach /tmp; `docker run` is fine —
  prior runs used port 5433). The least-priv app role can't `TRUNCATE` (by design)
  — tests `DELETE`. DB-layer tests are gated on `DB_HOST` (skip without a DB).
- (2026-06-05) **Build gotcha:** the shell has `NODE_ENV=production`, so
  `npm install` omits devDeps (breaks tsc/@types) — use `npm install --include=dev`.
- (2026-06-05) **alga-license validation one-liner** (throwaway pg):
  `docker run -d --name algalic-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=alga_license -p 5433:5432 postgres:16`
  then `DB_HOST=localhost DB_PORT=5433 DB_NAME=alga_license DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=test npm run migrate`
  and `DB_HOST=localhost DB_PORT=5433 DB_NAME=alga_license DB_USER_APP=postgres DB_PASSWORD_APP=test npm test`.
  The signLicense tests need the alga-psa fixture key at
  `packages/licensing/src/lib/__test-fixtures__/v1-test.private.pem` (present).
- (2026-06-05) **Appliance VM smoke:** the full register→download→install loop is
  validated live on the libvirt appliance VM (see the appliance teardown/reinstall
  + VM ISO-test memories for driving setup via the browser / virsh).

## Links / References

- Design spec: `docs/superpowers/specs/2026-06-05-appliance-registration-install-flow-design.md`
- Registry foundation (already shipped): alga-license PR #3/#4, nm-kube-config PR #50/#51.
- alga-license routes: `src/routes/{register,claimCodes,checkIn,sign,revoke}.ts`;
  db: `src/db/db.ts`; migrations: `migrations/0{1..4}_*.cjs`; types: `src/api-types.ts`.
- Appliance: `ee/server/src/lib/testing/tenant-creation.ts`,
  `server/scripts/create-tenant.ts`,
  `server/src/lib/actions/licenseManagementActions.ts`.

## Open Questions

- (2026-06-05) **All four §16 design questions resolved** — see the Decisions
  section. No open design forks remain. Only impl detail left: the object-store key
  for the current generic ISO + the release-process publish step (F041).
