# Tax V2: Fact Packs and Module Manifest

## Fact Packs (V2)

- TaxPolicyPack
  - Fields: `pricing_mode` ("exclusive"|"inclusive"), `component_order` (["state","county","city","special", ...]), `compounding` (bool per component), `rounding` ({ level: "line"|"jurisdiction"|"invoice", mode: "half_up"|"bankers"|... }), `discount_allocation` ("proportional"|"line"), `return_policy` (reverse-by-reference settings)
- TaxRatesPack
  - Fields: `jurisdiction_code`, `authority`, `components[]` ({ name, rate_bps, is_compound, effective_start, effective_end })
- JurisdictionPack
  - Fields: per-charge (or per-dimension) resolved `jurisdiction_code`, derivation method (origin/destination/service-location), timestamps when relevant
- ProductTaxCodesPack
  - Fields: `service_id`→`tax_code`, optional `category_id` mapping
- ExemptionsPack
  - Fields: `company_id`, `tax_code`, `exemption_type` (full/partial), `certificate_id`, validity
- DiscountAllocationPolicyPack
  - Fields: method (line/proportional), scope (per category/plan), exclusions
- RoundingPolicyPack
  - Fields: currency precision, line/jurisdiction/invoice rounding, penny-adjustment strategy

Notes:
- Packs are versioned; Tax modules declare accepted ranges in manifests.
- Providers (e.g., Avalara) can be used host-side to populate `TaxRatesPack` and `JurisdictionPack` without changing module code.

## Tax Transformer Manifest (Example)

```json
{
  "name": "tax-us-eu-generic",
  "module_id": "mod.tax",
  "version": "2.0.0",
  "type": "transformer",
  "scope": { "schema": {"type": "null"}, "version_range": ">=1.0.0 <2.0.0" },
  "requires": {
    "facts": [
      {"kind": "TaxPolicyPack", "version_range": ">=1"},
      {"kind": "TaxRatesPack", "version_range": ">=1"},
      {"kind": "JurisdictionPack", "version_range": ">=1"},
      {"kind": "ProductTaxCodesPack", "version_range": ">=1", "optional": true},
      {"kind": "ExemptionsPack", "version_range": ">=1", "optional": true},
      {"kind": "DiscountAllocationPolicyPack", "version_range": ">=1", "optional": true},
      {"kind": "RoundingPolicyPack", "version_range": ">=1"}
    ],
    "events": []
  },
  "emits": {
    "dimensions_default": {"type": "tax"}
  },
  "invariants": [
    "sum(line.tax_breakdown.amounts) == tax_charges_total_per_line",
    "no_tax_on_exempt_lines"
  ],
  "program_version_range": ">=1.0.0 <2.0.0"
}
```

## Planning and CLI
- `alga-billing plan-inputs` will include the Tax packs when the Tax Transformer is enabled in the Program.
- Preview runs can show the tax components per jurisdiction and any rounding adjustments as separate lines.

