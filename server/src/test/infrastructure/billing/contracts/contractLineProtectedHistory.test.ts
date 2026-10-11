import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTenant } from '../../../../../test-utils/testDataFactory';
import { createTestService } from '../../../../../test-utils/billingTestHelpers';
import { runWithTenant } from '@alga-psa/db';

const authState = vi.hoisted(() => ({ tenant: '' }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => any) => (...args: any[]) => action(
    { user_id: 'protected-history-test-user' }, { tenant: authState.tenant }, ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

import { hasContractLineProtectedHistory, updateContractLine } from '@alga-psa/billing/actions/contractLineAction';
import { hardDeleteInvoice } from '@alga-psa/billing/actions/invoiceModification';

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
      start_date: null,
      end_date: null,
    }, 'contract_line_id');
    return lineId;
  }

  async function createAssignment(contractId: string, start: string, end: string | null) {
    await context.db('client_contracts').insert({
      client_contract_id: randomUUID(), tenant: context.tenantId, contract_id: contractId,
      client_id: context.clientId, start_date: start, end_date: end, is_active: true,
      created_at: context.db.fn.now(), updated_at: context.db.fn.now(),
    });
  }

  async function persistedLine(lineId: string) {
    return context.db('contract_lines').where({ contract_line_id: lineId }).first();
  }

  function dateOnly(value: Date | string | null) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }

  async function updateLine(lineId: string, update: Record<string, unknown>) {
    return runWithTenant(context.tenantId, () => updateContractLine(lineId, update as any));
  }

  async function cancelDraftInvoice(invoiceId: string) {
    return runWithTenant(context.tenantId, () => hardDeleteInvoice(invoiceId));
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

  it('updates through the real action while preserving claimed and invoiced history across date edits and clears', async () => {
    const now = context.db.fn.now();
    const contractId = await context.createEntity('contracts', {
      contract_name: `Action history ${randomUUID().slice(0, 8)}`, status: 'draft', is_template: false,
      is_active: true, billing_frequency: 'monthly', currency_code: 'USD', owner_client_id: context.clientId,
      created_at: now, updated_at: now,
    }, 'contract_id');
    const lineId = await createLine(contractId);
    // The effective inherited window safely encloses the service periods.
    await createAssignment(contractId, '2026-01-01', '2027-12-31');
    await seedClaim(context.tenantId, lineId, '2026-06-01', '2026-07-01');

    const serviceId = await createTestService(context, { service_name: `Action service ${randomUUID().slice(0, 8)}` });
    const configId = randomUUID();
    await context.db('contract_line_service_configuration').insert({
      config_id: configId, tenant: context.tenantId, contract_line_id: lineId, service_id: serviceId,
      configuration_type: 'Fixed', created_at: now, updated_at: now,
    });
    const invoiceId = await context.createEntity('invoices', {
      invoice_number: `ACTION-${randomUUID().slice(0, 8)}`, invoice_date: '2026-07-01', due_date: '2026-08-01',
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

    const textAndFutureEnd = await updateLine(lineId, {
      invoice_line_description: '  Revised billed line  ', end_date: '2027-01-01',
    });
    expect(textAndFutureEnd.invoice_line_description).toBe('Revised billed line');
    expect(dateOnly(textAndFutureEnd.end_date as Date | string)).toBe('2027-01-01');
    const persistedAfterSave = await persistedLine(lineId);
    expect(persistedAfterSave.invoice_line_description).toBe('Revised billed line');
    expect(dateOnly(persistedAfterSave.end_date)).toBe('2027-01-01');

    const beforeRejectedEdits = await persistedLine(lineId);
    const rejectedEnd = await updateLine(lineId, { end_date: '2026-06-15' });
    expect(rejectedEnd).toMatchObject({ messageKey: 'msp/contracts:contractLines.errors.protectedEndDate', messageParams: { boundary: '2026-07-01' } });
    expect(await persistedLine(lineId)).toMatchObject({ end_date: beforeRejectedEdits.end_date, invoice_line_description: beforeRejectedEdits.invoice_line_description });

    const rejectedStart = await updateLine(lineId, { start_date: '2026-06-15' });
    expect(rejectedStart).toMatchObject({ messageKey: 'msp/contracts:contractLines.errors.protectedStartDate', messageParams: { boundary: '2026-06-01' } });
    expect(await persistedLine(lineId)).toMatchObject({ start_date: beforeRejectedEdits.start_date, end_date: beforeRejectedEdits.end_date });

    // Both explicit bounds can be set at the exact protected boundaries, then
    // cleared safely because the assignment window still covers the history.
    expect(dateOnly((await updateLine(lineId, { start_date: '2026-06-01' })).start_date as Date | string)).toBe('2026-06-01');
    expect(dateOnly((await persistedLine(lineId)).start_date)).toBe('2026-06-01');
    expect(await updateLine(lineId, { start_date: null })).toMatchObject({ start_date: null });
    expect((await persistedLine(lineId)).start_date).toBeNull();
    expect(dateOnly((await updateLine(lineId, { end_date: '2026-07-01' })).end_date as Date | string)).toBe('2026-07-01');
    expect(dateOnly((await persistedLine(lineId)).end_date)).toBe('2026-07-01');
    expect(await updateLine(lineId, { end_date: null })).toMatchObject({ end_date: null });
    expect((await persistedLine(lineId)).end_date).toBeNull();
  });

  it('rejects cleared bounds when actual assignment dates would inherit a window excluding claimed history', async () => {
    const now = context.db.fn.now();
    const startContractId = await context.createEntity('contracts', {
      contract_name: `Inherited start ${randomUUID().slice(0, 8)}`, status: 'draft', is_template: false,
      is_active: true, billing_frequency: 'monthly', currency_code: 'USD', owner_client_id: context.clientId,
      created_at: now, updated_at: now,
    }, 'contract_id');
    const startLineId = await createLine(startContractId);
    await createAssignment(startContractId, '2026-06-15', '2027-12-31');
    await seedClaim(context.tenantId, startLineId, '2026-06-01', '2026-07-01');

    const rejectedStartClear = await updateLine(startLineId, { start_date: null });
    expect(rejectedStartClear).toMatchObject({ messageKey: 'msp/contracts:contractLines.errors.protectedStartDate', messageParams: { boundary: '2026-06-01' } });
    expect((await persistedLine(startLineId)).start_date).toBeNull();

    const endContractId = await context.createEntity('contracts', {
      contract_name: `Inherited end ${randomUUID().slice(0, 8)}`, status: 'draft', is_template: false,
      is_active: true, billing_frequency: 'monthly', currency_code: 'USD', owner_client_id: context.clientId,
      created_at: now, updated_at: now,
    }, 'contract_id');
    const endLineId = await createLine(endContractId);
    await createAssignment(endContractId, '2026-01-01', '2026-06-20');
    await seedClaim(context.tenantId, endLineId, '2026-06-01', '2026-07-01');

    const rejectedEndClear = await updateLine(endLineId, { end_date: null });
    expect(rejectedEndClear).toMatchObject({ messageKey: 'msp/contracts:contractLines.errors.protectedEndDate', messageParams: { boundary: '2026-07-01' } });
    expect((await persistedLine(endLineId)).end_date).toBeNull();
  });

  it('keeps a cancelled recurring claim locked and protects its period after invoice linkage is released', async () => {
    const now = context.db.fn.now();
    const contractId = await context.createEntity('contracts', {
      contract_name: `Cancelled claim ${randomUUID().slice(0, 8)}`, status: 'draft', is_template: false,
      is_active: true, billing_frequency: 'monthly', currency_code: 'USD', owner_client_id: context.clientId,
      created_at: now, updated_at: now,
    }, 'contract_id');
    const lineId = await createLine(contractId);
    await createAssignment(contractId, '2026-01-01', '2027-12-31');
    const serviceId = await createTestService(context, { service_name: `Cancelled claim ${randomUUID().slice(0, 8)}` });
    const configId = randomUUID();
    await context.db('contract_line_service_configuration').insert({
      config_id: configId, tenant: context.tenantId, contract_line_id: lineId, service_id: serviceId,
      configuration_type: 'Fixed', created_at: now, updated_at: now,
    });

    const invoiceId = await context.createEntity('invoices', {
      invoice_number: `CANCEL-CLAIM-${randomUUID().slice(0, 8)}`, invoice_date: '2026-07-01', due_date: '2026-08-01',
      status: 'draft', client_id: context.clientId, currency_code: 'USD', is_manual: false,
      total_amount: 10000, subtotal: 10000, tax: 0, created_at: now, updated_at: now,
    }, 'invoice_id');
    const itemId = randomUUID();
    const detailId = randomUUID();
    const claimId = randomUUID();
    await context.db('invoice_charges').insert({
      item_id: itemId, tenant: context.tenantId, invoice_id: invoiceId,
      description: 'Recurring service period', quantity: 1, unit_price: 10000,
      total_price: 10000, net_amount: 10000, tax_amount: 0, tax_rate: 0,
      is_manual: false, is_discount: false, is_taxable: false,
    });
    await context.db('invoice_charge_details').insert({
      item_detail_id: detailId, item_id: itemId, tenant: context.tenantId, service_id: serviceId,
      config_id: configId, quantity: 1, rate: 10000,
      service_period_start: '2026-06-01', service_period_end: '2026-07-01', created_at: now, updated_at: now,
    });
    await context.db('recurring_service_periods').insert({
      record_id: claimId, tenant: context.tenantId,
      schedule_key: `schedule:${context.tenantId}:contract_line:${lineId}:contract:arrears`,
      period_key: `period:2026-06-01:2026-07-01`, revision: 1,
      obligation_id: lineId, obligation_type: 'contract_line', charge_family: 'fixed',
      cadence_owner: 'contract', due_position: 'arrears', lifecycle_state: 'billed',
      service_period_start: '2026-06-01', service_period_end: '2026-07-01',
      invoice_window_start: '2026-06-01', invoice_window_end: '2026-07-01',
      activity_window_start: null, activity_window_end: null, timing_metadata: null,
      provenance_kind: 'generated', source_rule_version: 'test', reason_code: null, source_run_key: 'test',
      supersedes_record_id: null, invoice_id: invoiceId, invoice_charge_id: itemId,
      invoice_charge_detail_id: detailId, invoice_linked_at: now,
    });

    await expect(cancelDraftInvoice(invoiceId)).resolves.toMatchObject({ success: true });
    expect(await context.db('invoices').where({ invoice_id: invoiceId }).first()).toBeUndefined();
    const releasedClaim = await context.db('recurring_service_periods').where({ record_id: claimId }).first();
    expect(releasedClaim).toMatchObject({
      lifecycle_state: 'locked', invoice_id: null, invoice_charge_id: null,
      invoice_charge_detail_id: null, invoice_linked_at: null,
    });

    const beforeRejectedBounds = await persistedLine(lineId);
    await expect(updateLine(lineId, { start_date: '2026-06-02' })).resolves.toMatchObject({
      messageKey: 'msp/contracts:contractLines.errors.protectedStartDate',
      messageParams: { boundary: '2026-06-01' },
    });
    await expect(updateLine(lineId, { end_date: '2026-06-30' })).resolves.toMatchObject({
      messageKey: 'msp/contracts:contractLines.errors.protectedEndDate',
      messageParams: { boundary: '2026-07-01' },
    });
    expect(await persistedLine(lineId)).toMatchObject({
      start_date: beforeRejectedBounds.start_date,
      end_date: beforeRejectedBounds.end_date,
      invoice_line_description: beforeRejectedBounds.invoice_line_description,
    });

    const safeEdit = await updateLine(lineId, {
      invoice_line_description: 'Corrected after cancellation', end_date: '2027-01-01',
    });
    expect(safeEdit).toMatchObject({ invoice_line_description: 'Corrected after cancellation' });
    expect(dateOnly(safeEdit.end_date as Date | string)).toBe('2027-01-01');
    const persistedSafeEdit = await persistedLine(lineId);
    expect(persistedSafeEdit.invoice_line_description).toBe('Corrected after cancellation');
    expect(dateOnly(persistedSafeEdit.end_date)).toBe('2027-01-01');
    await expect(updateLine(lineId, { end_date: null })).resolves.toMatchObject({ end_date: null });
    expect((await persistedLine(lineId)).end_date).toBeNull();
    expect((await context.db('recurring_service_periods').where({ record_id: claimId }).first()).lifecycle_state).toBe('locked');
  });
});
