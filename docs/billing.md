# MSP Billing System Design

## System Purpose

The flexible billing system is designed to support various billing models commonly used by Managed Service Providers (MSPs). It allows for complex billing scenarios, including fixed-price plans, time-based billing, usage-based billing, hybrid models, bucket of minutes/retainer models, discounts and promotions, multi-currency support, tax handling, service bundling, plan bundles, refunds and adjustments, and approval workflows. The system supports multiple simultaneous billing plans per client, enabling granular and flexible billing arrangements. Plan bundles provide a way to group related billing plans together for easier management and clearer client invoicing.

## Manual Invoicing

### Purpose
Manual Invoices allow MSPs to create ad-hoc invoices that do not rely on automated billing plans, time entries, or usage records. They are especially useful for:

- One-off charges (e.g., custom project fees, expenses, pass-through costs)
- Correcting or adjusting client charges before finalization
- Invoicing for services not represented in the main service catalog or billing plans

### Key Characteristics

#### is_manual Flag
- Stored in the `invoices` table.
- `true` indicates a manually created invoice.

#### Draft Status
- By default, new manual invoices have a status of `draft`.
- They can be reviewed and edited before being finalized.

#### Line Items
- Each line item is stored in `invoice_items`.
- The user can specify:
  - A Service (from the catalog) or a placeholder ID
  - A Quantity
  - A Description
  - A Rate (dollars/currency per unit)
- Tax is computed via the `TaxService` at line-item level.

#### Transactions
- Upon creation or update, a corresponding record is inserted into the `transactions` table with type values like:
  - `invoice_generated` (new manual invoice)
  - `invoice_adjustment` (manual invoice updates)
- This ensures a proper audit trail in the financial ledger.

#### Tax Calculation
- Manual invoices leverage the same `TaxService` logic used for automated invoices.
- The system determines the tax region from either:
  - The service's tax region (if defined via `tax_rate_id` on the service)
  - The company's default tax region (fallback)
- Tax rates are fetched from `tax_rates` based on the region and date, producing a `taxAmount` and `taxRate`.

### Usage
- Ad-hoc or single-service charges
- Quick corrections if no time entries or usage were tracked
- Custom items not otherwise part of the standard billing engine

### Implementation Details

#### Creation
```typescript
import { generateManualInvoice } from 'lib/actions/manualInvoiceActions';

await generateManualInvoice({
  companyId: '...',  // The client's company ID
  items: [
    {
      service_id: '...',
      quantity: 2,
      description: 'Ad-hoc consulting',
      rate: 150 // Rate is expected in base currency units (e.g., dollars)
    }
  ]
});
```
- Creates an `invoices` record with `status = 'draft'` and `is_manual = true`.
- Inserts corresponding `invoice_items` with calculated tax (stored in cents).
- Inserts a `transactions` record of type `invoice_generated`.

#### Editing/Updates
```typescript
import { updateManualInvoice } from 'lib/actions/manualInvoiceActions';

await updateManualInvoice(invoiceId, {
  companyId: '...',
  items: [
    // new or updated items
  ]
});
```
- Deletes existing items for the invoice, then recreates them based on the provided data.
- Recomputes tax amounts.
- Updates totals on the `invoices` record.
- Inserts a `transactions` record of type `invoice_adjustment`.

#### UI Components
- `ManualInvoices.tsx`: A form-based UI that lets users pick a company, add line items, compute a quick total, and create/update the invoice.
- `Invoices.tsx`: Lists all invoices (manual or automated). For manual invoices, an "Edit" button is available if the invoice is still in a modifiable state.

#### Database Fields (relevant to manual invoicing):
- `invoices.is_manual` (boolean)
- `invoices.status` (e.g. draft, open, paid)
- `invoice_items.tax_amount` and `invoice_items.tax_rate`
- `transactions.type` (e.g. invoice_generated, invoice_adjustment)

### Best Practices
- Keep Manual Invoices in "Draft" until reviewed, to avoid confusion or partial data entry.
- Assign Meaningful Descriptions to line items for future reference or audits.
- Leverage the Service Catalog to pre-fill default rates and descriptions, ensuring consistency.
- Use Transactions as the single source of truth for any financial adjustments made via manual invoices.

## Plan Bundles

### Purpose
Plan Bundles allow MSPs to create named collections of billing plans that can be managed as a single entity. They provide a higher-level abstraction over the existing billing plans system, making it easier to manage complex billing arrangements while maintaining flexibility. Plan Bundles are especially useful for:

- Grouping related services that are commonly sold together
- Simplifying the assignment of multiple plans to clients
- Creating standardized service packages with consistent pricing
- Providing clearer organization on client invoices
- Managing multiple billing plans as a cohesive unit

### Key Characteristics

#### Bundle Structure
- Each bundle has a unique ID, name, and optional description
- Bundles contain one or more billing plans
- Plans within a bundle maintain their individual configuration
- Plans can have custom rates (in cents) when included in a bundle (`bundle_billing_plans.custom_rate`)
- Bundles can be assigned to companies with specific start and end dates

#### Bundle Assignment
- When a bundle is assigned to a company, all plans within the bundle are automatically assigned
- Bundle assignments create individual `company_billing_plans` entries for each plan in the bundle, linked via `company_bundle_id`.
- All plans in a bundle share the same start and end dates when assigned via `company_plan_bundles`.
- Plans from bundles are clearly identified on invoices with bundle information.

#### Billing Integration
- The billing engine recognizes plans that are part of bundles (`company_billing_plans.company_bundle_id`).
- If a `custom_rate` is defined in `bundle_billing_plans`, the billing engine uses this rate (assumed to be in cents) for the entire plan, bypassing individual service calculations for that plan within the bundle context.
- Invoice items from bundled plans are grouped together on invoices.
- Bundle information is included in billing calculations and reports.

### Usage
- Creating standardized service packages
- Simplifying client onboarding with predefined plan collections
- Organizing related services for clearer client billing
- Managing multiple billing plans as a single unit

### Implementation Details

#### Creating and Managing Bundles
```typescript
import { createPlanBundle, addPlanToBundle } from 'lib/actions/planBundleActions';

// Create a new bundle
const bundle = await createPlanBundle({
  bundle_name: 'Standard MSP Package',
  bundle_description: 'Basic monitoring and support services',
  is_active: true
});

// Add plans to the bundle
await addPlanToBundle({
  bundle_id: bundle.bundle_id,
  plan_id: 'monitoring-plan-id',
  display_order: 1
});

await addPlanToBundle({
  bundle_id: bundle.bundle_id,
  plan_id: 'support-plan-id',
  display_order: 2,
  custom_rate: 12500 // Optional custom rate (in cents) for this plan in this bundle
});
```

