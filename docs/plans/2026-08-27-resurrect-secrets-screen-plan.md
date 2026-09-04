# Resurrect the Secrets screen — implementation plan

Card: `e8acbfd6-37d2-4b85-99a8-de6ad448c867`
Branch: `feature/resurrect-secrets-screen`
Spec of record: `ee/docs/plans/2025-12-21-workflow-overhaul.md` § 18 (Tenant Secrets Management);
per-item tracking in `ee/docs/plans/workflow_runtime_feature_checklist.json` items 639–711.

Settings → Secrets is linked from the sidebar but has never worked in any environment. The
components exist and are tracked; the route, the tables, and the permission grants do not. This
plan restores the screen end to end and removes the mechanism that let the permission half go
missing.

---

## Current state (as read)

**Present and intact**

- `server/src/components/settings/secrets/SecretsManagement.tsx` (318 lines) — DataTable, search,
  delete-confirm-by-typing-name, workflow-usage warning.
- `server/src/components/settings/secrets/SecretDialog.tsx` (269 lines) — create/edit, name
  validation, masked value input.
- `packages/tenancy/src/actions/tenant-secret-actions.ts` — nine `withAuth` server actions with
  permission checks and a coded-error mapper.
- `shared/workflow/secrets/{index,types,tenantSecretProvider}.ts` — the provider. Reached from app
  code as `@alga-psa/workflows/secrets`, which resolves via `ee/packages/workflows/src/secrets.ts`
  (a one-line re-export) through the `@alga-psa/workflows/*` path mapping in `tsconfig.base.json`.
- `server/src/app/api/secrets/` — the external-automation route shims.
- Locale keys under `secrets.*` and `errors.secrets.*` in `server/public/locales/*/msp/settings.json`.
- `server/migrations/20251223145000_add_secrets_permissions.cjs` — declares `secrets.view`,
  `secrets.manage`, `secrets.use`.
- `settingsTabsRegistry.ts:46` declares the tab with `hasOwnRoute: true`;
  `menuConfig.ts:349` links the sidebar to `/msp/settings/secrets`.

**Missing**

1. **The route segment.** `server/src/app/msp/settings/secrets/page.tsx` has never existed in any
   commit on any branch. Commit `e04a918116` ("Split settings to route segments") created a
   `page.tsx` for every other `hasOwnRoute` tab and dropped this one — `.gitignore:179-180`
   (`secrets`, `secrets/`) silently excluded it. The sidebar link is dead.

2. **The tables.** `tenant_secrets` and `tenant_secrets_audit_log` are registered in
   `packages/db/src/lib/tenantTableMetadata.ts:497-498` and queried throughout
   `tenantSecretProvider.ts`, but **no migration creates them** and neither exists in a live
   database. Checklist items 640–642 are marked `implemented: true` and are not. This is why
   `tenant-secret-actions.ts:91` carries `if (!(await knex.schema.hasTable('tenant_secrets')))
   return []` — a guard that turns the entire feature into a silent empty list.

3. **The permission grants.** The permissions migration is recorded in `knex_migrations` but
   produced zero rows: it enumerates tenants at migration time, and migrations run against an empty
   database before the first tenant is seeded. Verified against a live database — the
   fullest-seeded tenant (224 permissions) has no `secrets.*` rows at all.

**Schema note.** The table to build is *not* the SQL in § 18.2.2. The implementation deliberately
diverged: values go to `ISecretProvider` at key `tenant-secrets/{tenantId}/{name}` and the row holds
`secret_provider_key` instead of `encrypted_value` / `encryption_key_id`. `TenantSecretModel` in
`shared/workflow/secrets/types.ts:44-56` is the contract of record.

### The permission-seeding defect is systemic

The permission catalog is hand-maintained in four places, and a new permission must land in all of
them:

| Source | Serves |
|---|---|
| 43 × `server/migrations/*_add_*_permissions.cjs` | tenants existing *at migration time* |
| `ee/server/seeds/onboarding/psa/02_permissions.cjs` + `03_role_permissions.cjs` | new PSA tenants |
| `ee/server/seeds/onboarding/algadesk/02_permissions.cjs` + `03_role_permissions.cjs` | new AlgaDesk tenants |
| `server/seeds/dev/47_permissions.cjs` + `48_role_permissions.cjs` | dev/test tenants |

