import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  listWorkflowRegistryNodesAction,
  listWorkflowRegistryActionsAction,
  getWorkflowSchemaAction,
  startWorkflowRunAction,
  cancelWorkflowRunAction,
  resumeWorkflowRunAction,
  getWorkflowRunAction,
  listWorkflowRunStepsAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '@shared/workflow/persistence/workflowRunStepModelV2';
import WorkflowRunWaitModelV2 from '@shared/workflow/persistence/workflowRunWaitModelV2';
import WorkflowRuntimeEventModelV2 from '@shared/workflow/persistence/workflowRuntimeEventModelV2';
import { WorkflowRuntimeV2, getActionRegistryV2, getNodeTypeRegistry, getSchemaRegistry } from '@shared/workflow/runtime';
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
    expect(result.errors?.some((err: any) => err.code === 'UNKNOWN_SCHEMA')).toBe(true);
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
    await WorkflowDefinitionModelV2.update(db, workflowId, {
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
    const trigger = { type: 'event', eventName: 'PING' };
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

  it('Start run validates payload against payload schema and rejects invalid payloads. Mocks: non-target dependencies.', async () => {
    const registry = getSchemaRegistry();
    const strictRef = `payload.Strict.${Date.now()}`;
    registry.register(strictRef, z.object({ foo: z.string() }));
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')], payloadSchemaRef: strictRef });
    await publishWorkflow(workflowId, 1);
    await expect(startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { bar: 123 } })).rejects.toMatchObject({ status: 400 });
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
