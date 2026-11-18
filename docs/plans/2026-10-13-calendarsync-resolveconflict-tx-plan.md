# CalendarSyncService.resolveConflict: stop holding a transaction across self-connecting sync calls

- Card: 14a5798a-3b0e-453c-9082-cf9995cf05fb · PSA ticket alga-2026-0002698
- Scan: lens `db-query-outside-transaction` v1, question `callee_acquires_own_connection_inside_trx`
- Fingerprint: `services/calendar/CalendarSyncService.ts#CalendarSyncService.resolveConflict`
- Base: `origin/main` @ d6dc22c273

## Verdict: the finding is real

Line numbers below refer to the server copy (`server/src/services/calendar/CalendarSyncService.ts`). Its lines `:48` and `:86` match the scan evidence exactly; `resolveConflict` has moved down about 16 lines since the snapshot.

`resolveConflict` (`:553-650`) opens `withTransaction(knex, …)` at `:600`. Inside that transaction:

| Branch | Call | What the callee does on its own |
|---|---|---|
| `alga` | `syncScheduleEntryToExternal(…)` `:603` | `createTenantKnex()` `:48`, `ScheduleEntry.get(knex…)` `:54`, `getMappingByScheduleEntry` → `createTenantKnex()` `:788`, then **its own** `withTransaction(knex, …)` `:86` with provider HTTP calls (`updateProviderEventIfPresent`, `adapter.createEvent`) inside it |
| `external` | `syncExternalEventToSchedule(…)` `:606` | the same pattern: `createTenantKnex()` `:214`, its own `withTransaction(knex, …)` `:288` |
| `merge` | `ScheduleEntry.update(trx, …)` `:616`, then `syncScheduleEntryToExternal(…)` `:631` | the same as `alga` |

Consequences:

1. **Pool pressure / self-deadlock risk.** The outer transaction pins one pooled connection while the callee checks out at least one more and holds it across external HTTP. With N concurrent resolutions and a pool of N, every request holds one connection and waits for a second.
2. **`alga` / `external`: the transaction does nothing.** `trx` is never used in those branches, so the outer transaction is an idle pinned connection.
3. **`merge` is functionally broken (correctness bug, not only a pool issue).** `ScheduleEntry.update` writes the merged row on `trx` and does not commit. `syncScheduleEntryToExternal` then re-reads the entry on a *different* connection (`:54`). Under READ COMMITTED it sees the **pre-merge** row, so the external calendar receives the old data. It also stamps `alga_last_modified` from the old `updated_at`. When the outer transaction commits, Alga holds the merged row but the provider holds the old one: the merge silently fails to propagate.
4. **Atomicity was never real.** The sync methods catch their own errors and return `{ success:false }` (`:175-204`), so the outer transaction commits the merge update even when the push fails. Removing the wrapper therefore loses no rollback guarantee that exists today.

## Copies in scope

The same method body is duplicated in three live-reachable files. All three get the same fix so the bug is not left in a sibling the lens may also map to `services/calendar/CalendarSyncService.ts`:

| File | `resolveConflict` | outer `withTransaction` | Reached by |
|---|---|---|---|
| `ee/packages/calendar/src/lib/services/calendar/CalendarSyncService.ts` | `:681` | `:728` | **production path**: `calendarActions.ts:451` (`resolveCalendarConflictImpl`), EE webhook routes |
| `server/src/services/calendar/CalendarSyncService.ts` | `:553` | `:600` | `server/src/services/CalendarSyncService.ts` re-export, server `CalendarWebhookProcessor`, `webhookProcessing.integration.test.ts` |
| `packages/integrations/src/services/calendar/CalendarSyncService.ts` | `:635` | `:683` | `packages/integrations/src/webhooks/calendar/{google,microsoft}.ts` |

`packages/ee/src/lib/services/calendar/CalendarSyncService.ts` is a CE stub (`calendarStubs`) and is not touched.

## Design

Fix sketch option chosen: **(a) drop the wrapper for `alga`/`external`; (b) for `merge`, commit the update first and push afterwards.**

Rejected: threading `trx` through `syncScheduleEntryToExternal` / `syncExternalEventToSchedule` / `getMapping*` so that everything nests in one transaction. That widens the transaction to cover the provider HTTP round-trips, which is the opposite of what we want. It also buys no atomicity, because a provider write cannot be rolled back. The callees are self-contained units: each owns its read, its mapping write and its HTTP call. Callers should invoke them outside any transaction.

Rejected: `registerAfterCommit(trx, …)` for the merge push. After-commit hooks are fire-and-forget (`packages/db/src/lib/afterCommit.ts`: failures are logged and swallowed). `resolveConflict` must return the push's `CalendarSyncResult` to the UI, and `result.success` gates `markProviderConnected`. Calling the push sequentially after `withTransaction` resolves gives the same post-commit ordering and keeps the result.

### Target shape (each copy)

```ts
let result: CalendarSyncResult;
if (resolution === 'alga') {
  result = await this.syncScheduleEntryToExternal(entry.entry_id, mapping.calendar_provider_id, true /*, tenant in integrations copy */);
} else if (resolution === 'external') {
  result = await this.syncExternalEventToSchedule(mapping.external_event_id, mapping.calendar_provider_id, true /*, tenant */);
} else {
  const mergedEntry = { ...entry, ...mergeData, entry_id: entry.entry_id };
  const updatedEntry = await withTransaction(knex, (trx) =>
    ScheduleEntry.update(trx, tenant, entry.entry_id, mergedEntry)
  );
  if (!updatedEntry) {
    return { success: false, error: 'Failed to merge schedule entry' };
  }
  // Merge is committed; the push now reads the merged row on its own connection
  // and keeps no transaction open across the provider HTTP call.
  result = await this.syncScheduleEntryToExternal(entry.entry_id, mapping.calendar_provider_id, true /*, tenant */);
}
if (result.success) { await this.markProviderConnected(...); } // unchanged
return result;
```

