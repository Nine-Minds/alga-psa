# Scratchpad — PR 3135 New-Tenant Status Mappings

- Plan slug: `2026-08-10-pr3135-new-tenant-status-mappings`
- Created: `2026-08-10`

## Decisions

- 2026-08-10: Limit the production change to `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs` and add one real-PostgreSQL integration test.
- 2026-08-10: Write every onboarding mapping as the tenant variant: `status_id` populated, `standard_status_id` null, `unresolved_status_id` null, and `status_source` set to `tenant`.
- 2026-08-10: Preserve the existing migrations. The historical all-tenant migration must remain before the PR 3135 typed backfill.
- 2026-08-10: Treat runtime template application as preferred coverage. Do not broaden production scope if unrelated application fixtures make that assertion impractical.

## Discoveries / Constraints

- 2026-08-10: `ee/server/seeds/onboarding/psa/06_project_task_statuses.cjs` creates `To Do`, `In Progress`, `Blocked`, and `Done` as tenant-owned `project_task` statuses.
- 2026-08-10: `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs` currently writes only the legacy mapping fields, including `status_id`.
- 2026-08-10: `server/migrations/20260809120000_type_template_status_mappings.cjs` adds the typed columns, variant CHECK constraint, tenant/standard foreign keys, and historical backfill.
- 2026-08-10: `server/migrations/20251211100001_seed_ad_to_m365_project_template.cjs` is the historical all-tenant seed migration. Its legacy rows are intentionally handled later by the typed backfill.
- 2026-08-10: `server/seeds/dev/88_alice_wonderland_project_template.cjs` and application create/copy writers already emit typed mappings.
- 2026-08-10: `package-lock.json` contains a pre-existing local change from `npm install`. Do not edit, restore, or stage it.
- 2026-08-10: Local integration runs need the real DB passwords in the environment. The vitest fork cannot run `FileSystemSecretProvider` ("no dynamic import"), and the committed `.env.localtest` sets `DB_PASSWORD_ADMIN`/`DB_PASSWORD_SERVER` to literal `/run/secrets/<name>` paths, so `getSecret` falls back to those literal strings and postgres auth fails. Export the passwords from the gitignored `secrets/` dir as shown below.

## Commands / Runbooks

- Focused integration test: `cd server && DB_PASSWORD_ADMIN="$(cat ../secrets/postgres_password)" DB_PASSWORD_SERVER="$(cat ../secrets/db_password_server)" npx vitest run src/test/integration/onboardingAdToM365TemplateStatusMappings.integration.test.ts --coverage.enabled=false`
- Optional related typed-mapping regression tests: `cd server && DB_PASSWORD_ADMIN="$(cat ../secrets/postgres_password)" DB_PASSWORD_SERVER="$(cat ../secrets/db_password_server)" npx vitest run src/test/integration/projectTemplateStatusMappingsMigration.integration.test.ts src/test/integration/projectTemplateApplyStatusMappings.integration.test.ts --coverage.enabled=false`
- Validate plan JSON: `jq empty docs/plans/2026-08-10-pr3135-new-tenant-status-mappings/features.json docs/plans/2026-08-10-pr3135-new-tenant-status-mappings/tests.json`
- Validate whitespace: `git diff --check`
- Review intended implementation scope: `git diff -- ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs server/src/test/integration/onboardingAdToM365TemplateStatusMappings.integration.test.ts docs/plans/2026-08-10-pr3135-new-tenant-status-mappings docs/plans/2026-08-10-pr3135-new-tenant-status-mappings-plan.md`
- Stage implementation deliberately; never use `git add -A` while `package-lock.json` is modified.

## Rollback / Safety

- Revert the focused seed/test implementation commit if rollback is needed. Valid typed rows already created for tenants require no data rollback.
- Do not roll back or modify `server/migrations/20260809120000_type_template_status_mappings.cjs` for this fix.
- Do not alter `server/migrations/20251211100001_seed_ad_to_m365_project_template.cjs`; migration history must remain immutable.
- Verify staged paths with `git diff --cached --name-only` before every commit.

## Links / References

- `ee/server/seeds/onboarding/psa/06_project_task_statuses.cjs`
- `ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs`
- `server/migrations/20251211100001_seed_ad_to_m365_project_template.cjs`
- `server/migrations/20260809120000_type_template_status_mappings.cjs`
- `server/seeds/dev/88_alice_wonderland_project_template.cjs`
- `packages/projects/src/services/applyProjectTemplate.ts`
- `packages/projects/src/lib/projectTemplateStatusMappingResolution.ts`
- `server/src/test/integration/projectTemplateApplyStatusMappings.integration.test.ts`
- `server/src/test/integration/projectTemplateStatusMappingsMigration.integration.test.ts`

## Open Questions

- None. Application-level validation remains preferred when its setup can stay focused.
