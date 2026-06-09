# Appliance registration → install flow

An on-prem appliance gets its identity **before** it boots: the customer registers,
the alga-license control plane mints a tenant in the global registry and a one-time
**install code**, and the appliance redeems that code at first-boot setup to come up
already bound to its tenant. The ISO is generic — the install code is the only
per-customer artifact.

## The path a customer takes

1. **Register** (nm-store). The customer submits company, contact, and edition.
   nm-store calls alga-license `POST /register-tenant`, which creates the
   `tenant_registry` row, mints a one-time install code carrying the new
   `tenant_id` (plus an entitlement for paid editions), and returns a **presigned,
   time-boxed ISO download link**. The install code and link are **emailed** to the
   contact.
2. **Download** the generic appliance ISO from the presigned link.
3. **Install.** On the first-boot setup screen the operator enters the **install
   code** (and sets the admin password). The appliance redeems the code and comes
   up under the registry-minted tenant.
4. **Reinstall** (if needed). Install codes are single-use. To rebuild an
   appliance, re-issue a fresh code for the *same* tenant (below).

## What happens at install (under the hood)

The host-service setup engine (`ee/appliance/host-service/setup-engine.mjs`, via
`install-code.mjs`) redeems the code against `ALGA_LICENSE_SERVICE_URL/register`,
which returns the `tenant_id`, the `edition`, and — for paid editions — the first
license JWT, a per-appliance credential, and the check-in URL. Those flow into two
Secrets the in-cluster bootstrap consumes:

- `appliance-initial-tenant` gains `INITIAL_TENANT_ID`. The bootstrap
  (`helm/templates/appliance-bootstrap-configmap.yaml`) runs `create-tenant`, which
  **adopts that id** instead of generating one, so the appliance's local tenant row
  *is* the registry tenant. (No install code → `create-tenant` generates a id as
  before; nothing else changes.)
- `appliance-license-seed` carries the edition + (paid) license token + connected
  credential/check-in URL. The bootstrap seeds `license_state` from it: essentials
  runs at the essentials tier with no token; paid is licensed from first boot and
  refreshes daily via check-in.

A bad, expired, or already-used code — or an unreachable license service — **blocks
the install** with a clear message; the appliance never silently self-generates a
tenant.

## Re-issuing an install code (reinstall recovery)

Because codes are single-use (and consumed when the install applies them), a
reinstall needs a fresh one for the same tenant. Re-issue resolves the tenant by
contact email or `tenant_id`, revokes any still-unclaimed codes, and mints a new
code + presigned link bound to the same `tenant_id` (re-attaching the paid
entitlement). The rebuilt appliance comes back under its original identity.

Service endpoint: `POST /install-codes/reissue` on alga-license (service-authed),
surfaced through the nm-store portal.

## Operator notes

- The install code is the per-customer gate; the ISO itself is generic and not
  secret. The download link is presigned (registration-gated + time-boxed), not
  public.
- The admin password is set at install — it never travels through registration or
  email.
- A failed install *after* the code is applied needs a re-issued code (the original
  is already consumed).
