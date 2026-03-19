import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenantKnex, getCurrentTenantId } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import {
  ensureWorkflowScheduleStateTable,
  resetWorkflowRuntimeTables
} from '../helpers/workflowRuntimeV2TestUtils';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';
import {
  createWorkflowDefinitionAction,
  updateWorkflowDefinitionDraftAction,
  listWorkflowDefinitionsAction,
  publishWorkflowDefinitionAction
} from '@alga-psa/workflows/actions';
import WorkflowDefinitionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionVersionModelV2';
import { getSchemaRegistry } from '@alga-psa/workflows/runtime';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime/client';
import type { PublishError } from '@alga-psa/workflows/runtime/types';
import {
  exportWorkflowBundleV1ForWorkflowId
} from 'server/src/lib/workflow/bundle/exportWorkflowBundleV1';
import { importWorkflowBundleV1 } from 'server/src/lib/workflow/bundle/importWorkflowBundleV1';
import { buildDataContext } from '../../../../ee/server/src/components/workflow-designer/workflowDataContext';

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(),
    getCurrentTenantId: vi.fn(),
    auditLog: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('@alga-psa/users/actions', () => ({
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

const dataContextActionRegistry = [
  {
    id: 'ai.infer',
    version: 1,
    ui: {
      label: 'Infer Structured Output',
      description: 'Generate structured workflow data from a prompt.'
    },
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' }
      },
      required: ['prompt']
    },
    outputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    id: 'transform.build_object',
    version: 1,
    ui: {
      label: 'Build Object',
      description: 'Construct an object from explicit named inputs.'
    },
    inputSchema: {
      type: 'object',
      properties: {
        fields: { type: 'array' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        object: {
          type: 'object',
          additionalProperties: true
        }
      }
    }
  },
  {
    id: 'transform.rename_fields',
    version: 1,
    ui: {
      label: 'Rename Fields',
      description: 'Rename object fields with explicit mapping entries.'
    },
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'object' },
        renames: { type: 'array' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        object: {
          type: 'object',
          additionalProperties: true
        }
      }
    }
  },
  {
    id: 'test.echo',
    version: 1,
    ui: {
      label: 'Test Echo',
      description: 'Echo a value.'
    },
    inputSchema: {
      type: 'object',
      properties: {
        value: {}
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        value: {}
      }
    }
  }
] as const;

const normalizeBundleForComparison = (bundle: any) => {
  const copy = JSON.parse(JSON.stringify(bundle));
  copy.exportedAt = '2000-01-01T00:00:00.000Z';
  for (const workflow of copy.workflows ?? []) {
    if (workflow?.draft?.definition && typeof workflow.draft.definition === 'object') {
      workflow.draft.definition.id = '__WORKFLOW_ID__';
    }
    for (const version of workflow?.publishedVersions ?? []) {
      if (version?.definition && typeof version.definition === 'object') {
        version.definition.id = '__WORKFLOW_ID__';
      }
    }
  }
  return copy;
};

const summarizeDataContext = (definition: WorkflowDefinition) => {
  const payloadSchema = getSchemaRegistry().toJsonSchema(TEST_SCHEMA_REF) as Record<string, unknown>;
  const context = buildDataContext(
    definition,
    'downstream-step',
    dataContextActionRegistry as any,
    payloadSchema as any
  );

  return context.steps.map((step) => ({
    saveAs: step.saveAs,
    fields:
      step.fields.find((field) => field.name === 'object')?.children?.map((child) => child.name) ??
      step.fields.map((field) => field.name)
  }));
};

const buildMixedDefinition = (workflowId: string): WorkflowDefinition => ({
  id: workflowId,
  ...buildWorkflowDefinition({
    name: 'Mixed grouped workflow',
    payloadSchemaRef: TEST_SCHEMA_REF,
    steps: [
      {
        id: 'build-object-step',
        type: 'action.call',
        name: 'Build Object',
        config: {
          designerGroupKey: 'transform',
          designerTileKind: 'transform',
          actionId: 'transform.build_object',
          version: 1,
          saveAs: 'composed',
          inputMapping: {
            fields: [
              { key: 'ticketId', value: { $expr: 'payload.foo' } },
              { key: 'literalFlag', value: true },
              { key: 'computedLabel', value: { $expr: 'coalesce(payload.foo, "fallback")' } }
            ]
          }
        }
      },
      {
        id: 'rename-fields-step',
        type: 'action.call',
        name: 'Rename Fields',
        config: {
          designerGroupKey: 'transform',
          designerTileKind: 'transform',
          actionId: 'transform.rename_fields',
          version: 1,
          saveAs: 'renamed',
          inputMapping: {
            source: { $expr: 'vars.composed.object' },
            renames: [{ from: 'ticketId', to: 'ticketCode' }]
          }
        }
      },
      {
        id: 'downstream-step',
        type: 'action.call',
        name: 'Echo Result',
        config: {
          designerGroupKey: 'app:test',
          designerTileKind: 'app',
          designerAppKey: 'app:test',
          actionId: 'test.echo',
          version: 1,
          inputMapping: {
            value: { $expr: 'vars.renamed.object.ticketCode' }
          },
          saveAs: 'echoResult'
        }
      }
    ]
  })
});

