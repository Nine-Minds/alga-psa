# Scratchpad

## Decisions
- Use separated product bootstrap directories for Temporal onboarding seeds.
- PSA keeps the existing full seed content.
- Algadesk gets minimal roles and permissions to avoid visible PSA concepts in onboarding/settings.
- Client portal role names remain `Admin` and `User` for compatibility with existing portal invitation lookups.

## Discoveries
- `TenantCreationInput.productCode` already exists.
- `tenantCreationWorkflow` already passes productCode to `createTenant`.
- `createTenantInDB` already writes `tenants.product_code`.
- `run_onboarding_seeds(tenantId)` is product-blind and reads all `.cjs` files from one onboarding seed directory.
- Current PSA seed set includes visible roles/permissions for billing, invoices, projects, service catalog, workflows, and other PSA-only concepts.

## Validation commands
- `cd ee/temporal-workflows && TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1 npm run test -- src/db/__tests__/product-bootstrap-resolver.test.ts src/workflows/__tests__/tenant-creation-product-bootstrap.contract.test.ts`
- `cd ee/temporal-workflows && npm run type-check`

## Implementation notes
- Existing PSA seed files moved under `ee/server/seeds/onboarding/psa/` without content changes.
- New Algadesk seed files live under `ee/server/seeds/onboarding/algadesk/`.
- Temporal Docker copies the full `onboarding` directory, so both product seed directories are included by the existing copy step.
- `createTenantInDB` now validates provided product codes with the same resolver before writing `tenants.product_code`, so unsupported runtime input fails before DB insert.
