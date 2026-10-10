import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../20261010120000_ticket_event_catalog_optional_user_id.cjs');

const legacy = {
  type: 'object',
  properties: { tenantId: { type: 'string' }, ticketId: { type: 'string' }, userId: { type: 'string', format: 'uuid' } },
  required: ['tenantId', 'ticketId', 'userId'],
};

function fakeKnex(initial: Record<string, any[]>) {
  const state = JSON.parse(JSON.stringify(initial));
  const updates: any[] = [];
  const knex: any = (table: string) => ({
    select: () => ({ whereIn: async () => state[table] }),
    where: (where: any) => ({
      update: async (data: any) => {
        updates.push({ table, where, data });
        const row = state[table].find((r: any) => r.event_id === where.event_id);
        row.payload_schema = data.payload_schema;
        return 1;
      },
    }),
  });
  knex.schema = {
    hasTable: async (t: string) => t in state,
    hasColumn: async () => true,
  };
  return { knex, updates, state };
}

describe('ticket event catalog optional userId migration', () => {
  it('drops userId from required, adds actor properties, and is idempotent', async () => {
    const { knex, updates, state } = fakeKnex({
      system_event_catalog: [{ event_id: 'e1', payload_schema: legacy }],
      event_catalog: [{ event_id: 'e2', tenant: 't1', payload_schema: JSON.stringify(legacy) }],
    });

    await migration.up(knex);
    expect(updates).toHaveLength(2);
    expect(updates[1].where).toEqual({ event_id: 'e2', tenant: 't1' });
    const patched = JSON.parse(state.system_event_catalog[0].payload_schema);
    expect(patched.required).toEqual(['tenantId', 'ticketId']);
    expect(patched.properties).toHaveProperty('actorType');
    expect(patched.properties).toHaveProperty('actorUserId');
    expect(patched.properties).toHaveProperty('actorContactId');

    await migration.up(knex);
    expect(updates).toHaveLength(2);
  });

  it('skips missing tables', async () => {
    const { knex, updates } = fakeKnex({});
    await migration.up(knex);
    expect(updates).toHaveLength(0);
  });
});