#### Assigning Bundles to Companies
```typescript
import { assignBundleToCompany } from 'lib/actions/companyPlanBundleActions';

await assignBundleToCompany({
  company_id: 'client-company-id',
  bundle_id: 'standard-msp-package-id',
  start_date: '2025-01-01T00:00:00Z',
  end_date: '2025-12-31T23:59:59Z', // Optional
  is_active: true
});
```

#### UI Components
- `PlanBundles.tsx`: Main component for managing plan bundles
- `PlanBundlesList.tsx`: Lists all available plan bundles
- `PlanBundleDetail.tsx`: Shows details of a specific bundle and its plans
- `PlanBundleForm.tsx`: Form for creating and editing bundles
- `CompanyBundleAssignment.tsx`: Component for assigning bundles to companies

#### Database Fields (relevant to plan bundles):
- `plan_bundles.bundle_id` (UUID)
- `plan_bundles.bundle_name` (string)
- `plan_bundles.bundle_description` (text)
- `bundle_billing_plans.bundle_id` (UUID)
- `bundle_billing_plans.plan_id` (UUID)
- `bundle_billing_plans.display_order` (integer)
- `bundle_billing_plans.custom_rate` (integer, cents)
- `company_plan_bundles.company_bundle_id` (UUID)
- `company_plan_bundles.company_id` (UUID)
- `company_plan_bundles.bundle_id` (UUID)
- `company_plan_bundles.start_date` (timestamp)
- `company_plan_bundles.end_date` (timestamp)
- `company_billing_plans.company_bundle_id` (UUID, FK to `company_plan_bundles`)

### Best Practices
- **Create Logical Groupings**: Bundle plans that naturally belong together or are commonly sold as a package
- **Use Descriptive Names**: Give bundles clear, descriptive names that indicate their purpose or target client type
- **Maintain Consistent Pricing**: When using custom rates in bundles, ensure they align with your overall pricing strategy
- **Consider Bundle Lifecycle**: Plan for how bundles will be updated or retired over time
- **Document Bundle Contents**: Keep clear documentation of what each bundle includes for sales and support teams

## Fixed Fee Plan Billing

### Purpose
Fixed Fee Plans allow MSPs to offer clients a predictable, flat-rate billing option that covers multiple services for a single price. This model simplifies client billing while providing flexibility in how services are allocated and taxed internally.

### Key Characteristics

#### Fixed Fee Structure
- A single base rate covers multiple services included in the plan.
- The plan's base rate is stored in the `billing_plan_fixed_config` table, linked to the `billing_plans` record.
- Proration settings (`enable_proration`, `billing_cycle_alignment`) are also defined in `billing_plan_fixed_config`.
- The billing engine generates *detailed* invoice items for each service within the fixed plan, rather than a single consolidated line item.

#### Tax Allocation and Charge Calculation
- The system uses a weighted allocation method based on the Fair Market Value (FMV) of each service within the plan.
- FMV for each service is calculated using its `default_rate` from `service_catalog` and its configured `quantity` from `plan_service_configuration`.
- Each service's proportion of the total FMV determines its share of the total plan `base_rate` (from `billing_plan_fixed_config`).
- This allocated portion (potentially prorated based on `billing_plan_fixed_config.enable_proration`) becomes the `allocated_amount` for the service.
- Tax is calculated separately for each service based on its:
  - `allocated_amount` (the actual charge for that service line)
  - Tax status (derived from `service_catalog.tax_rate_id`)
  - Applicable tax region (from `service_catalog.tax_rate_id` or company default) and rate (`TaxService`).
- This approach ensures accurate tax calculation per service while reflecting the fixed-price nature of the plan.

#### Detailed Invoice Items
- The system creates individual `invoice_items` and corresponding `invoice_item_details` / `invoice_item_fixed_details` records for each service within the fixed plan.
- This provides a clear breakdown for internal reporting and auditing.
- Key fields stored in `invoice_item_fixed_details` include:
    - `base_rate`: The *plan-level* base rate (from `billing_plan_fixed_config`) used for the calculation (stored in cents).
    - `fmv`: The calculated FMV for this service (in cents).
    - `proportion`: The calculated FMV proportion for this service.
    - `allocated_amount`: The final calculated charge for this service line (in cents), after allocation and proration.
- This detailed structure addresses the challenge of associating invoice items back to specific services and their configuration at the time of invoicing.

### Implementation Details

#### Fixed Fee Allocation and Charge Generation (`BillingEngine::calculateFixedPriceCharges`)
The system uses the following algorithm:

1.  **Fetch Plan Config:** Retrieve `base_rate`, `enable_proration`, and `billing_cycle_alignment` from `billing_plan_fixed_config` for the given `plan_id`.
2.  **Fetch Plan Services:** Get all services associated with the plan from `plan_service_configuration`, joining with `service_catalog` to get `service_name` and `default_rate`.
3.  **Calculate Total FMV:** Sum the FMV ( `service.default_rate` * `service.quantity`) for all services in the plan. Rates are assumed to be in cents.
4.  **Iterate Through Services:** For each service:
    a.  **Calculate Proportion:** Determine the service's FMV proportion (`serviceFMVCents / totalFMVCents`).
    b.  **Calculate Proration Factor:** If `enable_proration` is true, calculate the proration factor based on plan/billing period dates.
    c.  **Calculate Effective Plan Rate:** Apply the proration factor to the plan-level `base_rate` (converted to cents).
    d.  **Calculate Allocated Amount:** Multiply the effective plan rate by the service's proportion. This is the charge amount for this service line (in cents).
    e.  **Determine Taxability:** Check `service_catalog.tax_rate_id` and company tax exemption status.
    f.  **Calculate Tax:** If taxable, use `TaxService` to calculate `taxAmount` and `taxRate` based on the `allocatedAmount` and the effective tax region.
    g.  **Create Detailed Charge Object (`IFixedPriceCharge`):** Populate the object with:
        - `serviceId`, `serviceName`, `quantity`
        - `rate`: `allocatedAmount`
        - `total`: `allocatedAmount`
        - `tax_amount`, `tax_rate`, `tax_region`, `is_taxable`
        - `config_id` (from `plan_service_configuration`)
        - `base_rate`: The *plan-level* base rate (converted to cents) for context.
        - `enable_proration`, `billing_cycle_alignment` (from plan config)
        - `fmv`, `proportion`, `allocated_amount` (calculated values)
5.  **Return Detailed Charges:** Return the array of `IFixedPriceCharge` objects, one for each service in the plan.

#### Database Structure (V1 Enhancements)
- `billing_plan_fixed_config`: Stores plan-level `base_rate`, `enable_proration`, `billing_cycle_alignment`.
- `plan_service_fixed_config`: Currently exists but its `base_rate` is not used for fixed plan calculations.
- `invoice_items`: Stores the main line item data (references `service_id`, `description`, `quantity`, `net_amount`, `tax_amount`, `total_price`).
- `invoice_item_details` (Parent Table):
  - `item_detail_id` (UUID, PK)
  - `item_id` (UUID, FK to `invoice_items`)
  - `service_id` (UUID, FK to `service_catalog`)
  - `config_id` (UUID, FK to `plan_service_configuration`) - Snapshot of config used.
  - `quantity` (INTEGER)
  - `rate` (INTEGER, cents) - Represents the calculated `allocated_amount` for this item.
  - `created_at`, `updated_at`, `tenant`
