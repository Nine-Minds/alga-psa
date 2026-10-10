import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  createSeatCatalog,
  createSeatClient,
  ensureFixtureTenant,
  tenantTable,
  type SeatClient,
} from '../../../../test-utils/perSeatFixtures';

// alga0002168: a quote-converted contract with recurring fixed lines, once Set to
// Active, must give a first invoice that can be previewed and generated; and when a
// recurring run fails the operator sees a coded reason, never the old generic sentence.

const HOOK_TIMEOUT = 240_000;
const OLD_SENTENCE = 'Failed to generate invoice for this billing cycle.';
const JULY = '2026-07';

let db: Knex;
let tenantId: string;
const TEST_USER_ID = uuidv4();
let convertQuoteToContract: typeof import('@alga-psa/billing/actions/quoteActions').convertQuoteToContract;
let activateClientContractForBilling: typeof import('@alga-psa/billing/actions/billingClientsActions').activateClientContractForBilling;
let getAvailableRecurringDueWork: typeof import('@alga-psa/billing/actions/billingAndTax').getAvailableRecurringDueWork;
let repairAllRecurringServicePeriodsForTenant: typeof import('@alga-psa/billing/actions/recurringServicePeriodActions').repairAllRecurringServicePeriodsForTenant;
let previewGroupedInvoicesForSelectionInputs: typeof import('@alga-psa/billing/actions/invoiceGeneration').previewGroupedInvoicesForSelectionInputs;
let generateGroupedInvoicesAsRecurringBillingRun: typeof import('@alga-psa/billing/actions/recurringBillingRunActions').generateGroupedInvoicesAsRecurringBillingRun;
let generateInvoicesAsRecurringBillingRun: typeof import('@alga-psa/billing/actions/recurringBillingRunActions').generateInvoicesAsRecurringBillingRun;
let deleteContract: typeof import('@alga-psa/billing/actions/contractActions').deleteContract;
let Quote: any;
let QuoteItem: any;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      (knexOrTrx as Knex).transaction((trx) => callback(trx)),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: TEST_USER_ID, tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  const { withAuth } = await import('@alga-psa/auth/withAuth');
  return { ...createAuthModuleMock(), withAuth, localizeActionError: async <T>(result: T) => result };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/billing/src/lib/authHelpers')>(
    '../../../../../packages/billing/src/lib/authHelpers',
  );
  return {
    ...actual,
    getCurrentUserAsync: vi.fn(async () => ({
      user_id: TEST_USER_ID,
      tenant: tenantId,
      username: 'first-invoice-tester',
      email: 'first-invoice@example.com',
      user_type: 'internal',
      roles: [{ role_name: 'Admin' }],
    })),
    hasPermissionAsync: vi.fn(async () => true),
  };
});

type Item = { serviceId: string; description: string; unitPrice: number; recurring: boolean };

async function acceptedQuote(clientId: string, items: Item[]) {
  const quote = await Quote.create(db, tenantId, {
    client_id: clientId,
    title: `First invoice quote ${uuidv4().slice(0, 6)}`,
    description: 'alga0002168',
    quote_date: '2026-07-10T00:00:00.000Z',
    valid_until: '2026-07-30T00:00:00.000Z',
    subtotal: 0,
    discount_total: 0,
    tax: 0,
    total_amount: 0,
    currency_code: 'USD',
    is_template: false,
  } as any);
  for (const item of items) {
    await QuoteItem.create(db, tenantId, {
      quote_id: quote.quote_id,
      service_id: item.serviceId,
      description: item.description,
      quantity: 1,
      unit_price: item.unitPrice,
      is_optional: false,
      is_selected: true,
      is_recurring: item.recurring,
      ...(item.recurring ? { billing_frequency: 'monthly' } : {}),
      billing_method: 'fixed',
      is_discount: false,
      is_taxable: false,
    } as any);
  }
  await tenantTable(db, tenantId, 'quotes')
    .where({ tenant: tenantId, quote_id: quote.quote_id })
    .update({ status: 'accepted', accepted_at: '2026-07-23T15:42:10.000Z' });
  return quote.quote_id as string;
}

