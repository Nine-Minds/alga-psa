import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../server/test-utils/eeMigrations';

const conn = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
  createTenantKnex: async () => ({ knex: conn.db }),
}));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import { createAgent } from '../../lib/mcp/agents';

const requireCjs = createRequire(import.meta.url);
const schema = requireCjs('../../../migrations/20261105100000_create_service_principals_schema.cjs');
const data = requireCjs('../../../migrations/20261105100200_migrate_agent_users_to_service.cjs');
const userTypes = requireCjs('../../../migrations/20261018090000_widen_users_user_type_check_for_service.cjs');
let db: Knex;
let mergedDir: string;

beforeAll(async () => {
  mergedDir = buildMergedEeMigrationsDir();
  db = await createTestDbConnection({ databaseName: 'sp_c4_rollback_test', migrationsDir: mergedDir });
  conn.db = db;
}, 600_000);

afterAll(async () => {
  await db?.destroy();
  if (mergedDir) rmSync(mergedDir, { recursive: true, force: true });
});

it('up → create agents → down preserves legacy identity and unrelated metadata', async () => {
  // Bootstrap ran up. Keep destructive down calls inside a rolled-back transaction.
  const trx = await db.transaction();
  conn.db = trx;
  try {
    const tenant = uuidv4();
    await trx('tenants').insert({ tenant, client_name: 'Rollback', email: `${tenant}@example.com` });
    const empty = await createAgent({ tenant, name: 'empty metadata' });
    expect(empty.metadata).toEqual({});
    const populated = await createAgent({ tenant, name: 'existing metadata' });
    await trx('agents').where({ tenant, agent_id: populated.agent_id }).update({
      metadata: { note: 'retain me', backing_user_id: uuidv4() },
    });

    await data.down(trx);
    await data.down(trx); // Retrying down must leave the restored bindings intact.
    await schema.down(trx);
    await userTypes.down(trx);

    expect(await trx.schema.hasColumn('agents', 'service_user_id')).toBe(false);
    expect(await trx.schema.hasTable('service_principals')).toBe(false);
    for (const agent of [empty, populated]) {
      const restored = await trx('agents').where({ tenant, agent_id: agent.agent_id }).first();
      expect(restored.metadata.backing_user_id).toBe(agent.service_user_id);
      expect(restored.active).toBe(true);
      const user = await trx('users').where({ tenant, user_id: restored.metadata.backing_user_id }).first();
      expect(user).toMatchObject({ user_type: 'internal', is_inactive: false, first_name: agent.name });
    }
    expect((await trx('agents').where({ tenant, agent_id: populated.agent_id }).first()).metadata.note).toBe('retain me');
  } finally {
    conn.db = db;
    await trx.rollback();
  }
});
