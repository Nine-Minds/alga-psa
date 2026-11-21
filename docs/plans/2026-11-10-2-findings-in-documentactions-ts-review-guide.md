# Human review guide — document association authorization

Plan followed: [2026-11-10 fix plan](./2026-11-10-2-findings-in-documentactions-ts-fix-plan.md), committed as `9ff538d5cb`.

## Review repair — default Technician task uploads

**Cause.** The `project_task` association target adapter used `project` as its RBAC
resource, so the shared transaction boundary required `project:update`. The default
MSP Technician has `document:create` and `project_task:update`, but no `project:update`.

**Repair.** The adapter now checks `project_task:update` for task association writes.
It still resolves the task through its owning phase and project and evaluates the
owning project's update record policy, including applicable client and bundle scope.
The shared transaction-scoped boundary remains authoritative for upload, association
creation, and association removal. The SQL-scoped search adapter was not changed.

**New behavioral regression.** `server/src/test/integration/documentAssociationCrossClient.integration.test.ts`
now provisions the canonical PSA default roles using the repository's role-grant
catalog and reconciliation helper. It attaches an MSP user to the persisted default
Technician role, reads the role's grants from `role_permissions` and `permissions`,
and explicitly verifies `document:create` and `project_task:update` are present while
`project:update` is absent. The test invokes the production `uploadDocument` action
for a task whose project is authorized, then checks that both the document row and
the `document_associations` row persisted. This test fails with the prior adapter
because its target check asks for the absent `project:update` grant.

The new regression is separate from the existing cross-client upload denial case.
That case continues to assert that a rejected upload leaves no document, task
association, or target folder state. Existing create/remove association checks and
the shared document/target authorization contract checks remain in the focused run.

**Evidence status.** The earlier guide's recorded 18-test result, search scale
measurements, and package checks apply to the original implementation revision
`9ff538d5cb`, not this repair. Fresh automated results for this repair are listed
below. On the current local repair working tree, the focused PostgreSQL integration
and three contract suites passed: 19 tests across 4 files. The Technician regression
used the persisted default Technician role and the real authorization RBAC evaluator;
its upload produced both the document and task association. Cross-client denied
uploads left no document, association, or target folder. The SQL scope/scale case
also passed with 20,000 tasks, 20,000 assets, and 20,000 ownership associations;
search used at most 16 SQL parameters and transferred at most 8 root rows per query.
The exact command and package/server check results are recorded in the repair
completion section below. No browser session, screenshots, recordings, or fresh manual
observations were produced for this repair: the app server was intentionally kept
stopped. Manual review should use the current PR head and the following workflow.

**Rechecked on 2026-11-21 at `1af352592df5`.** The Technician regression failed
with only the old permission check restored (1 failed, 8 skipped; exit 1). With the
repair restored, all 19 checks passed (9 database behavioral tests and 10 existing
contract checks; exit 0). [Commands and output excerpts](./2026-11-10-2-findings-in-documentactions-ts-technician-verification.md)
record the before/after result and cross-client denial coverage.

### Manual default Technician workflow

1. Use the default MSP **Technician** role. Confirm it grants `document:create` and
   `project_task:update` and does not grant `project:update`.
2. Open an existing project task that the Technician is authorized to update under
   the applicable project/client policy.
3. Upload a small text file from the task's document/attachment control.
4. Confirm the upload succeeds, the document appears on that task, and the stored
   document has one `project_task` association to the task.
5. As a Client A portal user, attempt an upload or association to a Client B task.
   Expect denial. Verify there is no new document or association and no folder was
   created for the denied target. Confirm Client B cannot see the attempted file.

The automated regression now proves steps 1–4 through the production upload action
and database persistence. The existing cross-client integration case proves step 5's
denial and no-write outcome. All manual/browser steps remain awaiting execution; do
not treat earlier QA-admin success as evidence of Technician compatibility.

### Repair completion checks

The following focused database command passed on the repair working tree using the
isolated `test_document_actions_authz_4477` database (confirmed with no active
connections before the suite bootstrapped it):

```bash
cd server
TEST_DB_NAME=test_document_actions_authz_4477 DB_NAME_SERVER=test_document_actions_authz_4477 \
  node ../node_modules/vitest/vitest.mjs run \
  src/test/integration/documentAssociationCrossClient.integration.test.ts \
  ../packages/documents/tests/documentActions.authorization.contract.test.ts \
  ../packages/documents/tests/documentActionsUploadAssociationsTenantScoped.contract.test.ts \
  ../packages/documents/tests/documentActionsAssociationSearchTenantScoped.contract.test.ts \
  --coverage.enabled=false --reporter=verbose --silent=false
```

It passed 19 tests across 4 files, including cross-client upload denial, association
create/remove, rollback, concurrent folder creation, document policy, contract and
asset policy cases; the new default Technician persistence case; and task/asset SQL
ownership and scale coverage. The documents and shared package typechecks and
documents build passed. The full server typecheck passed with
`NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck --workspace=server`.
No app server was started, so all manual/browser review steps remain pending.