async function newClientWithJulyCycle(name: string): Promise<{ client: SeatClient; name: string; cycleId: string }> {
  const clientName = `${name} ${uuidv4().slice(0, 6)}`;
  const client = await createSeatClient(db, tenantId, { name: clientName });
  const cycleId = await client.addMonthlyCycle('2026-07-01', '2026-08-01');
  return { client, name: clientName, cycleId };
}

async function convertAndLoad(quoteId: string) {
  const converted: any = await convertQuoteToContract(quoteId);
  expect(converted.contract, JSON.stringify(converted)).toBeTruthy();
  const contractId = converted.contract.contract_id as string;
  const lines = await tenantTable(db, tenantId, 'contract_lines').where({ tenant: tenantId, contract_id: contractId });
  const assignment: any = await tenantTable(db, tenantId, 'client_contracts')
    .where({ tenant: tenantId, contract_id: contractId })
    .first();
  return { contractId, lines: lines as any[], assignment };
}

async function julyCandidate(clientName: string) {
  const due: any = await getAvailableRecurringDueWork({ clientName, pageSize: 100 } as any);
  const candidates: any[] = due.invoiceCandidates ?? [];
  return {
    due,
    candidate: candidates.find((c) => String(c.windowStart).startsWith(JULY)),
  };
}

async function invoicesFor(clientId: string) {
  return tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, client_id: clientId });
}

