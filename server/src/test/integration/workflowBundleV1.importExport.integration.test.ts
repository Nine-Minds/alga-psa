import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  stateSetStep,
  buildWorkflowDefinition,
  actionCallStep,
  returnStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';
import { importWorkflowBundleV1 } from 'server/src/lib/workflow/bundle/importWorkflowBundleV1';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createWorkflowDefinitionAction, publishWorkflowDefinitionAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';
import { GET as exportBundleRoute } from 'server/src/app/api/workflow-definitions/[workflowId]/export/route';
import { stringifyCanonicalJson } from '@shared/workflow/bundle/canonicalJson';
import { exportWorkflowBundleV1ForWorkflowId } from 'server/src/lib/workflow/bundle/exportWorkflowBundleV1';

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

const normalizeBundleForComparison = (bundle: any) => {
  const copy = JSON.parse(JSON.stringify(bundle));
  copy.exportedAt = '2000-01-01T00:00:00.000Z';
  for (const wf of copy.workflows ?? []) {
    if (wf?.draft?.definition && typeof wf.draft.definition === 'object') {
      wf.draft.definition.id = '__WORKFLOW_ID__';
    }
    for (const pv of wf?.publishedVersions ?? []) {
      if (pv?.definition && typeof pv.definition === 'object') {
        pv.definition.id = '__WORKFLOW_ID__';
      }
    }
  }
  return copy;
};

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

  it('importing a bundle into an empty DB creates workflow_definitions and workflow_definition_versions records', async () => {
    const bundle = {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [
        {
          key: 'test.import-basic',
          metadata: {
            name: 'Import basic',
            description: null,
            payloadSchemaRef: TEST_SCHEMA_REF,
            payloadSchemaMode: 'pinned',
            pinnedPayloadSchemaRef: TEST_SCHEMA_REF,
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
            actions: [{ actionId: 'test.echo', version: 1 }],
            nodeTypes: ['action.call', 'state.set'],
            schemaRefs: [TEST_SCHEMA_REF]
          },
          draft: {
            draftVersion: 1,
            definition: {
              id: '00000000-0000-0000-0000-000000000001',
              ...buildWorkflowDefinition({
                steps: [
                  stateSetStep('state-1', 'READY'),
                  actionCallStep({ id: 'echo-1', actionId: 'test.echo', inputMapping: { value: { $expr: '"ok"' } } }),
                  returnStep('done')
                ],
                payloadSchemaRef: TEST_SCHEMA_REF
              })
            }
          },
          publishedVersions: [
            {
              version: 1,
              definition: {
                id: '00000000-0000-0000-0000-000000000001',
                ...buildWorkflowDefinition({
                  steps: [
                    stateSetStep('state-1', 'READY'),
                    actionCallStep({ id: 'echo-1', actionId: 'test.echo', inputMapping: { value: { $expr: '"ok"' } } }),
                    returnStep('done')
                  ],
                  payloadSchemaRef: TEST_SCHEMA_REF
                })
              },
              payloadSchemaJson: null
            }
          ]
        }
      ]
    };

    const result = await importWorkflowBundleV1(db, bundle);
    expect(result.createdWorkflows).toHaveLength(1);
    expect(result.createdWorkflows[0].key).toBe('test.import-basic');

    const createdId = result.createdWorkflows[0].workflowId;
    const definitionRow = await db('workflow_definitions').where({ workflow_id: createdId }).first();
    expect(definitionRow).toBeTruthy();
    expect(definitionRow.key).toBe('test.import-basic');
    expect(definitionRow.status).toBe('published');
    expect(definitionRow.draft_definition?.id).toBe(createdId);

    const versionRow = await db('workflow_definition_versions').where({ workflow_id: createdId, version: 1 }).first();
    expect(versionRow).toBeTruthy();
    expect(versionRow.definition_json?.id).toBe(createdId);
  });

  it('import create-only policy fails when workflow key already exists (without force)', async () => {
    const bundle = {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [
        {
          key: 'test.conflict',
          metadata: {
            name: 'Conflict',
            description: null,
            payloadSchemaRef: TEST_SCHEMA_REF,
            payloadSchemaMode: 'pinned',
            pinnedPayloadSchemaRef: TEST_SCHEMA_REF,
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
            actions: [{ actionId: 'test.echo', version: 1 }],
            nodeTypes: ['action.call', 'state.set'],
            schemaRefs: [TEST_SCHEMA_REF]
          },
          draft: {
            draftVersion: 1,
            definition: {
              id: uuidv4(),
              ...buildWorkflowDefinition({
                steps: [stateSetStep('state-1', 'READY'), actionCallStep({ id: 'echo-1', actionId: 'test.echo' }), returnStep('done')],
                payloadSchemaRef: TEST_SCHEMA_REF
              })
            }
          },
          publishedVersions: []
        }
      ]
    };

    await importWorkflowBundleV1(db, bundle);

    await expect(importWorkflowBundleV1(db, bundle)).rejects.toMatchObject({
      code: 'WORKFLOW_KEY_CONFLICT',
      status: 409
    });

    const rows = await db('workflow_definitions').where({ key: 'test.conflict' });
    expect(rows).toHaveLength(1);
  });

  it('import force overwrite deletes the existing workflow by key and recreates it with a regenerated workflow_id', async () => {
    const bundle = {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [
        {
          key: 'test.force-overwrite',
          metadata: {
            name: 'Force overwrite',
            description: null,
            payloadSchemaRef: TEST_SCHEMA_REF,
            payloadSchemaMode: 'pinned',
            pinnedPayloadSchemaRef: TEST_SCHEMA_REF,
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
            actions: [{ actionId: 'test.echo', version: 1 }],
            nodeTypes: ['action.call', 'state.set'],
            schemaRefs: [TEST_SCHEMA_REF]
          },
          draft: {
            draftVersion: 1,
            definition: {
              id: uuidv4(),
              ...buildWorkflowDefinition({
                steps: [stateSetStep('state-1', 'READY'), actionCallStep({ id: 'echo-1', actionId: 'test.echo' }), returnStep('done')],
                payloadSchemaRef: TEST_SCHEMA_REF
              })
            }
          },
          publishedVersions: [
            {
              version: 1,
              definition: {
                id: uuidv4(),
                ...buildWorkflowDefinition({
                  steps: [stateSetStep('state-1', 'READY'), actionCallStep({ id: 'echo-1', actionId: 'test.echo' }), returnStep('done')],
                  payloadSchemaRef: TEST_SCHEMA_REF
                })
              },
              payloadSchemaJson: null
            }
          ]
        }
      ]
    };

    const first = await importWorkflowBundleV1(db, bundle);
    const firstId = first.createdWorkflows[0].workflowId;

    const second = await importWorkflowBundleV1(db, bundle, { force: true });
    const secondId = second.createdWorkflows[0].workflowId;

    expect(secondId).not.toBe(firstId);

    const oldRow = await db('workflow_definitions').where({ workflow_id: firstId }).first();
    expect(oldRow).toBeFalsy();

    const newRow = await db('workflow_definitions').where({ workflow_id: secondId }).first();
    expect(newRow).toBeTruthy();
    expect(newRow.key).toBe('test.force-overwrite');
  });

  it('import is transactional: if any DB write fails, no workflow_definitions or workflow_definition_versions are persisted', async () => {
    const bundle = {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [
        {
          key: 'test.transactional',
          metadata: {
            name: 'Transactional',
            description: null,
            payloadSchemaRef: TEST_SCHEMA_REF,
            payloadSchemaMode: 'pinned',
            pinnedPayloadSchemaRef: TEST_SCHEMA_REF,
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
            actions: [{ actionId: 'test.echo', version: 1 }],
            nodeTypes: ['action.call', 'state.set'],
            schemaRefs: [TEST_SCHEMA_REF]
          },
          draft: {
            draftVersion: 1,
            definition: {
              id: uuidv4(),
              ...buildWorkflowDefinition({
                steps: [stateSetStep('state-1', 'READY'), actionCallStep({ id: 'echo-1', actionId: 'test.echo' }), returnStep('done')],
                payloadSchemaRef: TEST_SCHEMA_REF
              })
            }
          },
          publishedVersions: [
            {
              version: 1,
              definition: {
                id: uuidv4(),
                ...buildWorkflowDefinition({
                  steps: [stateSetStep('state-1', 'READY'), actionCallStep({ id: 'echo-1', actionId: 'test.echo' }), returnStep('done')],
                  payloadSchemaRef: TEST_SCHEMA_REF
                })
              },
              payloadSchemaJson: null
            },
            {
              version: 1,
              definition: {
                id: uuidv4(),
                ...buildWorkflowDefinition({
                  steps: [stateSetStep('state-1', 'READY'), actionCallStep({ id: 'echo-2', actionId: 'test.echo' }), returnStep('done')],
                  payloadSchemaRef: TEST_SCHEMA_REF
                })
              },
              payloadSchemaJson: null
            }
          ]
        }
      ]
    };

    await expect(importWorkflowBundleV1(db, bundle)).rejects.toBeTruthy();

    const rows = await db('workflow_definitions').where({ key: 'test.transactional' });
    expect(rows).toHaveLength(0);
  });

  it('round-trip export -> import -> export matches after canonical normalization (supported fields)', async () => {
    const definition = {
      id: uuidv4(),
      ...buildWorkflowDefinition({
        steps: [stateSetStep('state-1', 'READY'), actionCallStep({ id: 'echo-1', actionId: 'test.echo' }), returnStep('done')],
        payloadSchemaRef: TEST_SCHEMA_REF
      })
    };

    const created = await createWorkflowDefinitionAction({ key: 'test.roundtrip', definition });
    await publishWorkflowDefinitionAction({ workflowId: created.workflowId, version: 1 });

    const exported1 = await exportWorkflowBundleV1ForWorkflowId(db, created.workflowId);

    await resetWorkflowRuntimeTables(db);

    const imported = await importWorkflowBundleV1(db, exported1);
    const newId = imported.createdWorkflows[0].workflowId;
    const exported2 = await exportWorkflowBundleV1ForWorkflowId(db, newId);

    expect(normalizeBundleForComparison(exported2)).toEqual(normalizeBundleForComparison(exported1));
  });
});
