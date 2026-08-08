import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tenantDb } from '@alga-psa/db';
import Contract from '@alga-psa/billing/models/contract';
import { deleteContract } from '@alga-psa/billing/actions/contractActions';
import { isActionMessageError } from '@alga-psa/ui/lib/errorHandling';
import { TestContext } from '../../../../../test-utils/testContext';

const MIGRATION_FILE = '20260808090000_fix_opportunities_converted_contract_fk.cjs';
const CONSTRAINT_NAME = 'opportunities_tenant_converted_contract_id_foreign';

const mockedTenantConnection = vi.hoisted(() => ({
  db: null as any,
  tenant: null as string | null,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!mockedTenantConnection.db || !mockedTenantConnection.tenant) {
        throw new Error('Mock tenant connection not initialized');
      }
      return { knex: mockedTenantConnection.db, tenant: mockedTenantConnection.tenant };
    }),
  };
});

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        { user_id: 'mock-user-id', tenant: mockedTenantConnection.tenant ?? 'mock-tenant', user_type: 'internal', roles: [] },
        { tenant: mockedTenantConnection.tenant ?? 'mock-tenant' },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

describe('Contract deletion infrastructure', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;
  }, 30000);

  afterEach(async () => {
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  const db = () => tenantDb(context.db, context.tenantId);

  async function createContract(name: string, overrides: Record<string, unknown> = {}) {
    const contractId = randomUUID();
    const now = context.db.fn.now();
    await db().table('contracts').insert({
      contract_id: contractId,
      tenant: context.tenantId,
      contract_name: name,
      status: 'draft',
      is_template: false,
      is_active: true,
      billing_frequency: 'monthly',
      currency_code: 'USD',
      owner_client_id: context.clientId,
      created_at: now,
      updated_at: now,
      ...overrides,
    });
    return contractId;
  }

  async function createClientContract(contractId: string) {
    const clientContractId = randomUUID();
    await db().table('client_contracts').insert({
      client_contract_id: clientContractId,
      tenant: context.tenantId,
      contract_id: contractId,
      client_id: context.clientId,
      start_date: context.db.fn.now(),
      is_active: true,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now(),
    });
    return clientContractId;
  }

  async function createOpportunityConvertedContract(contractId: string) {
    const opportunityId = randomUUID();
    await db().table('opportunities').insert({
      opportunity_id: opportunityId,
      tenant: context.tenantId,
      opportunity_number: `OPP-${randomUUID().slice(0, 8)}`,
      client_id: context.clientId,
      title: `Converted opportunity for ${contractId}`,
      opportunity_type: 'expansion',
      owner_id: context.userId,
      status: 'won',
      stage: 'won',
      confidence: 'high',
      mrr_cents: 0,
      nrr_cents: 0,
      hardware_cents: 0,
      currency_code: 'USD',
      last_activity_at: context.db.fn.now(),
      converted_contract_id: contractId,
      created_by: context.userId,
      won_at: context.db.fn.now(),
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now(),
    });
    return opportunityId;
  }

  async function seedInvoiceForClientContract(clientContractId: string): Promise<string> {
    const invoiceId = randomUUID();
    const now = context.db.fn.now();
    await db().table('invoices').insert({
      invoice_id: invoiceId,
      tenant: context.tenantId,
      invoice_number: `INV-TEST-${randomUUID().slice(0, 8)}`,
      invoice_date: now,
      due_date: now,
      total_amount: 10000,
      status: 'draft',
      subtotal: 10000,
      tax: 0,
      is_manual: false,
      is_prepayment: false,
      client_id: context.clientId,
      currency_code: 'USD',
      created_at: now,
      updated_at: now,
    });
    await db().table('invoice_charges').insert({
      item_id: randomUUID(),
      tenant: context.tenantId,
      invoice_id: invoiceId,
      client_contract_id: clientContractId,
      description: `Invoice charge for contract deletion guard ${clientContractId}`,
      quantity: 1,
      unit_price: 10000,
      total_price: 10000,
      tax_rate: 0,
      is_manual: false,
      created_at: now,
      updated_at: now,
    } as any);
    return invoiceId;
  }

  async function getConstraintDef(): Promise<string> {
    const row = await context.db.raw(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       WHERE c.conname = '${CONSTRAINT_NAME}'`
    );
    return row.rows[0]?.definition ?? '';
  }

  it('baseline: plain draft contract with no dependents deletes cleanly', async () => {
    const contractId = await createContract('Baseline delete');
    await createClientContract(contractId);

    await Contract.delete(context.db, context.tenantId, contractId);

    const gone = await db().table('contracts').where({ contract_id: contractId }).first();
    const clientContractGone = await db().table('client_contracts').where({ contract_id: contractId }).first();
    expect(gone).toBeUndefined();
    expect(clientContractGone).toBeUndefined();
  });

  it('contract with a configured contract line deletes cleanly (children removed)', async () => {
    const contractId = await createContract('Contract line delete');
    await createClientContract(contractId);
    const lineId = randomUUID();
    await db().table('contract_lines').insert({
      contract_line_id: lineId,
      tenant: context.tenantId,
      contract_id: contractId,
      contract_line_name: 'Repro line',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      display_order: 1,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now(),
    });

    await Contract.delete(context.db, context.tenantId, contractId);

    const lineGone = await db().table('contract_lines').where({ contract_line_id: lineId }).first();
    const contractGone = await db().table('contracts').where({ contract_id: contractId }).first();
    expect(lineGone).toBeUndefined();
    expect(contractGone).toBeUndefined();
  });

  it('opportunity-converted contract deletes; opportunity survives with converted_contract_id NULL and other columns intact', async () => {
    const contractId = await createContract('Opportunity-converted delete');
    await createClientContract(contractId);
    const opportunityId = await createOpportunityConvertedContract(contractId);

    await Contract.delete(context.db, context.tenantId, contractId);

    const contractGone = await db().table('contracts').where({ contract_id: contractId }).first();
    const opportunity = await db().table('opportunities').where({ opportunity_id: opportunityId }).first();
    expect(contractGone).toBeUndefined();
    expect(opportunity).toBeDefined();
    expect(opportunity.converted_contract_id).toBeNull();
    expect(opportunity.tenant).toBe(context.tenantId);
    expect(opportunity.status).toBe('won');
    expect(opportunity.stage).toBe('won');
    expect(opportunity.title).toContain('Converted opportunity');
    expect(opportunity.client_id).toBe(context.clientId);
  });

  it('invoice guard still blocks deletion with an actionable error', async () => {
    const contractId = await createContract('Invoice-bearing delete');
    const clientContractId = await createClientContract(contractId);
    await seedInvoiceForClientContract(clientContractId);

    const hasInvoices = await Contract.hasInvoices(context.db, context.tenantId, contractId);
    expect(hasInvoices).toBe(true);

    await expect(
      Contract.delete(context.db, context.tenantId, contractId)
    ).rejects.toThrow('Cannot delete contract that has associated invoices');

    const stillPresent = await db().table('contracts').where({ contract_id: contractId }).first();
    expect(stillPresent).toBeDefined();
  });

  it('deleteContract action surfaces the invoice guard as an expected actionError, not a thrown exception', async () => {
    const contractId = await createContract('Action invoice guard');
    const clientContractId = await createClientContract(contractId);
    await seedInvoiceForClientContract(clientContractId);

    const result = await deleteContract(contractId);
    expect(isActionMessageError(result)).toBe(true);
    const errorMessage = (result as { actionError: string }).actionError;
    expect(errorMessage).toContain('invoices');

    const stillPresent = await db().table('contracts').where({ contract_id: contractId }).first();
    expect(stillPresent).toBeDefined();
  });

  it('system-managed-default guard still blocks deletion with an actionable error', async () => {
    const contractId = await createContract('System-managed default', {
      is_system_managed_default: true,
    });

    const result = await deleteContract(contractId);
    expect(isActionMessageError(result)).toBe(true);

    const stillPresent = await db().table('contracts').where({ contract_id: contractId }).first();
    expect(stillPresent).toBeDefined();
  });

  it('migration down() restores the original NO ACTION constraint and up() re-applies column-targeted SET NULL', async () => {
    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../../migrations'
    );
    const migration = await import(path.join(migrationsDir, MIGRATION_FILE));

    // Sanity: up() applied by the bootstrap.
    const postBootstrap = await getConstraintDef();
    expect(postBootstrap).toContain('ON DELETE SET NULL (converted_contract_id)');

    await migration.down(context.db);
    const afterDown = await getConstraintDef();
    expect(afterDown).toContain('REFERENCES contracts(tenant, contract_id)');
    expect(afterDown).not.toContain('ON DELETE SET NULL');

    await migration.up(context.db);
    const afterUp = await getConstraintDef();
    expect(afterUp).toContain('ON DELETE SET NULL (converted_contract_id)');
    expect(afterUp).toContain('REFERENCES contracts(tenant, contract_id)');
  });
});
