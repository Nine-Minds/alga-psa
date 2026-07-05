/**
 * Stock-low edge trigger tests against the real local `server` DB.
 * Every test runs in a rolled-back transaction; stock_movements is append-only
 * in production, but these rows are only visible inside the test transaction.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexLib, { Knex } from 'knex';

import { recordStockConsumption } from './consume';
import { recordStockMovement } from './movements';
import {
  collectDefaultLocationStockLowSignalAfterConsume,
  collectStockLowSignalAfterConsume,
} from './stockLowSignal';

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
let LOCATION: string;

beforeAll(async () => {
  const e = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: { host: 'localhost', port: 5432, user: e.DB_USER_ADMIN, password: e.DB_PASSWORD_ADMIN, database: 'server' },
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
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

async function makeProduct(
  trx: Knex.Transaction,
  label: string,
  opts: { serialized?: boolean; reorderPoint?: number | null; quantity?: number },
): Promise<string> {
  const typeRow = await trx('service_catalog')
    .where({ tenant: TENANT })
    .whereNotNull('custom_service_type_id')
    .first('custom_service_type_id');
  const [svc] = await trx('service_catalog')
    .insert({
      tenant: TENANT,
      service_name: `ZZ Stock Low ${label}`,
      sku: label,
      item_kind: 'product',
      billing_method: 'per_unit',
      default_rate: 1000,
      is_active: true,
      custom_service_type_id: typeRow.custom_service_type_id,
    })
    .returning('service_id');

  await trx('product_inventory_settings')
    .insert({
      tenant: TENANT,
      service_id: svc.service_id,
      track_stock: true,
      is_serialized: Boolean(opts.serialized),
      reorder_point: opts.reorderPoint ?? null,
      cost_currency: 'USD',
      default_location_id: LOCATION,
      average_cost: 500,
    });

  if ((opts.quantity ?? 0) > 0) {
    await recordStockMovement(trx, TENANT, {
      movement_type: 'receipt',
      service_id: svc.service_id,
      quantity: opts.quantity ?? 0,
      to_location_id: LOCATION,
    });
  }

  return svc.service_id;
}

describe('stock-low signal collection (real DB, rolled back)', () => {
  it('returns a signal only when non-serialized on-hand crosses down to the reorder point', async () => {
    await inTx(async (trx) => {
      const serviceId = await makeProduct(trx, `edge-${randomUUID().slice(0, 8)}`, {
        reorderPoint: 3,
        quantity: 5,
      });

      await recordStockConsumption(trx, TENANT, {
        service_id: serviceId,
        quantity: 2,
        source_doc_type: 'ticket_material',
        source_doc_id: randomUUID(),
      });

      const signal = await collectDefaultLocationStockLowSignalAfterConsume(trx, TENANT, serviceId, 2);
      expect(signal).toMatchObject({
        tenant: TENANT,
        service_id: serviceId,
        location_id: LOCATION,
        on_hand: 3,
        reorder_point: 3,
      });

      await recordStockConsumption(trx, TENANT, {
        service_id: serviceId,
        quantity: 1,
        source_doc_type: 'ticket_material',
        source_doc_id: randomUUID(),
      });
      await expect(collectDefaultLocationStockLowSignalAfterConsume(trx, TENANT, serviceId, 1)).resolves.toBeNull();
    });
  });

  it('skips products without a threshold and serialized products', async () => {
    await inTx(async (trx) => {
      const withoutThreshold = await makeProduct(trx, `none-${randomUUID().slice(0, 8)}`, {
        reorderPoint: null,
        quantity: 2,
      });
      await recordStockConsumption(trx, TENANT, {
        service_id: withoutThreshold,
        quantity: 1,
        source_doc_type: 'ticket_material',
        source_doc_id: randomUUID(),
      });
      await expect(collectStockLowSignalAfterConsume(trx, TENANT, withoutThreshold, LOCATION, 1)).resolves.toBeNull();

      const serialized = await makeProduct(trx, `ser-${randomUUID().slice(0, 8)}`, {
        serialized: true,
        reorderPoint: 1,
        quantity: 0,
      });
      await expect(collectStockLowSignalAfterConsume(trx, TENANT, serialized, LOCATION, 1)).resolves.toBeNull();
    });
  });
});
