# Scratchpad — Quoting System

- Plan slug: `quoting-system`
- Created: `2026-03-13`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing the quoting system.

## Decisions

- (2026-03-13) Place quotes in `packages/billing/src/` — cross-package imports aren't supported by the layer architecture, and quotes share tax, PDF, template, discount, and service catalog infrastructure with billing.
- (2026-03-13) Separate `quote_templates` table from `invoice_templates` — shared AST engine but different content needs (optional items, validity dates, scope of work, accept CTA, T&C section).
- (2026-03-13) Use `superseded` status distinct from `cancelled` — when a quote is revised, the old version is superseded (system action), not cancelled (user action). Preserves intent.
- (2026-03-13) `quantity` field as BIGINT (integer units) matching `invoice_charges` — not decimal. The migration `20250225165701` changed invoice_charges from decimal to integer.
- (2026-03-13) Auto-expiration via on-access check in model layer for Phase 1 — simpler than cron. Background job deferred to Phase 6.
- (2026-03-13) Reuse `billing:*` permissions for most operations. Only add `quotes:approve` for the approval workflow in Phase 6.
- (2026-03-13) `is_optional` line items in Phase 1 — key differentiator from invoices, core to MSP quoting workflow.
- (2026-03-13) Simple accept/reject with comment for client portal — no e-signatures in any phase.
- (2026-03-13) `contract_line_id` removed from quote_items — quotes are pre-sale, contract lines don't exist yet. Mapping happens during conversion.
- (2026-03-13) Match `service_item_kind` column name from invoice_charges (not `item_kind`) for consistency.
- (2026-03-13) Quote business templates via `is_template` boolean on quotes table — following contract template pattern. Separate from PDF document templates.
- (2026-03-13) Naming: "quote templates" = reusable business configurations (is_template on quotes). "Quote document templates" = PDF rendering templates (quote_document_templates table).
- (2026-03-13) Deletion uses `deleteEntityWithValidation()` with `supportsArchive: true`. Hard delete only for drafts with no business history.
- (2026-03-13) Client portal access: all client users with billing permissions can see quotes, not just the primary contact.
- (2026-03-13) Email: supports multiple addresses (array). Contact_id remains as primary/default recipient, but MSP can add additional recipients.
- (2026-03-13) Optional item selections: client toggles persisted server-side via `is_selected` on quote_items. On accept, selections sent to MSP for review before conversion. MSP detail view highlights client's choices.
- (2026-03-13) "Save as Template" action on existing quotes (Phase 6) — creates a business template from a quote, stripping client-specific data.

## Parallel Work

- (2026-03-13) Billing cutover DONE (commit 28ced3ad9 on cleanup/billing branch). `server/src/lib/billing/` fully removed (-5,695 lines). All billing code now canonical in `packages/billing/src/`. Circular billingEngine↔invoiceService dependency eliminated. NumberingService at `@shared/services/numberingService`. All server callers updated to package imports.

## Discoveries / Constraints

- (2026-03-13) Billing package Vitest config needed additional aliases for `@alga-psa/auth`, `@alga-psa/core`, `@alga-psa/db`, and `@alga-psa/ui` so quote action tests can import package-local server-action dependencies.

- (2026-03-13) `invoice_charges.quantity` is BIGINT (integer), not decimal — changed in migration `20250225165701`.
- (2026-03-13) All billing server actions use `withAuth()` wrapper from `packages/auth/src/lib/withAuth.ts`.
- (2026-03-13) Invoice template AST system is data-agnostic — evaluator takes bindings + data, not invoice-specific. Reusable for quotes by defining new bindings and QuoteViewModel.
- (2026-03-13) Template tables: `invoice_templates` (tenant-scoped custom), `standard_invoice_templates` (system-wide), `invoice_template_assignments` (selection mapping). Quote templates need parallel structure.
- (2026-03-13) PDF pipeline: fetch data → map to ViewModel → evaluate AST → render to HTML → Puppeteer to PDF. Need `QuoteViewModel` + `mapDbQuoteToViewModel()`.
- (2026-03-13) Contract system has templates vs active contracts with snapshot mechanism (`ensureTemplateLineSnapshot`). Quote→Contract conversion creates a direct contract (not template).
- (2026-03-13) Contract line service configurations: `_fixed_config`, `_hourly_config`, `_usage_config`, `_rate_tiers`. Conversion must create the right config type per billing method.
- (2026-03-13) `client_contracts` is an M:N assignment table between contracts and clients.
- (2026-03-13) Billing dashboard tabs defined in `billingTabsConfig.ts` — add "Quotes" tab here.
- (2026-03-13) Client portal billing: `BillingOverview.tsx` with lazy-loaded tabs. Add QuotesTab following InvoicesTab pattern.
- (2026-03-13) Email logged in `email_sending_logs` with `entity_type` field.
- (2026-03-13) Discount model: `is_discount`, `discount_type` ('percentage'/'fixed'), `discount_percentage`, `applies_to_item_id`, `applies_to_service_id`. Same on quote_items.
- (2026-03-13) Standard invoice templates: 'standard-default' (simple) and 'standard-detailed' (full branding). Need equivalent standard quote templates.
- (2026-03-13) Migration naming: `YYYYMMDDHHmmss_description.cjs` in `server/migrations/`.

