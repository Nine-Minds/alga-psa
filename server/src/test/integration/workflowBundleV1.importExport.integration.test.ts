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
});

