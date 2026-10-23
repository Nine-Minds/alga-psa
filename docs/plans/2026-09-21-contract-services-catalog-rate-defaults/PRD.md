# Contract Service Catalog Rate Defaults

- Slug: `2026-09-21-contract-services-catalog-rate-defaults`
- Date: `2026-09-21`
- Status: Draft

## Summary

Contract authors should be able to select a service and continue with its configured catalog rate instead of retyping that rate. Hourly, usage, and bucket-style contract lines must continue to accept services only; products remain available only to fixed/product-capable flows. When fixed services are selected, the recurring base rate should start at the sum of their resolved catalog rates while remaining editable.

## Problem

The contract-line authoring surfaces do not resolve catalog rates consistently. Some paths use a contract-currency `service_prices` row and fall back to `service_catalog.default_rate`; another path treats the absence of a currency row as an error even when `default_rate` is populated. That path requires a duplicate manual rate before it will add the service.

Products and services also have inconsistent fetch filters across components. The effective product rule is already fixed-only, but some components fetch all catalog items and rely on a later client-side filter while another filters at the action boundary.

Fixed contract lines bill from a required, non-zero recurring base rate independently of their member-service rates. The creation wizard currently makes the author re-enter that total even when every selected service already has a resolvable catalog rate.

## Goals

- Use one authoring-time rate resolution order: current contract-currency price, then catalog `default_rate`, then a manual rate when neither is available.
- Prefill and persist the resolved rate in contract-line service membership flows without requiring duplicate typing.
- Keep products out of hourly, usage, and bucket-style service selectors.
- Default a fixed line's recurring base rate to the quantity-weighted sum of its selected service rates.
- Preserve the author's ability to replace the suggested fixed base rate.
- Keep the existing non-zero fixed-base-rate validation as the final guard.

## Non-goals

- Reclassifying catalog records between `service` and `product`.
- Allowing products on hourly, usage, or bucket-style contract lines.
- Creating or updating `service_prices` rows as a side effect of contract authoring.
- Changing invoice calculation, rate provenance semantics, catalog price rollout, or existing contract repricing behavior.
- Automatically changing the base rate of an already priced fixed line when catalog prices later change.
- Applying the same UX changes to contract-template authoring in this card.
- Migrating historical contract-line memberships or fixed base rates.

## Users and Primary Flows

### Add a service to an existing hourly or usage line

1. The contract author opens the service selector.
2. The selector lists active catalog items whose `item_kind` is `service`; products are not shown.
3. The selected service resolves a rate from the contract currency when present, otherwise from `default_rate`.
4. The resolved rate is shown and submitted with the membership addition.
5. A manual rate is requested only when neither source yields a usable value.

### Add services while creating a fixed line

1. The contract author selects one or more active services.
2. Each selection captures the same resolved catalog rate used elsewhere in contract authoring.
3. The recurring base rate is suggested as `sum(resolved rate × quantity)`.
4. Quantity, selection, and removal changes continue to refresh the suggestion while it remains auto-derived.
5. After the author edits the recurring base rate, that manual value is preserved instead of being overwritten by later service changes.
6. The existing required/non-zero validation remains in force.

### Edit an existing fixed line

An existing non-zero recurring base rate is authoritative and is never overwritten when services are added or removed. If a legacy/draft fixed line has no base rate, the associated-services flow may seed the empty field from the current quantity-weighted service total, after which the author can edit and save it normally.

## UX / UI Notes

- The exact-currency price and legacy catalog-default fallback should be distinguishable in helper text or rate metadata where the surface already exposes rate details.
- A fallback must not claim that a currency-specific catalog price exists. It is a suggested authoring value for the contract's currency, not a new catalog price row.
- Manual-rate controls remain available for unresolved services and for author overrides.
- Product badges and product-specific fixed-line behavior remain unchanged.
- The recurring base-rate field stays visible and editable. Prefilling removes duplicate entry; it does not remove the concept of a plan-level fixed fee.

## Requirements

### Functional Requirements

