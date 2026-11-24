# PRD: Vendor and vendor price list API

Source: ticket alga-2026-0003114. Date: 2026-11-11.

## Problem

Vendors and their price lists (the vendor's part number and contract cost per product) are managed only in the MSP UI. A purchase order needs a `vendor_id`, and line defaults come from the vendor's price list, so an integration that creates purchase orders cannot find, create or price against a vendor without them.

## Users

Integration developers, supplier and procurement connectors, and MCP agents acting for an MSP through an API key. MSP staff are affected only in that the UI keeps working unchanged.

## Goals

- List, fetch, create, update and deactivate vendors over REST.
- List, upsert and delete a vendor's price list entries over REST.
- Behaviour, guards and permissions identical to the MSP UI.

## Non-goals

- Hard deletion of vendors (the UI deactivates).
- Bulk price list import (CSV import already exists in the migration tooling).
- Supplier catalog sync or any connector logic.

## Shared context

The inventory purchasing surface (purchase orders, vendors, vendor price lists, vendor bills) is fully usable from the MSP UI through server actions in `packages/inventory/src/actions/`, but the REST API under `/api/v1/inventory` only covers reading purchase orders and receiving stock. An external system (a supplier connector, a field app, an MCP agent) can see a purchase order and receive against it, but cannot create one, bill it, or manage the vendor it is placed with. Ticket alga-2026-0003114 is the request that surfaced the gap; the gap applies to every tenant using inventory.

Four sibling plans close it, one pull request each:

- `2026-11-11-purchase-order-write-api`
- `2026-11-11-vendor-api`
- `2026-11-11-vendor-bill-api`
- `2026-11-11-project-materials-api`

They are independent (none needs another on main first). The three inventory plans all add to `ApiInventoryController`, `InventoryService`, `inventorySchemas.ts` and `openapi/routes/inventoryV1.ts`, so whichever lands second rebases over the first.

## Approach common to all four

- **One core, two callers.** Business rules live in a transaction-scoped core function in the owning package's `lib/`. The server action and the REST service both call it. This is the shape `receivePoLineCore` and `createPurchaseOrderDraftCore` already have. Where a rule currently sits inline in a server action, move it into a core and make the action a thin caller. Do not re-implement a rule in the REST service.
- **Same permissions as the UI.** The REST route checks the same RBAC resource and action the server action checks. No new permission rows.
- **Same events as the UI.** Any workflow or domain event the action publishes is published by the REST path too, after commit.
- **Errors by meaning.** Missing record: 404. Bad input: 400 with the field path. A refused state transition or uniqueness clash: 409. The core throws typed errors; the action maps them to its translated messages, the service maps them to HTTP.
- **Registry.** Every new route is registered in the OpenAPI registry with a real request body schema (not the loose body), so it appears in the API registry that MCP and integrations search.
- **Currency.** Amounts are integer minor units with an explicit currency code. A missing currency resolves from the vendor's price list, then the tenant default, exactly as the UI does. Nothing hardcodes a currency.

## API

| Method | Path | Core | Permission |
|---|---|---|---|
| GET | `/api/v1/inventory/vendors` | new `queryVendors` | `vendor:read` |
| GET | `/api/v1/inventory/vendors/{vendorId}` | new `queryVendor` | `vendor:read` |
| POST | `/api/v1/inventory/vendors` | `createVendorCore` (exists) | `vendor:create` |
| PUT | `/api/v1/inventory/vendors/{vendorId}` | new `updateVendorCore` | `vendor:update` |
| POST | `/api/v1/inventory/vendors/{vendorId}/deactivate` | new `deactivateVendorCore` | `vendor:update` |
| GET | `/api/v1/inventory/vendors/{vendorId}/products` | new `queryVendorProducts` | `vendor:read` |
| PUT | `/api/v1/inventory/vendors/{vendorId}/products/{serviceId}` | `upsertVendorProductCore` (exists) | `vendor:update` |
| DELETE | `/api/v1/inventory/vendors/{vendorId}/products/{serviceId}` | new `deleteVendorProductCore` | `vendor:update` |

List supports pagination, `search` on vendor name and `include_inactive` (default false, as in the UI).

Vendor body: `vendor_name` (required on create), `contact_name`, `email`, `phone`, `website`, `payment_terms`, `account_number`, `notes`.

Price list entry body: `vendor_sku`, `unit_cost` (minor units), `cost_currency`, `lead_time_days`, `is_preferred`.

Guards to preserve:

- Vendor names are unique per tenant after normalization (`normalizeVendorName`); a clash is a 409 that names the existing vendor.
- One preferred offer per product (partial unique index); setting a new preferred entry follows the existing upsert behaviour.
- Deactivate is idempotent.

A new `'vendor'` value is added to `InventoryApiResource`.

## UX

No UI change.

## Rollout

Additive routes, no migration, no feature flag. The refactor of server actions onto cores is behaviour-preserving and covered by the existing action tests.

## Open questions

- Deactivate as `POST …/deactivate` versus `DELETE`: chosen POST because the record is kept and the permission is `vendor:update`, matching the UI.
- Should there be a reactivate route? The UI reactivates through update (`is_active`); the PUT body accepts `is_active` to match.

## Acceptance criteria

- An API key holder with vendor permissions can create a vendor, put a price list entry on it, and see that entry default a purchase order line.
- A duplicate vendor name is refused with 409.
- The MSP UI behaves exactly as before.
- All eight routes appear in the API registry with body schemas.
