import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration: { down: (db: Knex.Transaction) => Promise<void> } =
  require('../../../../migrations/20261113000000_create_ticket_fixed_fee_services.cjs');

let db: Knex;

beforeAll(async () => {
  db = await createTestDbConnection();
}, 300_000);

afterAll(async () => {
  await db?.destroy();
});

describe('ticket fixed-fee migration rollback', () => {
  it.each([
    { originalApplied: true, tableRemains: true },
    { originalApplied: false, tableRemains: false },
  ])('preserves rows according to migration history (original applied: $originalApplied)', async ({ originalApplied, tableRemains }) => {
    await db.transaction(async (trx) => {
      await trx.raw('CREATE TEMPORARY TABLE knex_migrations (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP');
      await trx.raw('CREATE TEMPORARY TABLE ticket_fixed_fee_services (id integer PRIMARY KEY) ON COMMIT DROP');
      await trx('knex_migrations').insert({ id: 2, name: '20261113000000_create_ticket_fixed_fee_services.cjs' });
      if (originalApplied) {
        await trx('knex_migrations').insert({ id: 1, name: '20261028193400_create_ticket_fixed_fee_services.cjs' });
      }
      await trx('ticket_fixed_fee_services').insert({ id: 42 });

      const { rows } = await trx.raw(
        "SELECT to_regclass('ticket_fixed_fee_services') = to_regclass('pg_temp.ticket_fixed_fee_services') AS isolated",
      );
      expect(rows[0].isolated).toBe(true);

      await migration.down(trx);

      const result = await trx.raw("SELECT to_regclass('pg_temp.ticket_fixed_fee_services') IS NOT NULL AS present");
      expect(result.rows[0].present).toBe(tableRemains);
      if (tableRemains) {
        expect(await trx('ticket_fixed_fee_services').first()).toEqual({ id: 42 });
      }
    });
  });
});
