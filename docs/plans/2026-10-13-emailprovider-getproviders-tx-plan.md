# EmailProviderService.getProviders: replace per-provider parallel pool reads with batched loads

- Ticket: alga-2026-0002700
- Scan finding: `db-query-outside-transaction` / `unbounded_parallel_pool_queries`. Fingerprint: `services/email/EmailProviderService.ts#EmailProviderService.getProviders`
- Base: `d6dc22c273`

## Problem (confirmed by reading the code)

`server/src/services/email/EmailProviderService.ts:70-115` (`getProviders`):

1. `:72` `getDb()` (`:53-56`) returns the pool `knex` from `createTenantKnex()`. No transaction is opened.
2. `:73-88` runs one list query on `email_providers`. The only fixed filter is the tenant, so the list has no size bound.
3. `:91-108` runs `Promise.all(providers.map(...))`. For each provider it builds a new `tenantDb(db, provider.tenant)` facade (`:92`) and runs `.first()` against `google_` / `microsoft_` / `imap_email_provider_config` (`:94-105`). That is N concurrent pool queries, so one call can check out up to N connections at once.

`packages/integrations/src/services/email/EmailProviderService.ts:93-142` has the same shape. The only differences are that `getDb(tenant)` takes the tenant and `scopedDb` is already built at `:96`.

Every vendor-config table has primary key `(email_provider_id, tenant)`:
- `server/migrations/20250714081528_create_vendor_email_config_tables.cjs:34,81`
- `server/migrations/20251226121000_create_imap_email_provider_config.cjs:46`

Each table is registered `scope: 'tenant'` in `packages/db/src/lib/tenantTableMetadata.ts:244,251,313`. So a provider has at most one config row, a `whereIn` lookup gives the same answer as the current `.first()`, and `scopedDb.table(...)` already applies the tenant predicate.

## Decision

**Load the vendor configs in batches, one query at a time, on a single facade. Do not add a transaction.**

- The defect is the unbounded fan-out. Removing it fixes the problem directly: the method goes from N+1 queries (N of them concurrent) to at most 4 queries run one after another, so it never holds more than one connection at a time.
- A transaction wouldn't add a real guarantee here. This is a read-only listing for display and polling, and the current code also reads the provider row and its config row at different moments. Wrapping four short reads in `withTransaction` would hold one connection across all four round trips and would add BEGIN/COMMIT through PgBouncer, with nothing to show for it. The lens question is about parallel pool fan-out, and the batched version has none.
- Run the three vendor queries one after another, not in `Promise.all`. A bounded fan-out of 3 would still check out 3 connections for no real latency gain, since each query is an indexed PK-prefix lookup.
- Skip a vendor query when no provider of that type is in the result. A `providerType` filter or a single-vendor tenant then costs 2 queries instead of 4, and an empty list costs 1.

## Changes

### 1. `server/src/services/email/EmailProviderService.ts`

- `:72-73`: build the facade once: `const scopedDb = tenantDb(db, filters.tenant);` and run the list query on it, using the same layout as the package copy.
- Add a private helper on the class, placed next to `mapCurrentDbRowToProvider` (`:521`):

  ```ts
  // LEVERAGE: pattern provider-vendor-config-load — same per-type vendor-config
  // loader in server + packages/integrations EmailProviderService and the three
  // CalendarProviderService copies; candidate for a shared batched loader.
  private async loadVendorConfigsByProviderId(
    scopedDb: TenantDb,
    providers: Array<{ id: string; provider_type: string }>
  ): Promise<Map<string, any>> {
    const tables = {
      google: 'google_email_provider_config',
      microsoft: 'microsoft_email_provider_config',
      imap: 'imap_email_provider_config',
    } as const;
    const byId = new Map<string, any>();
    for (const [type, table] of Object.entries(tables)) {
      const ids = providers.filter(p => p.provider_type === type).map(p => p.id);
      if (ids.length === 0) continue;
      const rows = await scopedDb.table(table).whereIn('email_provider_id', ids); // sequential by design
      for (const row of rows) byId.set(row.email_provider_id, row);
    }
    return byId;
  }
  ```

  Import `type TenantDb` from `@alga-psa/db`. Check that it is exported from `packages/db/src/index.ts`, and if it isn't, type the parameter as `ReturnType<typeof tenantDb>`.
