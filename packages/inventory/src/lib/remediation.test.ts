/**
 * Remediation-plan integration tests (2026-07-01 plan) against the real local
 * `server` DB. Every test runs inside a transaction that is ALWAYS rolled back —
 * except the concurrency suite, which needs two live transactions and cleans up
 * after itself.
 *
 * Covers the DB-enforceable plan tests: CHECK constraints (T014), locking
 * mechanics (T002/T003's SQL patterns), reconcile of reserved/held (T008),
 * ledger immutability (T024), FKs + indexes (T023), vendor price-list
 * constraints (T027), landed-cost math invariants (T032 math), cycle-count
 * tables (T029 schema paths), and vendor-bill lifecycle constraints (T034).
 * Action-level flows (withAuth) need a session harness — see SCRATCHPAD.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { reconcileStockLevels, computeAllocationsFromTruth } from './reconcile';
import { recordStockMovement } from './movements';
import { getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let SERVICE: string;
let SER_SERVICE: string;
let LOCATION: string;
let CLIENT: string;
let VENDOR: string;

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({
    client: 'pg',
    connection: databaseConnection,
    pool: { min: 1, max: 6 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT }).orderBy('service_id').limit(2).select('service_id');
  SERVICE = svcs[0].service_id;
  SER_SERVICE = svcs[1].service_id;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first())?.client_id;
  VENDOR = (await knex('vendors').where({ tenant: TENANT }).first())?.vendor_id;
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

/**
 * Assert a statement violates a constraint WITHOUT aborting the enclosing test
 * transaction (Postgres poisons the txn after any error — savepoints contain it).
 */
async function expectViolation(trx: Knex.Transaction, fn: () => Promise<unknown>, re: RegExp) {
  await trx.raw('SAVEPOINT sp');
  let error: unknown = null;
  try {
    await fn();
  } catch (e) {
    error = e;
  } finally {
    await trx.raw('ROLLBACK TO SAVEPOINT sp');
  }
  expect(error, 'expected the statement to be rejected').not.toBeNull();
  expect(String((error as Error).message)).toMatch(re);
}

async function makeSo(trx: Knex.Transaction, opts?: { allocation_mode?: string; status?: string }) {
  const [so] = await trx('sales_orders')
    .insert({
      tenant: TENANT,
      so_number: `TSO-${Math.floor(Math.random() * 1e9)}`,
      client_id: CLIENT,
      status: opts?.status ?? 'confirmed',
      order_date: trx.fn.now(),
      currency_code: 'USD',
      invoice_mode: 'manual',
      allocation_mode: opts?.allocation_mode ?? 'soft',
    })
    .returning('*');
  return so;
}

describe.skipIf(!databaseConnection)('T014 — CHECK constraints reject drifted quantities', () => {
  it('rejects negative reserved/held on stock_levels', async () => {
    await inTx(async (trx) => {
      await expect(
        trx('stock_levels')
          .insert({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION, quantity_on_hand: 0, reserved_quantity: -1, held_quantity: 0 })
          .onConflict(['tenant', 'service_id', 'location_id'])
          .merge({ reserved_quantity: -1 }),
      ).rejects.toThrow(/chk_stock_levels_alloc_nonneg/);
    });
  });

  it('quantity_on_hand deliberately stays unconstrained (soft consume)', async () => {
    await inTx(async (trx) => {
      await trx('stock_levels')
        .insert({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION, quantity_on_hand: -3, reserved_quantity: 0, held_quantity: 0 })
        .onConflict(['tenant', 'service_id', 'location_id'])
        .merge({ quantity_on_hand: -3 });
      const row = await trx('stock_levels').where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).first();
      expect(Number(row.quantity_on_hand)).toBe(-3);
    });
  });

  it('rejects zero-quantity SO lines and fulfilled/invoiced > ordered', async () => {
    await inTx(async (trx) => {
      const so = await makeSo(trx, { status: 'draft' });
      await expectViolation(
        trx,
        () =>
          trx('sales_order_lines').insert({
            tenant: TENANT, so_id: so.so_id, service_id: SERVICE,
            quantity_ordered: 0, quantity_fulfilled: 0, quantity_invoiced: 0, unit_price: 100, fulfillment_type: 'from_stock',
          }),
        /chk_so_lines_quantities/,
      );
      await expectViolation(
        trx,
        () =>
          trx('sales_order_lines').insert({
            tenant: TENANT, so_id: so.so_id, service_id: SERVICE,
            quantity_ordered: 2, quantity_fulfilled: 3, quantity_invoiced: 0, unit_price: 100, fulfillment_type: 'from_stock',
          }),
        /chk_so_lines_quantities/,
      );
    });
  });

  it('rejects non-positive transfer line quantities', async () => {
    await inTx(async (trx) => {
      const [transfer] = await trx('stock_transfers')
        .insert({ tenant: TENANT, from_location_id: LOCATION, to_location_id: LOCATION, status: 'dispatched', dispatched_at: trx.fn.now() })
        .returning('*');
      await expect(
        trx('stock_transfer_lines').insert({ tenant: TENANT, transfer_id: transfer.transfer_id, service_id: SERVICE, quantity: 0 }),
      ).rejects.toThrow(/chk_transfer_lines_quantity/);
    });
  });
});

