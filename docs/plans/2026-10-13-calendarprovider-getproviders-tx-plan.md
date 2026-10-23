# CalendarProviderService.getProviders: remove the per-row vendor-config fan-out

- Card: 4539169f-54c1-4117-a623-aa990002a5e8 · PSA ticket alga-2026-0002699
- Scan finding: `db-query-outside-transaction` / `unbounded_parallel_pool_queries`. The fingerprint is
  `services/calendar/CalendarProviderService.ts#CalendarProviderService.getProviders` (the scan root
  is `server/src`, so the file is `server/src/services/calendar/CalendarProviderService.ts:144-184`).
- Base: `d6dc22c273`

## 1. What the code does today

`getProviders(filters)` runs one list query on the pool handle (`createTenantKnex()` → `knex`, with no
transaction). It then calls `Promise.all(providers.map(...))`, and each element awaits
`getVendorConfig(db, type, id, tenant)`, which is a separate `.first()` on
`google_calendar_provider_config` or `microsoft_calendar_provider_config`. All N lookups start at
once on the pool, so one call can check out up to N connections.

Real callers send unbounded filters:

- `ee/packages/calendar/src/lib/eventBus/subscribers/calendarSyncSubscriber.ts:53` uses
  `{ tenant, isActive: true }` on every schedule event, so several calls can overlap.
- `ee/packages/calendar/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts:61` uses
  `{ tenant, providerType: 'google', isActive: true }`.

**The finding is real.**

## 2. Key discovery: the fetched vendor config is never used

Every copy of `getProviders` passes the row to `buildProviderConfig(provider, vendorConfig,
{ includeSecrets: false })`. `buildProviderConfig` (EE `:488-513`) uses `vendorConfig` only behind
`options.includeSecrets ? await this.toVendorConfig(...) : undefined`. With `includeSecrets: false`,
`provider_config` is always `undefined` and `vendorConfig` is never read.

So the N queries are not just an N+1 pattern. They fetch data and throw it away. Callers that need
the config already make a separate call to `getProvider(id, tenant, { includeSecrets: true })`. For
example, the maintenance handler at `:68` re-fetches each provider before it touches
`provider_config`.

**Decision:** stop loading vendor config in `getProviders` entirely, instead of batching it as the
card's fix sketch suggests. Batching with `whereIn` or a `LEFT JOIN` would still run 1–2 queries
whose results are discarded. Removing them leaves exactly **one** query per call, with output
identical to today's. No transaction is needed: one statement checks out one pooled connection and
releases it, and a single read has no atomicity concern.

## 3. Where the code lives (three live copies)

| Copy | `getProviders` | fan-out | `buildProviderConfig` | `getVendorConfig` | Who uses it |
|---|---|---|---|---|---|
| `server/src/services/calendar/CalendarProviderService.ts` (**the scanned subject**) | `:144` | `:169-177` | `:489` | `:753` | server-local adapters, webhook processor, sync service, `CalendarProviderEncryption.test.ts` |
| `ee/packages/calendar/src/lib/services/calendar/CalendarProviderService.ts` (**runtime owner**, see `calendarRuntimeOwnership.contract.test.ts`) | `:143` | `:168-176` | `:488` | `:752` | subscriber, maintenance handler, callbacks, actions, `scripts/calendar-fixtures/provision.ts` |
| `packages/integrations/src/services/calendar/CalendarProviderService.ts` | `:149` | `:174-182` | `:480` | `:744` | integrations-package adapters and services, `MicrosoftCalendarAdapter.sharedCalendar.test.ts` |

`server/src/services/CalendarProviderService.ts`, `packages/ee/src/lib/services/CalendarProviderService.ts`
and `packages/ee/src/lib/services/calendar/CalendarProviderService.ts` are one-line re-exports or
stubs. They need no change.

All three `getProviders` bodies are byte-identical apart from `getDb()` vs `getDb(filters.tenant)`,
so the same edit applies to each.

## 4. Changes

Apply the same edit to each of the three copies:

1. **Split the row mapping out of `buildProviderConfig`.** Add a synchronous private
   `toProviderSummary(row): CalendarProviderConfig` that returns the object literal now built in
   `buildProviderConfig`, with `provider_config: undefined`. Change `buildProviderConfig` to
   `{ ...this.toProviderSummary(row), provider_config: providerConfig }` so that no field mapping is
   duplicated. `getProvider` (`includeSecrets` path) and the other existing callers of
   `buildProviderConfig` keep working unchanged.
