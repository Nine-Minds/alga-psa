# Contract Template Overhaul & Client Assignment Alignment Plan

## Summary
This plan restructures the contracts domain so that `contracts` and `contract_lines` represent reusable templates, while `client_contracts` and `client_contract_lines` continue to hold tenant-specific instances. The work spans backend schema changes, domain service updates, UI flow adjustments for both the contract template wizard and the client contract wizard, and a data migration to decouple template-only fields from client-specific values.

## Goals
- Treat `contracts` / `contract_lines` as tenant-scoped templates that omit client-specific commercial terms (rates, quantities, bucket settings, etc.).
- Ensure `client_contracts` and `client_contract_lines` own all mutable billing terms and lifecycle metadata used for invoicing.
- Provide a streamlined Contract Template Wizard that mirrors the client contract wizard but skips per-client pricing fields.
- Allow the Client Contract Wizard to bootstrap from a selected contract template, pre-filling compatible sections while prompting for client-specific details.
- Migrate existing data so that all commercial terms live on `client_contract_lines` (with fallbacks for empty values).
- Keep billing engine, reporting, and integrations functional during the transition.

## Non-Goals
- Overhauling the service catalog or invoicing engine beyond required interface changes.
- Introducing new billing models or pricing logic.
- Building multi-tenant contract sharing across different Alga tenants.

## Stakeholders
- Billing & Finance product owners
- Frontend billing dashboard team
- Backend billing platform team
- QA & Test Automation team

## High-Level Timeline
1. **Phase 0 – Discovery & Alignment (1 week)**
2. **Phase 1 – Schema Preparation & Migrations (1.5 weeks)**
3. **Phase 2 – Backend Domain Updates (2 weeks)**
4. **Phase 3 – Frontend Template Wizard & Client Wizard Enhancements (2 weeks)**
5. **Phase 4 – Data Migration & Backfill (1 week)**
6. **Phase 5 – QA, Rollout, & Monitoring (1 week)**

Total estimated duration: ~8.5 weeks including buffer.

---

## Phase 0 – Discovery & Alignment
**Goals:** Validate assumptions about current contracts usage, document edge cases, and align on template vs. client instance semantics.

- Inventory existing tables/fields using DB diagrams and confirm ownership (e.g. `contracts`, `contract_lines`, `contract_line_mappings`, `client_contracts`, `client_contract_lines`, `client_contract_line_service_configurations`).
  - Review Knex migrations in `server/migrations` (start with files containing `contract`/`billing` naming) to capture current columns, composite keys, and sequences on each related table.
  - Map multi-tenant helpers referenced by migrations (e.g., `server/src/lib/db/admin.ts`, `server/src/lib/db/knexfile.ts`, `shared/db/index.ts`) to understand how schema helpers are invoked during tenant provisioning.
  - Document any triggers, row level security policies, and dependent views/materialized views defined in SQL files (see `server/migrations/*cleanup_billing_to_contracts.cjs` and `cleanup_obsolete_email_tables.sql` for precedent).
- Review backend usage patterns:
  - Run `rg "client_contract"` and `rg "contract_lines"` across `server/src/lib/api/services`, `server/src/lib/billing`, and `ee/server/src/lib` to list the service entrypoints, DTOs, and utilities that currently rely on template pricing data.
  - Trace how the REST/Next.js routes obtain contract data (e.g., `server/src/app/api/v1/contracts`, enterprise overrides under `ee/server/src/app/api`) and note which serializers expect price fields on `contracts` vs. `client_contracts`.
  - Summarize how integration and E2E suites seed contract data through helpers in `server/src/test/integration`, `server/src/test/e2e`, and scripts such as `server/scripts/create-tenant.ts` and `server/scripts/seed-templates.js` that provision default billing records.
- Capture UI flows:
  - Walk through `ContractWizard.tsx`, `ContractDetail.tsx`, and billing dashboard routes to catalog inputs that currently bind to template pricing, quantities, or bucket settings.
  - Note feature flags, context providers, and state containers (`Contracts.tsx` wizard state, billing feature flags) that determine whether a template can be selected during client contract creation.
- Produce a conclusive spec doc (append to this plan) enumerating which fields should remain on template tables, including an explicit mapping of “template column → client instance column” plus validation rules for missing data.
- Align with stakeholders on acceptance criteria and rollout checkpoints; schedule reviews with Billing PM, finance, and QA to confirm migration sequencing and sign-off expectations.

