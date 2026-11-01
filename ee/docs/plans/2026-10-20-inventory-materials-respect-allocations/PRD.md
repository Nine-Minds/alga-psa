# PRD: Ticket and project materials respect sales-order allocations (B1)

Alga ticket: alga-2026-0002683. Status: draft implementation, unpublished.

## Problem

Adding a non-serialized material to a ticket or project consumes stock through `recordStockConsumption`
(`packages/inventory/src/lib/consume.ts`). That path only compared the request with `quantity_on_hand`. Stock a
sales order had already allocated (`reserved_quantity` soft, `held_quantity` hard) was invisible to it, so a
material could consume units promised to a sales order. The picker badge and advisory panel also showed on-hand,
which overstated what was really available.

## Goals

1. Hard holds (`held_quantity`) can never be consumed by ticket or project materials.
2. Soft reservations (`reserved_quantity`) can be consumed only with an explicit override. Without it the add is refused.
3. The material dialogs show a clear refusal, or an override prompt with a warning.
4. The picker badge and advisory panel show free stock.

## Non-goals

- No schema migration, no new columns or tables.
- No change to sales-order allocation logic (`allocateLine`, `computeAllocationsFromTruth`).
- No change to serialized-unit consumption.
- No change to the adjust and retire correction paths (see Sweep).

## Rule

Free stock = `quantity_on_hand - reserved_quantity - held_quantity`, evaluated at the location the consume locks,
on the row read with `FOR UPDATE` inside `recordStockConsumption`. Order of checks (`evaluateConsumption`):

| Check | Outcome |
| --- | --- |
| quantity > on hand | Refused, reason `on_hand`, not overrideable (existing text kept) |
| quantity > on hand - held | Refused, reason `held`, not overrideable |
| quantity > free | Refused, reason `reserved`, overrideable; allowed when `allow_reserved_override` is set |
| otherwise | Allowed |

The `held` check precedes the override branch, so no flag value can reach held stock. The override consumes even
if free then goes negative. It never changes `reserved_quantity`/`held_quantity` and does not touch the sales
order. On-hand is never taken below zero (negative on-hand stays blocked on this path).

## Override record

The consume movement stores `reason = "reserved_stock_override: {json}"` with `requested`, `free`, `reserved`,
`held`, `onHand`, `performed_by`, and `stock_movements.performed_by` is set. No new columns.

## Errors and UI

- `InsufficientStockError` carries structured detail (`reason`, `overrideable`, `free`, `onHand`, `reserved`, `held`, `requested`).
- Thrown errors do not cross the server-action boundary, so the add actions return a serializable `{stockConflict}` result (`stockConflictResultFrom`, guard `isStockConflictResult`).
- The refusal and prompt come from the error `addMaterial` returns, not from `getProductAvailability`, so they are decided under the lock and not from a stale read.
- Ticket card and project drawer: a reserved conflict opens a confirmation dialog ("Add anyway" retries with `allow_reserved_override: true`); a held or on-hand conflict shows an inline error naming the free quantity and offers no override.
- Picker badge: "Available: N" using per-location `free_total` at the product's default location (tenant default if unset). It is per location rather than a tenant-wide sum, so it agrees with the location the consume will lock.
- Advisory panel: "Free stock by location" with "{{free}} free of {{onHand}}". Locations are listed when on-hand, reserved or held is non-zero.
- All new copy is in locale files (`features/tickets`, `features/projects`), pseudo-locales regenerated.

## Serialized units (asymmetry)

Serialized units already refuse consumption of an allocated unit outright (a unit is either allocated or not), with no
override. Non-serialized stock is a fungible count, so a soft reservation can be overridden but a hold cannot. The
asymmetry is intentional: a quantity can be partly reserved, a specific unit cannot.

## REST decision

`TicketService` (REST) never passes the override flag, so REST callers get a clean `ValidationError` refusal for
both soft and hard conflicts. An override is an interactive, warned decision; an API client has no way to see the
warning, so it must not be able to take reserved stock silently. A later opt-in flag can be added if needed.

## Sweep of other stock-consuming paths

- `adjust.ts` (adjustment and retire correction paths): they correct physical counts to reality (damage, loss, recount) and already warn and allow negative on-hand. Stock that is physically gone cannot be protected by refusing the record of it, so they are left unchanged. Changing them is out of scope.
- Other readers of `quantity_on_hand` are read-only displays; the picker and availability surfaces were updated, the rest do not gate consumption.
- Consumption through serialized units and other receipt/transfer paths is unaffected.

## Design Session

No Design Session plan existed for this work. No conflicts were found with the inventory PRDs (D1: negative on-hand blocked on the consume path only, is preserved).

## Risks

- Existing callers that relied on consuming reserved stock now get refused; they must use the override (UI) or reduce the quantity.
- The override record is free text in `reason`; reporting on overrides requires a prefix match until a structured column exists.
- The ticket and project UIs duplicate the handler and badge (LEVERAGE markers added).

## Acceptance criteria

- Integration tests fail on the old code and pass on the new (`materialsAllocation.db.test.ts`).
- Existing inventory, materials, alloc, remediation DB tests and `materialAuthorizationParity.contract.test.ts` pass.
- Ticket card and project drawer tests cover confirm-then-override and held-without-override.
- inventory, tickets, projects, billing and server typecheck.
