# SCRATCHPAD — inventory ↔ PSA integration

## Provenance

Scope = the 6 items from the 2026-07-02 fresh-eyes integration audit (4 parallel explorations:
tickets, client/assets, billing, cross-cutting). Robert approved all 6 and delegated planning +
offload judgement. Full findings are in the session; load-bearing facts repeated below.

## Load-bearing audit facts

- Materials UI lives in `packages/tickets/src/components/ticket/TicketMaterialsCard.tsx` (default
  collapsed, right rail of TicketProperties), backed by
  `packages/tickets/src/actions/materialCatalogActions.ts`. Projects mirror:
  `packages/projects/src/components/ProjectMaterialsDrawer.tsx` + its own materialCatalogActions.
  Third copy: `packages/billing/src/actions/materialActions.ts` (the only one with hasPermission).
  REST API fourth path: `server/src/lib/api/services/TicketService.ts:860` — inserts billing row,
  NEVER consumes stock.
- `recordStockConsumption` in `packages/inventory/src/lib/consume.ts` (no-op unless
  `product_inventory_settings.track_stock`); `applyOnHandDelta` in `lib/levels.ts` has NO negative
  guard.
- Asset link: `packages/inventory/src/lib/assetLink.ts` `createAndLinkDeliveredAsset` (post-commit,
  called from fulfillmentActions.ts:422, dropShipActions.ts:397); writes `assets.service_id`,
  `assets.stock_unit_id`, `stock_units.asset_id`; asset_type hardcoded 'unknown' (assetLink.ts:32).
  Assets UI never reads these columns.
- Client tabs: `packages/clients/src/components/clients/ClientDetails.tsx:1231-1482` (13 tabs, none
  inventory).
- Quote conversion: `packages/billing/src/services/quoteConversionService.ts` — contract (L271) +
  invoice (L501) + both (L665); "sales_order" appears nowhere. Dialog:
  `packages/billing/src/components/billing-dashboard/quotes/QuoteConversionDialog.tsx`.
- SO invoicing bridge: `packages/billing/src/actions/salesOrderInvoicingActions.ts:34`
  (generateInvoiceForSalesOrder, idempotent on quantity_invoiced, appends to open draft via
  so_line_id backlink). `invoice_charges.so_line_id` stored (invoiceService.ts:346,539) but no UI
  reads it.
- SO UI: `SalesOrdersManager.tsx:401` raw "Client ID" text input; `SalesOrderDetail.tsx:415` client
  name plain text. House picker: `@alga-psa/ui/components/ClientPicker`.
- Search registry: `packages/types/src/search.ts` SEARCH_OBJECT_TYPES (28 types) +
  `server/src/lib/search/indexers/` + `server/src/lib/eventBus/subscribers/searchIndexSubscriber.ts`
  OBJECT_ID_FIELDS.
- Event catalog: `packages/event-schemas/src/schemas/eventBusSchema.ts`; workflow `event_catalog`
  table seeded by migration 20250308171000. Inventory publishes zero events today.
- Notifications: category template `server/migrations/utils/templates/internal/categoriesAndSubtypes.cjs`.
- Reports registry: `packages/msp-composition/src/reports/Reports.tsx` REPORTS array (~L67);
  definitions `packages/reporting/src/lib/reports/definitions/` (profitability.ts is labor-only).
- Margin: dashboard tile only (`inventoryDashboardActions.ts:180-198`); `marginReport` in
  `inventoryReportingActions.ts:132` defined but UNWIRED (no caller).
- Accounting export: `packages/billing/src/services/accountingExportService.ts` (export_type ??
  'invoice'), QBO `packages/integrations/src/actions/qboActions.ts` — AR only, zero vendor_bill refs.
- Permissions seeded (20260626100600): inventory, vendor, purchase_order, sales_order,
  stock_transfer, stock_location (+cycle_count later). Enforced in code: inventory, purchase_order,
  sales_order, cycle_count only. PermissionsMatrix is data-driven (auto-surfaces).
