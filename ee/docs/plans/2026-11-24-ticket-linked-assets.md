# Design — Workflows can read the assets linked to a ticket

Card: `Workflows can read the assets linked to a ticket` (6eb125a6) · customer ask from Coastline Tech
Services (alga-2026-0003286) · target: hosted Pro.

## Problem

A `ticket.created` workflow for an RMM-alert ticket must go ticket → linked Level device → internal note
with device context. Two gaps make that impossible today:

1. **No read from a ticket to its linked entities.** `tickets.find` and the `ticket.created` payload carry no
   links; the only association action is the reverse, `assets.find_associated_tickets`
   (`shared/workflow/runtime/actions/businessOperations/assets.ts:45`).
2. **Two parallel link stores with the same meaning.** `tickets.link_entities`
   (`businessOperations/tickets.ts:1365`) writes the polymorphic `ticket_entity_links` table, while every UI/REST
   path that links an asset to a ticket writes `asset_associations`
   (`TicketService.ts:1157,2057,2775`; `AssetService.ts:1096`; `packages/assets/src/actions/assetActions.ts:3917`).
   A workflow writing `tickets.link_entities {entity_type:'asset'}` therefore creates a link the asset UI never
   sees — and that an asset unlink never removes.

The RMM side is already right: the Level webhook resolves the asset through
`tenant_external_entity_mappings` (`ee/server/src/app/api/webhooks/levelio/route.ts:195`) and creates the alert
ticket with that `asset_id`, which lands an `asset_associations` row (`TicketService.ts:2775`), so the link the
customer needs exists — the workflow just cannot read it. `levelio.devices.find` already accepts `asset_id`
(`ee/packages/workflows/src/runtime/actions/registerLevelIoWorkflowActions.ts:181`), so returning the ticket's
asset ids is sufficient to finish the customer's flow.

## Decision

**One general read action, and one canonical store per entity type.**

- New action **`tickets.find_linked_entities`** — the read mirror of `tickets.link_entities`. It takes a ticket
  and an optional `entity_type`, and returns every link with enough identity to act on it.
- **Canonical store per type**: `asset` lives in `asset_associations` (first-class, joined by the UI, the REST
  API and the RMM paths); `project`, `project_task` and `contract` stay in `ticket_entity_links`. The polymorphic
  table is the registry for types without a first-class table, not a duplicate of the ones that have one.
- **`tickets.link_entities` routes through a shared helper**, so `entity_type: 'asset'` writes
  `asset_associations` (idempotent) and becomes visible in the asset UI; its other types keep writing
  `ticket_entity_links`. Output shape is unchanged apart from an added `source` field.
- Legacy `ticket_entity_links` rows with `entity_type: 'asset'` that earlier workflow runs created are still
  returned by the reader, marked `source: 'ticket_entity_links', legacy: true`, and de-duplicated against
  `asset_associations`. No migration, no data loss, and the inconsistency becomes visible instead of hidden.

Why not extend `tickets.find`: its output contract is per-ticket scalar fields and adding a variable-length link
graph there bloats every caller. Why not a one-off `assets.find_for_ticket`: the customer's own read is right —
`tickets.link_entities` already treats links generically, so the read should mirror it, and clients/projects/
contracts get the same lookup for free.

## Changes

**`shared/services/tickets/ticketLinks.ts` (new)** — the only place workflow code resolves ticket links:

- `listTicketLinks(trx, tenant, { ticketId, entityType?, relationshipType?, limit })`
  - `asset` → `asset_associations` where `entity_type='ticket'` and `entity_id=ticketId`, joined to `assets`
    (`asset_id`, `asset_tag`, `asset_name`/`name`, `asset_type`, `client_id`) and optionally to
    `tenant_external_entity_mappings` (`alga_entity_type='asset'`, `alga_entity_id=asset_id`) to return
    `external_ids: [{ integration_type, external_entity_id, external_realm_id }]` — this is the RMM provider and
    the external device id the card asks for;
  - `project | project_task | contract` → `ticket_entity_links`, hydrated with the same name lookup
    `tickets.link_entities` already does;
  - `entityType` omitted or `'all'` → every type, `relationshipType` filters `asset_associations` rows;
  - deterministic order `linked_at desc, entity_id`, `limit` default 25 (max 100).
