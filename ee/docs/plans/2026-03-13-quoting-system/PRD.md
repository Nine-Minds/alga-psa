# PRD — Quoting System

- Slug: `quoting-system`
- Date: `2026-03-13`
- Status: Draft

## Summary

Add a quoting system to Alga PSA that allows MSPs to create, send, and manage pricing proposals for clients. Quotes integrate with the existing billing infrastructure (service catalog, tax, discounts, templates, PDF generation, email, client portal) and can be converted into contracts and/or invoices upon acceptance.

## Problem

Alga PSA has no way to create pre-sale pricing proposals. MSPs currently must:
- Create quotes outside the system (spreadsheets, Word docs, other tools)
- Manually re-enter accepted quote data as contracts and invoices
- Lose visibility into quote status, history, and conversion metrics
- Cannot offer clients a self-service experience for reviewing and accepting proposals

This creates data entry duplication, disconnected workflows, and lost context between the sales and billing stages.

## Goals

- Create quotes with line items from the service catalog (all billing methods: fixed, hourly, usage, per_unit)
- Support optional line items that clients can opt-in/out of, with MSP review of client's configuration choices before conversion
- Distinguish recurring vs one-time charges for proper conversion
- Apply discounts (percentage and fixed) at line and quote level
- Calculate tax using existing tax infrastructure
- Version/revise quotes without losing history
- Track quote status through its full lifecycle
- Generate professional PDF documents using quote document templates (shared AST engine, separate from business quote templates)
- Send quotes via email to multiple addresses (not just the primary contact)
- Allow clients to view, accept, and reject quotes via the client portal (accessible to all client users with billing permissions)
- Convert accepted quotes into contracts (recurring items) and/or invoices (one-time items)
- Reusable quote templates (business configuration templates) for frequent quote patterns, following the contract template pattern
- Internal approval workflow (optional, configurable per tenant)

## Non-goals

- E-signatures (accept button with timestamp is sufficient)
- CRM opportunity tracking beyond a basic `opportunity_id` link
- Automated follow-up sequences or drip campaigns
- Quote analytics/reporting dashboards (can be built on top later)
- Multi-currency quotes in Phase 1 (use tenant default currency; multi-currency can follow invoice pattern later)

## Users and Primary Flows

### Persona: MSP Sales/Account Manager

1. Creates a new quote for a client, selecting services from the catalog (optionally from a quote template)
2. Adds custom line items, marks some as optional, groups by phase
3. Adjusts rates, applies discounts, reviews tax calculation
4. Previews PDF, adjusts if needed
5. Sends quote to multiple email addresses (defaults to primary contact, can add more)
6. Client accepts with optional item selections → MSP reviews configuration → converts to contract + invoice
7. If client requests changes → creates a revision (new version)

### Persona: MSP Manager/Approver (Phase 6)

1. Reviews quotes submitted for internal approval
2. Approves or requests changes
3. Approved quotes become ready to send

### Persona: Client (via Client Portal)

1. Any client user with billing permissions sees quotes in the billing section
2. Receives email notification with link to quote in portal
3. Views quote details, including optional items
4. Toggles optional items on/off, sees total recalculate
5. Accepts (submitting optional item selections for MSP review) or rejects with optional comment
6. Views quote history (sent quotes, accepted quotes)

## UX / UI Notes

### MSP Portal — Billing Dashboard

- **New "Quotes" tab** in billing dashboard (alongside Client Contracts, Invoicing, etc.)
- Tab added to `billingTabsConfig.ts` with FileText icon
- Quote list uses DataTable with columns: Quote #, Client, Title, Amount, Status, Date, Valid Until, Actions
- Filters: status, client, date range
- Sort by date, amount, status

### Quote Builder (Create/Edit)

- **Header section**: Client picker, contact picker, title, description/scope of work, dates (quote date, valid until), PO number
- **Line items section**:
  - Service catalog picker (searchable dropdown)
  - Manual/custom line item entry
  - Per-item: description, quantity, unit price, optional toggle, recurring toggle + frequency
  - Phase/section grouping (text label per item)
  - Drag-to-reorder (display_order)
  - Discount lines (add discount → select type, amount, target item/service)