- Dependency direction: tickets → inventory (NOT billing, NOT clients); projects → inventory +
  clients (NOT billing). Hence canonical materials service MUST live in packages/inventory (D3).

## Decisions

- D1..D9 in PRD. Key: negative stock blocked on consume only; quote products→SO on_fulfillment
  (never also invoiced at conversion); canonical materials in packages/inventory; events
  post-commit + edge-triggered stock-low; QBO-only AP export; activity feed & /api/v1 non-goals.

## Lane plan (offload routing per model-offload skill + UI exception)

- **Wave 0 (Claude, done first):** plan artifacts + contract stubs (real files, signatures +
  throwing/empty bodies) so UI lanes typecheck against real exports: availability action, client-360
  read actions, provenance action, invoice COGS action, convertQuoteToSalesOrder action, vendor-bill
  export action stub, picker-row type extension.
- **Wave 1 (parallel):**
  - **Claude (complexity 8-9):** S6 consolidation (canonical materials service + delegation +
    permission gating + API parity) and S2 backend guard (F014/F015 inside the row lock) + F011
    picker search extension + F005 availability impl.
  - **codex A (6-7):** S1 backend — quoteConversionService SO target, F004 migration, F009 SO→invoice
    read, F010 backlinks. NO component files.
  - **codex C (7):** S5 backend — F039 COGS action impl, F044 profitability COGS, F045/F046 export
    engine + QBO bills, F042 marginReport wiring backend. NO component files.
  - **opus UI-1:** S1 UI (F002 dialog, F006 chips, F007 picker, F008/F009/F010 links) + S2 UI
    (F012/F013/F016/F017/F018).
  - **opus UI-2:** S3 UI (F022/F023/F025/F027) + S3 read-action impls (F019-F021, F024, F026 —
    small, colocated with its UI) + S5 UI (F040/F041/F043 report page + registry, F047 export
    button).
- **Wave 2 (after wave 1 merges):** codex B — S4 events/search/notifications (F028-F038). Runs last
  because it edits salesOrderActions/fulfillmentActions/rmaActions/receiving + the canonical
  materials path (stock-low emit), all touched by wave 1.
- **Wave 3 (Claude):** review diffs, migrate:ee, DB suite, tsc, browser smoke (port 3578 EE),
  flip features/tests flags, commit.

## Collision map

- salesOrderActions.ts: codex A (wave 1) then codex B (wave 2). SalesOrdersManager/SalesOrderDetail:
  opus UI-1 only.
- consume.ts/levels.ts/materials: Claude only (wave 1); codex B adds stock-low hook wave 2.
- QuoteConversionDialog/QuoteForm: opus UI-1 only; quoteConversionService: codex A only.
- ClientDetails/assets UI/Reports.tsx/VendorBillsManager: opus UI-2 only.
- accountingExportService/qboActions: codex C only.

## Env notes (repeat of dev-stack runbook)

- Dev server pane 7e51cbab-... port 3578 EDITION=enterprise; browser pane 667b4f6c-... via algadev.
- Migrations: `cd server && DB_NAME_SERVER=server npm run migrate:ee`.
- DB tests run against the real dev DB — unique per-test labels, rolled-back transactions.
- codex sandbox cannot reach localhost:5432 — run migrations/suites locally after offloads.

## Discoveries during implementation

(append here)
- (2026-07-02, codex A) S1 backend uses a quote-level SO backlink for double-billing prevention:
  `sales_orders.quote_id` is the durable marker, and `convertQuoteToDraftInvoice()` checks for a
  linked SO before selecting invoice lines. When present, selected one-time product quote lines are
  filtered out of the draft invoice; discount lines explicitly tied to those product quote items or
  product service IDs are filtered with them. No quote-item line marker was added.
