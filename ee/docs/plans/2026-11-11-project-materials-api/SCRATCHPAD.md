# Scratchpad: Project materials API

## Origin

Ticket alga-2026-0003114. Investigated on main on 2026-11-11.

## Discoveries

- Ticket twin: `server/src/app/api/v1/tickets/[id]/materials/route.ts`, `ApiTicketController.getMaterials/addMaterial`, `TicketService.getTicketMaterials/addTicketMaterial` (around line 1725).
- Shared cores: `addMaterial`, `listMaterials` in `packages/inventory/src/lib/materials.ts`; typed errors `MaterialValidationError`, `InsufficientStockError`.
- Project actions: `packages/projects/src/actions/materialCatalogActions.ts` (listProjectMaterials, addProjectMaterial, updateProjectMaterial, deleteProjectMaterial). Permissions used: `project:read`, `project:update`.
- Ticket OpenAPI entries to mirror: `server/src/lib/api/openapi/routes/workManagementV1.ts` around line 1698.
- A second, older set of material actions exists in `packages/billing/src/actions/materialActions.ts`; the REST path should use the inventory core, as tickets do.

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
