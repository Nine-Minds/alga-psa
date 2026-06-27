# SCRATCHPAD — Sales Order Documents

## Decisions
- 2026-06-26: Order Confirmation is the first document. Fully designable (Phase 2). Architecture =
  **Approach C** (generic document-type-keyed spine, SO = first registered type; invoice/quote
  untouched). Phasing: P1 render MVP (standard template, no DB/designer) → P2 generic designer +
  storage → P3 polish. Approved via brainstorming. Design: `docs/plans/2026-06-26-sales-order-documents-design.md`.

## Key reference code (the quote blueprint)
- Render: `packages/billing/src/lib/invoice-template-ast/server-render.ts` → `renderTemplateAstHtmlDocument(ast, evaluation, opts)`
- Evaluate: `evaluateTemplateAst(ast, model)` → `renderEvaluatedTemplateAst` (both data-agnostic)
- PDF: `packages/billing/src/services/pdfGenerationService.ts`
  - `generatePDF({ invoiceId | quoteId | documentId })` — add a `salesOrderId` branch
  - `generatePDFBuffer(html, ast?)` — generic Puppeteer step (reuse as-is)
  - `getQuoteHtml()` (line ~390) — the method to mirror as `getSalesOrderHtml()`
- Adapter blueprint: `packages/billing/src/lib/adapters/quoteAdapters.ts` → `mapDbQuoteToViewModel(knex, tenant, quoteId)`
- Quote bindings/std/selection: `packages/billing/src/lib/quote-template-ast/{bindings,standardTemplates,templateSelection}.ts`
- Designer kind discriminator: `packages/billing/src/components/invoice-designer/utils/documentKind.ts`
  (`DesignerDocumentKind`, `resolveDesignerDocumentKind`) — Phase 2 adds `'sales-order'`
- Quote mgmt UI (Phase 2 analog): `server/src/app/msp/quote-document-templates/page.tsx`,
  `packages/billing/src/components/billing-dashboard/quotes/QuoteDocumentTemplate{sPage,Editor}.tsx`
- Quote actions (Phase 2 analog): `packages/billing/src/actions/quoteDocumentTemplates.ts`

## Sales Order data
- Types: `packages/types/src/interfaces/inventory.interfaces.ts` — `ISalesOrder`, `ISalesOrderLine`.
- Tables: `sales_orders` (so_id, so_number, client_id, status, order_date, expected_ship_date,
  ship_to jsonb, currency_code, client_po_number, invoice_mode, allocation_mode, notes),
  `sales_order_lines` (so_line_id, service_id, quantity_ordered, quantity_fulfilled,
  quantity_invoiced, unit_price [cents], cost_snapshot, tax_rate_id).
- SO→invoice already exists: `packages/billing/src/actions/salesOrderInvoicingActions.ts` (`generateInvoiceForSalesOrder`).
- Inventory SO UI: `packages/inventory/src/components/SalesOrdersManager.tsx` (Download button goes here).

## Resolved
- **Package dep direction (F018): RESOLVED — use an API route.** `salesOrderInvoicingActions.ts`
  states "billing already depends on inventory", so inventory CANNOT import billing (cycle).
  The Download trigger goes through a Next API route under `server/` (which can import billing),
  mirroring `server/src/app/api/v1/invoices/[id]/pdf/route.ts`. Planned route:
  `server/src/app/api/v1/sales-orders/[id]/document/route.ts` → calls billing pdf service.
- **Billing reads SO directly:** `salesOrderInvoicingActions.ts` queries `sales_orders` /
  `sales_order_lines` via knex inside billing. The adapter does the same (no inventory import).

