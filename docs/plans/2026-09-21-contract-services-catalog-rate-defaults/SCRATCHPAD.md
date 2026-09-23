# Scratchpad — Contract Service Catalog Rate Defaults

- Plan slug: `2026-09-21-contract-services-catalog-rate-defaults`
- Created: `2026-09-21`

## Decisions

- (2026-09-21) Keep the existing product boundary: products are supported on fixed/product-capable lines only; hourly, usage, and bucket-style membership selectors remain service-only.
- (2026-09-21) Resolve authoring rates in this order: exact current `service_prices` row for the contract currency, then `service_catalog.default_rate`, then manual entry. This is the card's explicit product decision even though `default_rate` is legacy and untagged.
- (2026-09-21) Do not auto-create a `service_prices` row. Contract selection is not sufficient evidence that an untagged legacy default has the requested currency semantics.
- (2026-09-21) Treat the fixed-line service sum as a suggestion, not a permanent formula. It stays synchronized until the author edits the base rate; populated resumed/existing values are authoritative.
- (2026-09-21) Do not seed `ContractLineServiceForm.custom_rate` merely to make a default visible. A blank custom rate currently represents catalog inheritance and copying it would convert inherited pricing into an apparent contract override. Use the shared resolver at selection/addition boundaries and retain the form's default-source presentation.
- (2026-09-21) Scope this card to live contract authoring/editing. Contract-template wizard parity is deliberately deferred.

## Discoveries / Constraints

- (2026-09-21) `packages/billing/src/models/service.ts` validates `item_kind` as `service | product`; `IService` exposes current `prices[]` plus `default_rate`.
- (2026-09-21) `ServiceSelectionDialog.tsx` already requests `item_kind: service` for non-fixed lines and currently implements currency-rate-then-default-rate inline. It should consume the shared resolver rather than remain a parallel implementation.
- (2026-09-21) `GenericContractLineServicesList.tsx` fetches all item kinds, defensively limits products to fixed lines, but treats a missing contract-currency price as unresolved and requires a typed custom rate. Its display, validation, and submit branches must use the same resolution result.
- (2026-09-21) `HourlyServicesStep.tsx` and `UsageBasedServicesStep.tsx` intentionally require manual entry when only legacy `default_rate` exists. The implementation must reconcile those surfaces with the new explicit fallback policy if the card is interpreted as all live contract-creation paths; focused tests should prevent partial behavior drift.
- (2026-09-21) `ServiceCatalogPicker` returns `currency_rate` only when given `currencyCode`; fixed-fee selection currently does not pass it.
- (2026-09-21) `FixedFeeServicesStep.tsx` stores no rate on fixed-service draft rows and therefore cannot recompute a quantity-weighted sum without draft-only metadata or a separate lookup map.
- (2026-09-21) `ContractWizard.tsx` currently forwards `fixed_services` directly into the submission. If draft-only rate metadata is added, submission construction must explicitly project the public fields.
- (2026-09-21) `FixedContractLineConfiguration.tsx` rejects a missing/zero base rate and owns the persisted fixed config; `FixedContractLineServicesList.tsx` persists membership separately and currently reports only that an addition occurred.
- (2026-09-21) `package-lock.json` was already modified when planning began. Do not stage, restore, or otherwise alter it for this card's design commit.

## Likely Implementation Touchpoints

- `packages/billing/src/components/billing-dashboard/service-config/ServiceSelectionDialog.tsx`
- `packages/billing/src/components/billing-dashboard/contract-lines/GenericContractLineServicesList.tsx`
- `packages/billing/src/components/billing-dashboard/contract-lines/ContractLineServiceForm.tsx` (verify inherited-rate behavior; avoid forced override)
- `packages/billing/src/components/billing-dashboard/contracts/ServiceCatalogPicker.tsx`
- `packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx`
- `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx`
- `packages/billing/src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration.tsx`
- `packages/billing/src/components/billing-dashboard/FixedContractLineServicesList.tsx`
- A small UI-authoring rate resolver under `packages/billing/src/lib/` or adjacent to the contract authoring components
- Focused tests under `packages/billing/tests/`

## Risks

- The fallback `default_rate` has no currency tag. Applying it to a contract in another currency can produce a numerically convenient but semantically wrong suggestion. The explicit source label and no-auto-create rule reduce, but do not eliminate, this product risk.
- Persisting the resolved fallback as `custom_rate` may mark the membership as a contract override and stop it following future catalog changes. Implementation must preserve the existing action/provenance behavior and test the intended result.
- Auto-derived versus manually overridden fixed base rates are UI state. Navigation, draft resume, and component remounts must default toward preserving a populated value rather than overwriting it.
- Multiple active contract authoring surfaces have evolved different currency policies. Updating only one surface would leave users with contradictory behavior.
- A quantity-weighted service sum is only a default. It must not be confused with the fixed line's tax-allocation service rates or with product line totals.

## Commands / Runbooks

```bash
jq empty docs/plans/2026-09-21-contract-services-catalog-rate-defaults/features.json
jq empty docs/plans/2026-09-21-contract-services-catalog-rate-defaults/tests.json
jq -e 'all(.[]; .implemented == false) and ((map(.id) | unique | length) == length)' docs/plans/2026-09-21-contract-services-catalog-rate-defaults/features.json
jq -e 'all(.[]; .implemented == false) and ((map(.id) | unique | length) == length)' docs/plans/2026-09-21-contract-services-catalog-rate-defaults/tests.json
git diff --check
```

## Links / References

- Internal card: `alga-2026-0002525`
- Validated source baseline recorded by the card: `2dc8454a4c`

## Open Questions

- No blocking questions for implementation. If template-wizard parity is later requested, it should be planned as a separate follow-up because templates are currency-neutral in the current server model.