const buildChangedActionInvalidDefinition = (workflowId: string): WorkflowDefinition => ({
  id: workflowId,
  ...buildWorkflowDefinition({
    name: 'Grouped validation workflow',
    payloadSchemaRef: TEST_SCHEMA_REF,
    steps: [
      {
        id: 'grouped-action-step',
        type: 'action.call',
        name: 'Changed Action',
        config: {
          designerAppKey: 'app:test',
          designerTileKind: 'app',
          actionId: 'test.actionProvided',
          version: 1,
          inputMapping: {
            value: { $expr: 'payload.foo' }
          },
          saveAs: 'changedResult'
        }
      }
    ]
  })
});

const buildAiDefinition = (workflowId: string): WorkflowDefinition => ({
  id: workflowId,
  ...buildWorkflowDefinition({
    name: 'AI grouped workflow',
    payloadSchemaRef: TEST_SCHEMA_REF,
    steps: [
      {
        id: 'ai-step',
        type: 'action.call',
        name: 'Infer Classification',
        config: {
          designerGroupKey: 'ai',
          designerTileKind: 'ai',
          actionId: 'ai.infer',
          version: 1,
          saveAs: 'classificationResult',
          inputMapping: {
            prompt: { $expr: 'payload.foo' }
          },
          aiOutputSchemaMode: 'advanced',
          aiOutputSchemaText: JSON.stringify({
            type: 'object',
            properties: {
              category: { type: 'string' },
              next_action: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
            required: ['category'],
            additionalProperties: false,
          }, null, 2),
          aiOutputSchema: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              next_action: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
            required: ['category'],
            additionalProperties: false,
          },
        }
      },
      {
        id: 'downstream-step',
        type: 'action.call',
        name: 'Echo Result',
        config: {
          designerAppKey: 'app:test',
          designerTileKind: 'app',
          actionId: 'test.echo',
          version: 1,
          inputMapping: {
            value: { $expr: 'vars.classificationResult.next_action.label' }
          },
          saveAs: 'echoResult'
        }
      }
    ]
  })
});

const expectGroupedValidationError = (errors: Record<string, unknown>[] | null | undefined) => {
  expect(errors?.length).toBeGreaterThan(0);
  expect(errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining<Partial<PublishError>>({
        code: 'MISSING_REQUIRED_MAPPING',
        stepId: 'grouped-action-step',
        stepPath: 'root.steps[0]',
        severity: 'error'
      })
    ])
  );
};

beforeAll(async () => {
  ensureWorkflowRuntimeV2TestRegistrations();
  db = await createTestDbConnection();
  await ensureWorkflowScheduleStateTable(db);
});