- Replace `:90-108` with:

  ```ts
  const configs = await this.loadVendorConfigsByProviderId(scopedDb, providers);
  return providers.map(p => this.mapCurrentDbRowToProvider(p, configs.get(p.id) ?? null));
  ```

  Keep the current semantics. Order follows the `created_at desc` list query. An unknown `provider_type` or a missing config row maps with `vendorConfig = null`, as it does today (`provider_config: {}` via `:546`).
- Leave the `try/catch` and its error message (`:109-113`) unchanged.

### 2. `packages/integrations/src/services/email/EmailProviderService.ts`

Make the same change. `scopedDb` already exists at `:96`. Add the same helper next to `mapCurrentDbRowToProvider` (`:565`) and replace `:116-135`. The `where('email_provider_id', …)` style is not significant here. Use `whereIn` the same way in both copies.

### 3. Tests

- Add `server/src/test/integration/emailProviderGetProviders.integration.test.ts`. Follow the setup in `emailProviderValidation.test.ts`, which already calls `getProviders` at `:290`. Seed one tenant with 2 Google providers, 2 Microsoft providers, 1 IMAP provider and 1 Google provider with no config row. Assert:
  - every provider comes back in `created_at desc` order, and each `provider_config` holds its own row (match on `email_provider_id` and on a distinguishing column such as `client_id`)
  - `webhook_subscription_id` and `webhook_verification_token` come through for Microsoft
  - the provider with no config row gets `provider_config: {}`
  - `providerType: 'imap'` returns only the IMAP provider
  - a second tenant's providers and configs never show up (tenant isolation)
  - query count: wrap the run with a knex `query` event listener on the test connection and assert at most 4 queries for the mixed set and 2 for `providerType: 'google'`. This test guards against the fan-out coming back.
- Run the existing suites that touch `getProviders` or provider mapping: `emailProviderValidation`, `emailProviderIntegration`, `googleProviderDataPersistence`, `microsoftEmailSameAppUpdate.integration`, and `packages/integrations/src/actions/email-actions/inboundPauseActions.test.ts`.

## Order of work

1. Server copy: helper, call-site swap, facade hoist.
2. Package copy: the same edit.
3. New integration test, then the existing suites.
4. Typecheck the touched workspaces (`server`, `packages/integrations`).
5. Re-run the lens (`scan-clean`) on the fingerprint. If the package copy carries its own fingerprint, it should come back clean too.

## Out of scope

- `getProvider` (single provider, `server :120-150`, `packages :147-176`). It runs one config lookup per call with no fan-out. If a shared loader is extracted later, it could reuse the helper with a one-element list, but that is not needed for this card.
- The `CalendarProviderService` copies (`server/src/services/calendar`, `packages/integrations/src/services/calendar`, `ee/packages/calendar/src/lib/services/calendar`). The same pattern is tracked on alga-2026-0002699. The LEVERAGE marker records the duplication.
- Extracting a shared vendor-config loader layer across the email and calendar services. The marker is placed so the `leverage` pass can count the copies, and the extraction is left for that pass.
- `getEmailProviderConfigs` (`server :567-570`) passing `Partial` filters through with an unchecked cast. It has no callers outside this file today. It is a separate typing defect, and this fix bounds query count no matter how the filters are set.
- Create, update and delete transactionality (alga-2026-0002694).

## Risks

- **Large `whereIn` lists.** The ids belong to one tenant's mailboxes, which number in the tens at most. Postgres handles thousands of bind parameters without trouble. No chunking is needed.
- **Duplicate config rows overwriting each other in the Map.** The `(email_provider_id, tenant)` primary key rules this out.
- **Behaviour drift in the mapping.** The mapper is unchanged and gets the same row or `null`. The integration test checks per-provider row matching, so a mix-up between providers would fail it.
- **Citus.** All vendor tables are tenant-scoped and the facade adds the `tenant =` predicate, so each batched query still routes to one shard.
- **Scan-clean still firing** because the lens wants an explicit transaction. The lens question is fan-out, and the new code has none. If it still fires, dispute it, citing the sequential loop and the 4-query bound, rather than adding a transaction that serves no purpose.
