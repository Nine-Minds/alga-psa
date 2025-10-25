# Contract Template Hard Cutover Plan

## Context & Rationale
- The current schema stores template and instance records together (e.g., `contracts.is_template`, template rows inside `contract_lines`), which forces brittle conditionals throughout our codebase and prevents enforcing stricter rules on live contracts.
- Separating template data into purpose-built tables will clarify ownership, improve performance of contract-instance queries, and let us evolve template authoring without risking client contract integrity.
- A decisive cutover—preceded by rehearsal and feature-flagged code—lets us avoid months of dual-write complexity while still giving us checkpoints to compare legacy and new structures before flipping traffic.

## Phase Overview
1. **Preparation** — Requirements capture, dependency analysis, change-freeze planning.
2. **Schema Introduction** — Add the dedicated template tables and helper views without touching production data.
3. **Data Migration Dry Run** — Populate the new tables in staging, validate parity, and refine tooling.
4. **Application Readiness** — Update backend/frontend code to target the new schema behind a feature flag.
5. **Hard Cutover Window** — Execute the live migration, drop legacy columns, and enable the new code paths.
6. **Post-Cutover Validation** — Run regressions, monitor telemetry, and plan clean-up tasks.

## Detailed Steps

### Phase 1 — Preparation
- Audit all surfaces using template flags or metadata (`ContractTemplateDetail`, wizard flows, reporting exports, analytics events).
- Confirm that downstream consumers (BI pipelines, integrations) can tolerate the schema changes or have parallel updates planned.
- Draft communication for internal stakeholders and any customers affected by the maintenance window; align on roles (migration owner, QA lead, comms owner).
- Pick the maintenance window (target off-peak), document rollback strategy (snapshot + restore steps), and freeze competing schema work during that period.

#### Phase 1 Tracker (in progress)
- **Feature inventory (UI + services)**
  - `server/src/components/billing-dashboard/contracts/ContractTemplateDetail.tsx` – parses `template_metadata`, drives inline edit + services editor, and depends on `getContractAssignments`.
  - `server/src/components/billing-dashboard/contracts/Contracts.tsx:300` and `ContractDetailSwitcher.tsx:63` – filter/switch views with `contract.is_template`.
  - `server/src/components/billing-dashboard/contracts/ContractHeader.tsx:106` – badge logic toggled by `contract.is_template`.
  - Server actions: `contractActions.ts` (`getContracts`, `updateContract`, etc.), `contractWizardActions.ts:805-831`, `contractLineAction.ts`, and the new `contractLineRepository.ts` logic all branch on `is_template` or expect template rows inside shared tables.
  - Billing utilities: `server/src/lib/billing/utils/templateClone.ts` reads from `contract_lines`/`contract_line_services` assuming template rows live alongside instance data.
- **Downstream / external consumers**
  - Reporting joins: `server/src/lib/billing/billingEngine.ts:396` uses `coalesce(cc.template_contract_id, cc.contract_id)` to tie invoices back to templates.
  - Data scripts: `server/scripts/contract-template-decoupling.ts` pre-populates `template_contract_id` & `template_contract_line_id`; must migrate to the new tables.
  - API services: `server/src/lib/api/services/ContractLineService.ts:811-823` and related schemas reference template IDs for cloning and validation.
  - Interfaces: `server/src/interfaces/contract.interfaces.ts` expose optional `is_template` and `template_metadata`, impacting consumers (e.g., analytics payloads) once removed.
- **Maintenance window & communication prep**
  - Proposed duration: 60-minute off-peak window (needs coordination with Customer Success + Support).
  - Owners: Migration (Billing Platform), QA (Web), Comms (Customer Ops) – confirm availability one week prior.
  - Rollback assets: capture full database snapshot immediately before the copy; keep previous application build (feature flag off) scripted for quick redeploy.
  - Draft announcements: internal Slack update, statuspage maintenance notice, customer email for managed tenants (templates authoring heavy users).


### Phase 2 — Schema Introduction
- Create new tables: `contract_templates`, `contract_template_lines`, `contract_template_line_services`, `contract_template_line_service_configuration`, `contract_template_line_defaults`, `contract_template_line_terms`, `contract_template_line_fixed_config`, `contract_template_pricing_schedules`, etc., matching the field-level plan.
- Add staging views that mimic the legacy combined layout to simplify parity queries (`legacy_contract_templates_view`, `legacy_template_lines_view`).
- Define foreign keys as `NOT VALID` so we can backfill before enforcing; include indexes mirroring existing query patterns (template ID, tenant, display order).
- Merge these migrations and confirm CI/preview environments apply them cleanly.

#### Phase 2 Tracker (in progress)
- ✅ Added migration `20250107162000_create_contract_template_tables.cjs` introducing dedicated template tables (templates, lines, mappings, services, configuration variants, defaults, terms, fixed config, pricing schedules) with `NOT VALID` foreign keys and supporting indexes.
- ✅ Created comparison views `contract_template_compare_view` and `contract_template_lines_compare_view` to contrast legacy rows with the new schema during validation.
- ✅ Validated the migration via `npm run migrate:ee`, confirming views build successfully after joining `contract_line_template_terms` for missing legacy columns.
- ✅ Added backfill migration `20250107164500_backfill_contract_template_tables.cjs` to copy existing template data into the new tables (idempotent inserts) so subsequent phases can rely solely on the separated schema.
- ✅ Updated server actions/models/UI to read/write via the new template tables (contract actions, wizard flows, line mappings, dashboards) eliminating dependency on `contracts.is_template` for template CRUD. (Follow-up: finish decoupling clone utilities from legacy tables.)

