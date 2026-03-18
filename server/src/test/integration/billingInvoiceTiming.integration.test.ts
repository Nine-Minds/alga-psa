import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings
} from '../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { Temporal } from '@js-temporal/polyfill';
import { BillingEngine } from '@alga-psa/billing/services';
import { buildContractCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

let db: Knex;
let tenantId: string;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let generateInvoiceForSelectionInput: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoiceForSelectionInput;
const authRef = vi.hoisted(() => ({
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: 'test-user',
}));

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(() => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(() => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
    withTransaction: vi.fn(async (_knex: unknown, fn: (trx: Knex) => Promise<any>) => fn(db)),
    requireTenantId: vi.fn(async () => tenantId),
    auditLog: vi.fn(async () => undefined),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        {
          user_id: authRef.userId,
          tenant: authRef.tenantId,
          roles: [],
        },
        { tenant: authRef.tenantId },
        ...args
      ),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        {
          user_id: authRef.userId,
          tenant: authRef.tenantId,
          roles: [],
        },
        { tenant: authRef.tenantId },
        ...args
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

describe('Billing Invoice Timing Integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.E2E_AUTH_BYPASS = 'true';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    authRef.tenantId = tenantId;
    ({ generateInvoice, generateInvoiceForSelectionInput } = await import('@alga-psa/billing/actions/invoiceGeneration'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('books arrears contract lines onto the following invoice with prior-period service dates', async () => {
    setupCommonMocks({ tenantId, userId: 'test-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      januaryStart
    } = await createClientWithCycles();

    const februaryStart = Temporal.PlainDate.from(januaryStart).add({ months: 1 }).toString();

    const { clientContractLineId } = await createFixedContractLine(contextLike, {
      serviceName: 'Integration Arrears Support',
      planName: 'Integration Arrears Plan',
      baseRateCents: 20000,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });

    const engine = new BillingEngine();
    const billingResult = await engine.calculateBilling(
      contextLike.clientId,
      januaryStart,
      februaryStart,
      januaryCycleId
    );

    // A fixed arrears line should produce at least one charge for the following cycle.
    expect(billingResult.charges.length).toBeGreaterThan(0);
    const fixedCharge = billingResult.charges.find((charge) => charge.type === 'fixed');
    expect(fixedCharge).toBeTruthy();
    // The charge should be tagged as arrears and include the previous cycle's balance.
    expect(fixedCharge?.billingTiming).toBe('arrears');
    expect((fixedCharge?.total ?? 0) > 0).toBe(true);

    const expectedStart = Temporal.PlainDate.from(januaryStart.slice(0, 10))
      .subtract({ months: 1 })
      .toString();
    const expectedEnd = Temporal.PlainDate.from(januaryStart.slice(0, 10))
      .subtract({ days: 1 })
      .toString();
    expect(fixedCharge?.servicePeriodStart).toBe(expectedStart);
    expect(fixedCharge?.servicePeriodEnd).toBe(expectedEnd);
  }, HOOK_TIMEOUT);

  it('persists arrears invoice detail service periods on generated invoices', async () => {
    setupCommonMocks({ tenantId, userId: 'arrears-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      decemberStart,
      decemberEnd
    } = await createClientWithCycles('Arrears Invoice Client');

    const { serviceId } = await createFixedContractLine(contextLike, {
      serviceName: 'Arrears Invoice Support',
      planName: 'Arrears Invoice Plan',
      baseRateCents: 15000,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });

    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();

    const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
    const arrearsDetail = detailRows.find((row) => row.service_id === serviceId);
    expect(arrearsDetail).toBeTruthy();
    expect(normalizeDateValue(arrearsDetail?.service_period_start)).toBe(decemberStart);
    expect(normalizeDateValue(arrearsDetail?.service_period_end)).toBe(decemberEnd);
    expect(arrearsDetail?.billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('persists advance invoice detail service periods for current cycles', async () => {
    setupCommonMocks({ tenantId, userId: 'advance-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      januaryStart,
      januaryEnd
    } = await createClientWithCycles('Advance Invoice Client');

    const { serviceId } = await createFixedContractLine(contextLike, {
      serviceName: 'Advance Invoice Support',
      planName: 'Advance Invoice Plan',
      baseRateCents: 18000,
      startDate: '2024-12-01',
      billingTiming: 'advance'
    });

    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();

    const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
    const advanceDetail = detailRows.find((row) => row.service_id === serviceId);
    expect(advanceDetail).toBeTruthy();
    expect(normalizeDateValue(advanceDetail?.service_period_start)).toBe(januaryStart);
    expect(normalizeDateValue(advanceDetail?.service_period_end)).toBe(januaryEnd);
    expect(advanceDetail?.billing_timing).toBe('advance');
  }, HOOK_TIMEOUT);

  it('persists mixed timing invoice detail metadata for arrears and advance lines', async () => {
    setupCommonMocks({ tenantId, userId: 'mixed-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      decemberStart,
      decemberEnd,
      januaryStart,
      januaryEnd
    } = await createClientWithCycles('Mixed Timing Client');

    const arrearsLine = await createFixedContractLine(contextLike, {
      serviceName: 'Mixed Arrears Service',
      planName: 'Mixed Arrears Plan',
      baseRateCents: 21000,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });

  const advanceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Mixed Advance Service',
    planName: 'Mixed Advance Plan',
    baseRateCents: 22000,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    contractId: arrearsLine.contractId,
    clientContractId: arrearsLine.clientContractId
  });

    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();

    const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
    const detailByService = new Map(detailRows.map((row) => [row.service_id, row]));

    const arrearsDetail = detailByService.get(arrearsLine.serviceId);
    const advanceDetail = detailByService.get(advanceLine.serviceId);

    expect(arrearsDetail).toBeTruthy();
    expect(advanceDetail).toBeTruthy();

    expect(normalizeDateValue(arrearsDetail?.service_period_start)).toBe(decemberStart);
    expect(normalizeDateValue(arrearsDetail?.service_period_end)).toBe(decemberEnd);
    expect(arrearsDetail?.billing_timing).toBe('arrears');

    expect(normalizeDateValue(advanceDetail?.service_period_start)).toBe(januaryStart);
    expect(normalizeDateValue(advanceDetail?.service_period_end)).toBe(januaryEnd);
    expect(advanceDetail?.billing_timing).toBe('advance');
  }, HOOK_TIMEOUT);

it('T152: DB-backed monthly client-cadence recurring invoices preserve mixed advance and arrears outputs under the service-period-first engine', async () => {
  setupCommonMocks({ tenantId, userId: 'monthly-parity-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    previousPeriodStart,
    previousPeriodEnd,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart
  } = await createClientWithRecurringCycles({
    clientName: 'Monthly Parity Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01'
  });

  const arrearsLine = await createFixedContractLine(contextLike, {
    serviceName: 'Monthly Parity Arrears Service',
    planName: 'Monthly Parity Arrears Plan',
    baseRateCents: 15000,
    startDate: previousPeriodStart,
    billingTiming: 'arrears',
    billingFrequency: 'monthly'
  });

  const advanceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Monthly Parity Advance Service',
    planName: 'Monthly Parity Advance Plan',
    baseRateCents: 18000,
    startDate: previousPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    contractId: arrearsLine.contractId,
    clientContractId: arrearsLine.clientContractId
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(330);
  const persistedInvoice = await getPersistedInvoice(invoice!.invoice_id);
  expect(normalizeDateValue(persistedInvoice?.billing_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(persistedInvoice?.billing_period_end)).toBe(nextPeriodStart);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(2);

  const detailByService = new Map(detailRows.map((row) => [row.service_id, row]));
  expect(detailByService.get(arrearsLine.serviceId)).toMatchObject({
    billing_timing: 'arrears'
  });
  expect(normalizeDateValue(detailByService.get(arrearsLine.serviceId)?.service_period_start)).toBe(previousPeriodStart);
  expect(normalizeDateValue(detailByService.get(arrearsLine.serviceId)?.service_period_end)).toBe(previousPeriodEnd);

  expect(detailByService.get(advanceLine.serviceId)).toMatchObject({
    billing_timing: 'advance'
  });
  expect(normalizeDateValue(detailByService.get(advanceLine.serviceId)?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailByService.get(advanceLine.serviceId)?.service_period_end)).toBe(currentPeriodEnd);
}, HOOK_TIMEOUT);

it('T153: DB-backed annual client-cadence recurring invoices preserve longer-frequency advance and arrears outputs under the service-period-first engine', async () => {
  setupCommonMocks({ tenantId, userId: 'annual-parity-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    previousPeriodStart,
    previousPeriodEnd,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart
  } = await createClientWithRecurringCycles({
    clientName: 'Annual Parity Client',
    billingCycle: 'annually',
    previousPeriodStart: '2024-01-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2026-01-01'
  });

  const arrearsLine = await createFixedContractLine(contextLike, {
    serviceName: 'Annual Parity Arrears Service',
    planName: 'Annual Parity Arrears Plan',
    baseRateCents: 120000,
    startDate: previousPeriodStart,
    billingTiming: 'arrears',
    billingFrequency: 'annually'
  });

  const advanceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Annual Parity Advance Service',
    planName: 'Annual Parity Advance Plan',
    baseRateCents: 240000,
    startDate: previousPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'annually',
    contractId: arrearsLine.contractId,
    clientContractId: arrearsLine.clientContractId
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(3600);
  const persistedInvoice = await getPersistedInvoice(invoice!.invoice_id);
  expect(normalizeDateValue(persistedInvoice?.billing_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(persistedInvoice?.billing_period_end)).toBe(nextPeriodStart);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(2);

  const detailByService = new Map(detailRows.map((row) => [row.service_id, row]));
  expect(detailByService.get(arrearsLine.serviceId)).toMatchObject({
    billing_timing: 'arrears'
  });
  expect(normalizeDateValue(detailByService.get(arrearsLine.serviceId)?.service_period_start)).toBe(previousPeriodStart);
  expect(normalizeDateValue(detailByService.get(arrearsLine.serviceId)?.service_period_end)).toBe(previousPeriodEnd);

  expect(detailByService.get(advanceLine.serviceId)).toMatchObject({
    billing_timing: 'advance'
  });
  expect(normalizeDateValue(detailByService.get(advanceLine.serviceId)?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailByService.get(advanceLine.serviceId)?.service_period_end)).toBe(currentPeriodEnd);
}, HOOK_TIMEOUT);

it('T171: DB-backed monthly client-cadence recurring fixed invoice generation still succeeds on canonical service periods after cutover', async () => {
  setupCommonMocks({ tenantId, userId: 'monthly-sanity-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart
  } = await createClientWithRecurringCycles({
    clientName: 'Monthly Sanity Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01'
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Monthly Sanity Fixed Service',
    planName: 'Monthly Sanity Fixed Plan',
    baseRateCents: 17500,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly'
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(175);

  const persistedInvoice = await getPersistedInvoice(invoice!.invoice_id);
  expect(normalizeDateValue(persistedInvoice?.billing_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(persistedInvoice?.billing_period_end)).toBe(nextPeriodStart);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(1);
  expect(detailRows[0]).toMatchObject({
    service_id: fixedLine.serviceId,
    billing_timing: 'advance'
  });
  expect(normalizeDateValue(detailRows[0]?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailRows[0]?.service_period_end)).toBe(currentPeriodEnd);
}, HOOK_TIMEOUT);

it('T172: DB-backed quarterly client-cadence recurring fixed invoice generation still succeeds on canonical service periods after cutover', async () => {
  setupCommonMocks({ tenantId, userId: 'quarterly-sanity-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    previousPeriodStart,
    previousPeriodEnd,
    currentPeriodStart,
    nextPeriodStart
  } = await createClientWithRecurringCycles({
    clientName: 'Quarterly Sanity Client',
    billingCycle: 'quarterly',
    previousPeriodStart: '2024-10-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-04-01'
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Quarterly Sanity Fixed Service',
    planName: 'Quarterly Sanity Fixed Plan',
    baseRateCents: 54000,
    startDate: previousPeriodStart,
    billingTiming: 'arrears',
    billingFrequency: 'quarterly'
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(540);

  const persistedInvoice = await getPersistedInvoice(invoice!.invoice_id);
  expect(normalizeDateValue(persistedInvoice?.billing_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(persistedInvoice?.billing_period_end)).toBe(nextPeriodStart);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(1);
  expect(detailRows[0]).toMatchObject({
    service_id: fixedLine.serviceId,
    billing_timing: 'arrears'
  });
  expect(normalizeDateValue(detailRows[0]?.service_period_start)).toBe(previousPeriodStart);
  expect(normalizeDateValue(detailRows[0]?.service_period_end)).toBe(previousPeriodEnd);
}, HOOK_TIMEOUT);

it('T173: DB-backed recurring product invoices continue to generate correctly under client cadence after cutover', async () => {
  setupCommonMocks({ tenantId, userId: 'product-sanity-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    currentPeriodEnd
  } = await createClientWithRecurringCycles({
    clientName: 'Product Sanity Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01'
  });

  const productLine = await createRecurringCatalogLine(contextLike, {
    serviceName: 'Managed Firewall Appliance',
    planName: 'Managed Firewall Appliance Plan',
    baseRateCents: 4500,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    quantity: 2,
    isLicense: false
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(9000);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(1);
  expect(detailRows[0]).toMatchObject({
    service_id: productLine.serviceId,
    billing_timing: 'advance'
  });
  expect(normalizeDateValue(detailRows[0]?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailRows[0]?.service_period_end)).toBe(currentPeriodEnd);
}, HOOK_TIMEOUT);

it('T174: DB-backed recurring license invoices continue to generate correctly under client cadence after cutover', async () => {
  setupCommonMocks({ tenantId, userId: 'license-sanity-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    previousPeriodStart,
    previousPeriodEnd
  } = await createClientWithRecurringCycles({
    clientName: 'License Sanity Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01'
  });

  const licenseLine = await createRecurringCatalogLine(contextLike, {
    serviceName: 'Microsoft 365 Business Premium',
    planName: 'Microsoft 365 Business Premium Plan',
    baseRateCents: 3100,
    startDate: previousPeriodStart,
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    quantity: 3,
    isLicense: true
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(9300);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(1);
  expect(detailRows[0]).toMatchObject({
    service_id: licenseLine.serviceId,
    billing_timing: 'arrears'
  });
  expect(normalizeDateValue(detailRows[0]?.service_period_start)).toBe(previousPeriodStart);
  expect(normalizeDateValue(detailRows[0]?.service_period_end)).toBe(previousPeriodEnd);
}, HOOK_TIMEOUT);

it('F221: DB-backed recurring invoice generation succeeds while dropped recurrence tables remain absent', async () => {
  setupCommonMocks({ tenantId, userId: 'cleanup-validation-user', permissionCheck: () => true });

  const droppedRecurrenceTables = [
    'contract_line_terms',
    'contract_line_mappings',
    'contract_template_line_mappings',
  ];

  const legacyTables = await db('information_schema.tables')
    .where({ table_schema: 'public' })
    .whereIn('table_name', droppedRecurrenceTables)
    .select('table_name');

  expect(legacyTables).toEqual([]);

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    currentPeriodEnd,
  } = await createClientWithRecurringCycles({
    clientName: 'Dropped Table Validation Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Dropped Table Validation Service',
    planName: 'Dropped Table Validation Plan',
    baseRateCents: 19000,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(190);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(1);
  expect(detailRows[0]).toMatchObject({
    service_id: fixedLine.serviceId,
    billing_timing: 'advance',
  });
  expect(normalizeDateValue(detailRows[0]?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailRows[0]?.service_period_end)).toBe(currentPeriodEnd);
}, HOOK_TIMEOUT);

it('T166: DB-backed recurring outputs stay stable across billing_cycle_alignment variants after cutover', async () => {
  setupCommonMocks({ tenantId, userId: 'alignment-db-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodEnd
  } = await createClientWithRecurringCycles({
    clientName: 'Alignment Independence Client',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01'
  });

  const alignmentVariants = [
    { suffix: 'Start', alignment: 'start' as const },
    { suffix: 'End', alignment: 'end' as const },
    { suffix: 'Prorated', alignment: 'prorated' as const },
  ];

  const createdLines: Array<{ serviceId: string; contractLineId: string }> = [];
  let sharedContractId: string | undefined;
  let sharedClientContractId: string | undefined;
  for (const variant of alignmentVariants) {
    const line = await createFixedContractLine(contextLike, {
      serviceName: `Alignment ${variant.suffix} Service`,
      planName: `Alignment ${variant.suffix} Plan`,
      baseRateCents: 28000,
      startDate: '2025-02-10',
      billingTiming: 'advance',
      billingFrequency: 'monthly',
      contractId: sharedContractId,
      clientContractId: sharedClientContractId,
    });

    sharedContractId ??= line.contractId;
    sharedClientContractId ??= line.clientContractId;

    await db('contract_lines')
      .where({ tenant: tenantId, contract_line_id: line.contractLineId })
      .update({
        enable_proration: true,
        billing_cycle_alignment: variant.alignment,
        updated_at: db.fn.now()
      });

    createdLines.push({
      serviceId: line.serviceId,
      contractLineId: line.contractLineId,
    });
  }

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(570);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(3);

  const detailByService = new Map(detailRows.map((row) => [row.service_id, row]));
  for (const line of createdLines) {
    expect(detailByService.get(line.serviceId)).toMatchObject({
      billing_timing: 'advance'
    });
    expect(normalizeDateValue(detailByService.get(line.serviceId)?.service_period_start)).toBe('2025-02-10');
    expect(normalizeDateValue(detailByService.get(line.serviceId)?.service_period_end)).toBe(currentPeriodEnd);
  }
}, HOOK_TIMEOUT);

it('T167: DB-backed recurring outputs still persist canonical partial service periods on live arrears paths after resolveServicePeriod cleanup', async () => {
  setupCommonMocks({ tenantId, userId: 'resolve-cleanup-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    previousPeriodEnd
  } = await createClientWithRecurringCycles({
    clientName: 'Resolve Cleanup Client',
    previousPeriodStart: '2025-02-01',
    currentPeriodStart: '2025-03-01',
    nextPeriodStart: '2025-04-01'
  });

  const line = await createFixedContractLine(contextLike, {
    serviceName: 'Resolve Cleanup Service',
    planName: 'Resolve Cleanup Plan',
    baseRateCents: 28000,
    startDate: '2025-02-10',
    billingTiming: 'arrears',
    billingFrequency: 'monthly'
  });

  await db('contract_lines')
    .where({ tenant: tenantId, contract_line_id: line.contractLineId })
    .update({
      enable_proration: true,
      updated_at: db.fn.now()
    });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();
  expect(Number(invoice!.subtotal)).toBe(190);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(1);
  expect(detailRows[0]).toMatchObject({
    service_id: line.serviceId,
    billing_timing: 'arrears'
  });
  expect(normalizeDateValue(detailRows[0]?.service_period_start)).toBe('2025-02-10');
  expect(normalizeDateValue(detailRows[0]?.service_period_end)).toBe(previousPeriodEnd);
}, HOOK_TIMEOUT);

it('T252: DB-backed contract-cadence invoice generation can execute from selector input without a raw billingCycleId bridge', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-cadence-window-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Cadence Window Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-08',
    currentPeriodStart: '2025-02-08',
    nextPeriodStart: '2025-03-08',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Cadence Window Service',
    planName: 'Contract Cadence Window Plan',
    baseRateCents: 21000,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });

  const invoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(invoice).toBeTruthy();
  expect(invoice?.billing_cycle_id ?? null).toBeNull();

  const persistedInvoice = await getPersistedInvoice(invoice!.invoice_id);
  expect(normalizeDateValue(persistedInvoice?.billing_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(persistedInvoice?.billing_period_end)).toBe(nextPeriodStart);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(1);
  expect(detailRows[0]).toMatchObject({
    service_id: fixedLine.serviceId,
    billing_timing: 'advance'
  });
  expect(normalizeDateValue(detailRows[0]?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailRows[0]?.service_period_end)).toBe(currentPeriodEnd);
}, HOOK_TIMEOUT);

});

interface ClientSetupResult {
  contextLike: { db: Knex; tenantId: string; clientId: string };
  clientId: string;
  cycleId: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextPeriodStart: string;
  billingCycle: 'monthly' | 'quarterly' | 'semi-annually' | 'annually';
  januaryCycleId: string;
  decemberStart: string;
  decemberEnd: string;
  januaryStart: string;
  januaryEnd: string;
}

interface RecurringCycleSetupOptions {
  clientName?: string;
  billingCycle?: 'monthly' | 'quarterly' | 'semi-annually' | 'annually';
  previousPeriodStart?: string;
  currentPeriodStart?: string;
  nextPeriodStart?: string;
}

interface FixedLineOptions {
  serviceName: string;
  planName: string;
  baseRateCents: number;
  startDate: string;
  billingTiming: 'arrears' | 'advance';
  billingFrequency?: 'monthly' | 'quarterly' | 'semi-annually' | 'annually';
  cadenceOwner?: 'client' | 'contract';
  customRateCents?: number;
  contractId?: string;
  clientContractId?: string;
}

interface RecurringCatalogLineOptions extends FixedLineOptions {
  quantity?: number;
  isLicense?: boolean;
}

async function createClientWithCycles(clientName = 'Timing Integration Client'): Promise<ClientSetupResult> {
  return createClientWithRecurringCycles({ clientName });
}

async function createClientWithRecurringCycles(
  options: RecurringCycleSetupOptions = {}
): Promise<ClientSetupResult> {
  const clientId = uuidv4();
  const billingCycle = options.billingCycle ?? 'monthly';
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: options.clientName ?? 'Timing Integration Client',
    billing_cycle: billingCycle,
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  await db('client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Billing Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `${clientId.slice(0, 8)}@billing.test`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const contextLike = {
    db,
    tenantId,
    clientId
  } as const;

  await ensureDefaultBillingSettings(contextLike as any);
  await ensureClientPlanBundlesTable(contextLike as any);
  await setupClientTaxConfiguration(contextLike as any, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 8.875
  });
  await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

  const previousPeriodStart = options.previousPeriodStart ?? '2024-12-01';
  const currentPeriodStart = options.currentPeriodStart ?? '2025-01-01';
  const nextPeriodStart = options.nextPeriodStart ?? '2025-02-01';
  const previousPeriodEnd = Temporal.PlainDate.from(currentPeriodStart).subtract({ days: 1 }).toString();
  const currentPeriodEnd = Temporal.PlainDate.from(nextPeriodStart).subtract({ days: 1 }).toString();

  await db('client_billing_cycles').insert({
    billing_cycle_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: billingCycle,
    effective_date: `${previousPeriodStart}T00:00:00Z`,
    period_start_date: `${previousPeriodStart}T00:00:00Z`,
    period_end_date: `${currentPeriodStart}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const cycleId = uuidv4();
  await db('client_billing_cycles').insert({
    billing_cycle_id: cycleId,
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: billingCycle,
    effective_date: `${currentPeriodStart}T00:00:00Z`,
    period_start_date: `${currentPeriodStart}T00:00:00Z`,
    period_end_date: `${nextPeriodStart}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  return {
    contextLike: contextLike as any,
    clientId,
    cycleId,
    previousPeriodStart,
    previousPeriodEnd,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
    billingCycle,
    januaryCycleId: cycleId,
    decemberStart: previousPeriodStart,
    decemberEnd: previousPeriodEnd,
    januaryStart: currentPeriodStart,
    januaryEnd: currentPeriodEnd
  };
}

async function createFixedContractLine(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  options: FixedLineOptions
): Promise<{ serviceId: string; contractLineId: string; clientContractLineId: string; contractId: string; clientContractId: string }> {
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'fixed',
    default_rate: options.baseRateCents,
    unit_of_measure: 'seat',
    tax_region: 'US-NY'
  });

  const result = await createFixedPlanAssignment(contextLike as any, serviceId, {
    planName: options.planName,
    billingFrequency: options.billingFrequency ?? 'monthly',
    baseRateCents: options.baseRateCents,
    startDate: options.startDate,
    endDate: null,
    billingTiming: options.billingTiming,
    clientId: contextLike.clientId,
    cadenceOwner: options.cadenceOwner,
    enableProration: false,
    contractId: options.contractId,
    clientContractId: options.clientContractId,
  });

  return {
    serviceId,
    contractLineId: result.contractLineId,
    clientContractLineId: result.clientContractLineId,
    contractId: result.contractId,
    clientContractId: result.clientContractId
  };
}

async function createRecurringCatalogLine(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  options: RecurringCatalogLineOptions
): Promise<{ serviceId: string; clientContractLineId: string; contractId: string; clientContractId: string }> {
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'fixed',
    default_rate: options.baseRateCents,
    unit_of_measure: options.isLicense ? 'seat' : 'item',
    tax_region: 'US-NY'
  });

  await contextLike.db('service_catalog')
    .where({ tenant: contextLike.tenantId, service_id: serviceId })
    .update({
      item_kind: 'product',
      is_license: Boolean(options.isLicense)
    });

  await contextLike.db('service_prices')
    .insert({
      tenant: contextLike.tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: options.baseRateCents,
      created_at: contextLike.db.fn.now(),
      updated_at: contextLike.db.fn.now()
    })
    .onConflict(['tenant', 'service_id', 'currency_code'])
    .merge({
      rate: options.baseRateCents,
      updated_at: contextLike.db.fn.now()
    });

  const result = await createFixedPlanAssignment(contextLike as any, serviceId, {
    planName: options.planName,
    billingFrequency: options.billingFrequency ?? 'monthly',
    baseRateCents: options.baseRateCents,
    startDate: options.startDate,
    endDate: null,
    billingTiming: options.billingTiming,
    clientId: contextLike.clientId,
    enableProration: false,
    quantity: options.quantity ?? 1,
    contractId: options.contractId,
    clientContractId: options.clientContractId,
  });

  return {
    serviceId,
    clientContractLineId: result.clientContractLineId,
    contractId: result.contractId,
    clientContractId: result.clientContractId
  };
}

async function getInvoiceDetailRows(invoiceId: string) {
  return db('invoice_charge_details as iid')
    .join('invoice_charges as ii', function () {
      this.on('iid.item_id', '=', 'ii.item_id').andOn('iid.tenant', '=', 'ii.tenant');
    })
    .where('ii.invoice_id', invoiceId)
    .andWhere('iid.tenant', tenantId)
    .select([
      'iid.service_id',
      'iid.service_period_start',
      'iid.service_period_end',
      'iid.billing_timing'
    ]);
}

async function getPersistedInvoice(invoiceId: string) {
  return db('invoices')
    .where({ invoice_id: invoiceId, tenant: tenantId })
    .first(['invoice_id', 'billing_period_start', 'billing_period_end']);
}

function normalizeDateValue(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  try {
    return Temporal.PlainDate.from(value as any).toString();
  } catch (error) {
    return null;
  }
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Billing Timing Integration Tenant',
    email: 'billing-timing@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