- **Totals section**: Subtotal, discounts, tax, total — recalculates on any change
- **Notes section**: Internal notes (not visible to client), client-facing notes
- **T&C section**: Terms and conditions text field
- **Actions**: Save Draft, Preview PDF, Send to Client, [Submit for Approval — Phase 6]

### Quote Detail View

- Read-only view of quote with all sections
- Status badge with current state
- Action buttons based on status:
  - Draft: Edit, Send, Delete
  - Sent: Revise, Cancel
  - Accepted: Convert to Contract, Convert to Invoice, Convert to Both
  - Any: View PDF, View History
- Version history sidebar (if multiple versions exist)
- Activity log (audit trail)

### Client Portal

- **Quotes tab** in billing overview (alongside Invoices)
- Quote list: Quote #, Title, Amount, Status, Date
- Quote detail: full line items, optional item toggles, totals, T&C
- Accept/Reject buttons with optional comment field
- Status shows client-friendly text ("Awaiting Your Response", "Accepted", etc.)

## Requirements

### Phase 1 — Data Model, Core CRUD, Line Items

**P1-FR1: Database Tables**
- Create `quotes` table with all fields (see Data Model section)
- Create `quote_items` table modeled on `invoice_charges`
- Create `quote_activities` table for audit trail
- All tables tenant-scoped with composite keys for Citus compatibility
- Indexes on: `(tenant, client_id)`, `(tenant, status)`, `(tenant, quote_number)`, `(tenant, parent_quote_id)`

**P1-FR2: Quote Numbering**
- Add `'QUOTE'` to `SharedNumberingService` entity types in `shared/services/numberingService.ts` (EntityType union)
- Seed `next_number` table with entity_type='QUOTE', prefix='Q-', padding_length=4
- Generate sequential numbers: Q-0001, Q-0002, etc.
- Uses existing `generate_next_number` DB function — no changes needed to the function itself

**P1-FR3: TypeScript Types**
- `IQuote`, `IQuoteItem`, `IQuoteActivity` interfaces in `packages/types/`
- `QuoteStatus` type union
- `IQuoteWithClient`, `IQuoteListItem` view model types

**P1-FR4: Zod Schemas**
- `createQuoteSchema`, `updateQuoteSchema`
- `createQuoteItemSchema`, `updateQuoteItemSchema`
- Validation for status transitions

**P1-FR5: Quote Model (Data Access)**
- CRUD operations with tenant-explicit Knex queries
- `getById`, `getByNumber`, `listByTenant`, `listByClient`
- `create`, `update`, `delete`
- Delete behavior: hard delete for drafts with no business history (no activities beyond 'created'). For quotes with business history (sent, accepted, etc.), deletion is blocked — use cancel/archive instead. Register quote entity in `deleteEntityWithValidation()` config with `supportsArchive: true`.
- Auto-expiration check: if `valid_until < today` and status is `sent`, set to `expired`

**P1-FR6: Quote Item Model**
- CRUD for line items within a quote
- `listByQuoteId`, `create`, `update`, `delete`, `reorder`
- Service catalog lookup on create (denormalize name, SKU, default rate)

**P1-FR7: Quote Activity Model**
- `create` activity entries on all quote state changes
- `listByQuoteId` for audit trail display

**P1-FR8: Server Actions**
- `createQuote`, `updateQuote`, `getQuote`, `listQuotes`, `deleteQuote`
- `createQuoteFromTemplate` — create a new draft quote by copying a quote template's items
- `addQuoteItem`, `updateQuoteItem`, `removeQuoteItem`, `reorderQuoteItems`
- All wrapped with `withAuth()`, using `billing:create`/`billing:read`/`billing:update`/`billing:delete` permissions

**P1-FR9: Status Transitions**
- Enforce valid transitions: draft→sent, sent→accepted/rejected/expired/cancelled, accepted→converted, any non-terminal→cancelled
- Phase 6 adds: draft→pending_approval→approved→sent

**P1-FR10: Service Catalog Integration**
- Pick service from catalog → populate line item with name, SKU, default rate, billing method, unit of measure
- Support rate overrides (custom pricing on the quote)
- Support all billing methods: fixed, hourly, usage, per_unit

**P1-FR11: Optional Line Items**
- `is_optional` flag on quote items
- Optional items included in totals by default but can be toggled by client (Phase 4)
- UI shows clear visual distinction for optional items

