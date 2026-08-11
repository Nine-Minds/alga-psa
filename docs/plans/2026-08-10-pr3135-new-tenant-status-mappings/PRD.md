# PRD — PR 3135 New-Tenant Status Mappings

- Slug: `2026-08-10-pr3135-new-tenant-status-mappings`
- Date: `2026-08-10`
- Status: Planned

## Summary

Make the Active Directory to Microsoft 365 onboarding template write typed tenant-status mappings for tenants created after the PR 3135 schema change. Add a real-PostgreSQL integration test that runs the two onboarding seeds in their production order and verifies the persisted mapping shape.

## Problem

PR 3135 introduced typed variants for `project_template_status_mappings`. The onboarding status seed creates four tenant-owned project-task statuses, but the following AD-to-M365 template seed still writes the legacy mapping shape. On a database with the typed CHECK constraint, a newly provisioned tenant can therefore fail while inserting the template mappings or receive mappings that do not identify their tenant source explicitly.

## Goals

- Persist the four AD-to-M365 template mappings as typed tenant-status references.
- Prove that onboarding seeds 06 and 07 work in sequence against the migrated PostgreSQL schema.
- Prove that every seeded mapping references a project-task status owned by the same tenant.
- Keep the existing historical migration and already-typed writers unchanged.
- Preferably prove that the seeded template can pass runtime resolution and be applied successfully.

## Non-goals

- Change `server/migrations/20251211100001_seed_ad_to_m365_project_template.cjs` or any other migration.
- Repair existing tenants; PR 3135's typed migration already backfills historical rows.
- Change `server/seeds/dev/88_alice_wonderland_project_template.cjs`.
- Change template create, copy, replacement, or application writers, which already use the typed model.
- Change UI, API contracts, status catalogs, or onboarding seed order.

## Users and Primary Flows

During new-tenant provisioning, AlgaPSA runs `ee/server/seeds/onboarding/psa/06_project_task_statuses.cjs` and then `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs`. Seed 06 creates `To Do`, `In Progress`, `Blocked`, and `Done` for that tenant. Seed 07 finds those rows and creates the AD-to-M365 template with four mappings whose source is `tenant`.

## UX / UI Notes

No UI changes are required. The observable result is that a new tenant receives a usable AD-to-M365 project template without a schema constraint or foreign-key failure.

## Requirements

### Functional Requirements

1. In `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs`, each of the four mapping inserts must include `status_id` from the matched tenant status, `standard_status_id: null`, `unresolved_status_id: null`, and `status_source: 'tenant'`.
2. No production file other than that seed may change.
3. Add `server/src/test/integration/onboardingAdToM365TemplateStatusMappings.integration.test.ts` as the only new production test file.
4. The integration test must use `createTestDbConnection` and real PostgreSQL with migrations applied through `server/migrations/20260809120000_type_template_status_mappings.cjs`.
5. The test must create an isolated tenant, invoke the exported `seed` functions from onboarding seeds 06 and 07 in order, and query the resulting database rows.
6. The test must assert exactly four mappings for the AD-to-M365 template and cover `To Do`, `In Progress`, `Blocked`, and `Done` through their referenced statuses.
7. Every mapping must have `status_source = 'tenant'`, a non-null `status_id`, and null `standard_status_id` and `unresolved_status_id`.
8. Every referenced status must belong to the test tenant and have `status_type = 'project_task'`.
9. If practical within the focused integration test, resolve or apply the seeded template through the production runtime and assert that it creates usable tenant-backed project status mappings without unresolved references.

### Non-functional Requirements

- Keep the test deterministic and isolated from ambient tenant data.
- Clean up all created rows or contain them in a rolled-back transaction when the called runtime supports it.
- Do not replace the DB-backed assertions with source-string checks or mocks.
- Preserve seed 07's existing idempotent early return when the template already exists.

## Data / API / Integrations

The change affects `project_template_status_mappings`. A valid tenant variant has this shape:

```text
status_id: <same-tenant statuses.status_id>
standard_status_id: null
unresolved_status_id: null
status_source: tenant
```

The existing `project_template_status_mappings_variant_shape_check` and composite tenant-status foreign key remain authoritative. There is no API contract change.

## Security / Permissions

The same-tenant ownership assertion is a data-isolation requirement. Seed 07 must use the tenant-scoped database wrapper and must not bind a mapping to a status owned by another tenant, including when status names match.

## Rollout / Migration

Deploy the seed update and regression test normally. Do not edit or replace `server/migrations/20251211100001_seed_ad_to_m365_project_template.cjs`: it is the historical all-tenant migration and runs before the PR 3135 typed backfill. Do not add a new migration. New tenants receive the corrected shape from onboarding; existing rows remain governed by `server/migrations/20260809120000_type_template_status_mappings.cjs`.

Rollback is a normal revert of the seed and test commit. The production edit only affects future seed executions. Reverting does not delete or rewrite templates already created with valid typed mappings. Before rollback, confirm that no environment depends on provisioning new tenants against the typed schema, because the legacy insert shape can violate its CHECK constraint.

## Risks and Edge Cases

- Another tenant may have statuses with identical names. Tenant-scoped lookup and ownership assertions must prevent cross-tenant selection.
- Seed 06 skips creation when any project-task status already exists. The focused happy path must use a clean tenant; a partial pre-existing catalog remains existing seed behavior and is outside this fix.
- Seed 07 skips all writes when the named template already exists. The test should avoid accidental name collisions and may assert idempotency if it can do so without diluting the core regression.
- A missing expected status causes seed 07 to omit its mapping. The exact-four assertion detects this regression.
- Runtime application needs required client, user, and project-status fixtures. If that setup makes the focused test brittle, runtime resolution may be asserted instead and full application remains preferred follow-up coverage.

## Open Questions

None. Runtime template application is preferred but not required if its unrelated fixture requirements would obscure the seed regression.

## Acceptance Criteria (Definition of Done)

- `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs` writes all four explicit typed tenant fields.
- `server/src/test/integration/onboardingAdToM365TemplateStatusMappings.integration.test.ts` runs seeds 06 and 07 against real PostgreSQL after the PR 3135 typed schema.
- The test asserts exactly four mappings, expected status names, same-tenant status ownership, `status_source = 'tenant'`, and null standard/unresolved IDs.
- The test includes template runtime resolution or application validation when practical.
- The historical all-tenant migration, dev seed, and application create/copy writers are unchanged.
- The focused integration command passes.
- `jq empty` passes for `features.json` and `tests.json`.
- `git diff --check` passes.
- Only the intended production seed, new integration test, and plan artifacts are included in the eventual implementation change.
