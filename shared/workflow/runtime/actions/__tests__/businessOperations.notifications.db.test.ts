import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection, createTenant, createUser } from './_dbTestUtils';

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

const runtimeState = vi.hoisted(() => ({ db: null as Knex | null, tenantId: '', actorUserId: '' }));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) throw new Error('DB unavailable for test runtime state');
      return runtimeState.db.transaction(async (trx) => {
        await trx.raw(`select set_config('app.current_tenant', ?, true)`, [runtimeState.tenantId]);
        return fn({ tenantId: runtimeState.tenantId, actorUserId: runtimeState.actorUserId, trx });
      });
    },
    requirePermission: async () => undefined,
  };
});

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerNotificationActions } from '../businessOperations/notifications';

async function sendInApp(recipients: Record<string, unknown>) {
  const action = getActionRegistryV2().get('notifications.send_in_app', 1);
  if (!action) throw new Error('Missing notifications.send_in_app@1');
  const parsed = action.inputSchema.parse({ recipients, title: 'Hi', body: 'Body' });
  return action.handler(parsed, {
    runId: uuidv4(),
    stepPath: 'steps.notify',
    idempotencyKey: uuidv4(),
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
    tenantId: runtimeState.tenantId,
  } as any) as Promise<{ notification_ids: string[]; delivered_count: number }>;
}

async function recipientsOf(db: Knex, ids: string[]) {
  const rows = await tenantTable(db, runtimeState.tenantId, 'internal_notifications').whereIn('internal_notification_id', ids).select('user_id');
  return rows.map((r: any) => r.user_id).sort();
}

describe('notifications.send_in_app recipients (DB-backed)', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;
    if (!getActionRegistryV2().get('notifications.send_in_app', 1)) registerNotificationActions();
  }, 120000);

  afterAll(async () => {
    runtimeState.db = null;
    if (db) await db.destroy();
  });

  beforeEach(async () => {
    runtimeState.tenantId = await createTenant(db, 'Notification Test Tenant');
    runtimeState.actorUserId = await createUser(db, runtimeState.tenantId);
  });

  it('T15: user_ids, role_ids and role_names create the same rows as before, including inactive and client users', async () => {
    const tid = runtimeState.tenantId;
    const active = await createUser(db, tid);
    const inactive = await createUser(db, tid, { is_inactive: true });
    const client = await createUser(db, tid, { user_type: 'client' });
    const viaId = await createUser(db, tid);
    const viaName = await createUser(db, tid);
    const roleId = uuidv4();
    const nameRoleId = uuidv4();
    await tenantTable(db, tid, 'roles').insert([
      { tenant: tid, role_id: roleId, role_name: 'Dispatch', msp: true },
      { tenant: tid, role_id: nameRoleId, role_name: 'Technician', msp: true },
    ]);
    await tenantTable(db, tid, 'user_roles').insert([
      { tenant: tid, role_id: roleId, user_id: viaId },
      { tenant: tid, role_id: nameRoleId, user_id: viaName },
      { tenant: tid, role_id: nameRoleId, user_id: client },
    ]);

    const out = await sendInApp({
      user_ids: [active, inactive, active],
      role_ids: [roleId],
      role_names: ['TECHNICIAN'],
    });
    expect(out.delivered_count).toBe(5);
    expect(await recipientsOf(db, out.notification_ids)).toEqual([active, inactive, client, viaId, viaName].sort());
  });

  it('T15: an unknown user id still fails with NOT_FOUND and an empty spec with VALIDATION_ERROR', async () => {
    const missing = uuidv4();
    await expect(sendInApp({ user_ids: [missing] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { missing_user_ids: [missing] },
    });
    await expect(sendInApp({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
