# PRD: Project materials API

Source: ticket alga-2026-0003114. Date: 2026-11-11.

## Problem

Materials can be read and added on a ticket over REST (`/api/v1/tickets/{id}/materials`), with full stock consumption. Projects have the same materials feature in the MSP UI but no REST route, so an integration can record purchased or stocked items against a ticket but not against a project.

## Users

Integration developers, supplier and procurement connectors, and MCP agents acting for an MSP through an API key. MSP staff are affected only in that the UI keeps working unchanged.

## Goals

- List and add project materials over REST with the same stock behaviour as the UI and as ticket materials.
- Remove a project material over REST, restoring stock as the UI does.

## Non-goals

- Changing ticket materials routes.
- Editing a material's rate or billing destination after it is added (UI `updateProjectMaterial`); see open questions.
- Linking a material to the purchase order line it was bought on.

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
| GET | `/api/v1/projects/{id}/materials` | `listMaterials(…, 'project', id)` (exists) | `project:read` |
| POST | `/api/v1/projects/{id}/materials` | `addMaterial` with `parent_type: 'project'` (exists) | `project:update` |
| DELETE | `/api/v1/projects/{id}/materials/{materialId}` | existing project material delete core | `project:update` |

The cores already exist in `packages/inventory/src/lib/materials.ts` and are what the project server actions and the ticket REST service call. This plan adds the REST service method, controller handlers, routes and registry entries on the project API, mirroring `TicketService.addTicketMaterial`.

Add body: `service_id`, `quantity`, `rate`, `currency_code` (required), `description`, `unit_id` (the serialized stock unit to deliver), `billing_destination`, `billing_schedule_entry_id`. `client_id` is taken from the project, not from the body.

Behaviour to preserve:

- A tracked product consumes stock; a serialized product delivers the picked unit and creates the managed asset where configured.
- Insufficient free stock, or stock reserved or held for a sales order, is a clean 400 on `quantity`. The REST path never passes `allow_reserved_override`; that is an interactive confirmation.
- Material validation errors map to 400 with the field path; an unknown project is 404.
- Record-level project authorization applies as it does on the other project routes.

## UX

No UI change.

## Rollout

Additive routes, no migration, no feature flag. The refactor of server actions onto cores is behaviour-preserving and covered by the existing action tests.

## Open questions

- Should `PUT /projects/{id}/materials/{materialId}` (rate and billing destination) be included? Left out to keep this the project twin of the ticket routes plus delete.
- Ticket materials have no DELETE route either. If Robert wants symmetry, add it in the same pull request; the core is shared.

## Acceptance criteria

- An API key holder with project permissions can add a stock-tracked material to a project and see on-hand drop, then delete it and see on-hand return.
- Insufficient or reserved stock is refused with 400 and nothing is written.
- The MSP UI behaves exactly as before.
- The three routes appear in the API registry with body schemas.
