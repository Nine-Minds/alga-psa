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
import type { IRecurringServicePeriodRecord } from '@alga-psa/types';
import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
import { editRecurringServicePeriodBoundaries } from '@alga-psa/shared/billingClients/editRecurringServicePeriodBoundaries';
import { regenerateRecurringServicePeriods } from '@alga-psa/shared/billingClients/regenerateRecurringServicePeriods';
import { applyRecurringServicePeriodInvoiceLinkage } from '@alga-psa/shared/billingClients/recurringServicePeriodInvoiceLinkage';
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

it('T140/T175/T252: DB-backed monthly contract-cadence billing persists contract-owned detail periods and executes from selector input without a raw billingCycleId bridge', async () => {
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

it('T176: DB-backed mixed cadence-owner billing groups same-window due work into one invoice', async () => {
  setupCommonMocks({ tenantId, userId: 'mixed-cadence-db-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Mixed Cadence DB Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const clientCadenceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Mixed Client Cadence Service',
    planName: 'Mixed Client Cadence Plan',
    baseRateCents: 12000,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const contractCadenceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Mixed Contract Cadence Service',
    planName: 'Mixed Contract Cadence Plan',
    baseRateCents: 18000,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
    contractId: clientCadenceLine.contractId,
    clientContractId: clientCadenceLine.clientContractId,
  });

  const clientPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T16:00:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: clientCadenceLine.clientContractLineId,
      obligationType: 'client_contract_line',
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${clientCadenceLine.clientContractLineId}:v1`,
    sourceRunKey: 'mixed-cadence-client',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  const contractPlan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T16:00:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: contractCadenceLine.clientContractLineId,
      obligationType: 'client_contract_line',
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${contractCadenceLine.clientContractLineId}:v1`,
    sourceRunKey: 'mixed-cadence-contract',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  await upsertRecurringServicePeriodRecord(clientPlan.records[0]);
  await upsertRecurringServicePeriodRecord(contractPlan.records[0]);

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();

  const persistedInvoices = await db('invoices')
    .where({ tenant: tenantId, client_id: contextLike.clientId })
    .andWhere('billing_period_start', currentPeriodStart)
    .andWhere('billing_period_end', nextPeriodStart)
    .select(['invoice_id']);
  expect(persistedInvoices).toHaveLength(1);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  expect(detailRows).toHaveLength(2);

  const detailByService = new Map(detailRows.map((row) => [row.service_id, row]));
  expect(normalizeDateValue(detailByService.get(clientCadenceLine.serviceId)?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailByService.get(clientCadenceLine.serviceId)?.service_period_end)).toBe(currentPeriodEnd);
  expect(normalizeDateValue(detailByService.get(contractCadenceLine.serviceId)?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(detailByService.get(contractCadenceLine.serviceId)?.service_period_end)).toBe(currentPeriodEnd);
}, HOOK_TIMEOUT);

it('T316: DB-backed persisted service-period generation, editing, regeneration, and invoice linkage remain coherent under staged rollout', async () => {
  setupCommonMocks({ tenantId, userId: 'persisted-ledger-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Persisted Ledger Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Ledger Service',
    planName: 'Persisted Ledger Plan',
    baseRateCents: 19500,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const sourceObligation = {
    tenant: tenantId,
    obligationId: fixedLine.clientContractLineId,
    obligationType: 'client_contract_line',
    chargeFamily: 'fixed',
  } as const;

  const materializedRecordIds = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
  let materializedRecordIndex = 0;
  const nextRecordId = () => materializedRecordIds[materializedRecordIndex++] ?? uuidv4();

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T15:00:00.000Z',
    billingCycle: 'monthly',
    sourceObligation,
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.clientContractLineId}:v1`,
    sourceRunKey: 'integration-materialize',
    targetHorizonDays: 60,
    recordIdFactory: nextRecordId,
  });

  const [currentGenerated, futureGenerated] = materializationPlan.records;
  expect(currentGenerated).toBeTruthy();
  expect(futureGenerated).toBeTruthy();

  await upsertRecurringServicePeriodRecord(currentGenerated);
  await upsertRecurringServicePeriodRecord(futureGenerated);

  const boundaryEdit = editRecurringServicePeriodBoundaries({
    record: currentGenerated,
    editedAt: '2026-03-18T15:05:00.000Z',
    sourceRuleVersion: `${fixedLine.clientContractLineId}:v1`,
    updatedServicePeriod: {
      start: '2025-01-10',
      end: nextPeriodStart,
      semantics: 'half_open',
    },
    updatedActivityWindow: {
      start: '2025-01-10',
      end: nextPeriodStart,
      semantics: 'half_open',
    },
    recordIdFactory: nextRecordId,
  });

  await upsertRecurringServicePeriodRecord(boundaryEdit.supersededRecord);
  await upsertRecurringServicePeriodRecord(boundaryEdit.editedRecord);

  const preservedSlotCandidate: IRecurringServicePeriodRecord = {
    ...currentGenerated,
    recordId: uuidv4(),
    servicePeriod: boundaryEdit.editedRecord.servicePeriod,
    invoiceWindow: boundaryEdit.editedRecord.invoiceWindow,
    activityWindow: boundaryEdit.editedRecord.activityWindow,
    provenance: {
      kind: 'generated',
      reasonCode: 'initial_materialization',
      sourceRuleVersion: `${fixedLine.clientContractLineId}:v2`,
      sourceRunKey: 'integration-regenerate',
    },
    createdAt: '2026-03-18T15:10:00.000Z',
    updatedAt: '2026-03-18T15:10:00.000Z',
  };

  const changedFutureCandidate: IRecurringServicePeriodRecord = {
    ...futureGenerated,
    recordId: uuidv4(),
    servicePeriod: {
      start: '2025-02-05',
      end: '2025-03-01',
      semantics: 'half_open',
    },
    activityWindow: {
      start: '2025-02-05',
      end: '2025-03-01',
      semantics: 'half_open',
    },
    provenance: {
      kind: 'generated',
      reasonCode: 'initial_materialization',
      sourceRuleVersion: `${fixedLine.clientContractLineId}:v2`,
      sourceRunKey: 'integration-regenerate',
    },
    createdAt: '2026-03-18T15:10:00.000Z',
    updatedAt: '2026-03-18T15:10:00.000Z',
  };

  const regenerationPlan = regenerateRecurringServicePeriods({
    existingRecords: [boundaryEdit.editedRecord, futureGenerated],
    candidateRecords: [preservedSlotCandidate, changedFutureCandidate],
    regeneratedAt: '2026-03-18T15:10:00.000Z',
    sourceRuleVersion: `${fixedLine.clientContractLineId}:v2`,
    sourceRunKey: 'integration-regenerate',
    recordIdFactory: nextRecordId,
  });

  expect(regenerationPlan.conflicts).toEqual([]);
  expect(regenerationPlan.preservedRecords).toEqual([boundaryEdit.editedRecord]);
  expect(regenerationPlan.regeneratedRecords).toHaveLength(1);

  await upsertRecurringServicePeriodRecord(regenerationPlan.supersededRecords[0]);
  await upsertRecurringServicePeriodRecord(regenerationPlan.regeneratedRecords[0]);

  const preInvoiceRows = await db('recurring_service_periods')
    .where({ tenant: tenantId, schedule_key: materializationPlan.scheduleKey })
    .orderBy('service_period_start', 'asc')
    .orderBy('revision', 'asc')
    .select([
      'record_id',
      'lifecycle_state',
      'service_period_start',
      'service_period_end',
      'invoice_charge_detail_id',
    ]);

  expect(preInvoiceRows).toHaveLength(4);
  expect(preInvoiceRows.filter((row) => row.lifecycle_state === 'superseded')).toHaveLength(2);
  const editedLedgerRow = preInvoiceRows.find(
    (row) => row.record_id === boundaryEdit.editedRecord.recordId,
  );
  expect(editedLedgerRow?.lifecycle_state).toBe('edited');
  expect(normalizeDateValue(editedLedgerRow?.service_period_start)).toBe('2025-01-10');
  expect(normalizeDateValue(editedLedgerRow?.service_period_end)).toBe(nextPeriodStart);
  expect(editedLedgerRow?.invoice_charge_detail_id ?? null).toBeNull();

  const dueLedgerRows = await db('recurring_service_periods')
    .where({
      tenant: tenantId,
      obligation_id: fixedLine.clientContractLineId,
      obligation_type: 'client_contract_line',
    })
    .whereIn('lifecycle_state', ['generated', 'edited', 'locked'])
    .where('invoice_window_start', currentPeriodStart)
    .where('invoice_window_end', nextPeriodStart)
    .whereNull('invoice_charge_detail_id')
    .orderBy('service_period_start', 'asc')
    .select([
      'record_id',
      'due_position',
      'service_period_start',
      'service_period_end',
      'invoice_window_start',
      'invoice_window_end',
    ]);
  expect(dueLedgerRows).toHaveLength(1);
  expect(dueLedgerRows[0]).toMatchObject({
    record_id: boundaryEdit.editedRecord.recordId,
    due_position: 'advance',
  });
  expect(normalizeDateValue(dueLedgerRows[0]?.service_period_start)).toBe('2025-01-10');
  expect(normalizeDateValue(dueLedgerRows[0]?.service_period_end)).toBe(nextPeriodStart);
  expect(normalizeDateValue(dueLedgerRows[0]?.invoice_window_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(dueLedgerRows[0]?.invoice_window_end)).toBe(nextPeriodStart);

  const configRow = await db('contract_line_service_configuration')
    .where({
      tenant: tenantId,
      contract_line_id: fixedLine.contractLineId,
      service_id: fixedLine.serviceId,
    })
    .first<{ config_id: string }>('config_id');
  expect(configRow?.config_id).toBeTruthy();

  const persistedInvoice = await createManualRecurringInvoiceDetail({
    clientId: contextLike.clientId,
    serviceId: fixedLine.serviceId,
    configId: configRow!.config_id,
    billingPeriodStart: currentPeriodStart,
    billingPeriodEnd: nextPeriodStart,
    servicePeriodStart: '2025-01-10',
    servicePeriodEnd: currentPeriodEnd,
    billingTiming: 'advance',
    amountCents: 19500,
  });

  const linkedRecord = applyRecurringServicePeriodInvoiceLinkage(boundaryEdit.editedRecord, {
    invoiceId: persistedInvoice.invoiceId,
    invoiceChargeId: persistedInvoice.invoiceChargeId,
    invoiceChargeDetailId: persistedInvoice.invoiceChargeDetailId,
    linkedAt: '2026-03-18T15:15:00.000Z',
  });

  await upsertRecurringServicePeriodRecord(linkedRecord);

  const billedRow = await db('recurring_service_periods')
    .where({ tenant: tenantId, record_id: linkedRecord.recordId })
    .first([
      'record_id',
      'lifecycle_state',
      'invoice_id',
      'invoice_charge_id',
      'invoice_charge_detail_id',
    ]);
  expect(billedRow).toMatchObject({
    record_id: linkedRecord.recordId,
    lifecycle_state: 'billed',
    invoice_id: persistedInvoice.invoiceId,
    invoice_charge_id: persistedInvoice.invoiceChargeId,
    invoice_charge_detail_id: persistedInvoice.invoiceChargeDetailId,
  });

  const futureRow = await db('recurring_service_periods')
    .where({ tenant: tenantId, record_id: regenerationPlan.regeneratedRecords[0].recordId })
    .first([
      'record_id',
      'lifecycle_state',
      'service_period_start',
      'service_period_end',
      'invoice_charge_detail_id',
    ]);
  expect(futureRow).toMatchObject({
    record_id: regenerationPlan.regeneratedRecords[0].recordId,
    lifecycle_state: 'generated',
    invoice_charge_detail_id: null,
  });
  expect(normalizeDateValue(futureRow?.service_period_start)).toBe('2025-02-05');
  expect(normalizeDateValue(futureRow?.service_period_end)).toBe('2025-03-01');

  const remainingDueLedgerRows = await db('recurring_service_periods')
    .where({
      tenant: tenantId,
      obligation_id: fixedLine.clientContractLineId,
      obligation_type: 'client_contract_line',
    })
    .whereIn('lifecycle_state', ['generated', 'edited', 'locked'])
    .where('invoice_window_start', currentPeriodStart)
    .where('invoice_window_end', nextPeriodStart)
    .whereNull('invoice_charge_detail_id')
    .select('record_id');
  expect(remainingDueLedgerRows).toEqual([]);
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

async function upsertRecurringServicePeriodRecord(record: IRecurringServicePeriodRecord) {
  const linkage = record.invoiceLinkage;

  await db('recurring_service_periods')
    .insert({
      record_id: record.recordId,
      tenant: record.sourceObligation.tenant,
      schedule_key: record.scheduleKey,
      period_key: record.periodKey,
      revision: record.revision,
      obligation_id: record.sourceObligation.obligationId,
      obligation_type: record.sourceObligation.obligationType,
      charge_family: record.sourceObligation.chargeFamily,
      cadence_owner: record.cadenceOwner,
      due_position: record.duePosition,
      lifecycle_state: record.lifecycleState,
      service_period_start: record.servicePeriod.start,
      service_period_end: record.servicePeriod.end,
      invoice_window_start: record.invoiceWindow.start,
      invoice_window_end: record.invoiceWindow.end,
      activity_window_start: record.activityWindow?.start ?? null,
      activity_window_end: record.activityWindow?.end ?? null,
      timing_metadata: record.timingMetadata ?? null,
      provenance_kind: record.provenance.kind,
      source_rule_version: record.provenance.sourceRuleVersion,
      reason_code: record.provenance.reasonCode ?? null,
      source_run_key: record.provenance.sourceRunKey ?? null,
      supersedes_record_id: record.provenance.supersedesRecordId ?? null,
      invoice_id: linkage?.invoiceId ?? null,
      invoice_charge_id: linkage?.invoiceChargeId ?? null,
      invoice_charge_detail_id: linkage?.invoiceChargeDetailId ?? null,
      invoice_linked_at: linkage?.linkedAt ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    })
    .onConflict(['tenant', 'record_id'])
    .merge({
      schedule_key: record.scheduleKey,
      period_key: record.periodKey,
      revision: record.revision,
      obligation_id: record.sourceObligation.obligationId,
      obligation_type: record.sourceObligation.obligationType,
      charge_family: record.sourceObligation.chargeFamily,
      cadence_owner: record.cadenceOwner,
      due_position: record.duePosition,
      lifecycle_state: record.lifecycleState,
      service_period_start: record.servicePeriod.start,
      service_period_end: record.servicePeriod.end,
      invoice_window_start: record.invoiceWindow.start,
      invoice_window_end: record.invoiceWindow.end,
      activity_window_start: record.activityWindow?.start ?? null,
      activity_window_end: record.activityWindow?.end ?? null,
      timing_metadata: record.timingMetadata ?? null,
      provenance_kind: record.provenance.kind,
      source_rule_version: record.provenance.sourceRuleVersion,
      reason_code: record.provenance.reasonCode ?? null,
      source_run_key: record.provenance.sourceRunKey ?? null,
      supersedes_record_id: record.provenance.supersedesRecordId ?? null,
      invoice_id: linkage?.invoiceId ?? null,
      invoice_charge_id: linkage?.invoiceChargeId ?? null,
      invoice_charge_detail_id: linkage?.invoiceChargeDetailId ?? null,
      invoice_linked_at: linkage?.linkedAt ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
}

async function createManualRecurringInvoiceDetail(input: {
  clientId: string;
  serviceId: string;
  configId: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  billingTiming: 'advance' | 'arrears';
  amountCents: number;
}) {
  const invoiceId = uuidv4();
  const invoiceChargeId = uuidv4();
  const invoiceChargeDetailId = uuidv4();
  const now = '2026-03-18T15:15:00.000Z';

  await db('invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: input.clientId,
    invoice_number: `INV-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    subtotal: input.amountCents,
    tax: 0,
    total_amount: input.amountCents,
    status: 'draft',
    currency_code: 'USD',
    billing_period_start: input.billingPeriodStart,
    billing_period_end: input.billingPeriodEnd,
    created_at: now,
    updated_at: now,
  });

  await db('invoice_charges').insert({
    item_id: invoiceChargeId,
    tenant: tenantId,
    invoice_id: invoiceId,
    service_id: input.serviceId,
    description: 'Persisted recurring service period',
    quantity: 1,
    unit_price: input.amountCents / 100,
    total_price: input.amountCents / 100,
    net_amount: input.amountCents / 100,
    tax_amount: 0,
    is_manual: false,
    created_at: now,
    updated_at: now,
  });

  await db('invoice_charge_details').insert({
    item_detail_id: invoiceChargeDetailId,
    item_id: invoiceChargeId,
    tenant: tenantId,
    service_id: input.serviceId,
    config_id: input.configId,
    quantity: 1,
    rate: input.amountCents / 100,
    service_period_start: input.servicePeriodStart,
    service_period_end: input.servicePeriodEnd,
    billing_timing: input.billingTiming,
    created_at: now,
    updated_at: now,
  });

  return {
    invoiceId,
    invoiceChargeId,
    invoiceChargeDetailId,
  };
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
