import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenant, createTestDbConnection, createUser } from './_dbTestUtils';
import { WorkflowRuntimeV2 } from '../../runtime/workflowRuntimeV2';
import { initializeWorkflowRuntimeV2 } from '../../init';
import WorkflowDefinitionModelV2 from '../../../persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '../../../persistence/workflowDefinitionVersionModelV2';
import WorkflowRunModelV2 from '../../../persistence/workflowRunModelV2';
import WorkflowRunSnapshotModelV2 from '../../../persistence/workflowRunSnapshotModelV2';

// End-to-end: drive the V2 runtime ENGINE (not action handlers directly) through the
// two reference workflows, validating cross-run Data Store handoff and control.forEach
// fan-out over a 1:N mirror. Uses store/link primitives in place of the heavyweight
// projects.* actions from the real bundle so the test exercises the same engine
// mechanics (namespace/relation/entity-type are identical to production) without
// seeding projects/phases/statuses. (PRD "Test plan" T015 / F020.)

const WORKER = 'engine-ref-test-worker';
const NAMESPACE = 'project-task-mirror';
const ENTITY_TYPE = 'project_task';
const RELATION = 'mirrors';
const APPLIED_NAMESPACE = 'mirror-applied';

const linkSetupDefinition = (id: string) => ({
  id,
  version: 1,
  name: 'ref-project-task-mirror-link-setup',
  payloadSchemaRef: 'payload.ProjectTaskCreated.v1',
  trigger: { type: 'event', eventName: 'PROJECT_TASK_CREATED' },
  steps: [
    { id: 'state-linking', type: 'state.set', config: { state: 'LINKING' } },
    {
      id: 'for-each-target',
      type: 'control.forEach',
      items: { $expr: 'payload.targets' },
      itemVar: 'target',
      body: [
        {
          id: 'upsert-link',
          type: 'action.call',
          config: {
            actionId: 'links.upsert',
            version: 1,
            inputMapping: {
              namespace: NAMESPACE,
              from: { type: ENTITY_TYPE, id: { $expr: 'payload.sourceId' } },
              to: { type: ENTITY_TYPE, id: { $expr: 'vars.target' } },
              relation: RELATION,
              idempotency_key: { $expr: "'mirror:' & payload.sourceId & ':' & vars.target" },
            },
          },
        },
      ],
      onItemError: 'fail',
    },
    { id: 'done', type: 'control.return' },
  ],
});

const mirrorSyncDefinition = (id: string) => ({
  id,
  version: 1,
  name: 'ref-project-task-mirror-sync',
  payloadSchemaRef: 'payload.ProjectTaskUpdated.v1',
  trigger: { type: 'event', eventName: 'PROJECT_TASK_UPDATED' },
  steps: [
    { id: 'state-syncing', type: 'state.set', config: { state: 'SYNCING' } },
    {
      id: 'lookup-linked',
      type: 'action.call',
      config: {
        actionId: 'links.lookup',
        version: 1,
        inputMapping: {
          namespace: NAMESPACE,
          from: { type: ENTITY_TYPE, id: { $expr: 'payload.sourceId' } },
          direction: 'forward',
          relation: RELATION,
          limit: 200,
        },
        saveAs: 'vars.linkedTasks',
      },
    },
    {
      id: 'for-each-linked',
      type: 'control.forEach',
      items: { $expr: 'vars.linkedTasks.matches' },
      itemVar: 'match',
      body: [
        {
          id: 'apply-update',
          type: 'action.call',
          config: {
            actionId: 'store.set',
            version: 1,
            inputMapping: {
              namespace: APPLIED_NAMESPACE,
              key: { $expr: 'vars.match.id' },
              value: { $expr: 'payload.title' },
              idempotency_key: { $expr: "'applied:' & vars.match.id" },
            },
          },
        },
      ],
      onItemError: 'fail',
    },
    { id: 'done', type: 'control.return' },
  ],
});

async function seedRbac(db: Knex, tenant: string, userId: string): Promise<void> {
  const roleId = uuidv4();
  await db('roles').insert({ tenant, role_id: roleId, role_name: 'Workflow Engine Test Role', msp: true, client: false });
  await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  for (const action of ['read', 'manage']) {
    const permissionId = uuidv4();
    await db('permissions').insert({ tenant, permission_id: permissionId, resource: 'workflow', action, msp: true, client: false });
    await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
  }
}