describe.skipIf(!databaseConnection)('T024 — stock_movements is append-only (trigger)', () => {
  it('rejects UPDATE and DELETE, allows INSERT', async () => {
    await inTx(async (trx) => {
      const movement = await recordStockMovement(trx, TENANT, {
        movement_type: 'receipt', service_id: SERVICE, quantity: 1, to_location_id: LOCATION,
      });
      await expectViolation(
        trx,
        () => trx('stock_movements').where({ tenant: TENANT, movement_id: movement.movement_id }).update({ reason: 'tamper' }),
        /append-only/,
      );
      await expectViolation(
        trx,
        () => trx('stock_movements').where({ tenant: TENANT, movement_id: movement.movement_id }).del(),
        /append-only/,
      );
    });
  });
});

describe.skipIf(!databaseConnection)('T023 — hardened FKs and indexes', () => {
  it('rejects an orphan tax_rate_id on SO lines', async () => {
    await inTx(async (trx) => {
      const so = await makeSo(trx, { status: 'draft' });
      await expect(
        trx('sales_order_lines').insert({
          tenant: TENANT, so_id: so.so_id, service_id: SERVICE,
          quantity_ordered: 1, quantity_fulfilled: 0, quantity_invoiced: 0, unit_price: 100,
          fulfillment_type: 'from_stock', tax_rate_id: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow(/fk_so_lines_tax_rate/);
    });
  });

  it('rejects an orphan allocated_so_line_id on stock_units', async () => {
    await inTx(async (trx) => {
      await expect(
        trx('stock_units').insert({
          tenant: TENANT, service_id: SER_SERVICE, serial_number: `SN-FK-${Math.floor(Math.random() * 1e9)}`,
          status: 'in_stock', location_id: LOCATION,
          allocated_so_line_id: '00000000-0000-0000-0000-000000000002',
        }),
      ).rejects.toThrow(/fk_stock_units_allocated_so_line/);
    });
  });

  it('hot-path indexes exist', async () => {
    const rows = await knex.raw(`
      SELECT indexname FROM pg_indexes WHERE indexname IN
      ('idx_stock_levels_location','idx_sales_orders_client','idx_sales_orders_status',
       'idx_purchase_orders_vendor','idx_purchase_orders_status','idx_invoice_charges_so_line')
    `);
    expect(rows.rows.length).toBe(6);
  });
});

describe.skipIf(!databaseConnection)('T002/T003 mechanics — locking prevents double-claim and overshoot', () => {
  it('FOR UPDATE SKIP LOCKED: two transactions cannot pick the same unit', async () => {
    const serial = `SN-LOCK-${Math.floor(Math.random() * 1e9)}`;
    const [unit] = await knex('stock_units')
      .insert({ tenant: TENANT, service_id: SER_SERVICE, serial_number: serial, status: 'in_stock', location_id: LOCATION })
      .returning('*');
    const t1 = await knex.transaction();
    const t2 = await knex.transaction();
    try {
      const pick1 = await t1('stock_units')
        .where({ tenant: TENANT, unit_id: unit.unit_id, status: 'in_stock' })
        .forUpdate().skipLocked();
      const pick2 = await t2('stock_units')
        .where({ tenant: TENANT, unit_id: unit.unit_id, status: 'in_stock' })
        .forUpdate().skipLocked();
      // Exactly one transaction sees the unit; the other skips the locked row.
      expect(pick1.length + pick2.length).toBe(1);
    } finally {
      await t1.rollback();
      await t2.rollback();
      await knex('stock_units').where({ tenant: TENANT, unit_id: unit.unit_id }).del();
    }
  });

  it('SQL-capped counter: concurrent bumps cannot exceed quantity_ordered', async () => {
    // Committed fixture (two live transactions need to see it), cleaned up after.
    const [so] = await knex('sales_orders')
      .insert({
        tenant: TENANT, so_number: `TSO-CAP-${Math.floor(Math.random() * 1e9)}`, client_id: CLIENT,
        status: 'confirmed', order_date: knex.fn.now(), currency_code: 'USD', invoice_mode: 'manual', allocation_mode: 'soft',
      })
      .returning('*');
    const [line] = await knex('sales_order_lines')
      .insert({
        tenant: TENANT, so_id: so.so_id, service_id: SERVICE,
        quantity_ordered: 5, quantity_fulfilled: 0, quantity_invoiced: 0, unit_price: 100, fulfillment_type: 'from_stock',
      })
      .returning('*');
    try {
      // Two "fulfillments" of 3 each — the second must be rejected by the cap.
      const bump = (qty: number) =>
        knex('sales_order_lines')
          .where({ tenant: TENANT, so_line_id: line.so_line_id })
          .andWhereRaw('quantity_fulfilled + ? <= quantity_ordered', [qty])
          .update({ quantity_fulfilled: knex.raw('quantity_fulfilled + ?', [qty]) });
      const [first, second] = await Promise.all([bump(3), bump(3)]);
      expect(first + second).toBe(1); // exactly one succeeded
      const after = await knex('sales_order_lines').where({ tenant: TENANT, so_line_id: line.so_line_id }).first();
      expect(Number(after.quantity_fulfilled)).toBe(3);
    } finally {
      await knex('sales_order_lines').where({ tenant: TENANT, so_id: so.so_id }).del();
      await knex('sales_orders').where({ tenant: TENANT, so_id: so.so_id }).del();
    }
  });
});

describe.skipIf(!databaseConnection)('T008 — reconcile recomputes reserved/held from open SO lines', () => {
  it('repairs manufactured drift and honors allocation_mode', async () => {
    await inTx(async (trx) => {
      // Manufacture drift: a counter with no backing reservation.
      await trx('stock_levels')
        .insert({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION, quantity_on_hand: 10, reserved_quantity: 7, held_quantity: 4 })
        .onConflict(['tenant', 'service_id', 'location_id'])
        .merge({ quantity_on_hand: 10, reserved_quantity: 7, held_quantity: 4 });

      // One real open reservation of 2 (soft) and one hard hold of 1.
      const soft = await makeSo(trx, { allocation_mode: 'soft' });
      await trx('sales_order_lines').insert({
        tenant: TENANT, so_id: soft.so_id, service_id: SERVICE, quantity_ordered: 2,
        quantity_fulfilled: 0, quantity_invoiced: 0, quantity_reserved: 2, reserved_location_id: LOCATION,
        unit_price: 100, fulfillment_type: 'from_stock',
      });
      const hard = await makeSo(trx, { allocation_mode: 'hard' });
      await trx('sales_order_lines').insert({
        tenant: TENANT, so_id: hard.so_id, service_id: SERVICE, quantity_ordered: 1,
        quantity_fulfilled: 0, quantity_invoiced: 0, quantity_reserved: 1, reserved_location_id: LOCATION,
        unit_price: 100, fulfillment_type: 'from_stock',
      });

      const allocations = await computeAllocationsFromTruth(trx, TENANT, SERVICE, false);
      expect(allocations.get(LOCATION)).toEqual({ reserved: 2, held: 1 });

      await reconcileStockLevels(trx, TENANT, SERVICE, false);
      const level = await trx('stock_levels').where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).first();
      expect(Number(level.reserved_quantity)).toBe(2);
      expect(Number(level.held_quantity)).toBe(1);
    });
  });
});

describe.skipIf(!databaseConnection)('T027 — vendor price list constraints', () => {
  it('enforces a single preferred offer per product', async () => {
    await inTx(async (trx) => {
      if (!VENDOR) return; // no vendor fixture in this DB
      const [v2] = await trx('vendors')
        .insert({ tenant: TENANT, vendor_name: `Test Vendor ${Math.floor(Math.random() * 1e9)}`, is_active: true })
        .returning('*');
      await trx('vendor_products').insert({
        tenant: TENANT, vendor_id: VENDOR, service_id: SERVICE, unit_cost: 1000, cost_currency: 'USD', is_preferred: true,
      });
      await expect(
        trx('vendor_products').insert({
          tenant: TENANT, vendor_id: v2.vendor_id, service_id: SERVICE, unit_cost: 900, cost_currency: 'USD', is_preferred: true,
        }),
      ).rejects.toThrow(/idx_vendor_products_one_preferred/);
    });
  });
});

describe.skipIf(!databaseConnection)('T032 math — landed-cost allocation adds up and rounds to the last line', () => {
  it('allocates by value with cents preserved', () => {
    // Mirrors applyPoLandedCosts's weighting: 10000 cents across value weights 3:1.
    const lines = [
      { unit_cost: 3000, quantity_received: 1 },
      { unit_cost: 1000, quantity_received: 1 },
    ];
    const amount = 10001; // odd total to force a rounding remainder
    const totalValue = lines.reduce((s, l) => s + l.unit_cost * l.quantity_received, 0);
    let remainder = amount;
    const shares = lines.map((l, i) => {
      const w = (l.unit_cost * l.quantity_received) / totalValue;
      const share = i === lines.length - 1 ? remainder : Math.round(amount * w);
      remainder -= share;
      return share;
    });
    expect(shares.reduce((s, x) => s + x, 0)).toBe(amount);
    expect(shares[0]).toBe(7501);
    expect(shares[1]).toBe(2500);
  });
});

describe.skipIf(!databaseConnection)('T034 constraints — vendor bill lifecycle schema', () => {
  it('rejects invalid statuses and duplicate bill numbers per vendor', async () => {
    await inTx(async (trx) => {
      if (!VENDOR) return;
      const bill = {
        tenant: TENANT, vendor_id: VENDOR, bill_number: `B-${Math.floor(Math.random() * 1e9)}`,
        bill_date: trx.fn.now(), currency_code: 'USD', status: 'draft', total_amount: 100,
      };
      await trx('vendor_bills').insert(bill);
      await expectViolation(trx, () => trx('vendor_bills').insert(bill), /uq_vendor_bills_number/);
      await expectViolation(
        trx,
        () => trx('vendor_bills').insert({ ...bill, bill_number: `${bill.bill_number}-2`, status: 'bogus' }),
        /vendor_bills_status_check/,
      );
    });
  });
});

describe.skipIf(!databaseConnection)('T019 schema — rma_cases no longer admits dead_unit_returned', () => {
  it('rejects the removed status and accepts live ones', async () => {
    await inTx(async (trx) => {
      const base = { tenant: TENANT, rma_type: 'standard', service_id: SERVICE, client_id: CLIENT, opened_at: trx.fn.now() };
      await trx('rma_cases').insert({ ...base, status: 'open' });
      await expect(trx('rma_cases').insert({ ...base, status: 'dead_unit_returned' })).rejects.toThrow(
        /rma_cases_status_check/,
      );
    });
  });
});

describe.skipIf(!databaseConnection)('cycle count schema (T029/T031 paths)', () => {
  it('unique per (session, service); status CHECK; cascade delete of lines', async () => {
    await inTx(async (trx) => {
      const [session] = await trx('count_sessions')
        .insert({ tenant: TENANT, location_id: LOCATION, status: 'in_progress', created_by: null })
        .returning('*');
      await trx('count_lines').insert({
        tenant: TENANT, session_id: session.session_id, service_id: SERVICE, expected_qty: 5,
      });
      await expectViolation(
        trx,
        () => trx('count_lines').insert({ tenant: TENANT, session_id: session.session_id, service_id: SERVICE, expected_qty: 5 }),
        /uq_count_lines_session_service/,
      );
      await expectViolation(
        trx,
        () => trx('count_sessions').insert({ tenant: TENANT, location_id: LOCATION, status: 'bogus' }),
        /count_sessions_status_check/,
      );
      await trx('count_sessions').where({ tenant: TENANT, session_id: session.session_id }).del();
      const remaining = await trx('count_lines').where({ tenant: TENANT, session_id: session.session_id });
      expect(remaining.length).toBe(0);
    });
  });
});
