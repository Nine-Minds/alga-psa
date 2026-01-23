# MSP Billing System Design

## System Purpose

The billing platform supports the full contract-centric workflow used by managed service providers. It replaces the older "billing plan" and "bundle" language with contract lines, client contracts, and contract templates. Clients can combine fixed recurring fees, hourly work, consumption-based services, license passthrough, and prepayment credits under a single contract umbrella. The billing engine produces detailed charge breakdowns, applies discounts, reconciles credits, and feeds those results into the invoicing subsystem.

Key goals:

- Represent reusable offer structures with templates while keeping client-specific data separate.
- Allow multiple simultaneous contract lines per client, each with its own pricing configuration.
- Capture time, usage, and product charges without losing the context required for auditing or taxation.
- Harmonize manual invoices and automated contract billing through the same taxation and transaction pipelines.

## Updated Domain Vocabulary

| Term | Description | Primary Tables |
| --- | --- | --- |
| **Contract template** | A reusable blueprint for a contract, including recommended lines, default billing frequencies, and metadata. | `contract_templates`, `contract_template_lines`, `contract_template_line_services`, `contract_template_line_service_configuration`, `contract_template_line_service_*` |
| **Contract** | A sellable contract definition that can be assigned to clients. Created directly or derived from a template. | `contracts`, `contract_lines`, `contract_pricing_schedules` |
| **Client contract** | A specific assignment of a contract to a client, with start/end dates, PO requirements, and lifecycle status. | `client_contracts` |
| **Contract line** | A billable line definition (fixed, hourly, usage, bucket, product, license). | `contract_lines`, `contract_line_fixed_config`, `contract_line_service_configuration`, `contract_line_service_*` |
| **Client contract line** | A client-scoped instance of a contract line. Stores cloned template data, pricing overrides, and service configuration snapshots. | `client_contract_lines`, `client_contract_line_pricing`, `client_contract_line_terms`, `client_contract_services`, `client_contract_service_configuration`, `client_contract_service_*` |
| **Billing cycle** | Defines the cadence for invoicing a client. | `client_billing_cycles`, retrieved through `BillingEngine.getBillingCycle` |

Supporting entities still in use:

- `time_entries`, `usage_tracking`, `bucket_usage`, `contract_line_discounts`, `discounts` hold the underlying activity feeding the engine.
- `invoices`, `invoice_items`, `invoice_item_details`, `invoice_item_fixed_details` store rendered billing output.
- `transactions`, `credit_tracking`, `credit_reconciliation_reports` maintain the financial ledger and credit balances.

## Products (Catalog → Contracts → Invoices)

Products are implemented as a **subset of the existing service catalog**:

- Catalog rows live in `service_catalog` with `item_kind = 'product'`.
- Products are quantity-based sellable items (`billing_method = 'per_unit'` in V1).
- Multi-currency pricing is stored in `service_prices` (one row per currency). `service_catalog.default_rate` mirrors the “primary” price for convenience.
- Tax behavior is driven by `service_catalog.tax_rate_id` (nullable = non-taxable).
- Optional license metadata (term/cadence) is stored on the catalog row (`is_license`, `license_term`, `license_billing_cadence`) without start/end/proration in V1.

### Attaching products to contracts

- Contract templates and contract wizards allow attaching products as recommended/default items (with quantity) and cloning them into client snapshots.
- When a contract is assigned to a client, the attached products are stored as `client_contract_services` for the relevant `client_contract_line_id`.
- Rate selection follows the normal hierarchy (catalog price for the contract currency unless an override is explicitly entered at the client/contract level).

### Billing and invoice output

- During invoice generation, products are translated into `type = 'product'` charges in the billing engine and persisted as `invoice_items` + details rows.
- Products appear on invoices as distinct line items (and should be visually distinguished from time/usage/services in templates and client portal views).
- Currency correctness rules:
  - The contract currency controls which `service_prices.currency_code` is used.
  - If a product lacks a price in the contract currency, billing requires an explicit override (to avoid accidental $0 lines).

### Taxes and accounting mapping

