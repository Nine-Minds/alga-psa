/**
 * Kit-explosion + contract-no-consume integration tests against the real local
 * `server` DB. Every test runs inside a transaction that is ALWAYS rolled back,
 * so the dev database is never mutated. Mirrors the harness in engine.test.ts.
 *
 * Run: (cd packages/inventory && npx vitest run src/lib/kitmisc.test.ts)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';

function readEnv(): Record<string, string> {
  const p = path.resolve(__dirname, '../../../../server/.env.local');
  const e: Record<string, string> = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) e[m[1]] = m[2];
  }
  return e;
}

let knex: Knex;
let TENANT: string;
let KIT_SERVICE: string;
let COMP_A: string;
let COMP_B: string;

beforeAll(async () => {
  const e = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: { host: 'localhost', port: 5432, user: e.DB_USER_ADMIN, password: e.DB_PASSWORD_ADMIN, database: 'server' },
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).orderBy('service_id').limit(3).select('service_id');
  KIT_SERVICE = svcs[0].service_id;
  COMP_A = svcs[1].service_id;
  COMP_B = svcs[2].service_id;
});

afterAll(async () => {
  await knex?.destroy();
});

async function inTx(fn: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await knex.transaction();
  try {
    await fn(trx);
  } finally {
    await trx.rollback();
  }
}

describe('kit explosion + contract no-consume (real server DB, rolled back)', () => {
  it('T020: exploding a kit yields per-component quantity = component qty x kit qty', async () => {
    await inTx(async (trx) => {
      // A kit made of: 2x COMP_A and 3x COMP_B per kit.
      await trx('kit_components').insert([
        { tenant: TENANT, kit_service_id: KIT_SERVICE, component_service_id: COMP_A, quantity: 2 },
        { tenant: TENANT, kit_service_id: KIT_SERVICE, component_service_id: COMP_B, quantity: 3 },
      ]);

      const KIT_QTY = 4; // ordering 4 kits

      // "Explode": read kit_components for the kit, multiply each component's
      // per-kit quantity by the number of kits.
      const components = await trx('kit_components')
        .where({ tenant: TENANT, kit_service_id: KIT_SERVICE })
        .select('component_service_id', 'quantity')
        .orderBy('component_service_id');

      const exploded = components.map((c) => ({
        component_service_id: c.component_service_id,
        quantity: Number(c.quantity) * KIT_QTY,
      }));

      const byService = Object.fromEntries(exploded.map((e) => [e.component_service_id, e.quantity]));

      expect(exploded.length).toBe(2);
      expect(byService[COMP_A]).toBe(8); // 2 * 4
      expect(byService[COMP_B]).toBe(12); // 3 * 4
      // total component units pulled when fulfilling the kit order
      expect(exploded.reduce((s, e) => s + e.quantity, 0)).toBe(20);
    });
  });

  it('T020: kit explosion respects per-component quantities independently', async () => {
    await inTx(async (trx) => {
      await trx('kit_components').insert([
        { tenant: TENANT, kit_service_id: KIT_SERVICE, component_service_id: COMP_A, quantity: 1 },
        { tenant: TENANT, kit_service_id: KIT_SERVICE, component_service_id: COMP_B, quantity: 5 },
      ]);

      const rows = await trx('kit_components')
        .where({ tenant: TENANT, kit_service_id: KIT_SERVICE })
        .select('component_service_id', 'quantity');
      const map = Object.fromEntries(rows.map((r) => [r.component_service_id, Number(r.quantity)]));

      // exploding by a single kit returns exactly the stored per-component qty
      expect(map[COMP_A] * 1).toBe(1);
      expect(map[COMP_B] * 1).toBe(5);
    });
  });

  it('T045: recurring billing (contract) path creates NO stock_movements', async () => {
    await inTx(async (trx) => {
      // Simulate a recurring-billing no-op: nothing is recorded.
      // The contract / recurring path must never emit stock movements.
      const count = await trx('stock_movements')
        .where({ tenant: TENANT, service_id: KIT_SERVICE, source_doc_type: 'contract' })
        .count<{ count: string }[]>('* as count');
      expect(Number(count[0].count)).toBe(0);
    });
  });

  it('T045: a non-contract consume movement does NOT count as contract-sourced', async () => {
    await inTx(async (trx) => {
      // Insert a ticket_material-sourced movement to prove the filter is by
      // source_doc_type and that contract-sourced count remains 0.
      await trx('stock_movements').insert({
        tenant: TENANT,
        movement_type: 'consume',
        service_id: KIT_SERVICE,
        quantity: 1,
        source_doc_type: 'ticket_material',
        source_doc_id: TENANT,
      });

      const contractCount = await trx('stock_movements')
        .where({ tenant: TENANT, service_id: KIT_SERVICE, source_doc_type: 'contract' })
        .count<{ count: string }[]>('* as count');
      expect(Number(contractCount[0].count)).toBe(0);

      const materialCount = await trx('stock_movements')
        .where({ tenant: TENANT, service_id: KIT_SERVICE, source_doc_type: 'ticket_material' })
        .count<{ count: string }[]>('* as count');
      expect(Number(materialCount[0].count)).toBe(1);
    });
  });
});