### Phase 0 Progress Log (2025-02-14)
- [x] **Inventory current schema surface**
  - `contracts` table stores template metadata today (`contract_name`, `billing_frequency`, activation flags) with tenant-scoped PKs and indexes (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:166-183`).
  - `contract_lines` and supporting config tables retain pricing knobs such as base rates, overtime multipliers, and bucket limits (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:400-936`).
  - Client instance data is split across `client_contracts` (start/end dates, active state) and `client_contract_lines` (per-client assignments with timestamps) (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:240-569`).
  - Multi-tenant enforcement relies on shared `addTenantForeignKey` helper; no triggers or RLS rules are defined for these tables in current migrations (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:1214-1246`).
- [x] **Review backend usage patterns**
  - REST entry points live under Next routes (`server/src/app/api/v1/contracts/route.ts`, `server/src/app/api/v1/contract-lines/*`) backed by `ApiContractLineController`, which exposes CRUD, template copy, and client assignment flows (`server/src/lib/api/controllers/ApiContractLineController.ts:1-210`).
  - `createContractFromWizard` persists pricing, rate tiers, and bucket settings directly onto template tables before seeding client assignments (`server/src/lib/actions/contractWizardActions.ts:80-260`).
  - Reporting and billing pipelines pull amounts from `contract_line_fixed_config`, `contract_line_services`, and fall back to `contract_line_mappings.custom_rate`, so template-vs-instance separation must preserve these call sites (`server/src/lib/reports/definitions/contracts/expiration.ts:60-96`).
  - Test helpers in `server/test-utils/billingTestHelpers.ts:520-640` seed both template and client tables, mirroring production expectations for pricing fields.
- [x] **Capture current UI flows**
  - `ContractWizard` collects client-facing pricing inputs (base rates, quantities, usage rates, bucket overlays) and posts them through `createContractFromWizard`, reinforcing that templates currently own monetary fields (`server/src/components/billing-dashboard/contracts/ContractWizard.tsx:23-210`).
  - Contract list surfaces (`server/src/components/billing-dashboard/contracts/Contracts.tsx:300-360`) and rate dialogs (`server/src/components/billing-dashboard/contracts/ContractPlanRateDialog.tsx:12-72`) expect per-line pricing to be editable on template entities.
- [x] **Template field ownership spec**
  - Captured a column-by-column mapping for core tables plus proposed client-instance counterparts under “Template vs Instance Field Ownership”.
- [ ] **Stakeholder alignment**
  - Schedule finance/QA/billing sync once ownership matrix is stable; confirm rollout checkpoints and validation requirements.