**P1-FR12: Recurring/One-Time Distinction**
- `is_recurring` + `billing_frequency` on quote items
- Visual grouping in UI
- Drives conversion logic in Phase 5

**P1-FR13: Quote Business Templates (Reusable Configurations)**
- `is_template` boolean field on quotes table (following contract template pattern)
- Template quotes have `is_template = true`, are not numbered, and don't go through the status lifecycle
- Two creation flows (matching contract template pattern):
  - **Template Wizard**: Multi-step guided creation (basics → services → review)
  - **Quick Create**: Simple form for fast template creation
- Template management UI: list, create, edit, delete templates
- "Create from Template" action: copies template's items into a new draft quote
- Templates store predefined line items, default terms, default description/scope
- Separate from PDF document templates (Phase 3) — these define *what* a quote contains, not *how* it renders

**P1-FR14: Billing Dashboard Tab**
- Add "Quotes" tab to billing dashboard in `billingTabsConfig.ts`
- Route: `/msp/billing?tab=quotes`

**P1-FR15: Quote List UI**
- DataTable component with sorting, filtering, pagination
- Columns: Quote #, Client, Title, Total Amount, Status, Quote Date, Valid Until
- Status filter dropdown: All, Drafts, Sent, Accepted, Rejected, Expired, Converted, Cancelled, Archived (archived quotes shown via filter, not a separate tab)
- Client filter
- Row click → quote detail
- Separate template list view (filtered by is_template=true)

**P1-FR16: Quote Form UI**
- Create/edit form with client picker, contact picker, metadata fields
- "Create from Template" option in create flow
- Line item editor with service catalog search
- Add/remove/reorder items
- Save as draft

**P1-FR17: Quote Detail UI**
- Read-only detail view
- Status badge
- Action buttons based on current status
- Line items display with phase grouping
- For accepted quotes with optional items: highlight client's optional item selections for MSP review

**P1-FR18: Quote Status Badge**
- Reusable component showing colored badge per status
- Consistent with existing status badge patterns

**P1-FR19: Deletion Validation**
- Register quote entity in `deleteEntityWithValidation()` config
- Dependencies: quote_activities (beyond 'created'), email_sending_logs, converted contracts/invoices
- `supportsArchive: true` — quotes with business history can be archived, not deleted
- Hard delete allowed only for drafts with no business history

### Phase 2 — Tax, Discounts, Calculations, Versioning

**P2-FR1: Tax Calculation**
- Integrate with `taxService.ts` → `calculateTax()` per line item
- Support `tax_source`: internal, external, pending_external
- Per-item `tax_region`, `tax_rate`, `is_taxable`
- Tax exemption check via client settings
- Reverse charge support

**P2-FR2: Discount Line Items**
- `is_discount` flag creates a discount line
- `discount_type`: 'percentage' or 'fixed'
- `discount_percentage` for percentage discounts
- `applies_to_item_id`: scope discount to specific item
- `applies_to_service_id`: scope discount to specific service
- Quote-level discounts as separate line items

**P2-FR3: Totals Calculation**
- `subtotal` = sum of non-discount item totals
- `discount_total` = sum of discount line amounts
- `tax` = sum of per-item tax amounts
- `total_amount` = subtotal - discount_total + tax
- Recalculate on any item add/update/remove
- Optional items: included in totals unless toggled off

**P2-FR4: Versioning — Create Revision**
- "Revise" action on sent/rejected quotes
- Creates new `quotes` row: version = prev + 1, `parent_quote_id` = original quote_id
- Copies all `quote_items` to new version
- Old version status → `superseded`
- Same `quote_number` across versions (display as "Q-0042 v2")

**P2-FR5: Version History**
- Query all versions by `parent_quote_id` chain
- UI: version history sidebar/dropdown on quote detail
- Navigate between versions

**P2-FR6: Totals Display in UI**
- Subtotal, discounts, tax, total prominently displayed
- Live recalculation as items are edited
- Currency formatting consistent with invoice display

### Phase 3 — Quote Templates & PDF Generation

**P3-FR1: Quote Template Tables**
- `quote_templates` table (parallel to `invoice_templates`): tenant, template_id, name, version, templateAst (JSONB), is_default, timestamps
- `standard_quote_templates` table: system-wide default templates
- `quote_template_assignments` table: tenant → template selection mapping