- Tax calculation uses the same invoice persistence pipeline (`invoiceService.calculateAndDistributeTax`) and applies the product’s `tax_rate_id` (or falls back to client defaults depending on tenant tax configuration).
- Accounting exports and mappings treat products as catalog items; they reuse the existing mapping resolution paths for `service` / `service_category` where applicable.

## Data Model Layers

### Template Layer (authoring reusable offers)

Templates give sales and operations teams a curated starting point.

- `contract_templates` – high level metadata (name, default frequency, status, optional JSON metadata).
- `contract_template_lines` – line-level defaults (type, descriptions, frequency, overtime rules) along with display order, billing timing, and optional template-level custom rates.
- `contract_template_line_terms` – stores timing/terms metadata for template lines, including the new `billing_timing` flag (`arrears` or `advance`) that seeds client assignments.
- `contract_template_line_services` – recommended catalog services and default quantities for a template line.
- `contract_template_line_service_configuration` and child tables (`_fixed`, `_hourly`, `_usage`, `_bucket`) – configuration defaults for each service type.

Publishing or cloning a template never mutates the template tables; instead, the structure is copied into the client-specific tables via `cloneTemplateContractLine` (`server/src/lib/billing/utils/templateClone.ts`).

### Contract Library (sellable contracts)

Contracts live in tenant scope and are managed through `server/src/lib/actions/contractActions.ts`.

- `contracts` – stores live contract definitions. `status` drives availability (`draft`, `active`, `expired`, etc.).
- `contract_lines` – stores contract-specific lines (including display order, billing timing, and optional custom rates) alongside shared metadata (`contract_line_name`, type, frequency, etc.).
- `contract_pricing_schedules` – time-bound overrides that swap in a custom rate when a schedule is effective during billing.

Contracts can be created manually or cloned from templates. When cloning, template IDs are preserved in `contracts.template_metadata` for traceability.

### Client Instance Layer

When a contract is assigned to a client, the system snapshots all relevant data:

- `client_contracts` – assignment record with start/end dates, PO requirements, and current status. Managed by `clientContractActions` (`server/src/lib/actions/client-actions/clientContractActions.ts`).
  - Purchase order fields:
    - `po_required` (boolean) – blocks invoice generation when enabled and `po_number` is missing.
    - `po_number` (text) – the customer’s PO reference used on invoices and accounting exports.
    - `po_amount` (bigint cents, nullable) – advisory “authorized spend” amount for warning on overages.
- `client_contract_lines` – individual lines the client receives. Each record may reference both the base contract line and the originating template line (for audits).
- `client_contract_line_terms` – per-client billing rules (frequency, overtime, rounding) plus the `billing_timing` setting that determines whether a line bills in advance or arrears.
- `client_contract_line_pricing` – the rate strategy used for the client instance. Stores template references and overrides applied either by templates, contracts, or pricing schedules.
- `client_contract_services` – concrete service list attached to a client line with tenant-specific quantity and rate overrides.
- `client_contract_service_configuration` and `_fixed`, `_hourly`, `_usage`, `_bucket`, `_rate_tiers` – cloned configuration records so the billing engine never reads template tables during invoice generation.
- `client_contract_line_discounts` – optional mapping of discounts to client contract lines.

The cloning helper ensures that future template edits do not retroactively change existing client contracts while still allowing the UI to surface “template vs client” differences.

## Purchase Orders (PO)

Alga stores PO context on the client contract assignment (`client_contracts`) and snapshots the PO number onto invoices generated from contract billing:

- `invoices.po_number` – stored as a snapshot at invoice creation time.
- `invoices.client_contract_id` – links an invoice back to the generating contract assignment for PO consumption tracking.

### PO limits (advisory)

If `client_contracts.po_amount` is set, billing computes warnings when a newly generated invoice would exceed the remaining authorized spend:

- Remaining is calculated from finalized invoices for the same `client_contract_id`.
- Overages are warnings (invoice generation is not blocked), but UI flows prompt users to allow or skip overages during batch invoicing.

### Activity & Reference Data