- `linkTicketEntity(trx, tenant, { ticketId, entityType, entityId, linkType, metadata, actorUserId })`
  - validates the ticket and the target entity exist (reusing `tickets.link_entities`'s existing checks);
  - `asset` → insert `asset_associations` (`entity_type: 'ticket'`, `relationship_type` mapped from `link_type`:
    `affected`/`related`, default `affected`, `metadata` folded into `notes` when present); an existing
    `(tenant, asset_id, entity_id)` row returns the existing link (idempotent) instead of throwing;
  - other types → the existing `ticket_entity_links` insert, keeping the current CONFLICT behaviour.

**`shared/workflow/runtime/actions/businessOperations/tickets.ts`**

- register `tickets.find_linked_entities` v1: inputs `ticket_id`, `entity_type`
  (`'all'|'asset'|'project'|'project_task'|'contract'`, default `'all'`), `relationship_type` (optional),
  `include_external_ids` (default `true`), `limit`, `on_not_found` (`return_empty` default / `error`). Requires
  `ticket:read`, plus `asset:read` when assets can be returned (mirrors `assets.find_associated_tickets`).
  Output: `{ ticket_id, links: [{ entity_type, entity_id, name, relationship_type, linked_at, source,
  legacy?, asset?: { asset_id, asset_tag, asset_name, asset_type, client_id },
  external_ids?: [{ integration_type, external_entity_id, external_realm_id }] }] }`.
  Non-side-effectful, engine-provided idempotency, picker metadata (`category: 'Business Operations'`).
- `tickets.link_entities` handler body moves to `linkTicketEntity`; its schema, output and CONFLICT semantics
  stay, with `source` added to the output.

**`shared/workflow/runtime/actions/businessOperations/assets.ts`** — no new action. `assets.find_associated_tickets`
stays the reverse lookup; a short doc line points to the new action.

## Tests

- `tickets.find_linked_entities`: ticket with an asset association returns the asset with `asset_tag`, name and
  the Level external id; `entity_type: 'asset'` filters; `relationship_type: 'related'` filters;
  `include_external_ids: false` omits the block; empty ticket returns `[]` (or errors under `on_not_found: 'error'`);
  unknown ticket id → `NOT_FOUND`.
- Legacy parity: an `asset` row in `ticket_entity_links` is returned once, marked `legacy`, not twice.
- `tickets.link_entities {entity_type:'asset'}` inserts `asset_associations` and a second identical call is a
  no-op; the asset's ticket list (`AssetService.listTicketsForAsset`) then sees the ticket — the assertion that
  proves the two stores now agree.
- RMM regression: a Level alert ticket (webhook-shaped input) has an `asset_associations` row, so the read path
  works for the customer's actual case.
- Run from `server/`: `npx vitest run ../shared/workflow/runtime/actions/__tests__/ticketFindLinkedEntities.test.ts`
  plus the existing ticket action suites; the association parity test needs the dev DB (`localhost:5472` here).

## Risks and non-goals

- **`asset_associations` has no `link_type` column**: `link_type` maps onto `relationship_type` and free-form notes;
  other entity types keep arbitrary `link_type`. Documented in the action description.
- **Legacy rows** created by old workflow runs are read-only surfaced, never migrated automatically.
- **Not in scope**: writing links into the `ticket.created` payload (the action covers the need without changing
  the event contract), `tickets.unlink_entities`, bulk linking, new entity types, and the asset custody surfaces.
- **Hosted Pro**: all reads/writes are tenant-scoped tables already used by the UI; no server-local state.