**P3-FR2: QuoteViewModel Type**
- New interface in `packages/types/`: quote_number, quote_date, valid_until, status, client info, contact info, tenant info, line items (with is_optional, is_recurring, phase), totals, T&C, client_notes, version
- Serves as the data contract between DB and template engine

**P3-FR3: Quote-Specific AST Bindings**
- Standard bindings: quoteNumber, quoteDate, validUntil, status, scope/description
- Collection bindings: lineItems (with optional/recurring flags), phases
- Totals bindings: subtotal, discountTotal, tax, total
- Additional bindings: termsAndConditions, clientNotes, version

**P3-FR4: Standard Quote Templates**
- `standard-quote-default`: Clean layout with scope section, line items table (optional items visually marked), totals, validity notice, T&C
- `standard-quote-detailed`: Full branding, phase grouping, recurring vs one-time sections, optional items section, acceptance instructions

**P3-FR5: mapDbQuoteToViewModel Adapter**
- Fetches quote + items + client + contact + tenant data
- Maps to QuoteViewModel
- Handles currency formatting, date formatting
- Marks optional items, groups by phase

**P3-FR6: PDF Generation**
- Reuse Puppeteer pipeline from `pdfGenerationService.ts`
- Create `QuotePDFGenerationService` or extend existing service with document type
- Flow: fetch quote → map to ViewModel → evaluate AST → render HTML → generate PDF
- Store PDF in file storage

**P3-FR7: Quote Preview**
- In-browser preview component (renders template without Puppeteer)
- Preview button on quote form and detail view
- Uses same AST evaluation + React rendering as invoices

**P3-FR8: Template Selection**
- Per-quote template override (template_id field)
- Tenant default quote template
- Fallback to standard-quote-default

### Phase 4 — Email Sending & Client Portal

**P4-FR1: Send Quote Action**
- Server action: validate quote is in sendable state (draft or approved)
- Generate PDF
- Send email to multiple addresses (array of emails) — defaults to primary contact, supports adding additional recipients
- Set `sent_at` timestamp, status → `sent`
- Log activity

**P4-FR2: Quote Email Templates**
- "Quote Sent" email: subject line, quote summary, PDF attachment, link to portal
- "Quote Reminder" email: for approaching expiration
- "Quote Accepted Confirmation" email: sent to MSP when client accepts

**P4-FR3: Email Logging**
- Log sent emails in `email_sending_logs` with `entity_type = 'quote'`
- Track delivery status

**P4-FR4: Client Portal — Quotes Tab**
- Add "Quotes" tab to `BillingOverview.tsx` (lazy loaded)
- Accessible to all client portal users with billing permissions (not just the primary contact)
- Quote list: DataTable with Quote #, Title, Amount, Status, Date
- Filter by status

**P4-FR5: Client Portal — Quote Detail**
- Full quote view with line items, totals, T&C
- Optional items shown with toggle switches
- Toggling optional items recalculates totals client-side
- Optional item selections persisted server-side (per quote, per client — survives page reload)
- Client-friendly status text

**P4-FR6: Client Portal — Accept/Reject**
- Accept button: persists client's optional item selections, sets `accepted_at`, `accepted_by` (portal user), status → `accepted`
- The accept flow sends the client's configuration (selected optional items) back to the MSP for review before conversion
- MSP sees accepted quote with client's selections highlighted, then decides to convert
- Reject button: opens comment field, sets `rejected_at`, `rejection_reason`, status → `rejected`
- Activity logged

**P4-FR7: Viewed Tracking**
- Set `viewed_at` timestamp when client first opens quote in portal
- Activity logged
- Visible to MSP on quote detail

**P4-FR8: Resend/Reminder**
- "Resend" action on sent quotes
- "Send Reminder" for quotes approaching valid_until date

### Phase 5 — Conversion Workflows

**P5-FR1: Quote → Contract Conversion**
- Action on accepted quotes
- Creates a new contract (status: draft)
- For each recurring quote_item:
  - Create `contract_line` matching billing method
  - Create appropriate service configuration (`_fixed_config`, `_hourly_config`, `_usage_config`)
  - Map service, rate, description
- Create `client_contracts` assignment with start_date
- Set `quote.converted_contract_id`
- Wrap in transaction

