import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenant, createTestDbConnection, createUser } from './_dbTestUtils';

const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  deniedPermissions: new Set<string>(),
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();

  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) {
        throw new Error('DB unavailable for workflow data-store action test');
      }

      return runtimeState.db.transaction(async (trx) => {
        await trx.raw(`select set_config('app.current_tenant', ?, true)`, [runtimeState.tenantId]);
        return fn({
          tenantId: runtimeState.tenantId,
          actorUserId: runtimeState.actorUserId,
          trx,
        });
      });
    },
    requirePermission: async (ctx: any, _tx: any, permission: { resource: string; action: string }) => {
      const key = `${permission.resource}:${permission.action}`;
      if (!runtimeState.deniedPermissions.has(key)) return;
      throw {
        category: 'ActionError',
        code: 'PERMISSION_DENIED',
        message: `Missing permission ${key}`,
        details: { permission: key },
        nodePath: ctx?.stepPath ?? 'steps.data-store',
        at: new Date().toISOString(),
      };
    },
  };
});

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { WORKFLOW_STORE_MAX_VALUE_BYTES, registerDataStoreActions } from '../businessOperations/dataStore';
import { registerEntityLinkActions } from '../businessOperations/entityLinks';

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Record<string, unknown> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.data-store',
    idempotencyKey: uuidv4(),
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
    tenantId: runtimeState.tenantId,
    ...overrides,
  };
}

async function invokeAction(actionId: string, input: Record<string, unknown>, ctxOverrides: Record<string, unknown> = {}) {
  const action = getAction(actionId);
  const parsedInput = action.inputSchema.parse(input);
  return action.handler(parsedInput, actionCtx(ctxOverrides) as any);
}