Five repair migrations already exist for this exact failure —
`20260424200000_ensure_workflow_permissions_for_newer_tenants`,
`20260701120000_readd_interaction_permissions_for_seeded_tenants`,
`20260707120000_readd_inventory_permissions_for_seeded_tenants`,
`20260716130000_readd_cycle_count_permissions_for_seeded_tenants`,
`20260812090000_backfill_opportunity_permissions`. The header of the interaction one documents the
mechanism precisely and notes it shipped because it broke the Contacts page and the portal-invite
flow in production.

`ee/temporal-workflows/src/db/onboarding-seeds-operations.ts:22-27` already carries a
`// LEVERAGE: friction builtin-content-distribution` marker on this problem (issue #2989),
recording that the same seed files must silently satisfy three different invocation contracts and
that nothing enforces it. This work discharges the permissions slice of that marker.

Counting production call sites only (test files excluded), there are two distinct defect classes:

**Class A — seed drift (6).** A migration declares it; the PSA onboarding seed does not. Tenants
provisioned from onboarding seeds lack the grant.

| Permission | Declaring migration | Also missing from dev seed |
|---|---|---|
| `secrets.view` | `20251223145000_add_secrets_permissions` | yes |
| `secrets.manage` | `20251223145000_add_secrets_permissions` | yes |
| `priority.create` | `20250619120000_add_comprehensive_permissions` | yes |
| `quotes.approve` | `20260320105000_add_quote_approval_permission` | yes |
| `email.process` | `20260127120000_backfill_email_process_permission` | no |
| `job.delete` | `20260624120000_add_job_delete_permission` | no |

**Class B — never declared anywhere (11).** Enforced in production, present in no migration and no
seed, so the check fails for every tenant, always. There is no existing grant mapping to copy, so
each needs a role decision or deletion as dead code.

**Class B is out of scope for this card** — tracked as card
`63db81a4-76cf-4486-aca3-a09f7c02efb1`, "Grant or retire the 11 never-declared permissions", which
carries the full list, call sites, and a proposed grant table. It depends on the catalog this card
builds, so it runs second. Nothing in the secrets screen depends on it: `secrets.view` and
`secrets.manage` are Class A.

Class B still shapes one thing here — the catalog-coverage contract test in the Tests section
cannot pass while eleven enforced permissions are undeclared. It ships with those eleven in a
committed quarantine list pointing at that card; see the test description for the exact
requirement.

---

## Design decisions

Settled in the design session; each is a deliberate choice, not a default.

1. **The reconciler runs on the tenant-creation path only** — not at app boot, not per deploy.
   Existing tenants are reached by exactly one migration in this change that calls
   `reconcileAllTenants`. Consequence, accepted: adding a future permission still needs a
   migration, but it becomes a generic three-line `await reconcileAllTenants(knex)` rather than a
   hand-copied permission list. The duplication dies even though the migration does not.

2. **The catalog is additive with an explicit retirement list.** The reconciler only inserts
   missing rows. Removing a permission requires naming it in a `retired` list, which then deletes
   it and its `role_permissions`. A fully authoritative catalog was rejected: migrations declare
   202 pairs against the seed's 176, so a first authoritative run would delete real rows, including
   any permission a tenant added to a customised role.

3. **The screen guards on a durable write provider.** `SECRET_WRITE_PROVIDER` defaults to
   `filesystem`, which writes to `<SECRET_FS_BASE_PATH>/tenants/<tenant>/<NAME>`. On the appliance
   that path is a shared hostPath (PR #3264 gave Alga Core, email-service, and temporal-worker the
   same mount). On hosted, `sharedTenantSecrets.enabled` is `false` and `SECRET_FS_BASE_PATH` is
   unset, so the provider falls back to pod-local `/run/secrets` — a secret saved through the UI
   would be invisible to other replicas and to the workflow worker, and gone on restart.
   `helm/values.yaml:519-524` documents this same trap. Rather than ship a screen that silently
   discards secrets, the screen detects durability and renders read-only with an explicit notice
   when storage is not configured for the environment.

4. **Backfill covers Class A only.** Class B is eleven access decisions with no prior art to copy —
   who may export bulk data, read stored credentials, provision tenants. Those want deliberate
   review, not a guess buried in a migration, so they move to their own card
   (`63db81a4-76cf-4486-aca3-a09f7c02efb1`) rather than riding along here.

---

## Work items

### 1. Stop the gitignore from eating this work again

`.gitignore` lines 179–184 currently ignore `secrets` / `secrets/` and re-include three paths. Add
the route segment:

```
!server/src/app/msp/settings/secrets/
```

Verify with `git check-ignore -v server/src/app/msp/settings/secrets/page.tsx` (must report
nothing) and confirm `git status` shows the new file as untracked-and-addable **before** committing
anything else in this change. Every other item in this plan is worthless if the file cannot be
committed.

### 2. Create the route segment

`server/src/app/msp/settings/secrets/page.tsx`, following the exact shape of
`server/src/app/msp/settings/import-export/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import { SecretsManagement } from '@/components/settings/secrets';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('secrets');
}

export default function SecretsSettingsRoute() {
  return (
    <SettingsTab tabId="secrets">
      <SecretsManagement />
    </SettingsTab>
  );
}
```

No registry change is needed — `hasOwnRoute: true` is already set, and `SettingsTab` already
handles the product/edition/tier gating. `secrets` is absent from
`ALGA_DESK_ALLOWED_SETTINGS_TABS`, so AlgaDesk tenants are redirected to the settings home; that is
correct and stays.

### 3. Create the tables

New migration `server/migrations/<ts>_create_tenant_secrets.cjs`, following the conventions in
`20260701100000_create_vendor_bills.cjs`: `tenant` uuid first, composite primary key, composite
foreign keys, then `ensureTenantDistribution` from `./utils/citusDistribution.cjs`.

`tenant_secrets` — columns exactly as `TenantSecretModel`:

- `tenant` uuid not null
- `id` uuid not null default `gen_random_uuid()`
- `name` varchar(255) not null
- `description` text nullable
- `secret_provider_key` text not null
- `created_by` uuid not null, `updated_by` uuid not null
- `created_at`, `updated_at` timestamptz not null default `now()`
- `last_accessed_at` timestamptz nullable
- primary key `['tenant', 'id']`
- unique `['tenant', 'name']` (§ 18.2.2 requires uniqueness within tenant, and
  `provider.create()` relies on it)
- composite FKs `['tenant', 'created_by']` and `['tenant', 'updated_by']` → `users`
- index on `['tenant', 'name']`

`tenant_secrets_audit_log` — columns exactly as `TenantSecretAuditLogModel`:

- `tenant` uuid not null
- `id` uuid not null default `gen_random_uuid()`
- `secret_id` uuid nullable (nullable so delete events survive the row going away)
- `secret_name` varchar(255) not null
- `event_type` text not null, checked against `created|updated|deleted|accessed`
- `user_id` uuid nullable, `workflow_run_id` uuid nullable
- `context` jsonb nullable
- `created_at` timestamptz not null default `now()`
- primary key `['tenant', 'id']`
- index on `['tenant', 'secret_name']` and on `['tenant', 'created_at']`

Do **not** add a composite FK from `secret_id` to `tenant_secrets` — the provider writes a
`deleted` audit row for a secret it is removing in the same transaction, and audit history must
outlive the secret.

Defaults matter: `provider.create()` inserts without supplying `id`, `created_at`, or `updated_at`
and then reads them back via `.returning('*')`, so the column defaults must be present or create
returns nulls.

Then **remove the `hasTable` guard** at `tenant-secret-actions.ts:91`. It exists only because the
table never landed, and leaving it in place means a future migration failure degrades to a silently
empty screen instead of a visible error.

### 4. Extract the permission catalog

New `server/migrations/utils/permissionCatalog.cjs` — CommonJS so migrations can `require` it
without pulling the `@alga-psa/db` ESM package, matching the constraint already documented in
`20260701120000_readd_interaction_permissions_for_seeded_tenants.cjs`.

Exports:

- `PERMISSIONS` — array of `{ resource, action, msp, client, description }`.
- `ROLE_GRANTS` — map of role name → array of `resource.action` strings, per product where they
  differ (PSA vs AlgaDesk).
- `RETIRED` — array of `resource.action` the reconciler should actively delete, seeded from the
  existing removal/rename migrations (`20260424130000_rename_client_documents_permission_to_document`,
  `20260727120000_remove_orphan_credit_reconcile_permission`).
- `reconcileTenantPermissions(knex, tenant, productCode)` — idempotent: inserts any catalog
  permission missing for the tenant, inserts any missing `role_permissions` row for roles that
  exist, deletes anything in `RETIRED`. Never touches rows outside the catalog. Safe to re-run.
- `reconcileAllTenants(knex)` — enumerates tenants and calls the above for each.

Build the initial catalog contents by union of the three seed files and the 43 migrations, so it is
a faithful snapshot of intent rather than a rewrite. The extraction is mechanical; the union is
already ~237 pairs.

### 5. Wire the reconciler into tenant creation

Replace the hand-maintained permission lists with calls to the catalog, so the four sources become
one:

- `ee/server/seeds/onboarding/psa/02_permissions.cjs` and `03_role_permissions.cjs`
- `ee/server/seeds/onboarding/algadesk/02_permissions.cjs` and `03_role_permissions.cjs`
- `server/seeds/dev/47_permissions.cjs` and `48_role_permissions.cjs`

Each becomes a thin wrapper calling `reconcileTenantPermissions(knex, tenantId, productCode)`.
Preserve each seed's existing "no tenantId → seed all tenants" fallback, because
`onboarding-seeds-operations.ts` calls `seed(trx, tenantId)` per tenant while the appliance
bootstrap replays the same files ungated via `knex seed:run` with no tenantId. The LEVERAGE marker
at `onboarding-seeds-operations.ts:22` names all three contracts — the wrappers must keep
satisfying them.

Also check `ee/temporal-workflows/src/db/product-upgrade-operations.ts`, which re-runs onboarding
seeds on product upgrade: a PSA↔AlgaDesk change alters the applicable permission set, and the
reconciler must handle that transition rather than only adding.

Note: `scripts/seed-tenant-onboarding.cjs:33-35` references stale paths
(`ee/server/seeds/onboarding/01_roles.cjs`, without the `psa/` segment). Fix while here.

### 6. Backfill existing tenants

One migration `server/migrations/<ts>_reconcile_tenant_permissions.cjs`:

```js
const { reconcileAllTenants } = require('./utils/permissionCatalog.cjs');
exports.up = async (knex) => { await reconcileAllTenants(knex); };
exports.down = async () => { /* additive; nothing to undo */ };
```

This is the mechanism by which all Class A permissions — `secrets.view` and `secrets.manage`
included — reach existing tenants. The six Class A entries take their role grants from the
declaring migration named in the table above, so no new access decision is made here.

Class B is not touched by this card. Card `63db81a4-76cf-4486-aca3-a09f7c02efb1` adds those to the
catalog and re-runs the same `reconcileAllTenants` mechanism once its grant table is agreed — which
is the point of extracting the catalog: the second card is a data edit plus a three-line migration,
not another hand-written backfill.

### 7. Guard the screen on durable secret storage

New server action (alongside the existing ones in `tenant-secret-actions.ts`) returning the storage
posture — never the configuration values themselves:

```ts
{ writable: boolean; reason?: 'READ_ONLY_PROVIDER' | 'NO_DURABLE_PATH' }
```

Durable when `SECRET_WRITE_PROVIDER` is `vault`, or is `filesystem` **and** `SECRET_FS_BASE_PATH`
is explicitly set. Otherwise not durable — this exactly matches the failure `helm/values.yaml`
describes, and the appliance sets `SECRET_FS_BASE_PATH` while hosted does not.

In `SecretsManagement.tsx`, when not writable: keep the list rendering, disable the Create button
and the row Edit/Delete actions, and show a notice above the table. Reuse the existing
`msp/settings:errors.secrets.readOnly` key where it fits; add a distinct key for the
`NO_DURABLE_PATH` case, since "read-only provider" and "storage not configured for this
environment" are different operator problems. Add the new keys to `en` first and mirror to every
locale — `scripts/validate-translations.cjs` fails otherwise.

### 8. Fix the no-permission empty state

`listTenantSecrets` returns `[]` both when the tenant has no secrets and when the user lacks
`secrets.view`. A user without permission currently sees an ordinary empty table with a working
Create button that will fail on submit. Return a permission-denied signal and render the
appropriate message. This is small, but it is the difference between the screen being honest and
merely appearing to work.

### 9. Fix the write-ordering defects in the provider

A tenant secret lives in two stores: metadata in Postgres, the value in `ISecretProvider`
(filesystem or Vault). Only the Postgres half can participate in a transaction. All three mutating
methods in `tenantSecretProvider.ts` currently write the **external** store first, inside a
transaction that cannot cover it, so any database failure rolls back the half that can roll back
and leaves the half that cannot already changed.

**The governing rule for the fix:** never destroy or overwrite the external value while the
database half might still roll back. An orphaned value is recoverable; a lost value is not. So the
external write moves last in every path, and the failure mode is biased toward leaving an orphan.

**`create()` — `tenantSecretProvider.ts:148-183`.** Two defects. `exists()` runs outside the
transaction, so two concurrent creates of the same name can both pass the check; and the provider
write happens before the insert, so the loser of that race overwrites the winner's value before its
own row is rejected. A rollback also orphans the value.

Fix: drop the pre-check as a safety mechanism and let the `(tenant, name)` unique constraint from
item 3 arbitrate. Insert the metadata row **first** inside the transaction; only the winner reaches
the provider write. Map a `23505` unique violation to the existing
`Secret with name "..." already exists` message — `tenant-secret-actions.ts` already maps that code
to a localized string, so no new error plumbing is needed. Order becomes: insert row → provider
write → audit row → commit. A provider failure now rolls back cleanly with nothing written.

**`update()` — `tenantSecretProvider.ts:180-238`. The most serious of the three.** The new value is
written to the provider before the metadata update. If that update fails — including the case below
where a concurrent delete makes it fail — the transaction rolls back, but the **old value has
already been overwritten and is unrecoverable**. This is silent data loss, not an orphan.

Fix: move the metadata update ahead of the provider write inside the transaction, so the order is
update row → provider write → audit row → commit. If the provider write fails, the metadata rolls
back and the old value is untouched. If the commit fails after a successful provider write, the new
value is stored while `updated_at` / `updated_by` / `description` stay stale — a cosmetic
inconsistency, and strictly better than losing the secret.

**`delete()` — `tenantSecretProvider.ts:240-270`.** The value is deleted from the provider first. A
rollback leaves the row alive pointing at a value that no longer exists, and the next workflow to
resolve it fails at `getValue()` with `Secret value not found in provider`, recoverable only by
re-entering the secret by hand.

Fix: delete the row and write the audit row inside the transaction, commit, and delete from the
provider **after** the commit succeeds. A failure at that last step leaves an orphaned value with
no row — the same harmless class as create, and cleaned up by the next create of that name, which
overwrites the key.

**Also guard the concurrent-delete crash.** `update()` and `delete()` both read the existing row
outside the transaction. In `update()`, if a concurrent delete removes the row in between,
`.update().returning('*')` yields an empty array and the next line dereferences `row.id`, throwing
a `TypeError` rather than the intended `Secret with name "..." not found`. Check the returned row
and raise the proper error, which `tenant-secret-actions.ts` already maps to a localized message.

**Residual limitation, accepted and documented in code.** No ordering makes a two-store write
atomic. After these changes the only surviving failure mode is an orphaned value with no row, which
is inert, leaks nothing, and is overwritten by the next create of the same name. Add a brief
comment at each site saying so, so the ordering is not "tidied" back the other way later.

### 10. Hosted secret durability — resolved as a guard, not a fix

Item 7 is this plan's answer to hosted durability: the screen detects that storage is not durable
and refuses to accept writes it would lose, rather than appearing to work. That is deliberate. It
does **not** make tenant secrets usable on hosted — that needs `SECRET_WRITE_PROVIDER=vault` plus
Vault provisioning, per-tenant path policy, and hosted chart changes, none of which can be verified
from this worktree. Track that as a separate card; this plan's obligation is that hosted never
silently discards a secret, which item 7 discharges.

---

## Tests

**Migration**

- `tenant_secrets` and `tenant_secrets_audit_log` exist after migrate, with the composite primary
  keys, the `(tenant, name)` unique constraint, and the column defaults that `provider.create()`
  depends on.
- `provider.create()` → `list()` → `update()` → `delete()` round-trips against the real schema,
  and each writes the expected `tenant_secrets_audit_log` row.
- Deleting a secret leaves its audit history intact.

**Provider write ordering (item 9)** — each test forces a failure in one half and asserts the other
half is intact. Use a stub `ISecretProvider` and an injectable failure point:

- `create()` with a provider write that throws leaves **no** `tenant_secrets` row.
- `create()` with a database insert that throws never calls `setTenantSecret`.
- Two concurrent `create()` calls for the same name: exactly one succeeds, the loser surfaces
  `already exists`, and the winner's stored value is the one that survives.
- `update()` with a database failure leaves the **old value** readable through the provider — the
  regression test for the data-loss defect.
- `update()` with a provider write that throws leaves the metadata row unchanged.
- `update()` against a name deleted concurrently raises `not found`, not a `TypeError`.
- `delete()` with a database failure leaves the value still readable — the row and its value stay
  consistent with each other.
- `delete()` calls `deleteTenantSecret` only after the transaction commits.

**Permission catalog** — the highest-value tests here, because they are what stops the drift
recurring:

- A contract test asserting **every `hasPermission(resource, action)` pair reachable in production
  code exists in the catalog**. This is the test that would have caught all 17 gaps, and it fails
  today. Scan production sources only; exclude test files (`__tests__`, `.test.`, `.spec.`,
  `/test/`, `/e2e/`, `testing/`, mocks) — including them produces false hits such as
  `client.write` and `time_entry.read`, which appear only in fixtures.

  Ship it with a committed `KNOWN_UNDECLARED` quarantine list holding exactly the eleven Class B
  pairs, each annotated with card `63db81a4-76cf-4486-aca3-a09f7c02efb1`. The test must:
  - **fail** on any production pair that is neither in the catalog nor in the quarantine list —
    this is the guard that stops new drift, and it works from day one;
  - **fail** on any quarantine entry that no longer appears in production code, so the list cannot
    rot after a check is deleted;
  - state in its failure message that the correct fix is adding to the catalog, never extending the
    quarantine list.

  The quarantine list is debt made visible and countable, not an exemption. Card
  `63db81a4-76cf-4486-aca3-a09f7c02efb1` is complete when it is empty.
- `reconcileTenantPermissions` is idempotent: running twice produces the same rows and no
  duplicates.
- A tenant created with no permission rows ends up with the full catalog after reconcile.
- A tenant with a hand-added permission outside the catalog keeps it (additive guarantee).
- A permission in `RETIRED` is removed along with its `role_permissions` rows.
- The three onboarding/dev seed wrappers produce identical permission sets for the same product
  code.

**Screen**

- The route renders `SecretsManagement` inside `SettingsTab`, and `/msp/settings/secrets` no longer
  404s. Follow `server/src/test/unit/SettingsPage.experimentalFeatures.lazy.test.ts`, which already
  mocks `../../components/settings/secrets`.
- AlgaDesk product code redirects to the settings home.
- Not-writable posture disables Create/Edit/Delete and shows the notice; writable posture does not.
- A user without `secrets.view` sees the permission message, not an empty table with a live Create
  button.

**Regression guard**

- `git check-ignore` reports nothing for `server/src/app/msp/settings/secrets/page.tsx`. Worth
  asserting in CI given this is the second time the ignore rule has swallowed this feature.

---

## Sequencing

1. `.gitignore` negation, then the route segment — commit and confirm both are tracked before
   anything else.
2. `create_tenant_secrets` migration; drop the `hasTable` guard.
3. Extract `permissionCatalog.cjs` from the existing seeds and migrations.
4. Rewrite the six seed files as catalog wrappers; fix the stale paths in
   `scripts/seed-tenant-onboarding.cjs`.
5. `reconcile_tenant_permissions` migration, covering the six Class A permissions.
6. Provider write-ordering fixes (item 9). Do these **before** the screen goes live — once the
   route ships, users can reach `update()`, and that is the path that loses data.
7. Durability guard action, screen wiring, locale keys in every locale.
8. No-permission empty state.
9. Tests, with the catalog-coverage contract test first.

## Risks

- **The catalog extraction is the risky step.** It replaces six working seed files at once. Build
  the catalog and assert it reproduces each seed's current output *before* deleting any of the
  hand-maintained lists.
- **The quarantine list is the one place this card tolerates a known failure.** Eleven enforced
  permissions stay undeclared until card `63db81a4-76cf-4486-aca3-a09f7c02efb1` lands. That is a
  deliberate deferral, not an oversight — but it only stays honest if the contract test refuses to
  let the list grow. Review that test's failure behaviour as carefully as the catalog itself.
- **Citus distribution.** `ensureTenantDistribution` must run after table creation and before any
  composite foreign key that Citus would reject; `20260701100000_create_vendor_bills.cjs` shows the
  ordering and the `NO ACTION` degradation.
- **The provider is shared code.** `tenantSecretProvider.ts` is consumed by the workflow runtime
  (`workflow-runtime-v2-actions.ts`) and the workflow worker
  (`WorkflowRuntimeV2EventStreamWorker.ts`), not only by this screen. The item 9 reordering changes
  behaviour on failure paths for all three callers — for the better in every case, but the existing
  runtime tests must be re-run, not just the new ones.
- **i18n.** New keys must land in every locale file or `scripts/validate-translations.cjs` fails.