- **Time** – `time_entries`, `user_type_rates`, approval workflow tables.
- **Usage** – `usage_tracking`, `usage_summary`, relevant service configuration.
- **Buckets** – `bucket_usage` tracks consumption for retainer-style offerings.
- **Catalog** – `service_catalog`, `service_categories` feed descriptions, default rates, and tax attributes.
- **Tax** – `tax_rates`, `client_tax_settings`, `client_tax_rates` (default region lookup), with helpers in `clientTaxRateActions`.
- **Discounts & Adjustments** – `discounts`, `contract_line_discounts`, planned `adjustments` table for ad-hoc corrections.

## Contract Lifecycle

1. **Author or import template** – users manage templates through `ContractTemplateModel` actions (`server/src/lib/models/contractTemplate.ts`) and UI in `server/src/components/billing-dashboard/contracts/templates/*`.
2. **Create contract** – `createContract` in `contractActions.ts` creates a sellable contract. Templates can be cloned using wizard actions (`contractWizardActions.ts`) to seed contract lines and metadata.
3. **Attach contract lines** – server actions in `server/src/lib/actions/contractActions.ts` call the shared repository to clone template lines into `contract_lines` (or update template snapshots) while exposing `addContractLine(contractId, contractLineId, customRate?)` to callers.
4. **Assign to client** – `assignContractToClient(clientId, contractId, startDate, endDate?)` from `clientContractActions.ts` creates `client_contracts` rows. This call ensures there is no overlap with other active contracts.
5. **Clone template data** – if the assignment originated from a template, `cloneTemplateContractLine` copies default terms, services, and configuration into the client tables. Additional overrides can be applied through `clientContractLineActions` and `clientContractServiceActions`.
6. **Maintain lifecycle** – `updateContract`, `updateClientContract`, and the pricing schedule actions keep data in sync as contracts renew, expire, or are repriced.

Example (simplified):

```typescript
import { createContract } from 'server/src/lib/actions/contractActions';
import { addContractLine } from 'server/src/lib/actions/contractActions';
import { assignContractToClient } from 'server/src/lib/actions/client-actions/clientContractActions';

const contract = await createContract({
  contract_name: 'Standard MSP Package',
  contract_description: 'Baseline services for managed clients',
  billing_frequency: 'monthly',
  status: 'draft',
  is_active: false
});

await addContractLine(contract.contract_id, 'support-contract-line-id');
await addContractLine(contract.contract_id, 'security-contract-line-id', 12999); // cents override

await assignContractToClient('client-id', contract.contract_id, '2025-01-01', null);
```

## Billing Engine Flow

The billing engine lives in `server/src/lib/billing/billingEngine.ts`. It operates per client and billing cycle and returns an `IBillingResult` consumed by invoice generation.

1. **Initialize tenant context** – `createTenantKnex()` establishes the multi-tenant connection.
2. **Load billing cycle** – `client_billing_cycles` provides effective date ranges using **`[start, end)`** semantics (end is exclusive). If no explicit period exists, the engine derives it from the client’s frequency.
3. **Guard rails** – `validateBillingPeriod` ensures the requested range does not span cycle changes. Existing invoices are detected via `hasExistingInvoiceForCycle`.
4. **Collect client contract lines** – `getClientContractLinesAndCycle` joins `client_contract_lines`, `contract_lines`, `client_contract_line_pricing`, `client_contract_line_terms`, and the parent contract to build a normalized in-memory model. Template references are resolved so both template-sourced and bespoke lines participate.
5. **Charge calculation** – for each client contract line the engine executes:
   - `calculateFixedPriceCharges` – handles fixed-fee lines. Custom rates from `client_contract_line_pricing` or active `contract_pricing_schedules` short-circuit to a single consolidated charge. Otherwise the function gathers services from `client_contract_services` + configuration tables, derives FMV allocations, prorates when required, and calculates per-service tax using `TaxService`.
   - `calculateTimeBasedCharges` – pulls approved `time_entries` tied to the line, respecting overtime rules, user type overrides, and rounding settings from `client_contract_line_terms` and `client_contract_service_hourly_config`.
   - `calculateUsageBasedCharges` – consumes `usage_tracking`, applies tiered pricing via `client_contract_service_rate_tiers`, and produces `IUsageBasedCharge` entries.
   - `calculateBucketPlanCharges` – reconciles `bucket_usage` rollovers and overages for retainer-style offerings.
   - `calculateProductCharges` and `calculateLicenseCharges` – forward-fill catalog-driven passthrough items such as licenses. These functions rely on `client_contract_services` to know which catalog items to include for the period.