beforeEach(async () => {
  await ensureWorkflowScheduleStateTable(db);
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

describe('workflow designer grouped-step persistence', () => {
  it('T289/T304/T326/T327: mixed grouped-step drafts preserve downstream data context across save and reload', async () => {
    const created = await createWorkflowDefinitionAction({
      key: 'test.mixed-grouped-persistence',
      definition: {
        id: uuidv4(),
        ...buildWorkflowDefinition({
          name: 'Initial grouped workflow',
          payloadSchemaRef: TEST_SCHEMA_REF,
          steps: [stateSetStep('state-1', 'READY')]
        })
      }
    });

    const definition = buildMixedDefinition(created.workflowId);
    await updateWorkflowDefinitionDraftAction({
      workflowId: created.workflowId,
      definition
    });

    const expectedContext = summarizeDataContext(definition);
    expect(expectedContext).toEqual([
      { saveAs: 'composed', fields: ['ticketId', 'literalFlag', 'computedLabel'] },
      { saveAs: 'renamed', fields: ['literalFlag', 'computedLabel', 'ticketCode'] }
    ]);

    const listedBeforePublish = await listWorkflowDefinitionsAction();
    const reloadedDraft = listedBeforePublish.find(
      (workflow) => workflow.workflow_id === created.workflowId
    );

    expect(reloadedDraft?.draft_definition).toEqual(definition);
    expect(summarizeDataContext(reloadedDraft?.draft_definition as WorkflowDefinition)).toEqual(
      expectedContext
    );
  });

  it('T298/T324: grouped-step validation errors stay attached to the same step after draft save and reload', async () => {
    const created = await createWorkflowDefinitionAction({
      key: 'test.grouped-validation-persistence',
      definition: {
        id: uuidv4(),
        ...buildWorkflowDefinition({
          name: 'Initial grouped validation workflow',
          payloadSchemaRef: TEST_SCHEMA_REF,
          steps: [stateSetStep('state-1', 'READY')]
        })
      }
    });

    const invalidDefinition = buildChangedActionInvalidDefinition(created.workflowId);
    await updateWorkflowDefinitionDraftAction({
      workflowId: created.workflowId,
      definition: invalidDefinition
    });

    const recordAfterSave = await WorkflowDefinitionModelV2.getById(db, created.workflowId);
    expect(recordAfterSave?.draft_definition).toEqual(invalidDefinition);
    expectGroupedValidationError(recordAfterSave?.validation_errors);

    const listed = await listWorkflowDefinitionsAction();
    const reloadedDraft = listed.find((workflow) => workflow.workflow_id === created.workflowId);

    expect(reloadedDraft?.draft_definition).toEqual(invalidDefinition);
    expectGroupedValidationError(reloadedDraft?.validation_errors as Record<string, unknown>[] | undefined);
  });

  it('T288/T314: mixed structured and advanced grouped-step drafts still publish without contract drift', async () => {
    const created = await createWorkflowDefinitionAction({
      key: 'test.mixed-grouped-publish',
      definition: {
        id: uuidv4(),
        ...buildWorkflowDefinition({
          name: 'Initial grouped workflow',
          payloadSchemaRef: TEST_SCHEMA_REF,
          steps: [stateSetStep('state-1', 'READY')]
        })
      }
    });

    const definition = buildMixedDefinition(created.workflowId);
    await updateWorkflowDefinitionDraftAction({
      workflowId: created.workflowId,
      definition
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: created.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);

    const publishedVersion = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(
      db,
      created.workflowId,
      1
    );
    expect(publishedVersion?.definition_json).toEqual(definition);

    const rowAfterPublish = await WorkflowDefinitionModelV2.getById(db, created.workflowId);
    expect(rowAfterPublish?.draft_version).toBe(2);
    expect((rowAfterPublish?.draft_definition as WorkflowDefinition)?.steps).toEqual(
      definition.steps
    );
  });

  it('T299/T323: grouped-step publish validation still uses the runtime contract after grouped action changes leave required inputs unmapped', async () => {
    const created = await createWorkflowDefinitionAction({
      key: 'test.grouped-publish-validation',
      definition: {
        id: uuidv4(),
        ...buildWorkflowDefinition({
          name: 'Initial grouped publish validation workflow',
          payloadSchemaRef: TEST_SCHEMA_REF,
          steps: [stateSetStep('state-1', 'READY')]
        })
      }
    });

    const invalidDefinition = buildChangedActionInvalidDefinition(created.workflowId);
    await updateWorkflowDefinitionDraftAction({
      workflowId: created.workflowId,
      definition: invalidDefinition
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: created.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(false);
    expectGroupedValidationError(publishResult.errors as Record<string, unknown>[] | undefined);

    const rowAfterFailedPublish = await WorkflowDefinitionModelV2.getById(db, created.workflowId);
    expectGroupedValidationError(rowAfterFailedPublish?.validation_errors);
    expect(rowAfterFailedPublish?.status).toBe('draft');
  });

  it('T290/T307/T328: workflow import/export preserves grouped action.call definitions that mix structured and advanced mappings', async () => {
    const definition = buildMixedDefinition(uuidv4());
    const created = await createWorkflowDefinitionAction({
      key: 'test.grouped-import-export',
      definition
    });

    await updateWorkflowDefinitionDraftAction({
      workflowId: created.workflowId,
      definition: buildMixedDefinition(created.workflowId)
    });
    await publishWorkflowDefinitionAction({
      workflowId: created.workflowId,
      version: 1
    });

    const exported1 = await exportWorkflowBundleV1ForWorkflowId(db, created.workflowId);

    expect(exported1.workflows[0]?.draft?.definition?.steps?.[0]).toMatchObject({
      type: 'action.call',
      config: {
        designerGroupKey: 'transform',
        designerTileKind: 'transform',
        actionId: 'transform.build_object',
        version: 1,
        inputMapping: {
          fields: [
            { key: 'ticketId', value: { $expr: 'payload.foo' } },
            { key: 'literalFlag', value: true },
            { key: 'computedLabel', value: { $expr: 'coalesce(payload.foo, "fallback")' } }
          ]
        }
      }
    });

    await resetWorkflowRuntimeTables(db);
    await ensureWorkflowScheduleStateTable(db);

    const imported = await importWorkflowBundleV1(db, exported1);
    const importedId = imported.createdWorkflows[0].workflowId;
    const exported2 = await exportWorkflowBundleV1ForWorkflowId(db, importedId);

    expect(normalizeBundleForComparison(exported2)).toEqual(
      normalizeBundleForComparison(exported1)
    );

    const importedRow = await WorkflowDefinitionModelV2.getById(db, importedId);
    expect(importedRow?.draft_definition).toMatchObject({
      steps: [
        {
          type: 'action.call',
          config: {
            designerGroupKey: 'transform',
            designerTileKind: 'transform',
            actionId: 'transform.build_object'
          }
        },
        {
          type: 'action.call',
          config: {
            designerGroupKey: 'transform',
            designerTileKind: 'transform',
            actionId: 'transform.rename_fields'
          }
        },
        {
          type: 'action.call',
          config: {
            designerAppKey: 'app:test',
            designerTileKind: 'app',
            actionId: 'test.echo'
          }
        }
      ]
    });
  });

  it('T301/T303/T315/T325: grouped ticket and transform drafts round-trip fixed picker literals plus structured references through draft save and reload', async () => {
    const created = await createWorkflowDefinitionAction({
      key: 'test.grouped-ticket-transform-roundtrip',
      definition: {
        id: uuidv4(),
        ...buildWorkflowDefinition({
          name: 'Ticket and transform round trip',
          payloadSchemaRef: TEST_SCHEMA_REF,
          steps: [stateSetStep('state-1', 'READY')]
        })
      }
    });

    const definition: WorkflowDefinition = {
      id: created.workflowId,
      ...buildWorkflowDefinition({
        name: 'Ticket and transform round trip',
        payloadSchemaRef: TEST_SCHEMA_REF,
        steps: [
          {
            id: 'truncate-step',
            type: 'action.call',
            name: 'Truncate Text',
            config: {
              designerGroupKey: 'transform',
              designerTileKind: 'transform',
              actionId: 'transform.truncate_text',
              version: 1,
              saveAs: 'trimmedTitle',
              inputMapping: {
                text: { $expr: 'payload.foo' },
                maxLength: 24,
                strategy: 'end'
              }
            }
          },
          {
            id: 'ticket-step',
            type: 'action.call',
            name: 'Create Ticket',
            config: {
              designerGroupKey: 'ticket',
              designerTileKind: 'core-object',
              actionId: 'tickets.create',
              version: 1,
              saveAs: 'createdTicket',
              inputMapping: {
                client_id: '00000000-0000-0000-0000-000000000111',
                title: { $expr: 'vars.trimmedTitle.text' },
                description: 'Created from grouped workflow draft',
                board_id: '00000000-0000-0000-0000-000000000222',
                status_id: '00000000-0000-0000-0000-000000000333',
                priority_id: '00000000-0000-0000-0000-000000000444'
              }
            }
          }
        ]
      })
    };

    await updateWorkflowDefinitionDraftAction({
      workflowId: created.workflowId,
      definition
    });

    const listed = await listWorkflowDefinitionsAction();
    const reloadedDraft = listed.find((workflow) => workflow.workflow_id === created.workflowId);

    expect(reloadedDraft?.draft_definition).toEqual(definition);
    expect((reloadedDraft?.draft_definition as WorkflowDefinition).steps).toEqual(
      definition.steps
    );
    expect((reloadedDraft?.draft_definition as WorkflowDefinition).steps?.[1]).toMatchObject({
      type: 'action.call',
      config: {
        actionId: 'tickets.create',
        inputMapping: {
          client_id: '00000000-0000-0000-0000-000000000111',
          title: { $expr: 'vars.trimmedTitle.text' },
          board_id: '00000000-0000-0000-0000-000000000222',
          status_id: '00000000-0000-0000-0000-000000000333',
          priority_id: '00000000-0000-0000-0000-000000000444'
        }
      }
    });
  });

  it('T008/T020/T031: AI grouped drafts preserve prompt, schema mode, and inline output schema through save and reload', async () => {
    const created = await createWorkflowDefinitionAction({
      key: 'test.ai-grouped-persistence',
      definition: {
        id: uuidv4(),
        ...buildWorkflowDefinition({
          name: 'Initial AI grouped workflow',
          payloadSchemaRef: TEST_SCHEMA_REF,
          steps: [stateSetStep('state-1', 'READY')]
        })
      }
    });

    const definition = buildAiDefinition(created.workflowId);
    await updateWorkflowDefinitionDraftAction({
      workflowId: created.workflowId,
      definition
    });

    const listed = await listWorkflowDefinitionsAction();
    const reloadedDraft = listed.find((workflow) => workflow.workflow_id === created.workflowId);
    expect(reloadedDraft?.draft_definition).toEqual(definition);

    const summary = summarizeDataContext(reloadedDraft?.draft_definition as WorkflowDefinition);
    expect(summary).toEqual([
      { saveAs: 'classificationResult', fields: ['category', 'next_action'] },
    ]);
  });
});
