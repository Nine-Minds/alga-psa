# Tax Calculation and Allocation Process

## Overview
This document details the comprehensive process for calculating and allocating taxes on invoice items in our billing system. The process is designed to correctly handle scenarios with multiple services, each potentially associated with different tax regions, as well as invoices containing both positive charges and negative credits.

## Grouping Invoice Items by Tax Region
During invoice generation, all invoice items are first grouped by their applicable tax region. The tax region for an invoice item is determined by:
- The item's own tax region, if specified.
- Otherwise, the company's default tax region is applied.

## Calculation of Net Positive Amount per Region
For each tax region group, we calculate the **net positive amount**:
- We sum up the net amounts of all invoice items in the group.
- Only positive net amounts are considered for tax calculation.
- Negative amounts (credits) are excluded from tax calculation.

## Tax Rate Determination
For each tax region, the system retrieves the applicable tax rate using the company's configuration and effective date. The tax rate is typically expressed as a percentage (e.g., 8.875% for New York).

## Tax Calculation per Group
Once the net positive amount for a given tax region is determined, the tax for that group is calculated by applying the tax rate:
taxAmount = netPositiveAmount * (taxRate / 100)

This calculation is performed using the `taxService.calculateTax` method.

## Proportional Allocation of Tax to Invoice Items
After computing the total tax for a tax region group, the tax is allocated proportionally among the positive invoice items within that group:
1. Calculate the total of the net amounts for all positive items in the group.
2. For each item, initially allocate:
itemTax = floor((itemNetAmount / totalGroupNet) * totalGroupTax)

3. For the final item in the group, assign any remaining tax to ensure the sum of allocated tax equals the total tax calculated for that group.

## Rounding Strategy
The allocation process uses a rounding strategy to avoid discrepancies:
- **Math.floor** is applied during proportional allocation to ensure intermediate allocated tax values are whole numbers.
- The last positive item in each tax group receives the remainder of the total tax to maintain consistency.

## Handling Negative Amounts
- Negative invoice item amounts, which represent credits, are not subject to tax.
- Tax calculation is skipped for such items, ensuring that credits do not incur tax charges.

## Example Scenario
Consider an invoice with two items:
- **Regular Service**: Amount = $10.00 in a tax region with an 8.875% tax rate.
- **Credit Service**: Amount = -$2.00 in the same tax region.

**Calculation Steps:**
1. Net positive group total: Only the positive items are considered, so the total is $10.00. However, if credits reduce the net positive amount, the effective net is $8.00.
2. Tax is then calculated on the net positive amount:
tax = $8.00 * 8.875% ≈ $0.71 to $0.72

3. This total tax is then distributed among the invoice items proportionally.
- Regular Service receives a higher share compared to the credit item.

*Note*: Our current business logic applies tax only on positive items; if credits reduce the net positive total, the proportional allocation reflects that outcome.

## Conclusion
The tax calculation and allocation process ensures that:
- Taxes are only applied to positive net invoice amounts.
- Each tax region's specific rate is respected.
- Tax is allocated proportionally to each applicable invoice item with careful rounding.
- Negative amounts are excluded from triggering tax.

This approach guarantees accurate invoice totals and compliance with regional tax regulations.