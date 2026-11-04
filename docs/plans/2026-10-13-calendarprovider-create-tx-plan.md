# CalendarProviderService: make provider writes atomic

Ticket: alga-2026-0002702 · Scan finding: `db-query-outside-transaction` / `related_writes_without_transaction`
Fingerprint: `services/calendar/CalendarProviderService.ts#CalendarProviderService.createProvider`
Base: `d6dc22c273`

## The defect (confirmed)

`createProvider` writes a `calendar_providers` row, then encrypts the vendor
config, then writes a `google_calendar_provider_config` /
`microsoft_calendar_provider_config` row. Every step runs on the pool handle
from `getDb()` → `createTenantKnex()`, so each insert autocommits on its own.
If encryption fails (for example, the `CALENDAR_OAUTH_ENCRYPTION_KEY` secret
can't be read) or the vendor insert fails (bad value, pool timeout), the
provider row stays behind with `status = 'configuring'` and no credentials.
The catch block only logs and rethrows.

That leftover row then blocks the user from trying again. The connect flow
(`ee/packages/calendar/src/lib/actions/integrations/calendarActions.ts:288`)
hits `calendar_providers_tenant_user_provider_unique` on the retry and falls
into its "existing provider" recovery path, which hands back a provider that
has no credentials.

The same partial-write problem also exists in two sibling methods of the class:

- `updateProvider`: it updates `calendar_providers` first, and only then
  encrypts and writes the vendor row. It can also throw `vendor configuration
  is missing required credentials` *after* the main update has already
  committed.
- `deleteProvider`: it runs three to four separate deletes (vendor config →
  `calendar_event_mappings` → `calendar_providers`). If it fails partway, the
  provider is left without its config or mappings.

## Where the code lives (three copies, kept in step)

| Copy | Role | createProvider | updateProvider | deleteProvider |
|---|---|---|---|---|
| `server/src/services/calendar/CalendarProviderService.ts` | **The scan subject** (imports at :6-11, method at :230). Re-exported by `server/src/services/CalendarProviderService.ts`; used by `server/src/services/calendar/*` and `CalendarProviderEncryption.test.ts` | :230-295 | :300-398 | :444-490 |
| `ee/packages/calendar/src/lib/services/calendar/CalendarProviderService.ts` | **Live runtime**: `calendarActions.ts:288`, the OAuth callbacks, sync/webhook services, `scripts/calendar-fixtures/provision.ts` | :229-294 | :299-397 | :443-489 |
| `packages/integrations/src/services/calendar/CalendarProviderService.ts` | Legacy shared copy (`@ts-nocheck`, `getDb(tenant)`). Used by the integrations adapters and `MicrosoftCalendarAdapter.sharedCalendar.test.ts` | :231-296 | :301-399 | :435-~481 |

**Decision:** apply the same change to all three. The method bodies are
byte-identical apart from `getDb()` / `getDb(tenant)` and the import lines.
The repo already has a convention of keeping the calendar copies aligned
(`// LEVERAGE: pattern calendar-sync-dual-copy` in
`packages/integrations/src/services/calendar/CalendarSyncService.ts:2`).
Fixing only the scan subject would leave the defect in the copy that actually
runs in production, and `scan-clean` would flag the twins on the next run
because the path suffix matches all three.

## Changes

### 1. Imports (each copy)
Add `withTransaction` to the existing `@alga-psa/db` import. This is the same
pattern `server/src/services/calendar/CalendarSyncService.ts:7` already uses.
- server: `:8` `import { tenantDb, withTransaction } from '@alga-psa/db';`
- ee: `:8` `import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';`
- integrations: `:10` same as ee.

### 2. `createProvider`: prepare first, then two inserts in one transaction
New order inside the existing `try`:
1. Before touching the DB, call `prepareVendorConfigForStorage(data.providerType, data.vendorConfig)`
   and `hasRequiredVendorFields(...)`. Both are pure or secret-only and have
   no DB effect.
2. `const knex = await this.getDb()` (or `getDb(data.tenant)` in integrations).
3. `const providerId = await withTransaction(knex, async (trx) => { const db = tenantDb(trx, data.tenant); … })`:
   - insert `calendar_providers` with exactly the same column set, using
     `trx.raw('gen_random_uuid()')` and `trx.fn.now()`, `.returning('*')`.
   - log the "Skipping vendor config insert … provider ${provider.id}" warning
     here, so it can still include the id.
   - when `vendorHasRequiredFields`, insert the vendor row through the same
     `db` facade.
   - return `provider.id`.
4. After commit, log `✅ Created…` and call
   `getProvider(providerId, data.tenant, { includeSecrets: false })` exactly
   as today. Keep the post-commit read. It goes through
   `buildProviderConfig`/`getVendorConfig`, so the response shape stays
   identical, and rebuilding the result from the returned rows would
   duplicate that mapping.
5. The catch block and its `Failed to create calendar provider: ${message}`
   wrapper stay unchanged. The underlying Postgres message (with the
   constraint name) still comes through, so the unique-violation recovery
   in `calendarActions.ts:301-305` keeps working.

### 3. `updateProvider`: same shape
1. Keep the `getProvider(providerId, tenant)` existence/tenant check before
   the transaction. It is a read, and it needs `provider_type`.
2. Before any write, compute `mainUpdateData` (minus `updated_at`). If
   `data.vendorConfig !== undefined`, also compute `vendorUpdate`,
   `normalizedVendorConfig` and `vendorTable` (prep/encryption hoisted).
3. Run in one `withTransaction(knex, async (trx) => …)` with `db = tenantDb(trx, tenant)`:
   main `update` (with `updated_at: trx.fn.now()`); vendor `first()` lookup;
   then update, insert, or the "missing required credentials" throw. The
   throw now happens inside the transaction, so it rolls back the main
   update.
4. After commit, run the `getProvider(..., { includeSecrets: false })` re-read
   and the log, as today.

### 4. `deleteProvider`: wrap the delete chain
Put the provider lookup, the vendor-config delete, the
`calendar_event_mappings` delete and the `calendar_providers` delete (plus
its `deleted === 0` check) in one `withTransaction` on `tenantDb(trx, tenant)`.
Today the code mixes `provider.tenant` and `tenant` across these calls. Use
`tenant` throughout: the lookup is already scoped by `tenant`, so the two
values are equal.

### 5. Untouched
`updateProviderStatus` does a tenant-discovery read and then a single update,
so there are no related writes and nothing to wrap. Leave `getProviders`,
`getProvider` and the encryption helpers as they are.

## Ordering of work
1. ee copy (the live one) → 2. server copy (the scan subject) → 3. integrations
copy. Each copy is a mechanical repeat of the previous diff.
4. Tests (below). 5. Run `alga-dev scan` on the fingerprint (`scan-clean`).

## Tests
- **New integration test**
  `server/src/test/integration/calendar/calendarProviderTransactions.integration.test.ts`,
  against the ee copy (the live runtime). It uses the same DB fixture /
  `createTenantKnex` mock pattern as `sharedCalendarSyncAccess.integration.test.ts:40-43`,
  with the mock returning the pool db, **not** a wrapping trx, so that
  rollback is observable. Cases:
  1. Encryption failure: `vi.spyOn(service as any, 'encryptVendorConfig').mockRejectedValue(...)`.
     `createProvider` rejects, and the tenant has zero `calendar_providers` rows.
  2. Vendor insert failure: a Microsoft vendor config with every required
     field plus `tokenExpiresAt: 'not-a-timestamp'` (the column is
     `timestamp`, per `server/migrations/20251104120005_…:55`). It rejects;
     zero `calendar_providers` rows and zero vendor rows. If the normalizer
     coerces or drops the value, fall back to spying the vendor insert
     through a one-shot `tenantDb` wrapper.
  3. Happy path: Google and Microsoft each produce one provider row and one
     vendor row, and the returned `CalendarProviderConfig` matches what it
     was before the change.
  4. `updateProvider` with a vendor config that is missing required
     credentials, where no vendor row exists yet: it rejects and
     `provider_name` is unchanged.
  5. `deleteProvider` happy path: no provider, vendor or mapping rows remain.
- **Existing tests that must stay green:**
  `server/src/test/unit/calendar/CalendarProviderEncryption.test.ts`,
  `MicrosoftCalendarAdapter.sharedCalendar.test.ts`, and
  `sharedCalendarSyncAccess.integration.test.ts`. In that last one,
  `createTenantKnex` returns `fixture.trx`, and `withTransaction` on a trx
  reuses it (`packages/db/src/lib/tenant.ts:191-199`), so its rollback
  isolation still holds.
- Typecheck the ee/server packages (the integrations copy is `@ts-nocheck`).

## Out of scope
- Removing the three-way duplication. I'll leave a
  `// LEVERAGE: pattern calendar-provider-service-triplicate` marker on each
  copy's class header. Collapsing the copies into one is its own card.
- Changing the result to build from returned rows instead of re-reading via
  `getProvider`.
- The deprecated `createTenantKnex` → `runWithTenant` migration.
- `EmailProviderService.createProvider`, which has the same pattern and is
  tracked separately as alga-2026-0002694.
- Cleaning up providers already orphaned in `configuring` in existing
  tenants. That needs a data audit, not a code change. Worth noting on the
  ticket.

## Risks
- **Encryption-key lookup moves before the first write.** The work is the
  same, only the order changes. A missing key now fails with no row written,
  which is the intent.
- **Transaction held across the network:** none. Encryption and secret
  lookups happen before the transaction opens, so it only spans the two or
  three local statements.
- **Citus:** all statements in each transaction hit tables distributed by
  `tenant` with the same tenant value, so every transaction stays on a
  single shard. That is safe.
- **Error-message contract:** the `Failed to … calendar provider:` prefix and
  the inner Postgres text are preserved, so callers that match on the
  constraint name are unaffected.
- **Test mocks returning a trx from `createTenantKnex`:** nested
  `withTransaction` reuses the caller's transaction, so behaviour is the
  same.
