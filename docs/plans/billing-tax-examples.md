# Tax: Worked Examples (V1)

## 1) US Multi-Component (Exclusive)

- Context: exclusive pricing, CA state+county+city, non-compound; per-line rounding
- Inputs:
  - Charges (post-discount): two taxable service lines (`service_id` with tax codes), one non-taxable
  - TaxRatesPack: components with bps for CA/County/City
  - JurisdictionPack: resolved to appropriate codes per line
  - TaxPolicyPack: { pricing_mode: "exclusive", component_order: ["state","county","city"], compounding: false, rounding: { level: "line", mode: "half_up" } }
- Output:
  - Per-line `metadata.tax_breakdown[]`
  - Tax charges per jurisdiction component aggregated (optional): three charges (state/county/city) with `applies_to_charge_ids`, `rate_percent`, `amount_cents`

## 2) EU VAT (Inclusive)

- Context: inclusive pricing, invoice-wide rounding
- Inputs:
  - Charges with `net_amount_cents` representing tax-inclusive prices
  - TaxRatesPack: VAT rate for country
  - TaxPolicyPack: { pricing_mode: "inclusive", rounding: { level: "invoice", mode: "half_up" } }
- Output:
  - Transformer derives net and tax per line; sums tax; applies invoice-level rounding; emits a consolidated VAT charge

## 3) Discounts: Proportional vs Line-Specific

- Scenario A (Proportional): Transformer reduces taxable base of all affected lines proportionally before computing tax.
- Scenario B (Line-Specific): Only the discounted line’s base is reduced.
- Controlled by `DiscountAllocationPolicyPack`.

## 4) Bundles and Mixed Supplies

- Two strategies (policy-driven):
  - Predominant character: apply bundle-level tax code; one tax calculation on the bundle total
  - Apportionment: allocate by FMV/usage; compute tax per component line
- Implement via `TaxPolicyPack` flags; transformer either groups or splits accordingly.

## 5) Returns/Credits

- Given a credit referencing invoice X, the transformer looks up prior `tax_breakdown` inputs (from Facts or reference) and reverses amounts using the original rounding and rates; emits negative tax charges.

## 6) Multi-Currency

- Charges carry `currency_code` (company context).
- Rounding happens in the billed currency per `RoundingPolicyPack`; inclusive math uses currency precision rules.

## Pipeline Placement Example

```yaml
stages:
  - producer: mod.fixed-fmv@1.x
  - producer: mod.hourly@1.x
  - transformer: mod.category-coupons@1.x
  - transformer: mod.cap-total@1.x
  - transformer: mod.tax@2.x   # V2 tax transformer here
  - validator: mod.money-nonnegative@1.x
```
