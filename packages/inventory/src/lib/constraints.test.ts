/**
 * Schema-constraint tests against the real local `server` DB, rolled back:
 * serial uniqueness (per product), MAC uniqueness (tenant-wide), and the
 * single-default-location partial unique index.
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
let SERVICE: string;
let SERVICE2: string;

beforeAll(async () => {
  const e = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: { host: 'localhost', port: 5472, user: e.DB_USER_ADMIN, password: e.DB_PASSWORD_ADMIN, database: 'server' },
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT }).limit(2).select('service_id');
  SERVICE = svcs[0].service_id;
  SERVICE2 = svcs[1].service_id;
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

describe('inventory schema constraints (real server DB, rolled back)', () => {
  it('T002a: duplicate serial within (tenant, service_id) is rejected', async () => {
    await inTx(async (trx) => {
      await trx('stock_units').insert({ tenant: TENANT, service_id: SERVICE, serial_number: 'DUP-SERIAL', status: 'in_stock' });
      await expect(
        trx('stock_units').insert({ tenant: TENANT, service_id: SERVICE, serial_number: 'DUP-SERIAL', status: 'in_stock' }),
      ).rejects.toThrow();
    });
  });

  it('T002b: duplicate MAC across DIFFERENT products is rejected (tenant-wide MAC uniqueness)', async () => {
    await inTx(async (trx) => {
      await trx('stock_units').insert({ tenant: TENANT, service_id: SERVICE, serial_number: 'MAC-A', mac_address: 'AA:BB:CC:DD:EE:FF', status: 'in_stock' });
      await expect(
        trx('stock_units').insert({ tenant: TENANT, service_id: SERVICE2, serial_number: 'MAC-B', mac_address: 'AA:BB:CC:DD:EE:FF', status: 'in_stock' }),
      ).rejects.toThrow();
    });
  });

  it('T002c: the same serial IS allowed for a different product (serial is per-product)', async () => {
    await inTx(async (trx) => {
      await trx('stock_units').insert({ tenant: TENANT, service_id: SERVICE, serial_number: 'SHARED-SN', status: 'in_stock' });
      // different product, same serial -> allowed
      await trx('stock_units').insert({ tenant: TENANT, service_id: SERVICE2, serial_number: 'SHARED-SN', status: 'in_stock' });
      const n = await trx('stock_units').where({ tenant: TENANT, serial_number: 'SHARED-SN' }).count<{ c: string }>('* as c').first();
      expect(Number(n?.c)).toBe(2);
    });
  });

  it('T003: a second default stock_location for the tenant is rejected', async () => {
    await inTx(async (trx) => {
      // one default ("Main Warehouse") already exists from the migration seed
      await expect(
        trx('stock_locations').insert({ tenant: TENANT, name: 'Second Default', location_type: 'warehouse', is_default: true, is_active: true }),
      ).rejects.toThrow();
    });
  });
});
