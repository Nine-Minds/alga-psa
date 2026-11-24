# Scratchpad: Vendor and vendor price list API

## Origin

Ticket alga-2026-0003114. Investigated on main on 2026-11-11.

## Discoveries

- Actions: `packages/inventory/src/actions/vendorActions.ts` (list, get, create, update, deactivate) and `vendorProductActions.ts` (list, upsert, delete).
- Cores that already exist: `createVendorCore`, `createOrMatchVendorCore`, `findVendorByNameCore`, `normalizeVendorName` in `lib/vendors.ts`; `upsertVendorProductCore` in `lib/vendorProducts.ts`.
- RBAC resource is `vendor` (create, read, update, delete rows exist in the permission catalog). Price list actions use `vendor` permissions too.
- `IVendor` and the vendor product type are in `packages/types/src/interfaces/inventory.interfaces.ts`.

## REST plumbing

- Routes: `server/src/app/api/v1/…/route.ts`, thin, calling a controller method.
- Controller: `server/src/lib/api/controllers/ApiInventoryController.ts` (`execute` wraps auth, tenant and permission check).
- Service: `server/src/lib/api/services/InventoryService.ts`.
- Schemas: `server/src/lib/api/schemas/inventorySchemas.ts`.
- Registry: `server/src/lib/api/openapi/routes/inventoryV1.ts` (the `Def` table currently supports only get and post, and a loose body).

## Decisions

- Rules live in a lib core shared by the server action and the REST service; no rule is written twice.
- Same RBAC resource and action as the UI; no new permission rows.
- Sibling plans: purchase-order-write-api, vendor-api, vendor-bill-api, project-materials-api (all dated 2026-11-11).