## Finding 1 — association search disclosed cross-client records and counts

**Confirmed vulnerable path.** `searchDocumentAssociationEntities` had a tenant-wide `document:read` gate, then each entity branch counted and paged tenant rows without checking the caller's entity permission or client/record scope. A client user could search by another client's task, ticket, or client name and receive both identifiers/labels and a tenant-wide count.

**Repair.** The target adapter in `shared/lib/documentAssociationTargetAuthorization.ts` checks entity read permission and scopes every supported search branch before count cloning and pagination. Ticket filtering uses the shared SQL portal visibility predicate, so client and board/contact scope applies in the query that supplies both rows and count. Contracts and quotes use `billing` permissions; opportunities use `opportunities`. Internal MSP principals retain cross-client results subject to the actual entity permissions. The same entity-to-client ownership mapping feeds document relationship authorization in `shared/lib/documentAuthorization.ts`.

**Behavioral regression and observed result.** `server/src/test/integration/documentAssociationCrossClient.integration.test.ts` seeds two clients, records across the affected search branches, and a visibility group with allowed and blocked ticket boards. Faithful permission grant sets exercise entity RBAC. The DB-backed cases assert cross-client records and counts are hidden, blocked-board tickets do not affect results or counts, and visible-board pagination keeps the scoped total. An MSP granted `billing` and `opportunities` permissions can search contracts, quotes, and opportunities.

### Task and asset query performance repair

Task and asset searches now apply record authorization through the authorization kernel's SQL relationship-template compiler. `project_task` applies the `project:read` bundle rules and the client `same_client` predicate to the owning project join. A task with no owning project is excluded, matching the project authorizer. Asset search applies `asset:read` bundle rules and client scope to the asset query. Asset `assigned`, `own`, and `same_team` rules use correlated `EXISTS` predicates over tenant-scoped `asset_associations`. `own` and the asset record resolver both use the first user association ordered by entity ID, so owner checks are deterministic. The same scoped query is cloned for the distinct count and the paged result, so the database filters before either operation. Search terms, ordering, and offsets remain on the original entity queries.

The database-backed regression covers authorized and unauthorized tasks and assets with matching search terms, scoped counts, and first and later pages. Task search runs with an `own` project rule paired with `hide_sensitive_fields`; it excludes an unowned same-client task. Asset search compares SQL results to `isAssetReadAllowed` decisions for `own`, `own_or_assigned`, and `own_or_managed`, each paired with `hide_sensitive_fields`. The fixture covers an asset owned by another user but assigned to the caller, an asset owned by the caller, a cross-client asset, and an unassigned asset whose ID equals the caller's user ID.

The scale case inserts 20,000 tasks and 20,000 assets, split evenly between two clients. It also inserts 20,000 asset user-association rows: 10,000 assets owned by each client's user. The scale asset search runs under `own_or_managed`, with no managed users, so the authorized set comes from relational ownership. Eight authorized and eight unauthorized rows match the selective term, and those rows occupy the final fixture IDs and insert batch. It checks the authorized eight-result selective search, the broad scoped count of 10,000, and two five-row pages for each entity type.

Run the database-backed regressions and collect scale output with an isolated database:

```bash
cd server
TEST_DB_NAME=test_document_actions_authz_4477 DB_NAME_SERVER=test_document_actions_authz_4477 \
  node ../node_modules/vitest/vitest.mjs run \
  src/test/integration/documentAssociationCrossClient.integration.test.ts \
  ../packages/documents/tests/documentActions.authorization.contract.test.ts \
  ../packages/documents/tests/documentActionsUploadAssociationsTenantScoped.contract.test.ts \
  ../packages/documents/tests/documentActionsAssociationSearchTenantScoped.contract.test.ts \
  --coverage.enabled=false --reporter=verbose --silent=false
```

On the recorded local run, all 18 tests passed: the original 7 association integration tests, the new scale integration test, and 10 authorization contract tests. The scale test captured 12 entity-search statements. The maximum was 16 SQL parameters across counts and pages, independent of the 20,000-row candidate population. Query-response instrumentation observed at most 8 rows transferred for any entity-search statement. Counts transferred one scalar row, and page queries transferred at most 8 matches. The application received an eight-row selective result, a scalar count of 10,000, and pages of five rows; it did not receive candidate IDs. Search calls took 16–85 ms each in this run. The broad scoped count plans completed in 5.989 ms for tasks and 36.486 ms for assets, with 397 and 100,496 shared buffer hits respectively.

`EXPLAIN ANALYZE` used `project_tasks_tenant_phase_id_project_status_mapping_id_order_k` for task-to-phase scans and `idx_assets_tenant_client_contact` for tenant/client asset scans. Asset owner and assignment checks used index-only scans on the existing `asset_associations_pkey`; those correlated scans account for most of the 100,496 shared buffer hits in the asset plan. Client lookups used `clients_client_id_unique`. The plan demonstrates that the current keys support these predicates, so this repair adds no migration. Timings and plans describe this local database run and are not production performance guarantees.