## Commands / Runbooks

- (2026-03-13) **Feature branch**: `feature/quoting_the_beginnig` (branched off `cleanup/billing` at `28ced3ad9`)
- (2026-03-13) **Parent branch**: `cleanup/billing` (billing cutover, not yet merged to main)
- (2026-03-13) Run migrations: `cd server && npx knex migrate:latest`
- (2026-03-13) Migration files: `server/migrations/YYYYMMDDHHmmss_description.cjs`

## Testing References

- Test framework: Vitest v4.0.18, sequential execution (`maxConcurrency: 1`, `singleFork: true`)
- TestContext: `server/test-utils/testContext.ts` — transaction-based rollback, `setupContext/resetContext/rollbackContext/cleanupContext`
- Data factories: `server/test-utils/testDataFactory.ts` — `createTenant()`, `createClient()`, `createUser()`
- DB config: `.env.localtest`, direct PostgreSQL port 5432 (not pgbouncer)
- Billing unit tests: `packages/billing/tests/` (own vitest.config.ts, 10s timeout)
- Billing infra tests: `server/src/test/infrastructure/billing/` (invoices: 17+ files, credits: 7, tax: 3)
- Billing integration tests: `server/src/test/integration/billing/`
- Playwright config: `server/playwright.config.ts`, pattern `**/*.playwright.test.ts`
- No existing Playwright e2e tests for billing — quoting will be first
- Run infra tests: `cd server && dotenv -e ../.env.localtest -- vitest src/test/infrastructure/billing/`
- Example billing test: `server/src/test/infrastructure/billing/invoices/invoiceGeneration.test.ts`

## Links / References