## Open questions / gotchas
- **Tax (F006):** SO lines have `tax_rate_id`, not a stored tax amount; the invoicing path delegates
  tax to `generateManualInvoice`. Phase 1 adapter computes subtotal from lines and sets tax = 0,
  total = subtotal (don't fabricate tax). The standard template should frame totals honestly
  (e.g. "Estimated total — final tax on invoice"). Revisit if a cheap tax calc is available.
- **Money:** `unit_price` is integer cents. Reuse the same money formatting the templates use.
- **Verify live:** dev server caches `'use server'` modules — touch the importing route to force a
  rebuild when the action doesn't hot-reload (known quirk on this stack). Dev server: port 3345.

## Commands
- Typecheck billing: `cd packages/billing && npx tsc --noEmit`
- Typecheck inventory: `cd packages/inventory && npx tsc --noEmit`
- Inventory tests: `cd packages/inventory && npx vitest run`
- **Billing/server-config tests (packages/billing/src/**): `npx vitest run --root=server <filter>`**
  (the root vitest config = server/vitest.config; its `../packages/**` include only resolves with
  root=server. Plain `npx vitest run` from repo root finds nothing.)
- DB (scripts): knex from repo-root node_modules; host localhost:5472, db 'server', creds from
  `server/.env.local` (DB_USER_ADMIN/DB_PASSWORD_ADMIN). Tenant 6d178771-ad9a-4d43-8809-83992745f8f9.

## Environment blocker (2026-06-27)
- The dev environment drifted after an overnight restart: the test DB on :5472 is DOWN; the running
  postgres is devstack_postgres on :5432 but its `server` db has no inventory tables (app data is
  behind pgbouncer:6432, docker-internal). The dev server runs on :3345 but `NEXTAUTH_URL=http://localhost:3578`
  (dead port) → unauthenticated requests 307-redirect to :3578/auth/signin (connection refused).
- Consequence: authenticated live browser verification + DB-backed tests (T004/T005/T006) are
  BLOCKED until the env is healthy. What IS verified: the API route compiles and enforces auth
  (`GET /api/v1/sales-orders/<id>/document` → 401 unauthenticated, JSON), the render is proven by
  the smoke test (real AST → correct HTML), the adapter mapping by the unit test, and typecheck is
  clean across types/billing/inventory. The unverified remainder (authenticated PDF download, the
  SQL joins in mapDbSalesOrderToViewModel) mirrors proven quote/invoice code.

## Progress log
- 2026-06-26: Plan created (PRD + features + tests). Starting Phase 1.
- 2026-06-26: **F001–F007 done** — `SalesOrderViewModel` types
  (`packages/types/src/interfaces/salesOrderDocument.interfaces.ts`) + adapter
  (`packages/billing/src/lib/adapters/salesOrderAdapters.ts`: pure `assembleSalesOrderViewModel`
  + IO `mapDbSalesOrderToViewModel`, reusing `fetchTenantParty`). Unit test passing (5 cases:
  amounts, subtotal/total, name resolution, no-lines guard, unknown-service). Types tsc clean;
  billing tsc clean for the new files. NOTE: pure mapping is tested; the DB round-trip (T004/T005)
  and not-found guard (T002) come with the render+wiring slice. Dropped a `// LEVERAGE: party-adapter`
  marker (client-party fetch duplicated from quoteAdapters; converge in Phase 2).
- Next: F008–F013 — SO template bindings + standard confirmation AST + resolve stub, then F014–F019
  render+PDF wiring (getSalesOrderHtml + generatePDF branch) and the API-route download trigger.
- 2026-06-27: Phase 1 complete (F001–F021). Phase 2 *verifiable* spine done (F103/F104 registry,
  F110 resolution precedence, F111 SO path wired through the generic resolver) — all typecheck + unit
  tested (resolution 4, registry 3). 33 SO/spine tests green via `vitest run --root=server`.
- ENV-GATED remainder (cannot build verified until the dev env is healthy — DB up + auth port aligned):
  Phase 2: F100–F102 (3 generic migrations), F105–F109 (generic CRUD + preview actions), F112–F114
  (management route + DesignerShell editor), F115 (designer-kind + buildInvoiceExpressionPathOptions
  in @alga-psa/workflows/expression-authoring — cross-package, needs the browser to verify the SO
  designer renders), F116 (seed). Phase 3: F200–F205. Also the Phase-1 DB-backed tests T004/T005/T006
  and the live authenticated PDF check. Resume here once Tailscale is up + the stack is restored.
- 2026-06-27: **Env restored + entire PRD landed and live-verified.** Phases 1–3 complete; 43/44
  features implemented (F205 a grounded proposal — see below). Commits: c9ba4a28 (route→/api/inventory
  + middleware skip, fixes live 401), 2553c082 (split pure `salesOrderViewModel.ts` out of the
  knex adapter to fix client-bundle `Can't resolve 'fs'`), 6abd052f (F203/F204 packing slip + pick
  list types; render path generalized to documentType), deded793 (F200 client override action),
  f15ae047 (SO row Document → dropdown of all 3 types).
  - **Live verification (algadev pane, SO-DEMO-001 = 1a1c0745-…):** all three download 200 application/pdf
    — confirmation 59191B (prices+totals $10,225, drop-ship, pre-tax note), packing-slip 46917B
    (Ship To + Ordered/Shipped + from_stock/drop_ship source incl. 5/3 partial, NO prices),
    pick-list 30865B (☐ check column + Qty/Product/SKU + Picked-by line, NO customer/prices).
    Content extracted via pdftotext — correct.
  - **Two real bugs typecheck couldn't catch, found live:** (1) the doc route sat in the API-key-gated
    `/api/v1` namespace → 401 on session-cookie fetch (moved to /api/inventory + middleware skip);
    (2) a `'use server'` file may export ONLY async functions — an object export (DOCUMENT_TYPE_LABELS)
    threw "use server file can only export async functions" and 500'd ALL types until removed.
  - **Turbopack `'use server'` cache is sticky:** after the object-export fix, the stale broken module
    kept 500ing through touches + content edits; it self-cleared after ~a minute / a recompile. Budget
    time for this when editing action files.
  - **F205 (auto-attach confirmation to SO emails) = PROPOSAL, not built:** Sales Orders have no
    email/send flow to hook (invoices have invoiceEmailHandler/invoiceJobActions; quotes email in
    quoteActions; SOs have none). The PDF pipeline (downloadSalesOrderPDF / generatePDF) is ready to
    attach the moment an SO email flow exists; building SO email delivery is a separate initiative
    outside "SO documents" scope.
  - Visual smoke of the new Document dropdown was blocked by browser-relay flakiness in the Chrome
    extension (page itself serves 200) — left for the user to eyeball.
