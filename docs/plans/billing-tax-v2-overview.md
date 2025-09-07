# Tax V2 Enhancement: Overview and Design

Scope: V2 enhancement to move tax computation into the billing runtime as a Transformer. V1 continues to use host-side TaxService; this design allows a clean evolution without breaking existing behavior.

## Goals
- Treat tax as code: deterministic, versioned, auditable.
- Support multi-component/compound taxes, inclusive/exclusive pricing, and flexible rounding policies.
- Keep modules pure (no network/FS); all inputs are Fact Packs from the host.
- Preserve/extend invoice auditability with per-component tax detail.

## Placement in Pipeline
- After all Producers and discount/cap Transformers (so taxable base is final).
- Before rounding/persistence and before any multi-invoice partitioning (tax computed per partition if partitioning occurs later).

## Inputs and Outputs
- Input: ChargeSet (post-discount), Context, and Tax Fact Packs (see facts doc).
- Output options (not mutually exclusive):
  - Tax charges: explicit charge lines with `dimensions.type = "tax"`, one per component/jurisdiction.
  - Tax breakdown metadata: annotate affected charges with `metadata.tax_breakdown[]` (authority, component, base, rate, amount).

### Example tax charge dimensions
- `type=tax`
- `tax_authority` (e.g., "US-CA", "EU")
- `jurisdiction_code` (e.g., "CA:LOS_ANGELES:LA_CITY")
- `component` (e.g., "state", "county", "city", "special")
- `rate_percent` (decimal as string or basis points), `is_compound` (bool)
- Links: `applies_to_charge_ids: []` (optional), or `tax_group_id` to join with breakdown rows

## Complexities Addressed
- Multi-component and compounding taxes (tax-on-tax sequences).
- Inclusive vs exclusive pricing; deriving net and tax from inclusive unit prices.
- Discount allocation: line-specific vs proportional effects on taxable base.
- Rounding policy: per-line, per-jurisdiction, per-invoice; penny adjustments.
- Jurisdiction resolution: origin/destination, service location, time-of-supply.
- Product/service tax codes; exemptions/certificates; tax holidays.
- Effective-dated rates and intra-period changes (split bases or as-of policy).
- Returns/credits: reverse original tax and rounding precisely, referencing original invoice.
- Multi-currency: currency-consistent rounding; inclusive math in billed currency.

## Persistence Model
- Option A: keep per-line fields (`tax_amount`) and add a detailed table:
  - `invoice_item_tax_details`: `item_id`, `component`, `authority`, `jurisdiction_code`, `rate`, `base_cents`, `amount_cents`, `is_compound`, `sequence`, `tax_group_id`.
- Option B: represent tax exclusively as separate tax charges with `type=tax` and link back via `invoice_item_details` or a join table.
- Recommendation: support both. Use details for audit, and optionally emit consolidated tax charges by jurisdiction/component for presentation.

## Determinism & Policy
- Integer cents math; no floats.
- Explicit `TaxPolicyPack` defines ordering (component sequence), inclusive/exclusive rules, and rounding modes.
- No network calls; providers (e.g., Avalara/TaxJar) integrate host-side to produce Fact Packs if desired.

## Compatibility & Rollout
- V1 (current): host TaxService remains the default path.
- V2 (opt-in): enable `mod.tax@X` Transformer for selected tenants; verify parity via previews and golden fixtures.
- Dual-run possible: compute both and diff; record both outcomes in `billing_executions` for audit during rollout.

