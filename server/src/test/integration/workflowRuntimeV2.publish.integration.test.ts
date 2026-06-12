import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  ensureWorkflowScheduleStateTable,
  resetWorkflowRuntimeTables
} from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  listWorkflowRegistryNodesAction,
  listWorkflowRegistryActionsAction,
  listWorkflowDesignerActionCatalogAction,
  getWorkflowSchemaAction,
  startWorkflowRunAction,
  cancelWorkflowRunAction,
  replayWorkflowRunAction,
  getWorkflowRunAction,
  listWorkflowRunsAction,
  listWorkflowRunStepsAction
} from '@alga-psa/workflows/actions';
import WorkflowDefinitionVersionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionVersionModelV2';
import WorkflowDefinitionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionModelV2';
import WorkflowRunModelV2 from '@alga-psa/workflows/persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '@alga-psa/workflows/persistence/workflowRunStepModelV2';
import WorkflowRunWaitModelV2 from '@alga-psa/workflows/persistence/workflowRunWaitModelV2';
import { WorkflowRuntimeV2, getActionRegistryV2, getNodeTypeRegistry, getSchemaRegistry } from '@alga-psa/workflows/runtime';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  actionCallStep,
  assignStep,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';

const {
  startWorkflowRuntimeV2TemporalRunMock,
  cancelWorkflowRuntimeV2TemporalRunMock
} = vi.hoisted(() => ({
  startWorkflowRuntimeV2TemporalRunMock: vi.fn(),
  cancelWorkflowRuntimeV2TemporalRunMock: vi.fn()
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(),
    getCurrentTenantId: vi.fn(),
    auditLog: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('@alga-psa/auth', () => {
  const withAuth = (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      { tenant: tenantId },
      ...args
    );
  const withOptionalAuth = (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      { tenant: tenantId },
      ...args
    );
  const withAuthCheck = (action: (user: any, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      ...args
    );

  return {
    withAuth,
    withOptionalAuth,
    withAuthCheck,
    AuthenticationError: class AuthenticationError extends Error {},
    hasPermission: vi.fn().mockResolvedValue(true),
    checkMultiplePermissions: vi.fn().mockResolvedValue(true),
    getCurrentUser: vi.fn(),
    preCheckDeletion: vi.fn()
  };
});

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  startWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => startWorkflowRuntimeV2TemporalRunMock(...args),
  cancelWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => cancelWorkflowRuntimeV2TemporalRunMock(...args)
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

let db: Knex;
let tenantId: string;
let userId: string;

async function createDraftWorkflow(params: { steps: any[]; payloadSchemaRef?: string; trigger?: any; name?: string }) {
  const definition = {
    id: uuidv4(),
    ...buildWorkflowDefinition({
      steps: params.steps,
      payloadSchemaRef: params.payloadSchemaRef,
      trigger: params.trigger,
      name: params.name
    })
  };
  const result = await createWorkflowDefinitionAction({ definition });
  return result.workflowId;
}

async function publishWorkflow(workflowId: string, version: number, definition?: any) {
  return publishWorkflowDefinitionAction({ workflowId, version, definition });
}

async function ensureExtensionAvailabilityTables(knex: Knex) {
  const hasRegistryTable = await knex.schema.hasTable('extension_registry');
  if (!hasRegistryTable) {
    await knex.schema.createTable('extension_registry', (table) => {
      table.uuid('id').primary();
      table.string('publisher').notNullable();
      table.string('name').notNullable();
      table.string('display_name').nullable();
      table.text('description').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasInstallTable = await knex.schema.hasTable('tenant_extension_install');
  if (!hasInstallTable) {
    await knex.schema.createTable('tenant_extension_install', (table) => {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable();
      table.uuid('registry_id').notNullable();
      table.uuid('version_id').nullable();
      table.text('granted_caps').nullable();
      table.text('config').nullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.string('status').notNullable().defaultTo('enabled');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }
}

async function seedAvailableExtensionForTenant(
  knex: Knex,
  input: { tenantId: string; publisher: string; extensionName: string }
) {
  const registryId = uuidv4();
  await knex('extension_registry').insert({
    id: registryId,
    publisher: input.publisher,
    name: input.extensionName,
    display_name: input.extensionName,
    description: `${input.extensionName} test extension`,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  await knex('tenant_extension_install').insert({
    id: uuidv4(),
    tenant_id: input.tenantId,
    registry_id: registryId,
    version_id: null,
    granted_caps: JSON.stringify([]),
    config: JSON.stringify({}),
    is_enabled: true,
    status: 'enabled',
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });
}

beforeAll(async () => {
  ensureWorkflowRuntimeV2TestRegistrations();
  db = await createTestDbConnection();
  await ensureWorkflowScheduleStateTable(db);
  await ensureExtensionAvailabilityTables(db);
});

beforeEach(async () => {
  await ensureWorkflowScheduleStateTable(db);
  await resetWorkflowRuntimeTables(db);
  await ensureExtensionAvailabilityTables(db);
  tenantId = uuidv4();
  userId = uuidv4();
  mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });
  mockedGetCurrentTenantId.mockReturnValue(tenantId);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, tenant: tenantId, roles: [] } as any);
  startWorkflowRuntimeV2TemporalRunMock.mockReset();
  cancelWorkflowRuntimeV2TemporalRunMock.mockReset();
  startWorkflowRuntimeV2TemporalRunMock.mockResolvedValue({
    workflowId: 'workflow-runtime-v2:run:run-replayed',
    firstExecutionRunId: 'temporal-run-replayed'
  });
  cancelWorkflowRuntimeV2TemporalRunMock.mockResolvedValue(undefined);
  await db('tenant_extension_install').delete().catch(() => undefined);
  await db('extension_registry').delete().catch(() => undefined);
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow runtime v2 publish + registry + run integration tests', () => {
  it('Publish a valid workflow definition returns ok with publishedVersion. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1);
    expect(result.ok).toBe(true);
    expect(result.publishedVersion).toBe(1);
  });

  it('Publish fails when workflow JSON is structurally invalid. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, { name: 'Broken' });
    expect(result.ok).toBe(false);
  });

  it('Publish rejects unknown node types with explicit error code. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Unknown node test',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [{ id: 'step-1', type: 'unknown.node', config: {} }]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'UNKNOWN_NODE_TYPE')).toBe(true);
  });

  it('Publish rejects unknown action id/version references. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Unknown action test',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'action-1',
          type: 'action.call',
          config: {
            actionId: 'missing.action',
            version: 1,
            inputMapping: {}
          }
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'UNKNOWN_ACTION')).toBe(true);
  });

  it('Publish rejects invalid node config against node config schema. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Invalid config',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [{ id: 'step-1', type: 'state.set', config: {} }]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'INVALID_CONFIG')).toBe(true);
  });

  it('Publish rejects invalid expressions with syntax errors. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Invalid expr',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [assignStep('assign-1', { 'payload.foo': { $expr: 'bad(' } })]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'INVALID_EXPR')).toBe(true);
  });

  it('Publish rejects duplicate step ids across nested pipes. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Dup IDs',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'dup',
          type: 'control.if',
          condition: { $expr: 'true' },
          then: [{ id: 'dup', type: 'state.set', config: { state: 'A' } }]
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'DUPLICATE_STEP_ID')).toBe(true);
  });

  it('Publish rejects invalid step type values. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Invalid step type',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [{ id: 'step-1', type: 'control.invalid', config: {} }]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'UNKNOWN_NODE_TYPE')).toBe(true);
  });

  it('Publish validates callWorkflow inputMapping expressions. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'callWorkflow inputMapping',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'call',
          type: 'control.callWorkflow',
          workflowId: 'child',
          workflowVersion: 1,
          inputMapping: { foo: { $expr: 'bad(' } }
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'INVALID_EXPR')).toBe(true);
  });

  it('Publish validates callWorkflow outputMapping expressions. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'callWorkflow outputMapping',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'call',
          type: 'control.callWorkflow',
          workflowId: 'child',
          workflowVersion: 1,
          outputMapping: { 'payload.foo': { $expr: 'bad(' } }
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'INVALID_EXPR')).toBe(true);
  });

  it('Publish fails when payloadSchemaRef is missing from registry. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Unknown schema',
      payloadSchemaRef: 'payload.Unknown.v1',
      steps: [stateSetStep('state-1', 'READY')]
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PAYLOAD_SCHEMA_REF_UNKNOWN',
          stepPath: 'root.payloadSchemaRef'
        })
      ])
    );
  });

  it('Publish stores payload_schema_json for valid payload schema refs. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1);
    expect(result.ok).toBe(true);
    const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(db, workflowId, 1);
    expect(record?.payload_schema_json).toBeDefined();
  });

  it('Publish records who published and published_at audit fields. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1);
    expect(result.ok).toBe(true);
    const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(db, workflowId, 1);
    expect(record?.published_by).toBe(userId);
    expect(record?.published_at).toBeDefined();
  });

  it('Publish creates immutable version; later edits do not mutate published JSON. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    await WorkflowDefinitionModelV2.update(db, tenantId, workflowId, {
      draft_definition: {
        id: workflowId,
        version: 1,
        name: 'Mutated',
        payloadSchemaRef: TEST_SCHEMA_REF,
        steps: [stateSetStep('state-2', 'CHANGED')]
      }
    });
    const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(db, workflowId, 1);
    expect((record?.definition_json as any)?.name).toBe('Test Workflow');
  });

  it('Publish returns warnings without blocking when severity=warning. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Warn',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [assignStep('assign-1', { 'payload.unknown': { $expr: 'payload.foo' } })]
    });
    expect(result.ok).toBe(true);
    expect(result.warnings?.length).toBeGreaterThan(0);
  });

  it('Publish returns stepPath for nested validation errors. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Nested error',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'if-1',
          type: 'control.if',
          condition: { $expr: 'true' },
          then: [{ id: 'bad', type: 'unknown.node', config: {} }]
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]?.stepPath).toContain('then.steps[0]');
  });

  it('Publish validates action.call args expressions compile. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Action inputMapping invalid',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'action-1',
          type: 'action.call',
          config: {
            actionId: 'test.echo',
            version: 1,
            inputMapping: { value: { $expr: 'bad(' } }
          }
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'INVALID_EXPR')).toBe(true);
  });

  it('Publish fails when required action inputs are not mapped. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Action inputMapping required',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'action-1',
          type: 'action.call',
          config: {
            actionId: 'test.actionProvided',
            version: 1,
            inputMapping: {}
          }
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'MISSING_REQUIRED_MAPPING')).toBe(true);
  });

  it('T299/T323: grouped action.call steps keep publish validation on the unchanged runtime contract after action changes leave stale mappings behind. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Grouped action missing required mapping',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'grouped-invalid-step',
          type: 'action.call',
          config: {
            designerAppKey: 'app:test',
            designerTileKind: 'app',
            actionId: 'test.actionProvided',
            version: 1,
            inputMapping: {
              value: 'leftover-from-previous-action'
            }
          }
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_REQUIRED_MAPPING',
          stepId: 'grouped-invalid-step',
          stepPath: 'root.steps[0]'
        })
      ])
    );
  });

  it('Publish fails when required workflow fields (id/name/steps) are missing. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, { payloadSchemaRef: TEST_SCHEMA_REF });
    expect(result.ok).toBe(false);
  });

  it('Publish rejects non-serializable workflow JSON (functions/undefined). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const circular: any = { name: 'circle' };
    circular.self = circular;
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Circular',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [stateSetStep('state-1', 'READY')],
      extra: circular
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'NON_SERIALIZABLE')).toBe(true);
  });

  it('Publish accepts workflow trigger metadata and stores it on the version. Mocks: non-target dependencies.', async () => {
    const trigger = { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: TEST_SCHEMA_REF };
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')], trigger });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Trigger',
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger,
      steps: [stateSetStep('state-1', 'READY')]
    });
    expect(result.ok).toBe(true);
    const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(db, workflowId, 1);
    expect((record?.definition_json as any)?.trigger).toEqual(trigger);
  });

  it('Node registry server action returns node definitions with JSON config schemas (API delegates to server action). Mocks: non-target dependencies.', async () => {
    const nodes = await listWorkflowRegistryNodesAction();
    const stateNode = nodes.find((node) => node.id === 'state.set');
    expect(stateNode?.configSchema).toBeDefined();
  });

  it('Node registry server action includes UI metadata (label/category/description/icon). Mocks: non-target dependencies.', async () => {
    const nodes = await listWorkflowRegistryNodesAction();
    const nodeWithUi = nodes.find((node) => node.ui?.label);
    expect(nodeWithUi).toBeDefined();
  });

  it('Node registry server action includes email node types needed for email workflow. Mocks: non-target dependencies.', async () => {
    const nodes = await listWorkflowRegistryNodesAction();
    const ids = nodes.map((node) => node.id);
    expect(ids).toContain('email.parseBody');
    expect(ids).toContain('email.renderCommentBlocks');
  });

  it('Action registry server action returns action definitions with I/O JSON schemas (API delegates to server action). Mocks: non-target dependencies.', async () => {
    const actions = await listWorkflowRegistryActionsAction();
    const action = actions.find((entry) => entry.id === 'test.echo');
    expect(action?.inputSchema).toBeDefined();
    expect(action?.outputSchema).toBeDefined();
  });

  it('Action registry server action includes email workflow actions. Mocks: non-target dependencies.', async () => {
    const actions = await listWorkflowRegistryActionsAction();
    expect(actions.some((entry) => entry.id === 'create_ticket_from_email')).toBe(true);
  });

  it('Action registry server action returns sideEffectful and retryHint metadata. Mocks: non-target dependencies.', async () => {
    const actions = await listWorkflowRegistryActionsAction();
    const action = actions.find((entry) => entry.id === 'test.sideEffect');
    expect(action?.sideEffectful).toBe(true);
    expect(action).toHaveProperty('retryHint');
  });

  it('T020: workflow designer receives the grouped catalog projection from the server action. Mocks: non-target dependencies.', async () => {
    const catalog = await listWorkflowDesignerActionCatalogAction();
    const ticketRecord = catalog.find((entry) => entry.groupKey === 'ticket');
    const transformRecord = catalog.find((entry) => entry.groupKey === 'transform');
    expect(ticketRecord).toBeDefined();
    expect(ticketRecord?.tileKind).toBe('core-object');
    expect(ticketRecord?.allowedActionIds).toContain('tickets.create');
    expect(transformRecord?.tileKind).toBe('transform');
    expect(transformRecord?.allowedActionIds).toContain('transform.truncate_text');
  });

  it('T291: app/plugin grouped tiles only appear when available to the current deployment and tenant context. Mocks: non-target dependencies.', async () => {
    const actionRegistry = getActionRegistryV2();
    const availableModule = `tenantapp${Date.now()}`;
    const unavailableModule = `hiddenapp${Date.now()}`;

    actionRegistry.register({
      id: `${availableModule}.send_message`,
      version: 1,
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Send Message', category: 'Apps', icon: 'app' },
      handler: async () => ({ ok: true }),
    });
    actionRegistry.register({
      id: `${unavailableModule}.create_issue`,
      version: 1,
      inputSchema: z.object({ title: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Create Issue', category: 'Apps', icon: 'app' },
      handler: async () => ({ ok: true }),
    });

    await seedAvailableExtensionForTenant(db, {
      tenantId,
      publisher: 'vitest',
      extensionName: availableModule,
    });

    const catalog = await listWorkflowDesignerActionCatalogAction();
    expect(catalog.find((entry) => entry.groupKey === `app:${availableModule}`)).toMatchObject({
      tileKind: 'app',
      allowedActionIds: [`${availableModule}.send_message`],
    });
    expect(catalog.find((entry) => entry.groupKey === `app:${unavailableModule}`)).toBeUndefined();
  });

  it('Transform actions are exposed through the runtime action registry projection. Mocks: non-target dependencies.', async () => {
    const actions = await listWorkflowRegistryActionsAction();
    const truncateAction = actions.find((entry) => entry.id === 'transform.truncate_text');
    const splitAction = actions.find((entry) => entry.id === 'transform.split_text');

    expect(truncateAction?.ui?.category).toBe('Transform');
    expect(truncateAction?.inputSchema).toBeDefined();
    expect(truncateAction?.outputSchema).toBeDefined();
    expect(splitAction?.outputSchema).toBeDefined();
  });

  it('Schema server action returns JSON schema by schemaRef (API delegates to server action). Mocks: non-target dependencies.', async () => {
    const result = await getWorkflowSchemaAction({ schemaRef: TEST_SCHEMA_REF });
    expect(result.ref).toBe(TEST_SCHEMA_REF);
    expect(result.schema).toBeDefined();
  });

  it('Schema server action returns 404 for unknown schemaRef. Mocks: non-target dependencies.', async () => {
    await expect(getWorkflowSchemaAction({ schemaRef: 'payload.Unknown.v1' })).rejects.toMatchObject({ status: 404 });
  });

  it('Registry server actions return examples/snippets when available. Mocks: non-target dependencies.', async () => {
    const nodeRegistry = getNodeTypeRegistry();
    const actionRegistry = getActionRegistryV2();
    const exampleNodeId = `test.exampleNode.${Date.now()}`;
    const exampleActionId = `test.exampleAction.${Date.now()}`;
    nodeRegistry.register({
      id: exampleNodeId,
      configSchema: getSchemaRegistry().get(TEST_SCHEMA_REF),
      handler: async (env: any) => env,
      ui: { label: 'Example', category: 'Test' },
      examples: { config: { state: 'READY' } }
    });
    actionRegistry.register({
      id: exampleActionId,
      version: 1,
      inputSchema: getSchemaRegistry().get(TEST_SCHEMA_REF),
      outputSchema: getSchemaRegistry().get(TEST_SCHEMA_REF),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Example Action', category: 'Test' },
      examples: { input: { foo: 'bar' } },
      handler: async (input) => input
    });

    const nodes = await listWorkflowRegistryNodesAction();
    const actions = await listWorkflowRegistryActionsAction();
    expect(nodes.find((node) => node.id === exampleNodeId)?.examples).toBeDefined();
    expect(actions.find((action) => action.id === exampleActionId)?.examples).toBeDefined();
  });

  it('Registry server actions are deterministic across process lifetime (no runtime mutation). Mocks: non-target dependencies.', async () => {
    const first = await listWorkflowRegistryNodesAction();
    const second = await listWorkflowRegistryNodesAction();
    expect(first).toEqual(second);
  });

  it('Start run creates workflow_run with status RUNNING, engine temporal, and initial nodePath. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, {
      workflowId,
      version: 1,
      payload: { foo: 'bar' },
      tenantId
    });
    const run = await WorkflowRunModelV2.getById(db, runId);
    expect(run?.status).toBe('RUNNING');
    expect(run?.node_path).toBe('root.steps[0]');
    expect(run?.engine).toBe('temporal');
  });

  it('Start run with explicit version uses that published version. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')], name: 'v1' });
    await publishWorkflow(workflowId, 1);
    await publishWorkflow(workflowId, 2, {
      id: workflowId,
      version: 2,
      name: 'v2',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [stateSetStep('state-2', 'READY')]
    });
    const runResult = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const run = await WorkflowRunModelV2.getById(db, runResult.runId);
    expect(run?.workflow_version).toBe(1);
  });

  it('Start run without version uses latest published version. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')], name: 'v1' });
    await publishWorkflow(workflowId, 1);
    await publishWorkflow(workflowId, 2, {
      id: workflowId,
      version: 2,
      name: 'v2',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [stateSetStep('state-2', 'READY')]
    });
    const runResult = await startWorkflowRunAction({ workflowId, payload: {} });
    const run = await WorkflowRunModelV2.getById(db, runResult.runId);
    expect(run?.workflow_version).toBe(2);
  });

  it('Start run launches a Temporal-backed workflow run and records the Temporal identifiers. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);

    const runResult = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const run = await WorkflowRunModelV2.getById(db, runResult.runId);

    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: runResult.runId,
        workflowId,
        workflowVersion: 1,
      })
    );
    expect(run?.engine).toBe('temporal');
    expect(run?.temporal_workflow_id).toBe('workflow-runtime-v2:run:run-replayed');
    expect(run?.temporal_run_id).toBe('temporal-run-replayed');
    expect(run?.status).toBe('RUNNING');
  });

  it('T045: no-trigger workflows still publish and launch correctly after time-trigger support is added. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      name: 'No trigger regression'
    });

    const publishResult = await publishWorkflow(workflowId, 1);
    expect(publishResult.ok).toBe(true);

    const runResult = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const run = await WorkflowRunModelV2.getById(db, runResult.runId);
    expect(run?.workflow_id).toBe(workflowId);
    expect(run?.workflow_version).toBe(1);
    expect(run?.status).toBe('RUNNING');
    expect(run?.engine).toBe('temporal');
    expect(run?.trigger_type ?? null).toBeNull();
  });

  it('Start run validates payload against payload schema and rejects invalid payloads. Mocks: non-target dependencies.', async () => {
    const registry = getSchemaRegistry();
    const strictRef = `payload.Strict.${Date.now()}`;
    registry.register(strictRef, z.object({ foo: z.string() }));
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')], payloadSchemaRef: strictRef });
    await publishWorkflow(workflowId, 1);
    await expect(startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { bar: 123 } })).rejects.toMatchObject({ status: 400 });
  });

  it('Start run strips implicit tenantId for manual runs when the workflow schema does not declare it. Mocks: non-target dependencies.', async () => {
    const registry = getSchemaRegistry();
    const strictEmptyRef = `payload.StrictEmpty.${Date.now()}`;
    registry.register(strictEmptyRef, z.object({}).strict());
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      payloadSchemaRef: strictEmptyRef
    });
    await publishWorkflow(workflowId, 1);

    const runResult = await startWorkflowRunAction({
      workflowId,
      workflowVersion: 1,
      payload: { tenantId: tenantId }
    });
    const run = await WorkflowRunModelV2.getById(db, runResult.runId);

    expect(run?.status).not.toBe('FAILED');
    expect(run?.input_json ?? {}).toEqual({});
    expect(run?.error_json ?? null).toBeNull();
  });

  it('Start run blocks execution when published workflow fails validation. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.echo', inputMapping: { value: 'ok' } })]
    });
    await publishWorkflow(workflowId, 1);

    const invalidDefinition = {
      id: workflowId,
      version: 1,
      name: 'Invalid',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'action-1',
          type: 'unknown.node',
          config: {}
        }
      ]
    };

    await WorkflowDefinitionVersionModelV2.update(db, workflowId, 1, {
      definition_json: invalidDefinition as any,
      validation_status: null,
      validation_errors: null,
      validation_warnings: null,
      validated_at: null
    });

    await expect(startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('Cancel run server action sets status CANCELED and releases waits (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    // Temporal owns wait creation now; seed the projection row a Temporal
    // activity would have written for an in-flight event wait.
    await WorkflowRunModelV2.update(db, run.runId, { status: 'WAITING' });
    await WorkflowRunWaitModelV2.create(db, {
      run_id: run.runId,
      tenant: tenantId,
      step_path: 'root.steps[0]',
      wait_type: 'event',
      key: 'key',
      event_name: 'PING',
      status: 'WAITING'
    });

    await cancelWorkflowRunAction({ runId: run.runId, reason: 'test cancel' });
    expect(cancelWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith({ runId: run.runId });

    const record = await WorkflowRunModelV2.getById(db, run.runId);
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(record?.status).toBe('CANCELED');
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((wait: any) => wait.status === 'CANCELED')).toBe(true);
  });

  it('Replay run server action creates a fresh Temporal-native run from the original input when payload is omitted. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const originalRun = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { foo: 'original' } });

    await WorkflowRunModelV2.update(db, originalRun.runId, { node_path: 'root.steps[99]' });
    startWorkflowRuntimeV2TemporalRunMock.mockClear();

    const replayResult = await replayWorkflowRunAction({
      runId: originalRun.runId,
      reason: 'replay for test'
    });

    expect(replayResult.ok).toBe(true);
    expect(replayResult.runId).not.toBe(originalRun.runId);

    const originalRecord = await WorkflowRunModelV2.getById(db, originalRun.runId);
    const replayRecord = await WorkflowRunModelV2.getById(db, replayResult.runId);

    expect(replayRecord?.workflow_id).toBe(originalRecord?.workflow_id);
    expect(replayRecord?.workflow_version).toBe(originalRecord?.workflow_version);
    // Omitted payload means "use the original run's input"; redacted Run
    // Studio projections never become the replay payload.
    expect(replayRecord?.input_json).toEqual({ foo: 'original' });
    expect(replayRecord?.input_json).toEqual(originalRecord?.input_json);
    expect(replayRecord?.node_path).toBe('root.steps[0]');
    expect(replayRecord?.engine).toBe('temporal');
    expect((replayRecord?.trigger_metadata_json as any)?.replayOfRunId).toBe(originalRun.runId);
    expect(replayRecord?.temporal_workflow_id).toBe('workflow-runtime-v2:run:run-replayed');
    expect(replayRecord?.temporal_run_id).toBe('temporal-run-replayed');
    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: replayResult.runId, workflowId })
    );
  });

  it('Replay run server action overrides the original input when an explicit payload is provided. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const originalRun = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { foo: 'original' } });

    const replayResult = await replayWorkflowRunAction({
      runId: originalRun.runId,
      reason: 'replay with override',
      payload: { foo: 'override' }
    });

    expect(replayResult.ok).toBe(true);
    const replayRecord = await WorkflowRunModelV2.getById(db, replayResult.runId);
    expect(replayRecord?.input_json).toEqual({ foo: 'override' });
  });

  it('Get run server action returns status, nodePath, and timestamps (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const record = await getWorkflowRunAction({ runId: run.runId });
    expect(record.status).toBeDefined();
    expect(record.node_path).toBeDefined();
    expect(record.started_at).toBeDefined();
  });

  it('List run steps server action returns step projection rows with attempts (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    // Step rows are written by Temporal activities now; seed the projection
    // row the interpreter would have produced.
    await WorkflowRunStepModelV2.create(db, {
      run_id: run.runId,
      tenant: tenantId,
      step_path: 'root.steps[0]',
      definition_step_id: 'state-1',
      status: 'SUCCEEDED',
      attempt: 1,
      duration_ms: 5,
      completed_at: new Date().toISOString()
    });

    const result = await listWorkflowRunStepsAction({ runId: run.runId });
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[0].attempt).toBeDefined();
    expect(result.steps[0].definition_step_id).toBe('state-1');
  });

  it('Run list/detail APIs reflect the launched run projection. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });

    const runList = await listWorkflowRunsAction({ runId: run.runId, limit: 10, cursor: 0, sort: 'started_at:desc' });
    expect(runList.runs.some((row: any) => row.run_id === run.runId && row.status === 'RUNNING')).toBe(true);

    const runDetail = await getWorkflowRunAction({ runId: run.runId });
    expect(runDetail.status).toBe('RUNNING');
    expect(runDetail.engine).toBe('temporal');
  });
});