describe('quote-converted contract: first invoice (alga0002168)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: process.env.TEST_DB_NAME || 'test_db_alga0002168_first_invoice' });
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    await tenantTable(db, tenantId, 'users').insert({
      tenant: tenantId,
      user_id: TEST_USER_ID,
      username: `first-invoice-${TEST_USER_ID.slice(0, 8)}`,
      email: `first-invoice-${TEST_USER_ID.slice(0, 8)}@example.com`,
      hashed_password: 'x',
      first_name: 'First',
      last_name: 'Invoice',
      user_type: 'internal',
      is_inactive: false,
    });
    setupCommonMocks({ tenantId, userId: TEST_USER_ID, permissionCheck: () => true });
    ({ convertQuoteToContract } = await import('@alga-psa/billing/actions/quoteActions'));
    ({ activateClientContractForBilling } = await import('@alga-psa/billing/actions/billingClientsActions'));
    ({ getAvailableRecurringDueWork } = await import('@alga-psa/billing/actions/billingAndTax'));
    ({ repairAllRecurringServicePeriodsForTenant } = await import('@alga-psa/billing/actions/recurringServicePeriodActions'));
    ({ previewGroupedInvoicesForSelectionInputs } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ generateGroupedInvoicesAsRecurringBillingRun, generateInvoicesAsRecurringBillingRun } =
      await import('@alga-psa/billing/actions/recurringBillingRunActions'));
    ({ deleteContract } = await import('@alga-psa/billing/actions/contractActions'));
    Quote = (await import('../../../../../packages/billing/src/models/quote')).default;
    QuoteItem = (await import('../../../../../packages/billing/src/models/quoteItem')).default;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  async function threeLineQuote(clientId: string) {
    const [a, b, c, once] = await createSeatCatalog(db, tenantId, [
      { name: 'Managed Services', rateCents: 150000 },
      { name: 'Security', rateCents: 200000 },
      { name: 'Backup', rateCents: 70000 },
      { name: 'Onboarding', rateCents: 99900 },
    ]);
    return acceptedQuote(clientId, [
      { serviceId: a.serviceId, description: 'Managed Services', unitPrice: 150000, recurring: true },
      { serviceId: b.serviceId, description: 'Security', unitPrice: 200000, recurring: true },
      { serviceId: c.serviceId, description: 'Backup', unitPrice: 70000, recurring: true },
      { serviceId: once.serviceId, description: 'Onboarding', unitPrice: 99900, recurring: false },
    ]);
  }

  async function activateAndFind(clientName: string, assignment: any) {
    const activated: any = await activateClientContractForBilling(assignment.client_contract_id);
    expect(activated.actionError ?? activated.message).toBeUndefined();
    return julyCandidate(clientName);
  }

  it('1. converts, Set to Active, then previews and generates the July invoice', async () => {
    const { client, name } = await newClientWithJulyCycle('Scenario1');
    const quoteId = await threeLineQuote(client.clientId);
    const { contractId, lines, assignment } = await convertAndLoad(quoteId);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every((line) => line.is_active === true)).toBe(true);
    expect(assignment.is_active).toBe(false);

    const { due, candidate } = await activateAndFind(name, assignment);
    const periods = await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({ tenant: tenantId })
      .whereIn('obligation_id', lines.map((l) => l.contract_line_id));
    expect(periods.some((p: any) => String(p.service_period_start instanceof Date
      ? p.service_period_start.toISOString() : p.service_period_start).startsWith(JULY))).toBe(true);
    expect(due.materializationGaps.filter((g: any) => g.clientId === client.clientId)).toEqual([]);
    expect(candidate?.canGenerate).toBe(true);

    const selectorInputs = candidate.members.map((m: any) => m.selectorInput);
    const preview: any = await previewGroupedInvoicesForSelectionInputs([
      { previewGroupKey: 'july', selectorInputs },
    ] as any);
    expect(preview.success).toBe(true);
    expect(Number(preview.previews[0].data.subtotal)).toBe(420000);

    const run: any = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [{ groupKey: 'july', selectorInputs, billingCycleId: candidate.members[0].billingCycleId ?? undefined }],
    } as any);
    expect(run.failures, JSON.stringify(run)).toEqual([]);
    expect(run.invoicesCreated).toBe(1);

    const invoices: any[] = await invoicesFor(client.clientId);
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0].subtotal)).toBe(420000);
    const charges = await tenantTable(db, tenantId, 'invoice_charges')
      .where({ tenant: tenantId, invoice_id: invoices[0].invoice_id });
    expect(charges.some((c: any) => /Onboarding/.test(c.description))).toBe(false);
    expect(contractId).toBeTruthy();
  }, HOOK_TIMEOUT);

  it('2. a draft contract does not block a sibling healthy contract window', async () => {
    const { client, name } = await newClientWithJulyCycle('Scenario2');
    const [svc] = await createSeatCatalog(db, tenantId, [{ name: 'Sibling', rateCents: 50000 }]);
    const [svc2] = await createSeatCatalog(db, tenantId, [{ name: 'Draft', rateCents: 70000 }]);

    const healthy = await convertAndLoad(
      await acceptedQuote(client.clientId, [{ serviceId: svc.serviceId, description: 'Sibling', unitPrice: 50000, recurring: true }]),
    );
    const { candidate: first } = await activateAndFind(name, healthy.assignment);
    expect(first?.canGenerate).toBe(true);

    // A second converted contract stays a draft (assignment inactive).
    const draft = await convertAndLoad(
      await acceptedQuote(client.clientId, [{ serviceId: svc2.serviceId, description: 'Draft', unitPrice: 70000, recurring: true }]),
    );
    expect(draft.assignment.is_active).toBe(false);

    const { due, candidate } = await julyCandidate(name);
    expect(candidate).toBeTruthy();
    expect(due.materializationGaps.filter((g: any) => g.clientId === client.clientId)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('3. legacy converted contract (inactive lines) is repaired by the migration and Fix all', async () => {
    const { client, name } = await newClientWithJulyCycle('Scenario3');
    const quoteId = await threeLineQuote(client.clientId);
    const { contractId, lines, assignment } = await convertAndLoad(quoteId);

    // Old shape: lines inactive (created_at == updated_at), already activated.
    await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: contractId })
      .update({ is_active: false, updated_at: db.raw('created_at') });
    await tenantTable(db, tenantId, 'client_contracts')
      .where({ tenant: tenantId, client_contract_id: assignment.client_contract_id })
      .update({ is_active: true });
    await tenantTable(db, tenantId, 'contracts')
      .where({ tenant: tenantId, contract_id: contractId })
      .update({ status: 'active', is_active: true });

    const before = await julyCandidate(name);
    expect(before.candidate).toBeUndefined();

    const migration = await import('../../../../migrations/20261010040511_activate_quote_converted_contract_lines.cjs' as string);
    await (migration.up ?? migration.default.up)(db);

    const after = await tenantTable(db, tenantId, 'contract_lines').where({ tenant: tenantId, contract_id: contractId });
    expect(after.length).toBe(lines.length);
    expect(after.every((l: any) => l.is_active === true)).toBe(true);

    const summary: any = await repairAllRecurringServicePeriodsForTenant();
    expect(summary.actionError ?? summary.message).toBeUndefined();

    const { candidate } = await julyCandidate(name);
    expect(candidate?.canGenerate).toBe(true);
    const run: any = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [{
        groupKey: 'legacy',
        selectorInputs: candidate.members.map((m: any) => m.selectorInput),
        billingCycleId: candidate.members[0].billingCycleId ?? undefined,
      }],
    } as any);
    expect(run.failures, JSON.stringify(run)).toEqual([]);
    expect(run.invoicesCreated).toBe(1);
    expect(await invoicesFor(client.clientId)).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('4. failures are coded on the single and grouped paths', async () => {
    const { client, name } = await newClientWithJulyCycle('Scenario4');
    const quoteId = await threeLineQuote(client.clientId);
    const { assignment } = await convertAndLoad(quoteId);
    const { candidate } = await activateAndFind(name, assignment);
    expect(candidate?.canGenerate).toBe(true);
    const members: any[] = candidate.members;
    const selectorInputs = members.map((m) => m.selectorInput);
    const billingCycleId = members[0].billingCycleId ?? undefined;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logged = () => errorSpy.mock.calls.map((call) => call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')).join('\n');

    // (a) injected DB fault -> UNEXPECTED with a ref, on both paths
    const triggerName = `fail_charge_${uuidv4().slice(0, 6)}`;
    await db.raw(`CREATE OR REPLACE FUNCTION ${triggerName}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected invoice_charges fault'; END; $$ LANGUAGE plpgsql`);
    await db.raw(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON invoice_charges FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
    try {
      const grouped: any = await generateGroupedInvoicesAsRecurringBillingRun({
        groupedTargets: [{ groupKey: 'g', selectorInputs, billingCycleId }],
      } as any);
      expect(grouped.invoicesCreated).toBe(0);
      expect(grouped.failures).toHaveLength(1);
      expect(grouped.failures[0].code).toBe('UNEXPECTED');
      expect(grouped.failures[0].params?.ref).toMatch(/^[0-9a-f]{8}$/);
      expect(grouped.failures[0].errorMessage).not.toBe(OLD_SENTENCE);
      expect(grouped.failures[0].errorMessage).toContain(grouped.failures[0].params.ref);
      expect(logged()).toContain(grouped.failures[0].params.ref);

      const single: any = await generateInvoicesAsRecurringBillingRun({
        targets: members.map((m) => ({ selectorInput: m.selectorInput, executionWindow: m.executionWindow, billingCycleId })),
      } as any);
      expect(single.invoicesCreated).toBe(0);
      expect(single.failures.length).toBeGreaterThan(0);
      for (const failure of single.failures) {
        expect(failure.code).toBe('UNEXPECTED');
        expect(failure.params?.ref).toMatch(/^[0-9a-f]{8}$/);
        expect(failure.errorMessage).not.toBe(OLD_SENTENCE);
        expect(logged()).toContain(failure.params.ref);
      }
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON invoice_charges`);
      await db.raw(`DROP FUNCTION IF EXISTS ${triggerName}()`);
    }

    // (b) periods gone -> RECURRING_PERIODS_NOT_MATERIALIZED on both paths
    const lineIds = (await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: assignment.contract_id })
      .select('contract_line_id')).map((r: any) => r.contract_line_id);
    const deletedPeriods = await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({ tenant: tenantId })
      .whereIn('obligation_id', lineIds)
      .delete();
    expect(deletedPeriods).toBeGreaterThan(0);
    const groupedMissing: any = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [{ groupKey: 'g2', selectorInputs, billingCycleId }],
    } as any);
    const singleMissing: any = await generateInvoicesAsRecurringBillingRun({
      targets: members.map((m) => ({ selectorInput: m.selectorInput, executionWindow: m.executionWindow, billingCycleId })),
    } as any);
    errorSpy.mockRestore();
    for (const result of [groupedMissing, singleMissing]) {
      expect(result.invoicesCreated).toBe(0);
      expect(result.failures.length).toBeGreaterThan(0);
      for (const failure of result.failures) {
        expect(failure.code).toBe('RECURRING_PERIODS_NOT_MATERIALIZED');
        expect(failure.errorMessage).not.toBe(OLD_SENTENCE);
      }
    }
  }, HOOK_TIMEOUT);

  it('5. delete: allowed after a failed generation, refused once an invoice exists, generic error is keyed', async () => {
    const { client, name } = await newClientWithJulyCycle('Scenario5');
    const quoteId = await threeLineQuote(client.clientId);
    const { contractId, assignment } = await convertAndLoad(quoteId);
    const { candidate } = await activateAndFind(name, assignment);
    const selectorInputs = candidate.members.map((m: any) => m.selectorInput);
    const billingCycleId = candidate.members[0].billingCycleId ?? undefined;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const triggerName = `fail_del_${uuidv4().slice(0, 6)}`;
    await db.raw(`CREATE OR REPLACE FUNCTION ${triggerName}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected invoice_charges fault'; END; $$ LANGUAGE plpgsql`);
    await db.raw(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON invoice_charges FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
    try {
      const failed: any = await generateGroupedInvoicesAsRecurringBillingRun({
        groupedTargets: [{ groupKey: 'd', selectorInputs, billingCycleId }],
      } as any);
      expect(failed.invoicesCreated).toBe(0);
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON invoice_charges`);
      await db.raw(`DROP FUNCTION IF EXISTS ${triggerName}()`);
    }
    expect(await invoicesFor(client.clientId)).toHaveLength(0);

    // Generate for real, then deletion must be refused with the keyed reason.
    const ok: any = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [{ groupKey: 'd2', selectorInputs, billingCycleId }],
    } as any);
    expect(ok.invoicesCreated, JSON.stringify(ok.failures)).toBe(1);
    const refused: any = await deleteContract(contractId);
    expect(refused?.messageKey).toBe('msp/contracts:errors.contract.hasInvoices');

    // A second, never-invoiced converted contract deletes cleanly.
    const [svc] = await createSeatCatalog(db, tenantId, [{ name: 'Deletable', rateCents: 1000 }]);
    const other = await convertAndLoad(
      await acceptedQuote(client.clientId, [{ serviceId: svc.serviceId, description: 'Deletable', unitPrice: 1000, recurring: true }]),
    );
    const deleted: any = await deleteContract(other.contractId);
    expect(deleted?.messageKey).toBeUndefined();
    expect(await tenantTable(db, tenantId, 'contracts').where({ tenant: tenantId, contract_id: other.contractId })).toHaveLength(0);

    // Unmapped failure -> keyed generic error with a logged ref (not the raw exception).
    const triggerDel = `fail_ct_${uuidv4().slice(0, 6)}`;
    const [svc3] = await createSeatCatalog(db, tenantId, [{ name: 'Faulty', rateCents: 1000 }]);
    const faulty = await convertAndLoad(
      await acceptedQuote(client.clientId, [{ serviceId: svc3.serviceId, description: 'Faulty', unitPrice: 1000, recurring: true }]),
    );
    await db.raw(`CREATE OR REPLACE FUNCTION ${triggerDel}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected contract delete fault'; END; $$ LANGUAGE plpgsql`);
    await db.raw(`CREATE TRIGGER ${triggerDel} BEFORE DELETE ON contracts FOR EACH ROW EXECUTE FUNCTION ${triggerDel}()`);
    try {
      const generic: any = await deleteContract(faulty.contractId);
      expect(generic?.messageKey).toBe('msp/contracts:errors.contract.deleteFailed');
      expect(generic.messageParams?.ref ?? generic.params?.ref).toMatch(/^[0-9a-f]{8}$/);
      expect(generic.actionError).not.toContain('injected');
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS ${triggerDel} ON contracts`);
      await db.raw(`DROP FUNCTION IF EXISTS ${triggerDel}()`);
      errorSpy.mockRestore();
    }
  }, HOOK_TIMEOUT);
});
