# Appliance registration → download → install flow

**Status:** Design • **Date:** 2026-06-05

## Goal

Let a customer register for an on-prem (appliance) AlgaPSA install, download a
generic ISO, and have the installed appliance come up already bound to a
**tenant identity that was minted upstream at registration** — so licenses are
bound from first boot and even free (essentials) installs get a real
`tenant_registry` record.

The single organizing idea: the appliance image is **generic** (we don't build a
per-customer ISO), so per-tenant identity travels separately from the download,
carried by a short, one-time **install code** that the appliance redeems at
setup. The code is the per-customer artifact; the ISO is not.

## What exists today (grounded)

The pieces this flow reuses already exist:

- **`tenant_registry`** (`alga-license/migrations/01_tenant_registry.cjs`) — the
  global directory: `tenant_id uuid` (minted here, `gen_random_uuid()`),
  `edition`, `deployment_type`, `status` (`registered → installed → active …`),
  `company_name`/`contact_email`, `stripe_customer_id`. This is the source of
  truth for "a tenant exists, who owns it, what edition."
- **`/register`** (`alga-license/src/routes/register.ts`) — redeems a
  `claim_code`, mints a per-appliance license JWT bound to a tenant via the `aud`
  claim (`signLicense({ …, aud })`), issues an appliance credential, returns
  `{ appliance_credential, first_jwt, check_in_url }`. Today it **requires an
  entitlement** (`getEntitlementById(row.entitlement_id)` → 500 if none) and
  takes `tenant_id` as **caller-supplied input**.
- **`/claim-codes`** (`alga-license/src/routes/claimCodes.ts`) — mints a code for
  an entitlement, keyed by `stripe_sub_id` (paid only). Revokes prior unclaimed
  codes for that entitlement first (rebind path).
- **`/check-in`** (`alga-license/src/routes/checkIn.ts`) — refreshes the bound
  license daily, **preserving `appliance.tenant_id` as `aud`** across re-signs.
  No change needed.
- **`claim_codes`** (`alga-license/migrations/03_claim_codes.cjs`) —
  `entitlement_id` is `NOT NULL` with an FK to `entitlements`.
- **Appliance tenant creation** (`ee/server/src/lib/testing/tenant-creation.ts`,
  used by `server/scripts/create-tenant.ts`) — `createTenant` inserts into
  `tenants` **without** a `tenant` value, so the DB generates the UUID
  (`gen_random_uuid()`) and returns it (`.returning('tenant')`, line 80–84).
- **Appliance consumer** (`server/src/lib/actions/licenseManagementActions.ts`) —
  `connectAppliance` POSTs `{ claim_code, appliance_id }` to `/register` and
  seeds `license_state` with `first_jwt` / `appliance_credential` /
  `check_in_url`. Runs **after** the tenant already exists.

### The gap

Today the appliance **generates its own tenant UUID** at setup, then *optionally*
connects a license later. The tenant identity is never known upstream, so a
license issued before install can't be bound, and essentials installs leave no
registry record. The flow below inverts the direction: **mint `tenant_id`
upstream at registration; the install code carries it downstream; the appliance
adopts it.**

## The four surfaces

```
 nm-store              alga-license (C4)            object store        appliance
 ────────              ─────────────────            ────────────        ─────────
 register  ──POST───►  /register-tenant
   form                  • tenant_registry row (tenant_id)
                         • (paid) entitlement
                         • mint install code  ──carries──► tenant_id
                         • presign ISO URL  ◄──────────────┐
           ◄──{code, tenant_id, download_url}              │
 confirm page                                              │
   + email                                                 │
                                                           │
 download  ──────────────────────presigned GET────────────┘──────────►  ISO
                                                                         │
 install: setup UI "enter install code"                                  ▼
           ──POST {claim_code, appliance_id}──►  /register
                                                  • look up code → tenant_id (registry-minted)
                                                  • (paid) mint license bound aud=tenant_id
           ◄──{ tenant_id, edition, first_jwt?, credential?, check_in_url? }
                                                                         │
           create-tenant  INITIAL_TENANT_ID=tenant_id ◄─────────────────┘
           seed license_state (edition; + token/credential if paid)
           registry status → installed
```

1. **Registration (nm-store → alga-license).** A new service-authed endpoint
   `POST /register-tenant` on alga-license creates the `tenant_registry` row
   (`deployment_type=appliance`, `status=registered`), and for **paid** tiers
   creates the entitlement (Stripe checkout drives this, as the hosted flow does
   today). It mints an **install code** carrying that `tenant_id` (and the
   `entitlement_id` for paid), and returns `{ tenant_id, install_code,
   download_url }`. nm-store shows the code on the confirmation page and emails
   it. nm-store stays DB-less — alga-license owns the registry write, the code,
   and the presigned URL.