describe('workflow data-store business operation actions', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;
    runtimeState.tenantId = await createTenant(db, 'Workflow Data Store Action Tenant');
    runtimeState.actorUserId = await createUser(db, runtimeState.tenantId, {
      email: 'workflow-data-store-action@example.com',
    });

    const registry = getActionRegistryV2();
    if (!registry.get('store.get', 1)) {
      registerDataStoreActions();
    }
    if (!registry.get('links.lookup', 1)) {
      registerEntityLinkActions();
    }
  }, 120_000);

  afterAll(async () => {
    runtimeState.db = null;
    await db?.destroy();
  });

  beforeEach(async () => {
    runtimeState.deniedPermissions.clear();
    await db('workflow_entity_links').del();
    await db('workflow_data_store').del();
    await db('audit_logs').where({ tenant: runtimeState.tenantId }).del();
  });

  it('T014: store.set/get/list/increment/delete actions operate tenant-scoped rows and write audit rows', async () => {
    await expect(invokeAction('store.set', {
      namespace: 'runtime-smoke',
      key: 'cursor',
      value: { lastSeen: 'A' },
      value_type: 'json',
      idempotency_key: 'set-cursor',
    })).resolves.toEqual({ revision: 1, created: true });

    await expect(invokeAction('store.get', {
      namespace: 'runtime-smoke',
      key: 'cursor',
    })).resolves.toMatchObject({
      found: true,
      value: { lastSeen: 'A' },
      value_type: 'json',
      revision: 1,
    });

    await expect(invokeAction('store.increment', {
      namespace: 'runtime-smoke',
      key: 'counter',
      initial: 2,
      by: 3,
      idempotency_key: 'increment-counter',
    })).resolves.toMatchObject({ value: 5, revision: 1 });

    await expect(invokeAction('store.list', {
      namespace: 'runtime-smoke',
      limit: 10,
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ key: 'counter', value: 5 }),
        expect.objectContaining({ key: 'cursor', value: { lastSeen: 'A' } }),
      ]),
      next_cursor: null,
    });

    await expect(invokeAction('store.list_namespaces', {})).resolves.toEqual({
      namespaces: [{ namespace: 'runtime-smoke', key_count: 2 }],
    });

    await expect(invokeAction('store.delete', {
      namespace: 'runtime-smoke',
      key: 'cursor',
      idempotency_key: 'delete-cursor',
    })).resolves.toEqual({ deleted: true });

    const audits = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, table_name: 'workflow_runs' })
      .orderBy('timestamp', 'asc');
    expect(audits.map((row) => row.operation)).toEqual([
      'store.set',
      'store.increment',
      'store.delete',
    ]);
  });

  it('T005/F005: store.get treats expired rows as not-found and store.set raises CONFLICT on CAS mismatch', async () => {
    await invokeAction('store.set', {
      namespace: 'ttl',
      key: 'soon',
      value: true,
      ttl_seconds: 1,
      idempotency_key: 'ttl-soon',
    });
    await db('workflow_data_store')
      .where({ tenant: runtimeState.tenantId, namespace: 'ttl', key: 'soon' })
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() });

    await expect(invokeAction('store.get', {
      namespace: 'ttl',
      key: 'soon',
    })).resolves.toEqual({ found: false, value: null, value_type: null, revision: null, expires_at: null });

    await invokeAction('store.set', {
      namespace: 'cas',
      key: 'guard',
      value: 'v1',
      idempotency_key: 'cas-create',
    });
    await expect(invokeAction('store.set', {
      namespace: 'cas',
      key: 'guard',
      value: 'stale',
      if_revision: 0,
      idempotency_key: 'cas-conflict',
    })).rejects.toMatchObject({ category: 'ActionError', code: 'CONFLICT' });
  });

  it('T014/T015: links.upsert/lookup/list/delete actions support forward and reverse mirror flows', async () => {
    const upsert = await invokeAction('links.upsert', {
      namespace: 'project-task-mirror',
      left: { type: 'project_task', id: 'task-a' },
      right: { type: 'project_task', id: 'task-b' },
      relation: 'mirrors',
      attributes: { sourceProjectId: 'project-a' },
      idempotency_key: 'link-task-a-task-b',
    });
    expect(upsert).toMatchObject({ link_id: expect.any(String), created: true });

    await expect(invokeAction('links.lookup', {
      namespace: 'project-task-mirror',
      from: { type: 'project_task', id: 'task-a' },
      direction: 'forward',
      relation: 'mirrors',
    })).resolves.toMatchObject({
      matches: [{ id: 'task-b', type: 'project_task', relation: 'mirrors', attributes: { sourceProjectId: 'project-a' } }],
    });

    await expect(invokeAction('links.lookup', {
      namespace: 'project-task-mirror',
      from: { type: 'project_task', id: 'task-b' },
      direction: 'reverse',
      relation: 'mirrors',
    })).resolves.toMatchObject({
      matches: [{ id: 'task-a', type: 'project_task', relation: 'mirrors' }],
    });

    await expect(invokeAction('links.list', {
      namespace: 'project-task-mirror',
      relation: 'mirrors',
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ left: { type: 'project_task', id: 'task-a' }, right: { type: 'project_task', id: 'task-b' } })],
      next_cursor: null,
    });
    await expect(invokeAction('links.list_namespaces', {})).resolves.toEqual({
      namespaces: [{ namespace: 'project-task-mirror', link_count: 1 }],
    });
    await expect(invokeAction('links.delete', {
      namespace: 'project-task-mirror',
      left: { type: 'project_task', id: 'task-a' },
      relation: 'mirrors',
      idempotency_key: 'delete-link',
    })).resolves.toEqual({ deleted_count: 1 });
  });

  it('T010: store.set rejects oversize values with ValidationError', async () => {
    await expect(invokeAction('store.set', {
      namespace: 'limits',
      key: 'oversize',
      value: 'x'.repeat(WORKFLOW_STORE_MAX_VALUE_BYTES + 1),
      idempotency_key: 'oversize',
    })).rejects.toMatchObject({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
    });
  });

  it('T011: read and write actions enforce workflow read/manage permissions', async () => {
    runtimeState.deniedPermissions.add('workflow:read');
    await expect(invokeAction('store.get', {
      namespace: 'permission',
      key: 'read',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(invokeAction('links.lookup', {
      namespace: 'permission',
      from: { type: 'project_task', id: 'a' },
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    runtimeState.deniedPermissions.clear();
    runtimeState.deniedPermissions.add('workflow:manage');
    await expect(invokeAction('store.set', {
      namespace: 'permission',
      key: 'write',
      value: true,
      idempotency_key: 'permission-write',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(invokeAction('links.upsert', {
      namespace: 'permission',
      left: { type: 'project_task', id: 'a' },
      right: { type: 'project_task', id: 'b' },
      idempotency_key: 'permission-link',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('T012: write actions derive stable action-provided idempotency keys', () => {
    const ctx = actionCtx({ idempotencyKey: 'engine-key' }) as any;

    for (const actionId of ['store.set', 'store.increment', 'links.upsert']) {
      const action = getAction(actionId);
      expect(action.idempotency.mode).toBe('actionProvided');
      if (action.idempotency.mode !== 'actionProvided') throw new Error(`${actionId} should be actionProvided`);
      expect(action.idempotency.key({ idempotency_key: `${actionId}:provided` }, ctx)).toBe(`${actionId}:provided`);
      expect(action.idempotency.key({}, ctx)).toBe(`run:${ctx.runId}:${ctx.stepPath}`);
    }
  });
});
