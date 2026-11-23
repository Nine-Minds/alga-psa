# Tax Calculation and Allocation Process

## Overview
This document describes the tax calculation and allocation process implemented in our billing system. The process has been designed to ensure accurate tax calculations that comply with regional tax regulations. A key distinction in our system is how we handle discounts versus credits for tax calculation purposes.

## Grouping Invoice Items by Tax Region
During invoice generation, each invoice item is first grouped by its applicable tax region. The tax region for an invoice item is determined as follows:
- If the invoice item explicitly specifies a tax region, that region is used.
- Otherwise, the company's default tax region is applied.

## Identification of Item Types
The system distinguishes between three types of invoice items:
- **Charge Items:** These are positive invoice amounts representing actual billable services.
- **Discount Items:** These are negative line items marked with `is_discount: true` (contract discounts, manual discounts, and manual negative/credit lines authored on the invoice). The row itself is non-taxable (`is_taxable: false`, `tax_amount` 0), but it **reduces the taxable base of the lines it applies to, before tax is computed**.
- **Credit Items:** Negative lines that are NOT marked `is_discount` (for example automatic contract true-up credits). They are handled as before and are not part of the discount allocation.
- **Applied client credit and prepayments** are post-tax settlements. They never change the tax base.
  
## Calculation of Taxable Base per Region
For each tax region group, the **taxable base** is computed differently depending on the item types:

1. **For Discounts:** Each discount is first allocated onto the positive non-discount lines (and, for consolidated fixed plans, onto their `invoice_charge_fixed_details` entities) by `allocateDiscountsBeforeTax` (`shared/billingClients/discountAllocationBeforeTax.ts`). A discount with a target (`applies_to_item_id`, `applies_to_service_id`, a client contract, or the exact per-charge allocations stored by the automatic-discount evaluator) is spread only over its target lines. An untargeted (invoice-wide) discount is spread over every positive non-discount line, taxable **and exempt**, in proportion to net amount; only the share that lands on taxable lines reduces the taxable base. The allocation works in integer minor units with largest-remainder rounding (ties broken deterministically), every line is capped at its own amount with the leftover redistributed, and the base floors at 0. The regional taxable base is then the sum of the reduced amounts and tax is never negative.

2. **For Credits:** The taxable base is the sum of all positive, taxable invoice items MINUS the sum of all credit items. Credits do reduce the taxable base since they represent actual reductions to the services provided.

## Tax Rate Determination
For each tax region group, the system retrieves the applicable tax rate. This rate is based on the company's configuration and the effective date of the billing period. Tax rates are typically expressed as percentages (for example, 8.875% for New York).

## Calculation of Tax per Group
Once the taxable base is determined for a given region, the tax for that region is calculated by applying the tax rate:

&nbsp;&nbsp;&nbsp;&nbsp;**taxAmount = taxableBase × (taxRate / 100)**

This calculation uses the `taxService.calculateTax` method, which returns the tax amount based on the taxable base as determined above.

## Proportional Allocation of Tax to Invoice Items
After computing the total tax for a tax region group, the tax amount is allocated to each of the positive, taxable invoice items in that group proportionally:
1. **Determine Regional Totals:** Sum the net amounts of all positive, taxable items in the group.
2. **Initial Allocation:** For each item, compute its share of the tax as:
   
&nbsp;&nbsp;&nbsp;&nbsp;**itemTax = floor((itemNetAmount / totalRegionalNet) × totalGroupTax)**
   
3. **Rounding Adjustment:** For the final item in the group, assign any remaining tax to ensure that the sum of allocated tax equals the total tax calculated for the group.

This proportional allocation guarantees that each invoice item is assigned a fair portion of the total tax based solely on its net (positive) contribution.

## Rounding Strategy
To maintain consistency and avoid discrepancies due to fractional cents:
- **Math.floor** is applied during the proportional allocation of tax to each invoice item.
- Any residual tax amount (due to rounding) is allocated to the last item in the region group.

## Handling of Different Item Types
### Discount Items
Discount items are handled as follows:
- They are recorded separately on the invoice with negative net amounts.
- They are explicitly marked as non-taxable (i.e., `is_taxable: false` and `is_discount: true`).
- They reduce the taxable base of the lines they apply to before tax is computed; the discount row itself carries no tax.
- The allocated share is derived at calculation time (no extra column). Automatic contract discounts persist their per-charge allocations in `manual_line_metadata.allocations` so a scoped discount keeps its target.

### Credit Items
Credit items are handled as follows:
- They are recorded separately on the invoice with negative net amounts.
- They are not marked as discounts (i.e., `is_discount: false`).
- They may be marked as taxable, but no tax is applied due to their negative amount.
- The regional taxable base is built from the positive lines (after discount allocation); non-discount credit rows are not subtracted from it.

## Example Scenarios

### Scenario 1: Invoice with Discounts
Consider an invoice consisting of:
- **Regular Service:** A charge of $10.00 (represented as 1000 cents) in a region with a 10% tax rate.
- **Discount Item:** A discount of -$2.00 (represented as -200 cents) marked as a discount (`is_discount: true`).

**Calculation Steps:**
1. **Taxable Base Determination:**  
   - Only the Regular Service is considered for tax, so the taxable base is 1000 cents.
2. **Tax Calculation:**  
   - Tax is computed in full on the $10.00 charge:  
     tax = 1000 × (10 / 100) = 100 cents.
3. **Tax Allocation:**  
   - Since there is only one taxable item (Regular Service), it receives the full tax amount of 100 cents.
4. **Invoice Totals:**  
   - Subtotal: $8.00 ($10.00 - $2.00)
   - Tax: $1.00
   - Total: $9.00

### Scenario 2: Invoice with Credits
Consider an invoice consisting of:
- **Regular Service:** A charge of $10.00 (represented as 1000 cents) in a region with a 10% tax rate.
- **Credit Item:** A credit of -$2.00 (represented as -200 cents) NOT marked as a discount (`is_discount: false`).

**Calculation Steps:**
1. **Taxable Base Determination:**  
   - The Regular Service minus the Credit is considered for tax, so the taxable base is 800 cents.
2. **Tax Calculation:**  
   - Tax is computed on the net amount after credit:  
     tax = 800 × (10 / 100) = 80 cents.
3. **Tax Allocation:**  
   - Since there is only one taxable item (Regular Service), it receives the full tax amount of 80 cents.
4. **Invoice Totals:**  
   - Subtotal: $8.00 ($10.00 - $2.00)
   - Tax: $0.80
   - Total: $8.80

## Conclusion
The tax calculation and allocation process ensures that:
- **Discounts Reduce the Taxable Base:** Tax is computed on the discounted amounts (invoices, billing preview, quotes, and the invoice converted from a quote).
- **Manual Credits Reduce the Taxable Base:** Manual negative lines act like a discount in their own region and target.
- **Going Forward Only:** Finalized invoices keep their stored tax; nothing is recalculated or backfilled.
- **Accurate Regional Tax Application:** Each tax region's specific rate is applied precisely to the appropriate taxable base.
- **Proportional Distribution:** Tax amounts are fairly distributed among invoice items based on their individual contributions.
- **Clear Separation of Item Types:** Discount items and credit items are handled differently for tax calculation purposes.

This comprehensive approach guarantees accurate invoice totals while ensuring compliance with regional tax regulations.