- `invoice_item_fixed_details` (Specific Details):
  - `item_detail_id` (UUID, PK, FK to `invoice_item_details`)
  - `base_rate` (INTEGER, cents) - The *plan's* base rate at the time.
  - `enable_proration` (BOOLEAN) - Proration setting at the time.
  - `fmv` (INTEGER, cents) - Calculated FMV for allocation.
  - `proportion` (NUMERIC) - Calculated proportion for allocation.
  - `allocated_amount` (INTEGER, cents) - Calculated allocated amount (matches `invoice_item_details.rate`).

#### UI Components
- `FixedPlanConfiguration.tsx`: Allows setting the plan-level base rate and proration options in `billing_plan_fixed_config`.
- `FixedPlanServicesList.tsx`: Manages services included in the fixed fee plan via `plan_service_configuration`.

### Benefits
- **Simplified Client Billing**: Clients see a predictable charge (though potentially broken down by service on the invoice depending on the template).
- **Tax Compliance**: Accurate tax calculation based on service-specific tax rules and allocated amounts.
- **Flexible Service Mix**: Services can be added or removed without changing the core billing logic.
- **Transparent Allocation**: Detailed allocation data stored for audit and reporting (`invoice_item_fixed_details`).
- **Consistent Pricing**: Fixed fee remains stable regardless of minor usage fluctuations (unless prorated).

### Best Practices
- **Set Appropriate Plan Base Rate**: Ensure the fixed fee in `billing_plan_fixed_config` covers the expected service costs plus margin.
- **Review Service Default Rates**: Keep `default_rate` in the `service_catalog` updated to ensure accurate FMV calculation for allocation.
- **Document Tax Allocation**: Maintain records of how fixed fees are allocated for tax purposes (now stored in detail tables).
- **Consider Service Mix**: Include complementary services that make sense as a package.
- **Review Regularly**: Periodically assess if the fixed fee still aligns with the value of the services provided.

## Tax Calculation and Allocation

The billing system implements a comprehensive tax calculation and allocation strategy that follows common practices in tax jurisdictions. This is handled through a combination of the `TaxService` class and specific allocation logic in the invoice generation process.

### TaxService Overview

The `TaxService` class (`server/src/lib/services/taxService.ts`) provides the core tax calculation functionality:

- Determines the effective tax region for a charge based on:
    1.  The `tax_rate_id` associated with the `service_catalog` entry.
    2.  If no service `tax_rate_id`, falls back to the company's default tax region (`company_tax_rates` where `is_default=true`).
- Queries `tax_rates` based on the effective region and date to find the current applicable rate percentage.
- Calculates the `taxAmount` (in cents) based on the provided net amount (also in cents).
- Returns both the calculated `taxRate` (decimal, e.g., 0.065) and `taxAmount` (integer cents).
- Handles company-level tax exemptions (`companies.is_tax_exempt`).
- Is invoked during automated invoice generation (`BillingEngine`) and manual invoice creation/updates.

Example Usage:
```typescript
const taxService = new TaxService();
const taxCalculationResult = await taxService.calculateTax(
  companyId,
  netAmountInCents,     // e.g., 15000 for $150.00
  invoiceDate,          // Date to determine applicable rate
  effectiveTaxRegion    // Region code determined by service or company default
);
```

Returned Object:
```typescript
{
  taxAmount: number;  // e.g., 975 for 6.5% of 15000
  taxRate: number;    // e.g., 0.065
}
```

### Tax Calculation Strategy

The system follows these key principles for tax calculation:

1.  **Line Item Basis**: Tax is calculated individually for each taxable line item based on its net amount.
2.  **Pre-Discount Basis**: Tax is calculated on the full pre-discount charge amounts. Discounts themselves are not taxed.
3.  **Tax Rate Determination**: Rates are fetched from `tax_rates` based on the effective region and date.
4.  **Tax Allocation (Fixed Plans)**: For fixed-price plans, the total plan fee is allocated to individual services based on FMV *before* tax is calculated on each allocated amount.
5.  **Tax Distribution (Invoice Level)**: The `calculateAndDistributeTax` function in `invoiceService` ensures the sum of `tax_amount` on individual `invoice_items` accurately reflects the total calculated tax for the invoice, handling potential rounding differences across multiple items and regions.

### Tax Distribution Algorithm (`calculateAndDistributeTax`)

This service function refines the tax amounts on invoice items *after* initial calculation by the `BillingEngine` or manual entry:

1.  **Fetch Items**: Get all `invoice_items` for the given `invoiceId`.
2.  **Recalculate Tax per Item**: For each item, determine its taxability and effective region (service `tax_rate_id` or company default). If taxable, call `TaxService.calculateTax` using the item's `net_amount`.
3.  **Aggregate Total Tax**: Sum the calculated `taxAmount` from all items.
4.  **Distribute Total Tax**: Proportionally distribute the aggregated `totalTax` across the positive, taxable `invoice_items`, handling rounding to ensure the sum of item `tax_amount` exactly equals `totalTax`. This uses a standard largest remainder method or similar approach.
5.  **Update Items**: Update the `tax_amount`, `tax_rate`, and `total_price` (net + tax) for each `invoice_item` in the database transaction.

This ensures:
- Accurate tax calculation per item based on its specific service and region.
- Correct handling of tax exemptions.
- Precise distribution of the total invoice tax across line items, preventing rounding errors.

## Transactions for Manual Invoices

The `transactions` table logs all financial events. For manual invoices:

- `type`:
  - `invoice_generated`: Inserted when a new manual invoice is created.
  - `invoice_adjustment`: Inserted when line items on an existing manual invoice are updated.
- `balance_after`: Reflects the invoice total for reference.
- `description`: e.g., "Generated manual invoice #1234".

This logging ensures a consistent ledger of all billing events.

## Invoice Preview System

### Purpose
Allows users to view and verify invoice calculations before finalization, preventing errors.

### Design
Leverages `BillingEngine` in a "preview mode":
1. Calculates charges, taxes, adjustments.
2. Does *not* mark items as invoiced.
3. Does *not* create database records (invoices, transactions etc.).
4. Returns the complete calculated invoice structure for display.

### Components

#### Preview Action
```typescript
// Preview calculation without persistence
async function previewInvoice(
  companyId: string,
  billingCycleId: string
): Promise<InvoiceViewModel> { // Or similar view model
  // Uses BillingEngine.calculateBilling() but skips persistence steps
  // Returns calculated structure for display
}
```