**P5-FR2: Quote → Invoice Conversion**
- Action on accepted quotes
- Creates a new invoice (status: draft, is_manual: true)
- For each one-time quote_item:
  - Create `invoice_charge` with matching fields
  - Copy tax, discount, pricing data
- Calculate invoice totals
- Set `quote.converted_invoice_id`
- Wrap in transaction

**P5-FR3: Combined Conversion**
- For quotes with both recurring and one-time items
- Run contract conversion for recurring items
- Run invoice conversion for one-time items
- Both in single transaction
- Set both `converted_contract_id` and `converted_invoice_id`
- Status → `converted`

**P5-FR4: Conversion Preview**
- Before converting, show preview of what will be created
- List which items → contract lines vs invoice charges
- Show contract details (name, dates, billing config)
- User confirms before proceeding

**P5-FR5: Conversion UI**
- "Convert" button on accepted quote detail
- Options: "To Contract", "To Invoice", "To Both" (auto-detected based on item types)
- Dialog with preview and confirmation
- Success: link to created contract/invoice

**P5-FR6: Post-Conversion Links**
- Quote detail shows links to converted contract/invoice
- Contract/invoice detail can link back to source quote

### Phase 6 — Approval Workflow & Advanced Features

**P6-FR1: Internal Approval Workflow**
- New statuses: `pending_approval`, `approved`
- "Submit for Approval" action on drafts
- Approval dashboard (follow `ManagerApprovalDashboard` pattern)
- Approve/reject with comment
- Configurable: can be disabled per tenant (draft → sent directly)

**P6-FR2: quotes:approve Permission**
- New permission for approving quotes
- Separate from `billing:update`

**P6-FR3: CRM/Opportunity Linking**
- `opportunity_id` field on quotes (nullable)
- Link to CRM opportunity if module exists
- Display on quote detail

**P6-FR4: Phase/Section Grouping UI**
- Visual section headers in quote builder
- Drag items between sections
- Collapsible sections
- Phase labels in PDF template

**P6-FR5: Quote Document Template Editor**
- Adapt invoice template designer for quote document templates (PDF rendering templates)
- Support quote-specific nodes (optional item markers, validity, CTA)
- Custom document template creation and editing

**P6-FR6: Auto-Expiration Background Job**
- Scheduled job to bulk-expire quotes past `valid_until`
- Complements the on-access check from Phase 1
- Sends notification to quote creator

**P6-FR7: Quote Duplication**
- "Duplicate" action to create a new quote from an existing one (not from template, but from an actual quote)
- Copies items, resets status to draft, generates new number
- Also available: "Save as Template" to create a business template from an existing quote

## Data Model

See detailed field definitions in the plan context above. Key tables:
- `quotes` — main entity, modeled on invoices with quote-specific fields. Includes `is_template` boolean for reusable business templates (following contract template pattern).
- `quote_items` — line items, modeled on `invoice_charges` with `is_optional`, `is_recurring`, `phase`. Includes `is_selected` boolean for tracking client's optional item selections.
- `quote_activities` — audit trail
- `quote_document_templates` / `standard_quote_document_templates` / `quote_document_template_assignments` — PDF rendering template storage (Phase 3). Uses shared AST engine.

### Naming Clarification
- **Quote templates** (`is_template` on quotes table) = reusable business configurations with predefined line items (like contract templates)
- **Quote document templates** (`quote_document_templates` table) = PDF/HTML rendering templates using AST engine (like invoice templates)

### Key Schema Decisions
- All monetary amounts as BIGINT (cents) — matches invoice pattern
- `quantity` as BIGINT (integer units) — matches `invoice_charges` post-migration
- `service_item_kind` column name — matches `invoice_charges`
- No `contract_line_id` on quote_items — mapping happens at conversion time
- `superseded` status distinct from `cancelled`
- `viewed_at` timestamp instead of `viewed` status (simpler state machine)
- `is_selected` on quote_items — tracks client's optional item choices (default true, toggled by client in portal, persisted server-side)

## Testing Strategy

The project uses **Vitest** (v4.0.18) with three test levels. Each phase should produce tests at the appropriate level.

### Test Infrastructure

