# Technician task upload verification, 2026-11-21

Implementation tested: `1af352592df53ecae44aefc4e6e591f676ce3d8f` on PR #4264.
Both commands ran from `server/` against the isolated
`test_document_actions_authz_4477` database. No active connections to that database
were present before the first run. Authentication uses the repository test harness;
file storage is mocked. Document and association persistence use PostgreSQL.

## Before the repair

Only the task adapter's coarse permission check was temporarily changed from
`project_task` back to `project`, reproducing the prior implementation. The test
and persisted default role grants were unchanged. The adapter was restored in a
`finally` block before the passing run.

```bash
TEST_DB_NAME=test_document_actions_authz_4477 DB_NAME_SERVER=test_document_actions_authz_4477 \
  node ../node_modules/vitest/vitest.mjs run \
  src/test/integration/documentAssociationCrossClient.integration.test.ts \
  -t 'lets the default MSP Technician' \
  --coverage.enabled=false --reporter=verbose --silent=false
```

Exit code: **1**. Output excerpt:

```text
FAIL  |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > lets the default MSP Technician upload to an authorized task without project:update
AssertionError: expected { …(2) } to have property "success" with value true

- Expected:
true

+ Received:
undefined

 ❯ src/test/integration/documentAssociationCrossClient.integration.test.ts:608:20
    606|
    607|     const result = await uploadDocument(form, { userId: mspTechnicianU…
    608|     expect(result).toHaveProperty('success', true);
       |                    ^
    609|     const persisted = await table('documents')
    610|       .where({ created_by: mspTechnicianUserId, document_name: 'techni…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
```

## With the repair

```bash
TEST_DB_NAME=test_document_actions_authz_4477 DB_NAME_SERVER=test_document_actions_authz_4477 \
  node ../node_modules/vitest/vitest.mjs run \
  src/test/integration/documentAssociationCrossClient.integration.test.ts \
  ../packages/documents/tests/documentActions.authorization.contract.test.ts \
  ../packages/documents/tests/documentActionsUploadAssociationsTenantScoped.contract.test.ts \
  ../packages/documents/tests/documentActionsAssociationSearchTenantScoped.contract.test.ts \
  --coverage.enabled=false --reporter=verbose --silent=false
```

Exit code: **0**. All **19 checks across 4 files passed**. Nine are PostgreSQL
behavioral tests; ten are existing source contract checks. The regression evidence
comes from the behavioral tests. No new source-string tests were added.

Behavioral output excerpt:

```text
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > lets the default MSP Technician upload to an authorized task without project:update 87ms 382 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > rolls back folder and document writes and cleans uploaded storage after a late target denial 18ms 384 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > requires document:update for association mutations and parent-document uploads even when read/create are granted 44ms 378 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > scopes search counts and rejects cross-client attach, upload, and removal without persisted changes 193ms 380 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > completes concurrent first uploads through one entity-folder initialization and retains both files 41ms 384 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > keeps task and asset search authorization in SQL at representative scale 11818ms 401 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > restricts client contract mutations to their exclusive client scope while preserving MSP sharing 43ms 407 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > denies asset association writes when record policy denies access despite asset:update 12ms 408 MB heap used
 ✓ |node| src/test/integration/documentAssociationCrossClient.integration.test.ts > document association cross-client authorization > applies document update bundle policy separately from read to association mutations and parent uploads 39ms 400 MB heap used

 Test Files  4 passed (4)
      Tests  19 passed (19)
   Duration  28.84s
```

Scale output, with query plans omitted:

```json
{
  "tasks": {
    "total": 20000,
    "perClient": 10000,
    "authorizedNeedleMatches": 8
  },
  "assets": {
    "total": 20000,
    "perClient": 10000,
    "authorizedNeedleMatches": 8,
    "userOwnershipAssociations": 20000,
    "readRule": "own_or_managed",
    "ownersPerClient": 10000
  },
  "capturedSearchStatements": 12,
  "maxSqlParameters": 16,
  "databaseRowsTransferred": {
    "maxPerSearchStatement": 8,
    "statements": 12
  },
  "applicationResultSizes": {
    "selectivePage": 8,
    "broadCount": 10000,
    "firstPage": 5,
    "laterPage": 5
  },
  "searchTimings": [
    {
      "entityType": "project_task",
      "search": "scale-needle",
      "page": 1,
      "milliseconds": 24
    },
    {
      "entityType": "project_task",
      "search": "scale-",
      "page": 1,
      "milliseconds": 15
    },
    {
      "entityType": "project_task",
      "search": "scale-",
      "page": 2,
      "milliseconds": 16
    },
    {
      "entityType": "asset",
      "search": "scale-needle",
      "page": 1,
      "milliseconds": 83
    },
    {
      "entityType": "asset",
      "search": "scale-",
      "page": 1,
      "milliseconds": 76
    },
    {
      "entityType": "asset",
      "search": "scale-",
      "page": 2,
      "milliseconds": 76
    }
  ],
  "elapsedMilliseconds": 340
}
```

The Technician test checks persisted default grants with the real RBAC evaluator:
`document:create` and `project_task:update` succeed, while `project:update` is
absent. Its production upload action succeeds and persists both document and task
association. The cross-client test separately verifies scoped search counts and
rejected upload, attach, and removal with no persisted changes.

These runs execute server actions directly. A browser walkthrough of the repaired
Technician workflow and captain approval remain pending in human review.
