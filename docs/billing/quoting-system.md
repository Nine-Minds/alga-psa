# Quoting System

The Quoting System enables MSPs to create, send, and manage pricing proposals for clients directly within Alga PSA. Quotes integrate with the existing billing infrastructure — service catalog, tax, discounts, document templates, PDF generation, email, and client portal — and can be converted into contracts and/or invoices upon acceptance.

## Table of Contents

1. [Overview](#overview)
2. [Quote Lifecycle](#quote-lifecycle)
3. [Data Model](#data-model)
4. [Line Items](#line-items)
5. [Tax and Discounts](#tax-and-discounts)
6. [Totals Calculation](#totals-calculation)
7. [Versioning](#versioning)
8. [Document Templates and PDF Generation](#document-templates-and-pdf-generation)
9. [Email Sending](#email-sending)
10. [Client Portal](#client-portal)
11. [Conversion Workflows](#conversion-workflows)
12. [Approval Workflow](#approval-workflow)
13. [Quote Templates](#quote-templates)
14. [Auto-Expiration](#auto-expiration)
15. [Permissions and Security](#permissions-and-security)
16. [Feature Flags](#feature-flags)
17. [Key Files](#key-files)

---

## Overview

Quotes are pre-sale pricing proposals that MSPs create for clients. A quote contains line items (from the service catalog or custom entries), optional items the client can toggle, discounts, and tax calculations. Once accepted by the client, a quote can be converted into contracts (for recurring services) and invoices (for one-time charges).

Key capabilities:
- Full CRUD with tenant isolation
- Sequential numbering (Q-0001, Q-0002, ...) via `SharedNumberingService`
- Status-driven lifecycle with enforced transitions
- Reusable business templates (predefined line item configurations)
- Professional PDF generation using the shared AST template engine
- Client portal integration for self-service review and acceptance
- Atomic conversion to contracts and/or invoices
- Optional internal approval workflow (configurable per tenant)
- Activity audit trail on all state changes

---

## Quote Lifecycle

Quotes follow a status-driven lifecycle with enforced transitions.

### Statuses

| Status | Description |
|--------|-------------|
| `draft` | Being composed, not yet visible to client |
| `pending_approval` | Submitted for internal approval (optional workflow) |
| `approved` | Approved internally, ready to send |
| `sent` | Delivered to client, awaiting response |
| `accepted` | Client accepted the proposal |
| `rejected` | Client declined the proposal |
| `expired` | Past `valid_until` date without response |
| `converted` | Successfully converted to contract/invoice |
| `cancelled` | Manually cancelled by MSP |
| `superseded` | Replaced by a newer revision |

### Status Transitions

```
draft ──────────► sent (if approval disabled)
draft ──────────► pending_approval ──► approved ──► sent (if approval enabled)
draft ──────────► cancelled
sent ───────────► accepted / rejected / expired / cancelled
accepted ───────► converted
sent/rejected ──► superseded (when a new revision is created)
```

### Auto-Expiration

Quotes with status `sent` are automatically expired when `valid_until < today`:
- **On access**: checked every time a quote is fetched via `getById`
- **Background job**: scheduled job bulk-expires quotes across all tenants

---

## Data Model

### `quotes` Table

Primary entity table with Citus-compatible composite keys.

| Column | Type | Description |
|--------|------|-------------|
| `tenant` | UUID | Tenant isolation key |
| `quote_id` | UUID | Primary identifier |
| `quote_number` | TEXT | Human-readable number (Q-0001) |
| `client_id` | UUID | Associated client |
| `contact_name_id` | UUID | Primary contact |
| `title` | TEXT | Quote title |
| `description` | TEXT | Scope of work / description |
| `status` | TEXT | Current lifecycle status |
| `is_template` | BOOLEAN | If true, this is a reusable business template |
| `quote_date` | DATE | Date of the quote |
| `valid_until` | DATE | Expiration date |
| `subtotal` | BIGINT | Sum of line item amounts (cents) |
| `discount_total` | BIGINT | Sum of discount amounts (cents) |
| `tax` | BIGINT | Sum of tax amounts (cents) |
| `total_amount` | BIGINT | Final total (cents) |
| `currency_code` | TEXT | Currency (defaults to tenant currency) |
| `po_number` | TEXT | Client PO reference |
| `notes` | TEXT | Internal notes (not visible to client) |
| `client_notes` | TEXT | Client-facing notes |
| `terms_and_conditions` | TEXT | T&C text |
| `version` | INT | Version number (1-based) |
| `parent_quote_id` | UUID | Links revision chain |
| `opportunity_id` | UUID | Optional CRM link |
| `sent_at` | TIMESTAMP | When first sent |
| `accepted_at` | TIMESTAMP | When accepted |
| `accepted_by` | UUID | Portal user who accepted |
| `rejected_at` | TIMESTAMP | When rejected |
| `rejection_reason` | TEXT | Client's rejection comment |
| `viewed_at` | TIMESTAMP | When client first viewed |
| `converted_contract_id` | UUID | Link to converted contract |
| `converted_invoice_id` | UUID | Link to converted invoice |
| `template_id` | UUID | Document template override |
| `approval_status` | TEXT | Internal approval state |

Indexes: `(tenant, client_id)`, `(tenant, status)`, `(tenant, quote_number)`, `(tenant, parent_quote_id)`

### `quote_items` Table

Line items modeled on `invoice_charges` with quote-specific fields.

| Column | Type | Description |
|--------|------|-------------|
| `tenant` | UUID | Tenant isolation key |
| `quote_item_id` | UUID | Primary identifier |
| `quote_id` | UUID | Parent quote |
| `service_id` | UUID | Service catalog reference (nullable for custom items) |
| `service_name` | TEXT | Denormalized service name |
| `service_sku` | TEXT | Denormalized SKU |
| `description` | TEXT | Line item description |
| `quantity` | BIGINT | Item quantity |
| `unit_price` | BIGINT | Price per unit (cents) |
| `total_price` | BIGINT | quantity * unit_price (cents) |
| `unit_of_measure` | TEXT | e.g., "hour", "user", "unit" |
| `billing_method` | TEXT | fixed, hourly, usage, per_unit |
| `is_optional` | BOOLEAN | Client can toggle on/off |
| `is_selected` | BOOLEAN | Client's current selection (default true) |
| `is_recurring` | BOOLEAN | Recurring vs one-time |
| `billing_frequency` | TEXT | monthly, quarterly, etc. |
| `is_taxable` | BOOLEAN | Subject to tax |
| `tax_region` | TEXT | Tax jurisdiction |
| `tax_rate` | DECIMAL | Applied tax rate |
| `tax_amount` | BIGINT | Calculated tax (cents) |
| `is_discount` | BOOLEAN | If true, this is a discount line |
| `discount_type` | TEXT | percentage or fixed |
| `discount_percentage` | DECIMAL | For percentage discounts |
| `applies_to_item_id` | UUID | Scoped to specific item |
| `applies_to_service_id` | UUID | Scoped to specific service |
| `phase` | TEXT | Phase/section label for grouping |
| `display_order` | INT | Sort position |

### `quote_activities` Table

Audit trail for all quote state changes.

| Column | Type | Description |
|--------|------|-------------|
| `tenant` | UUID | Tenant isolation key |
| `activity_id` | UUID | Primary identifier |
| `quote_id` | UUID | Parent quote |
| `activity_type` | TEXT | created, updated, sent, accepted, etc. |
| `description` | TEXT | Human-readable description |
| `performed_by` | UUID | User who performed action |
| `metadata` | JSONB | Additional context |
| `created_at` | TIMESTAMP | When activity occurred |

### Document Template Tables

| Table | Purpose |
|-------|---------|
| `quote_document_templates` | Tenant-specific PDF rendering templates (AST JSON) |
| `standard_quote_document_templates` | System-wide default templates |
| `quote_document_template_assignments` | Tenant-to-template mapping |

---

## Line Items

### Service Catalog Integration

When adding an item from the service catalog, the following fields are denormalized from the catalog:
- `service_name`, `service_sku`, `unit_price`, `unit_of_measure`, `billing_method`

Rate overrides are supported — the `unit_price` on the quote item can differ from the catalog default.

### Custom Line Items

Items without a `service_id` are custom/manual entries where the user provides all fields directly.

### Optional Items

Items marked `is_optional = true` can be toggled by the client in the portal. The `is_selected` field tracks the client's current selection. Optional items with `is_selected = false` are excluded from totals and from conversion.

### Recurring vs One-Time

The `is_recurring` flag and `billing_frequency` determine how items are handled during conversion:
- **Recurring items** → contract lines
- **One-time items** → invoice charges

### Phase Grouping

The `phase` text field groups items visually in the UI and PDF. Items with the same phase label are rendered together under a section header.

### Ordering

`display_order` controls the visual sort order. Reorder operations update all items in batch.

---

## Tax and Discounts

### Tax Calculation

Tax integrates with the existing `taxService.calculateTax()`:
- Called per line item based on `tax_region` and item taxability
- Honors client tax exemptions
- Supports reverse-charge scenarios
- `tax_source` field tracks whether tax was calculated internally or externally

### Discounts

Discounts are represented as separate line items with `is_discount = true`:

| Scope | Field | Behavior |
|-------|-------|----------|
| Item-scoped | `applies_to_item_id` | Applies to a specific line item |
| Service-scoped | `applies_to_service_id` | Applies to all items of a given service |
| Quote-level | Neither set | Applies to the quote total |

Discount types:
- **Percentage**: uses `discount_percentage` field
- **Fixed**: uses `unit_price` as the fixed discount amount

---

## Totals Calculation

Totals are recalculated on every item mutation (add, update, remove, reorder).

```
subtotal       = SUM(total_price) for non-discount, selected items
discount_total = SUM(discount amounts) for applicable discount lines
tax            = SUM(tax_amount) for selected, taxable items
total_amount   = subtotal - discount_total + tax
```

Items with `is_optional = true` and `is_selected = false` are excluded from all totals.

Service: `packages/billing/src/services/quoteCalculationService.ts`

---

## Versioning

When a sent or rejected quote needs changes, a **revision** is created rather than editing in place:

1. A new `quotes` row is created with `version = prev + 1`
2. `parent_quote_id` links to the original quote (first version)
3. All `quote_items` are cloned to the new version
4. The old version's status is set to `superseded`
5. The same `quote_number` is reused across versions (displayed as "Q-0042 v2")

The version history chain can be queried via `parent_quote_id` to display all versions with navigation in the UI.

---

## Document Templates and PDF Generation

### Template Architecture

Quote document templates use the same AST (Abstract Syntax Tree) engine as invoice templates:

- **AST schema**: Extended to support quote-specific node types
- **Value bindings**: `quoteNumber`, `quoteDate`, `validUntil`, `status`, `scope`, totals, T&C, version
- **Collection bindings**: `lineItems` (with optional/recurring flags), phases
- **Standard templates**: `standard-quote-default` (clean layout) and `standard-quote-detailed` (full branding, phase grouping)

### PDF Generation Flow

```
Fetch quote → mapDbQuoteToViewModel → Evaluate AST → Render HTML → Puppeteer → PDF buffer → Store in file storage
```

### Preview

In-browser preview renders the template without Puppeteer, using the same AST evaluation and React rendering pipeline as invoices.

### Template Selection Priority

1. Per-quote `template_id` override
2. Tenant default quote template (via `quote_template_assignments`)
3. Fallback to `standard-quote-default`

### Key Files

- Adapter: `packages/billing/src/lib/adapters/quoteAdapters.ts`
- Bindings: `packages/billing/src/lib/quote-template-ast/bindings.ts`
- Standard templates: `packages/billing/src/lib/quote-template-ast/standardTemplates.ts`
- Template selection: `packages/billing/src/lib/quote-template-ast/templateSelection.ts`
- PDF service: `packages/billing/src/services/quotePdfGenerationService.ts`

---

## Email Sending

### Send Quote Action

1. Validates quote is in sendable state (draft or approved)
2. Generates PDF
3. Sends email to one or more addresses (defaults to primary contact, supports additional recipients)
4. Updates `sent_at` timestamp, status → `sent`
5. Logs activity

### Email Templates

| Template | Trigger |
|----------|---------|
| Quote Sent | When MSP sends quote to client |
| Quote Reminder | For quotes approaching `valid_until` |
| Quote Accepted | Sent to MSP when client accepts |

### Email Logging

All sent emails are logged in `email_sending_logs` with `entity_type = 'quote'`, including delivery metadata.

Templates: `packages/billing/src/lib/quote-email-templates.ts`

---

## Client Portal

### Quotes Tab

A "Quotes" tab is added to the client portal billing overview, accessible to all client portal users with billing permissions.

- Quote list: DataTable with Quote #, Title, Amount, Status, Date
- Status filter
- Row click navigates to quote detail

### Quote Detail

- Full line items display with optional item toggles
- Toggling optional items recalculates totals client-side
- Optional item selections are persisted server-side (survives page reload)
- Client-friendly status text ("Awaiting Your Response", "Accepted", etc.)
- Terms and conditions display

### Accept / Reject

- **Accept**: Persists client's optional item selections, sets `accepted_at` and `accepted_by` (portal user), status → `accepted`. The MSP then reviews the client's configuration choices before converting.
- **Reject**: Opens comment field, sets `rejected_at` and `rejection_reason`, status → `rejected`

### Viewed Tracking

`viewed_at` is set on the client's first portal view of the quote (deduplicated — only the first view is recorded). Visible to the MSP on the quote detail page.

### Key Files

- Portal actions: `packages/client-portal/src/client-portal-actions/client-billing.ts`
- Portal quote list: `packages/client-portal/src/components/billing/QuotesTab.tsx`
- Portal quote detail: `packages/client-portal/src/components/billing/QuoteDetailPage.tsx`

---

## Conversion Workflows

Accepted quotes can be converted into contracts, invoices, or both.

### Quote to Contract

For each **recurring** quote item (where `is_selected = true`):
1. Creates a new contract (status: draft)
2. Creates `contract_line` entries matching billing method
3. Creates service configurations (`_fixed_config`, `_hourly_config`, `_usage_config`)
4. Creates `client_contracts` assignment
5. Sets `quote.converted_contract_id`

### Quote to Invoice

For each **one-time** quote item (where `is_selected = true`):
1. Creates a new invoice (status: draft, `is_manual: true`)
2. Creates `invoice_charge` entries with matching fields
3. Calculates invoice totals
4. Sets `quote.converted_invoice_id`

### Combined Conversion

For quotes with both recurring and one-time items:
1. Contract conversion runs for recurring items
2. Invoice conversion runs for one-time items
3. Both run in a single transaction (atomic — rolls back on failure)
4. Both `converted_contract_id` and `converted_invoice_id` are set
5. Status → `converted`

### Conversion Preview

Before converting, a preview dialog shows:
- Which items map to contract lines vs invoice charges
- Contract details (name, billing config)
- Invoice details
- User confirms before proceeding

### Post-Conversion Links

- Quote detail shows links to the created contract/invoice
- Contract detail page links back to the source quote

Service: `packages/billing/src/services/quoteConversionService.ts`

---

## Approval Workflow

An optional internal approval workflow can be enabled per tenant.

### Flow

```
Draft → Submit for Approval → Pending Approval → Approve → Approved → Send
                                                → Request Changes → Draft
```

### Configuration

- Approval can be enabled/disabled per tenant via billing settings
- When disabled, drafts can be sent directly
- When enabled, drafts must go through approval before sending

### Permission

A dedicated `quotes:approve` permission controls who can approve quotes, separate from the general `billing:update` permission.

### Approval Dashboard

An approval dashboard (following the `ManagerApprovalDashboard` pattern) lists quotes pending approval with approve/reject actions and optional comments.

### Key Files

- Settings: `packages/billing/src/lib/quoteApprovalSettings.ts`
- Dashboard: `packages/billing/src/components/billing-dashboard/quotes/QuoteApprovalDashboard.tsx`
- Route: `/msp/quote-approvals`

---

## Quote Templates

There are two distinct concepts of "templates" in the quoting system:

### Business Templates (Reusable Configurations)

Quotes with `is_template = true` serve as reusable configurations with predefined line items. They follow the contract template pattern:
- Not numbered, don't go through the status lifecycle
- "Create from Template" copies a template's items into a new draft quote
- "Save as Template" creates a business template from an existing quote
- Templates store predefined line items, default terms, and description/scope

### Document Templates (PDF Rendering)

Stored in `quote_document_templates` and rendered via the shared AST engine. These define how a quote looks as a PDF/HTML document, not what it contains. See [Document Templates and PDF Generation](#document-templates-and-pdf-generation).

---

## Auto-Expiration

Quotes past their `valid_until` date are expired through two mechanisms:

### On-Access Check

Every call to `getById` checks if `valid_until < today` and status is `sent`. If so, the quote is automatically set to `expired` before being returned.

### Background Job

A scheduled job runs periodically to bulk-expire qualifying quotes across all tenants, complementing the on-access check for quotes that aren't actively being viewed.

Handler: `server/src/lib/jobs/handlers/expireQuotesHandler.ts`

---

## Permissions and Security

| Permission | Scope |
|------------|-------|
| `billing:read` | View quotes |
| `billing:create` | Create quotes |
| `billing:update` | Edit quotes |
| `billing:delete` | Delete/archive quotes |
| `quotes:approve` | Approve/reject quotes in approval workflow |

All server actions are wrapped with `withAuth()`. All database queries are tenant-scoped.

Client portal users with billing permissions can:
- View their own quotes
- Toggle optional items
- Accept or reject quotes

Client portal users **cannot**:
- Edit quote content
- Manually change quote status
- View other clients' quotes

---

## Feature Flags

The quoting system is gated behind feature flags for gradual rollout. The feature flag controls visibility of:
- Quotes tab in the billing dashboard
- Quote-related menu items in the sidebar
- Quote approval dashboard route

Runtime flag: defined in `packages/core/src/lib/featureFlagRuntime.ts`

---

## Key Files

### Types and Schemas

| File | Purpose |
|------|---------|
| `packages/types/src/interfaces/quote.interfaces.ts` | Core TypeScript interfaces (`IQuote`, `IQuoteItem`, `IQuoteActivity`, `QuoteStatus`) |
| `packages/billing/src/schemas/quoteSchemas.ts` | Zod validation schemas and status transition rules |

### Models (Data Access)

| File | Purpose |
|------|---------|
| `packages/billing/src/models/quote.ts` | Quote CRUD, listing, auto-expiration |
| `packages/billing/src/models/quoteItem.ts` | Line item CRUD, reorder, service catalog lookup |
| `packages/billing/src/models/quoteActivity.ts` | Audit trail entries |
| `packages/billing/src/models/quoteDocumentTemplate.ts` | Document template CRUD |

### Server Actions

| File | Purpose |
|------|---------|
| `packages/billing/src/actions/quoteActions.ts` | All quote server actions (CRUD, send, convert, approve, duplicate) |
| `packages/billing/src/actions/quoteDocumentTemplates.ts` | Document template actions |
| `packages/billing/src/actions/quoteTemplatePreview.ts` | Template preview actions |

### Services

| File | Purpose |
|------|---------|
| `packages/billing/src/services/quoteCalculationService.ts` | Totals recalculation |
| `packages/billing/src/services/quoteConversionService.ts` | Quote to contract/invoice conversion |
| `packages/billing/src/services/quotePdfGenerationService.ts` | PDF generation |

### UI Components (MSP)

| File | Purpose |
|------|---------|
| `packages/billing/src/components/billing-dashboard/quotes/QuotesTab.tsx` | Quote list with filters |
| `packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx` | Create/edit form |
| `packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx` | Read-only detail view with actions |
| `packages/billing/src/components/billing-dashboard/quotes/QuoteLineItemsEditor.tsx` | Line item management |
| `packages/billing/src/components/billing-dashboard/quotes/QuotePreviewPanel.tsx` | In-browser PDF preview |
| `packages/billing/src/components/billing-dashboard/quotes/QuoteStatusBadge.tsx` | Status badge component |
| `packages/billing/src/components/billing-dashboard/quotes/QuoteConversionDialog.tsx` | Conversion preview and confirmation |
| `packages/billing/src/components/billing-dashboard/quotes/QuoteApprovalDashboard.tsx` | Internal approval dashboard |
| `packages/billing/src/components/billing-dashboard/quotes/QuoteDocumentTemplateEditor.tsx` | Document template editor |

### UI Components (Client Portal)

| File | Purpose |
|------|---------|
| `packages/client-portal/src/components/billing/QuotesTab.tsx` | Client quote list |
| `packages/client-portal/src/components/billing/QuoteDetailPage.tsx` | Client quote detail with accept/reject |
| `packages/client-portal/src/client-portal-actions/client-billing.ts` | Portal server actions |

### Template AST

| File | Purpose |
|------|---------|
| `packages/billing/src/lib/quote-template-ast/bindings.ts` | Quote-specific AST bindings |
| `packages/billing/src/lib/quote-template-ast/standardTemplates.ts` | Default and detailed template ASTs |
| `packages/billing/src/lib/quote-template-ast/templateSelection.ts` | Template resolution logic |
| `packages/billing/src/lib/adapters/quoteAdapters.ts` | DB → ViewModel mapping |

### Database

| File | Purpose |
|------|---------|
| `server/seeds/dev/migrations/20260320100000_create_quotes_tables.cjs` | Core tables migration |
| `server/seeds/dev/migrations/20260320101000_add_tax_source_to_quotes.cjs` | Tax source field |
| `server/seeds/dev/migrations/20260320102000_create_quote_document_templates.cjs` | Document template tables |
| `server/seeds/dev/13_next_number.cjs` | QUOTE entity type seed |

### Routes

| Route | Purpose |
|-------|---------|
| `/msp/billing?tab=quotes` | Billing dashboard quotes tab |
| `/msp/billing/quotes/[quoteId]` | Individual quote detail page |
| `/msp/quote-approvals` | Approval dashboard |
| `/msp/quote-document-templates` | Document template editor |

### Tests

| Location | Coverage |
|----------|----------|
| `packages/billing/tests/quote/` | Unit tests (schemas, calculations, templates, PDF, emails) |
| `server/src/test/infrastructure/billing/quotes/` | Infrastructure tests (CRUD, conversion, expiration) |
| `packages/client-portal/src/client-portal-actions/` | Client portal action tests |
