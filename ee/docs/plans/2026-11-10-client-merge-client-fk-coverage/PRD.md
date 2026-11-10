# PRD — Client merge covers every client reference

- Slug: `client-merge-client-fk-coverage`
- Date: `2026-11-10`
- Status: Draft
- Code baseline: `origin/main` at `88c634d5b5`

## Summary

Client merge and its completeness checks assume a client reference is a column named `client_id`. A reference with another name is invisible to them. One such column, `purchase_orders.drop_ship_client_id`, is not moved at all. Make the roster name the column per table, drive the completeness check from the foreign-key snapshot, and re-point drop-ship purchase orders.

## Problem

The merge roster lives in `packages/clients/src/lib/clientMergePlan.ts`: `CLIENT_OWNED_MOVE_TABLES` (line 392), `CLIENT_KEYED_TABLES_LEFT_BEHIND` (line 523), `CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY` (line 603) and `PROFILE_HISTORY_TABLES` (line 628). Its own comment states the policy: every table with a `client_id` appears in one of the lists, because a row left on the absorbed client keeps a live write path pointed at an archived client.

The foreign-key snapshot (`packages/db/src/lib/tenantTableForeignKeys.ts`) has two client foreign keys that are not named `client_id`:

- `purchase_orders.drop_ship_client_id`. It appears nowhere under `packages/clients/src/lib`. A drop-ship purchase order is created with `drop_ship_client_id: so.client_id` (`packages/inventory/src/actions/dropShipActions.ts:215`). After a merge the sales order has moved to the surviving client and its purchase order still names the absorbed one.
- `contracts.owner_client_id`. The engine does re-point it (`clientMergeEngine.ts`, the "owned contract" step near line 1072), but `contracts` is in none of the roster lists, so the roster understates what the engine does.

The checks that should have caught this look for the literal name:

- `server/src/test/unit/contract/tenantLifecycleLists.contract.test.ts` compares the roster with the manifest's `clientKeyed` set.
- Integration test TM019 (`server/src/test/integration/clientMerge.integration.test.ts`, line 1101) reads `pg_attribute` for `attname = 'client_id'`.

A survey also reported client columns with no foreign key that sit outside the roster: `telephony_call_records.matched_client_id`, `telephony_chat_records.matched_client_id` and `app_search_index.client_scope_id`. These are reported, not verified.

This was found by reading code. It has not been reproduced against a database.

## Goals

- A merge leaves no row referencing the absorbed client through any client foreign key, unless that table is deliberately left behind with a stated reason.
- Adding a client foreign key under any column name, with no roster entry, fails a test.

## Non-goals

- Changing how any currently handled table is merged.
- Redesigning the roster beyond letting an entry name its column.
- Client references held in JSON or in polymorphic pairs. They are already handled explicitly or are out of scope here.

## Users and Primary Flows

An MSP administrator merges a duplicate client into the surviving one. Afterwards the surviving client's drop-ship purchase orders, owned contracts and everything else that named the duplicate name the survivor.

## UX / UI Notes

No screen changes. The merge summary counts gain a line for drop-ship purchase orders if the summary lists moved records by kind.

## Requirements

### Functional Requirements

See `features.json`.

### Non-functional Requirements

- Citus-safe: one statement per update, tenant in every predicate, no volatile function in an `UPDATE`.
- The merge stays one transaction.

## Data / API / Integrations

- No schema change.
- A roster entry gains an optional column name that defaults to `client_id`.
- The completeness check reads `tenantTableForeignKeys.ts` for every row whose parent is `clients`.

## Security / Permissions

None.

## Rollout / Migration

Ships complete in one pull request. Tenants that merged clients before this fix may hold drop-ship purchase orders pointing at an archived client; see Open Questions.

## Open Questions

1. Should existing drop-ship purchase orders that already point at a merged-away client be repaired? `clients.merged_into_client_id` gives the survivor. Default: report the count on the card and leave repair to a follow-up, because it is a data change in production.
2. Does a drop-ship purchase order carry a ship-to address copied from the absorbed client, and should it change on merge? Default: re-point the client only and leave any address snapshot as written.
3. For the three reported columns with no foreign key: move, or leave behind with a reason? Default: decide per column after verifying it exists and how it is read.

## Acceptance Criteria (Definition of Done)

1. After merging a client that has a drop-ship purchase order, the purchase order names the surviving client.
2. `contracts` has an explicit roster entry that matches what the engine does, and the owned-contract behaviour is unchanged.
3. The completeness check fails when a foreign key to `clients` exists, under any column name, with no roster classification.
4. TM019 or its replacement checks every column that references `clients`, not only `client_id`.
5. Each of the three reported non-FK columns is either handled or listed as left behind with a reason.
