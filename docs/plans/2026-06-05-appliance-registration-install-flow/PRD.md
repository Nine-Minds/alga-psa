# PRD: Appliance registration → download → install flow

- Slug: `appliance-registration-install-flow`
- Date: `2026-06-05`
- Status: Draft
- Source spec: `docs/superpowers/specs/2026-06-05-appliance-registration-install-flow-design.md`

## 1. Problem statement & user value

A customer who wants on-prem (appliance) AlgaPSA must be able to register, download
a generic ISO, install it, and have the appliance come up **already bound to a
tenant identity that was minted upstream at registration**. Today the appliance
generates its own tenant UUID at first boot and only *optionally* connects a
license afterward, so: (a) a license issued before install can't be bound to the
right tenant, and (b) free (essentials) installs leave no record in the global
registry. The value: licenses are bound from first boot, essentials installs get a
real `tenant_registry` row, and a wipe-and-reinstall recovers the *same* tenant.

The organizing idea: the appliance image is **generic** — we do not build a
per-customer ISO — so per-tenant identity travels separately from the download,
carried by a short, one-time **install code** the appliance redeems at setup. The
code is the per-customer artifact; the ISO is not.

## 2. Goals

- Mint `tenant_id` **upstream** at registration (in the `tenant_registry`) and
  carry it to the appliance via a one-time install code.
- Reuse the existing `/register` claim-code machinery for the redeem (one code
  format, one redeem path) — see §5.
- Support **essentials** (free, no entitlement) and **paid** (entitlement +
  bound license) through the same flow.
