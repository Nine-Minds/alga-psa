import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ensureWorkflowRuntimeV2TestRegistrations } from '../helpers/workflowRuntimeV2TestHelpers';
import { importWorkflowBundleV1 } from 'server/src/lib/workflow/bundle/importWorkflowBundleV1';

let db: Knex;

beforeAll(async () => {
  ensureWorkflowRuntimeV2TestRegistrations();
  db = await createTestDbConnection();
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow bundle v1 import/export', () => {
  it('rejects unsupported formatVersion with a clear error', async () => {
    await expect(
      importWorkflowBundleV1(db, {
        format: 'alga-psa.workflow-bundle',
        formatVersion: 999,
        exportedAt: new Date().toISOString(),
        workflows: []
      })
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT_VERSION'
    });
  });

  it('rejects invalid bundle JSON that fails the v1 schema with a helpful error', async () => {
    await expect(
      importWorkflowBundleV1(db, {
        format: 'alga-psa.workflow-bundle',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        workflows: []
      })
    ).rejects.toMatchObject({
      code: 'SCHEMA_VALIDATION_FAILED'
    });
  });

  it('fails with structured missing-dependency errors when required actions/node types/schemas are absent', async () => {
    await expect(
      importWorkflowBundleV1(db, {
        format: 'alga-psa.workflow-bundle',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        workflows: [
          {
            key: 'test.missing-deps',
            metadata: {
              name: 'Missing deps',
              description: null,
              payloadSchemaRef: 'payload.TestPayload.v1',
              payloadSchemaMode: 'pinned',
              pinnedPayloadSchemaRef: 'payload.TestPayload.v1',
              trigger: null,
              isSystem: false,
              isVisible: true,
              isPaused: false,
              concurrencyLimit: null,
              autoPauseOnFailure: false,
              failureRateThreshold: null,
              failureRateMinRuns: null,
              retentionPolicyOverride: null
            },
            dependencies: {
              actions: [{ actionId: 'missing.action', version: 1 }],
              nodeTypes: ['missing.node'],
              schemaRefs: ['missing.schemaRef']
            },
            draft: {
              draftVersion: 1,
              definition: {
                id: '00000000-0000-0000-0000-000000000001',
                version: 1,
                name: 'Missing deps',
                payloadSchemaRef: 'payload.TestPayload.v1',
                steps: []
              }
            },
            publishedVersions: []
          }
        ]
      })
    ).rejects.toMatchObject({
      code: 'MISSING_DEPENDENCIES',
      details: expect.objectContaining({
        missingActions: [{ actionId: 'missing.action', version: 1 }],
        missingNodeTypes: ['missing.node'],
        missingSchemaRefs: ['missing.schemaRef']
      })
    });
  });
});
