# PRD — Mobile Inventory (Barcode Scanning) + Mobile Sales Opportunities

- Slug: `2026-07-16-mobile-inventory-and-opportunities`
- Date: `2026-07-16`
- Status: Reviewed — critique-agent findings folded in (revision 2)
- Branch: `mobile/inventory_and_so`

## Summary

Add two new sections to the AlgaPSA mobile app (`ee/mobile`): **Inventory** — barcode-scan-first stock operations for field techs and warehouse staff — and **Opportunities** — the sales work queue in your pocket, where a phone call becomes a logged interaction and a follow-up becomes a calendar entry.

Both server modules already exist and are recent (`packages/inventory`, June 2026; `packages/opportunities`, July 2026). The mobile work is blocked by concrete main-app gaps this plan closes first: the inventory module has **no REST API at all** (server-actions only), there is **no interactions REST API** (blocking phone-call logging), products have **no barcode/GTIN field** (only SKU), the opportunity work queue and interaction timeline are server-action-only, and the inventory module has **workflow-engine gaps** (no `inventory.*` workflow actions, most published events missing from the workflow catalog, low-stock signal not emitted on manual adjustment).

The inventory module design doc (`docs/plans/2026-06-26-inventory-module-design.md` §10) explicitly deferred "barcode/serial/MAC scanning" — this plan is that deferred item, delivered as mobile-first.

## Problem

**Inventory**: the stock module shipped with a web-only UI. The people who physically touch stock — techs receiving boxes at the warehouse, pulling parts from a van, counting shelves, checking a serial number at a client site — are standing next to hardware with a phone, not a laptop. Serial numbers, MACs, SKUs, and UPCs are printed as barcodes on every box and label; typing them is slow and error-prone. Today there is no way to do any inventory operation from the mobile app, and no scan-to-lookup anywhere in the product.

**Opportunities**: the sales module's discipline engine ("one next action with a due date, always") lives on the desktop. But the actual selling moments happen away from the desk — the follow-up call from the car, the hallway conversation after an on-site visit. Today a rep who makes a call in the field has no way to log it as an interaction (the interactions API doesn't exist over REST), so `last_activity_at` goes stale, the staleness ladder fires nudges about deals that are actually moving, and the courtship record has holes.

## Goals

1. **Scan-first inventory on mobile**: point the camera at any barcode (UPC/EAN/Code128/Code39/QR) and resolve it — product (by barcode/SKU), stock unit (by serial/MAC) — in one round trip, then act on the result.
2. Mobile inventory operations, permission- and location-scoped exactly like the web: view stock levels and availability, look up unit history/warranty, receive stock (manual and against a PO, scanning serials one-by-one), adjust with reason, record blind cycle counts, receive transfers.
3. **Barcode as a first-class product field**: `service_catalog.barcode` (GTIN/UPC/EAN), editable in the web Products manager, searchable everywhere SKU is.
4. **A REST v1 inventory API** that the web module's action layer already implements the logic for — mobile is the first consumer; the API is the reusable deliverable.
5. **Opportunities work queue on mobile**: the same finishable docket (due today / going quiet / money found) as the web, with complete-action → next-action chaining intact.
6. **Phone call → interaction**: call the deal's contact from the opportunity screen; when you return to the app, get prompted to log the call (type=Call, duration prefilled, linked to opportunity + client + contact). Requires the new interactions REST API.
7. **Calendar integration**: schedule a follow-up from an opportunity as an `ad_hoc` schedule entry (existing schedules REST API); it appears in the mobile Schedule tab and the web calendar.
8. **Inventory workflow-engine parity** (main-app gap, user-requested): an `inventory` business-operations module for the workflow runtime (availability lookup, unit find, draft-PO creation, stock adjustment), catalog coverage for the events the module already publishes, and low-stock emission on manual adjustments (today only fulfillment/materials emit it).
9. Both sections gated correctly: MSP-user auth, RBAC resources (`inventory`, `opportunities`, `interaction`, `user_schedule`, `purchase_order`, `cycle_count`, `stock_transfer`), tenant product code (`psa` — AlgaDesk tenants must not see either section) via the REST layer's existing `assertProductApiAccess` seam, advertised to mobile via a new authenticated capabilities endpoint.

## Non-goals

