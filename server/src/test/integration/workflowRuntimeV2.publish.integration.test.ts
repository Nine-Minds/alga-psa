import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
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
  submitWorkflowEventAction,
  cancelWorkflowRunAction,
  resumeWorkflowRunAction,
  replayWorkflowRunAction,
  getWorkflowRunAction,
  listWorkflowRunsAction,
  listWorkflowRunTimelineEventsAction,
  listWorkflowRunStepsAction,
  listWorkflowEventsAction
} from '@alga-psa/workflows/actions';
import WorkflowDefinitionVersionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionVersionModelV2';
import WorkflowDefinitionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionModelV2';
import WorkflowRunModelV2 from '@alga-psa/workflows/persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '@alga-psa/workflows/persistence/workflowRunStepModelV2';
import WorkflowRunWaitModelV2 from '@alga-psa/workflows/persistence/workflowRunWaitModelV2';
import WorkflowRuntimeEventModelV2 from '@alga-psa/workflows/persistence/workflowRuntimeEventModelV2';
import { WorkflowRuntimeV2, getActionRegistryV2, getNodeTypeRegistry, getSchemaRegistry } from '@alga-psa/workflows/runtime';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  actionCallStep,
  assignStep,
  stateSetStep,
  eventWaitStep,
  returnStep,
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

const actionRestores: Array<() => void> = [];

function stubAction(actionId: string, version: number, handler: any) {
  const registry = getActionRegistryV2();
  const action = registry.get(actionId, version);
  if (!action) throw new Error(`Missing action ${actionId}@${version}`);
  const original = action.handler;
  action.handler = handler;
  actionRestores.push(() => {
    action.handler = original;
  });
}

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

