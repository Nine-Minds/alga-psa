# Fix PR 3135 new-tenant AD-to-M365 status mappings

## Outcome

New tenants receive an AD-to-M365 project template whose four status mappings satisfy the PR 3135 typed schema and reference only tenant-owned project-task statuses.

## Scope

Production code changes only in `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs`. Add one DB-backed test at `server/src/test/integration/onboardingAdToM365TemplateStatusMappings.integration.test.ts`.

Do not change migrations, `server/seeds/dev/88_alice_wonderland_project_template.cjs`, or application create/copy writers. The historical all-tenant seed migration at `server/migrations/20251211100001_seed_ad_to_m365_project_template.cjs` must remain unchanged and continue to run before `server/migrations/20260809120000_type_template_status_mappings.cjs` backfills legacy mappings.

## Implementation

1. Extend each object created by `getStatusMappings` in `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs` with:

   ```js
   standard_status_id: null,
   unresolved_status_id: null,
   status_source: 'tenant',
   ```

   Retain `status_id: status.status_id`. Do not infer a standard status from the display name.

2. Add `server/src/test/integration/onboardingAdToM365TemplateStatusMappings.integration.test.ts`. Connect through `createTestDbConnection({ runSeeds: false })` or an equivalent migrated real-PostgreSQL setup that guarantees `server/migrations/20260809120000_type_template_status_mappings.cjs` has run. Create isolated tenant fixtures, load the CommonJS seed modules, and call seed 06 before seed 07.

3. Query the named AD-to-M365 template, its mappings, and joined statuses. Assert:

   - exactly four mappings exist;
   - their joined names are `To Do`, `In Progress`, `Blocked`, and `Done`;
   - every mapping has a non-null `status_id`;
   - every mapping has `standard_status_id` and `unresolved_status_id` equal to null;
   - every mapping has `status_source` equal to `tenant`;
   - every joined status has the target tenant and `status_type = 'project_task'`;
   - identically named statuses in another tenant cannot be selected.

4. Preferably exercise `packages/projects/src/lib/projectTemplateStatusMappingResolution.ts` or `packages/projects/src/services/applyProjectTemplate.ts` against the seeded template. If applying it, create the minimal user, client, and project-status fixtures and assert the resulting project mappings remain tenant-backed. Keep this validation in the same integration test file.

## Edge Cases

- Duplicate status names across tenants must not cross tenant boundaries.
- A missing expected status must fail the exact-four assertion rather than silently passing partial coverage.
- Seed 07's existing-template early return remains unchanged.
- Seed 06's partial-catalog behavior remains unchanged and is not repaired here.
- Test cleanup must account for template phases, tasks, checklist items, mappings, statuses, and tenant dependencies. Prefer a rolled-back transaction only if the onboarding seeds and runtime path work correctly with it.

## Safety and Rollback

This is a forward-looking seed correction with no new migration and no rewrite of existing tenant data. Roll back by reverting the focused seed and test changes. Already-created typed mappings remain valid and should not be deleted. Preserve both historical migration order and the PR 3135 typed backfill.

Keep the unrelated `package-lock.json` modification unstaged and untouched. Stage explicit paths only.

## Verification

Run:

```bash
cd server
npx vitest run src/test/integration/onboardingAdToM365TemplateStatusMappings.integration.test.ts --coverage.enabled=false
```

Optionally run the adjacent typed-mapping suites:

```bash
cd server
npx vitest run src/test/integration/projectTemplateStatusMappingsMigration.integration.test.ts src/test/integration/projectTemplateApplyStatusMappings.integration.test.ts --coverage.enabled=false
```

Validate plan artifacts and patches:

```bash
jq empty docs/plans/2026-08-10-pr3135-new-tenant-status-mappings/features.json docs/plans/2026-08-10-pr3135-new-tenant-status-mappings/tests.json
git diff --check
git status --short
```

Before committing implementation, confirm the staged files explicitly:

```bash
git diff --cached --name-only
```

## Acceptance Criteria

- Seed 07 emits all four explicit tenant-variant fields for each mapping.
- The real-PostgreSQL integration test runs onboarding seeds 06 and 07 after the typed schema.
- The test proves four expected mappings, same-tenant ownership, tenant source, and null standard/unresolved IDs.
- Runtime resolution or template application is validated when practical.
- Existing migrations and already-typed dev/application writers are unchanged.
- Focused tests, `jq empty`, and `git diff --check` pass.
- `package-lock.json` is neither edited nor staged.