The scale test emits exact timings, parameter counts, result sizes, and query plans under the `DOCUMENT_ASSOCIATION_SEARCH_SCALE` label. It also verifies that task and asset results from the first two broad pages belong to Client A, and checks selective matches whose IDs are beyond the initial fixture range.

## Finding 2 — association writes accepted unauthorized targets

**Confirmed vulnerable path.** `uploadDocument` accepted caller-supplied target IDs after a general `document:create` grant, while `createDocumentAssociations` and `removeDocumentAssociations` authorized only the document set. A client could attach to or detach from another client's entity; client uploads are client-visible, so the new association could expose the file to the target client's portal.

**Repair.** The shared target adapter resolves and authorizes target records inside the same transaction as association writes. Mutation checks require `document:update` and evaluate the document relationship/bundle policy for the `update` action; the document target adapter does the same. Parent-document uploads pass through this update gate. Upload performs an early authorization check, then rechecks inside the final transaction; entity-folder provisioning, folder visibility lookup, document insertion, and associations now share that transaction. If late authorization or a later write fails, database state rolls back and the uploaded storage object is cleaned up. Supported association kinds include the picker entities and the additional entity types accepted by the association API; unknown types fail closed.

Asset targets also require the existing asset record-read policy after coarse `asset:update` permission. Contract target checks confirm a `contracts` row exists. Client mutations additionally require every assigned client to match the caller's client, using the same ownership resolver as document reads. A contract document reaches all assigned clients, so checking only for one matching assignment would allow cross-client injection through a shared contract. MSP principals may target existing shared or unassigned contracts. Both folder provisioning helpers use conflict-safe inserts inside the upload transaction so a duplicate folder race does not leave PostgreSQL's transaction aborted.

**Behavioral regression and observed result.** The same integration case verifies:

- Client A's upload to Client B's task is denied; no document, association, or folder row is added.
- Client A cannot create or remove an association on Client B's task; persisted association rows remain unchanged.
- A Client B document cannot be associated with Client A's authorized task, preserving document-level authorization.
- Client A can create/remove an association to its own task, and the MSP can associate Client A's document with Client B's task.
- The MSP can upload a document to Client B's task and the document plus association persist.
- The attempted cross-client upload does not appear in Client B's `getClientDocuments` result.
- With `document:read` and `document:create` but without `document:update`, Client A can read the existing document but create/remove association and parent-document upload requests are denied without state changes.
- If a task changes client scope after the upload's early check and storage upload, the final transaction denies the upload; no folder, document, or association persists, and `deleteFile` is called for the uploaded object.
- The search test verifies visible and blocked ticket boards, scoped count values, and two-page pagination. MSP contract, quote, and opportunity search and association operations succeed with faithful grants.
- With `asset:update` granted but an asset `same_team` record policy denying access, both association creation and removal are denied; removal preserves the persisted row.
- A client with coarse document read/update permissions can read a document, but a document `update` bundle rule denies association creation/removal and parent-document upload with no persisted changes.
- An MSP can associate to an existing unassigned contract; a nonexistent contract target is denied.
- Client A can create and remove associations on its exclusive contract, but cannot create, upload, or remove documents on a contract assigned to both A and B. Denied operations leave associations and folders unchanged and do not upload storage. Client B cannot read the attempted injection. An MSP can deliberately share the document through that contract, after which Client B can read it; client removal remains denied. This regression failed on `9103399b93` because client association creation returned `{ success: true }`.
- Two first uploads contend with an uncommitted folder initializer. The test observes both uploads blocked on the initializer's unique folder keys in PostgreSQL before releasing it, guaranteeing a real insert conflict. Both uploads complete; their documents, task associations, four default folders, and external storage rows persist, and uploaded files are not cleaned up on success.

The isolated command above passed all 8 association integration tests and 10 existing authorization contract tests (18 total).

`npm run typecheck --workspace=@alga-psa/documents`, `npm run typecheck --workspace=@alga-psa/shared`, and `npm run build --workspace=@alga-psa/documents` passed. `git diff --check` passed. The app server was not started.

The full server typecheck passed with `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck --workspace=server`. Earlier attempts exhausted their 4 GB and 8 GB heaps; use the 12 GB setting for this checkout.

## Review first

1. Inspect the permission-resource mapping, contract existence and complete client audience checks, asset record policy, and shared ticket SQL scope in `shared/lib/documentAssociationTargetAuthorization.ts`.
2. Inspect update-action authorization in `assertAuthorizedDocumentSetForMutation`, the document target adapter, and the parent-document upload path; check the read-allowed/update-denied regression.
3. Trace both folder helpers' conflict-safe inserts and the concurrent-upload regression, then verify folder, document, association, and storage outcomes.
4. Review the permission-grant fixtures and persisted outcomes in `server/src/test/integration/documentAssociationCrossClient.integration.test.ts`.

## Uncertainty / unverified behavior

- The integration case verifies the corrected billing/opportunities permission resources behaviorally, but does not seed every supported association target type.
- `getDocumentsByEntity` and `getDocumentCountsForEntities` remain outside this plan's requested read-surface scope, as identified in the approved plan.