1. A shared, UI-scoped catalog-rate resolver accepts a catalog item and contract currency and returns:
   - the matching current `service_prices` rate when present;
   - otherwise `default_rate` when it is a finite, non-negative number;
   - otherwise no resolved rate;
   - and a source discriminator (`currency-price`, `catalog-default`, or `none`).
2. `GenericContractLineServicesList` uses the resolver for display, validation, and the rate sent to `addServiceToContractLine`.
3. A selected service with a `default_rate` but no matching currency row is addable without manual rate entry.
4. An unresolved selected service still requires a valid manual rate and produces the existing localized validation feedback.
5. `ServiceSelectionDialog` uses the same resolver rather than maintaining a second resolution expression.
6. Non-fixed selectors request or expose only `item_kind: service`. Fixed selectors may expose both services and products where the existing fixed flow supports them.
7. `GenericContractLineServicesList` retains a defensive item-kind filter even if its fetch is later narrowed.
8. Fixed-fee wizard service selections capture a draft-only resolved rate and compute a quantity-weighted recurring base-rate suggestion.
9. The fixed-fee suggestion updates for selection, removal, replacement, and quantity changes only while the field is auto-derived.
10. Editing the recurring base-rate input marks it manual, and subsequent service changes do not overwrite it.
11. A resumed draft or an existing fixed line with a populated base rate treats that value as manual/authoritative.
12. A fixed line with no resolved positive sum remains subject to the existing non-zero base-rate validation.
13. Draft-only rate/source metadata is removed when building the server submission; the persisted contract schema does not change.
14. The legacy fixed-line configuration screen may seed an empty base-rate field after its service list reports a resolved total, but it never replaces a populated base rate.

### Non-functional Requirements

- Rate values remain integer minor units at component and action boundaries.
- The resolver is pure and unit-testable.
- Existing localization patterns are used for any new source labels or helper text.
- No schema migration or catalog write is introduced.

## Data / API / Integrations

- `IService.prices` supplies current per-currency rates and `IService.default_rate` supplies the fallback.
- `CatalogPickerItem.currency_rate` supplies the requested contract-currency rate when `ServiceCatalogPicker` receives `currencyCode`; `default_rate` remains available as fallback.
- The fixed wizard may extend its local `fixed_services` draft shape with optional resolved-rate/source metadata. `buildSubmission` must explicitly map fixed services to the existing `ClientFixedServiceInput` shape so UI-only metadata is not submitted.
- Existing actions (`addServiceToContractLine`, contract wizard submission, and fixed-config update) remain the persistence boundaries.
- No database schema, service action contract, or third-party integration changes are required.

## Security / Permissions

Existing billing read/update permissions and tenant-scoped actions remain authoritative. Client-side filters improve the authoring experience but do not replace tenant or permission checks in actions.

## Observability

No new production telemetry is required. Existing action errors remain visible through localized alerts. Tests must make the chosen resolution source explicit so regressions do not silently switch between exact-currency and fallback rates.

## Rollout / Migration

This is an in-place UI behavior change with no migration. Existing contract rates, memberships, catalog prices, and fixed base rates are left untouched. Rollback restores the former manual-entry behavior without requiring data cleanup.

## Open Questions

- None blocking. The product decision for this card is that `default_rate` is an allowed authoring fallback even when the contract has no matching currency row; the UI must label that source honestly and must not manufacture a currency-specific catalog price.

## Acceptance Criteria (Definition of Done)

- An active service with no contract-currency price row but a populated `default_rate` can be added to an hourly or usage contract line without typing the same rate again.
- A matching contract-currency price wins over `default_rate`.
- A service with neither source still requires a manual rate.
- Products are absent from hourly, usage, and bucket-style selectors and remain available in supported fixed/product flows.
- Selecting fixed services proposes the quantity-weighted sum of their resolved rates as the recurring base rate.
- The proposed base rate updates while auto-derived and stops changing after the author edits it.
- Existing/resumed populated fixed base rates are never replaced automatically.
- Fixed lines still cannot be saved with a missing or zero recurring base rate.
- No `service_prices` row is created or modified by these flows.
- Focused unit/component tests and DB-backed membership persistence tests pass, along with the billing package typecheck/test slice selected during implementation.
