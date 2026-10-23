# EmailProviderService.createProvider: wrap related writes in one transaction

- Card: 6d38b3c6-6032-4a37-9d5e-2e8360a1195d (scan lens `db-query-outside-transaction` v1)
- Finding fingerprint: `services/email/EmailProviderService.ts#EmailProviderService.createProvider`
- Ticket: alga-2026-0002694
- Base: `d6dc22c273`

## Verdict on the finding: real

The finding is about the **server** copy, `server/src/services/email/EmailProviderService.ts`. Its `getDb()` takes no tenant (lines 53-56), and that copy is the one `EmailProviderAutoWiring.ts` imports.

`createProvider` (lines 159-232) does the following:

1. `getDb()` returns the shared pool `knex` (line 161).
2. It inserts the `email_providers` row through `tenantDb(db, data.tenant)` with `status: 'configuring'` (lines 164-176). This commits on its own.
3. It inserts the vendor row into `google_` / `microsoft_` / `imap_email_provider_config` through a second `tenantDb(db, …)` on the same pool (lines 179-219). Each statement autocommits.
4. `this.getProvider(provider.id)` calls `createTenantKnex()` again and runs two more pool reads (line 224).

No transaction exists, and none can be passed in.

The orphan this causes isn't hypothetical. Two in-tree paths make step 3 fail on every call, after step 1 has already committed:

- **IMAP:** the server copy's `imap_email_provider_config` insert (lines 210-217) leaves out `tenant`. `tenantDb(...).table()` adds a `WHERE tenant = ?` to the builder, but that does nothing for an INSERT. The column is `notNullable()` (`server/migrations/20251226121000_create_imap_email_provider_config.cjs:8`), so every IMAP create through this copy leaves behind an orphaned `configuring` provider.
- **AutoWiring:** `EmailProviderAutoWiring.ts:86-97` and `:182-199` pass camelCase `vendorConfig` keys (`clientId`, `accessToken`, `labelFilters`, …). The config tables use snake_case columns, so the vendor insert throws and the parent row is left behind. AutoWiring currently has no importers outside its own file (it's dead code), but the hazard comes from the service, not the caller.

The twin file `packages/integrations/src/services/email/EmailProviderService.ts` has the same shape at lines 185-259 (`createProvider`). It does include `tenant` in the IMAP insert, and its `getProvider` takes `(providerId, tenant)`.

## Decisions

1. **Use `withTransaction(knex, async (trx) => …)` from `@alga-psa/db`, the pattern in `docs/AI_coding_standards.md:420-433`.** Inside it, bind `const db = tenantDb(trx, data.tenant)` once, and build `raw`/`fn.now()` from `trx`, not the pool handle. `withTransaction` already handles a nested trx: if it's handed a `Knex.Transaction` it reuses it and doesn't own the commit (`packages/db/src/lib/tenant.ts:196-205`).
2. **Accept an optional caller transaction: `createProvider(data, knexOrTrx?: Knex | Knex.Transaction)`.** Without one, the service opens its own transaction on `getDb()`. With one, it joins the caller's transaction. This clears the "or passed in" half of the lens check and lets a future caller create a provider atomically with its own writes. Existing call sites don't change.
3. **Build the result from the two `.returning('*')` rows; don't re-query.** Add `.returning('*')` to the vendor insert and return `this.mapCurrentDbRowToProvider(providerRow, vendorRow ?? null)`. This gives the same output as `getProvider`: both read the same columns, and pg parses jsonb the same way on `RETURNING` as on `SELECT`. It drops two reads, the second `createTenantKnex()`, and the unreachable "Failed to fetch created provider" branch. It also avoids reading back through `getProvider`'s `unscoped` tenant-discovery path inside the write transaction, so `getProvider` stays unchanged.
4. **Log after commit.** The `✅ Created email provider` `console.log` moves after `withTransaction` resolves, so it only fires for rows that actually committed. `createProvider` has no other side effects to defer.
5. **Fix the missing `tenant` on the server copy's IMAP insert in the same change.** It's a one-key, obviously correct fix that matches the twin. Without it, the transaction only turns "IMAP create leaves an orphan" into "IMAP create always fails cleanly".
6. **Apply the same transaction treatment to the twin `packages/integrations/.../createProvider`.** It has the identical defect, and the next scan would flag it under the other path. Its signature becomes `createProvider(data, knexOrTrx?)` in the same way.
7. **Keep the error contract.** The outer `try/catch` still re-throws `Failed to create email provider: <msg>`. A rollback happens before the catch sees the error.

## Changes, in order

### 1. `server/src/services/email/EmailProviderService.ts`

- Imports (lines 6-7): `import { tenantDb, withTransaction } from '@alga-psa/db';` and `import type { Knex } from 'knex';`. Keep `createTenantKnex` from `../../lib/db`, because the integration tests mock that module (`googleProviderDataPersistence.test.ts:34-39`), so `getDb()` has to go through it.
- `createProvider` (lines 159-232) becomes:
  ```ts
  async createProvider(
    data: CreateProviderData,
    knexOrTrx?: Knex | Knex.Transaction
  ): Promise<EmailProviderConfig> {
    try {
      const conn = knexOrTrx ?? (await this.getDb());
      const created = await withTransaction(conn, async (trx) => {
        const db = tenantDb(trx, data.tenant);
        const [providerRow] = await db.table('email_providers')
          .insert({ id: trx.raw('gen_random_uuid()'), tenant: data.tenant, …, status: 'configuring',
                    created_at: trx.fn.now(), updated_at: trx.fn.now() })
          .returning('*');
        const vendorRow = await this.insertVendorConfig(db, trx, providerRow.id, data);
        return this.mapCurrentDbRowToProvider(providerRow, vendorRow);
      });
      console.log(`✅ Created email provider: ${created.name} (${created.id})`);
      return created;
    } catch (error: any) { /* unchanged */ }
  }
  ```
- Add a private `insertVendorConfig(db: TenantDb, trx: Knex.Transaction, providerId: string, data: CreateProviderData): Promise<any | null>`. It takes the three existing branches as they are (same `label_filters` / `folder_filters` JSON stringification), with `tenant: data.tenant` added to the IMAP branch. Each branch does `.insert({...}).returning('*')` and returns row `[0]`. An unknown `providerType` returns `null`, which matches what `getProvider` does today. `TenantDb` is the return type of `tenantDb`. Import the type if `@alga-psa/db` exports it, otherwise use `ReturnType<typeof tenantDb>`.
- Leave `updateProvider`, `getProvider` and every other method alone (see Out of scope).

### 2. `packages/integrations/src/services/email/EmailProviderService.ts`

- Make the same change to `createProvider` (lines 185-259): optional `knexOrTrx`, `withTransaction`, `tenantDb(trx, data.tenant)`, `trx.raw`/`trx.fn.now()`, a vendor insert with `.returning('*')` through the same private helper shape, map from the returned rows, and the log after commit. `getDb(tenant)` stays the default connection source.
- Drop `// LEVERAGE: pattern email-provider-service-twin — server/ and packages/integrations/ carry diverging copies of EmailProviderService; the create/update/vendor-config logic has drifted (missing IMAP tenant, Microsoft column allowlist only in packages)` at the top of the class in **both** files. Don't merge the copies on this card.

### 3. Tests

Use the real-DB integration harness that already mocks `createTenantKnex` to `testDb` (`server/src/test/integration/googleProviderDataPersistence.test.ts`). `withTransaction(testDb, …)` opens a real transaction on it.

- **New (server copy) `rolls back the email_providers row when the vendor config insert fails`:** call `createProvider` with `providerType: 'google'` and a `vendorConfig` that contains a nonexistent column (`{ ...validGoogleConfig, not_a_column: 'x' }`). Expect it to reject with `/Failed to create email provider/`. Then assert that `tenantTable('email_providers').where({ mailbox })` returns **0 rows**. This test fails on the base commit.
- **New (server copy) `creates an IMAP provider with its config row`:** a valid IMAP `vendorConfig` produces one `email_providers` row and one `imap_email_provider_config` row with the correct `tenant`. The result's `provider_config` has to match the row. This test fails on the base commit (NOT NULL `tenant`).
- **New `joins a caller transaction`:** call `testDb.transaction(async trx => { await service.createProvider(data, trx); throw sentinel; })`, then assert that no `email_providers` row survives. This proves the caller's transaction controls the commit.
- **Existing:** `googleProviderDataPersistence.test.ts` (create/update/OAuth cases) and `emailProviderValidation.test.ts` / `emailProviderErrorMessages.test.ts` (which create real providers) must still pass. They cover return-shape parity between the old `getProvider` read-back and the new mapping from returned rows.
- **packages twin:** if `packages/integrations` has a DB-backed test for `createProvider`, extend it with the rollback case. If it doesn't, add the rollback case next to `microsoftEmailSameAppUpdate.integration.test.ts`, which already imports the packages copy.
- Run `npx tsc --noEmit` for `server` and `packages/integrations`, then run the affected vitest files.

### 4. Acceptance

- `scan-clean` re-runs the lens on `server/src/services/email/EmailProviderService.ts#EmailProviderService.createProvider`. It should no longer fire: the writes run on a single `trx`, and a transaction can be passed in.

## Out of scope

- **`updateProvider` in both copies** (server lines 237-319, packages 264-366) has the same multi-write-without-transaction shape. It also runs a read-modify-write through `getProvider`. Making it transactional changes `getProvider`'s signature in both copies and touches the Microsoft column allowlist that only the packages copy has. Recommend a follow-up scan card. Don't fold it in here.
- `initializeProviderWebhook`'s sequence of `updateProvider` + `updateProviderStatus`: it interleaves external API calls, so it needs compensation, not a database transaction.
- Fixing AutoWiring's camelCase `vendorConfig` keys, or deleting the dead `EmailProviderAutoWiring.ts`. This is worth a separate card. After this change it fails cleanly instead of leaving an orphan.
- Merging the server and packages copies of `EmailProviderService` (only flagged with the LEVERAGE marker).
- Cleaning up orphaned `configuring` rows already in production. If someone wants this, a one-off query for `email_providers` rows with no matching config row is a separate ops task.

## Risks

- **Return-shape drift:** `RETURNING *` and `SELECT … first()` return the same columns and the same pg type parsing, so `mapCurrentDbRowToProvider` sees identical input. The one difference is defaults that the DB fills after insert, which `RETURNING` reflects anyway. The existing persistence tests assert the returned config fields and act as the guard.
- **Citus:** the parent and child rows share the `tenant` distribution column, so the transaction stays on a single shard group. Nothing changes compared with how other `withTransaction` + `tenantDb` multi-table inserts behave today.
- **Nested transaction semantics:** when a caller passes a transaction, the rollback from a vendor-insert failure belongs to the caller. `createProvider` re-throws, so the caller's transaction aborts as expected. This is documented in the JSDoc on the new parameter.
- **Mocked unit tests** (`emailProviderIntegration.test.ts`) mock the whole service and aren't affected. `toHaveBeenCalledWith(newProvider)` still matches because the new parameter is optional and omitted.
