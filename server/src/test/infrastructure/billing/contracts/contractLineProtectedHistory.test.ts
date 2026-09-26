import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTenant } from '../../../../../test-utils/testDataFactory';
import { createTestService } from '../../../../../test-utils/billingTestHelpers';

const authState = vi.hoisted(() => ({ tenant: '' }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => any) => (...args: any[]) => action(
    { user_id: 'protected-history-test-user' }, { tenant: authState.tenant }, ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

import { hasContractLineProtectedHistory } from '@alga-psa/billing/actions/contractLineAction';

describe('contract-line protected history database relationships', () => {
  let context: TestContext;
  const helpers = TestContext.createHelpers();

  beforeAll(async () => {
    context = await helpers.beforeAll({ runSeeds: false });
  }, 120000);
  beforeEach(async () => {
    context = await helpers.beforeEach();
    authState.tenant = context.tenantId;
  }, 30000);
  afterEach(async () => {
    authState.tenant = '';
    await helpers.afterEach();
  }, 30000);
  afterAll(async () => helpers.afterAll(), 120000);

  async function createLine(contractId: string, lineId = randomUUID()) {
    await context.createEntity('contract_lines', {
      contract_line_id: lineId,
      contract_id: contractId,
      contract_line_name: `History line ${lineId.slice(0, 8)}`,
      billing_frequency: 'monthly',
      billing_timing: 'arrears',
      is_custom: false,
      contract_line_type: 'Fixed',
      cadence_owner: 'contract',
      is_active: true,
      custom_rate: 10000,
    }, 'contract_line_id');
    return lineId;
  }

  async function seedClaim(tenant: string, lineId: string, start: string, end: string) {
    await context.db('recurring_service_periods').insert({
      record_id: randomUUID(), tenant,
      schedule_key: `schedule:${tenant}:contract_line:${lineId}:contract:arrears`,
      period_key: `period:${start}:${end}`, revision: 1,
      obligation_id: lineId, obligation_type: 'contract_line',
      charge_family: 'fixed', cadence_owner: 'contract', due_position: 'arrears', lifecycle_state: 'billed',
      service_period_start: start, service_period_end: end, invoice_window_start: start, invoice_window_end: end,
      activity_window_start: null, activity_window_end: null, timing_metadata: null,
      provenance_kind: 'generated', source_rule_version: 'test', reason_code: null, source_run_key: 'test',
      supersedes_record_id: null, invoice_id: randomUUID(), invoice_charge_id: randomUUID(),
      invoice_charge_detail_id: randomUUID(), invoice_linked_at: context.db.fn.now(),
    });
  }

  it('uses PostgreSQL date objects and isolates canonical claims by tenant and contract line', async () => {
    const now = context.db.fn.now();
    const contractId = await context.createEntity('contracts', {
      contract_name: `Protected history ${randomUUID().slice(0, 8)}`, status: 'draft', is_template: false,
      is_active: true, billing_frequency: 'monthly', currency_code: 'USD', owner_client_id: context.clientId,
      created_at: now, updated_at: now,
    }, 'contract_id');
    const billedLineId = await createLine(contractId);
    const siblingLineId = await createLine(contractId);
    await seedClaim(context.tenantId, billedLineId, '2026-06-01', '2026-07-01');

    const foreignTenant = await createTenant(context.db, `Foreign ${randomUUID().slice(0, 8)}`);
    const foreignOnlyLineId = randomUUID();
    await seedClaim(foreignTenant, foreignOnlyLineId, '2025-01-01', '2025-02-01');

    // This is the real pg DATE parser used by the action: its result is a Date,
    // not an ISO string. Normalize it at the action boundary before comparison.
    const parsed = await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, obligation_id: billedLineId }).first('service_period_end');
    expect(parsed.service_period_end).toBeInstanceOf(Date);
    expect(await hasContractLineProtectedHistory(billedLineId)).toBe(true);
    expect(await hasContractLineProtectedHistory(siblingLineId)).toBe(false);
    expect(await hasContractLineProtectedHistory(foreignOnlyLineId)).toBe(false);
  });

  it('follows invoice detail → charge → service configuration relationships for draft invoices', async () => {
    const now = context.db.fn.now();
    const contractId = await context.createEntity('contracts', {
      contract_name: `Detail history ${randomUUID().slice(0, 8)}`, status: 'draft', is_template: false,
      is_active: true, billing_frequency: 'monthly', currency_code: 'USD', owner_client_id: context.clientId,
      created_at: now, updated_at: now,
    }, 'contract_id');
    const lineId = await createLine(contractId);
    const siblingLineId = await createLine(contractId);
    const serviceId = await createTestService(context, { service_name: `History service ${randomUUID().slice(0, 8)}` });
    const configId = randomUUID();
    await context.db('contract_line_service_configuration').insert({
      config_id: configId, tenant: context.tenantId, contract_line_id: lineId, service_id: serviceId,
      configuration_type: 'Fixed', created_at: now, updated_at: now,
    });
    const invoiceId = await context.createEntity('invoices', {
      invoice_number: `DRAFT-${randomUUID().slice(0, 8)}`, invoice_date: '2026-07-01', due_date: '2026-08-01',
      status: 'draft', client_id: context.clientId, currency_code: 'USD', is_manual: false,
      total_amount: 10000, subtotal: 10000, tax: 0, created_at: now, updated_at: now,
    }, 'invoice_id');
    const itemId = randomUUID();
    await context.db('invoice_charges').insert({
      item_id: itemId, tenant: context.tenantId, invoice_id: invoiceId,
      description: 'Draft recurring charge', quantity: 1, unit_price: 10000,
      total_price: 10000, net_amount: 10000, tax_amount: 0, tax_rate: 0,
      is_manual: false, is_discount: false, is_taxable: false,
    });
    await context.db('invoice_charge_details').insert({
      item_detail_id: randomUUID(), item_id: itemId, tenant: context.tenantId, service_id: serviceId,
      config_id: configId, quantity: 1, rate: 10000,
      service_period_start: '2026-06-01', service_period_end: '2026-07-01', created_at: now, updated_at: now,
    });

    const parsedDetail = await context.db('invoice_charge_details').where({ item_id: itemId }).first('service_period_end');
    expect(parsedDetail.service_period_end).toBeInstanceOf(Date);
    expect(await hasContractLineProtectedHistory(lineId)).toBe(true);
    expect(await hasContractLineProtectedHistory(siblingLineId)).toBe(false);
  });
});
