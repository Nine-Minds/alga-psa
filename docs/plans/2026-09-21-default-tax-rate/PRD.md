# Default tax rate for clients and the service catalog

Design for internal card **alga-2026-0002527**. Status: proposed implementation plan; no application code implemented. Inspected base: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04`.

## Problem and outcome

A billing administrator needs to configure a regional tax rate once (for example, a configured 10% GST rate) and have new clients, products, and services inherit it. Today client initialization chooses the oldest active rate, some paths omit `is_default`, and catalog creation writes NULL, which billing interprets as non-taxable. Repeated client creation also mutates rate-global tax components.

The outcome is a tenant default referencing an existing regional rate, consistent transactional client initialization, server-side catalog inheritance, and an explicit operation to fill existing catalog NULLs. This is assignment configuration, not a change to statutory tax rules or calculation precedence.

## Scope and decisions

1. Store one nullable `tenant_settings.default_tax_rate_id`. The selected rate supplies its region; do not store a second independently editable default region. Multiple defaults by client geography are outside this card.
2. Do not hard-code 10% or infer a jurisdiction from a customer name, currency, or seeded US rates. The administrator creates/selects the appropriate existing regional rate using the current region/rate editor.
3. A configured default must belong to the tenant, have an active region and rate, and apply on the assignment day (`start_date <= day < end_date`, with NULL end open). Revalidate at assignment, not only at save. An invalid configured default produces an actionable error, never a fallback to an unrelated rate.
4. When unset, retain catalog creation's NULL behavior. For clients only, preserve the shared writer's legacy oldest-active-rate fallback, with deterministic ID tie-break and no synthetic zero-rate creation. No active rate still fails with a setup error. Make this transitional behavior visible in settings help text; clearing the setting does not mean all clients become tax-exempt.
5. Persist the chosen rate at creation. Changing/clearing the tenant setting affects future creation only. Existing explicit client defaults, catalog assignments, exemptions, reverse-charge settings, and tax-source overrides remain authoritative.
6. Catalog create contract: omitted/undefined `tax_rate_id` inherits the default; explicit NULL means non-taxable; a UUID is an explicit override validated in the authenticated tenant. Reject empty-string/invalid IDs rather than using truthiness. Updates retain current omission-means-unchanged behavior. Existing integrations that explicitly send NULL continue to opt out.
7. No automatic global data backfill during schema migration. An administrator may explicitly apply the selected default to existing NULL catalog rows after reviewing the affected records. NULL contains no historical intent, so this operation necessarily includes intentionally non-taxable rows if selected.

## User flows and interface

Target user: MSP billing administrator. Catalog creators consume the saved default without additional setup; API and provisioning callers receive the same behavior.

In the existing Billing dashboard's **Tax Rates** tab, next to tax-source settings and above regions/rates, add a compact **Default tax rate** panel. Provide a region-labelled rate picker displaying percentage and description, an unset option, explanatory help, and Save. Reuse shared UI components, theme tokens, translations, stable element IDs, and billing permissions. Show loading, empty-rate, saved, and invalid-default states. Link/guide the administrator to the existing region/rate editor rather than inventing a GST bootstrap wizard.

Example flow: create an appropriate region and active 10% GST rate; select it as default; save; create a client and a product/service. Both inherit the configured association. Reloading settings shows the saved choice.

Quick-add service/product create forms start with **Use tenant default (GST — 10%)**, plus explicit rate choices and **Non-taxable**. Keep this as a distinct form selection and omit the request field for inheritance, allowing the server to resolve the current setting. Reset after successful creation preserves this default mode. A late settings fetch must not overwrite a user's explicit choice. Product edit mode retains the saved value, including NULL, and never silently inherits.

A separate **Apply to existing products and services…** action previews tenant-local NULL entries with item kind/name and total count. Let administrators exclude entries, then confirm the selected set and named target rate. Explain that this changes future billing taxability and does not rewrite issued invoices. Save alone never applies a backfill. Require billing update plus catalog/service update permission for applying it.

## Code evidence and change map

| Inspected path | Finding and planned change |
| --- | --- |
| `shared/billingClients/taxSettings.ts:39` | Oldest active selection, profile-keyed settings, default association, and per-client component insertion. Introduce a shared resolver and idempotent initializer here or alongside it; export through shared billingClients. Remove component creation and Math.ceil from initialization. |
| `shared/models/clientModel.ts:189` and `:317` | Divergent default writer and swallowed initialization failure. Delegate and propagate required initialization errors within the caller transaction; preserve intentional skipTaxSettings callers. |
| `packages/billing/src/services/taxService.ts` | Both createDefaultTaxSettings and ensureDefaultTaxSettings select oldest active independently. Delegate both; preserve optional billing-profile argument and existing settings. |
| `packages/clients/src/actions/clientActions.ts:607` | Already initializes within client transaction and skips AlgaDesk billing setup. Keep this behavior while adopting resolver. |
| `ee/server/src/lib/integrations/entra/sync/clientProvisioningService.ts:85` | Uses shared helper in provisioning transaction; retain tenant context and rollback behavior. |
| `server/src/lib/api/services/ClientService.ts:379` | Tax setup runs after commit and failures are swallowed. Move initialization into client creation transaction and preserve applicable product exemptions. |
| `packages/billing/src/actions/serviceActions.ts:581` | UI create action collapses omitted/null IDs. Resolve through shared policy inside creation transaction. |
| `server/src/lib/api/services/ProductCatalogService.ts:248`, `ServiceCatalogService.ts:255` | Both API creates collapse omitted/null IDs. Use same resolver; keep existing product prices, currency, and service-type behavior. |
| `packages/billing/src/components/settings/billing/QuickAddService.tsx`, `QuickAddProduct.tsx` | Initial state/reset/payload currently send NULL. Introduce explicit inheritance state only for creates. |
| `packages/billing/src/actions/taxSettingsActions.ts` and `components/billing-dashboard/BillingDashboard.tsx` | Extend settings read; add narrowly scoped default-rate save and preview/apply actions and panel. Existing tax-source writes must not erase default-rate setting, and vice versa. |
| `packages/billing/src/actions/taxRateActions.ts` and region mutation actions | Guard deleting/deactivating/re-regioning or invalidating the date range of a configured default until it is cleared/replaced. Include default-setting dependency in deletion feedback. |
| `shared/billingClients/clientTax.ts:14`, `packages/billing/src/services/taxService.ts:341` | Readers require is_default true and NULL location. Preserve this contract. |
| `packages/billing/src/lib/billing/billingEngine.ts:854` | Catalog rate primarily supplies region/taxability; NULL means non-taxable. Keep engine precedence and verify actual invoice outcomes rather than merely checking IDs. |

Before implementing, search all client/catalog creation callers, importers, schemas, and shared exports to route supported entrypoints through the shared policy and identify callers normalizing omission to NULL. Do not add a database default or trigger that masks explicit input intent.

## Storage, transactions, and backfill

Add a CE migration in `server/migrations/` for the nullable UUID with a composite FK `(tenant, default_tax_rate_id)` referencing `tax_rates(tenant, tax_rate_id)`. Preserve tenant identity; use restrictive deletion, not composite SET NULL. Check actual Citus table distribution/colocation before committing the FK migration and run the migrated-schema tests. No seed selection or data mutation in this migration. Include down migration for the setting/constraint only.

Resolver accepts the caller's Knex transaction and tenant; it must not derive session context or call authenticated server actions. Share rate/region eligibility rules with the settings writer. Use coordinated row locks in assignment, default save, and rate/region mutation paths so a concurrent change cannot leave an invalid newly assigned default. Use one documented lock order and test it. When no settings row exists, safely upsert without overwriting unrelated tenant settings.

Client initialization creates missing billing-profile settings and one client-wide default association (`is_default: true`, `location_id: null`). Serialize by client row for repeat/concurrent calls and respect existing uniqueness constraints. Preserve existing profile overrides/reverse-charge data, location associations, and valid client defaults. When repair is needed, reuse an existing association for the resolved rate where possible; do not indiscriminately update every NULL-location row. A conflicting location-specific association for the same rate must produce an actionable error rather than destroying location intent. Provisioning a second profile must not create a second client default. Initialization must never create, round, or duplicate rate-global components.

Backfill is a tenant-scoped transactional application operation, available only with a valid saved default. Preview returns eligible IDs and the target default ID. Apply revalidates permissions, tenant ownership, target setting, rate validity, and selected eligibility. Reject a stale target default. Update only selected rows still satisfying `tax_rate_id IS NULL`; rows assigned since preview are skipped and counted. Return changed/skipped counts and refresh the preview. Retrying the same selection makes no further changes. Do not pick up newly created NULL rows outside the preview selection. Changing settings and applying backfill are separate actions.

## Delivery sequence

1. Migration, tenant settings types, shared resolver and assignment semantics.
2. Default settings actions/panel and rate/region lifecycle guards.
3. Consolidated client initialization, transactional API integration, profile/idempotency coverage.
4. Catalog UI/API creation paths, schemas, and create/edit form behavior.
5. Preview/apply backfill and tenant/concurrency guards.
6. Focused regression suites and manual end-to-end verification, then implementation review. Board advancement remains with XO.

## Acceptance and verification

See features.json and tests.json for the implementation checklist and targeted coverage. All entries remain false for this design-only delivery.

Required evidence includes real database queries against migrated schema: configured default beats an older competing rate; UI/API/Entra/model-created clients get one visible default; API services/products and both quick-add forms inherit; explicit NULL/UUID and existing edits are preserved; profile retries add no components; backfill affects selected NULL rows only; cross-tenant/permission/stale-setting failures make no unintended writes. Run a representative uncapped, single-rate GST invoice with net 100.00 and assert tax 10.00, then verify exempt and non-taxable cases and external-source behavior. Include fractional-rate coverage to catch the former rounding side effect.

Extend existing DB suites `server/src/test/integration/billing/taxSettingsSharedCreateDefault.integration.test.ts`, `taxSettingsEnsureDefault.integration.test.ts`, and relevant tax service/billing engine suites; add focused action/API/UI coverage where behavior changes. Source-string tests are insufficient for persistence. Manual smoke uses the configured dev server on port 3790 and an isolated fixture tenant; this design session does not mutate the running environment.

## Non-goals

No global 10% seed, geographic tax determination, automatic default per region, tax engine rewrite, retrospective invoice recalculation, changes to tax-source delegation, wholesale reassignment of existing clients or explicit catalog rates, cleanup of historical duplicate components, or unrelated catalog/currency work. Historical client inconsistencies are repaired only when the existing ensure path runs; a tenant-wide client repair campaign is separate.

## Risks, rollout, and remaining checks

- NULL backfill changes future charges and can affect drafts when recalculated. Review selected entries and retain a pre-apply export of affected IDs if operational rollback is needed. Clearing the setting or rolling back schema does not undo assignments; never blindly reset all rows with the same rate ID.
- No jurisdiction/default can be inferred safely. Deployment enables the feature; tenant configuration plus backfill is required to achieve the reported 10% setup.
- The engine can combine eligible regional rates, caps, and exemptions. Selecting a 10% row does not guarantee every invoice is exactly 10%; the acceptance fixture isolates one eligible uncapped rate.
- Expiry can invalidate a configured default without an edit. Show setup errors and require a replacement; automatic scheduled successor-rate selection is out of scope.
- Moving API tax setup into the transaction exposes failures formerly swallowed. Document that creation now fails atomically on invalid/missing required tax setup. Preserve AlgaDesk and explicit skip contracts.
- Legacy fallback remains for unconfigured tenants; removing it is a separate compatibility decision. Unconfigured client creation with no active rate remains an error.
- FK distribution, current renamed constraint names, other direct import writers, and rate/region mutation entrypoints must be verified during implementation. Do not mistake these planned checks for completed runtime validation.
- Public plan intentionally omits customer-identifying source details. No external research or production access was required for this code-grounded design.
