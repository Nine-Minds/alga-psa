# Permission catalog

The single source of truth for system permissions and the default-role grants
that ship with them. Every path that provisions or repairs tenant RBAC consumes
this directory: PSA and AlgaDesk onboarding seeds, developer seeds, the
AlgaDesk→AlgaPSA upgrade, and reconciliation migrations.

Plain CommonJS with no application imports — migrations and seeds `require()` it
directly, and callers always pass a Knex instance plus an explicit tenant id.

| Module | Purpose |
| --- | --- |
| `catalog.cjs` | The permission entries, product membership and default grants |
| `roleGrants.cjs` | Exact default-role identities and the grant compiler |
| `catalogValidation.cjs` | Structural validation, run before every sync |
| `syncPermissionCatalog.cjs` | Comparison core + transactional additive apply |
| `reconcileTenants.cjs` | The one tenant loop, shared by migrations and seeds |
| `auditPermissionCatalog.cjs` | Read-only drift report over the same core |

## Contract

- **Identity** is `(resource, action, msp, client)`. The tenant is supplied at
  synchronization time; `permission_id` is never a cross-tenant key.
- **Minimum state, not exact state.** Sync inserts what is missing and refreshes
  catalog-owned descriptions. It never deletes a role, a permission or a grant,
  and it never touches anything outside the catalog.
- **Custom roles are invisible.** A role is a grant target only when its exact
  `(role_name, msp, client)` identity is in `DEFAULT_ROLES`. Zero or multiple
  matches for a required role fails the tenant transaction with an actionable
  error — roles are never created or guessed here.
- **MSP Admin** receives every MSP-scoped catalog permission for its product.
  Other default roles receive only the keys declared on each catalog entry.
- **Dual scope.** A permission with `msp` *and* `client` is addressable from both
  scopes. Grants resolve by identity, so a dual-scope entry never collides with a
  single-scope one of the same `resource:action`.
- **Atomic + idempotent.** Each tenant is applied in one transaction and a rerun
  writes nothing.
- **Product match.** The requested product must be the tenant's `product_code`,
  with one exception: AlgaDesk→AlgaPSA, the supported upgrade, which backfills
  the PSA catalog before the `product_code` flip commits and removes nothing.
- **Names are compared verbatim.** `hasPermission` matches the requested resource
  against the stored one with `===`. There is no alias table, and a guard test
  fails if one reappears.

## One tenant loop, two strictness modes

Everything that provisions permissions goes through
`reconcileAllTenants(knex, options)` in `reconcileTenants.cjs` — the
reconciliation migrations, `server/seeds/dev/47`+`48`, and the PSA/AlgaDesk
onboarding seeds. `apply: 'grants'` runs the grant half only, for the
role-permission seeds that follow their sibling; `product` and `tenantId` scope
the enumeration.

`onDrift` is always explicit, because the two callers want opposite failures:

| Caller | `onDrift` | Behaviour |
| --- | --- | --- |
| Reconciliation migrations | `'skip'` (default) | A tenant whose own shape blocks reconciliation is reported and left untouched; unexpected per-tenant errors are counted. The loop cannot abort `knex migrate:latest`. |
| Seeds, onboarding, integration suite | `'throw'` | Drift fails the caller. It owns the tenant it just created, so a silently under-permissioned tenant is the bug this catalog exists to prevent. |

A migration runs against every database this product has ever produced, and one
tenant that drifted years ago must not stop a deployment — that is the
`standard_statuses` incident, and it is what blocked an environment rebuild on a
tenant with no MSP `Admin` role. The gate for the skip path is
`auditPermissionCatalog.cjs`, run out-of-band before and after the deploy: same
comparison core, free to fail loudly.

`roles`, `permissions` and `role_permissions` are all local (undistributed)
tables on Citus, so the skip path adds no distributed query planning.

## Renaming a resource

RBAC used to reconcile `timeentry`/`timesheet` with the `time_entry`/`time_sheet`
names the rest of the system uses (tables, search object types, kernel resource
types, v1 API resources) via a `RESOURCE_CANONICAL_MAP` copy-pasted into six
modules — and missing from three of them, so a check resolved differently
depending on which `hasPermission` the caller reached. `timeperiod` was worse:
no alias table ever bridged it to the `time_period` the v1 timesheet API checks,
so those endpoints denied every caller. The name is fixed at the source instead:

1. Add `legacy: 'canonical'` to `RENAMED_RESOURCES` in `catalog.cjs` and rename
   the entries themselves.
2. Rename every call site.
3. Ship a rename migration
   (`20260827110000_rename_time_permission_resources.cjs` is the template): it
   `UPDATE`s `permissions.resource` so `permission_id` — and therefore every
   grant, including grants on tenant-authored custom roles — survives, merging
   grants onto the canonical row only where a tenant already carries both
   spellings.

## Adding a permission

1. Add the entry to `ACTIVE_PERMISSIONS` in `catalog.cjs` with its product
   membership and per-product `defaultGrants`.
2. Add a numbered migration that calls `reconcileAllTenants` for the eligible
   existing tenants. New tenants pick it up from the onboarding seeds
   automatically.

Never edit a historical migration to repair production; ship a forward one.

## Removing a permission

Delete the entry from `ACTIVE_PERMISSIONS`. New tenants stop being provisioned
with it, and nothing re-inserts it. Synchronization never deletes, so rows in
existing tenants stay where they are: removing them is a separate, reviewed
migration with an explicit policy for grants custom roles may already hold.

## Deferred role decisions

`DEFERRED_ROLE_DECISIONS` in `roleGrants.cjs` records role keys that no product
seed creates: `msp:Editor` is there because only the secrets migration ever
granted it, and granting it from the catalog would fail validation until a seed
creates the role.

## Usage

```js
const { reconcileAllTenants } = require('server/migrations/utils/permissions/reconcileTenants.cjs');
const { auditPermissionCatalog } = require('server/migrations/utils/permissions/auditPermissionCatalog.cjs');

await reconcileAllTenants(knex, { onDrift: 'throw' });   // apply, one transaction per tenant
const report = await auditPermissionCatalog(knex);       // read-only, every tenant
```

Audit output contains tenant identifiers: it belongs in a restricted deployment
artifact, never in the repository or a public CI log.
