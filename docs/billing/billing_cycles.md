# Billing Cycles

## Overview

The billing cycle feature allows for flexible billing periods for each client. This enhancement enables the system to generate invoices based on custom billing frequencies, such as weekly, bi-weekly, monthly, quarterly, semi-annually, or annually.

### Date Semantics (Important)
All billing periods are treated as **`[start, end)`** (end date is **exclusive**). The end date represents the **start of the next period**.

- Example: a monthly period might be `2026-01-10 → 2026-02-10` (the `2026-02-10` boundary is not billed in the prior period).
- Query rule of thumb: include records where `timestamp >= start` and `timestamp < end`.

**Related Documentation:** See [billing.md](./billing.md) for overall billing system architecture.

## Billing Engine

The `BillingEngine` class is a central component of our billing system, responsible for processing different billing models, calculating charges, and handling proration and unapproved time entries.

### Key Features:
- Calculates fixed-price charges
- Processes time-based charges
- Handles usage-based billing
- Implements bucket contract line charges
- Processes product and license charges
- Applies proration for partial billing periods
- Manages rollover of unapproved time entries
- Supports multiple billing cycles per client
- Handles billing cycle transitions and overlaps
- Tracks billing cycle history for audit purposes

**File Location:** [server/src/lib/billing/billingEngine.ts](../server/src/lib/billing/billingEngine.ts)

The `BillingEngine` integrates closely with billing cycles to determine billing periods and proration factors. It provides the following key methods:

- `calculateBilling(clientId, startDate, endDate, billingCycleId)` - Main orchestration method (line 141)
- `calculateFixedPriceCharges(clientId, billingPeriod, clientContractLine)` - Fixed fee charges (line 607)
- `calculateTimeBasedCharges(clientId, billingPeriod, clientContractLine)` - Hourly billing (line 1211)
- `calculateUsageBasedCharges(clientId, billingPeriod, clientContractLine)` - Usage-based billing (line 1452)
- `calculateBucketPlanCharges(clientId, billingPeriod, contractLine)` - Bucket/retainer billing (line 1773)
- `calculateProductCharges(...)` - Product passthrough charges (line 1619)
- `calculateLicenseCharges(...)` - License passthrough charges
- `rolloverUnapprovedTime(clientId, currentPeriodEnd, nextPeriodStart)` - Time entry rollover (line 2258)

For example, the `calculateBilling` method orchestrates the entire billing calculation process:

```typescript
async calculateBilling(
  clientId: string,
  startDate: ISO8601String,
  endDate: ISO8601String,
  billingCycleId: string
): Promise<IBillingResult> {
  // Fetch client contract lines for the billing period
  // Calculate fixed price charges
  // Calculate time-based charges
  // Calculate usage-based charges
  // Calculate bucket plan charges
  // Calculate product charges
  // Calculate license charges
  // Apply proration if necessary
  // Return aggregated billing charges with totals
}
```

This modular approach allows for flexibility in handling different billing scenarios and makes it easier to extend the system for future billing models.

## Setting and Updating Billing Cycles

Billing cycles can be set and updated for each client through the Billing Dashboard in the "Billing Cycles" tab. Administrators can select from the following options:

- Weekly
- Bi-Weekly
- Monthly (default)
- Quarterly
- Semi-Annually
- Annually

**UI Components:**
- [BillingCycles.tsx](../server/src/components/billing-dashboard/BillingCycles.tsx) - Main billing cycles management interface
- [BillingConfiguration.tsx](../server/src/components/clients/BillingConfiguration.tsx) - Client-specific billing configuration

### Billing Cycle Anchors
Billing cycles can also be **anchored** per client to support non-calendar boundaries (e.g., “bill on the 10th”).

- **Weekly:** choose a weekday (Mon–Sun)
- **Bi-weekly:** choose a “first cycle start date” to establish stable parity
- **Monthly:** choose a day-of-month (**1–28**)
- **Quarterly / Semi-annually / Annually:** choose a start month + day-of-month (**1–28**)

### Billing Cycles in Practice

Billing cycles are implemented in the code with options including 'weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', and 'annually'. The `BillingEngine` uses these cycles to determine the billing period and calculate proration factors.