#### Phase 3 Tracker (in progress)
- ✅ Introduced `server/scripts/verify-template-migration.ts` (Knex-based parity checker) to compare legacy `contracts` template data against the new `contract_template_*` tables per tenant (counts + name diffs). Usage:
  ```bash
  cd server
  NODE_ENV=migration npx tsx ./scripts/verify-template-migration.ts
  ```
- ✅ Executed the validation script locally; parity check passed. Next run it against a staging snapshot before the hard cutover window.

### Phase 3 — Data Migration Dry Run
- Build idempotent scripts (Knex tasks or SQL plus node runner) that:
  - Extract template rows from legacy tables based on `is_template`.
  - Copy line/service/config rows into their new homes, preserving UUIDs where possible.
  - Record mapping tables for contracts and lines (`legacy_contract_id → template_id`, etc.).
- Run the scripts against a staging database cloned from production. Compare:
  - Row counts per table.
  - Aggregations (lines per template, services per line, tag counts).
  - Spot-check sample templates (metadata, guidance, pricing schedules).
- Iterate until the dry run produces zero discrepancies aside from intentional clean-up (e.g., orphaned services that should be dropped).
- Document runtime expectations and resource usage to size the production window.

### Phase 4 — Application Readiness
- Introduce new models/repos (`ContractTemplate`, `ContractTemplateLine`, etc.) and update server actions (`contractActions`, `contractLineAction`, repository helpers) to read/write via those models.
- Adjust TypeScript interfaces to split `IContractTemplate` from `IContract` (instances), updating UI components and hooks accordingly.
- Skip feature-flag gating (new template flow becomes the default) while ensuring fallbacks are removed.
- Update migrations that create sample data/fixtures, ensuring test suites build valid templates in the new schema.
- Expand automated tests: template CRUD, assignment dashboards, contract creation wizard, and reporting queries.

#### Phase 4 Tracker (in progress)
- ✅ Server actions now create and maintain template data directly in `contract_template_*` tables (template wizard, inline mapping, deletion) without legacy feature flags.
- ✅ `contractTemplate`/`contractTemplateLine` pathways deliver display order + metadata via new models (detail views and mapping lookups).
- ✅ Contract wizard snapshot/query paths read from `contract_template_*` tables.
- ✅ Added parity-check script to plan; new flows validated locally (phase 3).
- ✅ Template line add/remove UX now drives the updated actions (no feature flags) and client wizard cloning reads exclusively from `contract_template_*` data.

### Phase 5 — Hard Cutover Window
- Place the app into maintenance mode at window start; block writes via load balancer rules or database-level toggles.
- Take a full database snapshot/backup for rollback.
- Execute the migration scripts on production:
  - Run the final data copy leveraging the validated scripts.
  - Update foreign keys in client contract tables to reference the new template tables.
  - Remove template rows from legacy tables and drop template-only columns/flags.
  - `ALTER TABLE ... VALIDATE CONSTRAINT` to enforce referential integrity.
- Deploy the feature-flag-enabled application version (flag on) and run smoke tests while still in maintenance mode: template detail load, inline edit, contract creation wizard template selection, reporting queries.
- If tests pass, exit maintenance mode and re-enable user traffic.

### Phase 6 — Post-Cutover Validation
- Monitor logs, error dashboards, and database metrics for 24–48 hours with heightened alerting on contract and billing flows.
- Run targeted regression suites (Playwright, RTL, backend integration) against production or a production clone populated post-cutover.
- Communicate status updates to stakeholders, including any follow-on tasks discovered during validation.
- Schedule clean-up stories: drop temporary views/mapping tables, remove feature flag scaffolding, and update BI/integration documentation with the new schema diagrams.

## Risks & Mitigations
- **Migration Errors** — Mitigate with thorough dry runs, mapping-table audits, and a ready-to-execute rollback snapshot.
- **Extended Downtime** — Keep scripts optimized, rehearse runbooks, and assign owners for each step to minimize time in maintenance mode.
- **Blind Spots in Application Updates** — Use feature flags plus extended automated coverage to vet new code paths before the cutover; have rollback builds prepared.
- **Stakeholder Confusion** — Communicate timelines and status proactively; provide clear post-cutover guidance for support/ops teams reviewing contract data.

## Success Criteria
- Template CRUD and guidance management operate exclusively on the new tables with zero fallback to legacy columns.
- Client contract creation and synchronization correctly reference templates through the new foreign keys.
- Reporting, assignment summaries, and service management show no data regressions (verified via automated and manual checks).
- Legacy template columns (`contracts.is_template`, `contracts.template_metadata`, etc.) are fully removed, and documentation reflects the new architecture.