2. **Download (presigned, all tiers).** `download_url` is a time-boxed presigned
   URL to the **current generic appliance ISO** in the in-cluster object store
   (MinIO). Presigned for everyone — essentials included — so downloads are
   gated by registration, not public. The ISO carries no identity.

3. **Install (appliance redeems the code).** The first-boot setup UI gains an
   **"enter install code"** step. The host-service redeems it via the existing
   `/register`, which now returns the registry-minted `tenant_id` and `edition`
   (plus, for paid, `first_jwt` / `appliance_credential` / `check_in_url`).
   Bootstrap then runs `create-tenant` with a new **`INITIAL_TENANT_ID`** so the
   local `tenants` row is created under the pre-minted UUID, and seeds
   `license_state` (edition always; license token + credential + check-in URL for
   paid). alga-license flips the registry row to `status=installed`.

4. **Re-issue / recovery (in scope).** Install codes are one-time. A new
   service-authed `POST /install-codes/reissue` on alga-license resolves an
   existing registry tenant (by `contact_email`, or `tenant_id`), revokes any
   unconsumed codes for it, and mints a **fresh install code for the same
   `tenant_id`** (+ current entitlement) with a fresh presigned `download_url`.
   nm-store exposes this as a portal "re-issue install code" action. This is what
   makes a wipe-and-reinstall recover the *same* tenant identity rather than
   stranding it.

## Data model changes (alga-license)

A single migration extending `claim_codes` so one code type serves both paid and
essentials, carrying the registry tenant:

```
ALTER claim_codes:
  entitlement_id  → NULLABLE        -- essentials codes carry no entitlement
  + tenant_id     uuid NOT NULL FK → tenant_registry(tenant_id)
  + index on tenant_id
```

- **Paid code:** `entitlement_id` set (license path unchanged) **and** `tenant_id`
  set (so `aud` comes from the registry, not appliance input).
- **Essentials code:** `entitlement_id` null, `tenant_id` set. No license minted.

`tenant_registry` already has everything else needed (`edition`, `company_name`,
`contact_email`, `status`); no change there beyond writing `status=installed` at
install.

## API changes (alga-license)