### Template vs Instance Field Ownership
| Table | Column / Concern | Current Role | Proposed Owner | Notes / Follow-ups |
| --- | --- | --- | --- | --- |
| `contracts` | `contract_name`, `contract_description`, `billing_frequency`, `is_active`, timestamps (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:166-227`) | Wizard defaults + feature gating | Template | Keep columns; add `template_metadata` JSON for guidance strings and UI hints. |
| `client_contracts` | `client_id`, `start_date`, `end_date`, `is_active`, `contract_id`, timestamps (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:240-284`) | Client lifecycle | Client instance | Add `template_contract_id` FK + `created_from_template_version` to track template revisions. |
| `contract_line_mappings` | `display_order`, `custom_rate`, timestamps (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:300-345`) | Associates template contracts↔lines & overrides | Mixed | Keep ordering on template. Move `custom_rate` into `client_contract_line_pricing` table keyed by `client_contract_line_id`. |
| `contract_lines` | `contract_line_name`, `description`, `contract_line_type`, `service_category`, activation flags (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:400-468`) | Template scaffolding | Template | Preserve; add `is_template` flag (Phase 1). |
| `contract_lines` | `billing_frequency`, overtime/after-hours columns (`enable_overtime`, `overtime_rate`, etc.) | Currently shared defaults but billable | Client instance | Copy into `client_contract_line_terms` (new) linked to `client_contract_line_id`; template retains optional suggested defaults stored in `contract_line_template_terms`. |
| `contract_line_fixed_config` | `base_rate`, `enable_proration`, `billing_cycle_alignment` (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:470-522`) | Controls fixed-fee pricing | Client instance | Duplicate structure into `client_contract_line_fixed_config`; template table keeps nullable default columns only. |
| `contract_line_services` | `service_id`, `quantity`, `custom_rate` (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:790-838`) | Bundled services + rate overrides | Client instance | Create `client_contract_services` keyed by `client_contract_line_id`; template table keeps `service_id` + `default_role` style metadata (`quantity` -> `default_quantity`, `custom_rate` -> remove). |
| `contract_line_service_configuration` | `configuration_type`, `custom_rate`, `quantity` (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:840-894`) | Service-specific config (Fixed/Bucket/Usage) | Client instance | Introduce `client_contract_service_configuration` keyed by `client_contract_service_id`; template table retains `configuration_type` + optional metadata only. |
| `contract_line_service_bucket_config` | `total_minutes`, `overage_rate`, `allow_rollover` (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:960-1010`) | Bucket sizing & overage pricing | Client instance | New `client_contract_service_bucket_config`; templates store defaults in `contract_line_service_defaults` JSON. |
| `contract_line_service_fixed_config` | `base_rate` (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:1012-1060`) | Fixed rate overrides | Client instance | Move to `client_contract_service_fixed_config`; template retains default guidance. |
| `contract_line_service_hourly_config` | `minimum_billable_time`, overtime multipliers, etc. (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:1062-1114`) | Hourly behavior | Client instance | New `client_contract_service_hourly_config`; template table trimmed to recommended values. |
| `contract_line_service_hourly_configs` | `hourly_rate`, `minimum_billable_time` (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:1116-1152`) | Hourly tier matrix | Client instance | Mirror table `client_contract_service_hourly_tiers` (per `config_id` + rate). Templates keep structural tiers without dollar amounts. |
| `contract_line_service_rate_tiers` | Tier pricing ladder (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:1154-1194`) | Usage tier pricing | Client instance | Move rate fields to `client_contract_service_rate_tiers`; templates retain `min/max_quantity`. |
| `contract_line_service_usage_config` | `unit_of_measure`, `enable_tiered_pricing`, `base_rate`, `minimum_usage` (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:1196-1244`) | Usage pricing baseline | Mixed | Keep descriptive fields (`unit_of_measure`, `enable_tiered_pricing`) on template; relocate `base_rate`, `minimum_usage` to client usage config table. |
| `contract_line_discounts` | Discount linkages (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:896-940`) | Template-level discount association | Mixed | Maintain template associations for suggestion; create `client_contract_line_discounts` for actual applied discounts per client. |
| `client_contract_lines` | `client_id`, `contract_line_id`, `start_date`, `is_active`, timestamps (`server/migrations/20251008000001_rename_billing_to_contracts.cjs:520-569`) | Client assignment roster | Client instance | Add `template_contract_line_id`, `billing_frequency`, `is_customized`, monetary columns or FK out to new pricing tables. |

#### Client Instance Table Additions
- **`client_contract_line_terms`**: (`client_contract_line_id` PK/FK, `billing_frequency`, `enable_overtime`, `overtime_rate`, `overtime_threshold`, `enable_after_hours_rate`, `after_hours_multiplier`). Values copied from `contract_lines` defaults during migration; future writes require these fields for billing engine parity.
- **`client_contract_services`**: (`client_contract_service_id` uuid, `client_contract_line_id`, `service_id`, `quantity`, `rate_cents`, `effective_date`, timestamps). Supersedes `contract_line_services` pricing data for clients; templates keep a slim `contract_template_services` table with `default_quantity`/`default_role`.
- **`client_contract_service_configuration`** tree:
  - `client_contract_service_configuration` (mirrors schema of `contract_line_service_configuration` minus template defaults; keyed by `client_contract_service_id`).
  - `client_contract_service_bucket_config`, `client_contract_service_fixed_config`, `client_contract_service_hourly_config`, `client_contract_service_hourly_tiers`, `client_contract_service_rate_tiers`, `client_contract_service_usage_config` matching existing template tables but referencing `client_contract_service_configuration_id`.
- **`client_contract_line_pricing`**: (`client_contract_line_id`, `source_template_contract_line_id`, `custom_rate_cents`, `source_contract_line_mapping_id`, `notes`). Receives data from `contract_line_mappings.custom_rate`.
- **`client_contract_line_discounts`**: (`client_contract_line_id`, `discount_id`, `applied_rate`, `start_date`, `end_date`) to represent actual discount applications, distinct from template recommendations.
- **`contract_line_template_terms`**: New template companion storing optional defaults for term-related fields stripped from `contract_lines` (mirrors columns added to `client_contract_line_terms` but nullable).

