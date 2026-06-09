/**
 * Real-DB coverage for the bulk financial operations implemented on this branch
 * (FinancialService.bulkTransactionOperation / bulkCreditOperation), which
 * replaced 501 stubs. Verifies the actual ledger effects — compensating
 * reversal transactions, credit expiration accounting, and credit transfers —
 * not just that the call returns. Permission checks are mocked so the test
 * targets the data logic, not RBAC seeding.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { FinancialService } from '@/lib/api/services/FinancialService';

const HOOK_TIMEOUT = 180_000;

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, name);
}

function newService(tenantId: string): FinancialService {
  const svc = new FinancialService();
  vi.spyOn(svc as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  vi.spyOn(svc as any, 'validatePermissions').mockResolvedValue(undefined);
  return svc;
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('credit_tracking').where({ tenant: tenantId }).del();
  await db('transactions').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

type Fixture = { tenantId: string; userId: string; clientA: string; clientB: string };

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientA = uuidv4();
  const clientB = uuidv4();
  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `fin-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'email') ? { email: `fin-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  for (const [id, balance] of [[clientA, 30], [clientB, 0]] as Array<[string, number]>) {
    await db('clients').insert({
      tenant: tenantId,
      client_id: id,
      client_name: `Client ${id.slice(0, 8)}`,
      credit_balance: balance,
      ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
      ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
      ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
  }

  return { tenantId, userId, clientA, clientB };
}

async function seedTransaction(tenantId: string, clientId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv4();
  await db('transactions').insert({
    transaction_id: id,
    tenant: tenantId,
    client_id: clientId,
    amount: 100,
    type: 'payment',
    status: 'completed',
    description: 'seed',
    created_at: new Date().toISOString(),
    balance_after: 100,
    ...overrides,
  });
  return id;
}

async function seedCredit(tenantId: string, clientId: string, remaining: number): Promise<string> {
  const creditId = uuidv4();
  const txnId = uuidv4();
  const now = new Date().toISOString();
  await db('transactions').insert({
    transaction_id: txnId,
    tenant: tenantId,
    client_id: clientId,
    amount: remaining,
    type: 'credit_issuance',
    status: 'completed',
    description: 'seed credit',
    created_at: now,
    balance_after: remaining,
  });
  await db('credit_tracking').insert({
    credit_id: creditId,
    tenant: tenantId,
    client_id: clientId,
    transaction_id: txnId,
    amount: remaining,
    remaining_amount: remaining,
    created_at: now,
    is_expired: false,
    updated_at: now,
  });
  return creditId;
}

describe('financial bulk operations integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    clientColumns = await db('clients').columnInfo();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('approves and rejects transactions by id', async () => {
    const f = await createFixture();
    const svc = newService(f.tenantId);
    const approveId = await seedTransaction(f.tenantId, f.clientA, { status: 'pending' });
    const rejectId = await seedTransaction(f.tenantId, f.clientA, { status: 'pending' });

    const res = await svc.bulkTransactionOperation(
      { transaction_ids: [approveId, rejectId], operation: 'approve' } as any,
      { tenant: f.tenantId, userId: f.userId, user: { user_id: f.userId } } as any,
    );
    expect(res.data.successful).toBe(2);

    const rej = await svc.bulkTransactionOperation(
      { transaction_ids: [rejectId], operation: 'reject' } as any,
      { tenant: f.tenantId, userId: f.userId, user: { user_id: f.userId } } as any,
    );
    expect(rej.data.successful).toBe(1);

    const approved = await db('transactions').where({ transaction_id: approveId }).first();
    const rejected = await db('transactions').where({ transaction_id: rejectId }).first();
    expect(approved.status).toBe('completed');
    expect(rejected.status).toBe('rejected');
  }, HOOK_TIMEOUT);

  it('reverses a transaction with a compensating entry', async () => {
    const f = await createFixture();
    const svc = newService(f.tenantId);
    const txnId = await seedTransaction(f.tenantId, f.clientA, { amount: 100, balance_after: 100 });

    const res = await svc.bulkTransactionOperation(
      { transaction_ids: [txnId], operation: 'reverse', reason: 'test reversal' } as any,
      { tenant: f.tenantId, userId: f.userId, user: { user_id: f.userId } } as any,
    );
    expect(res.data.successful).toBe(1);

    const original = await db('transactions').where({ transaction_id: txnId }).first();
    expect(original.status).toBe('reversed');

    const reversal = await db('transactions')
      .where({ tenant: f.tenantId, related_transaction_id: txnId })
      .first();
    expect(reversal).toBeDefined();
    expect(Number(reversal.amount)).toBe(-100);
    expect(reversal.type).toBe('payment_reversal');
    expect(Number(reversal.balance_after)).toBe(0);
  }, HOOK_TIMEOUT);

  it('expires a credit and reduces the client balance', async () => {
    const f = await createFixture();
    const svc = newService(f.tenantId);
    // clientB starts at 0; give it a credit of 50.
    await db('clients').where({ tenant: f.tenantId, client_id: f.clientB }).update({ credit_balance: 50 });
    const creditId = await seedCredit(f.tenantId, f.clientB, 50);

    const res = await svc.bulkCreditOperation(
      { credit_ids: [creditId], operation: 'expire' } as any,
      { tenant: f.tenantId, userId: f.userId, user: { user_id: f.userId } } as any,
    );
    expect(res.data.successful).toBe(1);

    const credit = await db('credit_tracking').where({ credit_id: creditId }).first();
    expect(credit.is_expired).toBe(true);
    expect(Number(credit.remaining_amount)).toBe(0);

    const expirationTxn = await db('transactions')
      .where({ tenant: f.tenantId, type: 'credit_expiration' })
      .first();
    expect(expirationTxn).toBeDefined();
    expect(Number(expirationTxn.amount)).toBe(-50);

    const client = await db('clients').where({ tenant: f.tenantId, client_id: f.clientB }).first();
    expect(Number(client.credit_balance)).toBe(0);
  }, HOOK_TIMEOUT);

  it('transfers a credit to another client', async () => {
    const f = await createFixture();
    const svc = newService(f.tenantId);
    // clientA has credit_balance 30 from the fixture; back it with a credit.
    const creditId = await seedCredit(f.tenantId, f.clientA, 30);

    const res = await svc.bulkCreditOperation(
      { credit_ids: [creditId], operation: 'transfer', parameters: { target_client_id: f.clientB } } as any,
      { tenant: f.tenantId, userId: f.userId, user: { user_id: f.userId } } as any,
    );
    expect(res.data.successful).toBe(1);

    const source = await db('credit_tracking').where({ credit_id: creditId }).first();
    expect(Number(source.remaining_amount)).toBe(0);

    const targetCredit = await db('credit_tracking')
      .where({ tenant: f.tenantId, client_id: f.clientB })
      .first();
    expect(targetCredit).toBeDefined();
    expect(Number(targetCredit.remaining_amount)).toBe(30);

    const clientB = await db('clients').where({ tenant: f.tenantId, client_id: f.clientB }).first();
    expect(Number(clientB.credit_balance)).toBe(30);
  }, HOOK_TIMEOUT);

  it('reports per-id failures without aborting the batch', async () => {
    const f = await createFixture();
    const svc = newService(f.tenantId);
    const goodId = await seedTransaction(f.tenantId, f.clientA, { status: 'pending' });

    const res = await svc.bulkTransactionOperation(
      { transaction_ids: [goodId, uuidv4()], operation: 'approve' } as any,
      { tenant: f.tenantId, userId: f.userId, user: { user_id: f.userId } } as any,
    );
    expect(res.data.total_requested).toBe(2);
    expect(res.data.successful).toBe(1);
    expect(res.data.failed).toBe(1);
    expect(res.data.results.find((r: any) => !r.success)?.error).toMatch(/not found/i);
  }, HOOK_TIMEOUT);
});