**`/register` (extend, don't replace).** Today it 500s when the code has no
entitlement and binds `aud` from caller-supplied `tenant_id`. New behavior:

- Resolve `tenant_id` from **the code** (`row.tenant_id`), not the request body —
  this is the registry-minted identity. (Keep accepting a body `tenant_id` only
  as a legacy fallback for pre-registry appliances; the registry path ignores
  it.)
- If `row.entitlement_id` is null → **essentials**: skip license minting; still
  upsert the appliance row (credential, `tenant_id`, no token).
- Look up `tenant_registry` by `tenant_id` for `edition` + `company_name` /
  `contact_email`.
- **Response gains** `tenant_id`, `edition`, and (for essentials) omits
  `first_jwt`. So `RegisterResponse` becomes:
  `{ tenant_id, edition, company_name, contact_email, appliance_credential?,
  first_jwt?, check_in_url? }` — credential/token/url present only when there's a
  license (paid).

**`POST /register-tenant` (new, service-authed).** Body: company/contact,
edition, deployment_type, optional Stripe linkage. Creates the registry row,
(paid) entitlement, mints the install code carrying `tenant_id`, presigns the
ISO, returns `{ tenant_id, install_code, download_url }`. Reuses
`createRegistryTenant` + the claim-code minting (generalized to accept a
`tenant_id` and optional `entitlement_id`).

**`POST /install-codes/reissue` (new, service-authed).** Body:
`{ contact_email | tenant_id }`. Resolves the registry tenant, revokes its
unconsumed codes, mints a fresh code + presigned `download_url`. Returns
`{ install_code, download_url }`.

## The `INITIAL_TENANT_ID` seam (appliance)

The change is small and localized at the one place the UUID is born:

- `createTenant` (`tenant-creation.ts`) gains an optional `tenantId` on its input;
  when present, set `tenantInsert.tenant = input.tenantId` instead of letting the
  DB default it. Thread the option through `createTenantComplete`.
- `server/scripts/create-tenant.ts` reads `INITIAL_TENANT_ID` (env, alongside the
  existing `INITIAL_ADMIN_PASSWORD`) and passes it down.
- The appliance bootstrap (the configmap/script that runs `create-tenant` at
  first boot) sets `INITIAL_TENANT_ID` to the `tenant_id` the redeem returned.

When `INITIAL_TENANT_ID` is unset, behavior is unchanged (DB-generated UUID) — so
this is additive and safe for non-registry installs.

## The install-time redeem consumer (appliance)

`connectAppliance` already knows how to call `/register` and seed `license_state`.
The install path generalizes it:

1. Setup UI collects the install code + admin password (the password is set here,
   at install — it never travels through registration or email).
2. Host-service POSTs `{ claim_code, appliance_id }` to `/register`, receives
   `tenant_id` + `edition` (+ license bits if paid).
3. Bootstrap runs `create-tenant` with `INITIAL_TENANT_ID = tenant_id`.
4. Seed `license_state`: `edition` always; for paid also `license_token`
   (`first_jwt`), `appliance_credential`, `check_in_url` (the existing
   `connectAppliance` write, minus the assumption that a token is always present).

Essentials installs simply run at `edition=essentials` with a `license_state` row
and no token — consistent with "always seed `license_state`" (the appliance reads
edition from `license_state`, not from the presence of a token).

## Error handling

- **Code invalid / expired / already consumed** — `/register` already returns
  `invalid_claim_code` / `expired_claim_code` / `consumed_claim_code`; the setup
  UI surfaces these and points the user to portal **re-issue**.
- **Consumed code on reinstall** — expected; the user re-issues. Re-issue revokes
  stragglers so only the newest code is live.
- **Presigned URL expired** — re-issue mints a fresh one; the download link and
  the code travel together.
- **Registry/license-service unreachable at install** — setup blocks with a clear
  "can't reach license service" error (the appliance can't self-mint a registry
  identity; that's by design).
- **Idempotent install** — if `create-tenant` reruns with the same
  `INITIAL_TENANT_ID`, it must no-op/short-circuit rather than duplicate
  (the existing admin-user create already guards on `(email, tenant)`).

## Security considerations

- The install code is **single-use** (`consumeClaimCode` is atomic under
  concurrency) and short-lived (`claimCodeTtlSeconds`); re-issue is the only way
  to get another, and it's behind portal auth on nm-store.
- Per-tenant binding is preserved end-to-end: the registry mints `tenant_id`,
  the code carries it, `/register` stamps it as `aud`, `/check-in` keeps it across
  refreshes — so a leaked license still can't activate on another tenant
  (the binding work already shipped; this flow just sources `aud` from the
  registry instead of appliance input).
- Presigned-for-all means the ISO isn't a public URL, but note the ISO itself is
  **not** a secret — the install code is the gate. Presigning is registration
  gating + link expiry, not ISO confidentiality.
- The admin password is set at install, never in registration/email.

## Testing

Following the repo's light-automated-then-smoke convention:

- **Automated (alga-license):** the `claim_codes` extension + `/register`
  essentials path + `/register-tenant` + `/install-codes/reissue` get db-layer
  and route tests against a throwaway Postgres (the existing pattern: gated on
  `DB_HOST`, `DELETE` not `TRUNCATE` for the least-priv role). Cover: essentials
  code (no entitlement) redeems and returns `tenant_id`/`edition` with no token;
  paid code returns a license bound to the registry `tenant_id`; reissue revokes
  prior codes and reuses the same `tenant_id`.
- **Automated (appliance):** `createTenant` honors `INITIAL_TENANT_ID`
  (creates the `tenants` row under the supplied UUID; unchanged when unset).
- **Smoke (live, on the VM):** full loop — register on nm-store → download →
  enter code in setup UI → confirm the appliance comes up under the minted
  `tenant_id`, `license_state` seeded, paid tier licensed/bound, then a
  wipe-and-reinstall via **re-issue** recovers the same tenant.

## Phasing

The four decisions collapsed the original two-phase split: re-issue is **in
scope now**, so this is one coherent build rather than essentials-first then
paid. Suggested build order (each independently verifiable):

1. **alga-license schema + `/register` extension** (essentials path + tenant_id
   from the code + richer response). The seam everything hangs off.
2. **`INITIAL_TENANT_ID`** in `createTenant` / `create-tenant.ts` / bootstrap.
3. **`/register-tenant`** + **`/install-codes/reissue`** + presigned-URL minting.
4. **Setup-UI install-code step** + install-time redeem/seed consumer.
5. **nm-store** registration + confirmation/email + portal re-issue.

## Open questions (for spec review)

1. **Presigned URL owner.** Lean: alga-license mints the presigned URL (holds the
   MinIO creds; nm-store stays DB-less and just relays). Confirm MinIO is the ISO
   store and the appliance release process publishes the "current" ISO to a known
   key. Current appliance release metadata is published by the `~/nm-kube-config`
   Argo workflow to OCI, not from local files in `alga-psa`.
2. **`/register-tenant` vs Stripe ordering for paid.** Does nm-store call
   `/register-tenant` before or after Stripe checkout completes? Lean: create the
   registry row at form submit (`status=registered`), attach the entitlement on
   `checkout.session.completed`, mint the code at that point.
3. **Edition source for essentials at `/register`.** Confirmed via
   `tenant_registry.edition` (the code → tenant_id → registry lookup); no edition
   on the code itself. OK?
4. **Code format.** Reuse `generateClaimCode()` as-is (same friendly format), or a
   distinct visual format for install codes? Lean: reuse — one machinery.
```