- **Test framework**: Vitest with `environment: 'node'`, sequential execution (`maxConcurrency: 1`)
- **DB test context**: `server/test-utils/testContext.ts` — `TestContext` class with transaction-based rollback per test
- **Data factories**: `server/test-utils/testDataFactory.ts` — `createTenant()`, `createClient()`, `createUser()` helpers
- **DB config**: `.env.localtest` for PostgreSQL direct connection (port 5432)
- **Run commands**: `cd server && dotenv -e ../.env.localtest -- vitest src/test/infrastructure/billing/`
- **Billing package tests**: `packages/billing/tests/` with own `vitest.config.ts` (10s timeout)
- **Playwright**: `server/playwright.config.ts`, files match `**/*.playwright.test.ts`

### Test Levels per Phase

**Phase 1 — Unit + Infrastructure**
- **Unit** (`packages/billing/tests/quote/`):
  - Zod schema validation (createQuoteSchema, createQuoteItemSchema, status transitions)
  - Status transition logic (allowed/rejected transitions)
  - QuoteStatusBadge component rendering
- **Infrastructure** (`server/src/test/infrastructure/billing/quotes/`):
  - Quote CRUD via model (create, read, update, delete with TestContext)
  - Quote numbering (sequential generation, tenant isolation)
  - Quote item CRUD (create with service catalog lookup, rate override, reorder)
  - Auto-expiration on read
  - Deletion validation (drafts deletable, non-drafts blocked)
  - Business template CRUD and createQuoteFromTemplate

**Phase 2 — Unit + Infrastructure**
- **Unit**:
  - Totals calculation logic (subtotal, discounts, tax, total)
  - Optional item inclusion/exclusion in totals
  - Discount amount calculation (percentage, fixed, scoped)
- **Infrastructure**:
  - Tax calculation integration (taxService per item, exemption, reverse charge)
  - Discount line items (applies_to_item_id, applies_to_service_id)
  - Versioning (create revision, copy items, supersede old version, version chain query)
  - Totals recalculation on item changes

**Phase 3 — Unit + Infrastructure**
- **Unit**:
  - QuoteViewModel mapping (field mapping, currency formatting)
  - AST binding resolution (quoteNumber, validUntil, lineItems collection)
  - Standard quote template AST validity (schema validation)
- **Infrastructure**:
  - Quote document template CRUD
  - Template selection logic (per-quote → tenant default → standard fallback)
  - PDF generation (produces valid buffer, stores in file storage)

**Phase 4 — Infrastructure + Playwright**
- **Infrastructure**:
  - Send quote action (PDF generation, email sending, status update, multi-address)
  - Email logging (entity_type='quote')
  - Client portal server actions (list quotes by client, accept, reject, viewed_at tracking)
  - Optional item selection persistence (is_selected)
- **Playwright** (`server/src/test/e2e/quote-*.playwright.test.ts`):
  - Quote list page loads with correct columns and filters
  - Quote form: create, add items, save draft
  - Client portal: view quote, toggle optional items, accept/reject

**Phase 5 — Infrastructure**
- **Infrastructure**:
  - Quote→Contract conversion (contract lines, service configs, client_contracts assignment)
  - Quote→Invoice conversion (invoice_charges, totals, is_manual=true)
  - Combined conversion (atomicity, rollback on failure)
  - Optional item exclusion from conversion (is_selected=false)
  - Post-conversion field updates (converted_contract_id, converted_invoice_id, status=converted)

**Phase 6 — Unit + Infrastructure**
- **Unit**:
  - Approval status transition validation
- **Infrastructure**:
  - Approval workflow (submit, approve, reject, tenant config)
  - quotes:approve permission enforcement
  - Auto-expiration background job
  - Quote duplication and save-as-template

### Test File Naming Conventions

Follow existing patterns:
- Unit: `packages/billing/tests/quote/<topic>.test.ts`
- Infrastructure: `server/src/test/infrastructure/billing/quotes/<topic>.test.ts`
- Playwright: `server/src/test/e2e/quote-<feature>.playwright.test.ts`

### Test Data Setup Pattern

```typescript
// Infrastructure test example (follow existing billing test patterns)
import { TestContext } from '../../../../test-utils/testContext';

describe('Quote CRUD', () => {
  const ctx = new TestContext();

  beforeAll(async () => { await ctx.setupContext(); });
  beforeEach(async () => { await ctx.resetContext(); });
  afterEach(async () => { await ctx.rollbackContext(); });
  afterAll(async () => { await ctx.cleanupContext(); });

  it('creates a quote with generated number', async () => {
    const tenant = await ctx.createTenant();
    const client = await ctx.createClient(tenant);
    // ... test logic using ctx.knex for DB operations
  });
});
```

