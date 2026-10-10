import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261010120000_ticket_event_catalog_optional_user_id.cjs');
const TYPES = ['TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_CLOSED'];
const asObject = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);

describe('ticket event catalog optional userId migration (migrated PostgreSQL)', () => {
  let db: Knex;
  beforeAll(async () => { db = await createTestDbConnection(); }, 180_000);
  afterAll(async () => { await db?.destroy().catch(() => undefined); });

  it('the migrated catalog has optional userId and the actor properties', async () => {
    const rows = await db('system_event_catalog').select('event_type', 'payload_schema').whereIn('event_type', TYPES);
    expect(rows.length).toBe(TYPES.length);
    // Some catalog rows (e.g. TICKET_UPDATED) carry no inline JSON schema; nothing to patch there.
    const withSchema = rows.filter((r: any) => r.payload_schema);
    expect(withSchema.length).toBeGreaterThan(0);
    for (const row of withSchema) {
      const schema = asObject(row.payload_schema);
      expect(schema.required).not.toContain('userId');
      expect(schema.properties).toHaveProperty('userId');
      for (const k of ['actorType', 'actorUserId', 'actorContactId']) expect(schema.properties).toHaveProperty(k);
    }
  });

  it('re-patches a legacy row and a second run changes nothing (idempotent)', async () => {
    await db.transaction(async (trx) => {
      const [row] = await trx('system_event_catalog').select('event_id', 'payload_schema').where({ event_type: 'TICKET_CREATED' });
      const legacy = asObject(row.payload_schema);
      legacy.required = Array.from(new Set([...(legacy.required ?? []), 'userId']));
      for (const k of ['actorType', 'actorUserId', 'actorContactId']) delete legacy.properties[k];
      await trx('system_event_catalog').where({ event_id: row.event_id }).update({ payload_schema: JSON.stringify(legacy) });

      await migration.up(trx);
      const patched = asObject((await trx('system_event_catalog').where({ event_id: row.event_id }).first()).payload_schema);
      expect(patched.required).not.toContain('userId');
      expect(patched.properties).toHaveProperty('actorContactId');

      const before = await trx('system_event_catalog').select('event_id', 'payload_schema').whereIn('event_type', TYPES).orderBy('event_id');
      await migration.up(trx);
      const after = await trx('system_event_catalog').select('event_id', 'payload_schema').whereIn('event_type', TYPES).orderBy('event_id');
      expect(after).toEqual(before);
      await trx.rollback();
    }).catch((e) => { if (!/Transaction rejected|rollback/i.test(String(e?.message ?? e))) throw e; });
  });
});
