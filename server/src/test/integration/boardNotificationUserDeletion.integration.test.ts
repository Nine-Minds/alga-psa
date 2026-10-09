import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: vi.fn(async () => true),
  throwPermissionError: (action: string) => {
    throw new Error(`Permission denied: ${action}`);
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { deleteUser } from '../../../../packages/users/src/actions/user-actions/userActions';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'board_notification_rule_recipients').del();
  await tenantTable(tenantId, 'board_notification_rules').del();
  await tenantTable(tenantId, 'board_default_watchers').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function insertUser(tenantId: string, label: string) {
  const userId = uuidv4();
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `${label}-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `${label}-${userId.slice(0, 8)}@example.com`,
  });
  return userId;
}

describe('deleteUser board notification cleanup', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('removes rule-recipient and default-watcher rows and deletes the user', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    await tenantRows().insert({
      tenant: tenantId,
      client_name: `Tenant ${tenantId.slice(0, 8)}`,
      email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    });
    const actorId = await insertUser(tenantId, 'actor');
    const targetId = await insertUser(tenantId, 'target');
    const otherId = await insertUser(tenantId, 'other');

    const boardId = uuidv4();
    const ruleId = uuidv4();
    await tenantTable(tenantId, 'boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: 'Support',
      display_order: 10,
      is_default: true,
      is_inactive: false,
    });
    await tenantTable(tenantId, 'board_notification_rules').insert({
      tenant: tenantId,
      rule_id: ruleId,
      board_id: boardId,
      notify_on_create: true,
      is_enabled: true,
    });
    await tenantTable(tenantId, 'board_notification_rule_recipients').insert([
      { tenant: tenantId, rule_id: ruleId, recipient_type: 'user', user_id: targetId },
      { tenant: tenantId, rule_id: ruleId, recipient_type: 'user', user_id: otherId },
    ]);
    await tenantTable(tenantId, 'board_default_watchers').insert([
      { tenant: tenantId, board_id: boardId, user_id: targetId },
      { tenant: tenantId, board_id: boardId, user_id: otherId },
    ]);

    dbRef.knex = db;
    dbRef.tenant = tenantId;
    userRef.user = { user_id: actorId, user_type: 'internal', tenant: tenantId, roles: [] };

    const result = await deleteUser(targetId);

    expect(result).toMatchObject({ success: true, deleted: true });
    expect(await tenantTable(tenantId, 'users').where({ user_id: targetId }).first()).toBeFalsy();
    expect(await tenantTable(tenantId, 'board_notification_rule_recipients').where({ user_id: targetId })).toHaveLength(0);
    expect(await tenantTable(tenantId, 'board_default_watchers').where({ user_id: targetId })).toHaveLength(0);

    // Other users' rows are untouched.
    expect(await tenantTable(tenantId, 'board_notification_rule_recipients').where({ user_id: otherId })).toHaveLength(1);
    expect(await tenantTable(tenantId, 'board_default_watchers').where({ user_id: otherId })).toHaveLength(1);
  });
});
