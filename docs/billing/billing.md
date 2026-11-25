# MSP Billing System Design

## System Purpose

The billing platform supports the full contract-centric workflow used by managed service providers. It replaces the older "billing plan" and "bundle" language with contract lines, client contracts, and contract templates. Clients can combine fixed recurring fees, hourly work, consumption-based services, license passthrough, and prepayment credits under a single contract umbrella. The billing engine produces detailed charge breakdowns, applies discounts, reconciles credits, and feeds those results into the invoicing subsystem.

Key goals:

- Represent reusable offer structures only through templates while keeping instantiated contract headers client-owned.
- Allow multiple simultaneous contract lines per client, each with its own pricing configuration.
- Capture time, usage, and product charges without losing the context required for auditing or taxation.
- Harmonize manual invoices and automated contract billing through the same taxation and transaction pipelines.

## Updated Domain Vocabulary

| Term | Description | Primary Tables |
| --- | --- | --- |
| **Contract template** | A reusable blueprint for a contract, including recommended lines, default billing frequencies, and metadata. Now carries a required `currency_code` (the template's base currency). | `contract_templates`, `contract_template_lines`, `contract_template_line_services`, `contract_template_line_service_configuration`, `contract_template_line_service_*`, `contract_template_price_sets`, `contract_template_prices` |
| **Contract** | A client-owned instantiated contract header. Non-template contracts belong to exactly one owning client and hold the line/configuration data used for billing. | `contracts`, `contract_lines`, `contract_pricing_schedules` |
| **Client contract** | The assignment/lifecycle record for a client-owned contract header, including start/end dates, PO requirements, renewal workflow state, and live status. | `client_contracts` |
| **Contract line** | A billable line definition (fixed, hourly, usage, bucket, product, license). The line row itself carries `custom_rate`, `enable_proration`, `billing_cycle_alignment`, `billing_timing`, `minimum_billable_time`, and `round_up_to_nearest`. | `contract_lines`, `contract_line_services`, `contract_line_service_configuration`, `contract_line_service_fixed_config`, `contract_line_service_hourly_configs`, `contract_line_service_hourly_config`, `contract_line_service_usage_config`, `contract_line_service_bucket_config`, `contract_line_service_rate_tiers` |
| **Billing cycle** | Defines the cadence for invoicing a client. | `client_billing_cycles`, retrieved through `BillingEngine.getBillingCycle` |

Supporting entities still in use:

- `time_entries`, `usage_tracking`, `bucket_usage`, `contract_line_discounts`, `discounts` hold the underlying activity feeding the engine.
- `invoices`, `invoice_charges`, `invoice_charge_details`, `invoice_charge_fixed_details` store rendered billing output.
- `transactions`, `credit_tracking` maintain the financial ledger and credit balances.

## Products (Catalog → Contracts → Invoices)

Products are implemented as a **subset of the existing service catalog**:

- Catalog rows live in `service_catalog` with `item_kind = 'product'`.
- Products are quantity-based sellable items (`billing_method = 'per_unit'` in V1).
- Multi-currency pricing is stored in `service_prices` (one row per currency). `service_catalog.default_rate` mirrors the "primary" price for convenience.
- Tax behavior is driven by `service_catalog.tax_rate_id` (nullable = non-taxable).
- Optional license metadata (term/cadence) is stored on the catalog row (`is_license`, `license_term`, `license_billing_cadence`) without start/end/proration in V1.

### Attaching products to contracts

- Contract templates and contract wizards allow attaching products as recommended/default items (with quantity).
- Products attach as `contract_line_services` rows on the owning contract line, alongside the line's other catalog services. There is no separate per-client copy.
- Rate selection follows the normal hierarchy (catalog price for the contract currency unless an override is explicitly entered on the contract line).

### Billing and invoice output

- During invoice generation, products are translated into `type = 'product'` charges in the billing engine and persisted as `invoice_charges` + detail rows.
- Products appear on invoices as distinct line items (and should be visually distinguished from time/usage/services in templates and client portal views).
- Currency correctness rules:
  - The contract currency controls which `service_prices.currency_code` is used.
  - If a product lacks a price in the contract currency, billing requires an explicit override (to avoid accidental $0 lines).

### Taxes and accounting mapping

- Tax calculation uses the same invoice persistence pipeline (`invoiceService.calculateAndDistributeTax`) and applies the product's `tax_rate_id` (or falls back to client defaults depending on tenant tax configuration).
- Accounting exports and mappings treat products as catalog items; they reuse the existing mapping resolution paths for `service` / `service_category` where applicable.

## Data Model Layers

### Template Layer (authoring reusable offers)

Templates give sales and operations teams a curated starting point.

- `contract_templates` – high level metadata (name, default frequency, status, optional JSON metadata). Now also carries a required `currency_code` (the template's base currency), seeded from the tenant default at creation.
- `contract_template_lines` – line-level defaults (type, descriptions, frequency, overtime rules) along with display order, billing timing, and optional template-level custom rates.
- `contract_template_line_terms` – stores timing/terms metadata for template lines, including the new `billing_timing` flag (`arrears` or `advance`) that seeds client assignments.
- `contract_template_line_services` – recommended catalog services and default quantities for a template line.
- `contract_template_line_service_configuration` and child tables (`_fixed`, `_hourly`, `_usage`, `_bucket`) – configuration defaults for each service type.
- `contract_template_price_sets` – optional per-currency rate collections on a template. Each set belongs to one template and one currency code.
- `contract_template_prices` – individual line-amount entries within a price set, one per template line, storing the rate in the set's currency.

Publishing or cloning a template never mutates the template tables; instead, the structure is copied onto the target contract's own lines via `cloneTemplateContractLine` (`shared/billingClients/templateClone.ts`).

### Client-Owned Contract Header Layer

Contracts live in tenant scope and are managed through `packages/billing/src/actions/contractActions.ts`, but non-template rows are no longer a reusable shared library concept.

- `contracts` – stores instantiated contract headers. Non-template rows must carry `owner_client_id`. Header `status` remains useful for draft/header workflow, but live client lifecycle now comes from `client_contracts`.
- `contract_lines` – stores contract-specific lines (including display order, billing timing, and optional custom rates) alongside shared metadata (`contract_line_name`, type, frequency, etc.).
- `contract_pricing_schedules` – time-bound overrides that swap in a custom rate when a schedule is effective during billing.

Contracts can be created manually for a client or cloned from templates into a client-owned draft. When cloning, template IDs are preserved in `contracts.template_metadata` for traceability, but templates remain the only reusable definition layer.

### Client Assignment Layer

A contract header reaches its client through `client_contracts`. That row is the assignment and lifecycle record; there is no per-client snapshot of the lines. Billing reads the contract's own `contract_lines` and service configuration directly.

- `client_contracts` – assignment/lifecycle record with start/end dates, PO requirements, renewal workflow state, and live status semantics. Managed by `clientContractActions` (`packages/clients/src/actions/clientContractActions.ts`).
  - Purchase order fields:
    - `po_required` (boolean) – blocks invoice generation when enabled and `po_number` is missing.
    - `po_number` (text) – the customer's PO reference used on invoices and accounting exports.
    - `po_amount` (bigint cents, nullable) – advisory "authorized spend" amount for warning on overages.

The line-level data the engine consumes hangs off the contract, not the assignment:

- `contract_lines` – the billable lines, carrying `custom_rate`, `enable_proration`, `billing_cycle_alignment`, `billing_timing`, the overtime settings (`enable_overtime`, `overtime_threshold`, `overtime_rate`), and the hourly `minimum_billable_time` / `round_up_to_nearest` that apply to every service on the line.
- `contract_line_services` – the catalog services and products attached to a line, with quantity and optional rate override.
- `contract_line_service_configuration` plus its typed children `contract_line_service_fixed_config`, `contract_line_service_hourly_configs` (rates), `contract_line_service_hourly_config` (metadata), `contract_line_service_usage_config`, `contract_line_service_bucket_config`, and `contract_line_service_rate_tiers` – the per-service pricing configuration read during invoice generation.
- `contract_line_discounts` – optional mapping of discounts to contract lines.

For a template-sourced contract, the template's services and configuration are cloned onto the contract's own lines: `applyContractToClient` (`packages/clients/src/actions/clientContractActions.ts`) calls `cloneTemplateContractLine` (`shared/billingClients/templateClone.ts`), which writes `contract_lines`, `contract_line_services`, `contract_line_service_configuration`, and the typed config children. The repository clone `cloneTemplateLineToContract` (`packages/billing/src/repositories/contractLineRepository.ts`) backs the wizard and `addContractLine` path. Because cloning copies values once, later template edits never retroactively change an existing contract.

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
- **Usage** – `usage_tracking`, plus the line's `contract_line_service_usage_config` and `contract_line_service_rate_tiers`.
- **Buckets** – `bucket_usage` tracks consumption for retainer-style offerings.
- **Catalog** – `service_catalog`, `service_prices`, `service_categories` feed descriptions, default rates, and tax attributes.
- **Tax** – `tax_rates`, `client_tax_settings`, `client_tax_rates` (default region lookup), with helpers in `clientTaxRateActions` (`packages/clients/src/actions/clientTaxRateActions.ts`).
- **Discounts & Adjustments** – `discounts` and `contract_line_discounts`. Ad-hoc adjustments have no schema-backed table yet; `fetchAdjustments` reads a legacy unscoped `adjustments` relation.

## Contract Lifecycle

1. **Author or import template** – users manage templates through `ContractTemplateModel` (`packages/billing/src/models/contractTemplate.ts`) and UI in `packages/billing/src/components/billing-dashboard/contracts/` (`TemplatesTab.tsx`, `ContractTemplateDetail.tsx`, `template-wizard/`).
2. **Create contract** – `createContract` in `packages/billing/src/actions/contractActions.ts` creates a client-owned contract header for one owning client. Templates can be cloned using wizard actions (`packages/billing/src/actions/contractWizardActions.ts`) to seed contract lines and metadata.
3. **Attach contract lines** – server actions in `packages/billing/src/actions/contractActions.ts` call the shared repository to clone template lines into `contract_lines` while exposing `addContractLine(contractId, contractLineId, customRate?)` to callers.
4. **Assign to client** – `assignContractToClient(clientId, contractId, startDate, endDate?)` from `packages/clients/src/actions/clientContractActions.ts` creates `client_contracts` rows. For non-template contracts, the assignment client must match `contracts.owner_client_id`. Concurrent active assignments (including overlapping dates) are allowed; mixed-currency active assignments for the same client remain blocked as a separate policy.
5. **Clone template data** – if the contract originated from a template, `cloneTemplateContractLine` copies the template line's services and configuration into the contract's `contract_line_services` and `contract_line_service_configuration` tables (plus the typed config children). Further overrides are applied through `clientContractLineActions` (`packages/clients/src/actions/clientContractLineActions.ts`).
6. **Maintain lifecycle** – `updateContract` (`packages/billing/src/actions/contractActions.ts`), `updateClientContract` (`packages/clients/src/actions/clientContractActions.ts`), and the pricing schedule actions keep data in sync as contracts renew, expire, or are repriced. Live status shown in UI/reporting derives from `client_contracts`, not `contracts.status`.

## Contracts API Semantics

- `/api/v1/contracts` and `/api/v2/contracts` represent client-owned instantiated contract headers.
- These endpoints exclude reusable templates; template authoring and listing lives under the dedicated template APIs/UI.
- Contract responses include `owner_client_id`, and list responses also expose the owner client name so consumers do not have to infer ownership from `client_contracts`.
- Live client lifecycle still belongs to `client_contracts`; `/contracts` should be treated as the header/line owner resource, not the live status fact table.

Example (simplified):

```typescript
import { createContract, addContractLine } from '@alga-psa/billing/actions/contractActions';
import { assignContractToClient } from '@alga-psa/clients/actions/clientContractActions';

const contract = await createContract({
  contract_name: 'Standard MSP Package',
  contract_description: 'Baseline services for managed clients',
  owner_client_id: 'client-id',
  billing_frequency: 'monthly',
  status: 'draft',
  is_active: false
});

await addContractLine(contract.contract_id, 'support-contract-line-id');
await addContractLine(contract.contract_id, 'security-contract-line-id', 12999); // cents override

await assignContractToClient('client-id', contract.contract_id, '2025-01-01', null);
```

## Billing Engine Flow

The billing engine lives in `packages/billing/src/lib/billing/billingEngine.ts`. It operates per client and billing cycle and returns an `IBillingResult` consumed by invoice generation.

1. **Initialize tenant context** – `createTenantKnex()` establishes the multi-tenant connection.
2. **Load billing cycle** – `client_billing_cycles` provides effective date ranges using **`[start, end)`** semantics (end is exclusive). If no explicit period exists, the engine derives it from the client's frequency.
3. **Guard rails** – `validateBillingPeriod` ensures the requested range does not span cycle changes. Existing invoices are detected via `hasExistingInvoiceForCycle`.
4. **Collect contract lines** – `getClientContractLinesAndCycle` joins `client_contracts` → `contracts` → `contract_lines` to build a normalized in-memory model. Only lines whose assignment, contract, and line row are all live take part. `client_contracts.template_contract_id` is provenance for draft and review flows; live billing always reads the lines under `client_contracts.contract_id`.
5. **Charge calculation** – for each contract line the engine executes:
   - `calculateFixedPriceCharges` – handles fixed-fee lines. A `contract_lines.custom_rate` (`rate_provenance` `custom`/`unreviewed`) or an active `contract_pricing_schedules` override short-circuits to a single consolidated charge. Otherwise the function gathers services from the line's configuration tables, derives FMV allocations, prorates when required, and calculates per-service tax using `TaxService`.
   - `calculateTimeBasedCharges` – pulls approved `time_entries` tied to the line. The overtime settings (`enable_overtime`, `overtime_threshold`, `overtime_rate`) and the `minimum_billable_time` / `round_up_to_nearest` rounding rules come from the `contract_lines` row, so they apply to every service on the line. Per-service rates come from `contract_line_service_configuration` joined to `contract_line_service_hourly_configs` and `contract_line_service_hourly_config`, with per-user-type overrides from `user_type_rates`.
   - `calculateUsageBasedCharges` – consumes `usage_tracking`, applies tiered pricing via `contract_line_service_rate_tiers`, and produces `IUsageBasedCharge` entries.
   - `calculateBucketPlanCharges` – reconciles `bucket_usage` rollovers and overages for retainer-style offerings.
   - `calculateProductCharges` and `calculateLicenseCharges` – forward-fill catalog-driven passthrough items such as licenses. These functions rely on `contract_line_services` to know which catalog items to include for the period.
6. **Proration** – fixed charges are prorated when the contract line starts or ends mid-cycle, driven by `contract_lines.enable_proration`. The line also carries `billing_cycle_alignment`, which the contract line repository reads for the fixed-config compatibility surface; the engine itself does not consult it.
7. **Discounts & adjustments** – `fetchDiscounts` delegates to `resolveInvoiceDiscounts` (`packages/billing/src/lib/billing/resolveInvoiceDiscounts.ts`), which joins `discounts` → `contract_line_discounts` → `contract_lines` → `client_contracts` to find the active discounts for the client and period. Adjustment support is scaffolded (`fetchAdjustments`) and is the next planned enhancement.
8. **Tax normalization** – the billing engine gathers preliminary tax data, but final calculation happens during invoice persistence via `calculateAndDistributeTax` in `packages/billing/src/services/invoiceService.ts`. That service reconciles rounding and ensures totals align with jurisdiction rules.
9. **Result delivery** – the engine returns `{ charges, totalAmount, discounts, adjustments, finalAmount }`. Upstream actions persist the charges to invoices and generate transactions.

### Discount & Pricing Inputs

- `discounts` and `contract_line_discounts` define percentage or fixed discounts with effective windows.
- Pricing hierarchy (fixed/recurring): active `contract_pricing_schedules` override (line-scoped rows before contract-wide, newest `effective_date` wins, and a latest row with a NULL rate blocks older rows) → `contract_lines.custom_rate` (only while `rate_provenance` is `custom` or `unreviewed`) → effective `service_prices` catalog rate in the contract's currency → legacy `service_catalog.default_rate`, and only for the tenant default currency when no `service_prices` row exists. The first non-null value in that chain wins. A line with `rate_provenance = 'inherited'` stores no rate and follows the catalog. The chain is implemented once in `packages/billing/src/lib/billing/pricing/resolveFixedLineRate.ts`. The rollout preview (`servicePriceRolloutActions`) and the rate-review pass (`rateReviewActions`, which also backs reset-to-standard) call that resolver, and `classifyLineRateProvenance` is built on it. The billing engine keeps an equivalent inline chain instead of calling the resolver; the deferred-revenue report and the EE simulator import only the shared row-selection helpers `selectActivePricingSchedule` / `selectEffectiveServicePrice` from the same module, and `contractMonthlyValue.ts` deliberately re-derives the chain without the resolver. The preview-vs-invoice parity test in the billing infrastructure floor guards the engine's inline chain against drifting from the resolver.

### Data Quality & Validation

- Client overlap checks exist in both contract assignment (`ClientContract.assignContractToClient`) and contract updates (`updateClientContract`).
- `clientContractLineActions` enforce that contract lines referenced by existing invoices cannot be removed without safe handling.
- Recurring invoice generation blocks matching unapproved billable time instead of moving time entries into a later billing period.

## Manual Invoicing

Manual invoices share the same persistence and taxation pipeline as automated billing.

```typescript
import { generateManualInvoice, updateManualInvoice } from '@alga-psa/billing/actions/manualInvoiceActions';

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

- Items are stored in `invoice_charges`; detailed breakdown stays consistent with automated invoices.
- Tax uses the same `TaxService` + `invoiceService.calculateAndDistributeTax` flow.
- Ledger entries are recorded in `transactions` (`invoice_generated`, `invoice_adjustment`).
- UI entry point: `packages/billing/src/components/billing-dashboard/ManualInvoices.tsx`. The surrounding invoicing UI lives in `packages/billing/src/components/billing-dashboard/invoices/` and `InvoicingHub.tsx`.

## Credits & Transactions

Credits are issued for prepayments, negative invoices, and manual adjustments.

- `transactions` contains authoritative ledger events (`credit_issuance`, `credit_application`, `credit_expiration`, etc.).
- `credit_tracking` mirrors each credit's remaining balance and expiration.
- Application and expiration logic is implemented in `packages/billing/src/actions/creditActions.ts`, with the scheduled work in the `@alga-psa/jobs` handlers `expiredCreditsHandler` and `expiringCreditsNotificationHandler`.

## Invoice Template Selection

Invoice rendering uses WebAssembly-based templates (see [Invoice Template System](./invoice_templates.md)). Default selection data lives in `invoice_template_assignments`:

- `scope_type` is currently either `'tenant'` or `'company'` (the legacy label for client-specific defaults). The schema still uses `'company'` to avoid breaking existing data, even though the UI now surfaces the entity as "client".
- Each record is exclusive: either `standard_invoice_template_code` (for standard templates) **or** `invoice_template_id` (for custom templates) is populated.
- The tenant-level default is discovered by querying scope `(tenant, 'tenant', NULL)`; client overrides use `(tenant, 'company', client_id)`.
- Legacy columns `invoice_templates.is_default` and `clients.invoice_template_id` are kept in sync for backward compatibility but should be treated as derived data.

## Key Interfaces

The TypeScript interfaces in `packages/types/src/interfaces/billing.interfaces.ts` and `packages/types/src/interfaces/contract.interfaces.ts` describe the shapes returned by the engine:

```typescript
// packages/types/src/interfaces/billing.interfaces.ts (abridged)
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
| Templates | `contract_templates`, `contract_template_lines`, `contract_template_line_services`, `contract_template_line_service_configuration`, `contract_template_line_service_fixed_config`, `contract_template_line_service_hourly_config`, `contract_template_line_service_usage_config`, `contract_template_line_service_bucket_config`, `contract_template_price_sets`, `contract_template_prices` |
| Contract library | `contracts`, `contract_lines`, `contract_pricing_schedules`, `contract_line_services`, `contract_line_service_configuration`, `contract_line_service_fixed_config`, `contract_line_service_hourly_configs`, `contract_line_service_hourly_config`, `contract_line_service_usage_config`, `contract_line_service_bucket_config`, `contract_line_service_rate_tiers`, `contract_line_discounts` |
| Client assignments | `client_contracts` |
| Activity | `time_entries`, `usage_tracking`, `bucket_usage` |
| Invoicing | `client_billing_cycles`, `invoices`, `invoice_charges`, `invoice_charge_details`, `invoice_charge_fixed_details`, `invoice_template_assignments` |
| Finance | `transactions`, `credit_tracking` |
| Tax | `tax_rates`, `client_tax_settings`, `client_tax_rates` |

Key column highlights:

- `contract_lines` and `contract_template_line_terms` include a `billing_timing` flag that drives line-level billing behaviour. Fixed lines accept `arrears` or `advance`; Hourly and Usage lines are restricted to `arrears` because the amount can only be calculated after the activity occurs. Submitting `advance` for a Hourly or Usage line through the REST API returns HTTP 400 with error code `CONTRACT_LINE_TIMING_NOT_ALLOWED`.
- `invoice_charge_details` includes `service_period_start`, `service_period_end`, and `billing_timing` so invoices can represent advance and arrears charges on a single document.
- `contract_line_service_fixed_config.base_rate_basis` (`per_unit` | `share`) records how `base_rate` is interpreted for member lines on a fixed-fee plan. `per_unit` means the rate is multiplied by the line's quantity; `share` means the rate is the member's pre-allocated slice of the bundle total as set by the contract wizard's weighted-split logic. Every write path (wizard, REST API, template clone) is expected to set this field. Submitting an unrecognised value through the REST `PUT /api/v1/contract-lines/{id}/services/{serviceId}` returns HTTP 400.

## References

- `packages/billing/src/lib/billing/billingEngine.ts`
- `packages/billing/src/actions/contractActions.ts`
- `packages/billing/src/actions/contractWizardActions.ts`
- `packages/billing/src/repositories/contractLineRepository.ts`
- `packages/clients/src/actions/clientContractActions.ts`
- `packages/clients/src/actions/clientContractLineActions.ts`
- `shared/billingClients/templateClone.ts`
- `packages/billing/src/lib/billing/utils/templateClone.ts`
- `packages/billing/src/lib/billing/resolveInvoiceDiscounts.ts`
- `packages/billing/src/services/invoiceService.ts`
- `packages/billing/src/actions/manualInvoiceActions.ts`
- `packages/types/src/interfaces/billing.interfaces.ts`
- `docs/invoice_templates.md`

This document reflects the current contract-line architecture and should be updated alongside schema migrations affecting the billing domain.
