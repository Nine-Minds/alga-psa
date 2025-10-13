# Billing Cycles

## Overview

The billing cycle feature allows for flexible billing periods for each company. This enhancement enables the system to generate invoices based on custom billing frequencies, such as weekly, bi-weekly, monthly, quarterly, semi-annually, or annually.

## Billing Engine

The `BillingEngine` class is a central component of our billing system, responsible for processing different billing models, calculating charges, and handling proration and unapproved time entries.

### Key Features:
- Calculates fixed-price charges
- Processes time-based charges
- Handles usage-based billing
- Implements bucket contract line charges
- Applies proration for partial billing periods
- Manages rollover of unapproved time entries
- Supports multiple billing cycles per company
- Handles billing cycle transitions and overlaps
- Tracks billing cycle history for audit purposes

The `BillingEngine` integrates closely with billing cycles to determine billing periods and proration factors. It provides methods such as `calculateBilling`, `calculateFixedPriceCharges`, `calculateTimeBasedCharges`, and `rolloverUnapprovedTime` to handle various aspects of the billing process.

For example, the `calculateBilling` method orchestrates the entire billing calculation process:

```typescript
calculateBilling(billingPeriod: DateRange, companyId: string): Promise<IBillingCharge[]> {
  // Fetch company contract line
  // Calculate fixed price charges
  // Calculate time-based charges
  // Calculate usage-based charges
  // Apply proration if necessary
  // Return aggregated billing charges
}
```

This modular approach allows for flexibility in handling different billing scenarios and makes it easier to extend the system for future billing models.

## Setting and Updating Billing Cycles

Billing cycles can be set and updated for each company through the Billing Dashboard in the "Billing Cycles" tab. Administrators can select from the following options:

- Weekly
- Bi-Weekly
- Monthly (default)
- Quarterly
- Semi-Annually
- Annually

### Billing Cycles in Practice

Billing cycles are implemented in the code with options including 'weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', and 'annually'. The `BillingEngine` uses these cycles to determine the billing period and calculate proration factors.

For example, when calculating time-based charges:

```typescript
calculateTimeBasedCharges(billingPeriod: DateRange, timeEntries: ITimeEntry[], rate: number): number {
  // Filter time entries within the billing period
  // Calculate total hours
  // Apply rate to total hours
  // Return the calculated charge
}
```

Administrators can manage billing cycles through the company contract line settings. Changes to billing cycles will affect future billing calculations and invoice generation.

## Impact on Invoice Generation

The billing cycle affects how invoices are generated:

1. Invoice periods are determined based on the company's billing cycle.
2. Proration is applied according to the billing cycle when services are added or removed mid-cycle.
3. Time entries are billed based on the approval status and the current billing cycle.
4. Unapproved time entries are rolled over to the next billing cycle.

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
async function generateInvoice(companyId: string, billingPeriod: DateRange): Promise<IInvoice> {
  // Calculate charges using BillingEngine
  const charges = await billingEngine.calculateBilling(billingPeriod, companyId);
  
  // Create invoice record
  const invoice = await createInvoiceRecord(companyId, billingPeriod);
  
  // Generate invoice items from charges
  await createInvoiceItems(invoice.id, charges);
  
  // Fetch full invoice data
  const fullInvoice = await getFullInvoiceData(invoice.id);
  
  // Generate invoice document using template
  await generateInvoiceDocument(fullInvoice);
  
  return fullInvoice;
}
```
This process ensures that all billable items are accurately reflected in the final invoice and that the invoice adheres to the company's specified template and format.


## API Endpoints

The following API endpoints are available for managing billing cycles:

1. Get Billing Cycle for a Company:
   - `GET /api/billing-cycles/:companyId`

2. Update Billing Cycle for a Company:
   - `PUT /api/billing-cycles/:companyId`
   - Body: `{ "billingCycle": "monthly" }`

3. Get All Billing Cycles:
   - `GET /api/billing-cycles`

## Database Schema

The `company_billing_cycles` table has been enhanced to support historical tracking and tenant isolation:

```sql
CREATE TABLE company_billing_cycles (
  billing_cycle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  billing_cycle VARCHAR(20) NOT NULL,
  effective_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  period_start_date TIMESTAMP NOT NULL,
  period_end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  UNIQUE(company_id, effective_date)
);

-- Prevent overlapping periods
CREATE UNIQUE INDEX company_billing_cycles_no_overlap 
ON company_billing_cycles (company_id, period_start_date, billing_cycle_id)
WHERE period_end_date IS NULL;

CREATE UNIQUE INDEX company_billing_cycles_no_overlap_finite 
ON company_billing_cycles (company_id, period_start_date, period_end_date, billing_cycle_id) 
WHERE period_end_date IS NOT NULL AND period_end_date > period_start_date;
```

This enhanced schema provides:
- Historical tracking of billing cycle changes
- Prevention of overlapping billing periods
- Proper tenant isolation
- Explicit period start and end dates
- Automatic UUID generation for stable references

## Implementation Details

1. The `BillingEngine` class has been updated to consider custom billing cycles when calculating charges and applying proration.
2. The `generateInvoice` function in `invoiceActions.ts` now uses the company's billing cycle to determine the invoice period and due date.
3. A new `billingCycleActions.ts` file contains functions for managing billing cycles.
4. The BillingDashboard component has been updated with a new "Billing Cycles" tab for easy management of company billing cycles.

## Best Practices

1. Regularly review and update billing cycles to ensure they align with client agreements.
2. Communicate any changes in billing cycles to affected clients well in advance.
3. Monitor the impact of different billing cycles on cash flow and adjust as necessary.
4. Ensure that all team members involved in billing and invoicing are familiar with the billing cycle feature and its implications.

## Troubleshooting

If you encounter issues with billing cycles:

1. Verify that the company has a valid billing cycle set in the database.
2. Check that time entries are being correctly assigned to billing periods.
3. Ensure that the proration calculations are accurate for mid-cycle changes.
4. Review the logs for any errors related to billing cycle operations.

For further assistance, please contact the development team.
