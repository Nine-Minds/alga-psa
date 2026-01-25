import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ensureWorkflowRuntimeV2TestRegistrations, stateSetStep, buildWorkflowDefinition } from '../helpers/workflowRuntimeV2TestHelpers';
import { importWorkflowBundleV1 } from 'server/src/lib/workflow/bundle/importWorkflowBundleV1';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createWorkflowDefinitionAction, publishWorkflowDefinitionAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';
import { GET as exportBundleRoute } from 'server/src/app/api/workflow-definitions/[workflowId]/export/route';
import { stringifyCanonicalJson } from '@shared/workflow/bundle/canonicalJson';

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
  getCurrentTenantId: vi.fn()
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn()
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn().mockResolvedValue(true)
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

let db: Knex;
let tenantId: string;
let userId: string;

beforeAll(async () => {
  ensureWorkflowRuntimeV2TestRegistrations();
  db = await createTestDbConnection();
});

beforeEach(async () => {
  await resetWorkflowRuntimeTables(db);
  tenantId = uuidv4();
  userId = uuidv4();
  mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });
  mockedGetCurrentTenantId.mockReturnValue(tenantId);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, roles: [] } as any);
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

  it('exporting a single workflow produces canonical JSON with stable formatting', async () => {
    const workflowIdInput = uuidv4();
    const definition = {
      id: workflowIdInput,
      ...buildWorkflowDefinition({ steps: [stateSetStep('state-1', 'READY')] })
    };

    const created = await createWorkflowDefinitionAction({ key: 'test.export-canonical', definition });
    await publishWorkflowDefinitionAction({ workflowId: created.workflowId, version: 1 });

    const response = await exportBundleRoute(new Request('http://example.com'), { params: { workflowId: created.workflowId } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(text);
    expect(text).toBe(stringifyCanonicalJson(parsed));
  });

  it('export excludes instance-specific audit fields by default', async () => {
    const definition = {
      id: uuidv4(),
      ...buildWorkflowDefinition({ steps: [stateSetStep('state-1', 'READY')] })
    };

    const created = await createWorkflowDefinitionAction({ key: 'test.export-no-audit', definition });
    await publishWorkflowDefinitionAction({ workflowId: created.workflowId, version: 1 });

    const response = await exportBundleRoute(new Request('http://example.com'), { params: { workflowId: created.workflowId } });
    const bundle = await response.json();

    expect(bundle.workflows[0]).not.toHaveProperty('workflow_id');
    expect(bundle.workflows[0]).not.toHaveProperty('created_at');
    expect(bundle.workflows[0]).not.toHaveProperty('updated_at');
    expect(bundle.workflows[0]).not.toHaveProperty('created_by');
    expect(bundle.workflows[0]).not.toHaveProperty('updated_by');

    expect(bundle.workflows[0].publishedVersions?.[0]).not.toHaveProperty('version_id');
    expect(bundle.workflows[0].publishedVersions?.[0]).not.toHaveProperty('published_at');
    expect(bundle.workflows[0].publishedVersions?.[0]).not.toHaveProperty('published_by');
  });
});
