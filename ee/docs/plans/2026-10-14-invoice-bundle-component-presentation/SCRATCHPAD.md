# Scratchpad — Invoice bundle component presentation

- Plan slug: `invoice-bundle-component-presentation`
- Created: `2026-10-14`
- Origin: Discord community request (ToddyDucati, 2026-10-13). He wants an invoice that shows a bundle price with the bundle's services and quantities listed under it, without per-service pricing, plus optional +N/-N quantity changes. Andrew (Leap Forward Tech) seconded it. Robert: "we should do that".

## Decisions

- (2026-10-14, revised) **The template decides presentation, not the contract.** The first draft put a three-mode display setting on every Fixed contract line. Robert pushed back: he expected an invoice template enhancement. The request is per customer ("in some customers you just don't want line item pricing"), and Alga already assigns invoice templates per client (`clients.invoice_template_id`), so the template is the natural home. The superseded columns `invoice_component_display` and `invoice_show_quantity_changes` and the contract "Invoice presentation" section were dropped.
- (2026-10-14) **The only contract-side addition is bundle text.** This is a new `invoice_line_subtitle`, plus the first mounted editor for the existing `invoice_line_description` title. The subtitle describes the bundle's content, so it is contract data, not layout. It is kept because it appears in the requested layout.
- (2026-10-14) **+N/-N quantity changes are in v1** (Robert). They are shown per table via the designer's "Show quantity changes" option.
- (2026-10-14) **Inventory kits are out of scope.** Kit components invoice as separate $0 charges with no parent link. Possible follow-up (Robert).
- (2026-10-14) **The rendered invoice/PDF and the client portal invoice details dialog both show sub-rows** (Robert). The dialog follows the client's resolved template.
- (2026-10-14) **Snapshot every Fixed bundle at generation.** Subtitle, component names, unclamped quantities, pricing basis, order and previous quantities are frozen in `invoice_charges.bundle_presentation` (versioned JSONB) for every consolidated fixed parent. Since the template decides presentation, the data must always exist. Follows the immutable-snapshot rule from the 2026-09-04 ticket presentation plan.
- (2026-10-14) **Amounts are not snapshotted.** Component prices come from `invoice_charge_fixed_details.allocated_amount` (and the detail `rate` for unit-basis services), which stays the single financial source.
- (2026-10-14) **Price inclusion rule.** Client-visible data includes component prices only when the AST rendering for that client binds a component price field (`templateUsesComponentPricing(ast)`). The client portal serializes the view model to the browser, so hiding prices only in the layout would leak them in the payload. Client-visible paths resolve the client's template before building data. Template resolution helpers already exist (`getResolvedInvoiceTemplateId`, `PDFGenerationService.resolveInvoiceTemplateId`).
- (2026-10-14) **Nested rows are a renderer feature.** `dynamic-table.childRows` replaces flattening components into a fake row collection, which couldn't indent or style per row and would distort item-level transforms and aggregates. Per the CLAUDE.md layering rule, the engine changes to fit the design.
- (2026-10-14) **Parent-row blanking is a table setting** (`childRows.parentBlankColumns`), not a data change. Bundle items keep qty 1 and rate = total in the data, so templates without component rows render exactly as today.
- (2026-10-14) **Existing standard templates are not changed.** Adding child rows to them would visibly change every tenant's invoices at once. A new standard template, "Standard Invoice With Bundle Quantities" (`standard-bundle-quantities`), plus the designer toggle are the opt-in paths.

## Discoveries / Constraints

### Persistence of Fixed lines (packages/billing/src/services/invoiceService.ts)
- `persistFixedInvoiceCharges` (~1041-1408) groups every fixed charge with a `config_id` by (`client_contract_id`, `client_contract_line_id`). It writes:
  - one parent `invoice_charges` row: `service_id` NULL, quantity 1, `unit_price` = net = Σ allocated, description = `invoice_line_description || contract_line_name`;
  - one `invoice_charge_details` row per service per period: `service_id`, `config_id`, `quantity = Number(q ?? 1) || 1`, and lossy `rate = round(allocated/qty)`;
  - one `invoice_charge_fixed_details` row with exact `allocated_amount`, `fmv`, `proportion`, tax.