**Type Definition:** See `BillingCycleType` in [server/src/interfaces/billing.interfaces.ts](../server/src/interfaces/billing.interfaces.ts) (line 305)

For example, when calculating time-based charges:

```typescript
calculateTimeBasedCharges(billingPeriod: DateRange, timeEntries: ITimeEntry[], rate: number): number {
  // Filter time entries within the billing period
  // Calculate total hours
  // Apply rate to total hours
  // Return the calculated charge
}
```

Administrators can manage billing cycles through the client contract line settings. Changes to billing cycles will affect future billing calculations and invoice generation.

## Impact on Invoice Generation

The billing cycle affects how invoices are generated:

1. Invoice periods are determined based on the client's billing cycle.
2. Proration is applied according to the billing cycle when services are added or removed mid-cycle.
3. Time entries are billed based on the approval status and the current billing cycle.
4. Unapproved time entries are rolled over to the next billing cycle.

**Related Files:**
- [AutomaticInvoices.tsx](../server/src/components/billing-dashboard/AutomaticInvoices.tsx) - Uses billing cycles for invoice generation
- [invoiceActions.ts](../server/src/lib/actions/invoiceActions.ts) - Invoice generation logic

## Invoice Generation Process

The invoice generation process is a crucial part of our billing system. It involves aggregating charges, creating invoice items, and generating the final invoice document.

### Key Steps:
1. **Charge Calculation**: The `BillingEngine` calculates all relevant charges for the billing period.
2. **Invoice Creation**: The `generateInvoice` function in `invoiceActions.ts` creates a new invoice record.
3. **Invoice Item Generation**: Charges are converted into invoice items, each representing a billable component.
4. **Invoice Data Aggregation**: Full invoice data is fetched, including all related items and the company's billing information.
5. **Invoice Document Generation**: An invoice document is created based on the aggregated data and the company's invoice template.

Here's a simplified example of the invoice generation process:

```typescript
async function generateInvoice(clientId: string, billingPeriod: DateRange): Promise<IInvoice> {
  // Calculate charges using BillingEngine
  const charges = await billingEngine.calculateBilling(clientId,
    billingPeriod.startDate,
    billingPeriod.endDate,
    billingCycleId
  );

  // Create invoice record
  const invoice = await createInvoiceRecord(clientId, billingPeriod);

  // Generate invoice items from charges
  await createInvoiceItems(invoice.id, charges);

  // Fetch full invoice data
  const fullInvoice = await getFullInvoiceData(invoice.id);

  // Generate invoice document using template
  await generateInvoiceDocument(fullInvoice);

  return fullInvoice;
}
```
This process ensures that all billable items are accurately reflected in the final invoice and that the invoice adheres to the client's specified template and format.

## Server Actions

The billing cycle system uses Next.js server actions rather than REST API endpoints. The following server actions are available in [billingCycleActions.ts](../server/src/lib/actions/billingCycleActions.ts):

### Core Actions:
- `getBillingCycle(clientId, tenant)` - Fetch a single billing cycle (line 15)
- `updateBillingCycle(data)` - Update billing cycle settings (line 35)
- `getAllBillingCycles(tenant)` - Fetch all billing cycles for a tenant (line 316)
- `getInvoicedBillingCycles(clientId, tenant)` - Get cycles with invoices (line 276)

### Lifecycle Management:
- `canCreateNextBillingCycle(clientId, billingCycleId, tenant)` - Check if next cycle can be created (line 58)
- `createNextBillingCycle(clientId, previousCycleId, tenant)` - Create next billing cycle (line 116)
- `removeBillingCycle(billingCycleId, tenant)` - Soft delete billing cycle (line 148)
- `hardDeleteBillingCycle(billingCycleId, tenant)` - Hard delete billing cycle (line 215)

### Additional Services:
**[createBillingCycles.ts](../server/src/lib/billing/createBillingCycles.ts)**
- `createClientContractLineCycles(...)` - Automatically create billing cycles for contract lines (line 300)

## Database Schema

The `client_billing_cycles` table supports historical tracking, tenant isolation, and overlap prevention.

