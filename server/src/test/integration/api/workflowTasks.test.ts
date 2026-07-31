/**
 * Real-DB integration tests for the EE workflow task-inbox `*ForApi` cores that back the
 * v1 `/workflows/tasks` API (`getUserTasksForApi`, `getTaskDetailsForApi`,
 * `submitTaskFormForApi`, `claimTaskForApi`/`unclaimTaskForApi`).
 *
 * Why call the cores directly instead of the routes: under Vitest the route's
 * `@alga-psa/user-activities/server/workflow-task-actions` import resolves to the CE stub
 * (the EE alias is a next.config concern, not a Vitest one), so route-level workflow-task
 * tests only ever see CE behavior. The real EE logic lives in `taskInboxCore`, exercised
 * here directly under the test transaction.
 *
 * Schema notes (verified against server/migrations):
 *  - `workflow_tasks` was dropped + recreated by the 2025-05-11 consolidation migration with
 *    `task_definition_type` + (`system_task_definition_task_type` | `tenant_task_definition_id`)
 *    and a CHECK constraint. The system task definitions `qbo_mapping_error` / `workflow_error`
 *    are seeded globally by that migration, so list/claim tasks can reference them without
 *    seeding a tenant definition.
 *  - The 2025-05-11 consolidation migration dropped `claimed_at` / `claimed_by`, which
 *    `WorkflowTaskModel.updateTaskStatus(CLAIMED)` still writes;
 *    20260626120000_readd_claimed_columns_to_workflow_tasks restores them, so the
 *    claim/unclaim round-trip below is active.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';

if (typeof (globalThis as any).AsyncLocalStorage === 'undefined') {
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

const dbRef = vi.hoisted(() => ({ db: null as any, tenant: '' }));

// Route the EE cores' createTenantKnex at the per-test transaction (the cores import it
// from @alga-psa/db, which TestContext does not mock).
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: dbRef.db, tenant: dbRef.tenant })),
    getConnection: vi.fn(async () => dbRef.db),
  };
});

// The task model publishes search events through the event bus; keep it off Redis.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import {
  getUserTasksForApi,
  getTaskDetailsForApi,
  submitTaskFormForApi,
  claimTaskForApi,
  unclaimTaskForApi,
} from '@alga-psa/workflows/actions/workflow-actions/taskInboxCore';
import { WorkflowTaskStatus, FormStatus } from '@alga-psa/workflows/persistence';
import { getFormRegistry } from '@shared/task-inbox';

const SYSTEM_TASK_TYPE = 'qbo_mapping_error'; // seeded globally by the consolidation migration

describe('Workflow task-inbox EE cores (v1 /workflows/tasks backend)', () => {
  const testHelpers = TestContext.createHelpers();

  let ctx: TestContext;
  let tenantId = '';
  let userId = '';

  beforeAll(async () => {
    ctx = await testHelpers.beforeAll({
      cleanupTables: [
        'workflow_task_history',
        'workflow_tasks',
        'workflow_task_definitions',
        'workflow_form_schemas',
        'workflow_form_definitions',
      ],
    });
    tenantId = ctx.tenantId;
    userId = ctx.userId;
    dbRef.db = ctx.db;
    dbRef.tenant = tenantId;
  }, 120_000);

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  beforeEach(async () => {
    ctx = await testHelpers.beforeEach();
    tenantId = ctx.tenantId;
    userId = ctx.userId;
    dbRef.db = ctx.db;
    dbRef.tenant = tenantId;
  });

  afterEach(async () => {
    await testHelpers.afterEach();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Seed a workflow_tasks row backed by the global SYSTEM task definition. */
  async function seedSystemTask(overrides: Record<string, unknown> = {}): Promise<string> {
    const taskId = uuidv4();
    await ctx.db('workflow_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      execution_id: uuidv4(),
      task_definition_type: 'system',
      system_task_definition_task_type: SYSTEM_TASK_TYPE,
      tenant_task_definition_id: null,
      title: 'System task',
      status: WorkflowTaskStatus.PENDING,
      priority: 'medium',
      assigned_users: JSON.stringify([userId]),
      ...overrides,
    });
    return taskId;
  }

  /**
   * Seed a tenant form (via the production FormRegistry), a tenant task definition that
   * references it, and a workflow_tasks row bound to that definition. Returns the ids.
   */
  async function seedTenantTaskWithForm(jsonSchema: Record<string, any>): Promise<{
    taskId: string;
    formId: string;
    taskDefinitionId: string;
  }> {
    const formId = `test-form-${uuidv4()}`;
    await getFormRegistry().register(
      ctx.db,
      tenantId,
      {
        formId,
        name: `Test Form ${formId}`,
        version: '1.0',
        status: FormStatus.ACTIVE,
        jsonSchema,
      },
      userId,
    );

    const taskDefinitionId = uuidv4();
    await ctx.db('workflow_task_definitions').insert({
      task_definition_id: taskDefinitionId,
      tenant: tenantId,
      name: `Test Task Def ${taskDefinitionId}`,
      task_type: `test-task-type-${taskDefinitionId}`, // NOT NULL on workflow_task_definitions
      description: 'tenant task definition for tests',
      form_id: formId,
      form_type: 'tenant',
      default_priority: 'medium',
      default_sla_days: 3,
      created_by: userId,
    });

    const taskId = uuidv4();
    await ctx.db('workflow_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      execution_id: uuidv4(),
      task_definition_type: 'tenant',
      tenant_task_definition_id: taskDefinitionId,
      system_task_definition_task_type: null,
      title: 'Tenant task',
      status: WorkflowTaskStatus.PENDING,
      priority: 'medium',
      assigned_users: JSON.stringify([userId]),
    });

    return { taskId, formId, taskDefinitionId };
  }

  // ── getUserTasksForApi ───────────────────────────────────────────────────────

  it('returns a pending task assigned to the user', async () => {
    const taskId = await seedSystemTask({ title: 'Assigned to me' });

    const result = await getUserTasksForApi(ctx.user, tenantId, {
      status: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
    });

    const ids = result.tasks.map((t) => t.taskId);
    expect(ids).toContain(taskId);
    const seeded = result.tasks.find((t) => t.taskId === taskId)!;
    expect(seeded.title).toBe('Assigned to me');
    expect(seeded.status).toBe(WorkflowTaskStatus.PENDING);
    expect(seeded.assignedUsers).toEqual([userId]);
  });

  // ── claimable pool: workflow `human.task` nodes create UNASSIGNED tasks; the inbox must
  //    surface them (and tasks the user has claimed) alongside directly-assigned ones. ──
  it('returns an unassigned pending task (the open claimable pool)', async () => {
    const taskId = await seedSystemTask({
      title: 'Unassigned pool',
      assigned_users: null,
      assigned_roles: null,
    });

    const result = await getUserTasksForApi(ctx.user, tenantId, {
      status: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
    });

    expect(result.tasks.map((t) => t.taskId)).toContain(taskId);
  });

  it('excludes a pending task assigned to another user (not me, my roles, or the pool)', async () => {
    const taskId = await seedSystemTask({
      title: 'Someone else',
      assigned_users: JSON.stringify([uuidv4()]),
      assigned_roles: null,
    });

    const result = await getUserTasksForApi(ctx.user, tenantId, {
      status: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
    });

    expect(result.tasks.map((t) => t.taskId)).not.toContain(taskId);
  });

  it('returns a task the user has claimed even when it carries no assignment', async () => {
    // A pool task claimed by the user: status CLAIMED, no assigned_users, claimed_by = me.
    const taskId = await seedSystemTask({
      title: 'Claimed from the pool',
      assigned_users: null,
      assigned_roles: null,
      status: WorkflowTaskStatus.CLAIMED,
      claimed_by: userId,
    });

    const result = await getUserTasksForApi(ctx.user, tenantId, {
      status: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
    });

    expect(result.tasks.map((t) => t.taskId)).toContain(taskId);
  });

  it('excludes a hidden (dismissed) unassigned task from the pool', async () => {
    const taskId = await seedSystemTask({
      title: 'Hidden pool task',
      assigned_users: null,
      assigned_roles: null,
      is_hidden: true,
    });

    const result = await getUserTasksForApi(ctx.user, tenantId, {
      status: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
    });

    expect(result.tasks.map((t) => t.taskId)).not.toContain(taskId);
  });

  // ── getTaskDetailsForApi ──────────────────────────────────────────────────────

  it('returns full task details including the resolved form schema', async () => {
    const jsonSchema = {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    };
    const { taskId, formId } = await seedTenantTaskWithForm(jsonSchema);

    const details = await getTaskDetailsForApi(ctx.user, tenantId, taskId);

    expect(details.taskId).toBe(taskId);
    expect(details.title).toBe('Tenant task');
    expect(details.formId).toBe(formId);
    expect(details.formSchema).toBeTruthy();
    expect(details.formSchema!.jsonSchema).toMatchObject({ type: 'object' });
  });

  it('throws when the task does not exist', async () => {
    await expect(getTaskDetailsForApi(ctx.user, tenantId, uuidv4())).rejects.toThrow(/not found/i);
  });

  // ── submitTaskFormForApi (validation failure path) ───────────────────────────

  it('rejects a form submission whose data violates the form schema', async () => {
    // Schema requires `reason`; submit empty data → FormRegistry.validateFormData fails.
    const jsonSchema = {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    };
    const { taskId } = await seedTenantTaskWithForm(jsonSchema);

    await expect(
      submitTaskFormForApi(ctx.user, tenantId, { taskId, formData: {} }),
    ).rejects.toThrow(/validation failed/i);

    // The task must remain not-completed since submission was rejected.
    const row = await ctx.db('workflow_tasks').where({ tenant: tenantId, task_id: taskId }).first();
    expect(row.status).toBe(WorkflowTaskStatus.PENDING);
  });

  // ── claim / unclaim round-trip ───────────────────────────────────────────────
  // `WorkflowTaskModel.updateTaskStatus(CLAIMED)` writes `claimed_at`/`claimed_by`; the
  // 2025-05-11 consolidation migration had dropped those columns, and
  // 20260626120000_readd_claimed_columns_to_workflow_tasks restores them.
  it('claims then unclaims a task', async () => {
    const taskId = await seedSystemTask({ title: 'Claimable' });

    await claimTaskForApi(ctx.user, tenantId, taskId);
    let row = await ctx.db('workflow_tasks').where({ tenant: tenantId, task_id: taskId }).first();
    expect(row.status).toBe(WorkflowTaskStatus.CLAIMED);
    expect(row.claimed_by).toBe(userId);

    await unclaimTaskForApi(ctx.user, tenantId, taskId);
    row = await ctx.db('workflow_tasks').where({ tenant: tenantId, task_id: taskId }).first();
    expect(row.status).toBe(WorkflowTaskStatus.PENDING);
  });
});
