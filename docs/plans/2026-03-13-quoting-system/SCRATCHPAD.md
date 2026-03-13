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
- (2026-03-13) F001 complete — P1: Database migration — create `quotes` table with all fields including is_template boolean, indexes, and Citus-compatible composite keys. Implemented via the quote foundation migration.
- (2026-03-13) F002 complete — P1: Database migration — create `quote_items` table modeled on invoice_charges with is_optional, is_selected, is_recurring, phase fields. Implemented via the same quote foundation migration for consistent rollout.
- (2026-03-13) F003 complete — P1: Database migration — create `quote_activities` table for audit trail. Implemented via the same quote foundation migration so audit storage ships together.
- (2026-03-13) F004 complete — P1: Add 'QUOTE' entity type to SharedNumberingService and seed next_number table with prefix='Q-', padding_length=4. Added QUOTE numbering support in the migration seed and shared numbering service.
- (2026-03-13) F005 complete — P1: TypeScript interfaces — IQuote, IQuoteItem, IQuoteActivity, QuoteStatus in packages/types/src/interfaces/quote.interfaces.ts. Added shared quote interfaces in packages/types for billing-side reuse.
- (2026-03-13) F006 complete — P1: TypeScript view models — IQuoteWithClient, IQuoteListItem for list/detail views. Added list/detail quote view types alongside the core quote interfaces.
- (2026-03-13) F007 complete — P1: Zod schemas — createQuoteSchema and updateQuoteSchema with field validation. Added quote create/update validation schemas in the billing package.
