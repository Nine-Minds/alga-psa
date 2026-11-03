import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

let db: Knex;
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => db) }));

import { createAgent } from '@ee/lib/mcp/agents';

const timeout = 120_000;
let tenant: string;

describe('MCP agent seat admission', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = randomUUID();
    await db('tenants').insert({
      tenant, client_name: 'MCP seat test', email: `${tenant}@example.test`,
      product_code: 'psa', plan: 'pro', licensed_user_count: 2,
    });
  }, timeout);

  afterAll(async () => { await db?.destroy(); }, timeout);

  it('admits the backing user and creates the active agent when a seat is available', async () => {
    const agent = await createAgent({ tenant, name: 'Seat test agent' });
    const backingUserId = (agent.metadata as { backing_user_id: string }).backing_user_id;
    const user = await db('users').where({ tenant, user_id: backingUserId }).first();

    expect(agent.active).toBe(true);
    expect(user).toMatchObject({ user_type: 'internal', is_inactive: false });
  });

  it('rejects at capacity and rolls back the backing user, roles, and agent', async () => {
    const current = await db('users').where({ tenant, user_type: 'internal', is_inactive: false });
    for (let i = current.length; i < 2; i++) {
      await db('users').insert({
        tenant, user_id: randomUUID(), username: `existing-${i}`, email: `existing-${i}@example.test`,
        first_name: 'Existing', last_name: 'User', user_type: 'internal', is_inactive: false,
        hashed_password: 'unused',
      });
    }

    await expect(createAgent({ tenant, name: 'Rejected agent', roleIds: [randomUUID()] }))
      .rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED' });

    expect(await db('agents').where({ tenant, name: 'Rejected agent' })).toHaveLength(0);
    expect(await db('users').where({ tenant }).whereLike('username', 'mcp-agent-%')).toHaveLength(1);
    expect(await db('user_roles').where({ tenant })).toHaveLength(0);
    expect(await db('agent_roles').where({ tenant })).toHaveLength(0);
  });
});
