import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { knex, type Knex } from 'knex';

/**
 * T007 (alga-2026-0003329): the invoice status repair, run against a real Postgres.
 * Hermetic: `invoices` and `invoice_payments` are TEMP tables with only the columns
 * the migration touches. Skipped when no Postgres is reachable.
 */
const require = createRequire(import.meta.url);
const MIGRATION = require(path.resolve(__dirname, '..', '20261124010000_repair_invoice_status_from_recorded_payments.cjs'));

let db: Knex | undefined;
let reachable = false;
const T1 = '00000000-0000-0000-0000-0000000000b1';
const T2 = '00000000-0000-0000-0000-0000000000b2';
let seq = 0;
const uuid = () => `20000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`;
const FINALIZED = '2026-11-01';

async function invoice(over: Record<string, unknown> = {}, payments: number[] = []) {
  const row = { tenant: T1, invoice_id: uuid(), status: 'sent', total_amount: 10000, credit_applied: 0, finalized_at: FINALIZED, ...over };
  await db!('invoices').insert(row);
  for (const amount of payments) {
    await db!('invoice_payments').insert({ tenant: row.tenant, payment_id: uuid(), invoice_id: row.invoice_id, amount });
  }
  return row.invoice_id as string;
}
const status = async (id: string) => (await db!('invoices').where({ invoice_id: id }).first()).status;

beforeAll(async () => {
  const connection = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || 'postgres',
      database: process.env.DB_NAME_SERVER || 'postgres',
    },
    pool: { min: 1, max: 1 },
  });
  try {
    await connection.raw('SELECT 1');
    reachable = true;
    db = connection;
  } catch {
    await connection.destroy().catch(() => undefined);
    return;
  }
  await db.raw(`CREATE TEMP TABLE invoices (tenant uuid, invoice_id uuid, status text, total_amount bigint, credit_applied bigint, finalized_at date, updated_at timestamptz)`);
  await db.raw(`CREATE TEMP TABLE invoice_payments (tenant uuid, payment_id uuid, invoice_id uuid, amount bigint)`);
}, 30_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
});

beforeEach(async () => {
  if (!db) return;
  await db.raw('TRUNCATE invoices, invoice_payments');
});

describe('repair invoice status from recorded payments migration', () => {
  it('flips a finalized sent invoice with full payments to paid', async (ctx) => {
    if (!reachable) return ctx.skip();
    const id = await invoice({}, [10000]);
    await MIGRATION.up(db);
    expect(await status(id)).toBe('paid');
  });

  it('handles partial, overpaid, reversed-to-zero and credit-covered cases', async (ctx) => {
    if (!reachable) return ctx.skip();
    const partial = await invoice({ status: 'paid' }, [4000]);
    const over = await invoice({}, [12000]);
    const reversed = await invoice({ status: 'paid' }, [10000, -10000]);
    const withCredit = await invoice({ credit_applied: 3000 }, [7000]);
    await MIGRATION.up(db);
    expect(await status(partial)).toBe('partially_applied');
    expect(await status(over)).toBe('paid');
    expect(await status(reversed)).toBe('sent');
    expect(await status(withCredit)).toBe('paid');
  });

  it('leaves drafts, cancelled, void, correct and payment-less invoices untouched', async (ctx) => {
    if (!reachable) return ctx.skip();
    const draft = await invoice({ status: 'draft', finalized_at: null }, [10000]);
    const cancelled = await invoice({ status: 'cancelled' }, [10000]);
    const voided = await invoice({ status: 'void' }, [10000]);
    const correct = await invoice({ status: 'paid' }, [10000]);
    const none = await invoice({ status: 'sent' }, []);
    const creditNote = await invoice({ total_amount: -5000 }, []);
    await MIGRATION.up(db);
    expect(await status(draft)).toBe('draft');
    expect(await status(cancelled)).toBe('cancelled');
    expect(await status(voided)).toBe('void');
    expect(await status(correct)).toBe('paid');
    expect(await status(none)).toBe('sent');
    expect(await status(creditNote)).toBe('sent');
    expect((await db!('invoices').where({ invoice_id: correct }).first()).updated_at).toBeNull();
  });

  it('does not cross tenants when payments share an invoice id', async (ctx) => {
    if (!reachable) return ctx.skip();
    const id = await invoice({ tenant: T1 }, []);
    await db!('invoice_payments').insert({ tenant: T2, payment_id: uuid(), invoice_id: id, amount: 10000 });
    await MIGRATION.up(db);
    expect(await status(id)).toBe('sent');
  });

  it('is idempotent', async (ctx) => {
    if (!reachable) return ctx.skip();
    await invoice({}, [10000]);
    expect(await MIGRATION.repairInvoiceStatusFromRecordedPayments(db)).toBe(1);
    expect(await MIGRATION.repairInvoiceStatusFromRecordedPayments(db)).toBe(0);
  });
});