- Billing package: `packages/billing/src/`
- Invoice model: `packages/billing/src/models/invoice.ts`
- Contract model: `packages/billing/src/models/contract.ts`
- Service catalog model: `packages/billing/src/models/service.ts`
- Tax service: `packages/billing/src/services/taxService.ts`
- PDF generation: `packages/billing/src/services/pdfGenerationService.ts`
- Template AST schema: `packages/billing/src/lib/invoice-template-ast/schema.ts`
- Template evaluator: `packages/billing/src/lib/invoice-template-ast/evaluator.ts`
- Template renderer: `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
- Standard templates: `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts`
- Invoice adapters: `packages/billing/src/lib/adapters/invoiceAdapters.ts`
- Billing tabs config: `packages/billing/src/components/billing-dashboard/billingTabsConfig.ts`
- Invoice interfaces: `packages/types/src/interfaces/invoice.interfaces.ts`
- Client portal billing: `packages/client-portal/src/components/billing/`
- Client portal InvoicesTab: `packages/client-portal/src/components/billing/InvoicesTab.tsx`
- Email actions: `packages/email/src/actions/emailLogActions.ts`
- Contract actions: `packages/billing/src/actions/contractActions.ts`
- Contract line mapping: `packages/billing/src/actions/contractLineMappingActions.ts`
- Auth wrapper: `packages/auth/src/lib/withAuth.ts`
- Numbering service: `shared/services/numberingService.ts` (EntityType: 'TICKET' | 'INVOICE' | 'PROJECT' — add 'QUOTE')
- Invoice service (package): `packages/billing/src/services/invoiceService.ts` (canonical, server copy deleted)
- Billing engine (package): `packages/billing/src/lib/billing/billingEngine.ts` (canonical, server copy deleted)

## Open Questions

- ~~How does invoice numbering work?~~ RESOLVED: Uses `SharedNumberingService.getNextNumber()` with `generate_next_number` DB function. Add 'QUOTE' entity type, seed with prefix='Q-', padding=4.
- ~~Is `contact_id` a single recipient?~~ RESOLVED: Single primary contact. Email can go to any address. Portal access via billing permissions.
- ~~For conversion: template or direct?~~ RESOLVED: Direct draft contract + client assignment.
- Deletion validation config: `packages/core/src/config/deletion/index.ts` — need to add quote entity with dependency checks (activities, emails, converted entities).
- Contract template system: `packages/billing/src/models/contractTemplate.ts` — reference for quote business template implementation.
- ~~Quote business template wizard~~ RESOLVED: Both wizard + quick create (matching contract pattern). "Save as Template" for existing quotes in Phase 6.
- (2026-03-13) Archived quotes: visible via status filter dropdown in quote list. Filter options include All, Drafts, Sent, Accepted, etc., plus Archived. No separate tab.

## Delivery Log
- (2026-03-13) T050b complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with a `createQuoteFromTemplate` case asserting every template line item is recreated on the new draft quote with the expected recurrence and optional-item metadata.
- (2026-03-13) T050a complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with a template-creation case proving `createQuote` preserves `is_template=true` and returns a template without a generated quote number.
- (2026-03-13) F036a complete — P1: Added `createQuoteFromTemplate` in `packages/billing/src/actions/quoteActions.ts`; it validates `billing:create`, loads a template quote, creates a new draft quote from template defaults, clones all template items in a transaction, and returns the populated draft quote with a fresh quote number.
- (2026-03-13) F036 complete — P1: Quote business-template backend now rides on the generic quote actions and model behavior: `is_template=true` quotes are created without numbering, excluded from the normal status lifecycle, and can be read/updated/deleted through the same tenant-scoped CRUD surface.
- (2026-03-13) T050 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with a recurring-item case proving `addQuoteItem` preserves `is_recurring` and `billing_frequency` through the action layer.
- (2026-03-13) T049 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with an optional-item case proving `addQuoteItem` preserves `is_optional=true` through the server-action boundary.
- (2026-03-13) T048 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with a rate-override case proving `addQuoteItem` forwards an explicit `unit_price` that differs from the service catalog default.
- (2026-03-13) T047 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with a billing-method matrix proving `addQuoteItem` accepts `fixed`, `hourly`, `usage`, and `per_unit` without schema rejection.
- (2026-03-13) T046 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with an `addQuoteItem` service-backed case asserting the action returns service-derived defaults (name, SKU, billing method, unit metadata) from the quote item creation path.
- (2026-03-13) T045 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with a `deleteQuote` case that propagates the model-layer archive-required error for quotes with business history, covering the action boundary for protected quote deletion.
- (2026-03-13) T044 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with an `updateQuote` case that surfaces the model-layer invalid status transition error, proving the action path preserves quote lifecycle enforcement.
- (2026-03-13) T043 complete — Extended `packages/billing/tests/quote/quoteActions.test.ts` with a `createQuote` success-path assertion that the action returns the persisted quote including its generated `quote_number` and stamps `created_by` from the authenticated user context.
- (2026-03-13) T042 complete — Added `packages/billing/tests/quote/quoteActions.test.ts` coverage proving `createQuote` returns a permission error when `billing:create` is denied; updated `packages/billing/vitest.config.ts` alias resolution so the billing package test runner can load quote server-action dependencies.
- (2026-03-13) F035 complete — P1: Quote item create/update actions preserve `is_recurring` and `billing_frequency`, and schema validation requires a billing frequency for recurring items so conversion-ready recurrence metadata is stored end-to-end.
- (2026-03-13) F034 complete — P1: Quote item create/update actions preserve `is_optional`, and the quote item model persists/returns that flag so optional line items are available to downstream UI and portal flows.
- (2026-03-13) F033 complete — P1: Quote item actions now accept the full billing method enum (`fixed`, `hourly`, `usage`, `per_unit`) through the quote item schema and preserve service-derived billing methods from the catalog.
- (2026-03-13) F032 complete — P1: `addQuoteItem` and `updateQuoteItem` preserve explicit `unit_price` values, so quote items can override service catalog default pricing without losing the service metadata linkage.
- (2026-03-13) F031 complete — P1: The `addQuoteItem` action now exposes service catalog-backed quote item creation end-to-end: callers provide `service_id`, and the quote item model denormalizes service name/SKU/rate/unit defaults before persisting.
- (2026-03-13) F030 complete — P1: Added `updateQuoteItem`, `removeQuoteItem`, and `reorderQuoteItems` server actions in `packages/billing/src/actions/quoteActions.ts`, all wrapped with `withAuth()`, enforcing `billing:update`, validating item updates with `updateQuoteItemSchema`, and delegating mutation/reorder behavior to the tenant-scoped quote item model.
- (2026-03-13) F029 complete — P1: Added `addQuoteItem` server action in `packages/billing/src/actions/quoteActions.ts`, wrapped with `withAuth()`, enforcing `billing:update`, validating with `createQuoteItemSchema`, and delegating service catalog denormalization/default pricing to the quote item model.
- (2026-03-13) F028 complete — P1: Added `deleteQuote` server action in `packages/billing/src/actions/quoteActions.ts`, wrapped with `withAuth()`, enforcing `billing:delete`, and delegating deletion/archive behavior to the existing quote deletion validation in the model layer.
- (2026-03-13) F027 complete — P1: Added `getQuote` and `listQuotes` server actions in `packages/billing/src/actions/quoteActions.ts`, both wrapped with `withAuth()`, enforcing `billing:read`, and delegating to the tenant-scoped quote model for single-record and paginated list retrieval.
- (2026-03-13) F026 complete — P1: Added `updateQuote` server action in `packages/billing/src/actions/quoteActions.ts`, wrapped with `withAuth()`, enforcing `billing:update`, validating input with `updateQuoteSchema`, defaulting `updated_by` from the authenticated user, and relying on the quote model for status-transition enforcement.
- (2026-03-13) F025 complete — P1: Added `createQuote` server action in `packages/billing/src/actions/quoteActions.ts`, wrapped with `withAuth()`, enforcing `billing:create`, validating input with `createQuoteSchema`, defaulting `created_by` from the authenticated user, and returning the created quote with generated `quote_number`.
- (2026-03-13) F001 complete — P1: Database migration — create `quotes` table with all fields including is_template boolean, indexes, and Citus-compatible composite keys. Implemented via the quote foundation migration.
- (2026-03-13) F002 complete — P1: Database migration — create `quote_items` table modeled on invoice_charges with is_optional, is_selected, is_recurring, phase fields. Implemented via the same quote foundation migration for consistent rollout.
- (2026-03-13) F003 complete — P1: Database migration — create `quote_activities` table for audit trail. Implemented via the same quote foundation migration so audit storage ships together.
- (2026-03-13) F004 complete — P1: Add 'QUOTE' entity type to SharedNumberingService and seed next_number table with prefix='Q-', padding_length=4. Added QUOTE numbering support in the migration seed and shared numbering service.
- (2026-03-13) F005 complete — P1: TypeScript interfaces — IQuote, IQuoteItem, IQuoteActivity, QuoteStatus in packages/types/src/interfaces/quote.interfaces.ts. Added shared quote interfaces in packages/types for billing-side reuse.
- (2026-03-13) F006 complete — P1: TypeScript view models — IQuoteWithClient, IQuoteListItem for list/detail views. Added list/detail quote view types alongside the core quote interfaces.
- (2026-03-13) F007 complete — P1: Zod schemas — createQuoteSchema and updateQuoteSchema with field validation. Added quote create/update validation schemas in the billing package.
- (2026-03-13) F008 complete — P1: Zod schemas — createQuoteItemSchema and updateQuoteItemSchema. Added quote item create/update validation schemas in the billing package.
- (2026-03-13) F009 complete — P1: Zod schema — status transition validation (only allow valid next statuses). Added reusable quote status transition validation helpers for model enforcement.
- (2026-03-13) F010 complete — P1: Quote model — getById with tenant isolation and auto-expiration check. Implemented the quote model getById path with tenant isolation and item hydration.
- (2026-03-13) F011 complete — P1: Quote model — getByNumber (for human-readable lookup). Implemented quote lookup by human-readable number in the model layer.
- (2026-03-13) F012 complete — P1: Quote model — listByTenant with pagination, sorting, and status/client filtering. Implemented paginated tenant quote listing with status/client filters and sorting.
- (2026-03-13) F013 complete — P1: Quote model — listByClient for client-specific quote listing. Implemented client-scoped quote listing in the model layer.
- (2026-03-13) F014 complete — P1: Quote model — create (inserts quote row, generates quote_number, logs activity). Implemented quote creation with QUOTE numbering and created-activity logging.
- (2026-03-13) F015 complete — P1: Quote model — update (validates status transition, updates fields, logs activity). Implemented quote updates with status validation and activity logging.
- (2026-03-13) F016 complete — P1: Quote model — delete via deleteEntityWithValidation: hard delete drafts with no business history, archive for others. Implemented quote deletion through deletion validation with draft hard-delete behavior.
- (2026-03-13) F017 complete — P1: Quote model — auto-expiration: if valid_until < today and status is 'sent', set to 'expired' on read. Implemented on-access quote auto-expiration for sent quotes.
- (2026-03-13) F018 complete — P1: Quote item model — listByQuoteId ordered by display_order. Implemented ordered quote-item listing by quote.
- (2026-03-13) F019 complete — P1: Quote item model — create with service catalog lookup (denormalize name, SKU, default rate, unit_of_measure). Implemented quote-item creation with service catalog denormalization.
- (2026-03-13) F020 complete — P1: Quote item model — update (rate override, quantity, description, flags). Implemented quote-item updates including quantity and rate overrides.
- (2026-03-13) F021 complete — P1: Quote item model — delete item and recalculate display_order. Implemented quote-item deletion with display-order compaction.
- (2026-03-13) F022 complete — P1: Quote item model — reorder items (update display_order batch). Implemented batch quote-item reorder support.
- (2026-03-13) F023 complete — P1: Quote activity model — create activity entry with type, description, performed_by, metadata. Implemented quote activity creation with metadata support.
- (2026-03-13) F024 complete — P1: Quote activity model — listByQuoteId for audit trail display. Implemented chronological quote activity listing.
- (2026-03-13) F049a complete — P1: Register quote entity in deleteEntityWithValidation config with supportsArchive: true and dependency checks. Registered quote deletion rules with archive alternatives and business-history checks.
- (2026-03-13) T001 complete — Migration: quotes table created with correct columns including is_template boolean, types, and constraints. Added DB-backed quote infrastructure coverage.
- (2026-03-13) T002 complete — Migration: quotes table has indexes on (tenant, client_id), (tenant, status), (tenant, quote_number), (tenant, parent_quote_id). Covered quote index creation in the infrastructure suite.
- (2026-03-13) T003 complete — Migration: quote_items table created with correct columns including is_selected, matching invoice_charges pattern plus quote-specific fields. Covered quote_items schema shape in the infrastructure suite.
- (2026-03-13) T004 complete — Migration: quote_items FK to quotes cascades on delete. Covered quote_items cascade behavior in the infrastructure suite.
- (2026-03-13) T005 complete — Migration: quote_activities table created with correct columns and FK to quotes. Covered quote_activities schema and FK wiring in the infrastructure suite.
- (2026-03-13) T006 complete — Numbering: 'QUOTE' entity type generates Q-0001 on first call. Covered first QUOTE numbering generation.
- (2026-03-13) T007 complete — Numbering: sequential calls generate Q-0001, Q-0002, Q-0003. Covered sequential QUOTE numbering generation.
- (2026-03-13) T008 complete — Numbering: different tenants have independent sequences. Covered QUOTE numbering isolation across tenants.
- (2026-03-13) T009 complete — Types: IQuote interface includes all required fields with correct types. Added package-level quote type coverage.
- (2026-03-13) T010 complete — Types: QuoteStatus includes draft, sent, accepted, rejected, expired, converted, cancelled, superseded. Added package-level QuoteStatus coverage.
- (2026-03-13) T011 complete — Types: IQuoteListItem includes joined client name and computed display fields. Added package-level quote list item type coverage.
- (2026-03-13) T012 complete — Schema: createQuoteSchema requires client_id, title, quote_date, valid_until. Added createQuoteSchema required-field coverage.
- (2026-03-13) T013 complete — Schema: createQuoteSchema rejects invalid dates (valid_until before quote_date). Added createQuoteSchema date ordering coverage.
- (2026-03-13) T014 complete — Schema: createQuoteItemSchema requires description and validates quantity > 0. Added createQuoteItemSchema validation coverage.
- (2026-03-13) T015 complete — Schema: status transition validation allows draft→sent but rejects draft→accepted. Added draft transition validation coverage.
- (2026-03-13) T016 complete — Schema: status transition validation allows sent→accepted, sent→rejected, sent→expired, sent→cancelled. Added sent transition validation coverage.
- (2026-03-13) T017 complete — Schema: status transition validation allows accepted→converted but rejects converted→draft. Added accepted/converted transition validation coverage.
- (2026-03-13) T018 complete — Model: getById returns quote with items for correct tenant. Added getById tenant read coverage.
- (2026-03-13) T019 complete — Model: getById returns null for wrong tenant (isolation). Added getById tenant isolation coverage.
- (2026-03-13) T020 complete — Model: getById auto-expires quote if valid_until < today and status is 'sent'. Added sent quote auto-expiration coverage.
- (2026-03-13) T021 complete — Model: getById does not auto-expire drafts or accepted quotes. Added non-sent auto-expiration guard coverage.
- (2026-03-13) T022 complete — Model: getByNumber returns correct quote by human-readable number within tenant. Added getByNumber coverage.
- (2026-03-13) T023 complete — Model: listByTenant returns paginated results with correct total count. Added listByTenant pagination coverage.
- (2026-03-13) T024 complete — Model: listByTenant filters by status correctly. Added listByTenant status filter coverage.
- (2026-03-13) T025 complete — Model: listByTenant filters by client_id correctly. Added listByTenant client filter coverage.
- (2026-03-13) T026 complete — Model: listByTenant sorts by quote_date descending by default. Added listByTenant default sort coverage.
- (2026-03-13) T027 complete — Model: listByClient returns only quotes for specified client. Added listByClient coverage.
- (2026-03-13) T028 complete — Model: create inserts quote with generated quote_number and logs 'created' activity. Added quote create numbering/activity coverage.
- (2026-03-13) T029 complete — Model: create sets default status to 'draft'. Added quote create default status coverage.
- (2026-03-13) T030 complete — Model: update changes fields and logs 'updated' activity. Added quote update activity coverage.
- (2026-03-13) T031 complete — Model: update rejects invalid status transitions. Added invalid quote transition rejection coverage.
- (2026-03-13) T032 complete — Model: delete removes draft quotes with no business history via deleteEntityWithValidation. Added draft quote delete coverage.
- (2026-03-13) T033 complete — Model: delete blocks non-draft quotes and offers archive alternative. Added non-draft quote delete blocking coverage.
- (2026-03-13) T033a complete — Model: delete blocks drafts that have business history (emails sent, etc.) and offers archive. Added draft-with-history delete blocking coverage.
- (2026-03-13) T034 complete — Item model: listByQuoteId returns items ordered by display_order. Added ordered quote-item listing coverage.
- (2026-03-13) T035 complete — Item model: create with service_id populates service_name, service_sku, unit_price from catalog. Added service-backed quote-item creation coverage.
- (2026-03-13) T036 complete — Item model: create without service_id allows custom item entry. Added manual quote-item creation coverage.
- (2026-03-13) T037 complete — Item model: update allows rate override (different unit_price than catalog default). Added quote-item rate override coverage.
- (2026-03-13) T038 complete — Item model: delete removes item and adjusts display_order of remaining items. Added quote-item delete reorder coverage.
- (2026-03-13) T039 complete — Item model: reorder updates display_order for all items in batch. Added quote-item batch reorder coverage.
- (2026-03-13) T040 complete — Activity model: create stores activity with all fields and auto-timestamps. Added quote activity creation coverage.
- (2026-03-13) T041 complete — Activity model: listByQuoteId returns activities in chronological order. Added quote activity ordering coverage.