- (2026-07-02, codex A) `quote_items.service_item_kind` is the quote-line product snapshot, but the
  conversion also verifies `service_catalog.item_kind='product'` for older quote rows where that
  snapshot may be absent.
- (2026-07-02, codex A) Quote→SO idempotency returns the existing linked sales order instead of
  throwing. The migration adds a partial unique index on `(tenant, quote_id)` where `quote_id IS NOT
  NULL`, so manual SOs without a quote link are unaffected.
- (2026-07-02, codex C) SO fulfillment `stock_movements` use
  `source_doc_type='sales_order'` and `source_doc_id=sales_orders.so_id`, not `so_line_id`. F039 and
  F042 recover line/service COGS through `invoice_charges.so_line_id -> sales_order_lines` and then
  match movements by `(tenant, so_id, service_id)`. If one SO has multiple lines for the same
  service, attribution follows that existing ledger limitation; no schema migration was added.
- (2026-07-02, codex C) Material invoice charges do not persist the material id. F039 pairs billed
  ticket/project material rows back to invoice product charges by `(invoice, service, quantity,
  rate, description)` plus row-number ordering, then reads COGS from the material row's
  `stock_movements.source_doc_id`.
- (2026-07-02, codex C) Contract profitability hardware COGS is attributed through the same YTD
  invoice window/status model as the existing profitability report. It includes SO-backed invoice
  charges and billed ticket/project materials whose stock movements are attached to invoices in the
  report period. Labor-only periods get a zero hardware component, so gross profit remains
  revenue-minus-labor.
- (2026-07-02, codex C) QBO vendor bills reuse `accounting_export_batches/lines/errors` with
  `export_type='vendor_bill'`; `accounting_export_lines.invoice_id` is the generic exported document
  id for this export type. No migration was needed because the column has no invoice FK. External
  refs are also persisted in `tenant_external_entity_mappings` with
  `alga_entity_type='vendor_bill'` for idempotency.
- (2026-07-02, codex C) QBO vendor-bill lines use an account-based expense detail. The default
  expense account is read from the existing tenant settings JSON pattern:
  `tenant_settings.settings.accountingSync.defaultExpenseAccountRef`. Validation fails clearly when
  it is absent rather than misusing the payment deposit account.
- (2026-07-02, Claude) AUDIT CORRECTIONS found during implementation: (1) vendor/stock_transfer/
  stock_location permissions WERE already enforced in their actions (requireXPerm helpers) — F053-F055
  are verification + a contract test (materialAuthorizationParity.contract.test.ts), not new code.
  (2) The 'inventory' notification category + 'inventory-low-stock' subtype + templates + a daily
  location-manager digest job already existed (20260701091000, remediation F037/F038) — F034/F035
  rescoped to the PO-received subtype/subscriber only; INVENTORY_STOCK_LOW event feeds workflows, not
  notifications. (3) The public API has NO material DELETE endpoint — F052 verified n/a.
- (2026-07-02, Claude) Canonical materials service: packages/inventory/src/lib/materials.ts. Gates:
  tickets wrapper ticket:read/update, projects wrapper project:read/update, billing wrapper keeps
  billing:*, REST API delegates with MaterialValidationError/InsufficientStockError → 400 mapping
  (D10). Serialized products now REQUIRE unit_id + quantity=1 at the canonical layer (was silent
  billing-only insert on the API path). consume.ts guard: FOR UPDATE on stock_levels, exact-to-zero
  allowed, InsufficientStockError carries .available; no-location and not-in-stock-unit now throw
  instead of silent no-op. materials.ts must NOT import @alga-psa/db or assetLink statically
  (vitest import chain) — local runInTransaction + lazy assetLink import.
- (2026-07-02, Claude) Fixed codex A's migration: composite FK ON DELETE SET NULL would null tenant
  (NOT NULL) — now a plain FK; quote deletion is blocked while a linked SO exists.