6. **Proration** – `applyProrationToPlan` prorates fixed charges when the contract line starts or ends mid-cycle based on settings captured in the client term snapshot.
7. **Discounts & adjustments** – `applyDiscountsAndAdjustments` looks for active discounts in `contract_line_discounts` for the client. Adjustment support is scaffolded (`fetchAdjustments`) and is the next planned enhancement.
8. **Tax normalization** – the billing engine gathers preliminary tax data, but final calculation happens during invoice persistence via `calculateAndDistributeTax` in `server/src/lib/services/invoiceService.ts`. That service reconciles rounding and ensures totals align with jurisdiction rules.
9. **Result delivery** – the engine returns `{ charges, totalAmount, discounts, adjustments, finalAmount }`. Upstream actions persist the charges to invoices and generate transactions.

### Discount & Pricing Inputs

- `discounts` and `contract_line_discounts` define percentage or fixed discounts with effective windows.
- Pricing hierarchy: template defaults → contract-level overrides (`contract_lines.custom_rate`) → active pricing schedule (`contract_pricing_schedules`) → client-specific overrides (`client_contract_line_pricing.custom_rate`). The first non-null value in that chain wins.

### Data Quality & Validation

- Client overlap checks exist in both contract assignment (`ClientContract.assignContractToClient`) and contract updates (`updateClientContract`).
- `clientContractLineActions` enforce that contract lines referenced by existing invoices cannot be removed without safe handling.
- `BillingEngine.rolloverUnapprovedTime` aids operational workflows by moving DRAFT/SUBMITTED time into the next period when required.

## Manual Invoicing

Manual invoices share the same persistence and taxation pipeline as automated billing.

```typescript
import { generateManualInvoice, updateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';

await generateManualInvoice({
  clientId: 'client-id',
  items: [
    {
      service_id: 'service-id',
      quantity: 2,
      description: 'Ad hoc consulting',
      rate: 150 // dollars; the action converts to cents
    }
  ]
});

await updateManualInvoice(existingInvoiceId, {
  clientId: 'client-id',
  items: [...]
});
```

- Items are stored in `invoice_items`; detailed breakdown stays consistent with automated invoices.
- Tax uses the same `TaxService` + `invoiceService.calculateAndDistributeTax` flow.
- Ledger entries are recorded in `transactions` (`invoice_generated`, `invoice_adjustment`).
- UI entry points: `server/src/components/billing-dashboard/ManualInvoices.tsx` and `Invoices.tsx`.

## Credits & Transactions

Credits are issued for prepayments, negative invoices, and manual adjustments.

- `transactions` contains authoritative ledger events (`credit_issuance`, `credit_application`, `credit_expiration`, etc.).
- `credit_tracking` mirrors each credit’s remaining balance and expiration.
- `credit_reconciliation_reports` captures discrepancies detected by scheduled validation jobs (`creditReconciliationValidation` and friends).
- Application and expiration logic is implemented in `server/src/lib/actions/creditActions.ts` and background handlers in `server/src/lib/jobs/handlers/*Credits*.ts`.

## Invoice Template Selection

Invoice rendering uses WebAssembly-based templates (see [Invoice Template System](./invoice_templates.md)). Default selection data lives in `invoice_template_assignments`:

- `scope_type` is currently either `'tenant'` or `'company'` (the legacy label for client-specific defaults). The schema still uses `'company'` to avoid breaking existing data, even though the UI now surfaces the entity as “client”.
- Each record is exclusive: either `standard_invoice_template_code` (for standard templates) **or** `invoice_template_id` (for custom templates) is populated.
- The tenant-level default is discovered by querying scope `(tenant, 'tenant', NULL)`; client overrides use `(tenant, 'company', client_id)`.
- Legacy columns `invoice_templates.is_default` and `clients.invoice_template_id` are kept in sync for backward compatibility but should be treated as derived data.

## Key Interfaces

The TypeScript interfaces in `server/src/interfaces/billing.interfaces.ts` and `contract.interfaces.ts` describe the shapes returned by the engine:

```typescript
// server/src/interfaces/billing.interfaces.ts:18
export interface IBillingResult extends TenantEntity {
  charges: IBillingCharge[];
  totalAmount: number;
  discounts: IDiscount[];
  adjustments: IAdjustment[];
  finalAmount: number;
}

export interface IBillingCharge extends TenantEntity {
  type: 'fixed' | 'time' | 'usage' | 'bucket' | 'product' | 'license';
  serviceId?: string;
  serviceName: string;
  quantity?: number;
  rate: number;   // cents
  total: number;  // cents
  tax_amount: number;
  tax_rate: number;
  tax_region?: string;
  is_taxable?: boolean;
  client_contract_line_id?: string;
  client_contract_id?: string;
  contract_name?: string;
}

export interface IFixedPriceCharge extends IBillingCharge {
  type: 'fixed';
  quantity: number;
  config_id?: string;
  base_rate?: number;
  fmv?: number;
  proportion?: number;
  allocated_amount?: number;
  enable_proration?: boolean;
  billing_cycle_alignment?: string;
}

export interface IClientContractLine extends TenantEntity {
  client_contract_line_id: string;
  client_id: string;
  contract_line_id: string;
  template_contract_line_id?: string;
  service_category?: string;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  is_active: boolean;
  custom_rate?: number;
  client_contract_id?: string;
  template_contract_id?: string | null;
  contract_id?: string;
  contract_line_name?: string;
  billing_frequency?: string;
  contract_name?: string;
}
```

These interfaces are consumed throughout the billing dashboard (`ClientContractLineDashboard`, `BillingOverview`) and the billing engine.

## Database Quick Reference

| Area | Tables |
| --- | --- |
| Templates | `contract_templates`, `contract_template_lines`, `contract_template_line_services`, `contract_template_line_service_configuration`, `contract_template_line_service_fixed_config`, `contract_template_line_service_hourly_config`, `contract_template_line_service_usage_config`, `contract_template_line_service_bucket_config` |
| Contract library | `contracts`, `contract_lines`, `contract_pricing_schedules`, `contract_line_fixed_config`, `contract_line_service_configuration`, `contract_line_service_fixed_config`, `contract_line_service_hourly_config`, `contract_line_service_usage_config`, `contract_line_service_bucket_config`, `contract_line_service_rate_tiers`, `contract_line_discounts` |
| Client instances | `client_contracts`, `client_contract_lines`, `client_contract_line_pricing`, `client_contract_line_terms`, `client_contract_services`, `client_contract_service_configuration`, `client_contract_service_fixed_config`, `client_contract_service_hourly_config`, `client_contract_service_usage_config`, `client_contract_service_bucket_config`, `client_contract_service_rate_tiers`, `client_contract_line_discounts` |
| Activity | `time_entries`, `usage_tracking`, `bucket_usage`, `license_assignments`, `product_usage` |
| Invoicing | `client_billing_cycles`, `invoices`, `invoice_items`, `invoice_item_details`, `invoice_item_fixed_details`, `invoice_template_assignments` |
| Finance | `transactions`, `credit_tracking`, `credit_reconciliation_reports`, `client_credits` |
| Tax | `tax_rates`, `client_tax_settings`, `client_tax_rates` |

Key column highlights:

- `contract_template_line_terms` / `client_contract_line_terms` now include a `billing_timing` flag (`arrears` or `advance`) that drives line-level billing behaviour.
- `invoice_item_details` includes `service_period_start`, `service_period_end`, and `billing_timing` so invoices can represent advance and arrears charges on a single document.

## References

- `server/src/lib/billing/billingEngine.ts`
- `server/src/lib/actions/contractActions.ts`
- `server/src/lib/repositories/contractLineRepository.ts`
- `server/src/lib/actions/client-actions/clientContractActions.ts`
- `server/src/lib/actions/client-actions/clientContractLineActions.ts`
- `server/src/lib/billing/utils/templateClone.ts`
- `server/src/lib/services/invoiceService.ts`
- `server/src/lib/actions/manualInvoiceActions.ts`
- `docs/invoice_templates.md`

This document reflects the current contract-line architecture and should be updated alongside schema migrations affecting the billing domain.