#### UI Integration
- Preview button triggers the preview action.
- Displays results in a modal/dialog using existing invoice display components.
- Clearly indicates "PREVIEW" status.

#### Data Flow
1. User requests preview.
2. System calculates charges via `BillingEngine` (preview mode).
3. Preview displayed.
4. User can finalize or adjust based on preview.

### Implementation Notes
- Reuse `BillingEngine.calculateBilling()` logic.
- Add internal flag/mode to skip persistence.
- Ensure calculation consistency between preview and finalization.

### Security Considerations
- Respect user permissions for viewing billing data.
- No persistent changes during preview.

## Service Types

The billing system uses service configurations to determine billing logic. Key types include:

### Fixed Price Services
- Associated with a plan having `plan_type = 'Fixed'`.
- Plan has a `base_rate` in `billing_plan_fixed_config`.
- Billed based on FMV allocation of the plan's base rate.
- Proration controlled by `billing_plan_fixed_config.enable_proration`.
- Calculated by `BillingEngine::calculateFixedPriceCharges()`.

### Time-Based Services
- Configured via `plan_service_configuration` with `configuration_type = 'Hourly'`.
- Detailed settings (min time, rounding) in `plan_service_hourly_config`.
- Billed based on approved `time_entries`.
- Rate determined by user type rates (`user_type_rates`), service config custom rate, or service default rate.
- Calculated by `BillingEngine::calculateTimeBasedCharges()`.

### Usage-Based Services
- Configured via `plan_service_configuration` with `configuration_type = 'Usage'`.
- Detailed settings (min usage, tiered pricing flag) in `plan_service_usage_config`.
- Tiered rates defined in `plan_service_rate_tiers`.
- Billed based on `usage_tracking` records.
- Rate determined by tiers (if enabled), service config custom rate, or service default rate.
- Calculated by `BillingEngine::calculateUsageBasedCharges()`.

### Bucket Services
- Configured via `plan_service_configuration` with `configuration_type = 'Bucket'`.
- Detailed settings (total hours, overage rate, rollover) in `plan_service_bucket_config`.
- Usage tracked automatically in `bucket_usage` based on `time_entries`.
- Overage calculated based on `hours_used` vs `total_hours`.
- Calculated by `BillingEngine::calculateBucketPlanCharges()`.

### Product Services
- Billed as a one-time charge.
- Typically for tangible goods, not prorated.
- Calculated by `BillingEngine::calculateProductCharges()`.
- *Note: Current implementation needs review to correctly identify/filter product services.*

### License Services
- Time-limited services with specific validity periods.
- Used for software licenses, subscriptions with defined durations.
- Calculated by `BillingEngine::calculateLicenseCharges()`.
- *Note: Current implementation needs review to correctly identify/filter license services.*

## Database Schema

### Plan Bundle Tables

1.  **`plan_bundles`**
    - **Purpose:** Stores information about plan bundles
    - **Key Fields:** `tenant` (UUID, PK), `bundle_id` (UUID, PK), `bundle_name`, `bundle_description`, `is_active`

2.  **`bundle_billing_plans`**
    - **Purpose:** Maps billing plans to bundles
    - **Key Fields:** `tenant` (UUID, PK), `bundle_id` (UUID, PK), `plan_id` (UUID, PK), `display_order`, `custom_rate` (integer, cents)

3.  **`company_plan_bundles`**
    - **Purpose:** Associates companies with plan bundles
    - **Key Fields:** `tenant` (UUID, PK), `company_bundle_id` (UUID, PK), `company_id`, `bundle_id`, `start_date`, `end_date`, `is_active`


### Core Tables

1.  **`tenants`**
    - **Purpose:** Stores information about each MSP (multi-tenant architecture)
    - **Key Fields:** `tenant` (UUID, PK), `company_name`, `email`, `plan`

2.  **`companies`**
    - **Purpose:** Represents clients of the MSP
    - **Key Fields:** `tenant` (UUID, PK), `company_id` (UUID, PK), `company_name`, `billing_type`, `is_tax_exempt` (boolean)

3.  **`users`**
    - **Purpose:** Stores information about MSP staff and client contacts
    - **Key Fields:** `tenant` (UUID, PK), `user_id` (UUID, PK), `email`, `role`, `rate`

### Billing-Specific Tables

4.  **`service_catalog`**
    - **Purpose:** Defines available services that can be billed
    - **Key Fields:** `tenant`, `service_id` (UUID, PK), `service_name`, `default_rate` (integer, cents), `unit_of_measure`, `category_id` (FK to `service_categories`), `tax_rate_id` (FK to `tax_rates`)

5.  **`service_categories`**
    - **Purpose:** Categorizes services for more organized billing
    - **Key Fields:** `tenant`, `category_id` (UUID, PK), `category_name`, `description`

6.  **`billing_plans`**
    - **Purpose:** Defines billing plans that can be assigned to clients
    - **Key Fields:** `tenant`, `plan_id` (UUID, PK), `plan_name`, `billing_frequency`, `is_custom`, `plan_type` ('Fixed', 'Hourly', 'Usage', 'Bucket')

7.  **`billing_plan_fixed_config`** *(New/Refined)*
    - **Purpose:** Stores plan-level configuration specific to Fixed Fee plans.
    - **Key Fields:** `tenant` (UUID, PK), `plan_id` (UUID, PK, FK to `billing_plans`), `base_rate` (numeric(16,2)), `enable_proration` (boolean), `billing_cycle_alignment` ('start' | 'end' | 'prorated')

8.  **`company_billing_plans`**
    - **Purpose:** Associates clients with multiple billing plans and tracks plan history
    - **Key Fields:** `tenant`, `company_billing_plan_id` (UUID, PK), `company_id`, `plan_id`, `start_date`, `end_date`, `is_active`, `company_bundle_id` (FK to `company_plan_bundles`)

9.  **`time_entries`**
    - **Purpose:** Tracks billable time for time-based billing
    - **Key Fields:** `tenant`, `entry_id` (UUID, PK), `user_id`, `work_item_id`, `work_item_type`, `service_id`, `start_time`, `end_time`, `duration`, `billable`, `invoiced` (boolean), `approval_status`, `billing_plan_id` (FK)

10. **`usage_tracking`**
    - **Purpose:** Tracks usage for consumption-based billing
    - **Key Fields:** `tenant`, `usage_id` (UUID, PK), `company_id`, `service_id`, `usage_date`, `quantity`, `invoiced` (boolean), `billing_plan_id` (FK)

11. **`invoices`**
    - **Purpose:** Stores invoice header information
    - **Key Fields:** `tenant`, `invoice_id` (UUID, PK), `company_id`, `invoice_date`, `due_date`, `total_amount` (cents), `subtotal` (cents), `tax_total` (cents), `status`, `currency_code`, `billing_period_start`, `billing_period_end`, `credit_applied` (cents), `finalized_at`, `is_manual` (boolean), `billing_cycle_id` (FK)

