# Human review guide: project material record authorization

## Finding

This draft addresses the single high-severity finding from PR #3987: review card `a7238205-5ad8-5947-ad30-b47f9f7549f3`, fingerprint `materialCatalogActions.ts#listProjectMaterials`. The approved implementation plan is [`2026-11-10-authz-in-listprojectmaterials-fix-plan.md`](../plans/2026-11-10-authz-in-listprojectmaterials-fix-plan.md), committed as `ae78bb32e73f206196c964a133358aba4d7d1a20`.

## Inspect first

1. In `packages/projects/src/actions/materialCatalogActions.ts`, inspect `resolveProjectIdForMaterial` and the update/delete action callbacks. Both resolve the tenant-scoped parent project inside the transaction, map missing IDs to the same update permission error as a denied project, authorize the record with the read decision, and pass that same transaction to the inventory library.
2. Inspect billing options, listing, and add: each authorizes inside its transaction before querying or mutating, then passes the same transaction to the inventory library where applicable.
3. Confirm write semantics: `project:update` remains the coarse capability gate, while `assertProjectReadAllowed` uses the published bundle's project `read` decision for record visibility, matching `stagingActions`.
4. Review behavioral assertions in `materialCatalogActions.db.test.ts` for denied-write effects, the legitimate in-scope add/delete paths, and the in-scope update library limitation below.

## Action to fix and evidence map

| Server action | Boundary added | Behavioral evidence |
| --- | --- | --- |
| `getProjectMaterialBillingOptions` | Authorizes inside the existing transaction before the billing config query | Out-of-bundle permission error; in-bundle currency and schedule returned |
| `listProjectMaterials` | Authorizes and lists on one transaction | Out-of-bundle permission error; in-bundle material/rate returned |
| `addProjectMaterial` | Authorizes and adds on one transaction | Denial leaves material rows, billing config, stock and movements unchanged; allowed add consumes stock and exercises stock-low publication |
| `updateProjectMaterial` | Resolves tenant-scoped material parent, authorizes, then updates on the same transaction | Denial preserves rate and billing destination; missing, foreign-tenant, and out-of-bundle IDs return exactly equal permission errors; successful update is unverified because of the existing library query failure below |
| `deleteProjectMaterial` | Resolves tenant-scoped material parent, authorizes, then deletes on the same transaction | Denial preserves row and consumed stock; in-bundle delete succeeds; missing, foreign-tenant, and out-of-bundle IDs return exactly equal permission errors |

## Review limitations and hook behavior

Missing project-material IDs now return the same record-scope permission error as inaccessible projects, rather than the library's material-not-found validation error or a distinct message key. Verify no caller depends on that prior not-found code.

`addMaterial` now registers stock-low publication and serialized asset creation through `registerAfterCommitWithConnection`. The hook receives the live root connection after the owning transaction commits; a rollback discards the hook. The database suite verifies that stock-low publication is observed only after commit, no event or asset is produced after rollback, and the committed asset row and both stock-unit links persist. The publisher is captured by a test mock, so this proves dispatch timing rather than external broker durability; post-commit publication remains best-effort and is not atomic with the database commit.

In-scope `updateProjectMaterial` success could not be verified because the inventory library's existing update query applies `FOR UPDATE` to a left-joined billing-config row; PostgreSQL rejects it with `FOR UPDATE cannot be applied to the nullable side of an outer join`. The wrapper does authorize and call the library on the same transaction, and the out-of-scope denial plus unchanged-row behavior is covered. Fixing the library query is outside this approved action-wrapper change.

## Verification

Focused DB suite: `DB_PASSWORD_ADMIN="$(<secrets/postgres_password)" TEST_DB_NAME=project_material_authz_regression_test node scripts/run-workspace-db-tests.mjs ../packages/projects/src/actions/materialCatalogActions.db.test.ts` (8 tests passed). The inventory suites `materials.db.test.ts` and `staging.db.test.ts` passed (37 tests). Missing, foreign-tenant, and same-tenant out-of-bundle IDs are asserted equal for both write actions, and committed/rolled-back after-commit effects are checked against PostgreSQL. `npm -w @alga-psa/projects run build`, `npm -w @alga-psa/inventory run build`, both package typechecks, and `NODE_OPTIONS=--max-old-space-size=16384 npm -w server run typecheck` passed. Server typecheck needed a larger heap; 4 GB and 8 GB attempts exhausted memory without diagnostics.

Captain approval is required; separate AI verification is not required.