- (2026-07-02, Claude) server tsc needs NODE_OPTIONS=--max-old-space-size=16384 (8192 OOMs).
  Infrastructure tests need DB_PASSWORD_ADMIN/DB_PASSWORD_SERVER exported from server/.env.local.
  stock_movements is append-only (trigger) — concurrency tests use a persistent inactive fixture
  product reset via adjust movements.
- (2026-07-02, codex B) Inventory workflow events use the requested `tenant` + snake_case payload
  shape. `convertToWorkflowEvent()` and event-bus processed-event keys now fall back from
  `payload.tenantId` to `payload.tenant` so inventory events do not end up in an `unknown` workflow
  tenant or processed bucket.
- (2026-07-02, codex B) F034/F035 stayed rescoped: `20260701091000_inventory_low_stock_notification`
  already owns the `inventory` category, `inventory-low-stock` subtype/templates, and the daily
  location-manager digest job. B added only `inventory-po-received` plus an
  `INVENTORY_PO_RECEIVED` subscriber. `INVENTORY_STOCK_LOW` is emitted for workflows/search
  automation only, not in-app low-stock notifications.
- (2026-07-02, codex B) Search live-indexing for inventory uses explicit inventory entity events:
  `INVENTORY_SALES_ORDER_*`, `INVENTORY_PURCHASE_ORDER_*`, and `INVENTORY_STOCK_UNIT_*`.
  `INVENTORY_PO_RECEIVED` and `INVENTORY_SO_FULFILLED` are also source events for the PO/SO
  indexers because those domain events change status/progress fields.

## Wave-3 verification (2026-07-02, Claude)

- Suites: packages/inventory 100/100 (18 files, incl. stockLowSignal + inventoryEvents);
  packages/billing tests/moneyStoryBackend.test.ts 3/3 (moved from src/actions — billing vitest only
  includes tests/**; added @alga-psa/auth mocks to avoid the next-auth import chain);
  server quoteConversion infrastructure 16/16 (needs DB_PASSWORD_ADMIN/SERVER exported from
  server/.env.local). Full server tsc clean (16GB heap).
- Migrations batch 12 (quote link + default_asset_type) and 13 (event catalog seeds + PO-received
  notification subtype) applied via migrate:ee.
- Browser smoke (EE, port 3578, glinda): margin report page + central Reports catalog 'inventory'
  category; client Equipment tab live (SOs w/ totals, delivered serials, RMAs); SO create uses
  ClientPicker; SO detail → invoice links verified against a real invoice (client_name join added to
  getSalesOrder — was showing UUID); ticket picker amber "On hand: 3" badge (reorder 5) + per-location
  display; insufficient-stock inline error "3 available, 5 requested" with inputs preserved; qty-2 add
  decremented ledger 3→1; serialized install (DEMOAP-0001) delivered the unit and auto-created asset
  'Demo WiFi AP AX3000 DEMOAP-0001' with asset_type network_device (F026) and the asset detail shows
  the Inventory provenance section (product/SKU/serial/MAC/delivered; origin SO correctly absent for
  ticket installs); vendor-bills screen has per-bill export button + not-exported badge; global search
  registers Sales order / Purchase order / Stock unit filters (index round-trip not verifiable in dev —
  even pre-existing types show 0; indexing runtime/tokenization, not this code).
- Demo data seeded in dev DB: 'Cat6 Patch Cable 3ft' (DEMO-CAT6-3FT, tracked, reorder 5) and
  'Demo WiFi AP AX3000' (DEMO-AP-AX3000, serialized, creates_asset_on_delivery,
  default_asset_type network_device) + USD prices; two orphan vitest fixtures deactivated (one is the
  persistent T004 race fixture, inactive by design).
- Dev-server note: after heavy multi-package edits the Next dev hot-reload served stale server
  actions ("No products found" from a query proven good at the lib layer) — restart the dev server
  before browser-verifying cross-package changes.
- QBO vendor-bill export not exercised against a live QBO (no dev realm); engine+adapter covered by
  T017 with a mocked client.