async function registerDefinition(
  db: Knex,
  tenant: string,
  actorUserId: string,
  build: (id: string) => Record<string, unknown>
): Promise<string> {
  const workflowId = uuidv4();
  const definition = build(workflowId);
  await WorkflowDefinitionModelV2.create(db, tenant, {
    workflow_id: workflowId,
    name: definition.name as string,
    payload_schema_ref: definition.payloadSchemaRef as string,
    draft_definition: definition as any,
    draft_version: 1,
    status: 'published',
    created_by: actorUserId,
  });
  await WorkflowDefinitionVersionModelV2.create(db, {
    workflow_id: workflowId,
    tenant,
    version: 1,
    definition_json: definition as any,
    published_by: actorUserId,
  });
  return workflowId;
}

describe('V2 engine reference workflows (cross-run data-store handoff)', () => {
  let db: Knex;
  let tenant: string;
  let actor: string;
  const runtime = new WorkflowRuntimeV2();

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = await createTenant(db, 'Workflow Engine Reference Tenant');
    actor = await createUser(db, tenant, { email: `wf-engine.${uuidv4()}@example.com`, user_type: 'internal' });
    await seedRbac(db, tenant, actor);
    initializeWorkflowRuntimeV2();
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db('workflow_entity_links').where({ tenant }).del();
    await db('workflow_data_store').where({ tenant }).del();
    await db('audit_logs').where({ tenant }).del();
  });

  it('T015: link-setup persists N links; a separate mirror run forEach-applies one effect per linked match', async () => {
    const sourceId = 'task-source-1';
    const targets = ['task-target-a', 'task-target-b', 'task-target-c'];

    const setupWorkflowId = await registerDefinition(db, tenant, actor, linkSetupDefinition);
    const syncWorkflowId = await registerDefinition(db, tenant, actor, mirrorSyncDefinition);

    // Run 1: link-setup. forEach upserts one mirror link per target.
    const run1 = await runtime.startRun(db, {
      workflowId: setupWorkflowId,
      version: 1,
      tenantId: tenant,
      engine: 'db',
      payload: { sourceId, targets },
    });
    await runtime.executeRun(db, run1, WORKER);

    expect((await WorkflowRunModelV2.getById(db, run1, tenant))?.status).toBe('SUCCEEDED');
    const links = await db('workflow_entity_links')
      .where({ tenant, namespace: NAMESPACE, relation: RELATION, left_type: ENTITY_TYPE, left_id: sourceId });
    expect(links).toHaveLength(targets.length);
    expect(links.map((row: any) => row.right_id).sort()).toEqual([...targets].sort());

    // Run 2: a SEPARATE run reads links written by run 1, then forEach over matches.
    const run2 = await runtime.startRun(db, {
      workflowId: syncWorkflowId,
      version: 1,
      tenantId: tenant,
      engine: 'db',
      payload: { sourceId, title: 'updated-title' },
    });
    await runtime.executeRun(db, run2, WORKER);

    expect((await WorkflowRunModelV2.getById(db, run2, tenant))?.status).toBe('SUCCEEDED');

    // Cross-run handoff + forEach fan-out: exactly one store entry per matched target.
    const applied = await db('workflow_data_store').where({ tenant, namespace: APPLIED_NAMESPACE });
    expect(applied.map((row: any) => row.key).sort()).toEqual([...targets].sort());

    // The lookup genuinely saw N matches in the engine envelope.
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run2, tenant);
    const matchCounts = snapshots
      .map((snap: any) => (snap.envelope_json?.vars?.linkedTasks?.matches as unknown[] | undefined)?.length)
      .filter((n): n is number => typeof n === 'number');
    expect(Math.max(0, ...matchCounts)).toBe(targets.length);

    // Real audit path ran for the writes inside both runs.
    const auditOps = await db('audit_logs').where({ tenant }).pluck('operation');
    expect(auditOps).toContain('links.upsert');
    expect(auditOps).toContain('store.set');
  }, 120_000);

  it('T015: mirror run with no matching links succeeds and applies nothing', async () => {
    const syncWorkflowId = await registerDefinition(db, tenant, actor, mirrorSyncDefinition);

    const run = await runtime.startRun(db, {
      workflowId: syncWorkflowId,
      version: 1,
      tenantId: tenant,
      engine: 'db',
      payload: { sourceId: 'task-with-no-links', title: 'noop' },
    });
    await runtime.executeRun(db, run, WORKER);

    expect((await WorkflowRunModelV2.getById(db, run, tenant))?.status).toBe('SUCCEEDED');
    const applied = await db('workflow_data_store').where({ tenant, namespace: APPLIED_NAMESPACE });
    expect(applied).toHaveLength(0);
  }, 120_000);
});
