# Configure tax caps

Use **Billing > Tax Rates** to limit the tax calculated from an individual tax
rate. The **Tax cap** column shows the saved amount and currency, **No cap**, or
a stored amount whose currency has not yet been specified. You need billing
create permission to add a rate and billing update permission to change one.
Users with billing read permission can inspect caps.

## Set or change a cap

1. Open **Billing > Tax Rates** and choose **Add New Tax Rate**, or choose
   **Edit** for an existing rate.
2. Complete the region, percentage, and validity dates. Under **Rate currency**,
   choose the invoice currency for the rate.
3. Enter the maximum tax amount in **Tax cap** using the decimal separator
   shown in the example. Enter major units: for example, a USD cap of `5.00`
   means five US dollars. Do not include grouping separators or currency symbols.
4. Save. Reload the page and reopen the rate to check the saved amount. You can
   also inspect it under **Advanced Settings > Details**.

Selecting a currency restricts the entire rate to invoices in that currency.
If you change a rate from **All invoice currencies** to a specific currency,
other invoice currencies will no longer select it. Review the applicable rates
for those currencies before saving. AlgaPSA does not create replacement rates
or convert the cap through an exchange rate.

The amount supports the selected currency's precision: USD has two decimal
places, JPY has none, and BHD has three. Negative amounts, additional decimal
places, and values outside the supported range are rejected without rounding.
The largest supported cap is 9007199254740991 minor units: USD
90071992547409.91, JPY 9007199254740991, or BHD 9007199254740.991.

If you change the currency of a rate with a cap, enter the cap again in the new
currency before saving. Changing your tenant's base currency does not convert
or reinterpret a rate's cap.

## Clear a cap or set zero

Choose **Clear tax cap**, or empty the amount field, then save to remove the
limit. The table shows **No cap**. Clearing the cap retains the rate's currency;
selecting **All invoice currencies** is a separate change.

Enter `0` to save a real zero cap. On calculations that apply the cap, this
rate then contributes no tax. Zero is not the same as **No cap**. Component-based
calculations have the limitation described below.

## Resolve an older cap without a currency

An older rate may show **Currency not specified · 500 minor units**. This is an
existing cap, not an empty field. Its stored integer currently applies in each
invoice's smallest currency unit. For example, 500 minor units represents
5.00 in USD but 500 in JPY. AlgaPSA does not guess a currency for these rates.

To resolve it, edit the rate and choose its currency. The button **Use stored
minor amount in …** shows the monetary amount that will result. Select it to
confirm that interpretation. You can then edit the amount if needed. Save only
after checking that both the amount and the rate's currency applicability are
correct.

You can instead clear the cap without choosing a currency. Editing only the
description or dates preserves the existing unresolved cap and currency.

## How the cap affects tax

A regional tax calculation applies the cap to each rate's contribution before
combining tax. It does not cap the combined regional total. If two rates each
have a 5.00 cap, their combined tax can reach 10.00.

A period calculation applies the cap separately to each rate in each date
segment. Several segments can together exceed the entered cap. An invoice
may run several tax calculations, so its total tax may also exceed the cap.
This setting does not establish an invoice-wide, client-wide, project-wide,
or whole-period limit.

Manual invoices group taxable charges by region before calculating tax. Two
charges in the same region therefore share that regional calculation. Charges
in different regions trigger separate calculations, so an invoice with a 5.00
cap in each of two regions can have 10.00 total tax.

For example, a single internal regional calculation on a taxable amount of
100.00 at 10% produces 10.00 tax without a cap, 5.00 with a 5.00 cap, and 0.00
with a zero cap. Clearing the cap restores 10.00 on an equivalent calculation.
Use a new draft invoice or the supported recalculation flow to verify a change;
saving a tax rate does not itself promise to recalculate existing drafts.

For a composite rate, the row cap applies when that rate contributes to a
regional calculation. **Component-based calculations do not apply the row
cap**, including a zero cap. There are no individual component caps. The
Components tab and cap readout identify this limitation.

Project billing caps limit project billable amounts. Tax caps limit a tax
rate's calculated contribution. External tax providers use their own tax
configuration; this cap controls AlgaPSA's internal calculations.

The mechanics above do not establish jurisdiction-specific tax policy.
Per-rate scope, period resets, progressive thresholds, coverage gaps, and
rounding remain subject to the [tax calculation contract's domain review](tax_caps_and_period_spanning.md#open-questions-for-domain-review).

For API units and field semantics, see [Tax rate API fields](../../api/tax_rates.md).