The pre-transaction prologue (mapping / provider / entry lookups, `createAdapter` + `connect`) stays as it is.

## Changes, in order

1. **EE copy (production)**, `ee/packages/calendar/src/lib/services/calendar/CalendarSyncService.ts:728-768`: replace the `withTransaction` block with the target shape. `ScheduleEntry.update(trx, tenant, entry.entry_id, mergedEntry)` keeps its current argument order.
2. **Server copy**, `server/src/services/calendar/CalendarSyncService.ts:600-640`: the same edit.
3. **Integrations copy**, `packages/integrations/src/services/calendar/CalendarSyncService.ts:683-723`: the same edit, plus two latent bugs in the same lines that must be fixed for the new code to be correct:
   - The sync callees take `tenantContext` as their 4th parameter (`:82`, `:249`), but `resolveConflict` does not forward it, so with an explicit `tenantContext` the callees resolve tenant from ambient context and can fail or mismatch. Pass `tenant` through on all three calls.
   - `ScheduleEntry.update(trx, entry.entry_id, mergedEntry, 'all' as any)` (`:700-705`) omits `tenant`. The shared signature is `(knexOrTrx, tenant, entry_id, entry, updateType?)` (`shared/models/scheduleEntry.ts:554`), so as written it passes `entry_id` as the tenant. Correct it to `(trx, tenant, entry.entry_id, mergedEntry, 'all')` and drop the `as any`. `'all'` matches the EE/server behaviour for a non-recurring resolve. Confirm against `IEditScope` while implementing.
4. **Tests**: see below.
5. Run typecheck for the three packages, then the calendar unit and integration suites.

## Tests

Add to `server/src/test/integration/calendar/manualSync.integration.test.ts`, which already mocks the EE adapters (`:252`, `:264`) and `CalendarProviderService` (`:122`) against a real test DB. Alternatively add a sibling `resolveConflict.integration.test.ts` reusing the same harness.

- **T1, merge pushes merged data:** seed an entry and a `conflict` mapping, then call `resolveConflict(id, 'merge', { title: 'Merged' })`. Assert the adapter's update/create was called with an event whose title is `'Merged'`, the DB row has `title = 'Merged'`, and the mapping is `synced` with `alga_last_modified` equal to the **new** `updated_at`. This test fails on `main`.
- **T2, `alga` resolution:** the mapping becomes `synced` and the adapter receives the current entry.
- **T3, `external` resolution:** the entry takes the external event's fields and the mapping becomes `synced`.
- **T4, no nested transaction:** spy on `withTransaction` from `@alga-psa/db` (the harness already wraps it at `:73`). For `alga`/`external`, assert no outer transaction is open when the callee starts (the call count equals the callee's own single call). For `merge`, assert the update transaction has resolved before the adapter is invoked (record call order).
- **T5, merge update fails:** `ScheduleEntry.update` returns `undefined`. The result is `{ success:false, error:'Failed to merge schedule entry' }` and the adapter is not called.

The EE copy is the production path. Tests target `@alga-psa/ee-calendar/...` as the existing suite does. The server and integrations copies get the identical mechanical edit and are covered by typecheck.

## Out of scope (note, do not fix here)

- `syncScheduleEntryToExternal` (`:86-170`) and `syncExternalEventToSchedule` (`:288+`) themselves hold a transaction across provider HTTP calls. This is the same class of problem in the callees, and a separate finding and card if the lens flags it.
- `markProviderConnected` / `markProviderError` and `getMapping*` call `createTenantKnex()` repeatedly instead of reusing a handle. Outside a transaction these are pool reads, so they are not a deadlock risk.
- The triplicated service across EE, server and integrations. Mark it at the edit site with `// LEVERAGE: pattern calendar-sync-service-triplicate — same CalendarSyncService body in ee/, server/, packages/integrations; fixes must be applied three times`. Consolidation is its own card.
- `resolveConflict` connects an adapter at the top that is only used for `markProviderConnected`. Behaviour is unchanged.

## Risks

- **Behaviour change in `merge`:** the provider now receives the merged data (the intended behaviour, and the bug fix). If the push fails after the merge commits, the entry is merged in Alga and the mapping is flipped to `error` by the callee's catch (`:175-190`). That is the same end state as today, because today's outer transaction also commits despite a failed push.
- **Ambient tenant context:** removing the wrapper does not change tenant resolution in the EE and server copies; the callees already call `createTenantKnex()` themselves. In the integrations copy, forwarding `tenant` makes resolution stricter and more correct.
- **Integrations `ScheduleEntry.update` argument fix:** it changes a call that currently passes the wrong tenant. The path is not exercised by existing tests, so typecheck is the guard. Check `IEditScope` for the right literal instead of casting.
- **Lens re-run:** after the fix there is no transaction handle in scope when the callees run (`alga`/`external`), and in `merge` the only call inside `withTransaction` is `ScheduleEntry.update(trx, …)`, which receives `trx`. The `callee_acquires_own_connection_inside_trx` check should clear.