afterEach(() => {
  while (actionRestores.length > 0) {
    const restore = actionRestores.pop();
    if (restore) restore();
  }
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

  it('Runs remain pinned to their original published version when newer definitions are published before resume. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"pin-key"' } }),
        assignStep('assign-1', { 'payload.definitionMarker': { $expr: '"v1"' } }),
        returnStep('return-1')
      ]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waitingRecord = await WorkflowRunModelV2.getById(db, run.runId);
    expect(waitingRecord?.workflow_version).toBe(1);
    expect(waitingRecord?.status).toBe('WAITING');

    await publishWorkflow(workflowId, 2, {
      id: workflowId,
      version: 2,
      name: 'Pinned version test v2',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"pin-key"' } }),
        assignStep('assign-1', { 'payload.definitionMarker': { $expr: '"v2"' } }),
        returnStep('return-1')
      ]
    });

    const resumeResult = await submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'pin-key',
      payload: {}
    });
    expect(resumeResult.status).toBe('resumed');
    expect(resumeResult.runId).toBe(run.runId);

    const finalRun = await WorkflowRunModelV2.getById(db, run.runId);
    const stepHistory = await listWorkflowRunStepsAction({ runId: run.runId });
    const latestSnapshot = stepHistory.snapshots[stepHistory.snapshots.length - 1];

    expect(finalRun?.workflow_version).toBe(1);
    expect(finalRun?.status).toBe('SUCCEEDED');
    expect((latestSnapshot?.envelope_json as any)?.payload?.definitionMarker).toBe('v1');
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

  it('Start run creates workflow_run with status RUNNING and initial nodePath. Mocks: non-target dependencies.', async () => {
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

  it('Start run launches a Temporal-backed workflow run instead of executing through the legacy DB runtime. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);

    const executeRunSpy = vi.spyOn(WorkflowRuntimeV2.prototype, 'executeRun');
    executeRunSpy.mockClear();
    try {
      const runResult = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
      const run = await WorkflowRunModelV2.getById(db, runResult.runId);

      expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: runResult.runId,
          workflowId,
          workflowVersion: 1,
        })
      );
      expect(executeRunSpy).not.toHaveBeenCalled();
      expect(run?.engine).toBe('temporal');
      expect(run?.temporal_workflow_id).toBe('workflow-runtime-v2:run:run-replayed');
      expect(run?.temporal_run_id).toBe('temporal-run-replayed');
      expect(run?.status).toBe('RUNNING');
    } finally {
      executeRunSpy.mockRestore();
    }
  });

  it('T045: no-trigger workflows still publish and run correctly after time-trigger support is added. Mocks: non-target dependencies.', async () => {
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
    expect(run?.status).toBe('SUCCEEDED');
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

  it('Run execution inserts workflow_run_steps STARTED before step handler executes. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })]
    });
    await publishWorkflow(workflowId, 1);

    stubAction('test.sideEffect', 1, async (_input: any, ctx: any) => {
      const step = await WorkflowRunStepModelV2.getLatestByRunAndPath(db, ctx.runId, ctx.stepPath);
      expect(step?.status).toBe('STARTED');
      return { count: 1 };
    });

    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
  });

  it('Successful step updates workflow_run_steps to SUCCEEDED with duration and attempt count. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runResult = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const steps = await WorkflowRunStepModelV2.listByRun(db, runResult.runId);
    expect(steps[0].status).toBe('SUCCEEDED');
    expect(steps[0].attempt).toBe(1);
    expect(steps[0].duration_ms).toBeTypeOf('number');
  });

  it('Run completes with SUCCEEDED after last step executes. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runResult = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const run = await WorkflowRunModelV2.getById(db, runResult.runId);
    expect(run?.status).toBe('SUCCEEDED');
  });

  it('Unhandled error fails run with status FAILED. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'fail-1', actionId: 'test.fail', inputMapping: {} })]
    });
    await publishWorkflow(workflowId, 1);
    const result = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const run = await WorkflowRunModelV2.getById(db, result.runId);
    expect(run?.status).toBe('FAILED');
  });

  it('Interpreter resumes from persisted nodePath after simulated crash. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        actionCallStep({ id: 'first', actionId: 'test.sideEffect', inputMapping: {} }),
        actionCallStep({ id: 'second', actionId: 'test.sideEffect', inputMapping: {} })
      ]
    });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    await WorkflowRunModelV2.update(db, runId, { node_path: 'root.steps[1]' });

    let callCount = 0;
    stubAction('test.sideEffect', 1, async () => {
      callCount += 1;
      return { count: callCount };
    });

    await runtime.executeRun(db, runId, 'worker');
    expect(callCount).toBe(1);
  });

  it('Interpreter determinism: same inputs yield same outputs when time helpers are mocked. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [assignStep('assign-1', { 'payload.now': { $expr: 'nowIso()' } })] });
    await publishWorkflow(workflowId, 1);
    const fixed = '2025-01-01T00:00:00.000Z';
    const dateSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(fixed);

    const runA = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const runB = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });

    const snapshotsA = await listWorkflowRunStepsAction({ runId: runA.runId });
    const snapshotsB = await listWorkflowRunStepsAction({ runId: runB.runId });
    const lastA = snapshotsA.snapshots[snapshotsA.snapshots.length - 1] as any;
    const lastB = snapshotsB.snapshots[snapshotsB.snapshots.length - 1] as any;
    expect(lastA.envelope_json.payload.now).toBe(fixed);
    expect(lastB.envelope_json.payload.now).toBe(fixed);

    dateSpy.mockRestore();
  });

  it('control.return terminates the run immediately and skips remaining steps. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [returnStep('return-1'), actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const steps = await WorkflowRunStepModelV2.listByRun(db, run.runId);
    expect(steps).toHaveLength(1);
  });

  it('state.set updates env.meta.state and persists to run snapshot. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const result = await listWorkflowRunStepsAction({ runId: run.runId });
    const snapshot = result.snapshots[0] as any;
    expect(snapshot).toBeDefined();
    expect(snapshot.envelope_json.meta.state).toBe('READY');
  });

  it('transform.assign writes to payload paths as defined by assign map. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [assignStep('assign-1', { 'payload.foo': { $expr: '"bar"' } })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await listWorkflowRunStepsAction({ runId: run.runId });
    const lastSnapshot = snapshots.snapshots[snapshots.snapshots.length - 1];
    expect((lastSnapshot.envelope_json as any).payload.foo).toBe('bar');
  });

  it('action.call validates input schema before handler invocation. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'find_contact_by_email', inputMapping: { email: 'not-an-email' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const runRecord = await WorkflowRunModelV2.getById(db, run.runId);
    expect(runRecord?.status).toBe('FAILED');
  });

  it('action.call validates output schema before storing in payload. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.echo', inputMapping: { value: 'ok' }, saveAs: 'payload.output' })]
    });
    await publishWorkflow(workflowId, 1);
    stubAction('test.echo', 1, async () => 'invalid-output');
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('FAILED');
  });

  it('action.call saveAs stores output at specified payload path. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.echo', inputMapping: { value: 'ok' }, saveAs: 'payload.output' })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await listWorkflowRunStepsAction({ runId: run.runId });
    const lastSnapshot = snapshots.snapshots[snapshots.snapshots.length - 1];
    expect((lastSnapshot.envelope_json as any).payload.output.value).toBe('ok');
  });

  it('T041: ai.infer runtime output is still validated by the action output contract before persistence', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        {
          id: 'ai-step',
          type: 'action.call',
          config: {
            actionId: 'ai.infer',
            version: 1,
            inputMapping: {
              prompt: 'Classify this ticket',
            },
            saveAs: 'payload.classification',
            aiOutputSchemaMode: 'simple',
            aiOutputSchema: {
              type: 'object',
              properties: {
                category: { type: 'string' },
              },
              required: ['category'],
              additionalProperties: false,
            },
          },
        },
      ],
    });
    await publishWorkflow(workflowId, 1);
    stubAction('ai.infer', 1, async () => 'invalid-output');

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);

    expect(record?.status).toBe('FAILED');
  });

  it('T042: ai.infer outputs saved with saveAs are available to later steps through vars.<saveAs>', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        {
          id: 'ai-step',
          type: 'action.call',
          config: {
            actionId: 'ai.infer',
            version: 1,
            inputMapping: {
              prompt: 'Classify this ticket',
            },
            saveAs: 'classificationResult',
            aiOutputSchemaMode: 'simple',
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
          },
        },
        assignStep('assign-1', {
          'payload.aiCategory': { $expr: 'vars.classificationResult.category' },
          'payload.aiLabel': { $expr: 'vars.classificationResult.next_action.label' },
        }),
      ],
    });
    await publishWorkflow(workflowId, 1);
    stubAction('ai.infer', 1, async () => ({
      category: 'billing',
      next_action: {
        label: 'Escalate',
      },
    }));

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await listWorkflowRunStepsAction({ runId: run.runId });
    const lastSnapshot = snapshots.snapshots[snapshots.snapshots.length - 1];

    expect((lastSnapshot.envelope_json as any).payload.aiCategory).toBe('billing');
    expect((lastSnapshot.envelope_json as any).payload.aiLabel).toBe('Escalate');
  });

  it('onError=continue records error and continues to next step. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        actionCallStep({ id: 'fail-1', actionId: 'test.fail', inputMapping: {}, onError: { policy: 'continue' } }),
        stateSetStep('state-1', 'DONE')
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');
  });

  it('onError=fail stops execution or enters enclosing tryCatch. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        {
          id: 'try',
          type: 'control.tryCatch',
          try: [actionCallStep({ id: 'fail-1', actionId: 'test.fail', inputMapping: {} })],
          catch: [stateSetStep('state-1', 'RECOVERED')]
        }
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');
  });

  it('Cancel run server action sets status CANCELED and releases waits (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await cancelWorkflowRunAction({ runId: run.runId, reason: 'test cancel' });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(record?.status).toBe('CANCELED');
    expect(waits.every((wait: any) => wait.status === 'CANCELED')).toBe(true);
  });

  it('Resume run server action restarts WAITING runs with audit record (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await resumeWorkflowRunAction({ runId: run.runId, reason: 'test resume' });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    const events = await WorkflowRuntimeEventModelV2.list(db);
    expect(record?.status).toBe('SUCCEEDED');
    expect(events.some((event) => event.event_name === 'ADMIN_RESUME' && event.correlation_key === run.runId)).toBe(true);
  });

  it('Replay run server action creates a fresh Temporal-native run from original input instead of DB snapshot resume. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const originalRun = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { foo: 'original' } });

    await WorkflowRunModelV2.update(db, originalRun.runId, { node_path: 'root.steps[99]' });

    const replayResult = await replayWorkflowRunAction({
      runId: originalRun.runId,
      reason: 'replay for test',
      payload: {}
    });

    expect(replayResult.ok).toBe(true);
    expect(replayResult.runId).not.toBe(originalRun.runId);

    const originalRecord = await WorkflowRunModelV2.getById(db, originalRun.runId);
    const replayRecord = await WorkflowRunModelV2.getById(db, replayResult.runId);

    expect(replayRecord?.workflow_id).toBe(originalRecord?.workflow_id);
    expect(replayRecord?.workflow_version).toBe(originalRecord?.workflow_version);
    expect(replayRecord?.input_json).toEqual(originalRecord?.input_json);
    expect(replayRecord?.node_path).toBe('root.steps[0]');
    expect((replayRecord?.trigger_metadata_json as any)?.replayOfRunId).toBe(originalRun.runId);
    expect(replayRecord?.temporal_workflow_id).toBe('workflow-runtime-v2:run:run-replayed');
    expect(replayRecord?.temporal_run_id).toBe('temporal-run-replayed');
    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalled();
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

  it('List run steps server action returns ordered step history with attempts (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const result = await listWorkflowRunStepsAction({ runId: run.runId });
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[0].attempt).toBeDefined();
  });

  it('List run steps server action includes links to snapshots where available. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const result = await listWorkflowRunStepsAction({ runId: run.runId });
    expect(result.steps.some((step) => step.snapshot_id)).toBe(true);
  });

  it('Run list/detail/event APIs reflect run, step, wait, action, and event projection lifecycle data. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        actionCallStep({
          id: 'action-1',
          actionId: 'test.echo',
          inputMapping: { value: 'hello-world' },
          saveAs: 'echoResult'
        }),
        eventWaitStep('wait-1', {
          eventName: 'PING',
          correlationKeyExpr: { $expr: '"projection-key"' }
        }),
        returnStep('return-1')
      ]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });

    const waitingRun = await WorkflowRunModelV2.getById(db, run.runId);
    const waitingWaits = await db('workflow_run_waits').where({ run_id: run.runId, status: 'WAITING' });
    const waitingInvocations = await db('workflow_action_invocations').where({ run_id: run.runId });

    expect(waitingRun?.status).toBe('WAITING');
    expect(waitingWaits.length).toBeGreaterThan(0);
    expect(waitingInvocations.length).toBeGreaterThan(0);

    const eventResult = await submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'projection-key',
      payload: { source: 't020' }
    });

    expect(eventResult.status).toBe('resumed');
    expect(eventResult.runId).toBe(run.runId);

    const runRecord = await WorkflowRunModelV2.getById(db, run.runId);
    const stepRecords = await db('workflow_run_steps').where({ run_id: run.runId });
    const waitRecords = await db('workflow_run_waits').where({ run_id: run.runId });
    const invocationRecords = await db('workflow_action_invocations').where({ run_id: run.runId });
    const runtimeEventRecord = await db('workflow_runtime_events').where({ event_id: eventResult.eventId }).first();

    expect(runRecord?.status).toBe('SUCCEEDED');
    expect(stepRecords.length).toBeGreaterThan(0);
    expect(waitRecords.some((wait: any) => wait.wait_type === 'event' && wait.status === 'RESOLVED')).toBe(true);
    expect(invocationRecords.some((invocation: any) => invocation.action_id === 'test.echo' && invocation.status === 'SUCCEEDED')).toBe(true);
    expect(runtimeEventRecord).toBeDefined();
    expect(runtimeEventRecord?.matched_run_id).toBe(run.runId);

    const runList = await listWorkflowRunsAction({ runId: run.runId, limit: 10, cursor: 0, sort: 'started_at:desc' });
    expect(runList.runs.some((row: any) => row.run_id === run.runId && row.status === 'SUCCEEDED')).toBe(true);

    const runDetail = await getWorkflowRunAction({ runId: run.runId });
    expect(runDetail.status).toBe('SUCCEEDED');

    const runSteps = await listWorkflowRunStepsAction({ runId: run.runId });
    expect(runSteps.steps.length).toBeGreaterThan(0);
    expect(runSteps.waits.some((wait: any) => wait.wait_type === 'event' && wait.status === 'RESOLVED')).toBe(true);
    expect(runSteps.invocations.some((invocation: any) => invocation.action_id === 'test.echo' && invocation.status === 'SUCCEEDED')).toBe(true);

    const timeline = await listWorkflowRunTimelineEventsAction({ runId: run.runId });
    expect(timeline.events.some((event: any) => event.type === 'step')).toBe(true);
    expect(timeline.events.some((event: any) => event.type === 'wait' && event.wait_type === 'event')).toBe(true);

    const eventList = await listWorkflowEventsAction({ correlationKey: 'projection-key', limit: 10, cursor: 0 });
    expect(eventList.events.some((event: any) => event.event_id === eventResult.eventId && event.status === 'matched')).toBe(true);
  });

  it('Lease prevents concurrent execution by two workers for the same run. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    const first = await runtime.acquireRunnableRun(db, 'worker-a');
    const second = await runtime.acquireRunnableRun(db, 'worker-b');
    expect(first).toBe(runId);
    expect(second).toBeNull();
  });

  it('Scheduler reclaims stale leases and re-queues runs. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    await WorkflowRunModelV2.update(db, runId, { lease_owner: 'old', lease_expires_at: new Date(Date.now() - 1000).toISOString() });
    const acquired = await runtime.acquireRunnableRun(db, 'worker-new');
    expect(acquired).toBe(runId);
  });
});
