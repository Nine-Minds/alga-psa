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
| `updateProjectMaterial` | Resolves tenant-scoped material parent, authorizes, then updates on the same transaction | Denial preserves rate and billing destination; missing and foreign-tenant IDs map identically to permission denial; successful update is unverified because of the existing library query failure below |
| `deleteProjectMaterial` | Resolves tenant-scoped material parent, authorizes, then deletes on the same transaction | Denial preserves row and stock state; in-bundle delete succeeds; missing and foreign-tenant IDs map identically to permission denial |

## Review limitations and hook behavior

Missing project-material IDs now return the planned project-update permission error rather than the library's material-not-found validation error. Verify no caller depends on that prior not-found code.

The success case exercises both the stock-low publication path and the serialized asset-link hook. `addMaterial` invokes these hooks after its own `runInTransaction` completes; when supplied the wrapper's transaction, that is before the wrapper transaction commits. The database rollback used by the suite cannot undo an external event or asset operation. The test observes hook invocation, not external-system atomicity or durable delivery. Review whether that existing hook contract is acceptable for this call path.

In-scope `updateProjectMaterial` success could not be verified because the inventory library's existing update query applies `FOR UPDATE` to a left-joined billing-config row; PostgreSQL rejects it with `FOR UPDATE cannot be applied to the nullable side of an outer join`. The wrapper does authorize and call the library on the same transaction, and the out-of-scope denial plus unchanged-row behavior is covered. Fixing the library query is outside this approved action-wrapper change.

## Verification

Focused DB suite: `node scripts/run-workspace-db-tests.mjs ../packages/projects/src/actions/materialCatalogActions.db.test.ts` (6 tests passed with the fix). Running the same suite against the original action wrapper produced failures in out-of-bundle list, add, and delete cases; the old material-ID update path also encountered the pre-existing inventory query error before the authorization result could be asserted. `npm -w @alga-psa/projects run build` and `NODE_OPTIONS=--max-old-space-size=8192 npm -w @alga-psa/projects run typecheck` passed. `NODE_OPTIONS=--max-old-space-size=8192 npm -w server run typecheck` exhausted the Node heap at 8 GB without emitting TypeScript diagnostics; the default-heap run also exhausted memory at 4 GB.

Captain approval is required; separate AI verification is not required.