12. **`invoice_items`**
    - **Purpose:** Stores line items for each invoice
    - **Key Fields:** `tenant`, `invoice_id`, `item_id` (UUID, PK), `service_id` (FK), `description`, `quantity`, `unit_price` (cents), `total_price` (cents), `currency_code`, `tax_rate_id` (FK), `tax_region`, `tax_amount` (cents), `net_amount` (cents), `is_taxable` (boolean), `is_discount` (boolean)

13. **`invoice_item_details`** *(V1 Enhancement)*
    - **Purpose:** Parent table storing common details for each generated invoice item, linking back to the source configuration.
    - **Key Fields:** `item_detail_id` (UUID, PK), `item_id` (UUID, FK to `invoice_items`), `service_id` (UUID, FK to `service_catalog`), `config_id` (UUID, FK to `plan_service_configuration`), `quantity` (INTEGER), `rate` (INTEGER, cents), `created_at`, `updated_at`, `tenant`

14. **`invoice_item_fixed_details`** *(V1 Enhancement)*
    - **Purpose:** Stores specific calculation details for fixed-fee invoice items.
    - **Key Fields:** `item_detail_id` (UUID, PK, FK to `invoice_item_details`), `base_rate` (INTEGER, cents - Plan's rate), `enable_proration` (BOOLEAN), `fmv` (INTEGER, cents), `proportion` (NUMERIC), `allocated_amount` (INTEGER, cents)

15. **`plan_service_configuration`**
    - **Purpose:** Links a specific service within a plan to its configuration settings. Acts as the parent for specific config types.
    - **Key Fields:** `tenant` (UUID, PK), `config_id` (UUID, PK), `plan_id` (FK to `billing_plans`), `service_id` (FK to `service_catalog`), `configuration_type` ('Usage', 'Fixed', 'Hourly', 'Bucket'), `quantity` (integer, default 1), `custom_rate` (integer, cents, nullable)

16. **`plan_service_fixed_config`**
    - **Purpose:** Stores configuration specific to Fixed services within a plan (currently minimal use for fixed plans).
    - **Key Fields:** `tenant` (UUID, PK), `config_id` (UUID, PK, FK to `plan_service_configuration`), `base_rate` (numeric(16,2), nullable - *Note: Plan-level rate from `billing_plan_fixed_config` is used for actual fixed plan calculations*)

17. **`plan_service_hourly_config`**
    - **Purpose:** Stores configuration specific to Hourly services within a plan.
    - **Key Fields:** `tenant` (UUID, PK), `config_id` (UUID, PK, FK to `plan_service_configuration`), `minimum_billable_time` (integer, minutes), `round_up_to_nearest` (integer, minutes)

18. **`user_type_rates`**
    - **Purpose:** Defines specific hourly rates based on user type for a given hourly service config.
    - **Key Fields:** `tenant` (UUID, PK), `rate_id` (UUID, PK), `config_id` (UUID, FK to `plan_service_configuration`), `user_type` (string), `rate` (integer, cents)

19. **`plan_service_usage_config`**
    - **Purpose:** Stores detailed configuration for usage-based services within a plan.
    - **Key Fields:** `tenant` (UUID, PK), `config_id` (UUID, PK, FK to `plan_service_configuration`), `unit_of_measure`, `minimum_usage` (integer), `enable_tiered_pricing` (boolean)

20. **`plan_service_rate_tiers`**
    - **Purpose:** Defines the pricing tiers for usage-based services when tiered pricing is enabled.
    - **Key Fields:** `tenant` (UUID, PK), `tier_id` (UUID, PK), `config_id` (FK to `plan_service_configuration`), `min_quantity` (integer), `max_quantity` (integer, nullable), `rate` (integer, cents)

21. **`plan_service_bucket_config`**
    - **Purpose:** Stores configuration specific to Bucket services within a plan.
    - **Key Fields:** `tenant` (UUID, PK), `config_id` (UUID, PK, FK to `plan_service_configuration`), `total_hours` (integer), `overage_rate` (integer, cents), `allow_rollover` (boolean)

22. **`bucket_usage`**
    - **Purpose:** Tracks usage against bucket plans for specific billing periods.
    - **Key Fields:** `tenant`, `usage_id` (UUID, PK), `config_id` (FK to `plan_service_configuration`), `company_id` (FK), `period_start`, `period_end`, `hours_used` (decimal), `overage_hours` (decimal), `rolled_over_hours` (decimal)

23. **`discounts`**
    - **Purpose:** Defines discounts and promotions
    - **Key Fields:** `tenant`, `discount_id` (UUID, PK), `discount_name`, `discount_type` ('percentage' | 'fixed'), `value` (numeric), `start_date`, `end_date`, `is_active`

24. **`plan_discounts`**
    - **Purpose:** Associates discounts with billing plans or clients
    - **Key Fields:** `tenant`, `plan_id` (FK), `company_id` (FK), `discount_id` (FK)

25. **`tax_rates`**
    - **Purpose:** Stores tax rates based on regions or services
    - **Key Fields:** `tenant`, `tax_rate_id` (UUID, PK), `region_code` (string, FK to hypothetical regions table), `tax_percentage` (numeric), `description`, `start_date`, `end_date`

26. **`company_tax_rates`**
    - **Purpose:** Links companies to specific tax rates, allowing overrides and default settings.
    - **Key Fields:** `tenant`, `company_tax_rate_id` (UUID, PK), `company_id` (FK), `tax_rate_id` (FK), `is_default` (boolean), `location_id` (nullable FK)

27. **`currencies`**
    - **Purpose:** Stores currency codes and exchange rates
    - **Key Fields:** `currency_code` (PK), `currency_name`, `exchange_rate_to_base`, `is_active`

28. **`transactions`**
    - **Purpose:** Logs all financial transactions (charges, payments, refunds, credits)
    - **Key Fields:** `tenant`, `transaction_id` (UUID, PK), `company_id`, `invoice_id` (nullable FK), `transaction_type`, `amount` (cents), `currency_code`, `transaction_date`, `description`, `status`, `balance_after` (cents)

29. **`credit_tracking`**
    - **Purpose:** Tracks individual credit amounts issued to companies.
    - **Key Fields:** `credit_id` (UUID, PK), `tenant`, `company_id`, `transaction_id` (FK to issuance transaction), `amount` (cents), `remaining_amount` (cents), `created_at`, `expiration_date`, `is_expired`, `updated_at`

30. **`credit_reconciliation_reports`**
    - **Purpose:** Stores detected discrepancies in credit balances or tracking.
    - **Key Fields:** `report_id` (UUID, PK), `tenant`, `company_id`, `expected_balance` (cents), `actual_balance` (cents), `difference` (cents), `detection_date`, `status` ('open', 'in_review', 'resolved'), `resolution_date`, `resolution_user`, `resolution_notes`, `resolution_transaction_id` (FK), `metadata` (jsonb)

31. **`approvals`**
    - **Purpose:** Manages items pending approval (e.g., time entries, discounts)
    - **Key Fields:** `tenant`, `approval_id` (UUID, PK), `item_type`, `item_id`, `requested_by`, `approved_by`, `status`, `request_date`, `approval_date`

32. **`notifications`**
    - **Purpose:** Tracks communication events and preferences
    - **Key Fields:** `tenant`, `notification_id` (UUID, PK), `company_id`, `user_id`, `notification_type`, `message`, `sent_date`, `status`

33. **`audit_logs`**
    - **Purpose:** Captures detailed audit trails for all billing-related operations
    - **Key Fields:** `tenant`, `audit_id` (UUID, PK), `user_id`, `operation`, `table_name`, `record_id`, `changed_data` (jsonb), `timestamp`

### Key Relationships

- **`companies`** are associated with multiple **`billing_plans`** through **`company_billing_plans`**.
- **`companies`** are associated with **`plan_bundles`** through **`company_plan_bundles`**.
- **`plan_bundles`** contain multiple **`billing_plans`** through **`bundle_billing_plans`**.
- **`company_billing_plans`** can be linked to **`company_plan_bundles`** via `company_bundle_id`.
- **`billing_plans`** and **`service_catalog`** are linked via **`plan_service_configuration`** to define service-specific settings.
- **`plan_service_configuration`** connects to specific config tables (`plan_service_usage_config`, `plan_service_fixed_config`, `plan_service_hourly_config`, `plan_service_bucket_config`) based on `configuration_type`.
- **`plan_service_usage_config`** links to **`plan_service_rate_tiers`** when tiered pricing is enabled.
- **`billing_plans`** can have a plan-level fixed config via **`billing_plan_fixed_config`**.
- **`time_entries`** and **`usage_tracking`** link to **`companies`** and **`service_catalog`**.
- **`invoices`** contain **`invoice_items`**.
- **`invoice_items`** link to **`invoice_item_details`** (V1), which link to type-specific detail tables like **`invoice_item_fixed_details`**.
- **`transactions`** record financial activities related to **`invoices`** and **`companies`**.
- **`bucket_usage`** tracks usage against **`plan_service_bucket_config`**.
- **`tax_rates`** are linked via `tax_rate_id` on **`service_catalog`** and **`company_tax_rates`**.

## Data Models and Interfaces

The billing system uses several key data structures defined in TypeScript interfaces (`server/src/interfaces/billing.interfaces.ts`, `server/src/interfaces/planServiceConfiguration.interfaces.ts`, etc.). Understanding these is crucial.

### Key Interfaces (Examples)

#### IBillingCharge (Base)
```typescript
interface IBillingCharge extends TenantEntity {
  type: 'fixed' | 'time' | 'usage' | 'bucket' | 'product' | 'license';
  serviceId?: string;
  company_billing_plan_id?: string;
  serviceName: string;
  rate: number; // In cents
  total: number; // In cents
  quantity?: number;
  tax_amount: number; // In cents
  tax_rate: number; // Decimal rate (e.g., 0.065)
  tax_region?: string;
  is_taxable?: boolean;
  company_bundle_id?: string;
  bundle_name?: string;
}
```

#### IFixedPriceCharge (Detailed)
```typescript
interface IFixedPriceCharge extends IBillingCharge {
  type: 'fixed';
  quantity: number; // From plan_service_configuration
  // Fields derived from allocation
  config_id?: string; // FK to plan_service_configuration
  base_rate?: number; // Plan-level base rate (cents)
  fmv?: number; // Service FMV (cents)
  proportion?: number; // FMV proportion
  allocated_amount?: number; // Allocated charge (cents) - should match rate/total
  // Plan settings snapshot
  enable_proration?: boolean;
  billing_cycle_alignment?: string;
}
```

#### ICompanyBillingPlan
```typescript
interface ICompanyBillingPlan extends TenantEntity {
  company_billing_plan_id: string;
  company_id: string;
  plan_id: string;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  is_active: boolean;
  custom_rate?: number; // In cents (used for bundles)
  company_bundle_id?: string;
  plan_name?: string; // Joined from billing_plans
  billing_frequency?: string; // Joined from billing_plans
  bundle_name?: string; // Joined from plan_bundles
}
```

### Relationships Between Data Models
- `ICompanyBillingPlan` determines how `IBillingCharge` objects are calculated by the `BillingEngine`.
- Multiple `IBillingCharge` objects are generated based on plan configurations, time entries, usage records, etc.
- These charges are then used to create `invoice_items` (and associated `invoice_item_details`) when an invoice is finalized.
- `IPlanBundle` and related interfaces manage grouped plan assignments.

## Credit System and Reconciliation

(This section appears largely up-to-date based on recent work)

The billing system includes a comprehensive credit management system that allows companies to maintain credit balances and apply them to invoices. This system is complemented by a robust credit reconciliation mechanism that ensures the integrity of credit balances.

### Credit Management

1.  **Credit Sources**
    - **Prepayment Invoices**: Companies can make prepayments that are converted to credits
    - **Negative Invoices**: Invoices with negative totals automatically generate credits when finalized
    - **Adjustments**: Manual credit adjustments can be made to company accounts

2.  **Credit Application**
    - Credits can be applied to any outstanding invoice
    - Applied automatically during invoice finalization
    - Can be applied manually to specific invoices
    - Credit applications are recorded as transactions
    - Real-time credit balance updates

3.  **Credit Transaction Types**
    - **credit_issuance**: Generated when a prepayment is processed
    - **credit_issuance_from_negative_invoice**: Generated when a negative invoice is finalized
    - **credit_application**: Applied to an invoice to reduce the balance due
    - **credit_adjustment**: Manual adjustment to a company's credit balance
    - **credit_expiration**: When credits expire (if configured with expiration dates)
    - **credit_transfer**: When credits are transferred between accounts

4.  **Implementation Details**
    ```typescript
    // Creating credit from a negative invoice (Conceptual Example)
    if (invoice && invoice.total_amount < 0) {
      const creditAmount = Math.abs(invoice.total_amount); // Amount in cents

      // Update company credit balance (logic likely in a service)
      // await CompanyCreditService.addCredit(invoice.company_id, creditAmount, ...);

      // Record a credit issuance transaction
      await trx('transactions').insert({
        transaction_id: uuidv4(),
        company_id: invoice.company_id,
        invoice_id: invoiceId,
        amount: creditAmount, // Store in cents
        type: 'credit_issuance_from_negative_invoice',
        status: 'completed',
        description: `Credit issued from negative invoice ${invoice.invoice_number}`,
        created_at: new Date().toISOString(),
        balance_after: currentBalance + creditAmount, // Balance in cents
        tenant
      });

      // Create a credit_tracking record
      await trx('credit_tracking').insert({
         credit_id: uuidv4(),
         tenant: tenant,
         company_id: invoice.company_id,
         transaction_id: /* ID of the transaction above */,
         amount: creditAmount,
         remaining_amount: creditAmount,
         created_at: new Date().toISOString(),
         // expiration_date: /* Calculate if applicable */,
         is_expired: false
      });
    }
    ```

5.  **Credit Tracking**
    - Company credit balances are managed and tracked in real-time.
    - Credits are displayed on the billing dashboard.
    - Detailed transaction history records all credit activities.
    - Individual credits are tracked in `credit_tracking` table, including remaining amounts and expiration.

### Credit Reconciliation System

Ensures integrity of credit balances by detecting and reporting discrepancies.

1.  **Reconciliation Philosophy**
    - Separation of Detection and Correction
    - Transparency: Detailed discrepancy reports
    - Manual Resolution by authorized users
    - Comprehensive Audit Trail

2.  **Types of Discrepancies**
    - **Credit Balance Discrepancies**: Expected (from transactions) vs. Actual (company record) balance.
    - **Missing Credit Tracking Entries**: Transactions missing corresponding `credit_tracking` records.
    - **Inconsistent Remaining Amounts**: `credit_tracking.remaining_amount` mismatch with transaction history.

3.  **Reconciliation Process**
    - **Balance Validation**: Calculate expected, compare, report discrepancy.
    - **Credit Tracking Validation**: Identify missing/inconsistent entries.
    - **Report Creation**: Store details in `credit_reconciliation_reports`.
    - **Scheduled Validation**: Runs daily to validate all companies.

4.  **Resolution Workflow**
    - **Resolution Options**: Apply adjustment, mark resolved, etc.
    - **Audit Trail**: Log resolution actions.
    - **Transaction Records**: Corrections create financial transactions.

5.  **Database Schema**
    - **`credit_reconciliation_reports`**: Stores detected discrepancies.
    ```typescript
    interface ICreditReconciliationReport {
      report_id: string;
      company_id: string;
      expected_balance: number; // In cents
      actual_balance: number; // In cents
      difference: number; // In cents
      detection_date: string;
      status: 'open' | 'in_review' | 'resolved';
      resolution_date?: string;
      resolution_user?: string;
      resolution_notes?: string;
      resolution_transaction_id?: string; // FK to resolving transaction
      metadata?: any; // Stores detailed info specific to the discrepancy type
    }
    ```

6.  **User Interface Components**
    - Reconciliation Dashboard
    - Discrepancy Detail View
    - Recommended Fix Panel
    - Resolution Form

7.  **Server Actions**
    - `validateCreditBalanceWithoutCorrection()`
    - `validateCreditTrackingEntries()`
    - `validateCreditTrackingRemainingAmounts()`
    - `resolveReconciliationReport()`
    - `createMissingCreditTrackingEntry()`
    - `updateCreditTrackingRemainingAmount()`

## Important Implementation Details

1.  **Multi-tenancy**
    - All tables include a `tenant` column.
    - Row-level security policies enforce data isolation.

2.  **Billing Calculations (`BillingEngine`)**
    - Calculates charges based on various configurations:
        - Fixed-price plans (`billing_plan_fixed_config`, FMV allocation)
        - Time-based (`time_entries`, `plan_service_hourly_config`, `user_type_rates`)
        - Usage-based (`usage_tracking`, `plan_service_usage_config`, `plan_service_rate_tiers`)
        - Bucket plans (`bucket_usage`, `plan_service_bucket_config`)
        - Discounts (`discounts`, `plan_discounts`)
        - Plan Bundles (`company_plan_bundles`, `bundle_billing_plans`)
        - Tax calculations (`TaxService`, `tax_rates`, `company_tax_rates`)
        - Multi-currency (`currencies`)
        - Handles multiple simultaneous plans.

3.  **Bucket of Hours/Retainer Billing**
    - **Automatic Tracking:** `BucketUsageService` updates `bucket_usage.hours_used` based on linked `time_entries`.
    - **Period Management:** Ensures `bucket_usage` record exists for the relevant billing period.
    - **Rollover Support:** `rolled_over_hours` stores unused hours if `allow_rollover` is enabled.
    - **Overage Calculation:** `overage_hours = max(0, hours_used - total_hours)`. Rollover hours add to available time but don't change the overage threshold.
    - **Reconciliation:** Daily job recalculates `hours_used` from source entries.

4.  **Proration**
    - Logic exists in `BillingEngine._calculateProrationFactor`.
    - Applied to fixed-fee plans if `billing_plan_fixed_config.enable_proration` is true.
    - Factor calculated based on plan active dates within the billing period.

5.  **Recurring Billing**
    - Uses `billing_frequency` from `billing_plans`.
    - Job scheduler automates invoice generation.

6.  **Custom Pricing**
    - `plan_service_configuration.custom_rate` (cents) overrides service default rates.
    - `plan_service_bucket_config.overage_rate` (cents) for bucket overages.
    - `bundle_billing_plans.custom_rate` (cents) for plans within bundles.

7.  **Audit Trail**
    - `audit_logs` table captures detailed changes.

8.  **Performance Considerations**
    - Appropriate indexes are crucial.
    - Partitioning large tables (time_entries, usage_tracking, transactions, audit_logs) recommended.

9.  **API Design**
    - Comprehensive API for managing plans, services, bundles, time/usage, invoices, calculations, previews, discounts, taxes, approvals, notifications.

10. **Extensibility**
    - Designed for adding new billing models.

11. **Concurrency and Data Integrity**
    - Use transactions to prevent race conditions.
    - Approval workflows enhance data integrity.

12. **Currency and Taxation**
    - Store currency info (`currency_code`). Use `currencies` table.
    - Flexible tax system (`tax_rates`, `company_tax_rates`, `TaxService`).

13. **Plan Management**
    - Interfaces for managing multiple plans per client.
    - Logic handles plan activation/deactivation and date ranges.

14. **Reporting**
    - Tools needed for breakdown by plan, service, category, discounts, taxes.
    - Bucket usage reports.

## Mermaid Diagram (ERD)

```mermaid
erDiagram
    tenants ||--o{ companies : has
    tenants ||--o{ users : has
    tenants ||--o{ service_catalog : defines
    tenants ||--o{ billing_plans : offers
    tenants ||--o{ service_categories : defines
    tenants ||--o{ discounts : provides
    tenants ||--o{ tax_rates : sets
    tenants ||--o{ currencies : uses
    tenants ||--o{ notifications : sends
    tenants ||--o{ audit_logs : records
    tenants ||--o{ plan_bundles : defines

    companies ||--o{ company_billing_plans : subscribes_to
    companies ||--o{ usage_tracking : tracks
    companies ||--o{ invoices : receives
    companies ||--o{ bucket_usage : uses
    companies ||--o{ transactions : involved_in
    companies ||--o{ approvals : requests
    companies ||--o{ company_plan_bundles : assigned
    companies ||--o{ company_tax_rates : has_rates

    users ||--o{ time_entries : logs
    users ||--o{ approvals : processes
    users ||--o{ notifications : receives
    users ||--o{ audit_logs : performed_by

    service_catalog ||--o{ plan_service_configuration : configured_in
    service_catalog ||--o{ time_entries : references
    service_catalog ||--o{ usage_tracking : measures
    service_catalog ||--o{ invoice_items : details
    service_catalog }|--|| service_categories : belongs_to
    service_catalog ||--o{ invoice_item_details : references_service
    service_catalog ||--o{ company_tax_rates : can_override_tax_for

    billing_plans ||--o{ company_billing_plans : assigned_to
    billing_plans ||--o{ plan_service_configuration : has_config_for
    billing_plans ||--o{ bundle_billing_plans : part_of
    billing_plans ||--o{ plan_discounts : has
    billing_plans ||--o{ billing_plan_fixed_config : has_fixed_config

    invoices ||--o{ invoice_items : contains
    invoices ||--o{ transactions : linked_to

    plan_bundles ||--o{ bundle_billing_plans : contains_plans
    plan_bundles ||--o{ company_plan_bundles : assigned_via

    company_plan_bundles ||--o{ company_billing_plans : creates_assignments

    plan_service_configuration ||--|{ plan_service_usage_config : usage_details
    plan_service_configuration ||--|{ plan_service_fixed_config : fixed_details
    plan_service_configuration ||--|{ plan_service_hourly_config : hourly_details
    plan_service_configuration ||--|{ plan_service_bucket_config : bucket_details
    plan_service_configuration ||--o{ plan_service_rate_tiers : has_tiers
    plan_service_configuration ||--o{ user_type_rates : has_user_rates
    plan_service_configuration ||--o{ invoice_item_details : references_config

    plan_service_bucket_config ||--o{ bucket_usage : tracks_usage_against

    plan_discounts }o--|| discounts : applies

    currencies ||--o{ invoices : denominates
    currencies ||--o{ invoice_items : denominates
    currencies ||--o{ transactions : denominates

    tax_rates ||--o{ service_catalog : default_rate_for
    tax_rates ||--o{ company_tax_rates : specific_rate_for

    approvals ||--o{ audit_logs : generates

    %% V1 Invoice Detail Tracking
    invoice_items ||--|{ invoice_item_details : has_details
    invoice_item_details ||--|{ invoice_item_fixed_details : fixed_specifics
    %% Future: invoice_item_details ||--|{ invoice_item_hourly_details : hourly_specifics
    %% Future: invoice_item_details ||--|{ invoice_item_usage_details : usage_specifics

    %% Credit System
    companies ||--o{ credit_tracking : has_credits
    transactions ||--o{ credit_tracking : issues_or_applies
    companies ||--o{ credit_reconciliation_reports : has_reports
    transactions ||--o{ credit_reconciliation_reports : resolves

%% Table Definitions (Simplified for Brevity - see full schema above)
tenants { UUID tenant PK }
companies { UUID company_id PK, UUID tenant FK, boolean is_tax_exempt }
users { UUID user_id PK, UUID tenant FK }
service_catalog { UUID service_id PK, UUID tenant FK, integer default_rate, UUID tax_rate_id FK }
service_categories { UUID category_id PK, UUID tenant FK }
billing_plans { UUID plan_id PK, UUID tenant FK, string plan_type }
billing_plan_fixed_config { UUID plan_id PK,FK, numeric base_rate, boolean enable_proration }
plan_service_configuration { UUID config_id PK, UUID tenant FK, UUID plan_id FK, UUID service_id FK, string configuration_type, integer quantity, integer custom_rate }
plan_service_fixed_config { UUID config_id PK,FK, numeric base_rate }
plan_service_hourly_config { UUID config_id PK,FK, integer minimum_billable_time, integer round_up_to_nearest }
user_type_rates { UUID rate_id PK, UUID config_id FK, string user_type, integer rate }
plan_service_usage_config { UUID config_id PK,FK, boolean enable_tiered_pricing }
plan_service_rate_tiers { UUID tier_id PK, UUID config_id FK, integer min_quantity, integer max_quantity, integer rate }
plan_service_bucket_config { UUID config_id PK,FK, integer total_hours, integer overage_rate, boolean allow_rollover }
company_billing_plans { UUID company_billing_plan_id PK, UUID tenant FK, UUID company_id FK, UUID plan_id FK, UUID company_bundle_id FK }
time_entries { UUID entry_id PK, UUID tenant FK, UUID user_id FK, UUID service_id FK, boolean invoiced }
usage_tracking { UUID usage_id PK, UUID tenant FK, UUID company_id FK, UUID service_id FK, boolean invoiced }
invoices { UUID invoice_id PK, UUID tenant FK, UUID company_id FK, integer total_amount, integer subtotal, integer tax_total, boolean is_manual }
invoice_items { UUID item_id PK, UUID invoice_id FK, UUID service_id FK, integer net_amount, integer tax_amount, integer total_price, boolean is_taxable, boolean is_discount }
invoice_item_details { UUID item_detail_id PK, UUID item_id FK, UUID service_id FK, UUID config_id FK, integer rate }
invoice_item_fixed_details { UUID item_detail_id PK,FK, integer base_rate, integer fmv, numeric proportion, integer allocated_amount }
bucket_usage { UUID usage_id PK, UUID tenant FK, UUID config_id FK, UUID company_id FK, decimal hours_used, decimal overage_hours, decimal rolled_over_hours }
discounts { UUID discount_id PK, UUID tenant FK }
plan_discounts { UUID plan_id FK, UUID company_id FK, UUID discount_id FK }
tax_rates { UUID tax_rate_id PK, UUID tenant FK, string region_code, numeric tax_percentage }
company_tax_rates { UUID company_tax_rate_id PK, UUID company_id FK, UUID tax_rate_id FK, boolean is_default }
currencies { string currency_code PK }
transactions { UUID transaction_id PK, UUID tenant FK, UUID company_id FK, UUID invoice_id FK, string type, integer amount, integer balance_after }
credit_tracking { UUID credit_id PK, UUID tenant FK, UUID company_id FK, UUID transaction_id FK, integer amount, integer remaining_amount }
credit_reconciliation_reports { UUID report_id PK, UUID tenant FK, UUID company_id FK, integer expected_balance, integer actual_balance }
approvals { UUID approval_id PK, UUID tenant FK }
notifications { UUID notification_id PK, UUID tenant FK }
audit_logs { UUID audit_id PK, UUID tenant FK }
plan_bundles { UUID bundle_id PK, UUID tenant FK }
bundle_billing_plans { UUID bundle_id PK,FK, UUID plan_id PK,FK, integer custom_rate }
company_plan_bundles { UUID company_bundle_id PK, UUID tenant FK, UUID company_id FK, UUID bundle_id FK }