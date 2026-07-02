/**
 * Opening-balance CSV integration tests against the real local `server` DB.
 * Every DB test runs inside a transaction that is ALWAYS rolled back, so the
 * dev database is never mutated.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import {
  applyOpeningBalance,
  parseCsv,
  shapeOpeningBalanceRows,
  validateOpeningBalance,
} from './openingBalanceCsv';

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
let SER_SERVICE: string;
let LOCATION: string;
let LOCATION_NAME: string;
let USER: string;

beforeAll(async () => {
  const e = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: { host: 'localhost', port: 5432, user: e.DB_USER_ADMIN, password: e.DB_PASSWORD_ADMIN, database: 'server' },
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).whereRaw("NOT EXISTS (SELECT 1 FROM stock_levels sl WHERE sl.tenant = service_catalog.tenant AND sl.service_id = service_catalog.service_id) AND NOT EXISTS (SELECT 1 FROM stock_units su WHERE su.tenant = service_catalog.tenant AND su.service_id = service_catalog.service_id)").orderBy('service_id').limit(2).select('service_id'); // seed-independent: skip services carrying real stock
  SERVICE = svcs[0].service_id;
  SER_SERVICE = svcs[1].service_id;
  const location = await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first();
  LOCATION = location.location_id;
  LOCATION_NAME = location.name;
  USER = (await knex('users').where({ tenant: TENANT }).first()).user_id;
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

function suffix(id: string): string {
  return id.replace(/-/g, '').slice(0, 12).toUpperCase();
}

function aliases() {
  return {
    bulkSku: `OB-BULK-${suffix(SERVICE)}`,
    bulkName: `Opening Balance Bulk ${suffix(SERVICE)}`,
    serialSku: `OB-SER-${suffix(SER_SERVICE)}`,
    serialName: `Opening Balance Serial ${suffix(SER_SERVICE)}`,
  };
}

async function prepareCatalog(trx: Knex.Transaction) {
  const a = aliases();
  await trx('service_catalog')
    .where({ tenant: TENANT, service_id: SERVICE })
    .update({ sku: a.bulkSku, service_name: a.bulkName });
  await trx('service_catalog')
    .where({ tenant: TENANT, service_id: SER_SERVICE })
    .update({ sku: a.serialSku, service_name: a.serialName });
  await trx('product_inventory_settings')
    .where({ tenant: TENANT })
    .whereIn('service_id', [SERVICE, SER_SERVICE])
    .del();
  return a;
}

async function setupSettings(trx: Knex.Transaction, serviceId: string, serialized: boolean, averageCost = 0) {
  await trx('product_inventory_settings')
    .insert({
      tenant: TENANT,
      service_id: serviceId,
      track_stock: true,
      is_serialized: serialized,
      average_cost: averageCost,
      cost_currency: 'USD',
      default_location_id: LOCATION,
    })
    .onConflict(['tenant', 'service_id'])
    .merge({ track_stock: true, is_serialized: serialized, average_cost: averageCost, cost_currency: 'USD' });
}

async function onHand(trx: Knex.Transaction, serviceId: string, locationId: string) {
  const r = await trx('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: locationId }).first();
  return r ? Number(r.quantity_on_hand) : 0;
}

function header(): string {
  return 'sku,product,location,quantity,serial_number,mac_address,unit_cost';
}

describe('opening balance CSV parser and shaper', () => {
  it('parses quoted commas, doubled quotes, CRLF, and skips empty lines', () => {
    const parsed = parseCsv('sku,product,location\r\n"ABC,123","Widget ""Pro""",Main Warehouse\r\n\r\nXYZ,Plain,Van\r\n');
    expect(parsed.header).toEqual(['sku', 'product', 'location']);
    expect(parsed.rows).toEqual([
      ['ABC,123', 'Widget "Pro"', 'Main Warehouse'],
      ['XYZ', 'Plain', 'Van'],
    ]);
  });

  it('shapes quantity and cost errors while converting dollars to cents', () => {
    const parsed = parseCsv(`${header()}
SKU-1,,Main Warehouse,3,,,91.50
SKU-2,,Main Warehouse,0,,,
SKU-3,,Main Warehouse,2,SN-1,,
,,Main Warehouse,1,,,`);

    const shaped = shapeOpeningBalanceRows(parsed);
    expect(shaped.rows[0].unit_cost_cents).toBe(9150);
    expect(shaped.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        'quantity must be a positive integer',
        'serialized rows must have quantity empty or 1',
        'sku or product is required',
      ]),
    );
  });

  it('returns a single row-0 error above the 5000-row limit', () => {
    const parsed = parseCsv(`${header()}\n${Array.from({ length: 5001 }, () => 'SKU,,Main Warehouse,1,,,').join('\n')}`);
    const shaped = shapeOpeningBalanceRows(parsed);
    expect(shaped.rows).toEqual([]);
    expect(shaped.errors).toEqual([{ row: 0, message: 'CSV cannot contain more than 5000 data rows' }]);
  });
});

describe('opening balance validation and apply (real server DB, rolled back)', () => {
  it('reports unknown location and unknown product errors', async () => {
    await inTx(async (trx) => {
      const a = await prepareCatalog(trx);
      const csv = `${header()}
${a.bulkSku},,Missing Location,1,,,
NO-SUCH-SKU,,${LOCATION_NAME},1,,,`;

      const result = await validateOpeningBalance(trx, TENANT, csv);
      expect(result.ok).toBe(false);
      expect(result.errors.map((error) => error.message)).toEqual(
        expect.arrayContaining(['stock location not found', 'product not found']),
      );
    });
  });

  it('reports duplicate file serials and existing serials for the same service', async () => {
    await inTx(async (trx) => {
      const a = await prepareCatalog(trx);
      await setupSettings(trx, SER_SERVICE, true);
      await trx('stock_units').insert({
        tenant: TENANT,
        service_id: SER_SERVICE,
        serial_number: 'OB-EXISTS-1',
        status: 'in_stock',
        location_id: LOCATION,
      });
      const csv = `${header()}
${a.serialSku},,${LOCATION_NAME},1,OB-DUP-1,,
${a.serialSku},,${LOCATION_NAME},1,OB-DUP-1,,
${a.serialSku},,${LOCATION_NAME},1,OB-EXISTS-1,,`;

      const result = await validateOpeningBalance(trx, TENANT, csv);
      expect(result.ok).toBe(false);
      expect(result.errors.map((error) => error.message)).toEqual(
        expect.arrayContaining([
          'duplicate serial_number in file: OB-DUP-1',
          'serial already exists for product: OB-EXISTS-1',
        ]),
      );
    });
  });

  it('warns on additive bulk imports and counts missing settings to create', async () => {
    await inTx(async (trx) => {
      const a = await prepareCatalog(trx);
      await trx('stock_levels').insert({
        tenant: TENANT,
        service_id: SERVICE,
        location_id: LOCATION,
        quantity_on_hand: 4,
        reserved_quantity: 0,
        held_quantity: 0,
      });
      const csv = `${header()}
,${a.bulkName.toLowerCase()},${LOCATION_NAME},2,,,1.25
${a.serialSku},,${LOCATION_NAME},1,OB-SETTINGS-1,,5.00`;

      const result = await validateOpeningBalance(trx, TENANT, csv);
      expect(result.ok).toBe(true);
      expect(result.summary.settings_to_create).toBe(2);
      expect(result.summary.total_value_cents).toBe(750);
      expect(result.warnings).toEqual([
        { row: 1, message: 'location already has 4 on hand \u2014 import will ADD' },
      ]);
    });
  });

  it('rejects products without settings when missing-setting creation is disabled', async () => {
    await inTx(async (trx) => {
      const a = await prepareCatalog(trx);
      const csv = `${header()}
${a.bulkSku},,${LOCATION_NAME},1,,,`;

      const result = await validateOpeningBalance(trx, TENANT, csv, { create_missing_settings: false });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ row: 1, message: 'inventory not enabled for product' }]);
    });
  });

  it('applies one bulk row and two serialized rows as real receipts', async () => {
    await inTx(async (trx) => {
      const a = await prepareCatalog(trx);
      const csv = `${header()}
${a.bulkSku},,${LOCATION_NAME},3,,,2.50
${a.serialSku},,${LOCATION_NAME},1,OB-UNIT-1,AA:00:00:00:00:01,10.00
${a.serialSku},,${LOCATION_NAME},,OB-UNIT-2,AA:00:00:00:00:02,11.00`;

      const result = await applyOpeningBalance(trx, TENANT, USER, csv, { batch_label: 'vitest-opening-balance' });
      expect(result).toEqual({
        batch_label: 'vitest-opening-balance',
        receipts: 3,
        units_created: 2,
        settings_created: 2,
        total_value_cents: 2850,
      });

      expect(await onHand(trx, SERVICE, LOCATION)).toBe(3);
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(2);

      const units = await trx('stock_units')
        .where({ tenant: TENANT, service_id: SER_SERVICE, location_id: LOCATION, status: 'in_stock' })
        .whereIn('serial_number', ['OB-UNIT-1', 'OB-UNIT-2'])
        .orderBy('serial_number', 'asc');
      expect(units.map((unit) => [unit.serial_number, unit.mac_address, Number(unit.unit_cost)])).toEqual([
        ['OB-UNIT-1', 'AA:00:00:00:00:01', 1000],
        ['OB-UNIT-2', 'AA:00:00:00:00:02', 1100],
      ]);

      const movementCount = await trx('stock_movements')
        .where({ tenant: TENANT, reason: 'opening_balance_import: vitest-opening-balance' })
        .whereIn('service_id', [SERVICE, SER_SERVICE])
        .count<{ c: string }>('* as c')
        .first();
      expect(Number(movementCount?.c ?? 0)).toBe(3);

      const bulkSettings = await trx('product_inventory_settings')
        .where({ tenant: TENANT, service_id: SERVICE })
        .first();
      expect(Number(bulkSettings.average_cost)).toBe(250);
      expect(bulkSettings.is_serialized).toBe(false);

      const serialSettings = await trx('product_inventory_settings')
        .where({ tenant: TENANT, service_id: SER_SERVICE })
        .first();
      expect(serialSettings.is_serialized).toBe(true);
    });
  });

  it('throws without applying when validation fails', async () => {
    await inTx(async (trx) => {
      const csv = `${header()}
NO-SUCH-SKU,,${LOCATION_NAME},1,,,`;

      await expect(applyOpeningBalance(trx, TENANT, USER, csv)).rejects.toThrow(/row 1: product not found/);
      const movements = await trx('stock_movements')
        .where({ tenant: TENANT, reason: 'opening_balance_import: opening-balance' })
        .count<{ c: string }>('* as c')
        .first();
      expect(Number(movements?.c ?? 0)).toBe(0);
    });
  });
});
