# Tax Calculation and Allocation Process

## Overview
This document describes the tax calculation and allocation process implemented in our billing system. The process has been designed from the ground up to ensure that taxes are computed solely on positive, chargeable amounts—irrespective of any discounts or credit items present on the invoice. Discount items (or credits) are handled separately and are explicitly excluded from affecting the tax base. This guarantees that the tax is calculated on the full “pre-discount” charge, ensuring accurate results and compliance with regional tax regulations.

## Grouping Invoice Items by Tax Region
During invoice generation, each invoice item is first grouped by its applicable tax region. The tax region for an invoice item is determined as follows:
- If the invoice item explicitly specifies a tax region, that region is used.
- Otherwise, the company’s default tax region is applied.

## Identification of Taxable Items
The system distinguishes between:
- **Charge Items:** These are positive invoice amounts representing actual billable services.
- **Discount Items (Credits):** These items represent discounts or credits to offset charges. They are marked with an `is_discount` flag and are explicitly marked as non-taxable (`is_taxable: false`).
  
For tax calculation purposes, only items with a positive net amount and that are marked as taxable are considered. Discount items or any invoice items with negative or zero net amounts are excluded from the tax base.

## Calculation of Taxable Base per Region
For each tax region group, the **taxable base** is computed as:
- The sum of the net amounts of all positive, taxable invoice items within that region.
  
Discount items, even if they reduce the overall invoice subtotal, do not reduce this taxable base. The tax is always computed on the full positive charge amounts.

## Tax Rate Determination
For each tax region group, the system retrieves the applicable tax rate. This rate is based on the company’s configuration and the effective date of the billing period. Tax rates are typically expressed as percentages (for example, 8.875% for New York).

## Calculation of Tax per Group
Once the taxable base is determined for a given region, the tax for that region is calculated by applying the tax rate:

&nbsp;&nbsp;&nbsp;&nbsp;**taxAmount = taxableBase × (taxRate / 100)**

This calculation uses the `taxService.calculateTax` method, which returns the tax amount based on the full, unadjusted positive charge total, irrespective of any discounts applied elsewhere on the invoice.

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

## Handling of Discount Items
Discount or credit items are handled as follows:
- They are recorded separately on the invoice with negative net amounts.
- They are explicitly marked as non-taxable (i.e., `is_taxable: false` and `is_discount: true`).
- As a result, these items do not impact the taxable base, ensuring that tax calculation is performed on the full, pre-discount charge amounts.

## Example Scenario
Consider an invoice consisting of:
- **Regular Service:** A charge of $10.00 (represented as 1000 cents) in a region with a 10% tax rate.
- **Credit Service:** A discount of -$2.00 (represented as -200 cents) marked as a discount.

**Calculation Steps:**
1. **Taxable Base Determination:**  
   - Only the Regular Service is considered for tax, so the taxable base is 1000 cents.
2. **Tax Calculation:**  
   - Tax is computed in full on the $10.00 charge:  
     tax = 1000 × (10 / 100) = 100 cents.
3. **Tax Allocation:**  
   - Since there is only one taxable item (Regular Service), it receives the full tax amount of 100 cents.
4. **Invoice Totals:**  
   - Even though the overall invoice subtotal might be reduced by the credit (resulting in a lower or even zero subtotal), the tax calculation is based solely on the charge amount, ensuring proper tax computation.

## Conclusion
The updated tax calculation and allocation process ensures that:
- **Tax is Computed on Full Charge Amounts:** Discounts and credits do not reduce the taxable base.
- **Accurate Regional Tax Application:** Each tax region’s specific rate is applied precisely to the net positive amounts.
- **Proportional Distribution:** Tax amounts are fairly distributed among invoice items based on their individual contributions.
- **Clear Separation of Discounts:** Discount items are flagged and completely excluded from the tax calculations.

This comprehensive approach guarantees accurate invoice totals while ensuring compliance with regional tax regulations.