#### Cross-System Considerations
- **Billing engine** (`server/src/lib/billing/billingEngine.ts:409-470`): Update all joins to reference `client_contract_*` tables for pricing, ensuring totals never pull from template columns.
- **Reporting** (`server/src/lib/reports/definitions/contracts/expiration.ts:60-96`, `.../revenue.ts:45-85`): Redirect rate lookups to `client_contract_line_pricing` and corresponding client config tables.
- **Test fixtures** (`server/test-utils/billingTestHelpers.ts:520-640`): Extend helper APIs to seed both template defaults and client-specific pricing, aligned with new schema.
- **Historical data**: For closed contracts, persist original `contract_id`/`contract_line_id` associations via new `template_*` foreign keys to support audits without keeping legacy rate columns on templates.

## Phase 1 – Schema Preparation & Migrations
**Goals:** Add new columns/constraints to support template semantics and prepare for data migration.

- Draft ERD updates showing final relationships.
- Database migrations (Knex + SQL):
  - Add `is_template` boolean flags to `contracts` and `contract_lines` (default `true`, enforced via check to keep backward compatibility during migration).
  - Introduce `template_contract_id` FK on `client_contracts` (nullable) referencing `contracts.id` to track origin template.
  - Introduce `template_contract_line_id` FK on `client_contract_lines` referencing `contract_lines.id`.
  - Create template companion tables (`contract_line_template_terms`, `contract_template_services`, `contract_line_service_defaults`) to store recommended values separated from instance pricing.
  - Add nullable JSONB column `template_metadata` to `contracts` for wizard hints (e.g. recommended payment cadence, notes).
  - Introduce client-instance tables (`client_contract_line_terms`, `client_contract_services`, `client_contract_service_configuration` and child tables, `client_contract_line_pricing`, `client_contract_line_discounts`) mirroring the template schema but keyed to `client_contract_line_id`.
  - Update existing template tables to drop or rename monetary fields:
    - Convert `contract_line_services.quantity` → `default_quantity`, remove `custom_rate`.
    - Remove rate columns from `contract_line_service_*` tables or mark nullable defaults pending migration.
    - Drop `contract_line_mappings.custom_rate` once client pricing table is populated.
- Create forward migration scripts under `server/migrations` (e.g., `YYYYMMDDHHMM_contract_template_overhaul.cjs`), run locally with `npm run migrate`, and document verification queries for teardown.
- Write migration rollback strategy and add to `ee/docs/plans/...` appendix.

**Phase 1 Status – 2025-02-14**
- [x] Drafted initial Knex migration (`server/migrations/20250214090000_contract_templates_phase1.cjs`) that introduces template flags, template metadata JSON, and scaffolds client-specific tables for pricing/config cloning.
- [ ] Update existing migrations/services to remove legacy pricing fields once data migration completes (tracked in Phase 4).
- [ ] Align migration with rip-and-replace approach (no dual-write): adjust contract assignment services once data backfill happens.

## Phase 2 – Backend Domain Updates
**Goals:** Ensure services treat templates as blueprints and client contracts as concrete instances.

- Update repositories/services:
  - `server/src/lib/api/services/ContractService.ts` → expose APIs to manage template contracts (CRUD) without pricing fields.
  - `server/src/lib/api/services/ClientContractService.ts` → accept optional `templateContractId` and clone relevant lines into `client_contract_lines` with new pricing inputs.
  - `server/src/lib/api/services/ContractLineService.ts` → ensure template lines handle service attachment and metadata only.
  - `server/src/lib/billing/billingEngine.ts` and related modules → confirm all billing amounts come from `client_contract_lines`.
- Adjust DTOs/interfaces under `server/src/interfaces/billing.interfaces.ts` to distinguish `ContractTemplate` vs `ClientContract` payloads.
- Implement cloning utilities in `server/src/lib/billing/utils/templateClone.ts` (new file) to copy template scaffolding into client contract context.
- Update validation logic to forbid setting pricing on template endpoints; add API errors.
- Ensure service catalog linkage remains consistent (e.g., `plan_service_configuration` usage if applicable).
- Extend unit/integration tests:
  - New tests in `server/src/test/unit/contracts` verifying template CRUD.
  - Adjust existing tests in `server/src/test/integration/api/storageHandlers.test.ts` and `server/src/test/e2e/api/services.e2e.test.ts` to use client contract rates only.

**Phase 2 Status – 2025-02-14**
- [x] Implemented `cloneTemplateContractLine` utility and integrated it with API and server-action entry points for client contract assignments (`ContractLineService.assignPlanToClient`, client contract apply/add flows). Assignments now populate the new `client_contract_*` tables directly (rip-and-replace path).
- [x] Updated shared interfaces/schemas to expose template linkage fields consumed by the revised services.
- [ ] Update billing engine/report consumers to rely on `client_contract_line_pricing` and related tables (pending once data migration completes).