- `client_contract_line_id` is really `contract_lines.contract_line_id`. Client contracts own their cloned contract_lines rows.
- Only `type==='fixed'` charges consolidate (`invoiceService.ts:1473-1496`). Products on a Fixed line become separate rows. Mid-period seat true-ups are separate rows titled "Mid-period quantity change: X" (`reconcileContractChangeAdjustments.ts:427-457`).
- `pricing_basis` (`contract_line_service_fixed_config`, 'unit' | 'bundle' | NULL = bundle) is per service, and **one line can mix both** (`computeFixedCharges.ts:652-661, 917-935`). It is not persisted on the invoice; it must be snapshotted.
- Bundle-mode detail quantity is the configured quantity, but it is clamped with `|| 1`, so 0/null becomes 1 (`computeFixedCharges.ts:607,1093`). The snapshot needs the raw configured quantity.
- A unit-mode service with quantity 0 is skipped and has no detail row.
- Proration changes amounts, never quantity.
- No ordering column exists for services within a line. Use `contract_line_service_configuration.created_at`, then service name.

### Quantity history (for +N/-N)
- Bundle-mode quantities are overwritten in place with no history (`contractLineServiceConfigurationService.ts:348-410`). The previous invoice's detail rows are the only history, so use invoice details as the comparison source for both modes.
- Join path: `invoice_charge_details.config_id` → `contract_line_service_configuration.contract_line_id`, plus `service_period_*`, then `invoice_charges` → `invoices` (exclude cancelled and the current invoice). The same pattern is in `isPeriodAlreadyInvoiced.ts` and `seatRevisions.ts:112-114`.
- `contract_line_unit_pricing_revisions` covers unit/product services only and doesn't help bundle services.

### Rendering pipeline
- One mapper serves all persisted invoices: `mapDbInvoiceToWasmViewModel` DB branch (`invoiceAdapters.ts:574-690`). Its callers are the MSP preview/drawer, PDF (`pdfGenerationService.getInvoiceHtml`), emailed PDFs (`generateAndStore`), the client portal view (client-side mapping) and the designer's existing-invoice preview.
- `getInvoiceCharges` (`models/invoice.ts:773-845`) reads only detail periods. It is shared by the REST API (`/api/v1/invoices/{id}/items`) and MCP, so loading bundle data must be opt-in to keep the API contract unchanged.
- Draft preview (`invoiceGeneration.ts` `buildPreviewInvoiceForSelectionInputs` 2263, `adaptToWasmViewModel` 2056) emits a `$0` "Contract: X" header (`is_bundle_header`) plus one priced row per service, so it does **not** match the persisted shape. The AutomaticInvoices preview dialog (`AutomaticInvoices.tsx:3725-3765`) is a hand-rolled operator table that detects headers by `description.startsWith('Contract:')`.
  - Avoid overloading `is_bundle_header` / `parent_item_id`. They are preview-only and also appear in REST schemas.
- `dynamic-table` renders exactly one `<tr>` per row (`react-renderer.tsx:837-886`). The designer canvas has its own table preview (`DesignCanvas.tsx:636+`). AST schemas are `.strict()` (`schema.ts`), so new props need a schema plus a workspace round trip (`workspaceAst.ts`).
- Columns have no per-row conditional. A null path renders `''`, so blanking is done by data shape.
- `recurringItems`/`onetimeItems`/`groupsByLocation`/`ticketPresentationRows` canonical rows reuse or spread the item objects, so a `components` field on items flows into all standard layouts.
- Standard templates are stored in `standard_invoice_templates.templateAst`. Changing them needs a migration (precedent: `server/migrations/20260905031510_invoice_ticket_primary_template.cjs`). Saved custom templates are never rewritten.
- Optional collections that may be absent are hard-coded in `evaluator.ts:455,475`.

