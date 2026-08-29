# Plan: Saving a maintenance record is broken

**Card:** 2db0e38c-093c-4ef9-90d4-48f2494716a6
**Branch:** feature/saving-a-maintenance-record-is-broken
**Date:** 2026-08-25

## Symptom

Saving / loading asset maintenance records fails. The maintenance-occurrence
listing query (join across `asset_maintenance_occurrences o`,
`asset_maintenance_schedules s`, `asset_maintenance_history h`, plus users/assets)
aborts with:

```
error: ... unrecognized configuration parameter "app.current_tenant"
```

## Root cause

The Row-Level-Security policies on the maintenance tables read the tenant GUC with
the **non-`missing_ok`** form of `current_setting`:

```sql
USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT)
```

Postgres raises `unrecognized configuration parameter "app.current_tenant"` when
that GUC has never been set in the session. The application deliberately does **not**
set `app.current_tenant` per-connection — see `packages/db/src/lib/knexfile.ts`
(`afterCreate`: "No need to set app.current_tenant session variable"), because
production relies on Citus shard-level isolation. As a result, any RLS policy using
the bare `current_setting('app.current_tenant')` throws the moment the policy is
evaluated for the app role.

The newly-added occurrences table makes this reachable:

- `server/migrations/20260822233548_add_asset_maintenance_occurrences.cjs:51-52`
  runs `ENABLE ROW LEVEL SECURITY` and creates a policy with the unsafe form.
- The sibling maintenance tables share the same unsafe form:
  `server/migrations/20241112031334_create_maintenance_scheduling.cjs:84-91`
  (`asset_maintenance_schedules`, `asset_maintenance_notifications`,
  `asset_maintenance_history`).

The safe pattern already exists in the codebase and must be used instead:

- `current_setting('app.current_tenant', true)` (returns NULL instead of raising), or
- the `get_current_tenant_id()` helper
  (`server/migrations/20241223132500_update_get_current_tenant_id.cjs`) which already
  swallows the missing-GUC case and returns NULL.

## Fix

Add a new forward migration that recreates the tenant-isolation policies on the
maintenance tables using the missing-safe form. Cover all four tables that
currently use the unsafe expression:

1. `asset_maintenance_occurrences`
2. `asset_maintenance_schedules`
3. `asset_maintenance_notifications`
4. `asset_maintenance_history`

For each: `DROP POLICY IF EXISTS tenant_isolation_policy ...` then
`CREATE POLICY ... USING (tenant::TEXT = current_setting('app.current_tenant', true)::TEXT)`.
(Keep the existing expression shape; only add the `, true` missing_ok argument so
behavior under Citus is unchanged.) Provide a `down` that restores the prior form.

### Migration constraints (Citus)

- Recreating policies on a distributed table can hit the "cannot execute multiple
  utility events" limitation — issue one `DROP POLICY` / `CREATE POLICY` per
  `knex.raw` call, mirroring the pattern already used in the occurrences migration.
- Do not re-run `ENABLE ROW LEVEL SECURITY` (already enabled); only swap the policy
  bodies.

## Scope decision

Fix the maintenance tables in this card (they are the reachable regression). A
broader sweep of the remaining ~25 migrations that still use the bare
`current_setting('app.current_tenant')` form is a separate hardening task and is
noted, not done here, to keep the fix focused. Flag for follow-up card.

## Verification

1. Reproduce on the dev stack (port 3283): open the asset maintenance view /
   save a maintenance record → observe the `app.current_tenant` error before the fix.
2. Run the new migration.
3. Repeat the flow: listing loads and saving succeeds with no GUC error.
4. Confirm cross-tenant isolation still holds (query returns only the current
   tenant's rows) — under Citus the shard isolation plus policy remain intact;
   under a single-node/local DB the policy now evaluates to NULL match (no cross-
   tenant leakage because queries are already tenant-scoped in `assetActions.ts`
   via `tenantScopedTable` / composite tenant keys).

## Touched files (expected)

- `server/migrations/<ts>_fix_maintenance_rls_missing_ok.cjs` (new)
- No application-code change expected; `packages/assets/src/actions/assetActions.ts`
  already scopes every maintenance query by tenant.

## Risks

- Low. The change only relaxes an error-raising GUC read to a NULL-returning one,
  matching the established `get_current_tenant_id()` semantics. Production Citus
  isolation is unaffected.