- Adopt the minted `tenant_id` at install via a new `INITIAL_TENANT_ID` seam
  (vs. today's DB-generated UUID), additive and safe when unset.
- Presigned-for-all downloads (registration-gated, not public).
- Re-issue / recovery in scope now: re-fetch a fresh code for the same tenant.

## 3. Non-goals

- No per-customer ISO builds; the ISO stays generic.
- No migration/backfill of existing hosted tenants into the registry (forward-only).
- No CRM/relationship modeling — registry holds identity + entitlement state only.
- No new license-binding mechanism — binding (`aud`) already shipped; this flow
  only changes where `aud` is *sourced* (registry vs. appliance input).
- No observability/metrics/admin-tooling beyond what the flow needs to function.

## 4. Personas & primary flows

- **Prospect/customer** (nm-store): fills the registration form → gets an install
  code + download link (confirmation page + email).
- **Installer/admin** (appliance setup UI): downloads the ISO, boots it, enters the
  install code + sets the admin password → appliance comes up under the minted
  tenant.
- **Returning admin** (reinstall/recovery): uses the portal "re-issue install code"
  to get a fresh code for the same tenant, then reinstalls.

Primary flow (happy path):

```
register (nm-store) → /register-tenant mints tenant_id + install code + presigned URL
  → download generic ISO → setup UI: enter install code + admin password
  → /register returns tenant_id + edition (+ license if paid)
  → create-tenant with INITIAL_TENANT_ID → seed license_state → registry=installed
```

## 5. Resolved design decisions

1. **Install code redeemed via `/register`** — reuse the existing claim-code →
   `/register` machinery for the short, friendly code (no separate redeem path).
2. **Extend `claim_codes`** — make `entitlement_id` nullable and add a
   `tenant_id` FK to `tenant_registry`. One code type serves essentials (no
   entitlement) and paid (with entitlement). (Chosen over a new `install_tokens`
   table.)
3. **Presigned for all** downloads, essentials included — gated by registration,
   not public; the ISO itself is not a secret, the code is the gate.
4. **Re-issue in scope now** — a portal "re-issue install code" action resolves an
   existing registry tenant and mints a fresh code for the *same* `tenant_id`
   (folded out of a later phase into this build).

## 6. Architecture: the four surfaces

1. **nm-store** (DB-less Next.js): registration form + confirmation/email + portal
   re-issue. Calls alga-license; never writes the registry directly.
2. **alga-license (C4)**: registry writes, install-code mint/redeem, presigned-URL
   mint, license signing. Routes live in `src/routes/`.
3. **Object store (MinIO)**: holds the current generic appliance ISO at a known
   key; alga-license presigns time-boxed GET URLs.
4. **Appliance** (`alga-psa`): setup UI install-code step, install-time redeem
   consumer, `INITIAL_TENANT_ID` tenant adoption, `license_state` seeding.

The spine is a **direction inversion**: today `tenant_id` flows appliance→service
(`/register` accepts it as input); the new flow mints it upstream and flows it
service→appliance (the code carries it, `/register` returns it, the appliance
adopts it).

## 7. Data model changes (alga-license)

One migration extending `claim_codes` (current:
`alga-license/migrations/03_claim_codes.cjs`, `entitlement_id NOT NULL`):

- `entitlement_id` → **NULLABLE** (essentials codes carry no entitlement).
- add `tenant_id uuid NOT NULL` FK → `tenant_registry(tenant_id)`, indexed.

No change to `tenant_registry` (already has `edition`, `company_name`,
`contact_email`, `status`, `stripe_customer_id`) beyond writing
`status='installed'` + `installed_at` at install.

DB accessors (`alga-license/src/db/db.ts`): `createRegistryTenant`,
`getRegistryTenant`, `getRegistryTenantByEmail`, `getClaimCode`,
`consumeClaimCode`, `upsertAppliance` (already takes `tenantId`) **exist**.
Changes: `insertClaimCode` accepts `tenant_id` + optional `entitlement_id`;
`getClaimCode`/`ClaimCodeRow` expose `tenant_id`; **new** `revokeClaimCodesForTenant`
(reissue for essentials has no entitlement to key on).

## 8. API changes (alga-license)

**`/register` (extend `src/routes/register.ts`):**

- Source `tenant_id` from the **code row** (`row.tenant_id`), not the request body
  (the registry-minted identity). Keep accepting body `tenant_id` only as a legacy
  fallback for pre-registry appliances.
- If `row.entitlement_id` is null → **essentials**: skip license minting; still
  `upsertAppliance` (credential + `tenant_id`, no token).
- Look up `tenant_registry` by `tenant_id` for `edition` + `company_name` +
  `contact_email`.
- Response gains `tenant_id`, `edition`, `company_name`, `contact_email`;
  `appliance_credential` / `first_jwt` / `check_in_url` become **optional**
  (present only for paid).
- On success, set registry `status='installed'` + `installed_at`.

**`POST /register-tenant` (new, service-authed):** body = company/contact, edition,
deployment_type, optional Stripe linkage → `createRegistryTenant`
(`status='registered'`); paid → create/link entitlement; mint install code
carrying `tenant_id` (+ `entitlement_id` if paid); presign ISO; return
`{ tenant_id, install_code, download_url }`.

**`POST /install-codes/reissue` (new, service-authed):** body =
`{ contact_email | tenant_id }` → resolve registry tenant →
`revokeClaimCodesForTenant` → mint fresh code (same `tenant_id`, current
entitlement) → fresh presigned `download_url`. Returns `{ install_code,
download_url }`.

## 9. Appliance changes (alga-psa)

**`INITIAL_TENANT_ID` seam** (the UUID is born in
`ee/server/src/lib/testing/tenant-creation.ts` `createTenant`, line ~80, which
inserts into `tenants` without a `tenant` value → DB default):

- `createTenant` gains optional `tenantId`; when set,
  `tenantInsert.tenant = input.tenantId`. Thread through `createTenantComplete`.
- `server/scripts/create-tenant.ts` reads `INITIAL_TENANT_ID` (env, next to the
  existing `INITIAL_ADMIN_PASSWORD` already wired in the licval WIP) and passes it
  down.
- Appliance bootstrap (configmap/script running `create-tenant` at first boot)
  sets `INITIAL_TENANT_ID` from the redeem result.
- Unset `INITIAL_TENANT_ID` = unchanged DB-generated behavior (additive/safe).

**Install-time redeem consumer** (generalize
`server/src/lib/actions/licenseManagementActions.ts` `connectAppliance`):

- Setup UI collects install code + admin password (password set at install only,
  never in registration/email — the licval WIP already threads
  `INITIAL_ADMIN_PASSWORD`).
- Host-service POSTs `{ claim_code, appliance_id }` to `/register`; receives
  `tenant_id` + `edition` (+ license bits if paid).
- Run `create-tenant` with `INITIAL_TENANT_ID = tenant_id`.
- Seed `license_state`: `edition` always; for paid also `license_token`
  (`first_jwt`), `appliance_credential`, `check_in_url` (the existing
  `connectAppliance` write, minus the assumption a token is always present).
- Essentials: `license_state` row, no token; appliance reads edition from
  `license_state` (consistent with "always seed `license_state`").

## 10. nm-store changes

- Registration form (company, contact, edition) → `POST /register-tenant`.
- **Email** the install code + presigned download link to the contact after
  registration/purchase (primary delivery); the confirmation page may also show the
  install code.
- Paid: Stripe checkout ordering — create registry row at submit
  (`status='registered'`), attach entitlement + mint code on
  `checkout.session.completed` (§16.2).
- Portal "re-issue install code" action (behind portal auth) → `/install-codes/reissue`.

## 11. Presigned download & ISO publishing

- alga-license mints time-boxed presigned GET URLs; the object-store (MinIO)
  credentials are supplied to the service as **env vars** (§16.1).
- The presigned `download_url` is **delivered by email** to the contact after
  registration/purchase, alongside the install code — registration-gated, not a
  public link. (`/register-tenant` returns it; the post-registration/checkout email
  step carries it to the user.)
- The appliance release process publishes the **current** generic ISO to a known
  object-store key; `download_url` points there (impl detail under F041).
- Presigning provides registration gating + link expiry, not ISO confidentiality.

## 12. Security / permissions

- Install code is single-use (`consumeClaimCode` is atomic under concurrency) and
  short-lived (`claimCodeTtlSeconds`); re-issue is the only way to get another and
  is behind portal auth.
- Per-tenant binding preserved end-to-end: registry mints `tenant_id` → code
  carries it → `/register` stamps `aud` → `/check-in` preserves `aud` across
  re-signs. A leaked license still can't activate on another tenant.
- `/register-tenant` and `/install-codes/reissue` require service auth
  (`makeServiceAuthHook`), same as `/claim-codes`.
- Admin password set at install, never transmitted via registration/email.

## 13. Error handling

- Invalid / expired / consumed code → existing `/register` codes
  (`invalid_claim_code` / `expired_claim_code` / `consumed_claim_code`); setup UI
  surfaces them and points to portal re-issue.
- Consumed code on reinstall is expected → re-issue (revokes stragglers, newest
  code wins).
- Expired presigned URL → re-issue mints a fresh one (code + link travel together).
- License service unreachable at install → setup blocks with a clear error (the
  appliance can't self-mint a registry identity, by design).
- Idempotent install: rerun with the same `INITIAL_TENANT_ID` must no-op rather
  than duplicate (admin-user create already guards on `(email, tenant)`).

## 14. Testing approach (smoke-first)

Per the project convention and explicit direction: **light on automated tests,
mostly smoke**. A small automated set covers only the highest-risk seams
(migration up/down, `/register` essentials vs. paid branch, reissue revoke+reuse,
`INITIAL_TENANT_ID` honor + idempotency). Everything else is validated live on the
appliance VM end-to-end (register → download → install → reinstall-via-reissue).
See `tests.json` (smoke-weighted, not the usual tests-longer-than-features).

## 15. Rollout / phasing

One coherent build (re-issue folded in). Build order, each independently
verifiable:

1. alga-license schema + `/register` extension (essentials path + tenant_id from
   the code + richer response) — the seam everything hangs off.
2. `INITIAL_TENANT_ID` in `createTenant` / `create-tenant.ts` / bootstrap.
3. `/register-tenant` + `/install-codes/reissue` + presigned-URL minting.
4. Setup-UI install-code step + install-time redeem/seed consumer.
5. nm-store registration + confirmation/email + portal re-issue.

## 16. Resolved decisions (was open — settled 2026-06-05)

1. **Presign owner / delivery.** alga-license mints the time-boxed presigned GET
   URL, with the object-store (MinIO) credentials provided as **env vars**. The
   presigned URL is **delivered by email** to the contact after
   registration/purchase (carried alongside the install code), not handed out
   publicly. (Remaining implementation detail: which object-store key holds the
   "current" generic ISO and how the appliance release process publishes it — an
   impl task under F041, not a design fork.)
2. **Stripe vs. registration ordering (paid).** Create the `tenant_registry` row at
   form submit (`status='registered'`); attach the entitlement + mint the install
   code on `checkout.session.completed`.
3. **Edition source for essentials at `/register`.** From `tenant_registry.edition`
   via code → `tenant_id` → registry lookup; no edition stored on the code.
4. **Code format.** Reuse `generateClaimCode()` (existing 8-char unambiguous
   format) for install codes — one machinery, essentials and paid alike.

## 17. Acceptance criteria (Definition of Done)

- A free registration on nm-store yields an install code + presigned download link;
  installing the generic ISO with that code brings the appliance up under the
  registry-minted `tenant_id` at `edition=essentials`, with a `license_state` row
  and no token; registry `status='installed'`.
- A paid registration additionally yields a license bound to that `tenant_id`
  (`aud`), seeded into `license_state`, and the appliance shows licensed at the
  purchased tier; `/check-in` keeps the binding on refresh.
- A wipe-and-reinstall using a re-issued code recovers the **same** `tenant_id`.
- `INITIAL_TENANT_ID` unset → appliance behavior unchanged (DB-generated UUID).
- Smoke loop passes on the VM; the small automated set is green.
