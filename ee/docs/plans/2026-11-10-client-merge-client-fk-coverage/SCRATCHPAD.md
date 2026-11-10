# Scratchpad — Client merge covers every client reference

## Discoveries

- Roster: `packages/clients/src/lib/clientMergePlan.ts`. `CLIENT_OWNED_MOVE_TABLES` entries are `{ table, label, stampsBillingProfile? }` and the generic mover in `clientMergeEngine.ts` updates `client_id` (lines 335 to 367).
- `CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY` is `clients`, `client_billing_profiles`, `client_contracts`, `client_portal_visibility_groups`. `contracts` is not in it.
- Engine, owned contracts: `clientMergeEngine.ts` near lines 1052 to 1073. It demotes the source's system-managed default contract when the target already has one, then updates `owner_client_id`. The comment explains why: the recurring chain reads `contracts.owner_client_id`, and an owner left on the absorbed client makes moved recurring contracts unbillable.
- Foreign-key snapshot rows with parent `clients` and a column other than `client_id`: `contracts.owner_client_id` (two duplicate constraints) and `purchase_orders.drop_ship_client_id`.
- `purchase_orders` has no `clientKeyed` flag in `packages/db/src/lib/tenantTableManifest.ts` (line 316), which is why the lifecycle contract test does not expect it in the roster.
- Drop-ship creation: `packages/inventory/src/actions/dropShipActions.ts:215` sets `drop_ship_client_id: so.client_id`. Other writers: `packages/inventory/src/lib/purchaseOrders.ts:109`, `purchaseOrderActions.ts:186`.
- TM019: `server/src/test/integration/clientMerge.integration.test.ts:1101`, joins `pg_attribute` on `attname = 'client_id'`.
- Lifecycle contract test: `server/src/test/unit/contract/tenantLifecycleLists.contract.test.ts`, with `MERGE_PLAN_EXEMPTIONS` for `client_plan_bundles` and `mcp_oauth_clients`.

## Decisions

- Let a roster entry name its column instead of adding a second list for oddly named columns. The engine's generic mover reads the column from the entry.
- Drive completeness from the foreign-key snapshot. The snapshot is generated from `information_schema`, so it sees every name.

## Gotchas

- The inventory package mostly queries with raw `trx('table')`, not the tenant facade. Use the engine's own `scoped(trx, tenant, table)` helper for the new update.
- OAuth tables have a `client_id` that is not a PSA client. Keep the existing exemption.
- Columns with no foreign key are invisible to the snapshot. The three reported ones need a separate, explicit list if they are to be covered by the check.

## Not verified

- That `telephony_call_records.matched_client_id`, `telephony_chat_records.matched_client_id` and `app_search_index.client_scope_id` exist with those names.
- Whether any tenant currently has drop-ship purchase orders pointing at a merged-away client.