**Migration History:**
- Created: [202409130945_add_company_billing_cycles.cjs](../server/migrations/202409130945_add_company_billing_cycles.cjs)
- Period dates added: [20241130160000_add_period_dates_to_billing_cycles.cjs](../server/migrations/20241130160000_add_period_dates_to_billing_cycles.cjs)
- Renamed company→client: [20251003000001_company_to_client_migration.cjs](../server/migrations/20251003000001_company_to_client_migration.cjs)
- Added is_active: [20250105022937_add_is_active_to_company_billing_cycles.cjs](../server/migrations/20250105022937_add_is_active_to_company_billing_cycles.cjs)

```sql
CREATE TABLE client_billing_cycles (
  billing_cycle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  billing_cycle VARCHAR(20) NOT NULL,
  effective_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  period_start_date TIMESTAMP NOT NULL,
  period_end_date TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(client_id),
  UNIQUE(client_id, effective_date)
);

-- Prevent overlapping periods (open-ended)
CREATE UNIQUE INDEX client_billing_cycles_no_overlap
ON client_billing_cycles (client_id, period_start_date, billing_cycle_id)
WHERE period_end_date IS NULL;

-- Prevent overlapping periods (finite)
CREATE UNIQUE INDEX client_billing_cycles_no_overlap_finite
ON client_billing_cycles (client_id, period_start_date, period_end_date, billing_cycle_id)
WHERE period_end_date IS NOT NULL AND period_end_date > period_start_date;
```

**Schema Features:**
- Historical tracking of billing cycle changes via versioning
- Prevention of overlapping billing periods through unique indexes
- Multi-tenant support with explicit tenant references
- Explicit period start and end dates for accurate period tracking
- Soft delete support via `is_active` flag
- Automatic UUID generation for stable primary keys

## Implementation Details

1. The `BillingEngine` class considers custom billing cycles when calculating charges and applying proration.
2. The `generateInvoice` function uses the client's billing cycle to determine the invoice period and due date.
3. The `billingCycleActions.ts` file contains server actions for managing billing cycles.
4. The BillingDashboard component includes a "Billing Cycles" tab for easy management of client billing cycles.

**Key Implementation Files:**
- [billingEngine.ts](../server/src/lib/billing/billingEngine.ts) - Core billing calculation engine
- [billingCycleActions.ts](../server/src/lib/actions/billingCycleActions.ts) - Billing cycle CRUD operations
- [createBillingCycles.ts](../server/src/lib/billing/createBillingCycles.ts) - Automatic cycle creation
- [BillingCycles.tsx](../server/src/components/billing-dashboard/BillingCycles.tsx) - UI component

## Best Practices

1. **Regular Review:** Regularly review and update billing cycles to ensure they align with client agreements.
2. **Client Communication:** Communicate any changes in billing cycles to affected clients well in advance.
3. **Cash Flow Monitoring:** Monitor the impact of different billing cycles on cash flow and adjust as necessary.
4. **Team Training:** Ensure that all team members involved in billing and invoicing are familiar with the billing cycle feature and its implications.
5. **Cycle Transitions:** Use `canCreateNextBillingCycle()` to validate before creating new cycles to avoid overlaps.

## Troubleshooting

If you encounter issues with billing cycles:

1. **Validation Errors:** Verify that the client has a valid billing cycle set in the `client_billing_cycles` table.
2. **Time Entry Assignment:** Check that time entries are being correctly assigned to billing periods.
3. **Proration Issues:** Ensure that the proration calculations are accurate for mid-cycle changes (check `applyProrationToPlan` in billingEngine.ts:2129).
4. **Overlap Errors:** Review unique index constraints if you encounter overlap prevention errors.
5. **Soft Deletes:** Check the `is_active` flag if billing cycles appear to be missing.
6. **Logs:** Review application logs for any errors related to billing cycle operations.

**Common Issues:**
- **"Cannot create overlapping billing cycles"** - Check for existing cycles with overlapping period_start_date/period_end_date
- **"Billing cycle not found"** - May be soft-deleted (is_active=false); use `hardDeleteBillingCycle` only if needed
- **Proration not applied** - Verify `enable_proration` flag on contract line configuration

For further assistance, please contact the development team.

---

**Related Documentation:**
- [billing.md](./billing.md) - Main billing system architecture
- [invoice_finalization.md](./invoice_finalization.md) - Invoice finalization process