2. **Rewrite the tail of `getProviders`.** Replace the
   `// Load vendor configs for each provider` block and the `Promise.all` (EE `:167-178`, server
   `:168-179`, integrations `:173-184`) with:
   ```ts
   const providers = await query;
   // Vendor config (tokens, webhook state) is deliberately not loaded here: list callers receive
   // provider_config: undefined and must call getProvider(id, tenant, { includeSecrets: true })
   // for the full config.
   return providers.map((provider) => this.toProviderSummary(provider));
   ```
   This removes the `Promise.all`, the per-row `getVendorConfig` call, and the async mapping.
3. **Keep `getVendorConfig`.** `getProvider` (`:211`/`:212`/`:213`) still uses it for single-row,
   bounded lookups.
4. **Add a leverage marker** above `getProviders` in each copy:
   `// LEVERAGE: pattern calendar-provider-service-triplicate — same service is copied in server/src, packages/integrations and ee/packages/calendar; fixes must be applied 3x`.
   Check `docs/plans/leverage-ledger.md` first and append to it if that ledger tracks markers.

### Ordering

1. EE copy (runtime owner) and its test.
2. `packages/integrations` copy.
3. `server/src` copy (the scanned subject).
4. Typecheck the touched packages, run the tests (§5), commit.

The order only affects review. All three edits ship in one commit, so the copies never diverge.

## 5. Tests

- **New DB-backed integration test**
  `server/src/test/integration/calendar/getProvidersQueryCount.integration.test.ts`. It follows
  the `sharedCalendarSyncAccess.integration.test.ts` harness (`createTestDbConnection`, plus a
  `vi.mock('@alga-psa/db')` override of `createTenantKnex`). It is parameterized over the EE and
  integrations classes; also mock `server/src/lib/db` so the server copy runs too.
  - Seed one tenant with 3 Google providers and 2 Microsoft providers, each with a vendor-config
    row, plus 1 provider without a config row and 1 provider in a *different* tenant.
  - Attach `knex.on('query')` and assert that `getProviders({ tenant })` issues **exactly 1**
    query, and that no query touches `*_calendar_provider_config`.
  - Assert the returned rows: 6 rows from the right tenant, ordered by `created_at desc`, with
    `provider_config === undefined` and the expected values for `name`, `active`,
    `connection_status`, `sync_direction` and the rest.
  - Assert that the filters (`userId`, `providerType`, `isActive`, `calendarId`) still narrow the
    result.
  - Regression check: `getProvider(id, tenant, { includeSecrets: true })` still returns a populated
    `provider_config` (decrypted tokens) for a Google and a Microsoft provider.
- Existing tests to run: `server/src/test/unit/calendar/CalendarProviderEncryption.test.ts`,
  `MicrosoftCalendarAdapter.sharedCalendar.test.ts`, `calendarSyncSubscriber.ee.test.ts`, the
  `calendarRuntimeOwnership` / delegator contract tests, and
  `server/src/test/integration/calendar/*.integration.test.ts`. Most of them mock
  `getProviders`; they should be unaffected, which confirms the public shape did not change.

## 6. Out of scope

- **Consolidating the three copies into one.** This is the real long-term fix. It crosses the CE/EE
  packaging boundary, which `calendarRuntimeOwnership.contract.test.ts` and
  `eePackagesRelocationAudit.contract.test.ts` enforce, and the copies differ in tenant semantics:
  the server copy has `PROVIDER_TENANT_DISCOVERY` unscoped lookups, while the integrations copy
  requires `tenant`. It needs its own card. The marker in §4.4 records the evidence.
- **The N sequential `getProvider(..., includeSecrets: true)` calls** in
  `calendarWebhookMaintenanceHandler.ts:67-70`. These run sequentially, use one connection at a time
  and are not part of this finding. A batched `getProvidersWithSecrets` could replace them later.
- The `// @ts-nocheck` header on the integrations copy.
- Any change to `getProvider`, create/update/delete, or the transaction handling in other methods.

## 7. Risks

- **A hidden consumer of `provider_config` from `getProviders`.** Not possible today: the field is
  always `undefined` because of `includeSecrets: false`. The change is behavior-preserving by
  construction, and the test asserts the field stays `undefined`.
- **A future caller expecting config from the list call.** The comment at the call site points to
  `getProvider(..., { includeSecrets: true })`. If list-with-config is ever needed, add it as an
  explicit batched method (`whereIn` per provider type), not a per-row fan-out.
- **Lens re-scan.** After the change, `getProviders` has one awaited query and no `Promise.all`,
  so `unbounded_parallel_pool_queries` should no longer fire. If it still fires above threshold,
  dispute it and cite the single query at the new line.
- **Copy drift.** All three edits land in one commit. A reviewer should diff the three
  `getProviders` bodies afterwards to confirm they are still identical apart from `getDb`.