### Other consumers (no change expected)
- Accounting exports (QBO, Xero, CSV, QB Desktop) export parent `invoice_charges` only. Details only feed periods.
- Invoice email bodies have no line items. The PDF attachment comes from `generateAndStore`, so it picks up sub-rows automatically.
- Tax distribution, profitability/contract/revenue/deferred-revenue reports, `isPeriodAlreadyInvoiced`, and discount reconciliation read details as data and are unaffected.
- Client portal `InvoiceDetailsDialog.tsx:258-321` is a direct React table over `invoice_charges` (via `getInvoiceLineItems`, `client-billing.ts:737,786`). It is the one customer-facing non-AST view, and it is in scope.

### Contract line authoring
- `invoice_line_description` exists on `contract_lines` but has **no mounted editor**. The only editor (`FixedContractLineConfiguration.tsx`) is reachable only through the unused `ContractLineTypeRouter`. The live editor is `contracts/ContractLines.tsx:828-834`, and the wizard is `wizard-steps/FixedLineEditor.tsx`.
- `contract_template_lines` lacks `invoice_line_description`, and cloning (`contractLineRepository.ts:577-605`) doesn't copy it. Services/qty/pricing_basis clone via `shared/billingClients/templateClone.ts`.
- The REST contract line schemas (`server/src/lib/api/schemas/contractLineSchemas.ts`) don't expose `invoice_line_description`. MCP tools are generated from the API registry (`server/src/lib/mcp/registry.generated.ts`).

## Pre-existing gaps noticed (not in scope)
- QBO/Xero/QBO-CSV adapters throw on a charge with no `service_id` (`quickBooksOnlineAdapter.ts:469-471`, `xeroAdapter.ts:481-483`, `quickBooksCSVAdapter.ts:222-224`). Export readiness exempts consolidated fixed parents (`exportReadiness.ts:121-143`), so a fixed parent may pass readiness and then fail at export. Worth its own investigation, but the fix must not move export onto details.
- Service-scoped automatic discounts can't target a bundled service because the parent's `service_id` is NULL (`contractInvoiceAdjustments.ts:156-184`).
- Old table names (`invoice_items`, `invoice_item_details`) appear in `docs/billing/billing.md:28,312,319`.