- No offline queue for inventory mutations (mobile is online-first; the in-memory TTL cache pattern stays).
- No PO/SO creation or editing on mobile (receiving against an existing PO only; SO fulfillment stays web-only in v1).
- No RMA, loaner, kit, vendor-bill, drop-ship, margin/reporting surfaces on mobile in v1.
- No dedicated per-unit barcode column: serial and MAC barcodes already encode the value stored in `stock_units`; only products gain a `barcode` column.
- No hardware scanner (Bluetooth/Zebra) integration — camera scanning only.
- No native calendar (EventKit/CalendarProvider) sync on mobile — "calendar" means AlgaPSA schedule entries, same as the web.
- No call detection / CallKit integration — call logging is prompted on app-resume after a `tel:` launch, never automatic.
- No opportunity creation, suggestion accept/dismiss, board (kanban), forecast, meeting mode, commitments, or AI drafting on mobile in v1. The queue's "money found" section is omitted on mobile in v1 (resolved — see Open Questions).
- No interactions PUT/DELETE over REST in v1 (update/delete side effects are inline in web actions; mobile doesn't need them).
- No client-portal exposure of anything here.
- No changes to the billing engine, stage engine, or discipline engine semantics.

## Users and Primary Flows

Personas: the **field tech** (van stock, client sites — scans serials, receives transfers, checks warranty), the **warehouse/ops person** (receives POs, counts shelves, adjusts), and the **selling owner/rep** (works the queue from the road, calls contacts, logs interactions, schedules follow-ups).

1. **Scan → act (inventory home)**: open Inventory tab → camera viewfinder with reticle → scan any barcode → resolver returns product / unit / no-match → context card slides up: product shows on-hand/available by location with actions (Receive, Adjust, Count); unit shows status/location/client/warranty with action (History); no-match offers retry / manual search.
2. **Receive a PO delivery**: Inventory → Purchase Orders (open/partially received) → pick PO → pick line → serialized: scan serials one after another (list grows, dupes rejected with haptic), non-serialized: enter quantity → confirm → line/PO status advances.
3. **Blind cycle count**: Inventory → Counts → start (or continue) a session for a location → scan items / enter counted quantities per product → submit for review (approval stays on web).
4. **Field unit check**: scan a serial at a client site → unit card: product, status, client, warranty expiry, movement history.
5. **Work the queue (opportunities home)**: Opportunities tab → same docket sections as web (due today, going quiet) with why-sentences → tap a row → deal detail.
6. **Call → log → chain**: deal detail → tap call on the contact → dialer opens → return to app → "Log this call?" sheet (type=Call, duration editable, notes) → saved as interaction linked to opportunity/client/contact → `last_activity_at` refreshes → if it completed the next action, complete-action flow forces setting the successor (the chain never breaks).
7. **Schedule the follow-up**: deal detail → "Schedule follow-up" → date/time picker → `ad_hoc` schedule entry titled with the deal, assigned to me → visible in mobile Schedule tab and web calendar.
8. **Close from the road**: deal detail → mark Won (hands off to web for conversion) or Lost (reason required).

## UX / UI Notes

Follows the app's existing conventions exactly (see SCRATCHPAD "mobile map" digest): drawer sections registered in `DrawerNavigator.tsx`, detail screens in `RootNavigator.tsx`, plain-hooks data layer, `src/ui/components/*` primitives, theme tokens, i18n namespaces (`inventory`, `opportunities`), `LoadingState/EmptyState/ErrorState`, pull-to-refresh, `useAppResume`.

- **Inventory tab** (drawer icon `barcode-scan`): top-level segmented header — **Scan** (default), **Stock**, **Counts**, **POs**. Scan screen reuses the `ServerEntryScreen` CameraView pattern with `barcodeTypes: ["qr","ean13","ean8","upc_a","upc_e","code128","code39","itf14","codabar"]`, torch toggle, haptic on read, debounce so one physical barcode = one resolve.
- Scan result is a bottom card, not a navigation — keep the camera warm for the next scan. Actions navigate.
- **Serial-scan accumulator** (receive flows): full-screen scan mode with a running chip list of captured serials, dupe rejection, manual-entry fallback, "done" confirms the batch.
- **Opportunities tab** (drawer icon `handshake-outline` or `target`): **Queue** (default) and **Pipeline** segments. Queue renders sections + why-sentences from the server queue endpoint (composer output is server-side; mobile never re-derives sentences). One primary action per screen (house rule from the web module).
- Deal detail: header (title, client, stage badge, values), **next-action card** (the screen's one primary: Complete), contact row with call/email icons, timeline (interactions, newest first), footer actions (Log interaction, Schedule follow-up, Won/Lost).
- Call-log prompt: only when a `tel:` launch originated from an opportunity screen and the app resumes within a sane window (< 4h); dismissible; never auto-logs.
- Permission/product gating: drawer tabs render only when the capabilities endpoint advertises the section; API `permission` errors render the existing no-access state.

## Requirements

### Functional Requirements

**FR1 — Barcode field (main app).** Migration adds `service_catalog.barcode` (nullable text) with partial unique index `(tenant, barcode) WHERE barcode IS NOT NULL AND item_kind='product'` (same shape as the SKU index; `service_catalog` is tenant-distributed so this is Citus-legal). **GTIN normalization is mandatory**: iOS strips the leading digit from UPC-A/zero-leading EAN-13 reads (expo-camera maps `upc_a`→AVFoundation `ean13` and drops the leading 0), so the same physical label yields 12 digits on iOS and 13 on Android. One shared normalization function (all-numeric 12-digit codes zero-padded to 13; storage, uniqueness, and lookup all use it) lives with the schema and is exported for the API layer. Products web UI (QuickAddProduct + ProductsManager edit) gains a Barcode field with uniqueness error handling. `ProductCatalogService` list/search includes barcode; product Zod schemas/interfaces updated.

**FR2a — Inventory core extraction (main app, prerequisite).** Unlike opportunities (which has real dual-consumer cores: `opportunityDetail.ts`, `opportunityWin.ts`), the inventory actions hold their business logic **inline inside `withAuth` closures** (`receiveStockManual`, `adjustStock`, all of `cycleCountActions`, `receivePoLine`, transfer receive, and all of `stockUnitActions`' inline queries). Before any REST work: extract session-free, transaction-aware cores into `packages/inventory/src/lib/` — receive, adjust, count start/record/submit, PO list/get/receive-line, transfer list/receive, unit search/detail, stock levels — each taking `(knex/trx, tenant, userId, input)`. Web actions become thin wrappers; existing inventory action tests must stay green (regression gate). This is the largest single backend work item in the plan (~8–10 cores). During extraction, `receivePoLine` **gains** the `assertLocationWritable` check it is missing today (manual receive/adjust/transfers/counts already scope; PO receive not scoping was an inherited gap — this is a deliberate web behavior change).

**FR2 — Inventory REST API v1 (main app).** New `ApiInventoryController` + `InventoryService` (server/src/lib/api pattern: `ApiBaseController`, `x-api-key` auth, Zod schemas, OpenAPI registration), calling the FR2a cores — no logic forks. Endpoints:
- `GET /api/v1/inventory/lookup?code=` — runs all four exact matches together (normalized product barcode, product SKU, unit serial, unit MAC with case/separator normalization); a single-domain hit returns that variant; hits in more than one domain return a `multi` variant listing them (serial/SKU namespaces can collide — never silently shadow a unit); zero hits return `{type:'none', candidates}` from prefix search. Discriminated union with enough payload to render the scan card (product + levels summary, or unit + status/client/warranty).
- `GET /api/v1/inventory/stock` (levels by product×location; filters: location_id, service_id, low_stock, search; paginated), `GET /api/v1/inventory/stock-locations`.
- `GET /api/v1/inventory/units` (filters: serial/mac/search, status, location_id, service_id, client_id), `GET /api/v1/inventory/units/{unitId}` (detail + movement history).
- `POST /api/v1/inventory/receipts` (manual receive: service, location, qty, unit_cost optional → falls back to settings cost, serials[] for serialized).
- `POST /api/v1/inventory/adjustments` (qty delta or serialized unit loss/found, required reason).
- Cycle counts: `GET /api/v1/inventory/counts`, `POST /api/v1/inventory/counts` (start), `GET /api/v1/inventory/counts/{id}`, `POST /api/v1/inventory/counts/{id}/records`, `POST /api/v1/inventory/counts/{id}/submit`.
- POs (receiving subset): `GET /api/v1/inventory/purchase-orders?status=open,partially_received`, `GET /api/v1/inventory/purchase-orders/{id}`, `POST /api/v1/inventory/purchase-orders/{id}/lines/{lineId}/receive` (qty + serials). Nested under `/inventory/` to signal this is the receiving subset, not a full PO CRUD API.
- Transfers (receiving subset): `GET /api/v1/inventory/transfers?status=dispatched`, `POST /api/v1/inventory/transfers/{id}/receive`.
All writes enforce the same RBAC as the server actions (`inventory:create/update`, `purchase_order:update`, `cycle_count:create/update`, `stock_transfer:update`) **and location scoping** (`assertLocationWritable`, including the PO-receive path per FR2a); movements/events/notifications fire identically (shared code path). Landmine to clear: the seeded-tenant permission readd migration (`20260707120000`) omits `cycle_count`, so some tenants lack count permissions — verify and ship a readd migration if needed, or mobile counts will 403 confusingly.

**FR3 — Interactions REST API v1 (main app).** New `ApiInteractionController` + `InteractionService` + `interactionSchemas`: `GET/POST /api/v1/interactions` (filters: client_id, contact_id, opportunity_id, ticket_id, project_id, user_id, type_id, date range; paginated), `GET /api/v1/interactions/{id}`, `GET /api/v1/interaction-types` (union of global `system_interaction_types` and tenant `interaction_types` — the tenant-only model method is not sufficient). Create delegates to the session-free `createInteractionWithSideEffects` helper (which already updates `opportunities.last_activity_at` in-transaction). **PUT/DELETE are deliberately out of v1**: update/delete side effects (online-meeting cleanup, storage cleanup, search events) are inline in the web actions and mobile doesn't edit/delete interactions — deferred until something needs them. Resource `interaction`.

**FR4 — Opportunities REST additions (main app).** `GET /api/v1/opportunities/work-queue` (wraps the session-free `assembleWorkQueue` core; server-composed why-sentences included) and `GET /api/v1/opportunities/{id}/timeline` (requires first extracting a small timeline core — the query is currently inline in the `withAuth` wrapper of `opportunityTimeline.ts`). Correction from review: the existing opportunity routes **are** registered in the OpenAPI generator (`registerOpportunitiesV1Routes`, 27 endpoints) — the checked-in spec artifacts are merely stale. So FR4's OpenAPI work is: register the new route families (interactions, inventory, work-queue/timeline) and regenerate; sync via alga-openapi-sync at the end.

**FR5 — Mobile capabilities gating (main app + mobile plumbing).** Redesigned after review: the existing `/api/v1/mobile/auth/capabilities` endpoint is **unauthenticated pre-auth config** (edition, oauth providers, TTLs) consumed only by the sign-in screens — per-user feature flags cannot live there. Instead: new authenticated `GET /api/v1/mobile/me/capabilities` returning `features.inventory` and `features.opportunities` (tenant product `psa` AND `inventory:read` / `opportunities:read` RBAC), called after auth and on app-foreground. Mobile side needs plumbing that does not exist today: a session-scoped capabilities store/context, and conditional `Drawer.Screen` registration (the drawer is currently fully static). Old-server/new-app degrades gracefully: endpoint 404 → flags false → tabs hidden.

**FR6 — Mobile Inventory section.** New drawer tab + screens: Scan (camera, resolver card, torch, haptics, manual-entry fallback), Stock list (search, low-stock badge) + product stock detail (levels by location, units list for serialized), Unit detail (status/client/warranty/movements), Receive flow (manual + from scan card; serial accumulator), Adjust flow (reason required), Counts (list/start/record/submit), PO receiving flow, Transfer receive flow. API module `src/api/inventory.ts` (+ purchaseOrders in same module) with colocated tests asserting method/path/headers. i18n namespace `inventory`.

**FR7 — Mobile Opportunities section.** New drawer tab + screens: Queue (sections + why-sentences from FR4 endpoint), Pipeline list (existing list endpoint; search + status filter), Deal detail (stage/values/next-action card/contact/timeline), Complete-action flow (successor required — mirrors web CompleteActionDialog), Log-interaction sheet (type picker: Call/Email/Note; duration; notes), Call flow (`tel:` + resume-prompt), Schedule-follow-up sheet (POST /api/v1/schedules with `work_item_type` omitted — the create schema's enum has no `ad_hoc`; the service maps non-ticket/project entries to `ad_hoc` server-side; mobile's `CreateScheduleEntryInput` type needs the same correction), Win (calls the existing win endpoint — which runs close gates and conversion prep, NOT a plain status write; gate failures surfaced verbatim; success shows a "finish conversion on web" note) / Lose (reason enum, lost_to for chose_competitor). API module `src/api/opportunities.ts` + extend `src/api/` with `interactions.ts`. i18n namespace `opportunities`.

**FR8 — Inventory workflow-engine gaps (main app).** 
- New `shared/workflow/runtime/actions/businessOperations/inventory.ts` registering designer-visible actions with Zod schemas: `inventory.get_availability` (service_id → levels/available by location), `inventory.find_units` (serial/mac/status filters), `inventory.adjust_stock` (delta + reason), `inventory.create_purchase_order_draft` (vendor + lines). Session-free, tenant-scoped, RBAC-consistent with other business-ops modules; registered alongside the opportunities metadata pattern.
- Event catalog completion for SO/PO lifecycle events: `*_CREATED/UPDATED` are already published; `INVENTORY_SALES_ORDER_DELETED` and `INVENTORY_PURCHASE_ORDER_DELETED` are declared in the type union but **never published** — add the missing emit sites in the delete actions, then catalog all six. Never catalog an event with no emitter. (Stock-unit CRUD events stay out of the catalog — search-index churn, not business events.)
- New events, published + cataloged: `INVENTORY_TRANSFER_DISPATCHED`, `INVENTORY_TRANSFER_RECEIVED`, `INVENTORY_COUNT_SUBMITTED`, `INVENTORY_COUNT_APPROVED`. (RMA_STATUS_CHANGED cut after review: RMA is out of mobile scope and unit-movement events already cover most transitions; pure-status events move to the loaner/RMA-aging follow-up plan.)
- **Trigger-safety checklist per event (three touch points)**: schema in `packages/event-schemas/.../inventoryEventSchemas.ts` + entry in `workflowEventPayloadSchemas` map + catalog seed row with `payload_schema_ref`. Catalog membership alone reproduces the UNKNOWN_TRIGGER_EVENT failure class.
- Gap fix: `adjustStock` (and cycle-count approval, which adjusts) emits `INVENTORY_STOCK_LOW` when the adjustment crosses the reorder point — today only fulfillment and materials consumption emit it.

### Non-functional Requirements

- Scan-to-card p50 under ~1.5s on LTE: the lookup endpoint is one round trip and indexed (existing serial/MAC indexes; new barcode index).
- REST layer contains no duplicated business logic: every write goes through the same `packages/inventory` / `packages/clients` / `packages/opportunities` code path the web actions use (transaction, movement ledger, events, notifications).
- All new tables/queries tenant-scoped per Citus rules (no new tables expected; barcode column is additive).
- Mobile additions follow existing lint/typecheck/test gates (`ee/mobile`: eslint max-warnings 0, tsc strict, vitest).
- API changes are additive; no breaking changes to existing v1 consumers.

## Data / API / Integrations

- Migration: `service_catalog.barcode` + partial unique index (additive, reversible).
- Migration(s): event-catalog seeds for FR8 (upsert pattern, same as `20260702150000`).
- No other schema changes. (`stock_units` serial/MAC and all inventory tables already fit the flows.)
- OpenAPI: register interactions, inventory, purchase-order, opportunity work-queue/timeline routes; regenerate `sdk/docs/openapi/*`; sync to nm-store dev portal via the `alga-openapi-sync` skill (separate follow-up commit).
- Mobile: `expo-camera` already provisioned (plugins + iOS/Android permissions present); broaden the camera copy in `app.json` (plugin config is the source of truth — regenerate native projects rather than hand-editing the checked-in Info.plist, which already drifts from app.json). Note: `codabar` scanning requires iOS 15.4+.

## Security / Permissions

- All new REST endpoints authenticate via the existing `x-api-key` middleware and enforce per-resource RBAC identical to the server actions they wrap (`hasPermission` re-fetches roles from the API key's user — verified to work session-free); inventory writes additionally enforce location scoping (van/home rules).
- Product gating (corrected after review — `enforceServerProductRoute` is a web/RSC guard, not usable for REST): the REST seam is `ApiBaseController.assertProductApiAccess` / `resolveProductApiBehavior`, and unlisted API paths **default to denied for AlgaDesk**, so new controllers extending `ApiBaseController` are covered automatically. Add explicit `API_RULES` entries in `productSurfaceRegistry.ts` for the new families anyway (metadata visibility correctness). Deliberate decision: `/api/v1/interactions` goes into `api_helpdesk_allowed` — interactions are core CRM that AlgaDesk's web UI already uses; inventory/opportunity/work-queue routes stay PSA-only. Capabilities endpoint hides the sections client-side.
- Interactions default `visibility='internal'`; the REST layer does not expose client-portal visibility controls in v1.
- No secrets/config changes; no new external services.

## Observability

Standard action logging only (house default). No bespoke metrics in v1.

## Rollout / Migration

- Everything is additive. The barcode column ships empty; products work without it (SKU/serial/MAC resolution still functions).
- Server changes deploy before the mobile release (mobile store review lags anyway); capabilities flags make old-server/new-app combinations degrade to hidden tabs.
- Mobile ships via the normal EAS TestFlight/Play-Internal pipeline; no feature flag on the mobile side beyond the capabilities gate.
- Commit in logical batches (commitGroups in features.json); OpenAPI regen + doc sync last.

## Open Questions — resolved after critique review

1. **Scan-card "Count this shelf"**: no — Counts-tab entry only. The count record screen already has scan-to-count; a scan-card jump adds cross-segment session state for no new capability.
2. **Queue "money found" on mobile**: omitted in v1. Read-only cards are a dead-end UI; the suggestion accept/dismiss/snooze REST routes already exist, so an actionable version is cheap in v1.5.
3. **Won on mobile**: kept — but it calls the real win endpoint (close gates + conversion prep run server-side), surfaces gate failures verbatim, and shows the "finish conversion on web" note on success. No bypass status write; no blocking.
4. **Barcode uniqueness**: per-tenant unique among products, enforced on the **normalized GTIN** (see FR1) — uniqueness and lookup share one normalization function, or iOS/Android can insert the "same" barcode twice.
5. **`inventory.adjust_stock` workflow action**: ship enabled (precedent: `crm.create_activity_note` is an enabled write action gated by run-actor RBAC). Designer metadata documents the attribution caveat: movements' `performed_by` is the workflow definition's publisher, not "the workflow".

## Acceptance Criteria (Definition of Done)

1. From the mobile Inventory tab, scanning a product UPC (barcode set in web Products UI), a product SKU barcode, a unit serial barcode, and a unit MAC barcode each resolves to the correct card in one scan; an unknown code shows candidates/manual search.
2. A tech can receive a serialized PO line by scanning three serials in a row; the PO line advances to received, `stock_units` rows exist with correct location/cost, movements are in the ledger, and the same `INVENTORY_PO_RECEIVED` event/notification fires as a web receive.
3. A blind count recorded and submitted on mobile appears in the web Counts review queue; location write-scoping blocks a tech from receiving (manual **and PO-line**, per the FR2a scoping fix), adjusting, or counting at a location they can't write (403 + friendly mobile error).
4. From a mobile opportunity, tapping call opens the dialer; returning to the app prompts to log the call; saving creates a `Call` interaction linked to opportunity/client/contact, visible in the web timeline, and refreshes `last_activity_at` (staleness resets).
5. Completing a next action on mobile requires naming the successor action + due date; the queue reflects it immediately.
6. "Schedule follow-up" creates an `ad_hoc` schedule entry visible in the mobile Schedule tab and web calendar.
7. AlgaDesk-tenant users and users lacking RBAC see no Inventory/Opportunities tabs (capabilities), and direct API calls return 403.
8. A workflow can be built in the designer that triggers on `INVENTORY_STOCK_LOW` and calls `inventory.create_purchase_order_draft`; transfer dispatch/receive and count submit/approve emit cataloged, schema-registered events (all three touch points).
9. `ee/mobile` lint/typecheck/vitest green; server typecheck green; new REST surface covered by **both** harnesses: unit-pattern tests (Zod schemas, OpenAPI registry, service delegation with mocked db — the actual house REST-test pattern) and an integration subset for persistence/RBAC/product-boundary/constraint assertions; OpenAPI spec regenerated with all new routes present.
10. All server logic reachable from both web actions and REST goes through the FR2a cores / shared helpers (verified by the absence of duplicated movement/ledger logic in the API layer), and existing inventory web-action tests stay green through the extraction.