## Security / Permissions

- **Phase 1–5**: Use existing `billing:read`, `billing:create`, `billing:update`, `billing:delete` permissions
- **Phase 6**: Add `quotes:approve` permission for internal approval workflow
- Client portal: clients can view their own quotes, accept/reject, toggle optional items
- Client portal: clients cannot edit quote content or manually change status
- All actions tenant-isolated
- Server actions use `withAuth()` wrapper

## Rollout / Migration

- **Phase 1 migration**: Creates `quotes`, `quote_items`, `quote_activities` tables + seeds `next_number` for QUOTE entity type
- **Phase 3 migration**: Creates `quote_templates`, `standard_quote_templates`, `quote_template_assignments` tables + seeds standard templates
- **Phase 6 migration**: Adds `opportunity_id` to quotes if not present from Phase 1
- All migrations are additive — no changes to existing tables
- No backfill needed (new feature)
- No feature flag required — feature is additive. Tab visibility could be gated but not mandatory.

## Open Questions

1. ~~**Contact handling**~~ **Resolved**: Single primary contact on quote. Email can be sent to any address. Portal access for all client users with billing permissions.
2. ~~**Delete behavior**~~ **Resolved**: Hard delete for drafts with no business history. Archive (via `deleteEntityWithValidation` with `supportsArchive: true`) for anything with history.
3. ~~**Quote business templates**~~ **Resolved**: Add `is_template` boolean to quotes table, following contract template pattern. Reusable configurations with predefined line items.
4. ~~**Optional item selections**~~ **Resolved**: Client selections persisted server-side (`is_selected` on quote_items). On accept, selections sent back to MSP for review before conversion.
5. ~~**Quote template wizard**~~ **Resolved**: Both — wizard for new templates + quick create for simple ones (matching contract template pattern). "Save as Template" from existing quotes in Phase 6.
6. ~~**Archived quotes visibility**~~ **Resolved**: Status filter dropdown in quote list includes archived. Filter options: All, Drafts, Sent, Accepted, Rejected, Expired, Converted, Cancelled, Archived.

## Acceptance Criteria (Definition of Done)

### Phase 1
- [ ] Database tables created with proper indexes and Citus compatibility
- [ ] Quote numbering generates sequential Q-XXXX numbers
- [ ] CRUD operations work for quotes and line items
- [ ] Service catalog items can be added as line items with rate overrides
- [ ] Optional and recurring flags function on line items
- [ ] Status transitions enforced
- [ ] Auto-expiration works on access
- [ ] Quotes tab visible in billing dashboard
- [ ] Quote list, form, and detail views functional
- [ ] Quote business templates: create, edit, delete templates
- [ ] "Create from Template" populates new draft with template's items
- [ ] Deletion validation: drafts deletable, non-drafts blocked with archive alternative

### Phase 2
- [ ] Tax calculates correctly per line item using existing tax service
- [ ] Discounts (percentage and fixed) apply correctly
- [ ] Totals recalculate on any item change
- [ ] Quote versioning creates proper revision chain
- [ ] Version history navigable in UI

### Phase 3
- [ ] Quote template tables created
- [ ] Standard quote templates render correctly
- [ ] PDF generation produces professional documents
- [ ] Preview works in-browser
- [ ] Template selection per quote or tenant default

### Phase 4
- [ ] Quotes sent via email to any address with PDF attachment
- [ ] Client portal shows quotes tab (accessible to all users with billing permissions)
- [ ] Clients can view quote details with optional item toggles (selections persisted server-side)
- [ ] Accept sends client's optional item configuration to MSP for review
- [ ] Reject with comment works end-to-end
- [ ] Viewed tracking works

### Phase 5
- [ ] Recurring items convert to contract with proper service configurations
- [ ] One-time items convert to invoice charges
- [ ] Combined conversion works atomically
- [ ] Conversion preview shows accurate mapping
- [ ] Post-conversion links work bidirectionally

### Phase 6
- [ ] Approval workflow routes quotes through pending_approval → approved
- [ ] quotes:approve permission controls access
- [ ] Phase grouping renders in UI and PDF
- [ ] Quote template editor works
- [ ] Auto-expiration job runs on schedule