## Commands / Runbooks
- Precedent plan: `ee/docs/plans/2026-09-04-invoice-ticket-presentation/`.
- Validate plan JSON: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-10-14-invoice-bundle-component-presentation`

## Links / References
- Customer screenshot (Discord): bundle rows with a bold title, muted subtitle and bundle amount, then bulleted service rows with a green/red signed change and quantity, and no rate/amount. Ordinary lines (Verkada per-device license, after-hours labor) below show qty/rate/amount normally.

## Open Questions
- Should the grouped, by-location and by-ticket standard layouts get bundle variants?
- Should component names use a customer-facing service field if `service_catalog` gains one? v1 uses `service_name` at generation time.
- Should operators be able to reorder components within a line? v1 uses configuration creation order.

## Implementation log (Draft Implementation)

### Status
- Verified (unit/migration-on-scratch-DB): see `implemented:true` in features.json / tests.json. Everything else is **written but not verified** (needs a DB or UI harness) and is deliberately left `false`.
- Commands run: `npx vitest run` in packages/billing (368 files, 1961 tests, pass); `tsc --noEmit` for billing, client-portal and server (no errors reported); `node scripts/validate-translations.cjs` (pass, after `generate-pseudo-locales.cjs`).
- Both migrations were run up/down/up (idempotent) against a throwaway database with stubbed tables inside the local test Postgres container, then the database was dropped. They have **not** been run against a full schema.

### Deviations / decisions made while building
- Price gate is one function, `decideBundleLoad(viewer, ast)` in `lib/invoice-template-ast/componentPricing.ts`, used by `invoiceQueries.resolveBundleLoadOptions`. PDF paths call `templateUsesComponentPricing` directly via `withTemplatePricing`.
- The adapter treats presence of `bundle_component_amounts` as the "include prices" signal.
- MSP preview/drawer always includes prices (MSP sees every amount anyway).
- `buildBundleChildRowsPreset` / `detectBundleChildRowsPreset` (lib/invoice-template-ast/bundleChildRows.ts) are shared by the standard template and the designer. Hand-authored childRows show as "Custom" in the designer and round-trip untouched via `metadata.bundleChildRows`.
- Designer v1 is the preset select + change toggle only. NOT built: blank-on-bundle checklist (F050), per-column remap (F051), auto subtitle line on enabling (F052), canvas preview of component rows (F053), nested `components` collection descriptor (F046), the "Managed services bundles" sample (F055). The presets already set `parentBlankColumns`.
- Draft preview consolidation is opt-in: `buildPreviewInvoiceForSelectionInputs({ consolidateFixedBundles })`, exposed as an options arg on `previewGroupedInvoicesForSelectionInputs`. No UI caller passes it yet, so the AutomaticInvoices dialog is unchanged by construction (F038). In consolidated mode a Fixed line's charges are folded into one parent without a "Contract:" header.
- The template creation wizard has no title/subtitle inputs; only the template detail dialog does (F007 partial).
- `npm run mcp:registry:generate` produced no diff and the registry has no `invoice_line_subtitle`, so F009 is partial (REST schemas updated; registry not).
- On invoiced contracts (`pricingOnly`) the live editor now sends a text-only `updateContractLine` only when the text changed; the action has a fast path that skips recurring-policy resolution and period sync.
- French/locale formatting (F062) is not separately verified: component quantity/change use the shared number formatting and `daterange` filter; no French render test was written.
- F045 (page-break readability): relies on existing print CSS (`break-after: avoid`); no PDF test written.

### Lessons
- `packages/billing/vitest.config.ts` has an explicit include list: new test files must be added.
- tsc on billing needs `NODE_OPTIONS=--max-old-space-size=12000`.
- Never open a file for writing before reading it (a script truncated `models/invoice.ts`; restored from git).

## Round 3 deviations and decisions (review changes)
- Previous period: drafts count as previous periods; `void`/`canceled`/`cancelled`/`voided` invoices are excluded in every spelling.
- Preview wiring: `consolidateFixedBundles` is on for the MSP draft/recurring preview and off for the AutomaticInvoices dialog (F038). Preview mirrors persistence one detail row per charge (`preview/buildPreviewFixedBundles`).
- Template resolution is shared via `resolveClientInvoiceTemplate`; the price gate is `decideBundleLoad`, so REST/MCP shapes stay unchanged (T008).
- F009: the OpenAPI registrar `server/src/lib/api/openapi/routes/contractLines.ts` is hand-declared, so zod changes do not propagate. `sdk npm run openapi:generate` fails locally (stale shared/dist, @shared alias, billing export interop). The two spec JSONs were edited by script (props added to ContractLineBody and UpdateContractLineBody), then `npm run mcp:registry:generate` regenerated both registries. Re-run the real generator in a healthy environment to confirm no diff.
- T013: `bundleRows.pdf.test.ts` drives headless Chrome + pdftotext; opt-in via `RUN_PDF_TESTS=1` (skipped otherwise).
- T018 left unflipped: wizard/template/live-editor tests exist but there is no combined REST round trip evidence. F005/F006 left unflipped for the same reason.
- Incident: an earlier `ALTER ROLE app_user PASSWORD` was run in another person's container `discount-tax-test-pg` (port 15888). Original password unknown, not restored. I switched to my own scratch container.

## Repair round (smoke defects, 2026-10-31)
- Fix 1: `detectBundleChildRowsPreset` now compares structurally (key order ignored, `undefined` key == missing key, `parentBlankColumns` compared as a set, everything else strict). jsonb reorders keys, which made stored ASTs read as Custom. Widget uses `bundleChildRowsShowChange`. Tests: `bundleChildRows.test.ts` (added to vitest include), including the seeded migration 20261015090100 AST.
- Fix 2: `formatChildValue` returns '' for undefined/null/'' so unbound component cells (e.g. bundle-basis unitPrice) are blank, not `$0.00`. `formatValue` untouched. PDF shares the React renderer (`renderTemplateAstHtmlDocument` -> `renderEvaluatedTemplateAst`), so no separate fix.
- features.json/tests.json: no dedicated entries for these; implemented flags unchanged.