## Phase 3 – Frontend Template Wizard & Client Wizard Enhancements
**Goals:** Provide UX for managing templates and applying them when creating client contracts.

- Create Contract Template Wizard:
  - New component `server/src/components/billing-dashboard/contracts/ContractTemplateWizard.tsx` based on `ContractWizard.tsx` but omitting rate/quantity inputs.
  - Update routing in `BillingDashboard.tsx` to expose template management section.
  - Add API hooks in `server/src/components/billing-dashboard/contracts/hooks.ts` for template CRUD (`useCreateContractTemplate`, `useUpdateContractTemplate`).
  - Ensure UI surfaces template metadata (line types, services) with ability to add/remove lines and attach services.
- Update existing `ContractWizard.tsx` to support selecting a template:
  - Add initial step that lists templates via new API.
  - On template selection, pre-fill line items, services, default descriptions.
  - Prompt user to enter client-specific pricing/quantities before finalizing.
  - Handle optional template metadata hints (e.g., recommended billing cadence) in the UI.
- Update `ContractDetail.tsx` to show template origin and allow navigation back to template.
- Refresh jest/react-testing-library coverage for wizards (`server/src/components/billing-dashboard/contracts/__tests__/`).

## Phase 4 – Data Migration & Backfill
**Goals:** Move existing pricing data from templates to client contracts and link instances to their originating templates.

- [x] Author migration script in `server/scripts/contract-template-decoupling.ts`:
  - For each `client_contract` referencing a `contract_id`, set `template_contract_id`.
  - For each `client_contract_line`, set `template_contract_line_id`.
  - Copy pricing fields from template tables into new client-instance tables: `contract_line_fixed_config.base_rate`, `contract_line_services.quantity/custom_rate`, `contract_line_service_bucket_config.total_minutes/overage_rate`, hourly configs, usage configs, and discount links.
  - Populate `client_contract_line_pricing` using data from `contract_line_mappings.custom_rate` and fixed-config fallbacks; ensure historical overrides preserved.
  - Null out or remove template pricing columns once client data is populated, leaving only optional defaults.
- Provide dry-run mode and logging (tenant ID, contract ID counts).
- Write verification queries (appendix) to ensure no non-null pricing remains on templates.
- Coordinate deployment window; run migration in staging then production.

## Phase 5 – QA, Rollout, & Monitoring
**Goals:** Validate functionality end-to-end and ensure stability after launch.

- Manual QA checklist:
  - Create new template, apply to new client contract, confirm pricing only captured in client contract.
  - Update template and ensure existing client contracts unaffected.
  - Regression test billing runs/invoice generation.
- Automation updates:
  - Extend Playwright flow `ee/server/src/__tests__/integration/contract-wizard-happy-path.playwright.test.ts` to cover template selection.
  - Update Cypress/Playwright dashboards (if any) to reflect new UI navigation.
- Monitoring:
  - Add logs/metrics in contract creation endpoints to monitor template usage.
  - Add alert if billing engine encounters template pricing (should be null).
- Launch plan:
  - Enable feature flag `billing.contractTemplatesV2` for internal tenants first.
  - Roll out to all tenants after one billing cycle.

## Appendix
- **Schema Change Checklist:**
  - Add Knex migration files covering forward changes and matching rollback scripts.
  - Create SQL migrations for production deployment (`shared/db/migrations/20251020120000_contract_template_overhaul.sql`).
  - Add rollback scripts in `shared/db/migrations/rollback/`.
- **Documentation:**
  - Update `docs/billing.md` and `docs/overview.md` sections on contracts.
  - Add how-to guide under `ee/docs/guides/contract-templates.md` once implemented.
- **Decisions (2025-02-14):**
  - No third-party integrations currently ingest template pricing fields. Code search across `sdk/*`, `shared/**/*`, and enterprise services shows `contract_line_mappings.custom_rate` is only read by internal billing engines, reports, and UI controllers (`server/src/lib/reports/definitions/contracts/*.ts`, `server/src/lib/api/services/ContractLineService.ts`). Safe to migrate pricing without breaking external consumers; document in release notes for partners.
  - Contract template metadata will include a `recommended_services` array (service IDs plus optional notes) alongside UI hint fields in `template_metadata`. Wizard will surface these recommendations when initializing client contracts, while actual service bundling remains client-specific via `client_contract_services`.
