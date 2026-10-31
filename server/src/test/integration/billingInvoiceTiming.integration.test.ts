import { repairArrearsOnlyLineSchedulesForTenant } from '@alga-psa/billing/actions/arrearsOnlyLineRepair';
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings
} from '../../../test-utils/billingTestHelpers';
import { createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { Temporal } from '@js-temporal/polyfill';
import { createRequire } from 'node:module';
import { isPeriodAlreadyInvoiced } from '@alga-psa/billing/lib/billing/pricing/isPeriodAlreadyInvoiced';
import { BillingEngine } from '@alga-psa/billing/services';
import { ATTRIBUTION_TABLES } from '@alga-psa/billing/lib/billing/contractLineAttributionWriter';
import Invoice from '@alga-psa/billing/models/invoice';
import type { IRecurringServicePeriodRecord } from '@alga-psa/types';
import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
import { editRecurringServicePeriodBoundaries } from '@alga-psa/shared/billingClients/editRecurringServicePeriodBoundaries';
import { regenerateRecurringServicePeriods } from '@alga-psa/shared/billingClients/regenerateRecurringServicePeriods';
import { applyRecurringServicePeriodInvoiceLinkage } from '@alga-psa/shared/billingClients/recurringServicePeriodInvoiceLinkage';
import {
  buildClientCadenceDueSelectionInput,
  buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import { buildRecurringServicePeriodListingQuery } from '@alga-psa/shared/billingClients/recurringServicePeriodListing';
import { buildRecurringServicePeriodOperationalView } from '@alga-psa/shared/billingClients/recurringServicePeriodOperationalView';
import { applyRecurringServicePeriodEditRequest } from '@alga-psa/shared/billingClients/recurringServicePeriodEditRequests';
import { createTestTimeEntry } from '../e2e/utils/timeEntryTestDataFactory';
import {
  buildRecurringServicePeriodDueSelectionQuery,
  selectDueRecurringServicePeriodRecords,
} from '@alga-psa/shared/billingClients/recurringServicePeriodDueSelection';
import { seedBillingCycle } from '../../../test-utils/billingProfileTestHelpers';

let db: Knex;
let tenantId: string;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let generateInvoiceForSelectionInput: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoiceForSelectionInput;
let generateInvoiceForSelectionInputs: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoiceForSelectionInputs;
let calculateBillingForSelectionInputAction: typeof import('@alga-psa/billing/actions/invoiceGeneration').calculateBillingForSelectionInput;
let previewInvoiceForSelectionInputAction: typeof import('@alga-psa/billing/actions/invoiceGeneration').previewInvoiceForSelectionInput;
let getPurchaseOrderOverageForSelectionInputAction: typeof import('@alga-psa/billing/actions/invoiceGeneration').getPurchaseOrderOverageForSelectionInput;
let getAvailableRecurringDueWorkAction: typeof import('@alga-psa/billing/actions/billingAndTax').getAvailableRecurringDueWork;
let repairAllRecurringServicePeriodsForTenantAction: typeof import('@alga-psa/billing/actions/recurringServicePeriodActions').repairAllRecurringServicePeriodsForTenant;
let hardDeleteInvoiceAction: typeof import('@alga-psa/billing/actions/invoiceModification').hardDeleteInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let getInvoicedBillingCyclesPaginatedAction: typeof import('@alga-psa/billing/actions/billingCycleActions').getInvoicedBillingCyclesPaginated;
let reverseRecurringInvoiceAction: typeof import('@alga-psa/billing/actions/billingCycleActions').reverseRecurringInvoice;
let hardDeleteRecurringInvoiceAction: typeof import('@alga-psa/billing/actions/billingCycleActions').hardDeleteRecurringInvoice;
const authRef = vi.hoisted(() => ({
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: 'test-user',
}));

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tableExpression: string,
  reason = 'test schema/global metadata boundary'
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, '__test_schema__').unscoped<Row>(tableExpression, reason);
}

async function hasSchemaTable(connection: Knex, tableName: string): Promise<boolean> {
  const row = await schemaTable(
    connection,
    'information_schema.tables',
    'test schema table existence check'
  )
    .where({ table_schema: 'public', table_name: tableName })
    .first('table_name');
  return Boolean(row);
}

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
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
  withOptionalAuth:
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
  // test-utils/testMocks.ts re-points these via vi.mocked(...) in setupCommonMocks,
  // so the factory has to export them.
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

describe('Billing Invoice Timing Integration', () => {
  const HOOK_TIMEOUT = 180_000;

  async function withRealTransactions<T>(callback: () => Promise<T>): Promise<T> {
    const transactionMock = vi.mocked(withTransaction);
    transactionMock.mockImplementation(async (knex: any, handler: any) => knex.transaction(handler));
    try {
      return await callback();
    } finally {
      transactionMock.mockImplementation(async (_knex: any, handler: any) => handler(db));
    }
  }

  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.E2E_AUTH_BYPASS = 'true';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    authRef.tenantId = tenantId;
    ({
      generateInvoice,
      generateInvoiceForSelectionInput,
      generateInvoiceForSelectionInputs,
      calculateBillingForSelectionInput: calculateBillingForSelectionInputAction,
      previewInvoiceForSelectionInput: previewInvoiceForSelectionInputAction,
      getPurchaseOrderOverageForSelectionInput: getPurchaseOrderOverageForSelectionInputAction,
    } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({
      getAvailableRecurringDueWork: getAvailableRecurringDueWorkAction,
    } = await import('@alga-psa/billing/actions/billingAndTax'));
    ({ repairAllRecurringServicePeriodsForTenant: repairAllRecurringServicePeriodsForTenantAction } = await import('@alga-psa/billing/actions/recurringServicePeriodActions'));
    ({ hardDeleteInvoice: hardDeleteInvoiceAction } = await import('@alga-psa/billing/actions/invoiceModification'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({
      getInvoicedBillingCyclesPaginated: getInvoicedBillingCyclesPaginatedAction,
      reverseRecurringInvoice: reverseRecurringInvoiceAction,
      hardDeleteRecurringInvoice: hardDeleteRecurringInvoiceAction,
    } = await import('@alga-psa/billing/actions/billingCycleActions'));
  }, HOOK_TIMEOUT);

  // Legacy-advance fixtures bypass Migration B's CHECK constraints. After every test, repair the
  // rows they wrote and leave the schema exactly as the migrations produced it (VALID).
  afterEach(async () => {
    await restoreArrearsOnlyChecks();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await restoreArrearsOnlyChecks();
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
      baseRateCents: 200,
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

    const { serviceId, contractLineId } = await createFixedContractLine(contextLike, {
      serviceName: 'Arrears Invoice Support',
      planName: 'Arrears Invoice Plan',
      baseRateCents: 150,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });
    await syncContractLineRecurringPeriods(contractLineId);

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

    const { serviceId, contractLineId } = await createFixedContractLine(contextLike, {
      serviceName: 'Advance Invoice Support',
      planName: 'Advance Invoice Plan',
      baseRateCents: 180,
      startDate: '2024-12-01',
      billingTiming: 'advance'
    });
    await syncContractLineRecurringPeriods(contractLineId);

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
      baseRateCents: 210,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });

  const advanceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Mixed Advance Service',
    planName: 'Mixed Advance Plan',
    baseRateCents: 220,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    contractId: arrearsLine.contractId,
    clientContractId: arrearsLine.clientContractId
  });
  await syncContractLineRecurringPeriods(arrearsLine.contractLineId);
  await syncContractLineRecurringPeriods(advanceLine.contractLineId);

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
    baseRateCents: 150,
    startDate: previousPeriodStart,
    billingTiming: 'arrears',
    billingFrequency: 'monthly'
  });

  const advanceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Monthly Parity Advance Service',
    planName: 'Monthly Parity Advance Plan',
    baseRateCents: 180,
    startDate: previousPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    contractId: arrearsLine.contractId,
    clientContractId: arrearsLine.clientContractId
  });
  await syncContractLineRecurringPeriods(arrearsLine.contractLineId);
  await syncContractLineRecurringPeriods(advanceLine.contractLineId);

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
    baseRateCents: 1200,
    startDate: previousPeriodStart,
    billingTiming: 'arrears',
    billingFrequency: 'annually'
  });

  const advanceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Annual Parity Advance Service',
    planName: 'Annual Parity Advance Plan',
    baseRateCents: 2400,
    startDate: previousPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'annually',
    contractId: arrearsLine.contractId,
    clientContractId: arrearsLine.clientContractId
  });

  // The production sync only materializes 180 days ahead of the contract start
  // (later windows are replenished after earlier cycles are invoiced), so an
  // annual fixture that invoices the second year must materialize its ledger
  // explicitly with a horizon long enough to cover the 2025 window.
  for (const line of [
    { contractLineId: arrearsLine.contractLineId, duePosition: 'arrears' as const, runKey: 'integration-annual-parity-arrears' },
    { contractLineId: advanceLine.contractLineId, duePosition: 'advance' as const, runKey: 'integration-annual-parity-advance' },
  ]) {
    const plan = materializeClientCadenceServicePeriods({
      asOf: `${previousPeriodStart}T00:00:00Z`,
      materializedAt: '2026-03-18T12:00:00.000Z',
      billingCycle: 'annually',
      sourceObligation: {
        tenant: tenantId,
        obligationId: line.contractLineId,
        chargeFamily: 'fixed',
      },
      duePosition: line.duePosition,
      sourceRuleVersion: `${line.contractLineId}:v1`,
      sourceRunKey: line.runKey,
      targetHorizonDays: 800,
      replenishmentThresholdDays: 45,
      recordIdFactory: () => uuidv4(),
    });
    for (const record of plan.records) {
      await upsertRecurringServicePeriodRecord(record);
    }
  }

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
    baseRateCents: 175,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly'
  });
  await syncContractLineRecurringPeriods(fixedLine.contractLineId);

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

it('T029: billed recurring service periods link back to invoice charge detail rows after client-cadence selector-input invoice creation with null billing_cycle_id', async () => {
  setupCommonMocks({ tenantId, userId: 'client-linkage-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Client Linkage Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Client Linkage Service',
    planName: 'Client Linkage Plan',
    baseRateCents: 185,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:10:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-client-linkage',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const selectorInput = buildClientCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    scheduleKey: materializationPlan.scheduleKey,
    periodKey: materializationPlan.records[0].periodKey,
    windowStart: currentPeriodStart,
    windowEnd: nextPeriodStart,
  });
  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();
  expect(generatedInvoice?.billing_cycle_id ?? null).toBeNull();

  const detailRows = await getInvoiceDetailRows(generatedInvoice!.invoice_id);
  expect(detailRows).toHaveLength(1);

  const billedRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: materializationPlan.records[0].recordId })
    .first([
      'record_id',
      'lifecycle_state',
      'invoice_id',
      'invoice_charge_id',
      'invoice_charge_detail_id',
      'invoice_linked_at',
      'service_period_start',
      'service_period_end',
    ]);

  expect(billedRow).toMatchObject({
    record_id: materializationPlan.records[0].recordId,
    lifecycle_state: 'billed',
    invoice_id: generatedInvoice!.invoice_id,
    invoice_charge_id: detailRows[0].item_id,
    invoice_charge_detail_id: detailRows[0].item_detail_id,
  });
  expect(normalizeTimestampValue(billedRow?.invoice_linked_at)).toBeTruthy();
  expect(normalizeDateValue(billedRow?.service_period_start)).toBe(materializationPlan.records[0].servicePeriod.start);
  expect(normalizeDateValue(billedRow?.service_period_end)).toBe(materializationPlan.records[0].servicePeriod.end);
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
    baseRateCents: 540,
    startDate: previousPeriodStart,
    billingTiming: 'arrears',
    billingFrequency: 'quarterly'
  });
  await syncContractLineRecurringPeriods(fixedLine.contractLineId);

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
  await syncContractLineRecurringPeriods(productLine.contractLineId);

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
  await syncContractLineRecurringPeriods(licenseLine.contractLineId);

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

  const legacyTables = await schemaTable(
    db,
    'information_schema.tables',
    'test asserts dropped recurrence tables remain absent'
  )
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
    baseRateCents: 190,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
  });
  await syncContractLineRecurringPeriods(fixedLine.contractLineId);

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
      baseRateCents: 280,
      startDate: '2025-02-10',
      billingTiming: 'advance',
      billingFrequency: 'monthly',
      contractId: sharedContractId,
      clientContractId: sharedClientContractId,
    });

    sharedContractId ??= line.contractId;
    sharedClientContractId ??= line.clientContractId;

    await tenantTable(db, tenantId, 'contract_lines')
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

  for (const line of createdLines) {
    await syncContractLineRecurringPeriods(line.contractLineId);
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

it('T111: billing engine contract resolution joins only on instantiated client_contracts.contract_id (no template fallback join)', async () => {
  setupCommonMocks({ tenantId, userId: 'template-fallback-join-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Template Join Removal Client',
    previousPeriodStart: '2025-02-01',
    currentPeriodStart: '2025-03-01',
    nextPeriodStart: '2025-04-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Template Join Removal Service',
    planName: 'Template Join Removal Plan',
    baseRateCents: 250,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
  });

  await tenantTable(db, tenantId, 'client_contracts')
    .where({
      tenant: tenantId,
      client_contract_id: fixedLine.clientContractId,
    })
    .update({
      template_contract_id: fixedLine.contractId,
      updated_at: db.fn.now(),
    });

  const observedSql: string[] = [];
  const onQuery = (queryData: { sql?: string }) => {
    if (typeof queryData.sql === 'string') {
      observedSql.push(queryData.sql);
    }
  };

  db.on('query', onQuery);
  const engine = new BillingEngine();
  const billingResult = await engine.calculateBilling(
    contextLike.clientId,
    currentPeriodStart,
    nextPeriodStart,
    cycleId,
  );
  db.removeListener('query', onQuery);

  expect(billingResult.charges.length).toBeGreaterThan(0);

  const coalesceFallbackPattern = /coalesce\s*\(\s*cc\.template_contract_id\s*,\s*cc\.contract_id\s*\)/i;
  // Alias-agnostic: the join partner may be `contracts as c` or, as in the shared
  // discount resolver, `contract_lines` directly. What matters is which
  // client_contracts column the contract id is matched against.
  const templateJoinFallbackPattern = /cc\"\s*\.\s*\"template_contract_id\"\s*=\s*\"\w+\"\s*\.\s*\"contract_id\"/i;
  const canonicalJoinPattern = /cc\"\s*\.\s*\"contract_id\"\s*=\s*\"\w+\"\s*\.\s*\"contract_id\"/i;

  expect(observedSql.some((sql) => coalesceFallbackPattern.test(sql))).toBe(false);
  expect(observedSql.some((sql) => templateJoinFallbackPattern.test(sql))).toBe(false);
  expect(observedSql.some((sql) => canonicalJoinPattern.test(sql))).toBe(true);
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
    baseRateCents: 280,
    startDate: '2025-02-10',
    billingTiming: 'arrears',
    billingFrequency: 'monthly'
  });

  await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_line_id: line.contractLineId })
    .update({
      enable_proration: true,
      updated_at: db.fn.now()
    });
  await syncContractLineRecurringPeriods(line.contractLineId);

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
    baseRateCents: 210,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(fixedLine.contractLineId);

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

it('T020/T030: billed recurring service periods link back to invoice charge detail rows after contract-cadence invoice creation', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-linkage-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Linkage Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-08',
    currentPeriodStart: '2025-02-08',
    nextPeriodStart: '2025-03-08',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Linkage Service',
    planName: 'Contract Linkage Plan',
    baseRateCents: 225,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const materializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:20:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-linkage',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });

  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();
  expect(generatedInvoice?.billing_cycle_id ?? null).toBeNull();

  const detailRows = await getInvoiceDetailRows(generatedInvoice!.invoice_id);
  expect(detailRows).toHaveLength(1);

  const billedRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: materializationPlan.records[0].recordId })
    .first([
      'record_id',
      'lifecycle_state',
      'invoice_id',
      'invoice_charge_id',
      'invoice_charge_detail_id',
      'invoice_linked_at',
      'service_period_start',
      'service_period_end',
    ]);

  expect(billedRow).toMatchObject({
    record_id: materializationPlan.records[0].recordId,
    lifecycle_state: 'billed',
    invoice_id: generatedInvoice!.invoice_id,
    invoice_charge_id: detailRows[0].item_id,
    invoice_charge_detail_id: detailRows[0].item_detail_id,
  });
  expect(normalizeTimestampValue(billedRow?.invoice_linked_at)).toBeTruthy();
  expect(normalizeDateValue(billedRow?.service_period_start)).toBe(materializationPlan.records[0].servicePeriod.start);
  expect(normalizeDateValue(billedRow?.service_period_end)).toBe(materializationPlan.records[0].servicePeriod.end);
}, HOOK_TIMEOUT);

it('T069: hourly recurring charges bill approved time entries that fall inside a contract-cadence service period, not the nearest client billing cycle', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-hourly-window-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Contract Hourly Window Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Contract Hourly Window Service',
    planName: 'Contract Hourly Window Plan',
    baseRateCents: 12000,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const blockedHourlyMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-08T00:00:00Z',
    materializedAt: '2026-04-12T00:00:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: hourlyLine.contractLineId,
      chargeFamily: 'hourly',
    },
    duePosition: 'arrears',
    sourceRuleVersion: `${hourlyLine.contractLineId}:approval-blocked:v1`,
    sourceRunKey: 'integration-approval-blocked-hourly',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(blockedHourlyMaterializationPlan.records[0]);

  const februaryEntry = await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-15T10:00:00.000Z',
    endTime: '2025-02-15T12:00:00.000Z',
  });
  const marchEntry = await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-03-03T13:00:00.000Z',
    endTime: '2025-03-03T15:00:00.000Z',
  });
  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-03-10T09:00:00.000Z',
    endTime: '2025-03-10T10:00:00.000Z',
  });

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: hourlyLine.contractId,
    contractLineId: hourlyLine.contractLineId,
    // Hourly lines always bill in arrears: the 02-08..03-07 service period is
    // invoiced in the window after it ends.
    windowStart: '2025-03-08T00:00:00Z',
    windowEnd: '2025-04-08T00:00:00Z',
  });

  const billingResult = await calculateBillingForSelectionInputAction({
    billingEngine: new BillingEngine(),
    selectorInput,
  });
  const timeCharges = billingResult.charges.filter((charge) => charge.type === 'time') as Array<{
    entryId?: string;
    servicePeriodStart?: string;
    servicePeriodEnd?: string;
    billingTiming?: string;
  }>;

  expect(timeCharges).toHaveLength(2);
  expect(new Set(timeCharges.map((charge) => charge.entryId))).toEqual(
    new Set([februaryEntry.entry_id, marchEntry.entry_id]),
  );
  for (const charge of timeCharges) {
    expect(charge.servicePeriodStart).toBe('2025-02-08');
    expect(charge.servicePeriodEnd).toBe('2025-03-07');
    expect(charge.billingTiming).toBe('arrears');
  }
}, HOOK_TIMEOUT);

it('T070: hourly recurring charges with no billable time inside the service period produce no recurring invoice line while preserving due-window identity', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-hourly-empty-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Contract Hourly Empty Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Contract Hourly Empty Service',
    planName: 'Contract Hourly Empty Plan',
    baseRateCents: 12000,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const windowSpecificMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-08T00:00:00Z',
    materializedAt: '2026-04-12T00:05:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: hourlyLine.contractLineId,
      chargeFamily: 'hourly',
    },
    duePosition: 'arrears',
    sourceRuleVersion: `${hourlyLine.contractLineId}:approval-window-specific:v1`,
    sourceRunKey: 'integration-approval-window-specific',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(windowSpecificMaterializationPlan.records[0]);

  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-05T10:00:00.000Z',
    endTime: '2025-02-05T11:00:00.000Z',
  });
  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-03-10T10:00:00.000Z',
    endTime: '2025-03-10T11:00:00.000Z',
  });

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: hourlyLine.contractId,
    contractLineId: hourlyLine.contractLineId,
    // Hourly lines always bill in arrears: the 02-08..03-07 service period is
    // invoiced in the window after it ends.
    windowStart: '2025-03-08T00:00:00Z',
    windowEnd: '2025-04-08T00:00:00Z',
  });

  const invoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(invoice).toMatchObject({
    billing_cycle_id: null,
    subtotal: 0,
    total: 0,
  });
  expect(invoice?.invoice_charges ?? []).toHaveLength(0);
}, HOOK_TIMEOUT);

it('T001/T004: recurring due-work marks a contract-hourly window as approval-blocked when matching uninvoiced time is non-approved, while ignoring already invoiced entries', async () => {
  setupCommonMocks({ tenantId, userId: 'approval-blocked-hourly-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Approval Blocked Hourly Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Approval Blocked Hourly Service',
    planName: 'Approval Blocked Hourly Plan',
    baseRateCents: 12000,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const blockedHourlyMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-08T00:00:00Z',
    materializedAt: '2026-04-12T00:00:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: hourlyLine.contractLineId,
      chargeFamily: 'hourly',
    },
    duePosition: 'arrears',
    sourceRuleVersion: `${hourlyLine.contractLineId}:approval-blocked-hourly:v1`,
    sourceRunKey: 'integration-approval-blocked-hourly',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(blockedHourlyMaterializationPlan.records[0]);

  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-14T10:00:00.000Z',
    endTime: '2025-02-14T11:00:00.000Z',
    approvalStatus: 'SUBMITTED',
  });
  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-16T10:00:00.000Z',
    endTime: '2025-02-16T11:00:00.000Z',
    approvalStatus: 'CHANGES_REQUESTED',
    invoiced: true,
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Approval Blocked Hourly Client',
  });
  const blockedCandidate = dueWork.invoiceCandidates.find((candidate) =>
    candidate.clientName === 'Approval Blocked Hourly Client',
  );

  expect(blockedCandidate).toBeTruthy();
  expect(blockedCandidate).toMatchObject({
    canGenerate: false,
    approvalBlockedEntryCount: 1,
  });
  expect(blockedCandidate?.blockedReason).toContain('1 unapproved entry');
  expect(blockedCandidate?.members[0]?.approvalBlockedEntryCount).toBe(1);
}, HOOK_TIMEOUT);

it('parity: recurring due-work blocks uniquely assignable unassigned hourly time inside the half-open service period and ignores the exclusive end date', async () => {
  setupCommonMocks({ tenantId, userId: 'approval-unique-unassigned-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Approval Unique Unassigned Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Approval Unique Unassigned Service',
    planName: 'Approval Unique Unassigned Plan',
    baseRateCents: 12000,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const uniqueUnassignedMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-08T00:00:00Z',
    materializedAt: '2026-04-12T00:02:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: hourlyLine.contractLineId,
      chargeFamily: 'hourly',
    },
    duePosition: 'arrears',
    sourceRuleVersion: `${hourlyLine.contractLineId}:approval-unique-unassigned:v1`,
    sourceRunKey: 'integration-approval-unique-unassigned',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(uniqueUnassignedMaterializationPlan.records[0]);

  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: null,
    startTime: '2025-03-07T10:00:00.000Z',
    endTime: '2025-03-07T11:00:00.000Z',
    approvalStatus: null,
  });
  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: null,
    startTime: '2025-03-08T10:00:00.000Z',
    endTime: '2025-03-08T11:00:00.000Z',
    approvalStatus: 'SUBMITTED',
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Approval Unique Unassigned Client',
  });
  const blockedCandidate = dueWork.invoiceCandidates.find((candidate) =>
    candidate.clientName === 'Approval Unique Unassigned Client',
  );

  expect(blockedCandidate).toBeTruthy();
  expect(blockedCandidate).toMatchObject({
    canGenerate: false,
    approvalBlockedEntryCount: 1,
  });
  expect(blockedCandidate?.blockedReason).toContain('1 unapproved entry');
  expect(blockedCandidate?.members[0]?.approvalBlockedEntryCount).toBe(1);

  await expect(
    generateInvoiceForSelectionInput(blockedCandidate!.members[0]!.selectorInput),
  ).resolves.toEqual({
    actionError: 'Blocked until approval: 1 unapproved entry.',
    messageKey: 'msp/invoicing:automaticInvoices.executionRows.blockedUntilApproval',
    messageParams: { count: '1' },
  });
}, HOOK_TIMEOUT);

it('T047: DB-backed unresolved discovery hydrates only the billing period containing eligible non-contract time', async () => {
  setupCommonMocks({ tenantId, userId: 'bulk-unresolved-discovery-user', permissionCheck: () => true });

  const {
    contextLike,
    clientId,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Bulk Unresolved Discovery Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });
  const serviceId = await createTestService(contextLike as any, {
    service_name: 'Bulk Unresolved Discovery Service',
    billing_method: 'hourly',
    default_rate: 12500,
    unit_of_measure: 'hour',
    tax_region: 'US-NY',
  });
  await ensureUsdServicePrice(serviceId, 12500);

  const eligibleEntry = await createApprovedTimeEntryForContractLine({
    clientId,
    serviceId,
    contractLineId: null,
    startTime: '2025-01-15T10:00:00.000Z',
    endTime: '2025-01-15T11:00:00.000Z',
    approvalStatus: 'APPROVED',
    billableDuration: 60,
  });
  const ineligibleEntry = await createApprovedTimeEntryForContractLine({
    clientId,
    serviceId,
    contractLineId: null,
    startTime: '2024-12-15T10:00:00.000Z',
    endTime: '2024-12-15T11:00:00.000Z',
    approvalStatus: 'SUBMITTED',
    billableDuration: 60,
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Bulk Unresolved Discovery Client',
  });
  const unresolvedRows = dueWork.invoiceCandidates
    .flatMap((candidate) => candidate.members)
    .filter((member) => member.clientId === clientId && member.recordId.startsWith('unresolved:'));

  expect(unresolvedRows).toHaveLength(1);
  expect(unresolvedRows[0]).toMatchObject({
    recordId: `unresolved:time:${eligibleEntry.entry_id}`,
    scheduleKey: `schedule:${tenantId}:unresolved:time:${eligibleEntry.entry_id}`,
    clientId,
    clientName: 'Bulk Unresolved Discovery Client',
    chargeType: 'Hourly',
    canGenerate: true,
    approvalBlockedEntryCount: 0,
  });
  expect(normalizeDateValue(unresolvedRows[0]?.invoiceWindowStart)).toBe(currentPeriodStart);
  expect(normalizeDateValue(unresolvedRows[0]?.invoiceWindowEnd)).toBe(nextPeriodStart);
  expect(
    unresolvedRows.some((member) => member.recordId === `unresolved:time:${ineligibleEntry.entry_id}`),
  ).toBe(false);
}, HOOK_TIMEOUT);

it('T002: recurring due-work does not block a window for unrelated non-approved time outside that window service-period semantics', async () => {
  setupCommonMocks({ tenantId, userId: 'approval-window-specific-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Approval Window Specific Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Approval Window Specific Service',
    planName: 'Approval Window Specific Plan',
    baseRateCents: 12000,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const windowSpecificMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-08T00:00:00Z',
    materializedAt: '2026-04-12T00:05:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: hourlyLine.contractLineId,
      chargeFamily: 'hourly',
    },
    duePosition: 'arrears',
    sourceRuleVersion: `${hourlyLine.contractLineId}:approval-window-specific:v1`,
    sourceRunKey: 'integration-approval-window-specific',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(windowSpecificMaterializationPlan.records[0]);

  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-15T10:00:00.000Z',
    endTime: '2025-02-15T12:00:00.000Z',
    approvalStatus: 'APPROVED',
  });
  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-03-12T10:00:00.000Z',
    endTime: '2025-03-12T12:00:00.000Z',
    approvalStatus: 'SUBMITTED',
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Approval Window Specific Client',
  });
  const readyCandidate = dueWork.invoiceCandidates.find((candidate) =>
    candidate.clientName === 'Approval Window Specific Client',
  );

  expect(readyCandidate).toBeTruthy();
  expect(readyCandidate).toMatchObject({
    canGenerate: true,
    approvalBlockedEntryCount: 0,
  });
}, HOOK_TIMEOUT);

it('T003/T008/T017: mixed-charge recurring windows are blocked in full by matching non-approved hourly time, and generation rejects stale direct attempts', async () => {
  setupCommonMocks({ tenantId, userId: 'approval-mixed-window-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Approval Mixed Window Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Approval Mixed Fixed Service',
    planName: 'Approval Mixed Fixed Plan',
    baseRateCents: 180,
    startDate: '2025-02-08',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Approval Mixed Hourly Service',
    planName: 'Approval Mixed Hourly Plan',
    baseRateCents: 12000,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  // The hourly line bills in arrears, so its 02-08..03-07 service period is
  // invoiced in the 03-08 window. Materialize the advance fixed line's 03-08
  // period so both land in the same invoice window.
  const mixedFixedMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-03-08T00:00:00Z',
    materializedAt: '2026-04-12T00:10:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:approval-mixed-fixed:v1`,
    sourceRunKey: 'integration-approval-mixed-fixed',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const mixedHourlyMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-08T00:00:00Z',
    materializedAt: '2026-04-12T00:10:30.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: hourlyLine.contractLineId,
      chargeFamily: 'hourly',
    },
    duePosition: 'arrears',
    sourceRuleVersion: `${hourlyLine.contractLineId}:approval-mixed-hourly:v1`,
    sourceRunKey: 'integration-approval-mixed-hourly',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(mixedFixedMaterializationPlan.records[0]);
  await upsertRecurringServicePeriodRecord(mixedHourlyMaterializationPlan.records[0]);

  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-18T10:00:00.000Z',
    endTime: '2025-02-18T11:00:00.000Z',
    approvalStatus: 'DRAFT',
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Approval Mixed Window Client',
  });
  const blockedCandidate = dueWork.invoiceCandidates.find((candidate) =>
    candidate.clientName === 'Approval Mixed Window Client',
  );

  expect(blockedCandidate).toBeTruthy();
  expect(blockedCandidate?.memberCount).toBeGreaterThanOrEqual(2);
  expect(blockedCandidate).toMatchObject({
    canGenerate: false,
    approvalBlockedEntryCount: 1,
  });

  const fixedMember = blockedCandidate?.members.find((member) => member.contractLineId === fixedLine.contractLineId);
  expect(fixedMember).toBeTruthy();

  await expect(
    generateInvoiceForSelectionInput(fixedMember!.selectorInput),
  ).resolves.toEqual({
    actionError: 'Blocked until approval: 1 unapproved entry.',
    messageKey: 'msp/invoicing:automaticInvoices.executionRows.blockedUntilApproval',
    messageParams: { count: '1' },
  });
}, HOOK_TIMEOUT);

it('T009/T011: server-side guard re-checks approval state at generation time and windows transition from Needs Approval to Ready after approval', async () => {
  setupCommonMocks({ tenantId, userId: 'approval-transition-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Approval Transition Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Approval Transition Service',
    planName: 'Approval Transition Plan',
    baseRateCents: 12000,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const transitionMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-08T00:00:00Z',
    materializedAt: '2026-04-12T00:15:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: hourlyLine.contractLineId,
      chargeFamily: 'hourly',
    },
    duePosition: 'arrears',
    sourceRuleVersion: `${hourlyLine.contractLineId}:approval-transition:v1`,
    sourceRunKey: 'integration-approval-transition',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(transitionMaterializationPlan.records[0]);

  const mutableEntry = await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-20T10:00:00.000Z',
    endTime: '2025-02-20T12:00:00.000Z',
    approvalStatus: 'APPROVED',
  });

  const initiallyReadyDueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Approval Transition Client',
  });
  const readyMember = initiallyReadyDueWork.invoiceCandidates
    .flatMap((candidate) => candidate.members)
    .find((member) => member.contractLineId === hourlyLine.contractLineId);
  expect(readyMember).toBeTruthy();
  expect(readyMember?.canGenerate).toBe(true);

  await tenantTable(db, tenantId, 'time_entries')
    .where({ tenant: tenantId, entry_id: mutableEntry.entry_id })
    .update({ approval_status: 'SUBMITTED' });

  await expect(
    generateInvoiceForSelectionInput(readyMember!.selectorInput),
  ).resolves.toEqual({
    actionError: 'Blocked until approval: 1 unapproved entry.',
    messageKey: 'msp/invoicing:automaticInvoices.executionRows.blockedUntilApproval',
    messageParams: { count: '1' },
  });

  await tenantTable(db, tenantId, 'time_entries')
    .where({ tenant: tenantId, entry_id: mutableEntry.entry_id })
    .update({ approval_status: 'APPROVED' });

  const refreshedDueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Approval Transition Client',
  });
  const refreshedCandidate = refreshedDueWork.invoiceCandidates.find((candidate) =>
    candidate.clientName === 'Approval Transition Client',
  );
  expect(refreshedCandidate).toBeTruthy();
  expect(refreshedCandidate).toMatchObject({
    canGenerate: true,
    approvalBlockedEntryCount: 0,
  });
}, HOOK_TIMEOUT);

it('T071: usage recurring charges bill usage records that fall inside a contract-cadence service period, not the nearest client billing cycle', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-usage-window-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Contract Usage Window Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const usageLine = await createUsageContractLine(contextLike, {
    serviceName: 'Contract Usage Window Service',
    planName: 'Contract Usage Window Plan',
    baseRateCents: 900,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(usageLine.contractLineId);

  const februaryUsage = await createUsageRecordForContractLine({
    clientId: contextLike.clientId,
    serviceId: usageLine.serviceId,
    contractLineId: usageLine.contractLineId,
    usageDate: '2025-02-12',
    quantity: 3,
  });
  const marchUsage = await createUsageRecordForContractLine({
    clientId: contextLike.clientId,
    serviceId: usageLine.serviceId,
    contractLineId: usageLine.contractLineId,
    usageDate: '2025-03-05',
    quantity: 5,
  });
  await createUsageRecordForContractLine({
    clientId: contextLike.clientId,
    serviceId: usageLine.serviceId,
    contractLineId: usageLine.contractLineId,
    usageDate: '2025-03-10',
    quantity: 8,
  });

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: usageLine.contractId,
    contractLineId: usageLine.contractLineId,
    // Arrears: the 02-08..03-07 service period is invoiced in the window after it ends.
    windowStart: '2025-03-08T00:00:00Z',
    windowEnd: '2025-04-08T00:00:00Z',
  });

  const billingResult = await calculateBillingForSelectionInputAction({
    billingEngine: new BillingEngine(),
    selectorInput,
  });
  const usageCharges = billingResult.charges.filter((charge) => charge.type === 'usage') as Array<{
    usageId?: string;
    servicePeriodStart?: string;
    servicePeriodEnd?: string;
    billingTiming?: string;
  }>;

  expect(usageCharges).toHaveLength(2);
  expect(new Set(usageCharges.map((charge) => charge.usageId))).toEqual(
    new Set([februaryUsage.usage_id, marchUsage.usage_id]),
  );
  for (const charge of usageCharges) {
    expect(charge.servicePeriodStart).toBe('2025-02-08');
    expect(charge.servicePeriodEnd).toBe('2025-03-07');
    expect(charge.billingTiming).toBe('arrears');
  }
}, HOOK_TIMEOUT);

it('T072: usage recurring charges with no usage inside the service period refuse generation with a coded USAGE_RECORDS_MISSING failure and write nothing', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-usage-empty-user', permissionCheck: () => true });

  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Contract Usage Empty Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const usageLine = await createUsageContractLine(contextLike, {
    serviceName: 'Contract Usage Empty Service',
    planName: 'Contract Usage Empty Plan',
    baseRateCents: 900,
    startDate: '2025-02-08',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(usageLine.contractLineId);

  await createUsageRecordForContractLine({
    clientId: contextLike.clientId,
    serviceId: usageLine.serviceId,
    contractLineId: usageLine.contractLineId,
    usageDate: '2025-02-05',
    quantity: 4,
  });
  await createUsageRecordForContractLine({
    clientId: contextLike.clientId,
    serviceId: usageLine.serviceId,
    contractLineId: usageLine.contractLineId,
    usageDate: '2025-03-11',
    quantity: 6,
  });

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: usageLine.contractId,
    contractLineId: usageLine.contractLineId,
    // Arrears: the 02-08..03-07 service period is invoiced in the window after it ends.
    windowStart: '2025-03-08T00:00:00Z',
    windowEnd: '2025-04-08T00:00:00Z',
  });

  // Usage billing is record-driven: neither seeded record falls inside the
  // 2025-02-08 → 2025-03-07 service period, and "no eligible record" means
  // missing usage — not zero. Generation refuses with the coded failure that
  // routes the operator to record usage (or a zero-usage entry) instead of
  // silently finalizing the window with a zero-total invoice.
  const result = await generateInvoiceForSelectionInput(selectorInput);
  expect(result).toMatchObject({
    messageKey: 'msp/invoicing:manualInvoices.errors.USAGE_RECORDS_MISSING',
    messageParams: {
      services: 'Contract Usage Empty Service',
      serviceIds: usageLine.serviceId,
      periodStart: '2025-02-08',
      periodEnd: '2025-03-07',
    },
  });
  expect((result as { actionError?: string }).actionError).toContain(
    'No eligible usage records for Contract Usage Empty Service',
  );

  // The refusal commits nothing: no invoice row exists for the client, so a
  // retry after recording usage starts from a clean window.
  const persistedInvoices = await tenantTable(db, tenantId, 'invoices')
    .where({ tenant: tenantId, client_id: contextLike.clientId })
    .select(['invoice_id']);
  expect(persistedInvoices).toHaveLength(0);
}, HOOK_TIMEOUT);

it('T073: mixed recurring invoice generation can combine fixed, hourly, and usage content under one service-driven execution window when the commercial model requires it', async () => {
  setupCommonMocks({ tenantId, userId: 'mixed-metered-window-user', permissionCheck: () => true });

  const { contextLike, cycleId, currentPeriodStart, currentPeriodEnd } = await createClientWithRecurringCycles({
    clientName: 'Mixed Metered Window Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Mixed Fixed Service',
    planName: 'Mixed Window Contract',
    baseRateCents: 150,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Mixed Hourly Service',
    planName: 'Mixed Window Contract Hourly',
    baseRateCents: 12500,
    // Hourly and usage always bill in arrears, so the February invoice cycle
    // bills their January service period next to the advance fixed line.
    startDate: '2025-01-01',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
    contractId: fixedLine.contractId,
    clientContractId: fixedLine.clientContractId,
  });
  const usageLine = await createUsageContractLine(contextLike, {
    serviceName: 'Mixed Usage Service',
    planName: 'Mixed Window Contract Usage',
    baseRateCents: 700,
    startDate: '2025-01-01',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
    contractId: fixedLine.contractId,
    clientContractId: fixedLine.clientContractId,
  });

  await syncContractLineRecurringPeriods(fixedLine.contractLineId);
  await syncContractLineRecurringPeriods(hourlyLine.contractLineId);
  await syncContractLineRecurringPeriods(usageLine.contractLineId);

  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-01-14T09:00:00.000Z',
    endTime: '2025-01-14T11:00:00.000Z',
  });
  await createUsageRecordForContractLine({
    clientId: contextLike.clientId,
    serviceId: usageLine.serviceId,
    contractLineId: usageLine.contractLineId,
    usageDate: '2025-01-20',
    quantity: 6,
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();

  const invoiceChargeRows = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ invoice_id: invoice!.invoice_id, tenant: tenantId })
    .select(['item_id', 'service_id']);

  const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
  const persistedServiceIds = new Set([
    ...invoiceChargeRows.flatMap((row) => (row.service_id ? [row.service_id] : [])),
    ...detailRows.flatMap((row) => (row.service_id ? [row.service_id] : [])),
  ]);
  expect(persistedServiceIds).toEqual(
    new Set([fixedLine.serviceId, hourlyLine.serviceId, usageLine.serviceId]),
  );
  // Every recurring family (fixed, hourly, usage) persists canonical detail
  // rows; the service-period linkage asserted by T021 depends on them.
  expect(new Set(detailRows.map((row) => row.service_id))).toEqual(
    new Set([fixedLine.serviceId, hourlyLine.serviceId, usageLine.serviceId]),
  );
  const detailRowsForCurrentWindow = detailRows.filter(
    (row) =>
      normalizeDateValue(row.service_period_start) === currentPeriodStart
      && normalizeDateValue(row.service_period_end) === currentPeriodEnd,
  );
  // The advance fixed line bills the current period; hourly and usage bill the
  // January period that just ended.
  expect(detailRowsForCurrentWindow.map((row) => row.service_id)).toEqual([fixedLine.serviceId]);
  const detailRowsForPriorWindow = detailRows.filter(
    (row) =>
      normalizeDateValue(row.service_period_start) === '2025-01-01'
      && normalizeDateValue(row.service_period_end) === '2025-01-31',
  );
  expect(new Set(detailRowsForPriorWindow.map((row) => row.service_id))).toEqual(
    new Set([hourlyLine.serviceId, usageLine.serviceId]),
  );
}, HOOK_TIMEOUT);

it('excludes zero-billable time entries from recurring hourly charges and leaves them uninvoiced', async () => {
  setupCommonMocks({ tenantId, userId: 'zero-billable-user', permissionCheck: () => true });

  const { contextLike, cycleId } = await createClientWithRecurringCycles({
    clientName: 'Zero Billable Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Zero Billable Service',
    planName: 'Zero Billable Plan',
    baseRateCents: 12000,
    // Arrears: the February cycle invoice bills the January service period.
    startDate: '2025-01-01',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  await syncContractLineRecurringPeriods(hourlyLine.contractLineId);

  const entry = await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-01-14T09:00:00.000Z',
    endTime: '2025-01-14T11:00:00.000Z',
    billableDuration: 0,
  });

  const result = await generateInvoice(cycleId);
  expect(result).toBeTruthy();
  expect(result).toMatchObject({ subtotal: 0 });

  const chargeRows = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ invoice_id: result!.invoice_id, service_id: hourlyLine.serviceId })
    .select('item_id');
  expect(chargeRows).toHaveLength(0);

  const mappingRows = await tenantTable(db, tenantId, 'invoice_time_entries')
    .where({ invoice_id: result!.invoice_id, tenant: tenantId })
    .select('entry_id');
  expect(mappingRows).toHaveLength(0);

  const persistedEntry = await tenantTable(db, tenantId, 'time_entries')
    .where({ tenant: tenantId, entry_id: entry.entry_id })
    .first('invoiced');
  expect(persistedEntry?.invoiced).toBe(false);
}, HOOK_TIMEOUT);

it('charges billable minutes, not elapsed start/end time, for recurring hourly entries', async () => {
  setupCommonMocks({ tenantId, userId: 'billable-minutes-user', permissionCheck: () => true });

  const { contextLike, cycleId } = await createClientWithRecurringCycles({
    clientName: 'Billable Minutes Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Billable Minutes Service',
    planName: 'Billable Minutes Plan',
    baseRateCents: 12000,
    // Arrears: the February cycle invoice bills the January service period.
    startDate: '2025-01-01',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  await syncContractLineRecurringPeriods(hourlyLine.contractLineId);

  // Two elapsed hours but only 45 billable minutes.
  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-01-14T09:00:00.000Z',
    endTime: '2025-01-14T11:00:00.000Z',
    billableDuration: 45,
  });

  const result = await generateInvoice(cycleId);
  expect(result).toBeTruthy();
  expect(result).not.toMatchObject({ actionError: expect.any(String) });

  const chargeRows = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ invoice_id: result!.invoice_id, service_id: hourlyLine.serviceId })
    .select(['item_id', 'quantity', 'net_amount']);
  expect(chargeRows).toHaveLength(1);
  expect(Number(chargeRows[0].quantity)).toBe(0.75);
  expect(Number(chargeRows[0].net_amount)).toBe(9000);
}, HOOK_TIMEOUT);

it('invoices multiple approved hourly entries sharing one recurring period with a single period link', async () => {
  setupCommonMocks({ tenantId, userId: 'shared-period-hourly-user', permissionCheck: () => true });

  const { contextLike, cycleId } = await createClientWithRecurringCycles({
    clientName: 'Shared Period Hourly Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });

  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Shared Period Hourly Service',
    planName: 'Shared Period Hourly Plan',
    baseRateCents: 12000,
    // Arrears: the February cycle invoice bills the January service period.
    startDate: '2025-01-01',
    billingTiming: 'arrears',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  await syncContractLineRecurringPeriods(hourlyLine.contractLineId);

  const firstEntry = await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-01-14T09:00:00.000Z',
    endTime: '2025-01-14T11:00:00.000Z',
  });
  const secondEntry = await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-01-15T09:00:00.000Z',
    endTime: '2025-01-15T10:00:00.000Z',
  });

  const result = await generateInvoice(cycleId);
  expect(result).toBeTruthy();
  expect(result).toMatchObject({ subtotal: 36000 });

  const chargeRows = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ invoice_id: result!.invoice_id, service_id: hourlyLine.serviceId })
    .select(['item_id', 'quantity', 'net_amount']);
  expect(chargeRows).toHaveLength(2);
  expect(new Set(chargeRows.map((row) => Number(row.net_amount)))).toEqual(
    new Set([12000, 24000]),
  );

  const timeMappingRows = await tenantTable(db, tenantId, 'invoice_time_entries')
    .where({ invoice_id: result!.invoice_id, tenant: tenantId })
    .select(['entry_id', 'item_id']);
  expect(timeMappingRows.map((row) => row.entry_id).sort()).toEqual(
    [firstEntry.entry_id, secondEntry.entry_id].sort(),
  );
  expect(
    new Set(timeMappingRows.map((row) => row.item_id)),
  ).toEqual(new Set(chargeRows.map((row) => row.item_id)));

  const billedPeriodRows = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({
      tenant: tenantId,
      obligation_id: hourlyLine.contractLineId,
      invoice_id: result!.invoice_id,
    })
    .select(['record_id', 'lifecycle_state', 'invoice_charge_detail_id']);
  expect(billedPeriodRows).toHaveLength(1);
  expect(billedPeriodRows[0]).toMatchObject({
    lifecycle_state: 'billed',
  });
}, HOOK_TIMEOUT);

it('T021: deleting a recurring invoice clears service-period invoice linkage and restores invoiceable lifecycle state for unbridged contract-cadence rows', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-delete-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Delete Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-03-12',
    currentPeriodStart: '2025-04-12',
    nextPeriodStart: '2025-05-12',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Delete Service',
    planName: 'Contract Delete Plan',
    baseRateCents: 245,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const materializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:30:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-delete',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });

  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();
  expect(generatedInvoice?.billing_cycle_id ?? null).toBeNull();

  await hardDeleteInvoiceAction(generatedInvoice!.invoice_id);

  const deletedInvoice = await tenantTable(db, tenantId, 'invoices')
    .where({ tenant: tenantId, invoice_id: generatedInvoice!.invoice_id })
    .first(['invoice_id']);
  expect(deletedInvoice).toBeUndefined();

  const reopenedRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: materializationPlan.records[0].recordId })
    .first([
      'record_id',
      'lifecycle_state',
      'invoice_id',
      'invoice_charge_id',
      'invoice_charge_detail_id',
      'invoice_linked_at',
    ]);

  expect(reopenedRow).toMatchObject({
    record_id: materializationPlan.records[0].recordId,
    lifecycle_state: 'locked',
    invoice_id: null,
    invoice_charge_id: null,
    invoice_charge_detail_id: null,
    invoice_linked_at: null,
  });

  const invoiceableRows = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({
      tenant: tenantId,
      record_id: materializationPlan.records[0].recordId,
      schedule_key: materializationPlan.records[0].scheduleKey,
      invoice_window_start: currentPeriodStart,
      invoice_window_end: nextPeriodStart,
    })
    .whereIn('lifecycle_state', ['generated', 'edited', 'locked'])
    .whereNull('invoice_id')
    .whereNull('invoice_charge_id')
    .whereNull('invoice_charge_detail_id')
    .select('record_id');

  expect(invoiceableRows.map((row) => row.record_id)).toEqual([materializationPlan.records[0].recordId]);
}, HOOK_TIMEOUT);

// ---------------------------------------------------------------------------
// alga0002228: REST DELETE /api/v1/invoices/:id shares the UI's delete engine.
// The controller is exercised with authenticate/checkPermission stubbed to a
// context for a real tenant user; everything below the controller (service,
// shared delete engine, DB) is real.
// ---------------------------------------------------------------------------
async function createRestInvoiceHarness() {
  const { ApiInvoiceController } = await import('../../lib/api/controllers/ApiInvoiceController');
  const { InvoiceService } = await import('../../lib/api/services/InvoiceService');
  const userId = await createUser(db, tenantId, { user_type: 'internal' });
  const context = { tenant: tenantId, userId, user: { user_id: userId, user_type: 'internal' } } as any;

  class TestInvoiceController extends ApiInvoiceController {
    protected async authenticate(req: NextRequest) {
      return Object.assign(req, { context }) as any;
    }
    protected async checkPermission() {}
    protected runWithApiKeyContext<T>(_req: any, fn: () => Promise<T>): Promise<T> {
      return fn();
    }
  }

  // BaseService resolves its connection through the real tenant AsyncLocalStorage
  // context; this file mocks @alga-psa/db's runWithTenant to a passthrough.
  const { runWithTenant: realRunWithTenant } = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  const inTenant = <T,>(fn: () => Promise<T>): Promise<T> =>
    withRealTransactions(() => realRunWithTenant(tenantId, fn));

  const controller = new TestInvoiceController();
  const service = new InvoiceService();
  const restDelete = (invoiceId: string) =>
    inTenant(() =>
      controller.delete()(new NextRequest(`http://localhost/api/v1/invoices/${invoiceId}`, { method: 'DELETE' })),
    );
  return { context, service, restDelete, userId, inTenant };
}

async function insertPlainInvoice(clientId: string, status: 'draft' | 'sent' = 'draft') {
  const invoiceId = uuidv4();
  const now = '2026-03-18T15:15:00.000Z';
  await tenantTable(db, tenantId, 'invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    subtotal: 1000,
    tax: 0,
    total_amount: 1000,
    status,
    currency_code: 'USD',
    created_at: now,
    updated_at: now,
  });
  const chargeIds: string[] = [];
  for (const description of ['Manual line A', 'Manual line B']) {
    const itemId = uuidv4();
    chargeIds.push(itemId);
    await tenantTable(db, tenantId, 'invoice_charges').insert({
      item_id: itemId,
      tenant: tenantId,
      invoice_id: invoiceId,
      description,
      quantity: 1,
      unit_price: 5,
      total_price: 5,
      net_amount: 5,
      tax_amount: 0,
      is_manual: true,
      created_at: now,
      updated_at: now,
    });
  }
  return { invoiceId, chargeIds };
}

const NOT_DRAFT_DELETE_MESSAGE = 'Only draft invoices can be deleted; void the invoice instead.';
const HAS_PAYMENTS_DELETE_MESSAGE = 'Invoices with recorded payments cannot be deleted';

it('T-REST-DEL-1: REST DELETE of a fresh recurring draft removes it, releases its periods, and the window is due and regenerable again', async () => {
  setupCommonMocks({ tenantId, userId: 'rest-delete-recurring-user', permissionCheck: () => true });
  const { restDelete, service, context, inTenant } = await createRestInvoiceHarness();

  const { contextLike, currentPeriodStart, nextPeriodStart } = await createClientWithRecurringCycles({
    clientName: 'REST Delete Recurring Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-03-12',
    currentPeriodStart: '2025-04-12',
    nextPeriodStart: '2025-05-12',
  });
  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'REST Delete Service',
    planName: 'REST Delete Plan',
    baseRateCents: 245,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const plan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:30:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: { tenant: tenantId, obligationId: fixedLine.contractLineId, chargeFamily: 'fixed' },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-rest-delete',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(plan.records[0]);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });
  const generated = await generateInvoiceForSelectionInput(selectorInput);
  expect(generated).toBeTruthy();
  const invoiceId = generated!.invoice_id;

  const chargeIds = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ tenant: tenantId, invoice_id: invoiceId })
    .pluck('item_id');
  expect(chargeIds.length).toBeGreaterThan(0);

  // Recurring drafts cannot have their items replaced through update().
  await expect(
    inTenant(() =>
      service.update(invoiceId, { items: [{ description: 'x', quantity: 1, unit_price: 1 }] } as any, context),
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    await tenantTable(db, tenantId, 'invoice_charges').where({ tenant: tenantId, invoice_id: invoiceId }).pluck('item_id'),
  ).toHaveLength(chargeIds.length);

  const response = await restDelete(invoiceId);
  expect(response.status).toBe(204);

  // The engine writes the lifecycle invoice_deleted row atomically with the
  // delete; REST adds the recurring provenance to its details.
  const auditRows = await tenantTable(db, tenantId, 'audit_logs')
    .where({ tenant: tenantId, table_name: 'invoices', record_id: invoiceId })
    .select('operation', 'user_id', 'details');
  expect(auditRows.map((row: any) => row.operation)).toEqual(['invoice_deleted']);
  expect(auditRows[0].details).toMatchObject({
    before: { status: 'draft' },
    recurring_provenance: expect.anything(),
  });

  expect(await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first()).toBeUndefined();
  expect(await tenantTable(db, tenantId, 'invoice_charges').where({ tenant: tenantId, invoice_id: invoiceId }).first()).toBeUndefined();
  expect(
    await tenantTable(db, tenantId, 'invoice_charge_details').whereIn('item_id', chargeIds).first(),
  ).toBeUndefined();
  expect(await tenantTable(db, tenantId, 'transactions').where({ tenant: tenantId, invoice_id: invoiceId }).first()).toBeUndefined();

  const reopened = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: plan.records[0].recordId })
    .first(['lifecycle_state', 'invoice_id', 'invoice_charge_id', 'invoice_charge_detail_id', 'invoice_linked_at']);
  expect(reopened).toMatchObject({
    lifecycle_state: 'locked',
    invoice_id: null,
    invoice_charge_id: null,
    invoice_charge_detail_id: null,
    invoice_linked_at: null,
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'REST Delete Recurring Client',
  });
  const dueRow = dueWork.invoiceCandidates
    .flatMap((candidate) => candidate.members)
    .find((row) =>
      row.contractLineId === fixedLine.contractLineId
      && normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart
      && normalizeDateValue(row.invoiceWindowEnd) === nextPeriodStart,
    );
  expect(dueRow).toBeTruthy();

  const regenerated = await generateInvoiceForSelectionInput(dueRow!.selectorInput);
  expect(regenerated).toBeTruthy();
  expect(regenerated!.invoice_id).not.toBe(invoiceId);
}, HOOK_TIMEOUT);

it('T-REST-DEL-2: REST DELETE of a non-recurring draft removes the invoice and its charges', async () => {
  const { restDelete } = await createRestInvoiceHarness();
  const { contextLike } = await createClientWithRecurringCycles({ clientName: 'REST Delete Manual Client' });
  const { invoiceId } = await insertPlainInvoice(contextLike.clientId);

  const response = await restDelete(invoiceId);
  expect(response.status).toBe(204);

  expect(await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first()).toBeUndefined();
  expect(await tenantTable(db, tenantId, 'invoice_charges').where({ tenant: tenantId, invoice_id: invoiceId }).first()).toBeUndefined();
}, HOOK_TIMEOUT);

it('T-REST-DEL-3: REST DELETE of a finalized invoice answers 409 and leaves the invoice untouched', async () => {
  const { restDelete, service, context, inTenant } = await createRestInvoiceHarness();
  const { contextLike } = await createClientWithRecurringCycles({ clientName: 'REST Delete Finalized Client' });
  const { invoiceId, chargeIds } = await insertPlainInvoice(contextLike.clientId);

  await inTenant(() => service.finalizeInvoice({ invoice_id: invoiceId } as any, context));
  const before = await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first();
  expect(before.finalized_at).toBeTruthy();

  const response = await restDelete(invoiceId);
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.error.code).toBe('CONFLICT');
  expect(body.error.message).toBe(NOT_DRAFT_DELETE_MESSAGE);

  const after = await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first();
  expect(after).toBeTruthy();
  expect(after.status).toBe(before.status);
  expect(after.status).not.toBe('cancelled');
  expect(String(after.finalized_at)).toBe(String(before.finalized_at));
  const charges = await tenantTable(db, tenantId, 'invoice_charges').where({ tenant: tenantId, invoice_id: invoiceId }).pluck('item_id');
  expect(charges.sort()).toEqual([...chargeIds].sort());
}, HOOK_TIMEOUT);

async function expectRestDeleteRefused(
  restDelete: (id: string) => Promise<Response>,
  invoiceId: string,
  chargeIds: string[],
  expectedStatus: string,
  expectedMessage: string = NOT_DRAFT_DELETE_MESSAGE,
) {
  const response = await restDelete(invoiceId);
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.error.code).toBe('CONFLICT');
  expect(body.error.message).toBe(expectedMessage);

  const after = await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first();
  expect(after).toBeTruthy();
  expect(after.status).toBe(expectedStatus);
  const charges = await tenantTable(db, tenantId, 'invoice_charges').where({ tenant: tenantId, invoice_id: invoiceId }).pluck('item_id');
  expect(charges.sort()).toEqual([...chargeIds].sort());
}

it.each([
  ['T-REST-DEL-5', 'sent'],
  ['T-REST-DEL-6', 'paid'],
])('%s: REST DELETE of a %s invoice with NULL finalized_at answers 409 and leaves it untouched', async (_id, status) => {
  const { restDelete } = await createRestInvoiceHarness();
  const { contextLike } = await createClientWithRecurringCycles({ clientName: `REST Delete ${status} Client` });
  const { invoiceId, chargeIds } = await insertPlainInvoice(contextLike.clientId);
  await tenantTable(db, tenantId, 'invoices')
    .where({ tenant: tenantId, invoice_id: invoiceId })
    .update({ status, finalized_at: null });

  await expectRestDeleteRefused(restDelete, invoiceId, chargeIds, status);
}, HOOK_TIMEOUT);

it('T-REST-DEL-7: REST DELETE of a draft that has a recorded payment answers 409 and keeps the payment', async () => {
  const { restDelete } = await createRestInvoiceHarness();
  const { contextLike } = await createClientWithRecurringCycles({ clientName: 'REST Delete Paid Draft Client' });
  const { invoiceId, chargeIds } = await insertPlainInvoice(contextLike.clientId);
  const paymentId = uuidv4();
  await tenantTable(db, tenantId, 'invoice_payments').insert({
    payment_id: paymentId,
    tenant: tenantId,
    invoice_id: invoiceId,
    amount: 500,
    payment_method: 'check',
    status: 'completed',
  });

  await expectRestDeleteRefused(restDelete, invoiceId, chargeIds, 'draft', HAS_PAYMENTS_DELETE_MESSAGE);
  const payment = await tenantTable(db, tenantId, 'invoice_payments')
    .where({ tenant: tenantId, payment_id: paymentId })
    .first();
  expect(payment).toBeTruthy();
}, HOOK_TIMEOUT);

it('T-REST-DEL-4: REST DELETE of an unknown invoice id answers 404', async () => {
  const { restDelete, service, context, inTenant } = await createRestInvoiceHarness();
  const response = await restDelete(uuidv4());
  expect(response.status).toBe(404);

  // The service itself (past the controller's getById pre-check) also maps a
  // missing invoice to NotFound rather than silently succeeding.
  await expect(inTenant(() => service.delete(uuidv4(), context))).rejects.toMatchObject({ statusCode: 404 });
}, HOOK_TIMEOUT);

it('T-REST-UPD-1: REST update writes a header-only change without a missing-column error and replaces invoice_charges for a non-recurring draft', async () => {
  const { service, context, inTenant } = await createRestInvoiceHarness();
  const { contextLike } = await createClientWithRecurringCycles({ clientName: 'REST Update Client' });
  const { invoiceId, chargeIds } = await insertPlainInvoice(contextLike.clientId);

  await inTenant(() => service.update(invoiceId, { due_date: '2026-06-30' } as any, context));
  const headerOnly = await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first();
  expect(normalizeDateValue(headerOnly.due_date)).toBe('2026-06-30');

  const serviceId = await createTestService(contextLike, {});
  await inTenant(() =>
    service.update(
      invoiceId,
      { items: [{ service_id: serviceId, description: 'Replacement line', quantity: 2, unit_price: 7 }] } as any,
      context,
    ),
  );
  const charges = await tenantTable(db, tenantId, 'invoice_charges').where({ tenant: tenantId, invoice_id: invoiceId });
  expect(charges).toHaveLength(1);
  expect(charges[0].description).toBe('Replacement line');
  expect(chargeIds).not.toContain(charges[0].item_id);

  // A finalized invoice may not have its items replaced.
  await inTenant(() => service.finalizeInvoice({ invoice_id: invoiceId } as any, context));
  await expect(
    inTenant(() => service.update(invoiceId, { items: [{ description: 'x', quantity: 1, unit_price: 1 }] } as any, context)),
  ).rejects.toMatchObject({ statusCode: 409 });
}, HOOK_TIMEOUT);

it('T-REST-STATUS-1: sendInvoice on a finalized invoice no longer fails on the missing invoices.updated_by column', async () => {
  const { service, context, inTenant } = await createRestInvoiceHarness();
  const { contextLike } = await createClientWithRecurringCycles({ clientName: 'REST Status Client' });
  const { invoiceId } = await insertPlainInvoice(contextLike.clientId);
  await inTenant(() => service.finalizeInvoice({ invoice_id: invoiceId } as any, context));

  await inTenant(() =>
    service.sendInvoice({ invoice_id: invoiceId, email_addresses: ['billing@example.com'], include_pdf: false } as any, context),
  );
  const sent = await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first();
  expect(sent.status).toBe('sent');

  // recordPayment is intentionally not asserted here: it has a separate, pre-existing
  // defect (invoice_payments.created_by does not exist), outside alga0002228's scope.
}, HOOK_TIMEOUT);

it('T051/T078: invoiced-history reader returns client-cadence recurring invoices with service-period metadata after the hard cutover', async () => {
  setupCommonMocks({ tenantId, userId: 'client-history-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Client History Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Client History Service',
    planName: 'Client History Plan',
    baseRateCents: 199,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:40:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-client-history',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const targetRecord = materializationPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  expect(targetRecord).toBeTruthy();
  await upsertRecurringServicePeriodRecord(targetRecord!);

  const selectorInput = buildClientCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    scheduleKey: materializationPlan.scheduleKey,
    periodKey: targetRecord!.periodKey,
    windowStart: currentPeriodStart,
    windowEnd: nextPeriodStart,
  });
  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();

  const history = await getInvoicedBillingCyclesPaginatedAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Client History Reader',
  });

  expect(history.total).toBeGreaterThan(0);
  const historyRow = history.cycles.find((row) => row.invoiceId === generatedInvoice!.invoice_id);
  expect(historyRow).toMatchObject({
    invoiceId: generatedInvoice!.invoice_id,
    clientName: 'Client History Reader',
    cadenceSource: 'client_schedule',
    executionWindowKind: 'client_cadence_window',
  });
  expect(normalizeDateValue(historyRow?.servicePeriodStart)).toBe(currentPeriodStart);
  expect(normalizeDateValue(historyRow?.servicePeriodEnd)).toBe(nextPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowStart)).toBe(currentPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowEnd)).toBe(nextPeriodStart);
  expect(historyRow?.servicePeriodLabel).toContain(currentPeriodStart);
  expect(historyRow?.servicePeriodLabel).toContain(nextPeriodStart);
  expect(historyRow?.invoiceWindowLabel).toContain(currentPeriodStart);
  expect(historyRow?.invoiceWindowLabel).toContain(nextPeriodStart);
}, HOOK_TIMEOUT);

it('T052/T079/T084: invoiced-history reader returns bridge-free contract-cadence recurring invoices with canonical service-period metadata', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-history-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract History Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-08',
    currentPeriodStart: '2025-02-08',
    nextPeriodStart: '2025-03-08',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract History Service',
    planName: 'Contract History Plan',
    baseRateCents: 221,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const materializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:45:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-history',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });

  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();

  const history = await getInvoicedBillingCyclesPaginatedAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Contract History Reader',
  });

  expect(history.total).toBeGreaterThan(0);
  const historyRow = history.cycles.find((row) => row.invoiceId === generatedInvoice!.invoice_id);
  expect(historyRow).toMatchObject({
    invoiceId: generatedInvoice!.invoice_id,
    clientName: 'Contract History Reader',
    billingCycleId: null,
    hasBillingCycleBridge: false,
    cadenceSource: 'contract_anniversary',
    executionWindowKind: 'contract_cadence_window',
  });
  expect(normalizeDateValue(historyRow?.servicePeriodStart)).toBe(currentPeriodStart);
  expect(normalizeDateValue(historyRow?.servicePeriodEnd)).toBe(nextPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowStart)).toBe(currentPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowEnd)).toBe(nextPeriodStart);
  expect(historyRow?.servicePeriodLabel).toContain(currentPeriodStart);
  expect(historyRow?.servicePeriodLabel).toContain(nextPeriodStart);
  expect(historyRow?.invoiceWindowLabel).toContain(currentPeriodStart);
  expect(historyRow?.invoiceWindowLabel).toContain(nextPeriodStart);
}, HOOK_TIMEOUT);

it('T082: DB-backed recurring invoice code treats materialized service periods as mandatory and surfaces missing client-cadence windows as repair work', async () => {
  setupCommonMocks({ tenantId, userId: 'required-schema-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Required Schema Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Required Schema Service',
    planName: 'Required Schema Plan',
    baseRateCents: 188,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-19T10:00:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-required-schema',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const targetRecord = materializationPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  expect(targetRecord).toBeTruthy();

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Required Schema Client',
  });
  const dueRows = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members);

  expect(dueRows.find((row) => row.clientName === 'Required Schema Client')).toBeUndefined();
  expect(dueWork.materializationGaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        clientName: 'Required Schema Client',
        scheduleKey: materializationPlan.scheduleKey,
        periodKey: targetRecord!.periodKey,
        invoiceWindowStart: currentPeriodStart,
        invoiceWindowEnd: nextPeriodStart,
        servicePeriodStart: targetRecord!.servicePeriod.start,
        servicePeriodEnd: targetRecord!.servicePeriod.end,
        reason: 'missing_service_period_materialization',
      }),
    ]),
  );

  const preview = await previewInvoiceForSelectionInputAction(
    buildClientCadenceDueSelectionInput({
      clientId: contextLike.clientId,
      scheduleKey: materializationPlan.scheduleKey,
      periodKey: targetRecord!.periodKey,
      windowStart: currentPeriodStart,
      windowEnd: nextPeriodStart,
    }),
  );

  expect(preview).toMatchObject({
    success: false,
    code: 'RECURRING_PERIODS_NOT_MATERIALIZED',
    error: expect.stringContaining("Service periods haven't been generated"),
  });
}, HOOK_TIMEOUT);

it('T105: due-work candidates are non-generateable when a client-cadence window is only partially materialized', async () => {
  setupCommonMocks({ tenantId, userId: 'partial-materialization-duework-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Partial Materialization Due Work Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const firstLine = await createFixedContractLine(contextLike, {
    serviceName: 'Partial Materialization Service A',
    planName: 'Partial Materialization Plan A',
    baseRateCents: 156,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  const secondLine = await createFixedContractLine(contextLike, {
    serviceName: 'Partial Materialization Service B',
    planName: 'Partial Materialization Plan B',
    baseRateCents: 164,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const firstPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-20T14:00:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: firstLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${firstLine.contractLineId}:v1`,
    sourceRunKey: 'integration-partial-duework-a',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const secondPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-20T14:05:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: secondLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${secondLine.contractLineId}:v1`,
    sourceRunKey: 'integration-partial-duework-b',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  const firstTarget = firstPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  const secondTarget = secondPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  expect(firstTarget).toBeTruthy();
  expect(secondTarget).toBeTruthy();
  await upsertRecurringServicePeriodRecord(firstTarget!);

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Partial Materialization Due Work Client',
  });
  const blockedCandidate = dueWork.invoiceCandidates.find((candidate) =>
    candidate.clientName === 'Partial Materialization Due Work Client'
    && normalizeDateValue(candidate.windowStart) === currentPeriodStart
    && normalizeDateValue(candidate.windowEnd) === nextPeriodStart,
  );

  expect(blockedCandidate).toBeTruthy();
  expect(blockedCandidate?.canGenerate).toBe(false);
  expect(blockedCandidate?.blockedReason).toContain('partially materialized');
  expect(dueWork.materializationGaps.length).toBeGreaterThan(0);
  expect(
    dueWork.materializationGaps.every((gap) => gap.reason === 'missing_service_period_materialization'),
  ).toBe(true);
  expect(
    dueWork.materializationGaps.some((gap) => gap.clientName === 'Partial Materialization Due Work Client'),
  ).toBe(true);
}, HOOK_TIMEOUT);

it('T104: generation blocks partially materialized client-cadence windows when eligible recurring selections are missing', async () => {
  setupCommonMocks({ tenantId, userId: 'partial-materialization-generate-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Partial Materialization Generate Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const firstLine = await createFixedContractLine(contextLike, {
    serviceName: 'Partial Generate Service A',
    planName: 'Partial Generate Plan A',
    baseRateCents: 176,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  const secondLine = await createFixedContractLine(contextLike, {
    serviceName: 'Partial Generate Service B',
    planName: 'Partial Generate Plan B',
    baseRateCents: 186,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const firstPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-20T14:10:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: firstLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${firstLine.contractLineId}:v1`,
    sourceRunKey: 'integration-partial-generate-a',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const secondPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-20T14:15:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: secondLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${secondLine.contractLineId}:v1`,
    sourceRunKey: 'integration-partial-generate-b',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  const firstTarget = firstPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  const secondTarget = secondPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  expect(firstTarget).toBeTruthy();
  expect(secondTarget).toBeTruthy();
  await upsertRecurringServicePeriodRecord(firstTarget!);

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Partial Materialization Generate Client',
  });
  const blockedMember = dueWork.invoiceCandidates
    .flatMap((candidate) => candidate.members)
    .find((row) =>
      row.clientName === 'Partial Materialization Generate Client'
      && normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart
      && normalizeDateValue(row.invoiceWindowEnd) === nextPeriodStart,
    );

  expect(blockedMember).toBeTruthy();

  await expect(
    generateInvoiceForSelectionInput(blockedMember!.selectorInput),
  ).resolves.toEqual({
    actionError:
      "Service periods haven't been generated for this billing window yet. Use Fix all on the Automatic Invoices page, or check Billing > Service Periods, then preview again.",
    messageKey: 'msp/invoicing:manualInvoices.errors.RECURRING_PERIODS_NOT_MATERIALIZED',
  });
}, HOOK_TIMEOUT);

it('T033/T078: reversing a client-cadence recurring invoice repairs service-period linkage without mutating a billing-cycle primary object', async () => {
  setupCommonMocks({ tenantId, userId: 'client-reverse-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Client Reverse Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Client Reverse Service',
    planName: 'Client Reverse Plan',
    baseRateCents: 201,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:50:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-client-reverse',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const generatedInvoice = await generateInvoice(cycleId);
  expect(generatedInvoice).toBeTruthy();

  await reverseRecurringInvoiceAction({
    invoiceId: generatedInvoice!.invoice_id,
    billingCycleId: cycleId,
  });

  const reopenedRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: materializationPlan.records[0].recordId })
    .first(['lifecycle_state', 'invoice_id', 'invoice_charge_id', 'invoice_charge_detail_id']);
  expect(reopenedRow).toMatchObject({
    lifecycle_state: 'locked',
    invoice_id: null,
    invoice_charge_id: null,
    invoice_charge_detail_id: null,
  });

  const billingCycle = await tenantTable(db, tenantId, 'client_billing_cycles')
    .where({ tenant: tenantId, billing_cycle_id: cycleId })
    .first(['billing_cycle_id', 'is_active']);
  expect(billingCycle?.billing_cycle_id).toBe(cycleId);
  expect(Boolean(billingCycle?.is_active)).toBe(true);
}, HOOK_TIMEOUT);

it('T034/T079: reversing a contract-cadence recurring invoice repairs service-period linkage and removes the invoice from recurring history', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-reverse-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Reverse Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-03-12',
    currentPeriodStart: '2025-04-12',
    nextPeriodStart: '2025-05-12',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Reverse Service',
    planName: 'Contract Reverse Plan',
    baseRateCents: 245,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const materializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T18:55:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-reverse',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });
  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();

  await reverseRecurringInvoiceAction({
    invoiceId: generatedInvoice!.invoice_id,
    billingCycleId: null,
  });

  const reopenedRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: materializationPlan.records[0].recordId })
    .first(['lifecycle_state', 'invoice_id']);
  expect(reopenedRow).toMatchObject({
    lifecycle_state: 'locked',
    invoice_id: null,
  });
}, HOOK_TIMEOUT);

it('T085: hard-deleting recurring invoices reopens linked service periods without mutating client billing-cycle records', async () => {
  setupCommonMocks({ tenantId, userId: 'mixed-delete-user', permissionCheck: () => true });

  const clientSetup = await createClientWithRecurringCycles({
    clientName: 'Client Hard Delete Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const clientFixedLine = await createFixedContractLine(clientSetup.contextLike, {
    serviceName: 'Client Hard Delete Service',
    planName: 'Client Hard Delete Plan',
    baseRateCents: 205,
    startDate: clientSetup.currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const clientMaterializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${clientSetup.currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T19:00:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: clientFixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${clientFixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-client-hard-delete',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(clientMaterializationPlan.records[0]);

  const clientInvoice = await generateInvoice(clientSetup.cycleId);
  expect(clientInvoice).toBeTruthy();

  await hardDeleteRecurringInvoiceAction({
    invoiceId: clientInvoice!.invoice_id,
    billingCycleId: clientSetup.cycleId,
  });

  const preservedBillingCycle = await tenantTable(db, tenantId, 'client_billing_cycles')
    .where({ tenant: tenantId, billing_cycle_id: clientSetup.cycleId })
    .first(['billing_cycle_id', 'is_active']);
  expect(preservedBillingCycle).toMatchObject({
    billing_cycle_id: clientSetup.cycleId,
    is_active: true,
  });

  const reopenedClientRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: clientMaterializationPlan.records[0].recordId })
    .first(['lifecycle_state', 'invoice_id']);
  expect(reopenedClientRow).toMatchObject({
    lifecycle_state: 'locked',
    invoice_id: null,
  });

  const contractSetup = await createClientWithRecurringCycles({
    clientName: 'Contract Hard Delete Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-03-12',
    currentPeriodStart: '2025-04-12',
    nextPeriodStart: '2025-05-12',
  });

  const contractFixedLine = await createFixedContractLine(contractSetup.contextLike, {
    serviceName: 'Contract Hard Delete Service',
    planName: 'Contract Hard Delete Plan',
    baseRateCents: 247,
    startDate: contractSetup.currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const contractMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${contractSetup.currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T19:05:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${contractSetup.currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: contractFixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${contractFixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-hard-delete',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(contractMaterializationPlan.records[0]);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contractSetup.contextLike.clientId,
    contractId: contractFixedLine.contractId,
    contractLineId: contractFixedLine.contractLineId,
    windowStart: `${contractSetup.currentPeriodStart}T00:00:00Z`,
    windowEnd: `${contractSetup.nextPeriodStart}T00:00:00Z`,
  });
  const contractInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(contractInvoice).toBeTruthy();

  await hardDeleteRecurringInvoiceAction({
    invoiceId: contractInvoice!.invoice_id,
    billingCycleId: null,
  });

  const reopenedContractRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: contractMaterializationPlan.records[0].recordId })
    .first(['lifecycle_state', 'invoice_id']);
  expect(reopenedContractRow).toMatchObject({
    lifecycle_state: 'locked',
    invoice_id: null,
  });
}, HOOK_TIMEOUT);

it('T017/T019/T050/T077/T080/T084: recurring contract-cadence preview, generation, and history stay bridge-free end to end', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-happy-path-user', permissionCheck: () => true });

  const {
    contextLike,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Happy Path Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });
  const contractPeriodStart = '2025-02-08';
  const contractNextPeriodStart = '2025-03-08';
  const contractPeriodEnd = Temporal.PlainDate.from(contractNextPeriodStart).subtract({ days: 1 }).toString();

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Happy Path Service',
    planName: 'Contract Happy Path Plan',
    baseRateCents: 214,
    startDate: contractPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const materializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${contractPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T20:10:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${contractPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-happy-path',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: contractPeriodStart,
    windowEnd: contractNextPeriodStart,
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Contract Happy Path Client',
  });
  const dueRows = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const dueRow = dueRows.find((row) =>
    row.clientName === 'Contract Happy Path Client'
    && row.cadenceSource === 'contract_anniversary'
    && normalizeDateValue(row.invoiceWindowStart) === contractPeriodStart
    && normalizeDateValue(row.invoiceWindowEnd) === contractNextPeriodStart,
  );

  expect(dueRow).toMatchObject({
    clientName: 'Contract Happy Path Client',
    billingCycleId: null,
    cadenceSource: 'contract_anniversary',
    executionWindowKind: 'contract_cadence_window',
    servicePeriodStart: contractPeriodStart,
    servicePeriodEnd: contractNextPeriodStart,
    invoiceWindowStart: contractPeriodStart,
    invoiceWindowEnd: contractNextPeriodStart,
  });
  expect(dueRow?.executionIdentityKey).toBe(selectorInput.executionWindow.identityKey);

  const preview = await previewInvoiceForSelectionInputAction(dueRow!.selectorInput);
  expect(preview).toMatchObject({ success: true });
  expect(preview.data?.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        description: 'Contract Happy Path Service',
        servicePeriodStart: contractPeriodStart,
        servicePeriodEnd: contractPeriodEnd,
        billingTiming: 'advance',
      }),
    ]),
  );

  const generatedInvoice = await generateInvoiceForSelectionInput(dueRow!.selectorInput);
  expect(generatedInvoice).toMatchObject({
    billing_cycle_id: null,
  });

  const history = await getInvoicedBillingCyclesPaginatedAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Contract Happy Path Client',
  });
  const historyRow = history.cycles.find((row) => row.invoiceId === generatedInvoice!.invoice_id);
  expect(historyRow).toMatchObject({
    invoiceId: generatedInvoice!.invoice_id,
    billingCycleId: null,
    cadenceSource: 'contract_anniversary',
    executionWindowKind: 'contract_cadence_window',
  });
  expect(normalizeDateValue(historyRow?.servicePeriodStart)).toBe(contractPeriodStart);
  expect(normalizeDateValue(historyRow?.servicePeriodEnd)).toBe(contractNextPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowStart)).toBe(contractPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowEnd)).toBe(contractNextPeriodStart);
}, HOOK_TIMEOUT);

it('T345: invoicing a second contract-cadence contract in the same window does not rebill the first contract or block the second', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-sequential-same-window-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Sequential Same Window Contract Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const firstLine = await createFixedContractLine(contextLike, {
    serviceName: 'Sequential Window Contract Service A',
    planName: 'Sequential Window Contract Plan A',
    baseRateCents: 121,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const firstMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T20:30:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: firstLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${firstLine.contractLineId}:v1`,
    sourceRunKey: 'integration-sequential-contract-a',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const firstTargetRecord = firstMaterializationPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  expect(firstTargetRecord).toBeTruthy();
  await upsertRecurringServicePeriodRecord(firstTargetRecord!);

  const firstDueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Sequential Same Window Contract Client',
  });
  const firstDueRows = firstDueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const firstDueRow = firstDueRows.find((row) =>
    row.clientName === 'Sequential Same Window Contract Client'
    && row.cadenceSource === 'contract_anniversary'
    && row.contractLineId === firstLine.contractLineId
    && normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart
    && normalizeDateValue(row.invoiceWindowEnd) === nextPeriodStart,
  );
  expect(firstDueRow).toBeTruthy();

  const firstInvoice = await generateInvoiceForSelectionInput(firstDueRow!.selectorInput);
  expect(firstInvoice).toBeTruthy();

  const secondLine = await createFixedContractLine(contextLike, {
    serviceName: 'Sequential Window Contract Service B',
    planName: 'Sequential Window Contract Plan B',
    baseRateCents: 177,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const secondMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T20:35:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${currentPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: secondLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${secondLine.contractLineId}:v1`,
    sourceRunKey: 'integration-sequential-contract-b',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const secondTargetRecord = secondMaterializationPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === nextPeriodStart,
  );
  expect(secondTargetRecord).toBeTruthy();
  await upsertRecurringServicePeriodRecord(secondTargetRecord!);

  const secondDueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Sequential Same Window Contract Client',
  });
  const secondDueRows = secondDueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const secondDueRow = secondDueRows.find((row) =>
    row.clientName === 'Sequential Same Window Contract Client'
    && row.cadenceSource === 'contract_anniversary'
    && row.contractLineId === secondLine.contractLineId
    && normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart
    && normalizeDateValue(row.invoiceWindowEnd) === nextPeriodStart,
  );
  expect(secondDueRow).toBeTruthy();
  expect(
    secondDueRows.some((row) =>
      row.contractLineId === firstLine.contractLineId
      && normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart
      && normalizeDateValue(row.invoiceWindowEnd) === nextPeriodStart,
    ),
  ).toBe(false);

  const secondInvoice = await generateInvoiceForSelectionInput(secondDueRow!.selectorInput);
  expect(secondInvoice).toBeTruthy();
  expect(secondInvoice!.invoice_id).not.toBe(firstInvoice!.invoice_id);

  const firstInvoiceCharges = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ tenant: tenantId, invoice_id: firstInvoice!.invoice_id })
    .select(['description']);
  const secondInvoiceCharges = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ tenant: tenantId, invoice_id: secondInvoice!.invoice_id })
    .select(['description']);

  // Consolidated fixed-plan parents are labeled with the contract-line (plan)
  // name (invoiceService persistFixedInvoiceCharges); the renderer shows this
  // to customers. Plan names differ per line, so isolation is still proven.
  expect(firstInvoiceCharges.map((row) => row.description)).toContain('Sequential Window Contract Plan A');
  expect(firstInvoiceCharges.map((row) => row.description)).not.toContain('Sequential Window Contract Plan B');
  expect(secondInvoiceCharges.map((row) => row.description)).toContain('Sequential Window Contract Plan B');
  expect(secondInvoiceCharges.map((row) => row.description)).not.toContain('Sequential Window Contract Plan A');

  const billedFirstRecord = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: firstTargetRecord!.recordId })
    .first(['lifecycle_state', 'invoice_id', 'invoice_charge_detail_id']);
  expect(billedFirstRecord).toMatchObject({
    lifecycle_state: 'billed',
    invoice_id: firstInvoice!.invoice_id,
  });
  expect(billedFirstRecord?.invoice_charge_detail_id ?? null).not.toBeNull();

  const billedSecondRecord = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: secondTargetRecord!.recordId })
    .first(['lifecycle_state', 'invoice_id', 'invoice_charge_detail_id']);
  expect(billedSecondRecord).toMatchObject({
    lifecycle_state: 'billed',
    invoice_id: secondInvoice!.invoice_id,
  });
  expect(billedSecondRecord?.invoice_charge_detail_id ?? null).not.toBeNull();
}, HOOK_TIMEOUT);

it('T016/T018/T049/T076/T080/T087: recurring client-cadence preview, generation, and history remain functional through service periods with null billing_cycle_id', async () => {
  setupCommonMocks({ tenantId, userId: 'client-happy-path-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Client Happy Path Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const happyPathLine = await createFixedContractLine(contextLike, {
    serviceName: 'Client Happy Path Service',
    planName: 'Client Happy Path Plan',
    baseRateCents: 198,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  await syncContractLineRecurringPeriods(happyPathLine.contractLineId);

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Client Happy Path Reader',
    dateRange: {
      from: currentPeriodStart,
      to: nextPeriodStart,
    },
  });
  const dueRows = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const dueRow = dueRows.find((row) =>
    row.clientName === 'Client Happy Path Reader'
    && row.executionWindowKind === 'client_cadence_window'
    && normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart
    && normalizeDateValue(row.invoiceWindowEnd) === nextPeriodStart,
  );

  expect(dueRow).toMatchObject({
    clientName: 'Client Happy Path Reader',
    cadenceSource: 'client_schedule',
    executionWindowKind: 'client_cadence_window',
    servicePeriodStart: currentPeriodStart,
    servicePeriodEnd: nextPeriodStart,
    invoiceWindowStart: currentPeriodStart,
    invoiceWindowEnd: nextPeriodStart,
  });

  const preview = await previewInvoiceForSelectionInputAction(dueRow!.selectorInput);
  expect(preview).toMatchObject({ success: true });
  expect(preview.data?.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        description: 'Client Happy Path Service',
        servicePeriodStart: currentPeriodStart,
        servicePeriodEnd: currentPeriodEnd,
        billingTiming: 'advance',
      }),
    ]),
  );

  const clientGenerateQueries: string[] = [];
  const onClientGenerateQuery = (queryData: { sql?: string }) => {
    if (typeof queryData.sql === 'string') {
      clientGenerateQueries.push(queryData.sql);
    }
  };
  db.on('query', onClientGenerateQuery);
  const generatedInvoice = await generateInvoiceForSelectionInput(dueRow!.selectorInput);
  db.removeListener('query', onClientGenerateQuery);
  expect(generatedInvoice).toMatchObject({
    billing_cycle_id: null,
  });
  expect(clientGenerateQueries.some((sql) => /client_billing_cycles/i.test(sql))).toBe(false);

  const history = await getInvoicedBillingCyclesPaginatedAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Client Happy Path Reader',
  });
  const historyRow = history.cycles.find((row) => row.invoiceId === generatedInvoice!.invoice_id);
  expect(historyRow).toMatchObject({
    invoiceId: generatedInvoice!.invoice_id,
    billingCycleId: null,
    cadenceSource: 'client_schedule',
    executionWindowKind: 'client_cadence_window',
  });
  expect(normalizeDateValue(historyRow?.servicePeriodStart)).toBe(currentPeriodStart);
  // History sources periods from recurring_service_periods, which stores
  // half-open ranges (semantics: 'half_open'), so the end is exclusive —
  // consistent with the due-row assertion above and the other history tests.
  expect(normalizeDateValue(historyRow?.servicePeriodEnd)).toBe(nextPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowStart)).toBe(currentPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowEnd)).toBe(nextPeriodStart);
}, HOOK_TIMEOUT);

  describe('alga0002072: periods persisted under the legacy contract_line label', () => {
    const collapse = createRequire(import.meta.url)(
      '../../../migrations/20261010120000_collapse_recurring_service_period_obligation_type.cjs',
    );

    async function seedLegacyShapedClientLine(clientName: string, userId: string) {
      setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
      const { contextLike, currentPeriodStart, nextPeriodStart } = await createClientWithRecurringCycles({
        clientName,
        billingCycle: 'monthly',
        previousPeriodStart: '2024-12-01',
        currentPeriodStart: '2025-01-01',
        nextPeriodStart: '2025-02-01',
      });
      const line = await createFixedContractLine(contextLike, {
        serviceName: `${clientName} Service`,
        planName: `${clientName} Plan`,
        baseRateCents: 211,
        startDate: currentPeriodStart,
        billingTiming: 'advance',
        billingFrequency: 'monthly',
        cadenceOwner: 'client',
      });
      await syncContractLineRecurringPeriods(line.contractLineId);
      return { line, currentPeriodStart, nextPeriodStart };
    }

    const canonicalKey = (lineId: string) => `schedule:${tenantId}:${lineId}:client:advance`;
    const legacyKey = (lineId: string) => `schedule:${tenantId}:contract_line:${lineId}:client:advance`;

    async function dueRowsFor(clientName: string, lineId: string, from: string, to: string) {
      const dueWork = await getAvailableRecurringDueWorkAction({
        page: 1, pageSize: 20, searchTerm: clientName, dateRange: { from, to },
      });
      return dueWork.invoiceCandidates.flatMap((candidate) => candidate.members)
        .filter((row) => row.scheduleKey === canonicalKey(lineId));
    }

    it('regression: a client-cadence period persisted as contract_line is selected, invoiced and linked exactly once after collapse', async () => {
      const clientName = 'Legacy Label Regression Client';
      const { line, currentPeriodStart, nextPeriodStart } = await seedLegacyShapedClientLine(clientName, 'legacy-label-user');

      // Pre-migration shape: legacy 6-segment key (the obligation_type column no longer exists in the
      // test schema, so the key is the only label carrier). Then run the migration's per-tenant rewrite.
      await tenantTable(db, tenantId, 'recurring_service_periods')
        .where({ tenant: tenantId, obligation_id: line.contractLineId })
        .update({ schedule_key: legacyKey(line.contractLineId) });
      const summary = await collapse.collapseTenant(db, tenantId, { log: () => undefined });
      expect(summary.rewritten).toBeGreaterThan(0);

      const rows = await tenantTable(db, tenantId, 'recurring_service_periods')
        .where({ tenant: tenantId, obligation_id: line.contractLineId });
      expect(rows.every((row) => row.schedule_key === canonicalKey(line.contractLineId))).toBe(true);

      // selected exactly once, under the canonical key
      const windowRows = (await dueRowsFor(clientName, line.contractLineId, currentPeriodStart, nextPeriodStart))
        .filter((row) => normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart);
      expect(windowRows).toHaveLength(1);
      expect(windowRows[0].scheduleKey).toBe(canonicalKey(line.contractLineId));
      const dueRecord = rows.find((row) => normalizeDateValue(row.invoice_window_start) === currentPeriodStart
        && row.lifecycle_state !== 'superseded')!;

      // invoiced and linked exactly once
      const invoice = await generateInvoiceForSelectionInput(windowRows[0].selectorInput);
      expect(invoice).toBeTruthy();
      expect((invoice as any).actionError).toBeUndefined();
      const countDetails = async () => Number((await db('invoice_charge_details as d')
        .join('invoice_charges as c', function joinCharges() { this.on('c.item_id', 'd.item_id').andOn('c.tenant', 'd.tenant'); })
        .where({ 'c.tenant': tenantId, 'c.invoice_id': invoice!.invoice_id })
        .count('* as n').first())!.n);
      expect(await countDetails()).toBe(1);
      const linked = await tenantTable(db, tenantId, 'recurring_service_periods')
        .where({ tenant: tenantId, record_id: dueRecord.record_id })
        .first(['lifecycle_state', 'invoice_id', 'invoice_charge_detail_id']);
      expect(linked).toMatchObject({ lifecycle_state: 'billed', invoice_id: invoice!.invoice_id });
      expect(linked!.invoice_charge_detail_id).toBeTruthy();
      const detail = await db('invoice_charge_details')
        .where({ tenant: tenantId, item_detail_id: linked!.invoice_charge_detail_id }).first();
      expect(detail).toBeTruthy();

      // the second generate hits the duplicate guard and creates nothing
      const second = await generateInvoiceForSelectionInput(windowRows[0].selectorInput);
      expect((second as any).actionError).toMatch(/already exists for this recurring execution window/);
      expect(await countDetails()).toBe(1);
      const client = await db('clients').where({ tenant: tenantId, client_name: clientName }).first();
      const invoiceCount = await db('invoices').where({ tenant: tenantId, client_id: client.client_id }).count('* as n').first();
      expect(Number(invoiceCount!.n)).toBe(1);

      expect(await isPeriodAlreadyInvoiced(db, tenantId, line.contractLineId,
        { start: currentPeriodStart, end: nextPeriodStart })).toBe(true);
    }, HOOK_TIMEOUT);

    it('regression (collision): with both labels present the superseded loser is never selected as due', async () => {
      const clientName = 'Legacy Label Collision Client';
      const { line, currentPeriodStart, nextPeriodStart } = await seedLegacyShapedClientLine(clientName, 'legacy-collision-user');
      const canonicalRow = await tenantTable(db, tenantId, 'recurring_service_periods')
        .where({ tenant: tenantId, obligation_id: line.contractLineId })
        .whereRaw('invoice_window_start = ?', [currentPeriodStart])
        .first();
      expect(canonicalRow).toBeTruthy();

      // An unbilled twin written under the contract_line label for the same period.
      const loserId = uuidv4();
      const { created_at: _c, updated_at: _u, ...twin } = canonicalRow;
      await tenantTable(db, tenantId, 'recurring_service_periods').insert({
        ...twin, record_id: loserId, schedule_key: legacyKey(line.contractLineId), revision: 1,
      });

      const summary = await collapse.collapseTenant(db, tenantId, { log: () => undefined });
      expect(summary.collisionGroups).toBeGreaterThanOrEqual(1);
      // Both twins are identical in state/label/time, so the deterministic tiebreak (smallest record_id) picks
      // the winner; exactly one of the pair must lose and carry the collapse reason.
      const pair = await tenantTable(db, tenantId, 'recurring_service_periods')
        .whereIn('record_id', [loserId, canonicalRow.record_id]);
      const superseded = pair.filter((row) => row.lifecycle_state === 'superseded');
      expect(superseded).toHaveLength(1);
      expect(superseded[0].reason_code).toBe('obligation_label_collapse');
      expect(pair.map((row) => row.schedule_key)).toEqual([canonicalKey(line.contractLineId), canonicalKey(line.contractLineId)]);
      const live = await tenantTable(db, tenantId, 'recurring_service_periods')
        .where({ tenant: tenantId, obligation_id: line.contractLineId })
        .whereNot({ lifecycle_state: 'superseded' })
        .whereRaw('invoice_window_start = ?', [currentPeriodStart]);
      expect(live).toHaveLength(1);

      const dueRows = (await dueRowsFor(clientName, line.contractLineId, currentPeriodStart, nextPeriodStart))
        .filter((row) => normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart);
      expect(dueRows).toHaveLength(1);
      expect(dueRows[0].scheduleKey).toBe(canonicalKey(line.contractLineId));
    }, HOOK_TIMEOUT);
  });

it('T108: recurring due-work assertions validate candidate-level contracts directly without flattening invoiceCandidates members', async () => {
  setupCommonMocks({ tenantId, userId: 'candidate-contract-assertions-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Candidate Contract Assertions Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Candidate Contract Assertions Service',
    planName: 'Candidate Contract Assertions Plan',
    baseRateCents: 203,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-20T14:00:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-candidate-contract-assertions',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Candidate Contract Assertions Client',
  });

  const candidate = dueWork.invoiceCandidates.find((invoiceCandidate) =>
    (invoiceCandidate.clientName ?? '').includes('Candidate Contract Assertions Client')
    && invoiceCandidate.members.some((member) => (
      (member.clientName ?? '').includes('Candidate Contract Assertions Client')
      && normalizeDateValue(member.invoiceWindowStart) === currentPeriodStart
      && normalizeDateValue(member.invoiceWindowEnd) === nextPeriodStart
    )),
  );

  expect(candidate).toBeTruthy();
  expect(candidate).toMatchObject({
    memberCount: 1,
    cadenceOwners: ['client'],
    cadenceSources: ['client_schedule'],
    windowStart: currentPeriodStart,
    windowEnd: nextPeriodStart,
  });
  expect(typeof candidate?.canGenerate).toBe('boolean');
  expect(candidate?.members).toHaveLength(1);
  expect(candidate?.members[0]).toMatchObject({
    clientName: 'Candidate Contract Assertions Client',
    executionWindowKind: 'client_cadence_window',
    invoiceWindowStart: currentPeriodStart,
    invoiceWindowEnd: nextPeriodStart,
  });
}, HOOK_TIMEOUT);

it('T080: mixed batch generation from AutomaticInvoices discovers and generates both cadence owners from canonical selector input without requiring billing_cycle_id', async () => {
  setupCommonMocks({ tenantId, userId: 'mixed-batch-happy-user', permissionCheck: () => true });

  const clientSetup = await createClientWithRecurringCycles({
    clientName: 'Mixed Batch Client Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });
  const clientLine = await createFixedContractLine(clientSetup.contextLike, {
    serviceName: 'Mixed Batch Client Service',
    planName: 'Mixed Batch Client Plan',
    baseRateCents: 162,
    startDate: clientSetup.currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  const clientMaterializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${clientSetup.currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T20:12:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: clientLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${clientLine.contractLineId}:v1`,
    sourceRunKey: 'integration-mixed-batch-client',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const clientTargetRecord = clientMaterializationPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === clientSetup.currentPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === clientSetup.nextPeriodStart,
  );
  expect(clientTargetRecord).toBeTruthy();
  await upsertRecurringServicePeriodRecord(clientTargetRecord!);

  const contractSetup = await createClientWithRecurringCycles({
    clientName: 'Mixed Batch Contract Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const contractPeriodStart = '2025-02-08';
  const contractNextPeriodStart = '2025-03-08';
  const contractLine = await createFixedContractLine(contractSetup.contextLike, {
    serviceName: 'Mixed Batch Contract Service',
    planName: 'Mixed Batch Contract Plan',
    baseRateCents: 236,
    startDate: contractPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  const contractMaterializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${contractPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T20:15:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${contractPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: contractLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${contractLine.contractLineId}:v1`,
    sourceRunKey: 'integration-mixed-batch-contract',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const contractTargetRecord = contractMaterializationPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === contractPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === contractNextPeriodStart,
  );
  expect(contractTargetRecord).toBeTruthy();
  await upsertRecurringServicePeriodRecord(contractTargetRecord!);

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Mixed Batch',
  });
  const dueRows = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const clientRow = dueRows.find((row) => row.clientName === 'Mixed Batch Client Reader');
  const contractRow = dueRows.find((row) =>
    row.clientName === 'Mixed Batch Contract Client'
    && row.cadenceSource === 'contract_anniversary'
    && normalizeDateValue(row.invoiceWindowStart) === contractPeriodStart
    && normalizeDateValue(row.invoiceWindowEnd) === contractNextPeriodStart,
  );

  expect(clientRow?.executionWindowKind).toBe('client_cadence_window');
  expect(contractRow?.billingCycleId ?? null).toBeNull();

  const [clientInvoice, contractInvoice] = await Promise.all([
    generateInvoiceForSelectionInput(clientRow!.selectorInput),
    generateInvoiceForSelectionInput(contractRow!.selectorInput),
  ]);

  expect(clientInvoice).toBeTruthy();
  expect(contractInvoice).toBeTruthy();

  const history = await getInvoicedBillingCyclesPaginatedAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Mixed Batch',
  });
  expect(history.cycles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        invoiceId: clientInvoice!.invoice_id,
        cadenceSource: 'client_schedule',
        executionWindowKind: 'client_cadence_window',
      }),
      expect.objectContaining({
        invoiceId: contractInvoice!.invoice_id,
        cadenceSource: 'contract_anniversary',
        executionWindowKind: 'contract_cadence_window',
      }),
    ]),
  );
}, HOOK_TIMEOUT);

it('T079: deleting a contract-cadence recurring invoice makes the same execution window reappear in due-work selection for reissue', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-delete-reappear-user', permissionCheck: () => true });

  const {
    contextLike,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Delete Reappear Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-03-01',
    currentPeriodStart: '2025-04-01',
    nextPeriodStart: '2025-05-01',
  });
  const contractPeriodStart = '2025-04-12';
  const contractNextPeriodStart = '2025-05-12';

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Delete Reappear Service',
    planName: 'Contract Delete Reappear Plan',
    baseRateCents: 243,
    startDate: contractPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const materializationPlan = materializeContractCadenceServicePeriods({
    asOf: `${contractPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T20:20:00.000Z',
    billingCycle: 'monthly',
    anchorDate: `${contractPeriodStart}T00:00:00Z`,
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-delete-reappear',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  const targetRecord = materializationPlan.records.find((record) =>
    normalizeDateValue(record.invoiceWindow.start) === contractPeriodStart
    && normalizeDateValue(record.invoiceWindow.end) === contractNextPeriodStart,
  );
  expect(targetRecord).toBeTruthy();
  await upsertRecurringServicePeriodRecord(targetRecord!);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: contractPeriodStart,
    windowEnd: contractNextPeriodStart,
  });
  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);

  await hardDeleteRecurringInvoiceAction({
    invoiceId: generatedInvoice!.invoice_id,
    billingCycleId: null,
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Contract Delete Reappear Client',
  });
  const dueRows = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const reopenedRow = dueRows.find((row) =>
    row.clientName === 'Contract Delete Reappear Client'
    && row.cadenceSource === 'contract_anniversary'
    && normalizeDateValue(row.invoiceWindowStart) === contractPeriodStart
    && normalizeDateValue(row.invoiceWindowEnd) === contractNextPeriodStart,
  );

  expect(reopenedRow).toMatchObject({
    clientName: 'Contract Delete Reappear Client',
    billingCycleId: null,
    executionIdentityKey: selectorInput.executionWindow.identityKey,
  });
}, HOOK_TIMEOUT);

it('T078: reversing a client-cadence recurring invoice restores due selection by canonical execution window for reissue', async () => {
  setupCommonMocks({ tenantId, userId: 'client-reverse-reappear-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Client Reverse Reappear Reader',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Client Reverse Reappear Service',
    planName: 'Client Reverse Reappear Plan',
    baseRateCents: 207,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T20:25:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-client-reverse-reappear',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  await upsertRecurringServicePeriodRecord(materializationPlan.records[0]);

  const selectorInput = buildClientCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    scheduleKey: materializationPlan.scheduleKey,
    periodKey: materializationPlan.records[0].periodKey,
    windowStart: currentPeriodStart,
    windowEnd: nextPeriodStart,
  });
  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  await reverseRecurringInvoiceAction({
    invoiceId: generatedInvoice!.invoice_id,
    billingCycleId: null,
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Client Reverse Reappear Reader',
  });
  const dueRows = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const reopenedRow = dueRows.find((row) =>
    row.clientName === 'Client Reverse Reappear Reader'
    && row.executionWindowKind === 'client_cadence_window'
    && normalizeDateValue(row.invoiceWindowStart) === currentPeriodStart
    && normalizeDateValue(row.invoiceWindowEnd) === nextPeriodStart,
  );

  expect(reopenedRow).toMatchObject({
    clientName: 'Client Reverse Reappear Reader',
    cadenceSource: 'client_schedule',
    executionWindowKind: 'client_cadence_window',
    invoiceWindowStart: currentPeriodStart,
  });
  expect(normalizeDateValue(reopenedRow?.invoiceWindowEnd)).toBe(nextPeriodStart);
}, HOOK_TIMEOUT);

it('T276: DB-backed monthly contract-cadence scheduling, grouping, invoice generation, and hydration stay coherent for an 8th-anchored line', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-cadence-monthly-hydration-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Cadence Monthly Hydration Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2025-01-08',
    currentPeriodStart: '2025-02-08',
    nextPeriodStart: '2025-03-08',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Cadence Monthly Hydration Service',
    planName: 'Contract Cadence Monthly Hydration Plan',
    baseRateCents: 240,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(fixedLine.contractLineId);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });

  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();

  const persistedInvoices = await tenantTable(db, tenantId, 'invoices')
    .where({ tenant: tenantId, client_id: contextLike.clientId })
    .andWhere('billing_period_start', currentPeriodStart)
    .andWhere('billing_period_end', nextPeriodStart)
    .select(['invoice_id']);
  expect(persistedInvoices).toHaveLength(1);

  const persistedInvoice = await getPersistedInvoice(generatedInvoice!.invoice_id);
  expect(normalizeDateValue(persistedInvoice?.billing_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(persistedInvoice?.billing_period_end)).toBe(nextPeriodStart);

  const rereadInvoice = await Invoice.getFullInvoiceById(db, tenantId, generatedInvoice!.invoice_id);
  expect(rereadInvoice?.invoice_charges).toHaveLength(1);

  const recurringCharge = rereadInvoice?.invoice_charges?.[0];
  expect(normalizeDateValue(recurringCharge?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(recurringCharge?.service_period_end)).toBe(currentPeriodEnd);
  expect(recurringCharge?.recurring_detail_periods?.map((period) => ({
    service_period_start: normalizeDateValue(period.service_period_start),
    service_period_end: normalizeDateValue(period.service_period_end),
    billing_timing: period.billing_timing,
  }))).toEqual([
    {
      service_period_start: currentPeriodStart,
      service_period_end: currentPeriodEnd,
      billing_timing: 'advance',
    },
  ]);
}, HOOK_TIMEOUT);

it('T277: DB-backed annual contract-cadence scheduling, invoice generation, and hydration stay coherent on a contract-owned execution window', async () => {
  setupCommonMocks({ tenantId, userId: 'contract-cadence-annual-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Contract Cadence Annual Client',
    billingCycle: 'annually',
    previousPeriodStart: '2024-03-08',
    currentPeriodStart: '2025-03-08',
    nextPeriodStart: '2026-03-08',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Contract Cadence Annual Service',
    planName: 'Contract Cadence Annual Plan',
    baseRateCents: 960,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'annually',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(fixedLine.contractLineId);

  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: contextLike.clientId,
    contractId: fixedLine.contractId,
    contractLineId: fixedLine.contractLineId,
    windowStart: `${currentPeriodStart}T00:00:00Z`,
    windowEnd: `${nextPeriodStart}T00:00:00Z`,
  });

  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();
  expect(generatedInvoice?.billing_cycle_id ?? null).toBeNull();

  const persistedInvoice = await getPersistedInvoice(generatedInvoice!.invoice_id);
  expect(normalizeDateValue(persistedInvoice?.billing_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(persistedInvoice?.billing_period_end)).toBe(nextPeriodStart);

  const rereadInvoice = await Invoice.getFullInvoiceById(db, tenantId, generatedInvoice!.invoice_id);
  expect(rereadInvoice?.invoice_charges).toHaveLength(1);

  const recurringCharge = rereadInvoice?.invoice_charges?.[0];
  expect(normalizeDateValue(recurringCharge?.service_period_start)).toBe(currentPeriodStart);
  expect(normalizeDateValue(recurringCharge?.service_period_end)).toBe(currentPeriodEnd);
  expect(recurringCharge?.recurring_detail_periods?.map((period) => ({
    service_period_start: normalizeDateValue(period.service_period_start),
    service_period_end: normalizeDateValue(period.service_period_end),
    billing_timing: period.billing_timing,
  }))).toEqual([
    {
      service_period_start: currentPeriodStart,
      service_period_end: currentPeriodEnd,
      billing_timing: 'advance',
    },
  ]);
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
    baseRateCents: 120,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const contractCadenceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Mixed Contract Cadence Service',
    planName: 'Mixed Contract Cadence Plan',
    baseRateCents: 180,
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
      // The engine resolves obligations by joining contract_lines on
      // obligation_id, so the live contract_line_id is the canonical id.
      obligationId: clientCadenceLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${clientCadenceLine.contractLineId}:v1`,
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
      // Contract-cadence rows are persisted with the live contract_line_id and
      // the 'contract_line' obligation type that the invoice engine queries.
      obligationId: contractCadenceLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${contractCadenceLine.contractLineId}:v1`,
    sourceRunKey: 'mixed-cadence-contract',
    targetHorizonDays: 32,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });

  await upsertRecurringServicePeriodRecord(clientPlan.records[0]);
  await upsertRecurringServicePeriodRecord(contractPlan.records[0]);

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();

  const persistedInvoices = await tenantTable(db, tenantId, 'invoices')
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

it('T264: generateInvoice to persistence to getFullInvoiceById round-trips canonical recurring detail periods correctly', async () => {
  setupCommonMocks({ tenantId, userId: 'invoice-roundtrip-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    currentPeriodEnd,
  } = await createClientWithRecurringCycles({
    clientName: 'Invoice Roundtrip Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Invoice Roundtrip Service',
    planName: 'Invoice Roundtrip Plan',
    baseRateCents: 175,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  await syncContractLineRecurringPeriods(fixedLine.contractLineId);

  const generatedInvoice = await generateInvoice(cycleId);
  expect(generatedInvoice).toBeTruthy();

  const rereadInvoice = await Invoice.getFullInvoiceById(db, tenantId, generatedInvoice!.invoice_id);
  const detailRows = await getInvoiceDetailRows(generatedInvoice!.invoice_id);
  const expectedPeriods = detailRows.map((row) => ({
      service_period_start: normalizeDateValue(row.service_period_start),
      service_period_end: normalizeDateValue(row.service_period_end),
      billing_timing: row.billing_timing,
    }));

  expect(expectedPeriods).toEqual([
    {
      service_period_start: currentPeriodStart,
      service_period_end: currentPeriodEnd,
      billing_timing: 'advance',
    },
  ]);

  for (const invoiceView of [generatedInvoice, rereadInvoice]) {
    expect(invoiceView?.invoice_charges).toHaveLength(1);
    const recurringCharge = invoiceView?.invoice_charges?.[0];
    expect(recurringCharge).toBeTruthy();
    expect(recurringCharge?.recurring_detail_periods?.map((period) => ({
      service_period_start: normalizeDateValue(period.service_period_start),
      service_period_end: normalizeDateValue(period.service_period_end),
      billing_timing: period.billing_timing,
    }))).toEqual(expectedPeriods);
    expect(normalizeDateValue(recurringCharge?.service_period_start)).toBe(currentPeriodStart);
    expect(normalizeDateValue(recurringCharge?.service_period_end)).toBe(currentPeriodEnd);
  }
}, HOOK_TIMEOUT);

it('T316/T323/T324/T327: DB-backed persisted service-period regeneration, billed immutability, and invoice-detail linkage remain coherent under staged rollout', async () => {
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
    baseRateCents: 195,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const sourceObligation = {
    tenant: tenantId,
    obligationId: fixedLine.clientContractLineId,
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

  const preInvoiceRows = await tenantTable(db, tenantId, 'recurring_service_periods')
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

  const dueLedgerRows = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({
      tenant: tenantId,
      obligation_id: fixedLine.clientContractLineId,
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

  const configRow = await tenantTable(db, tenantId, 'contract_line_service_configuration')
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

  const billedRow = await tenantTable(db, tenantId, 'recurring_service_periods')
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

  const linkedDetailRow = await tenantTable(db, tenantId, 'invoice_charge_details')
    .where({
      tenant: tenantId,
      item_detail_id: persistedInvoice.invoiceChargeDetailId,
    })
    .first([
      'item_detail_id',
      'service_period_start',
      'service_period_end',
      'billing_timing',
    ]);
  expect(linkedDetailRow).toMatchObject({
    item_detail_id: persistedInvoice.invoiceChargeDetailId,
    billing_timing: 'advance',
  });
  expect(normalizeDateValue(linkedDetailRow?.service_period_start)).toBe('2025-01-10');
  expect(normalizeDateValue(linkedDetailRow?.service_period_end)).toBe(currentPeriodEnd);

  const futureRow = await tenantTable(db, tenantId, 'recurring_service_periods')
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

  const remainingDueLedgerRows = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({
      tenant: tenantId,
      obligation_id: fixedLine.clientContractLineId,
    })
    .whereIn('lifecycle_state', ['generated', 'edited', 'locked'])
    .where('invoice_window_start', currentPeriodStart)
    .where('invoice_window_end', nextPeriodStart)
    .whereNull('invoice_charge_detail_id')
    .select('record_id');
  expect(remainingDueLedgerRows).toEqual([]);

  const immutableAttempt = applyRecurringServicePeriodEditRequest({
    record: linkedRecord,
    request: {
      recordId: linkedRecord.recordId,
      operation: 'defer',
      deferredInvoiceWindow: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: 'half_open',
      },
    },
    context: {
      editedAt: '2026-03-18T15:20:00.000Z',
      sourceRuleVersion: `${fixedLine.clientContractLineId}:v3`,
      sourceRunKey: 'integration-immutable-billed-ledger',
    },
    recordIdFactory: () => uuidv4(),
  });
  expect(immutableAttempt).toEqual({
    ok: false,
    operation: 'defer',
    recordId: linkedRecord.recordId,
    validationIssues: [
      {
        code: 'immutable_record',
        field: 'operation',
        message: 'Locked or billed service periods cannot be edited, skipped, deferred, or regenerated in place.',
      },
    ],
  });
}, HOOK_TIMEOUT);

it('T320/T301: DB-backed billing-staff inspection and edit flows list future client-cadence service periods and preserve edited provenance', async () => {
  setupCommonMocks({ tenantId, userId: 'ledger-operational-view-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Persisted Ledger Listing Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Ledger Listing Service',
    planName: 'Persisted Ledger Listing Plan',
    baseRateCents: 205,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T17:00:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-operational-view',
    targetHorizonDays: 95,
    replenishmentThresholdDays: 20,
    recordIdFactory: () => uuidv4(),
  });

  for (const record of materializationPlan.records.slice(0, 3)) {
    await upsertRecurringServicePeriodRecord(record);
  }

  const initialRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });
  const listingQuery = buildRecurringServicePeriodListingQuery({
    tenant: tenantId,
    asOf: `${currentPeriodStart}T00:00:00Z`,
    scheduleKeys: [materializationPlan.scheduleKey],
  });
  const initialView = buildRecurringServicePeriodOperationalView({
    records: initialRecords,
    query: listingQuery,
  });

  expect(initialView.summary).toMatchObject({
    totalRows: 3,
    generatedRows: 3,
    editedRows: 0,
    exceptionRows: 0,
  });

  const targetRecord = initialRecords[1];
  const editResponse = applyRecurringServicePeriodEditRequest({
    record: targetRecord,
    request: {
      recordId: targetRecord.recordId,
      operation: 'boundary_adjustment',
      updatedServicePeriod: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: 'half_open',
      },
      updatedInvoiceWindow: {
        start: '2025-02-05',
        end: '2025-03-05',
        semantics: 'half_open',
      },
    },
    context: {
      editedAt: '2026-03-18T17:05:00.000Z',
      sourceRuleVersion: `${fixedLine.contractLineId}:v2`,
      sourceRunKey: 'integration-operational-view-edit',
    },
    siblingRecords: initialRecords,
    recordIdFactory: () => uuidv4(),
  });

  expect(editResponse.ok).toBe(true);
  if (!editResponse.ok) {
    throw new Error('Expected persisted edit request to succeed');
  }

  await upsertRecurringServicePeriodRecord(editResponse.supersededRecord);
  await upsertRecurringServicePeriodRecord(editResponse.editedRecord);

  const editedRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });
  const editedView = buildRecurringServicePeriodOperationalView({
    records: editedRecords,
    query: listingQuery,
  });
  const editedRow = editedView.rows.find((row) => row.recordId === editResponse.editedRecord.recordId);

  expect(editedView.summary).toMatchObject({
    totalRows: 3,
    generatedRows: 2,
    editedRows: 1,
    exceptionRows: 1,
  });
  expect(editedRow).toMatchObject({
    recordId: editResponse.editedRecord.recordId,
    isException: true,
  });
  expect(editedRow?.displayState).toMatchObject({
    lifecycleState: 'edited',
    label: 'Edited',
    reasonLabel: 'Invoice window adjusted',
  });
}, HOOK_TIMEOUT);

it('T321: DB-backed boundary edits move due selection without rewriting already billed client-cadence history', async () => {
  setupCommonMocks({ tenantId, userId: 'ledger-boundary-edit-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    currentPeriodEnd,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Persisted Ledger Boundary Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Ledger Boundary Service',
    planName: 'Persisted Ledger Boundary Plan',
    baseRateCents: 215,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T17:10:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-boundary-selection',
    targetHorizonDays: 70,
    replenishmentThresholdDays: 20,
    recordIdFactory: () => uuidv4(),
  });

  const [currentRecord, futureRecord] = materializationPlan.records;
  await upsertRecurringServicePeriodRecord(currentRecord);
  await upsertRecurringServicePeriodRecord(futureRecord);

  const configRow = await tenantTable(db, tenantId, 'contract_line_service_configuration')
    .where({
      tenant: tenantId,
      contract_line_id: fixedLine.contractLineId,
      service_id: fixedLine.serviceId,
    })
    .first<{ config_id: string }>('config_id');
  expect(configRow?.config_id).toBeTruthy();

  const billedInvoice = await createManualRecurringInvoiceDetail({
    clientId: contextLike.clientId,
    serviceId: fixedLine.serviceId,
    configId: configRow!.config_id,
    billingPeriodStart: currentPeriodStart,
    billingPeriodEnd: nextPeriodStart,
    servicePeriodStart: currentPeriodStart,
    servicePeriodEnd: currentPeriodEnd,
    billingTiming: 'advance',
    amountCents: 21500,
  });

  const linkedCurrentRecord = applyRecurringServicePeriodInvoiceLinkage(currentRecord, {
    invoiceId: billedInvoice.invoiceId,
    invoiceChargeId: billedInvoice.invoiceChargeId,
    invoiceChargeDetailId: billedInvoice.invoiceChargeDetailId,
    linkedAt: '2026-03-18T17:12:00.000Z',
  });
  await upsertRecurringServicePeriodRecord(linkedCurrentRecord);

  const loadedRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });
  const loadedFutureRecord = loadedRecords.find((record) => record.recordId === futureRecord.recordId);
  expect(loadedFutureRecord).toBeTruthy();

  const editResponse = applyRecurringServicePeriodEditRequest({
    record: loadedFutureRecord!,
    request: {
      recordId: loadedFutureRecord!.recordId,
      operation: 'boundary_adjustment',
      updatedInvoiceWindow: {
        start: '2025-02-05',
        end: '2025-03-05',
        semantics: 'half_open',
      },
    },
    context: {
      editedAt: '2026-03-18T17:15:00.000Z',
      sourceRuleVersion: `${fixedLine.contractLineId}:v2`,
      sourceRunKey: 'integration-boundary-selection-edit',
    },
    siblingRecords: loadedRecords,
    recordIdFactory: () => uuidv4(),
  });

  expect(editResponse.ok).toBe(true);
  if (!editResponse.ok) {
    throw new Error('Expected future boundary edit to succeed');
  }

  await upsertRecurringServicePeriodRecord(editResponse.supersededRecord);
  await upsertRecurringServicePeriodRecord(editResponse.editedRecord);

  const reloadedRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });

  const oldWindowQuery = buildRecurringServicePeriodDueSelectionQuery({
    tenant: tenantId,
    scheduleKeys: [materializationPlan.scheduleKey],
    selectorInput: buildClientCadenceDueSelectionInput({
      clientId: contextLike.clientId,
      scheduleKey: materializationPlan.scheduleKey,
      periodKey: futureRecord.periodKey,
      windowStart: futureRecord.invoiceWindow.start,
      windowEnd: futureRecord.invoiceWindow.end,
    }),
  });
  const newWindowQuery = buildRecurringServicePeriodDueSelectionQuery({
    tenant: tenantId,
    scheduleKeys: [materializationPlan.scheduleKey],
    selectorInput: buildClientCadenceDueSelectionInput({
      clientId: contextLike.clientId,
      scheduleKey: materializationPlan.scheduleKey,
      periodKey: editResponse.editedRecord.periodKey,
      windowStart: editResponse.editedRecord.invoiceWindow.start,
      windowEnd: editResponse.editedRecord.invoiceWindow.end,
    }),
  });

  expect(selectDueRecurringServicePeriodRecords(reloadedRecords, oldWindowQuery)).toEqual([]);
  expect(selectDueRecurringServicePeriodRecords(reloadedRecords, newWindowQuery).map((record) => record.recordId)).toEqual([
    editResponse.editedRecord.recordId,
  ]);

  const billedHistoryRow = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: linkedCurrentRecord.recordId })
    .first(['record_id', 'lifecycle_state', 'invoice_charge_detail_id']);
  expect(billedHistoryRow).toMatchObject({
    record_id: linkedCurrentRecord.recordId,
    lifecycle_state: 'billed',
    invoice_charge_detail_id: billedInvoice.invoiceChargeDetailId,
  });
}, HOOK_TIMEOUT);

it('T322/T328: DB-backed skipped client-cadence periods block invoice generation for that window while later persisted work remains due', async () => {
  setupCommonMocks({ tenantId, userId: 'ledger-skip-runtime-user', permissionCheck: () => true });

  const {
    contextLike,
    cycleId,
    currentPeriodStart,
    nextPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Persisted Ledger Skip Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Ledger Skip Service',
    planName: 'Persisted Ledger Skip Plan',
    baseRateCents: 225,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const materializationPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T17:20:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-skip-runtime',
    targetHorizonDays: 95,
    replenishmentThresholdDays: 20,
    recordIdFactory: () => uuidv4(),
  });

  for (const record of materializationPlan.records.slice(0, 3)) {
    await upsertRecurringServicePeriodRecord(record);
  }

  const loadedRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });
  const currentDueRecord = loadedRecords[0];
  const laterFutureRecord = loadedRecords[1];

  const skipResponse = applyRecurringServicePeriodEditRequest({
    record: currentDueRecord,
    request: {
      recordId: currentDueRecord.recordId,
      operation: 'skip',
    },
    context: {
      editedAt: '2026-03-18T17:22:00.000Z',
      sourceRuleVersion: `${fixedLine.contractLineId}:v2`,
      sourceRunKey: 'integration-skip-runtime-edit',
    },
    siblingRecords: loadedRecords,
    recordIdFactory: () => uuidv4(),
  });

  expect(skipResponse.ok).toBe(true);
  if (!skipResponse.ok) {
    throw new Error('Expected skip edit to succeed');
  }

  await upsertRecurringServicePeriodRecord(skipResponse.supersededRecord);
  await upsertRecurringServicePeriodRecord(skipResponse.editedRecord);

  await tenantTable(db, tenantId, 'default_billing_settings')
    .where({ tenant: tenantId })
    .update({ suppress_zero_dollar_invoices: true });

  const generatedInvoice = await generateInvoice(cycleId);
  expect(generatedInvoice).toBeNull();

  const reloadedRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });
  const currentWindowQuery = buildRecurringServicePeriodDueSelectionQuery({
    tenant: tenantId,
    scheduleKeys: [materializationPlan.scheduleKey],
    selectorInput: buildClientCadenceDueSelectionInput({
      clientId: contextLike.clientId,
      scheduleKey: materializationPlan.scheduleKey,
      periodKey: currentDueRecord.periodKey,
      windowStart: currentPeriodStart,
      windowEnd: nextPeriodStart,
    }),
  });
  const laterWindowQuery = buildRecurringServicePeriodDueSelectionQuery({
    tenant: tenantId,
    scheduleKeys: [materializationPlan.scheduleKey],
    selectorInput: buildClientCadenceDueSelectionInput({
      clientId: contextLike.clientId,
      scheduleKey: materializationPlan.scheduleKey,
      periodKey: laterFutureRecord.periodKey,
      windowStart: laterFutureRecord.invoiceWindow.start,
      windowEnd: laterFutureRecord.invoiceWindow.end,
    }),
  });

  expect(selectDueRecurringServicePeriodRecords(reloadedRecords, currentWindowQuery)).toEqual([]);
  expect(selectDueRecurringServicePeriodRecords(reloadedRecords, laterWindowQuery).map((record) => record.recordId)).toEqual([
    laterFutureRecord.recordId,
  ]);
}, HOOK_TIMEOUT);

it('T325: DB-backed future contract-cadence service periods can be inspected and edited before invoice generation', async () => {
  setupCommonMocks({ tenantId, userId: 'ledger-contract-edit-user', permissionCheck: () => true });

  const {
    contextLike,
  } = await createClientWithRecurringCycles({
    clientName: 'Persisted Contract Ledger Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const fixedLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Contract Ledger Service',
    planName: 'Persisted Contract Ledger Plan',
    baseRateCents: 235,
    startDate: '2025-01-08',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const materializationPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-01-08T00:00:00Z',
    materializedAt: '2026-03-18T17:30:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-01-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: fixedLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${fixedLine.contractLineId}:v1`,
    sourceRunKey: 'integration-contract-operational-view',
    targetHorizonDays: 95,
    replenishmentThresholdDays: 20,
    recordIdFactory: () => uuidv4(),
  });

  for (const record of materializationPlan.records.slice(0, 3)) {
    await upsertRecurringServicePeriodRecord(record);
  }

  const initialRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });
  const listingQuery = buildRecurringServicePeriodListingQuery({
    tenant: tenantId,
    asOf: '2025-01-08T00:00:00Z',
    scheduleKeys: [materializationPlan.scheduleKey],
  });
  const initialView = buildRecurringServicePeriodOperationalView({
    records: initialRecords,
    query: listingQuery,
  });

  expect(initialView.summary).toMatchObject({
    totalRows: 3,
    generatedRows: 3,
    editedRows: 0,
    exceptionRows: 0,
  });
  expect(initialView.rows[0]).toMatchObject({
    cadenceOwner: 'contract',
    servicePeriod: {
      start: '2025-01-08',
      end: '2025-02-08',
    },
    invoiceWindow: {
      start: '2025-01-08',
      end: '2025-02-08',
    },
  });

  const targetRecord = initialRecords[1];
  const editResponse = applyRecurringServicePeriodEditRequest({
    record: targetRecord,
    request: {
      recordId: targetRecord.recordId,
      operation: 'boundary_adjustment',
      updatedInvoiceWindow: {
        start: '2025-02-10',
        end: '2025-03-10',
        semantics: 'half_open',
      },
    },
    context: {
      editedAt: '2026-03-18T17:35:00.000Z',
      sourceRuleVersion: `${fixedLine.contractLineId}:v2`,
      sourceRunKey: 'integration-contract-operational-view-edit',
    },
    siblingRecords: initialRecords,
    recordIdFactory: () => uuidv4(),
  });

  expect(editResponse.ok).toBe(true);
  if (!editResponse.ok) {
    throw new Error('Expected contract-cadence persisted edit request to succeed');
  }

  await upsertRecurringServicePeriodRecord(editResponse.supersededRecord);
  await upsertRecurringServicePeriodRecord(editResponse.editedRecord);

  const editedRecords = await loadRecurringServicePeriodRecords({
    obligationId: fixedLine.contractLineId,
  });
  const editedView = buildRecurringServicePeriodOperationalView({
    records: editedRecords,
    query: listingQuery,
  });
  const editedRow = editedView.rows.find((row) => row.recordId === editResponse.editedRecord.recordId);

  expect(editedView.summary).toMatchObject({
    totalRows: 3,
    generatedRows: 2,
    editedRows: 1,
    exceptionRows: 1,
  });
  expect(editedRow).toMatchObject({
    recordId: editResponse.editedRecord.recordId,
    cadenceOwner: 'contract',
    isException: true,
    invoiceWindow: {
      start: '2025-02-10',
      end: '2025-03-10',
    },
  });
}, HOOK_TIMEOUT);

it('T326: DB-backed mixed cadence-owner recurring obligations materialize distinct future period ledgers without collision', async () => {
  setupCommonMocks({ tenantId, userId: 'ledger-mixed-materialization-user', permissionCheck: () => true });

  const {
    contextLike,
    currentPeriodStart,
  } = await createClientWithRecurringCycles({
    clientName: 'Persisted Mixed Ledger Client',
    billingCycle: 'monthly',
    previousPeriodStart: '2024-12-01',
    currentPeriodStart: '2025-01-01',
    nextPeriodStart: '2025-02-01',
  });

  const clientCadenceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Mixed Client Service',
    planName: 'Persisted Mixed Client Plan',
    baseRateCents: 245,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  const contractCadenceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Mixed Contract Service',
    planName: 'Persisted Mixed Contract Plan',
    baseRateCents: 255,
    startDate: '2025-01-08',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

  const clientPlan = materializeClientCadenceServicePeriods({
    asOf: `${currentPeriodStart}T00:00:00Z`,
    materializedAt: '2026-03-18T17:40:00.000Z',
    billingCycle: 'monthly',
    sourceObligation: {
      tenant: tenantId,
      obligationId: clientCadenceLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${clientCadenceLine.contractLineId}:v1`,
    sourceRunKey: 'integration-mixed-client-materialize',
    targetHorizonDays: 60,
    replenishmentThresholdDays: 20,
    recordIdFactory: () => uuidv4(),
  });
  const contractPlan = materializeContractCadenceServicePeriods({
    asOf: '2025-01-08T00:00:00Z',
    materializedAt: '2026-03-18T17:40:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-01-08T00:00:00Z',
    sourceObligation: {
      tenant: tenantId,
      obligationId: contractCadenceLine.contractLineId,
      chargeFamily: 'fixed',
    },
    duePosition: 'advance',
    sourceRuleVersion: `${contractCadenceLine.contractLineId}:v1`,
    sourceRunKey: 'integration-mixed-contract-materialize',
    targetHorizonDays: 60,
    replenishmentThresholdDays: 20,
    recordIdFactory: () => uuidv4(),
  });

  for (const record of [...clientPlan.records.slice(0, 2), ...contractPlan.records.slice(0, 2)]) {
    await upsertRecurringServicePeriodRecord(record);
  }

  const mixedRows = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId })
    .whereIn('schedule_key', [clientPlan.scheduleKey, contractPlan.scheduleKey])
    .orderBy('schedule_key', 'asc')
    .orderBy('service_period_start', 'asc')
    .select([
      'record_id',
      'schedule_key',
      'cadence_owner',
      'service_period_start',
      'service_period_end',
      'invoice_window_start',
      'invoice_window_end',
    ]);

  expect(mixedRows).toHaveLength(4);
  expect(new Set(mixedRows.map((row) => row.schedule_key))).toEqual(
    new Set([clientPlan.scheduleKey, contractPlan.scheduleKey]),
  );

  const clientRows = mixedRows.filter((row) => row.schedule_key === clientPlan.scheduleKey);
  const contractRows = mixedRows.filter((row) => row.schedule_key === contractPlan.scheduleKey);

  expect(clientRows.every((row) => row.cadence_owner === 'client')).toBe(true);
  expect(contractRows.every((row) => row.cadence_owner === 'contract')).toBe(true);
  expect(normalizeDateValue(clientRows[0]?.service_period_start)).toBe('2025-01-01');
  expect(normalizeDateValue(clientRows[0]?.invoice_window_start)).toBe('2025-01-01');
  expect(normalizeDateValue(contractRows[0]?.service_period_start)).toBe('2025-01-08');
  expect(normalizeDateValue(contractRows[0]?.invoice_window_start)).toBe('2025-01-08');
}, HOOK_TIMEOUT);

it('T154: recurring due-work listing is byte-stable and performs no source-row DML, including unassigned usage', async () => {
  setupCommonMocks({ tenantId, userId: 'read-only-due-work-user', permissionCheck: () => true });

  const { contextLike, clientId, currentPeriodStart, nextPeriodStart } = await createClientWithRecurringCycles({
    clientName: 'Read-Only Due Work Client',
    previousPeriodStart: '2025-01-01',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const serviceId = await createTestService(contextLike as any, {
    service_name: 'Read-Only Unassigned Usage',
    billing_method: 'usage',
    default_rate: 125,
    unit_of_measure: 'unit',
    tax_region: 'US-NY',
  } as any);
  const usageId = uuidv4();
  await tenantTable(db, tenantId, 'usage_tracking').insert({
    tenant: tenantId,
    usage_id: usageId,
    client_id: clientId,
    service_id: serviceId,
    usage_date: '2025-02-15',
    quantity: 2,
    invoiced: false,
    contract_line_id: null,
    contract_line_source: null,
    contract_line_unresolved_reason: null,
  });
  const timeServiceId = await createTestService(contextLike as any, {
    service_name: 'Read-Only Unassigned Time',
    billing_method: 'hourly',
    default_rate: 12500,
    unit_of_measure: 'hour',
    tax_region: 'US-NY',
  } as any);
  const timeEntry = await createApprovedTimeEntryForContractLine({
    clientId,
    serviceId: timeServiceId,
    contractLineId: null,
    startTime: '2025-02-15T10:00:00.000Z',
    endTime: '2025-02-15T11:00:00.000Z',
  });

  const beforeUsage = await tenantTable(db, tenantId, 'usage_tracking')
    .where({ tenant: tenantId, usage_id: usageId })
    .first();
  const beforeTime = await tenantTable(db, tenantId, 'time_entries')
    .where({ tenant: tenantId, entry_id: timeEntry.entry_id })
    .first();
  const dml: string[] = [];
  const listener = (queryData: { sql?: string }) => {
    if (typeof queryData.sql === 'string' && /^(update|delete|insert)\s/i.test(queryData.sql.trim())) {
      dml.push(queryData.sql);
    }
  };
  db.on('query', listener);

  const first = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Read-Only Due Work Client',
    dateRange: { from: currentPeriodStart, to: nextPeriodStart },
  });
  const second = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 20,
    searchTerm: 'Read-Only Due Work Client',
    dateRange: { from: currentPeriodStart, to: nextPeriodStart },
  });
  db.removeListener('query', listener);

  const afterUsage = await tenantTable(db, tenantId, 'usage_tracking')
    .where({ tenant: tenantId, usage_id: usageId })
    .first();
  const afterTime = await tenantTable(db, tenantId, 'time_entries')
    .where({ tenant: tenantId, entry_id: timeEntry.entry_id })
    .first();
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(afterUsage).toEqual(beforeUsage);
  expect(afterTime).toEqual(beforeTime);
  expect(dml.filter((sql) => /time_entries|usage_tracking/i.test(sql))).toEqual([]);
  expect(first.invoiceCandidates.flatMap((candidate) => candidate.members)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ recordId: `unresolved:usage:${usageId}`, clientId }),
    ]),
  );
}, HOOK_TIMEOUT);

it('T155: real-schema classification keeps unique, ambiguous, and no-match billing reads deterministic', async () => {
  setupCommonMocks({ tenantId, userId: 'deterministic-classification-user', permissionCheck: () => true });

  const uniqueClient = await createClientWithRecurringCycles({ clientName: 'Unique Classification Client' });
  const ambiguousClient = await createClientWithRecurringCycles({ clientName: 'Ambiguous Classification Client' });
  const noMatchClient = await createClientWithRecurringCycles({ clientName: 'No Match Classification Client' });
  const uniqueLine = await createHourlyContractLine(uniqueClient.contextLike, {
    serviceName: 'Unique Classification Service',
    planName: 'Unique Classification Plan',
    baseRateCents: 10000,
    startDate: '2024-12-01',
    billingTiming: 'arrears',
  });
  const ambiguousFirst = await createHourlyContractLine(ambiguousClient.contextLike, {
    serviceName: 'Ambiguous Classification Service',
    planName: 'Ambiguous Classification Plan A',
    baseRateCents: 10000,
    startDate: '2024-12-01',
    billingTiming: 'arrears',
  });
  const ambiguousSecond = await createHourlyContractLine(ambiguousClient.contextLike, {
    serviceName: 'Ambiguous Classification Service B',
    planName: 'Ambiguous Classification Plan B',
    baseRateCents: 10000,
    startDate: '2024-12-01',
    billingTiming: 'arrears',
  });
  // Force the second line to cover the first line's service, creating the
  // exact multi-candidate case without introducing an arbitrary tie-break.
  await tenantTable(db, tenantId, 'contract_line_services')
    .insert({
      tenant: tenantId,
      contract_line_id: ambiguousSecond.contractLineId,
      service_id: ambiguousFirst.serviceId,
      quantity: 1,
      custom_rate: null,
    });
  const noMatchServiceId = await createTestService(noMatchClient.contextLike as any, {
    service_name: 'No Match Classification Service',
    billing_method: 'hourly',
    default_rate: 10000,
    unit_of_measure: 'hour',
    tax_region: 'US-NY',
  } as any);
  await createApprovedTimeEntryForContractLine({
    clientId: uniqueClient.clientId,
    serviceId: uniqueLine.serviceId,
    contractLineId: null,
    startTime: '2025-01-15T10:00:00.000Z',
    endTime: '2025-01-15T11:00:00.000Z',
  });
  await createApprovedTimeEntryForContractLine({
    clientId: ambiguousClient.clientId,
    serviceId: ambiguousFirst.serviceId,
    contractLineId: null,
    startTime: '2025-01-15T10:00:00.000Z',
    endTime: '2025-01-15T11:00:00.000Z',
  });
  await createApprovedTimeEntryForContractLine({
    clientId: noMatchClient.clientId,
    serviceId: noMatchServiceId,
    contractLineId: null,
    startTime: '2025-01-15T10:00:00.000Z',
    endTime: '2025-01-15T11:00:00.000Z',
  });

  const engine = new BillingEngine();
  const unique = await engine.calculateUnresolvedNonContractChargesForExecutionWindow({
    clientId: uniqueClient.clientId,
    windowStart: '2025-01-01',
    windowEnd: '2025-02-01',
  });
  const ambiguous = await engine.calculateUnresolvedNonContractChargesForExecutionWindow({
    clientId: ambiguousClient.clientId,
    windowStart: '2025-01-01',
    windowEnd: '2025-02-01',
  });
  const noMatch = await engine.calculateUnresolvedNonContractChargesForExecutionWindow({
    clientId: noMatchClient.clientId,
    windowStart: '2025-01-01',
    windowEnd: '2025-02-01',
  });
  expect(unique).toHaveLength(0);
  expect(ambiguous).toEqual(expect.arrayContaining([expect.objectContaining({ unresolved_reason: 'ambiguous' })]));
  expect(noMatch).toEqual(expect.arrayContaining([expect.objectContaining({ unresolved_reason: 'no_match' })]));
}, HOOK_TIMEOUT);

it('T156: generation reconciles before calculation, bills the newly covered entry once, and retries do not duplicate it', async () => {
  setupCommonMocks({ tenantId, userId: 'same-run-reconciliation-user', permissionCheck: () => true });
  const { contextLike, clientId } = await createClientWithRecurringCycles({
    clientName: 'Same-Run Reconciliation Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const line = await createHourlyContractLine(contextLike, {
    serviceName: 'Same-Run Reconciliation Service',
    planName: 'Same-Run Reconciliation Plan',
    baseRateCents: 10000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(line.contractLineId);
  const usageLine = await createUsageContractLine(contextLike, {
    serviceName: 'Same-Run Reconciliation Usage Service',
    planName: 'Same-Run Reconciliation Usage Plan',
    baseRateCents: 2000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(usageLine.contractLineId);
  const entry = await createApprovedTimeEntryForContractLine({
    clientId,
    serviceId: line.serviceId,
    contractLineId: null,
    startTime: '2025-02-15T10:00:00.000Z',
    endTime: '2025-02-15T11:00:00.000Z',
  });
  const usage = await createUsageRecordForContractLine({
    clientId,
    serviceId: usageLine.serviceId,
    contractLineId: null,
    usageDate: '2025-02-15',
    quantity: 3,
  });
  // Replenishment now reaches today's rolling horizon. Select the historical
  // fixture window explicitly rather than assuming it remains on the first page.
  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1, pageSize: 20, searchTerm: 'Same-Run Reconciliation Client',
    // Arrears: the February service period (ending 03-01) is invoiced in the March window.
    dateRange: { from: '2025-02-01', to: '2025-03-01' },
  });
  const dueRows = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members);
  const dueRow = dueRows
    .find((row) => row.contractLineId === line.contractLineId
      && row.invoiceWindowStart === '2025-03-01'
      && row.invoiceWindowEnd === '2025-04-01');
  const usageDueRow = dueRows
    .find((row) => row.contractLineId === usageLine.contractLineId
      && row.invoiceWindowStart === '2025-03-01'
      && row.invoiceWindowEnd === '2025-04-01');
  expect(dueRow).toBeTruthy();
  expect(usageDueRow).toBeTruthy();

  const selectorInputs = [dueRow!.selectorInput, usageDueRow!.selectorInput];
  const invoice = await generateInvoiceForSelectionInputs(selectorInputs);
  expect(invoice).toBeTruthy();
  const persistedEntry = await tenantTable(db, tenantId, 'time_entries').where({ entry_id: entry.entry_id }).first();
  expect(persistedEntry).toMatchObject({
    contract_line_id: line.contractLineId,
    contract_line_source: 'reconciled_at_generation',
  });
  const linkedCharges = await tenantTable(db, tenantId, 'invoice_time_entries')
    .where({ tenant: tenantId, entry_id: entry.entry_id })
    .select('invoice_id');
  expect(linkedCharges).toHaveLength(1);
  const persistedUsage = await tenantTable(db, tenantId, 'usage_tracking')
    .where({ tenant: tenantId, usage_id: usage.usage_id })
    .first(['contract_line_id', 'contract_line_source', 'invoiced']);
  expect(persistedUsage).toMatchObject({
    contract_line_id: usageLine.contractLineId,
    contract_line_source: 'reconciled_at_generation',
    invoiced: true,
  });
  const linkedUsageCharges = await tenantTable(db, tenantId, 'invoice_usage_records')
    .where({ tenant: tenantId, usage_id: usage.usage_id })
    .select('invoice_id');
  expect(linkedUsageCharges).toHaveLength(1);
  await expect(generateInvoiceForSelectionInputs(selectorInputs)).resolves.toMatchObject({
    actionError: expect.stringMatching(/already exists|duplicate/i),
  });
  expect(await tenantTable(db, tenantId, 'invoice_time_entries').where({ entry_id: entry.entry_id })).toHaveLength(1);
  expect(await tenantTable(db, tenantId, 'invoice_usage_records').where({ usage_id: usage.usage_id })).toHaveLength(1);
}, HOOK_TIMEOUT);

it('T157: preview and PO-overage calculation reconcile for pricing but roll back attribution writes', async () => {
  setupCommonMocks({ tenantId, userId: 'rollback-reconciliation-user', permissionCheck: () => true });
  const { contextLike, clientId } = await createClientWithRecurringCycles({
    clientName: 'Rollback Reconciliation Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const line = await createHourlyContractLine(contextLike, {
    serviceName: 'Rollback Reconciliation Service',
    planName: 'Rollback Reconciliation Plan',
    baseRateCents: 10000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(line.contractLineId);
  const entry = await createApprovedTimeEntryForContractLine({
    clientId,
    serviceId: line.serviceId,
    contractLineId: null,
    startTime: '2025-02-15T10:00:00.000Z',
    endTime: '2025-02-15T11:00:00.000Z',
  });
  // Replenishment now reaches today's rolling horizon. Select the historical
  // fixture window explicitly rather than assuming it remains on the first page.
  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1, pageSize: 20, searchTerm: 'Rollback Reconciliation Client',
    // Arrears: the February service period (ending 03-01) is invoiced in the March window.
    dateRange: { from: '2025-02-01', to: '2025-03-01' },
  });
  const selectorInput = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members)
    .find((row) => row.contractLineId === line.contractLineId
      && row.invoiceWindowStart === '2025-03-01'
      && row.invoiceWindowEnd === '2025-04-01')?.selectorInput;
  expect(selectorInput).toBeTruthy();

  const preview = await withRealTransactions(() => previewInvoiceForSelectionInputAction(selectorInput!));
  expect(preview).toMatchObject({ success: true });
  expect(await tenantTable(db, tenantId, 'time_entries').where({ entry_id: entry.entry_id }).first('contract_line_id'))
    .toMatchObject({ contract_line_id: null });

  await tenantTable(db, tenantId, 'client_contracts').where({ client_contract_id: line.clientContractId }).update({
    po_amount: 1,
    po_required: false,
  });
  await withRealTransactions(() => getPurchaseOrderOverageForSelectionInputAction(selectorInput!));
  expect(await tenantTable(db, tenantId, 'time_entries').where({ entry_id: entry.entry_id }).first('contract_line_id'))
    .toMatchObject({ contract_line_id: null });
}, HOOK_TIMEOUT);

it('T158: failed generation rolls back reconciliation and a corrected retry can reconcile once', async () => {
  setupCommonMocks({ tenantId, userId: 'failed-generation-retry-user', permissionCheck: () => true });
  const { contextLike, clientId } = await createClientWithRecurringCycles({
    clientName: 'Failed Generation Retry Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const line = await createHourlyContractLine(contextLike, {
    serviceName: 'Failed Generation Retry Service',
    planName: 'Failed Generation Retry Plan',
    baseRateCents: 10000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(line.contractLineId);
  const entry = await createApprovedTimeEntryForContractLine({
    clientId,
    serviceId: line.serviceId,
    contractLineId: null,
    startTime: '2025-02-15T10:00:00.000Z',
    endTime: '2025-02-15T11:00:00.000Z',
  });
  // Replenishment now reaches today's rolling horizon. Select the historical
  // fixture window explicitly rather than assuming it remains on the first page.
  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1, pageSize: 20, searchTerm: 'Failed Generation Retry Client',
    // Arrears: the February service period (ending 03-01) is invoiced in the March window.
    dateRange: { from: '2025-02-01', to: '2025-03-01' },
  });
  const selectorInput = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members)
    .find((row) => row.contractLineId === line.contractLineId
      && row.invoiceWindowStart === '2025-03-01'
      && row.invoiceWindowEnd === '2025-04-01')?.selectorInput;
  expect(selectorInput).toBeTruthy();

  const calculationFailure = vi.spyOn(BillingEngine.prototype, 'calculateBillingForExecutionWindow')
    .mockRejectedValue(new Error('forced calculation failure after reconciliation'));
  let failedGeneration: unknown;
  try {
    failedGeneration = await withRealTransactions(() => generateInvoiceForSelectionInput(selectorInput!));
  } catch (error) {
    failedGeneration = error;
  } finally {
    calculationFailure.mockRestore();
  }
  expect(String(failedGeneration)).toMatch(/forced calculation failure|actionError/);
  expect(await tenantTable(db, tenantId, 'time_entries').where({ entry_id: entry.entry_id }).first('contract_line_id'))
    .toMatchObject({ contract_line_id: null });
  await expect(withRealTransactions(() => generateInvoiceForSelectionInput(selectorInput!))).resolves.toBeTruthy();
  expect(await tenantTable(db, tenantId, 'time_entries').where({ entry_id: entry.entry_id }).first('contract_line_id'))
    .toMatchObject({ contract_line_id: line.contractLineId });
}, HOOK_TIMEOUT);

const ARREARS_ONLY_CHECKS = [
  { table: 'contract_lines', typeColumn: 'contract_line_type', name: 'contract_lines_hourly_usage_not_advance_check' },
  { table: 'contract_template_lines', typeColumn: 'line_type', name: 'contract_template_lines_hourly_usage_not_advance_check' },
  { table: 'contract_line_presets', typeColumn: 'contract_line_type', name: 'contract_line_presets_hourly_usage_not_advance_check' },
] as const;

/** Drops one or all Migration B CHECK constraints so a fixture can store legacy advance timing. */
async function dropArrearsOnlyChecks(tables?: string[]): Promise<void> {
  for (const check of ARREARS_ONLY_CHECKS) {
    if (tables && !tables.includes(check.table)) continue;
    await db.raw(`ALTER TABLE ${check.table} DROP CONSTRAINT IF EXISTS ${check.name}`);
  }
}

/**
 * Flips any legacy Hourly/Usage advance rows to arrears and re-adds each CHECK constraint as a
 * fully validated constraint, identical to what Migration B creates.
 */
async function restoreArrearsOnlyChecks(): Promise<void> {
  if (!db) return;
  for (const check of ARREARS_ONLY_CHECKS) {
    await db.raw(`ALTER TABLE ${check.table} DROP CONSTRAINT IF EXISTS ${check.name}`);
    await db.raw(
      `UPDATE ${check.table} SET billing_timing = 'arrears' `
      + `WHERE ${check.typeColumn} IN ('Hourly', 'Usage') AND billing_timing = 'advance'`,
    );
    await db.raw(
      `ALTER TABLE ${check.table} ADD CONSTRAINT ${check.name} `
      + `CHECK (NOT (${check.typeColumn} IN ('Hourly', 'Usage') AND billing_timing = 'advance'))`,
    );
  }
}

/** Simulates legacy bad data on contract_lines (the constraint is restored in afterEach). */
async function storeLegacyAdvanceTiming(lineIds: string[]): Promise<void> {
  await dropArrearsOnlyChecks(['contract_lines']);
  await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId })
    .whereIn('contract_line_id', lineIds)
    .update({ billing_timing: 'advance' });
}

it('T1: time logged after an empty legacy advance hourly period bills on the next invoice (draft window is not closed), and the repair adds no double billing', async () => {
  setupCommonMocks({ tenantId, userId: 'stranding-probe-user', permissionCheck: () => true });
  const { contextLike, clientId } = await createClientWithRecurringCycles({
    clientName: 'Stranding Probe Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  // Legacy state: an Hourly line stored as advance, with advance service periods
  // (the way a row written before the arrears-only rule looks). The authoring
  // policy and the engine now refuse to create this, so the periods are
  // materialized by hand, exactly as T069 does.
  const line = await createHourlyContractLine(contextLike, {
    serviceName: 'Stranding Probe Service',
    planName: 'Stranding Probe Plan',
    baseRateCents: 11000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await storeLegacyAdvanceTiming([line.contractLineId]);
  const legacyAdvancePlan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-01T00:00:00Z',
    materializedAt: '2025-01-15T00:00:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-01T00:00:00Z',
    sourceObligation: { tenant: tenantId, obligationId: line.contractLineId, chargeFamily: 'hourly' },
    duePosition: 'advance',
    sourceRuleVersion: `${line.contractLineId}:legacy-advance:v1`,
    sourceRunKey: 'integration-legacy-advance-hourly',
    targetHorizonDays: 70,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  for (const record of legacyAdvancePlan.records) {
    await upsertRecurringServicePeriodRecord(record);
  }

  const findDueRow = async (windowStart: string, windowEnd: string, range?: { from: string; to: string }) => {
    const dueWork = await getAvailableRecurringDueWorkAction({
      page: 1, pageSize: 20, searchTerm: 'Stranding Probe Client',
      dateRange: range ?? { from: windowStart, to: windowEnd },
    });
    return dueWork.invoiceCandidates.flatMap((candidate) => candidate.members)
      .find((row) => row.contractLineId === line.contractLineId
        && row.invoiceWindowStart === windowStart
        && row.invoiceWindowEnd === windowEnd);
  };

  // 1. February advance invoice on Feb 1: no time exists yet.
  const februaryRow = await findDueRow('2025-02-01', '2025-03-01');
  expect(februaryRow).toBeTruthy();
  const februaryResult = await generateInvoiceForSelectionInput(februaryRow!.selectorInput);
  expect(februaryResult).toMatchObject({ invoice_id: expect.any(String) });
  const februaryPeriods = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId })
    .orderBy('service_period_start')
    .select('service_period_start', 'service_period_end', 'lifecycle_state', 'invoice_id', 'invoice_charge_detail_id', 'due_position');
  // The empty February advance period was claimed anyway: billed, linked to an
  // invoice, with no charge detail behind it.
  expect(februaryPeriods[0]).toMatchObject({
    lifecycle_state: 'billed',
    due_position: 'advance',
    invoice_charge_detail_id: null,
  });
  expect(februaryPeriods[0].invoice_id).toBeTruthy();

  // 2. Time logged on Feb 15, after the empty invoice.
  const entry = await createApprovedTimeEntryForContractLine({
    clientId,
    serviceId: line.serviceId,
    contractLineId: line.contractLineId,
    startTime: '2025-02-15T10:00:00.000Z',
    endTime: '2025-02-15T11:00:00.000Z',
  });

  // 3. March invoice.
  const marchRow = await findDueRow('2025-03-01', '2025-04-01');
  expect(marchRow).toBeTruthy();
  const marchResult = await generateInvoiceForSelectionInput(marchRow!.selectorInput);
  expect(marchResult).toMatchObject({ invoice_id: expect.any(String) });

  // 4. The Feb 15 entry is no longer stranded. The February window's invoice is still a draft, so
  //    the window is not closed (T0-2): the entry bills as ordinary time on the March invoice, once,
  //    with no late flag and no late-time suffix.
  const persisted = await tenantTable(db, tenantId, 'time_entries')
    .where({ tenant: tenantId, entry_id: entry.entry_id })
    .first('invoiced');
  const billedLinks = await tenantTable(db, tenantId, 'invoice_time_entries')
    .where({ tenant: tenantId, entry_id: entry.entry_id });
  expect({ invoiced: persisted?.invoiced, links: billedLinks.length }).toEqual({ invoiced: true, links: 1 });
  expect(billedLinks[0].invoice_id).toBe((marchResult as any).invoice_id);
  const billedLine = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ tenant: tenantId, item_id: billedLinks[0].item_id })
    .first('description');
  expect(billedLine).toBeDefined();
  expect(String(billedLine?.description)).not.toMatch(/late time/);

  // 5. Repair. The billed advance rows stay exactly as they are. The repair adds an arrears catch-up row
  //    only for a window that still holds uninvoiced time (hasUninvoicedActivity); the Feb 15 entry
  //    already billed on March, so none is created.
  const billedBefore = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId, due_position: 'advance', lifecycle_state: 'billed' })
    .orderBy('service_period_start')
    .select('record_id', 'invoice_id', 'invoice_charge_detail_id', 'service_period_start', 'revision');
  expect(billedBefore.length).toBeGreaterThanOrEqual(2);

  const repair = await db.transaction((trx) => repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: tenantId }));
  // Other tests in this file leave stored-advance legacy lines in the tenant; the repair is tenant-wide.
  expect(repair.timingFlipped).toBeGreaterThanOrEqual(1);
  expect(repair).toMatchObject({ catchUpRowsCreated: 0, rowsRehomed: 0 });
  expect(repair.advanceRowsSuperseded).toBeGreaterThanOrEqual(1);
  // The repair is tenant-wide: other tests' flagged lines (e.g. the T5b bucket line) re-appear here.
  expect(repair.manualReview.filter((item) => item.contractLineId === line.contractLineId)).toEqual([]);
  expect(await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_line_id: line.contractLineId })
    .first('billing_timing')).toMatchObject({ billing_timing: 'arrears' });

  const billedAfter = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId, due_position: 'advance', lifecycle_state: 'billed' })
    .orderBy('service_period_start')
    .select('record_id', 'invoice_id', 'invoice_charge_detail_id', 'service_period_start', 'revision');
  expect(billedAfter).toEqual(billedBefore);

  const catchUps = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId, reason_code: 'stranded_advance_catch_up' })
    .select('due_position', 'lifecycle_state', 'provenance_kind', 'revision', 'service_period_start', 'service_period_end',
      'invoice_window_start', 'invoice_window_end');
  expect(catchUps).toEqual([]);

  // 6. No double billing. With no catch-up row there is no February catch-up window to generate: the
  //    due-work listing offers nothing for it, and the entry stays billed exactly once, on the March invoice.
  const catchUpRow = await findDueRow('2025-03-01', '2025-04-01', { from: '2025-02-01', to: '2025-03-01' });
  expect(catchUpRow).toBeUndefined();
  expect(await tenantTable(db, tenantId, 'time_entries')
    .where({ tenant: tenantId, entry_id: entry.entry_id })
    .first('invoiced')).toMatchObject({ invoiced: true });
  const linksAfterRepair = await tenantTable(db, tenantId, 'invoice_time_entries')
    .where({ tenant: tenantId, entry_id: entry.entry_id });
  expect(linksAfterRepair).toHaveLength(1);
  expect(linksAfterRepair[0].invoice_id).toBe((marchResult as any).invoice_id);

  // 7. Idempotent: a second run changes nothing.
  const countRows = async () => Number((await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId })
    .count('* as n').first())?.n);
  const rowsBeforeSecondRun = await countRows();
  const second = await db.transaction((trx) => repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: tenantId }));
  expect(second).toMatchObject({
    timingFlipped: 0, advanceRowsSuperseded: 0, rowsRehomed: 0, catchUpRowsCreated: 0,
  });
  // Other tests' flagged lines (T5b bucket) legitimately re-appear on every tenant-wide run.
  expect(second.manualReview.filter((item) => item.contractLineId === line.contractLineId)).toEqual([]);
  expect(await countRows()).toBe(rowsBeforeSecondRun);
}, HOOK_TIMEOUT);

/**
 * Seeds the legacy state the arrears-only rule leaves behind: an Hourly line stored as advance
 * with advance service periods from Feb 2025. Returns helpers to find the Generate-page row for an
 * invoice window.
 */
async function seedLegacyAdvanceHourlyLine(label: string) {
  const clientName = `${label} Client`;
  const { contextLike, clientId } = await createClientWithRecurringCycles({
    clientName,
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const line = await createHourlyContractLine(contextLike, {
    serviceName: `${label} Service`,
    planName: `${label} Plan`,
    baseRateCents: 11000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await storeLegacyAdvanceTiming([line.contractLineId]);
  const plan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-01T00:00:00Z',
    materializedAt: '2025-01-15T00:00:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-01T00:00:00Z',
    sourceObligation: { tenant: tenantId, obligationId: line.contractLineId, chargeFamily: 'hourly' },
    duePosition: 'advance',
    sourceRuleVersion: `${line.contractLineId}:legacy-advance:v1`,
    sourceRunKey: `integration-legacy-advance-${label}`,
    targetHorizonDays: 100,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  for (const record of plan.records) {
    await upsertRecurringServicePeriodRecord(record);
  }
  const findDueRow = async (windowStart: string, windowEnd: string, range: { from: string; to: string }) => {
    const dueWork = await getAvailableRecurringDueWorkAction({
      page: 1, pageSize: 50, searchTerm: clientName, dateRange: range,
    });
    return dueWork.invoiceCandidates.flatMap((candidate) => candidate.members)
      .find((row) => row.contractLineId === line.contractLineId
        && row.invoiceWindowStart === windowStart
        && row.invoiceWindowEnd === windowEnd);
  };
  const strandedGaps = async () => {
    const dueWork = await getAvailableRecurringDueWorkAction({
      page: 1, pageSize: 50, searchTerm: clientName, dateRange: { from: '2025-02-01', to: '2025-04-01' },
    });
    return dueWork.materializationGaps.filter((gap) => gap.clientId === clientId && gap.reason === 'stranded_arrears_only_line');
  };
  return { clientId, clientName, line, findDueRow, strandedGaps };
}

const runMigrationA = async () => {
  const migrationA = createRequire(import.meta.url)('../../../migrations/20261013120000_hourly_usage_lines_bill_in_arrears.cjs');
  await migrationA.up(db);
};

it('T10: unbilled advance period before the billed boundary gets an arrears catch-up row; its time bills once and the billed period is untouched', async () => {
  setupCommonMocks({ tenantId, userId: 'pre-boundary-user', permissionCheck: () => true });
  const { clientId, line, findDueRow } = await seedLegacyAdvanceHourlyLine('Pre Boundary');
  // Feb (unbilled) advance period has time; only the March advance period is invoiced.
  const febEntry = await createApprovedTimeEntryForContractLine({
    clientId, serviceId: line.serviceId, contractLineId: line.contractLineId,
    startTime: '2025-02-10T10:00:00.000Z', endTime: '2025-02-10T11:00:00.000Z',
  });
  const marchRow = await findDueRow('2025-03-01', '2025-04-01', { from: '2025-03-01', to: '2025-04-01' });
  expect(marchRow).toBeTruthy();
  expect(await generateInvoiceForSelectionInput(marchRow!.selectorInput)).toMatchObject({ invoice_id: expect.any(String) });
  const periods = () => tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId })
    .orderBy('service_period_start')
    .select('*');
  const before = await periods();
  const febAdvanceBefore = before.find((row) => row.due_position === 'advance' && dateOnlyOf(row.service_period_start) === '2025-02-01');
  const marchBilledBefore = before.find((row) => row.due_position === 'advance' && row.lifecycle_state === 'billed');
  expect(febAdvanceBefore).toMatchObject({ lifecycle_state: 'generated' });
  expect(dateOnlyOf(marchBilledBefore!.service_period_start)).toBe('2025-03-01');

  await runMigrationA();
  const repair = await db.transaction((trx) => repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: tenantId }));
  expect(repair.manualReview.filter((item) => item.contractLineId === line.contractLineId)).toEqual([]);

  const after = await periods();
  // The billed March advance row is untouched.
  expect(after.find((row) => row.record_id === marchBilledBefore!.record_id)).toEqual(marchBilledBefore);
  // February's retired advance row now has exactly one live arrears counterpart for the same span.
  const febArrears = after.filter((row) => row.due_position === 'arrears'
    && dateOnlyOf(row.service_period_start) === '2025-02-01'
    && !['superseded', 'archived'].includes(row.lifecycle_state));
  expect(febArrears).toHaveLength(1);
  expect(febArrears[0]).toMatchObject({ lifecycle_state: 'generated', reason_code: 'stranded_advance_catch_up', provenance_kind: 'repair' });
  // No service period exists twice among live rows.
  const liveSpans = after
    .filter((row) => !['superseded', 'archived'].includes(row.lifecycle_state))
    .map((row) => `${row.due_position}|${dateOnlyOf(row.service_period_start)}|${dateOnlyOf(row.service_period_end)}`);
  expect(new Set(liveSpans).size).toBe(liveSpans.length);

  // February's time is billable exactly once through the catch-up row; March is not billed again.
  const catchUpRow = await findDueRow(
    dateOnlyOf(febArrears[0].invoice_window_start), dateOnlyOf(febArrears[0].invoice_window_end),
    { from: '2025-02-01', to: '2025-04-01' },
  );
  expect(catchUpRow).toBeTruthy();
  expect(await generateInvoiceForSelectionInput(catchUpRow!.selectorInput)).toMatchObject({ invoice_id: expect.any(String) });
  const febLinks = () => tenantTable(db, tenantId, 'invoice_time_entries').where({ tenant: tenantId, entry_id: febEntry.entry_id });
  expect(await febLinks()).toHaveLength(1);
  expect(await tenantTable(db, tenantId, 'time_entries').where({ tenant: tenantId, entry_id: febEntry.entry_id }).first('invoiced'))
    .toMatchObject({ invoiced: true });

  const second = await db.transaction((trx) => repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: tenantId }));
  expect(second).toMatchObject({ timingFlipped: 0, advanceRowsSuperseded: 0, rowsRehomed: 0, catchUpRowsCreated: 0 });
  expect(await febLinks()).toHaveLength(1);
  const final = await periods();
  expect(final.filter((row) => row.lifecycle_state === 'billed' && row.due_position === 'advance')).toHaveLength(1);
  expect(final.find((row) => row.record_id === marchBilledBefore!.record_id)).toEqual(marchBilledBefore);
}, HOOK_TIMEOUT);

it('T11: Generate page reports a billed empty advance Hourly period with later time; Fix all repairs it and the time bills once', async () => {
  setupCommonMocks({ tenantId, userId: 'gap-fix-user', permissionCheck: () => true });
  const { clientId, line, findDueRow, strandedGaps } = await seedLegacyAdvanceHourlyLine('Gap Fix');
  // February is invoiced empty on the advance schedule, then time is logged in it.
  const februaryRow = await findDueRow('2025-02-01', '2025-03-01', { from: '2025-02-01', to: '2025-03-01' });
  expect(februaryRow).toBeTruthy();
  expect(await generateInvoiceForSelectionInput(februaryRow!.selectorInput)).toMatchObject({ invoice_id: expect.any(String) });
  const entry = await createApprovedTimeEntryForContractLine({
    clientId, serviceId: line.serviceId, contractLineId: line.contractLineId,
    startTime: '2025-02-15T10:00:00.000Z', endTime: '2025-02-15T11:00:00.000Z',
  });

  // After Migration A (no repair yet) the Generate-page data reports the gap.
  await runMigrationA();
  const gapsBefore = await strandedGaps();
  expect(gapsBefore.length).toBeGreaterThanOrEqual(1);
  expect(gapsBefore.some((gap) => gap.servicePeriodStart === '2025-02-01' && gap.servicePeriodEnd === '2025-03-01')).toBe(true);

  // "Fix all" runs the arrears-only repair, then the client-cadence repair.
  const summary: any = await repairAllRecurringServicePeriodsForTenantAction();
  expect(summary.arrearsOnlyLines.catchUpRowsCreated).toBeGreaterThanOrEqual(1);
  expect(await strandedGaps()).toEqual([]);

  // The stranded time appears as a Ready catch-up row and bills exactly once.
  const catchUpRow = await findDueRow('2025-03-01', '2025-04-01', { from: '2025-02-01', to: '2025-04-01' });
  expect(catchUpRow).toBeTruthy();
  expect(await generateInvoiceForSelectionInput(catchUpRow!.selectorInput)).toMatchObject({ invoice_id: expect.any(String) });
  const links = () => tenantTable(db, tenantId, 'invoice_time_entries').where({ tenant: tenantId, entry_id: entry.entry_id });
  expect(await links()).toHaveLength(1);

  // A second invoice run does not bill it again.
  expect(await findDueRow('2025-03-01', '2025-04-01', { from: '2025-02-01', to: '2025-04-01' })).toBeUndefined();
  await generateInvoiceForSelectionInput(catchUpRow!.selectorInput).catch(() => undefined);
  expect(await links()).toHaveLength(1);
  await repairAllRecurringServicePeriodsForTenantAction();
  expect(await links()).toHaveLength(1);
  expect(await strandedGaps()).toEqual([]);
}, HOOK_TIMEOUT);

it('T4: a stored-advance Hourly or Usage line materializes arrears service periods (engine backstop)', async () => {
  setupCommonMocks({ tenantId, userId: 'engine-backstop-user', permissionCheck: () => true });
  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Engine Backstop Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const hourly = await createHourlyContractLine(contextLike, {
    serviceName: 'Engine Backstop Hourly Service',
    planName: 'Engine Backstop Hourly Plan',
    baseRateCents: 11000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  const usage = await createUsageContractLine(contextLike, {
    serviceName: 'Engine Backstop Usage Service',
    planName: 'Engine Backstop Usage Plan',
    baseRateCents: 900,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  const fixed = await createFixedContractLine(contextLike, {
    serviceName: 'Engine Backstop Fixed Service',
    planName: 'Engine Backstop Fixed Plan',
    baseRateCents: 500,
    startDate: '2025-02-01',
    billingTiming: 'advance',
    cadenceOwner: 'contract',
  });
  // Legacy bad rows: advance stored on Hourly and Usage lines.
  await storeLegacyAdvanceTiming([hourly.contractLineId, usage.contractLineId]);

  for (const lineId of [hourly.contractLineId, usage.contractLineId, fixed.contractLineId]) {
    await syncContractLineRecurringPeriods(lineId);
  }
  const duePositions = async (lineId: string) => (await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: lineId })
    .select('due_position')).map((row) => row.due_position);

  const hourlyPositions = await duePositions(hourly.contractLineId);
  const usagePositions = await duePositions(usage.contractLineId);
  expect(hourlyPositions.length).toBeGreaterThan(0);
  expect(usagePositions.length).toBeGreaterThan(0);
  expect(new Set(hourlyPositions)).toEqual(new Set(['arrears']));
  expect(new Set(usagePositions)).toEqual(new Set(['arrears']));
  // A Fixed line is unaffected.
  expect(new Set(await duePositions(fixed.contractLineId))).toEqual(new Set(['advance']));
}, HOOK_TIMEOUT);

it('T9: the database rejects Hourly and Usage contract lines stored as advance (Migration B)', async () => {
  setupCommonMocks({ tenantId, userId: 'constraint-user', permissionCheck: () => true });
  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Constraint Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const hourly = await createHourlyContractLine(contextLike, {
    serviceName: 'Constraint Hourly Service',
    planName: 'Constraint Hourly Plan',
    baseRateCents: 11000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  const fixed = await createFixedContractLine(contextLike, {
    serviceName: 'Constraint Fixed Service',
    planName: 'Constraint Fixed Plan',
    baseRateCents: 500,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  const validated = await db.raw(
    'SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY(?)',
    [ARREARS_ONLY_CHECKS.map((check) => check.name)],
  );
  expect(validated.rows).toHaveLength(3);
  expect(validated.rows.every((row: { convalidated: boolean }) => row.convalidated)).toBe(true);
  await expect(
    tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: hourly.contractLineId })
      .update({ billing_timing: 'advance' }),
  ).rejects.toThrow(/hourly_usage_not_advance_check/);
  await expect(
    tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: fixed.contractLineId })
      .update({ billing_timing: 'advance' }),
  ).resolves.toBe(1);
}, HOOK_TIMEOUT);

it('T5/T2: Migration A flips stored-advance Hourly/Usage rows to arrears and supersedes unbilled advance rows; the repair re-homes edited rows', async () => {
  setupCommonMocks({ tenantId, userId: 'migration-a-user', permissionCheck: () => true });
  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Migration A Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const line = await createHourlyContractLine(contextLike, {
    serviceName: 'Migration A Hourly Service',
    planName: 'Migration A Hourly Plan',
    baseRateCents: 11000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  const fixed = await createFixedContractLine(contextLike, {
    serviceName: 'Migration A Fixed Service',
    planName: 'Migration A Fixed Plan',
    baseRateCents: 500,
    startDate: '2025-02-01',
    billingTiming: 'advance',
    cadenceOwner: 'contract',
  });
  await storeLegacyAdvanceTiming([line.contractLineId]);

  const templateId = uuidv4();
  const templateLineId = uuidv4();
  const presetId = uuidv4();
  const fixedPresetId = uuidv4();
  await dropArrearsOnlyChecks(['contract_template_lines', 'contract_line_presets']);
  await tenantTable(db, tenantId, 'contract_templates').insert({
    // Base currency is required on every template; this one is only here for the
    // timing migration to flip, so it matches the suite's USD contracts.
    tenant: tenantId, template_id: templateId, template_name: 'Migration A Template', currency_code: 'USD',
  });
  await tenantTable(db, tenantId, 'contract_template_lines').insert({
    tenant: tenantId, template_id: templateId, template_line_id: templateLineId,
    template_line_name: 'Legacy Hourly Template Line', line_type: 'Hourly', billing_timing: 'advance',
  });
  await tenantTable(db, tenantId, 'contract_line_presets').insert([
    { tenant: tenantId, preset_id: presetId, preset_name: 'Legacy Hourly Preset', contract_line_type: 'Hourly', billing_timing: 'advance' },
    { tenant: tenantId, preset_id: fixedPresetId, preset_name: 'Fixed Advance Preset', contract_line_type: 'Fixed', billing_timing: 'advance' },
  ]);

  const plan = materializeContractCadenceServicePeriods({
    asOf: '2025-02-01T00:00:00Z',
    materializedAt: '2025-01-15T00:00:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2025-02-01T00:00:00Z',
    sourceObligation: { tenant: tenantId, obligationId: line.contractLineId, chargeFamily: 'hourly' },
    duePosition: 'advance',
    sourceRuleVersion: `${line.contractLineId}:legacy-advance:v1`,
    sourceRunKey: 'integration-migration-a',
    targetHorizonDays: 100,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  for (const record of plan.records) {
    await upsertRecurringServicePeriodRecord(record);
  }
  const advanceRows = () => tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId, due_position: 'advance' })
    .orderBy('service_period_start')
    .select('record_id', 'lifecycle_state', 'reason_code', 'service_period_start');
  const before = await advanceRows();
  expect(before.length).toBeGreaterThanOrEqual(2);
  // The first row is user-edited and must survive the migration untouched.
  const editedId = before[0].record_id;
  await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: editedId })
    .update({ lifecycle_state: 'edited', provenance_kind: 'user_edited' });

  const migrationA = createRequire(import.meta.url)('../../../migrations/20261013120000_hourly_usage_lines_bill_in_arrears.cjs');
  await migrationA.up(db);

  const lineTiming = (id: string) => tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_line_id: id }).first('billing_timing');
  expect(await lineTiming(line.contractLineId)).toMatchObject({ billing_timing: 'arrears' });
  expect(await lineTiming(fixed.contractLineId)).toMatchObject({ billing_timing: 'advance' });
  expect(await tenantTable(db, tenantId, 'contract_template_lines')
    .where({ tenant: tenantId, template_line_id: templateLineId }).first('billing_timing'))
    .toMatchObject({ billing_timing: 'arrears' });
  expect(await tenantTable(db, tenantId, 'contract_line_presets')
    .where({ tenant: tenantId, preset_id: presetId }).first('billing_timing')).toMatchObject({ billing_timing: 'arrears' });
  expect(await tenantTable(db, tenantId, 'contract_line_presets')
    .where({ tenant: tenantId, preset_id: fixedPresetId }).first('billing_timing')).toMatchObject({ billing_timing: 'advance' });

  const after = await advanceRows();
  expect(after.find((row) => row.record_id === editedId)).toMatchObject({ lifecycle_state: 'edited', reason_code: before[0].reason_code });
  for (const row of after.filter((r) => r.record_id !== editedId)) {
    expect(row).toMatchObject({ lifecycle_state: 'superseded', reason_code: 'hourly_usage_arrears_repair' });
  }

  // Re-running the migration changes nothing.
  await migrationA.up(db);
  expect(await advanceRows()).toEqual(after);

  // T2a: an edited advance row is retired and carried onto the arrears schedule when the
  // line's arrears twin can be materialized; otherwise it is flagged for manual review.
  const repair = await db.transaction((trx) => repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: tenantId }));
  const editedHandled = repair.rowsRehomed
    + repair.manualReview.filter((entry) => entry.recordId === editedId).length;
  expect(editedHandled).toBeGreaterThanOrEqual(1);
  expect(await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: editedId }).first('lifecycle_state')).toMatchObject({ lifecycle_state: 'superseded' });

  // T2b: a current/future edited advance row moves onto the arrears schedule.
  const futureLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Migration A Future Hourly Service',
    planName: 'Migration A Future Hourly Plan',
    baseRateCents: 11000,
    startDate: '2026-11-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await storeLegacyAdvanceTiming([futureLine.contractLineId]);
  const futurePlan = materializeContractCadenceServicePeriods({
    asOf: '2026-11-01T00:00:00Z',
    materializedAt: '2026-10-01T00:00:00.000Z',
    billingCycle: 'monthly',
    anchorDate: '2026-11-01T00:00:00Z',
    sourceObligation: { tenant: tenantId, obligationId: futureLine.contractLineId, chargeFamily: 'hourly' },
    duePosition: 'advance',
    sourceRuleVersion: `${futureLine.contractLineId}:legacy-advance:v1`,
    sourceRunKey: 'integration-migration-a-future',
    targetHorizonDays: 70,
    replenishmentThresholdDays: 15,
    recordIdFactory: () => uuidv4(),
  });
  for (const record of futurePlan.records) {
    await upsertRecurringServicePeriodRecord(record);
  }
  const futureAdvance = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: futureLine.contractLineId, due_position: 'advance', lifecycle_state: 'generated' })
    .orderBy('service_period_start')
    .select('record_id');
  expect(futureAdvance.length).toBeGreaterThanOrEqual(1);
  const futureEditedId = futureAdvance[0].record_id;
  await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: futureEditedId })
    .update({ lifecycle_state: 'edited', provenance_kind: 'user_edited' });

  await migrationA.up(db);
  const repairFuture = await db.transaction((trx) => repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: tenantId }));
  expect(repairFuture.rowsRehomed).toBeGreaterThanOrEqual(1);
  expect(await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: futureEditedId }).first('lifecycle_state')).toMatchObject({ lifecycle_state: 'superseded' });
  const rehomed = await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: futureLine.contractLineId, due_position: 'arrears', supersedes_record_id: futureEditedId })
    .select('lifecycle_state', 'provenance_kind', 'revision');
  expect(rehomed).toHaveLength(1);
  expect(rehomed[0]).toMatchObject({ lifecycle_state: 'edited', provenance_kind: 'repair' });
  expect(Number(rehomed[0].revision)).toBeGreaterThanOrEqual(2);
}, HOOK_TIMEOUT);

it('T5b: charged billed advance Hourly periods: catch-up bills only the uninvoiced time once; bucket lines go to manual review', async () => {
  setupCommonMocks({ tenantId, userId: 'charged-repair-user', permissionCheck: () => true });

  const seed = async (label: string) => {
    const { contextLike, clientId } = await createClientWithRecurringCycles({
      clientName: `Charged Repair ${label} Client`,
      currentPeriodStart: '2025-02-01',
      nextPeriodStart: '2025-03-01',
    });
    const line = await createHourlyContractLine(contextLike, {
      serviceName: `Charged Repair ${label} Service`,
      planName: `Charged Repair ${label} Plan`,
      baseRateCents: 11000,
      startDate: '2025-02-01',
      billingTiming: 'arrears',
      cadenceOwner: 'contract',
    });
    await storeLegacyAdvanceTiming([line.contractLineId]);
    const plan = materializeContractCadenceServicePeriods({
      asOf: '2025-02-01T00:00:00Z',
      materializedAt: '2025-01-15T00:00:00.000Z',
      billingCycle: 'monthly',
      anchorDate: '2025-02-01T00:00:00Z',
      sourceObligation: { tenant: tenantId, obligationId: line.contractLineId, chargeFamily: 'hourly' },
      duePosition: 'advance',
      sourceRuleVersion: `${line.contractLineId}:legacy-advance:v1`,
      sourceRunKey: `integration-charged-repair-${label}`,
      targetHorizonDays: 70,
      replenishmentThresholdDays: 15,
      recordIdFactory: () => uuidv4(),
    });
    for (const record of plan.records) {
      await upsertRecurringServicePeriodRecord(record);
    }
    // Time already worked in February is invoiced by the legacy advance February invoice.
    const invoicedEntry = await createApprovedTimeEntryForContractLine({
      clientId, serviceId: line.serviceId, contractLineId: line.contractLineId,
      startTime: '2025-02-10T10:00:00.000Z', endTime: '2025-02-10T11:00:00.000Z',
    });
    const dueWork = await getAvailableRecurringDueWorkAction({
      page: 1, pageSize: 20, searchTerm: `Charged Repair ${label} Client`,
      dateRange: { from: '2025-02-01', to: '2025-03-01' },
    });
    const februaryRow = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members)
      .find((row) => row.contractLineId === line.contractLineId
        && row.invoiceWindowStart === '2025-02-01' && row.invoiceWindowEnd === '2025-03-01');
    expect(februaryRow).toBeTruthy();
    expect(await generateInvoiceForSelectionInput(februaryRow!.selectorInput))
      .toMatchObject({ invoice_id: expect.any(String) });
    expect(await tenantTable(db, tenantId, 'time_entries')
      .where({ tenant: tenantId, entry_id: invoicedEntry.entry_id }).first('invoiced'))
      .toMatchObject({ invoiced: true });
    // More February time is logged afterwards and is stranded.
    const lateEntry = await createApprovedTimeEntryForContractLine({
      clientId, serviceId: line.serviceId, contractLineId: line.contractLineId,
      startTime: '2025-02-20T10:00:00.000Z', endTime: '2025-02-20T11:00:00.000Z',
    });
    return { line, invoicedEntry, lateEntry };
  };

  const plain = await seed('Plain');
  const bucket = await seed('Bucket');

  const febBilled = (lineId: string) => tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: lineId, due_position: 'advance', lifecycle_state: 'billed' })
    .orderBy('service_period_start')
    .select('*');
  const plainBefore = await febBilled(plain.line.contractLineId);
  const bucketBefore = await febBilled(bucket.line.contractLineId);
  expect(plainBefore).toHaveLength(1);
  expect(plainBefore[0].invoice_id).toBeTruthy();

  // A bucket overlay on the second line's service configuration.
  const bucketConfig = await tenantTable(db, tenantId, 'contract_line_service_configuration')
    .where({ tenant: tenantId, contract_line_id: bucket.line.contractLineId })
    .first('config_id');
  expect(bucketConfig).toBeTruthy();
  await tenantTable(db, tenantId, 'contract_line_service_bucket_config').insert({
    tenant: tenantId, config_id: bucketConfig!.config_id, total_minutes: 600,
  });

  // Migration A, then the repair.
  const migrationA = createRequire(import.meta.url)('../../../migrations/20261013120000_hourly_usage_lines_bill_in_arrears.cjs');
  await migrationA.up(db);
  const repair = await db.transaction((trx) => repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: tenantId }));

  // Billed rows are byte-for-byte unchanged, including invoice_id and invoice_charge_detail_id.
  expect(await febBilled(plain.line.contractLineId)).toEqual(plainBefore);
  expect(await febBilled(bucket.line.contractLineId)).toEqual(bucketBefore);

  // Plain line: one catch-up row, no manual review. Bucket line: manual review, no catch-up row.
  const catchUps = (lineId: string) => tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: lineId, reason_code: 'stranded_advance_catch_up' }).select('record_id');
  expect(await catchUps(plain.line.contractLineId)).toHaveLength(1);
  expect(await catchUps(bucket.line.contractLineId)).toHaveLength(0);
  expect(repair.manualReview.filter((entry) => entry.contractLineId === plain.line.contractLineId)).toEqual([]);
  expect(repair.manualReview.filter((entry) => entry.contractLineId === bucket.line.contractLineId))
    .toEqual([expect.objectContaining({ reason: 'charged_period_with_bucket_or_period_total' })]);

  // Bill the catch-up window: the late entry is billed once, the invoiced one is not billed again.
  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1, pageSize: 20, searchTerm: 'Charged Repair Plain Client',
    dateRange: { from: '2025-02-01', to: '2025-03-01' },
  });
  const catchUpRow = dueWork.invoiceCandidates.flatMap((candidate) => candidate.members)
    .find((row) => row.contractLineId === plain.line.contractLineId
      && row.invoiceWindowStart === '2025-03-01' && row.invoiceWindowEnd === '2025-04-01');
  expect(catchUpRow).toBeTruthy();
  expect(await generateInvoiceForSelectionInput(catchUpRow!.selectorInput))
    .toMatchObject({ invoice_id: expect.any(String) });

  const links = async (entryId: string) => tenantTable(db, tenantId, 'invoice_time_entries')
    .where({ tenant: tenantId, entry_id: entryId }).select('invoice_id');
  expect(await links(plain.invoicedEntry.entry_id)).toHaveLength(1);
  expect(await links(plain.lateEntry.entry_id)).toHaveLength(1);
  const invoiceIds = [...new Set([
    ...(await links(plain.invoicedEntry.entry_id)),
    ...(await links(plain.lateEntry.entry_id)),
  ].map((row) => row.invoice_id))];
  expect(invoiceIds).toHaveLength(2);
  // Everything logged (2 hours at $110) is invoiced exactly once across all invoices.
  const billedTotal = await tenantTable(db, tenantId, 'invoice_charges')
    .whereIn('invoice_id', invoiceIds)
    .sum({ total: 'net_amount' }).first();
  expect(Number(billedTotal?.total)).toBe(22000);
}, HOOK_TIMEOUT);

it('T5c: a period billed to another invoice still aborts the claim when the window has no repair catch-up sibling', async () => {
  setupCommonMocks({ tenantId, userId: 'claim-guard-user', permissionCheck: () => true });
  const { contextLike } = await createClientWithRecurringCycles({
    clientName: 'Claim Guard Client',
    currentPeriodStart: '2025-02-01',
    nextPeriodStart: '2025-03-01',
  });
  const line = await createHourlyContractLine(contextLike, {
    serviceName: 'Claim Guard Service',
    planName: 'Claim Guard Plan',
    baseRateCents: 11000,
    startDate: '2025-02-01',
    billingTiming: 'arrears',
    cadenceOwner: 'contract',
  });
  await syncContractLineRecurringPeriods(line.contractLineId);
  const periods = () => tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, obligation_id: line.contractLineId, due_position: 'arrears' })
    .whereNotIn('lifecycle_state', ['superseded', 'archived'])
    .orderBy('service_period_start');
  const [arrearsRow] = await periods().select('*');
  expect(arrearsRow).toBeTruthy();
  const windowDate = (value: string | Date) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: arrearsRow.client_id,
    contractId: arrearsRow.contract_id,
    contractLineId: line.contractLineId,
    windowStart: windowDate(arrearsRow.invoice_window_start),
    windowEnd: windowDate(arrearsRow.invoice_window_end),
  });
  // The arrears period is billed to a different invoice; a pending ordinary (non-repair) sibling
  // exists in the same window. Only a repair catch-up sibling may relax the guard.
  const { record_id: _drop, ...carried } = arrearsRow;
  await tenantTable(db, tenantId, 'recurring_service_periods').insert({
    ...carried,
    record_id: uuidv4(),
    schedule_key: `${arrearsRow.schedule_key}:ordinary-sibling`,
    due_position: 'advance',
    lifecycle_state: 'generated',
    invoice_id: null,
    invoice_linked_at: null,
  });
  const otherInvoiceId = uuidv4();
  await tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId, record_id: arrearsRow.record_id })
    .update({ lifecycle_state: 'billed', invoice_id: otherInvoiceId, invoice_linked_at: new Date().toISOString() });

  const { claimRecurringServicePeriodsForSelectionInputs } = await import('@alga-psa/billing/services/invoiceService');
  await expect(
    db.transaction((trx) => claimRecurringServicePeriodsForSelectionInputs({
      tx: trx,
      tenant: tenantId,
      invoiceId: uuidv4(),
      selectorInputs: [selectorInput],
      linkedAt: new Date().toISOString(),
    })),
  ).rejects.toThrow(/already claimed by invoice/);
}, HOOK_TIMEOUT);

it('T159: production schema has time-entry updated_at but no usage_tracking updated_at', async () => {
  const columns = await schemaTable(db, 'information_schema.columns', 'recurring attribution schema conformance')
    .where({ table_schema: 'public' })
    .whereIn('table_name', ['time_entries', 'usage_tracking'])
    .where('column_name', 'updated_at')
    .select('table_name', 'column_name');
  const tablesWithUpdatedAt = new Set(columns.map((column) => column.table_name));
  for (const descriptor of Object.values(ATTRIBUTION_TABLES)) {
    expect(tablesWithUpdatedAt.has(descriptor.table)).toBe(descriptor.hasUpdatedAt);
  }
  expect(tablesWithUpdatedAt.has('usage_tracking')).toBe(false);
});

it('UOM snapshot: generated fixed charge stores the catalog code and matching label', async () => {
  setupCommonMocks({ tenantId, userId: 'test-user', permissionCheck: () => true });
  const setup = await createClientWithCycles('UOM snapshot client');
  const fixed = await createFixedContractLine(setup.contextLike, {
    serviceName: 'UOM snapshot service',
    planName: 'UOM snapshot plan',
    baseRateCents: 2500,
    startDate: setup.currentPeriodStart,
    billingTiming: 'advance',
    cadenceOwner: 'contract',
  });
  await tenantTable(db, tenantId, 'service_catalog').where({ service_id: fixed.serviceId }).update({
    unit_code: 'H87',
    unit_of_measure: 'Piece',
  });
  const configuration = await tenantTable(db, tenantId, 'contract_line_service_configuration')
    .where({ contract_line_id: fixed.contractLineId }).first('config_id');
  expect(configuration).toBeTruthy();
  await tenantTable(db, tenantId, 'contract_line_service_usage_config').insert({
    tenant: tenantId,
    config_id: configuration.config_id,
    unit_code: 'C62',
    unit_of_measure: 'Each',
  }).onConflict(['tenant', 'config_id']).merge({ unit_code: 'C62', unit_of_measure: 'Each' });
  await syncContractLineRecurringPeriods(fixed.contractLineId);
  const selection = buildContractCadenceDueSelectionInput({
    clientId: setup.clientId,
    contractId: fixed.contractId,
    contractLineId: fixed.contractLineId,
    windowStart: `${setup.currentPeriodStart}T00:00:00Z`,
    windowEnd: `${setup.nextPeriodStart}T00:00:00Z`,
  });
  const invoice = await generateInvoiceForSelectionInput(selection);
  expect(invoice).toBeTruthy();
  const charge = await tenantTable(db, tenantId, 'invoice_charges').where({ invoice_id: invoice!.invoice_id }).first();
  expect(charge).toMatchObject({ unit_code: 'H87', unit_label: 'Piece' });

  // The snapshot must survive the shared loader that feeds previews, PDFs and the REST API.
  const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
  const viewModel = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, tenantId, invoice!.invoice_id));
  expect(viewModel?.items).toEqual([
    expect.objectContaining({ unit_code: 'H87', unit_label: 'Piece' }),
  ]);
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

type MeteredLineType = 'Hourly' | 'Usage';

async function createClientWithCycles(clientName = 'Timing Integration Client'): Promise<ClientSetupResult> {
  return createClientWithRecurringCycles({ clientName });
}

async function createClientWithRecurringCycles(
  options: RecurringCycleSetupOptions = {}
): Promise<ClientSetupResult> {
  const clientId = uuidv4();
  const billingCycle = options.billingCycle ?? 'monthly';
  await tenantTable(db, tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: options.clientName ?? 'Timing Integration Client',
    billing_cycle: billingCycle,
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  await tenantTable(db, tenantId, 'client_locations').insert({
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

  await seedBillingCycle(db, tenantId, {
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
  await seedBillingCycle(db, tenantId, {
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

/**
 * Mirrors what contractActions/contractLineAction do in production after a
 * contract line is created or changed: run the real recurring-service-period
 * sync so recurring_service_periods rows exist. The post-cutover invoice
 * engine treats those rows as mandatory (see T082). Tests that materialize
 * periods manually with explicit windows must NOT also call this, or the
 * (tenant, schedule_key, period_key, revision) unique constraint collides.
 */
async function syncContractLineRecurringPeriods(contractLineId: string): Promise<void> {
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId,
      sourceRunPrefix: 'integration-fixture',
    });
  });
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

async function createHourlyContractLine(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  options: FixedLineOptions,
): Promise<{ serviceId: string; contractLineId: string; clientContractLineId: string; contractId: string; clientContractId: string }> {
  if (options.billingTiming === 'advance') {
    throw new Error('Hourly/Usage lines cannot bill in advance; use arrears (see contractLineTimingRule).');
  }
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'hourly',
    default_rate: options.baseRateCents,
    unit_of_measure: 'hour',
    tax_region: 'US-NY'
  });
  await ensureUsdServicePrice(serviceId, options.baseRateCents);

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

  await convertContractLineToMeteredType(contextLike, {
    contractLineId: result.contractLineId,
    serviceId,
    type: 'Hourly',
    baseRateCents: options.baseRateCents,
  });

  return {
    serviceId,
    contractLineId: result.contractLineId,
    clientContractLineId: result.clientContractLineId,
    contractId: result.contractId,
    clientContractId: result.clientContractId
  };
}

async function createUsageContractLine(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  options: FixedLineOptions,
): Promise<{ serviceId: string; contractLineId: string; clientContractLineId: string; contractId: string; clientContractId: string }> {
  if (options.billingTiming === 'advance') {
    throw new Error('Hourly/Usage lines cannot bill in advance; use arrears (see contractLineTimingRule).');
  }
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'usage',
    default_rate: options.baseRateCents,
    unit_of_measure: 'unit',
    tax_region: 'US-NY'
  });
  await ensureUsdServicePrice(serviceId, options.baseRateCents);

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

  await convertContractLineToMeteredType(contextLike, {
    contractLineId: result.contractLineId,
    serviceId,
    type: 'Usage',
    baseRateCents: options.baseRateCents,
  });

  return {
    serviceId,
    contractLineId: result.contractLineId,
    clientContractLineId: result.clientContractLineId,
    contractId: result.contractId,
    clientContractId: result.clientContractId
  };
}

async function convertContractLineToMeteredType(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  params: {
    contractLineId: string;
    serviceId: string;
    type: MeteredLineType;
    baseRateCents: number;
  },
) {
  const now = new Date();
  const configRow = await tenantTable(contextLike.db, contextLike.tenantId, 'contract_line_service_configuration')
    .where({
      tenant: contextLike.tenantId,
      contract_line_id: params.contractLineId,
      service_id: params.serviceId,
    })
    .first('config_id');

  if (!configRow?.config_id) {
    throw new Error(`Missing configuration for contract line ${params.contractLineId}`);
  }

  await tenantTable(contextLike.db, contextLike.tenantId, 'contract_lines')
    .where({ tenant: contextLike.tenantId, contract_line_id: params.contractLineId })
    .update({ contract_line_type: params.type });

  if (await hasSchemaTable(contextLike.db, 'billing_plans')) {
    await tenantTable(contextLike.db, contextLike.tenantId, 'billing_plans')
      .where({ tenant: contextLike.tenantId, plan_id: params.contractLineId })
      .update({ plan_type: params.type });
  }

  await tenantTable(contextLike.db, contextLike.tenantId, 'contract_line_service_configuration')
    .where({ tenant: contextLike.tenantId, config_id: configRow.config_id })
    .update({ configuration_type: params.type });

  if (await hasSchemaTable(contextLike.db, 'plan_service_configuration')) {
    await tenantTable(contextLike.db, contextLike.tenantId, 'plan_service_configuration')
      .where({ tenant: contextLike.tenantId, config_id: configRow.config_id })
      .update({ configuration_type: params.type });
  }

  if (params.type === 'Hourly') {
    if (await hasSchemaTable(contextLike.db, 'contract_line_service_hourly_configs')) {
      await tenantTable(contextLike.db, contextLike.tenantId, 'contract_line_service_hourly_configs')
        .insert({
          tenant: contextLike.tenantId,
          config_id: configRow.config_id,
          // hourly_rate is stored in cents (the engine bills it as-is)
          hourly_rate: params.baseRateCents,
          minimum_billable_time: 15,
          round_up_to_nearest: 15,
          created_at: now,
          updated_at: now,
        })
        .onConflict(['tenant', 'config_id'])
        .merge({
          hourly_rate: params.baseRateCents,
          minimum_billable_time: 15,
          round_up_to_nearest: 15,
          updated_at: now,
        });
    }

    if (await hasSchemaTable(contextLike.db, 'contract_line_service_hourly_config')) {
      await tenantTable(contextLike.db, contextLike.tenantId, 'contract_line_service_hourly_config')
        .insert({
          tenant: contextLike.tenantId,
          config_id: configRow.config_id,
          minimum_billable_time: 15,
          round_up_to_nearest: 15,
          enable_overtime: false,
          overtime_rate: null,
          overtime_threshold: null,
          enable_after_hours_rate: false,
          after_hours_multiplier: null,
          created_at: now,
          updated_at: now,
        })
        .onConflict(['tenant', 'config_id'])
        .merge({
          minimum_billable_time: 15,
          round_up_to_nearest: 15,
          enable_overtime: false,
          overtime_rate: null,
          overtime_threshold: null,
          enable_after_hours_rate: false,
          after_hours_multiplier: null,
          updated_at: now,
        });
    }
  } else if (await hasSchemaTable(contextLike.db, 'contract_line_service_usage_config')) {
    await tenantTable(contextLike.db, contextLike.tenantId, 'contract_line_service_usage_config')
      .insert({
        tenant: contextLike.tenantId,
        config_id: configRow.config_id,
        unit_of_measure: 'unit',
        enable_tiered_pricing: false,
        minimum_usage: 0,
        base_rate: params.baseRateCents / 100,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['tenant', 'config_id'])
      .merge({
        unit_of_measure: 'unit',
        enable_tiered_pricing: false,
        minimum_usage: 0,
        base_rate: params.baseRateCents / 100,
        updated_at: now,
      });
  }
}

async function createRecurringCatalogLine(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  options: RecurringCatalogLineOptions
): Promise<{ serviceId: string; contractLineId: string; clientContractLineId: string; contractId: string; clientContractId: string }> {
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'fixed',
    default_rate: options.baseRateCents,
    unit_of_measure: options.isLicense ? 'seat' : 'item',
    tax_region: 'US-NY'
  });

  await tenantTable(contextLike.db, contextLike.tenantId, 'service_catalog')
    .where({ tenant: contextLike.tenantId, service_id: serviceId })
    .update({
      item_kind: 'product',
      is_license: Boolean(options.isLicense)
    });

  await tenantTable(contextLike.db, contextLike.tenantId, 'service_prices')
    .insert({
      tenant: contextLike.tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: options.baseRateCents,
      effective_date: '1970-01-01',
      created_at: contextLike.db.fn.now(),
      updated_at: contextLike.db.fn.now()
    })
    .onConflict(['tenant', 'service_id', 'currency_code', 'effective_date'])
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
    contractLineId: result.contractLineId,
    clientContractLineId: result.clientContractLineId,
    contractId: result.contractId,
    clientContractId: result.clientContractId
  };
}

/**
 * The post-cutover billing engine only prices time entries and usage records
 * from currency-tagged service_prices rows (or explicit custom rates); the
 * legacy currency-untagged service_catalog.default_rate is intentionally not
 * used (see billingEngine calculateTimeBasedCharges/calculateUsageBasedCharges).
 * Mirror what production catalog management does and register a USD price.
 */
async function ensureUsdServicePrice(serviceId: string, rateCents: number): Promise<void> {
  await tenantTable(db, tenantId, 'service_prices')
    .insert({
      tenant: tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: rateCents,
      effective_date: '1970-01-01',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    })
    .onConflict(['tenant', 'service_id', 'currency_code', 'effective_date'])
    .merge({
      rate: rateCents,
      updated_at: db.fn.now()
    });
}

async function getInvoiceDetailRows(invoiceId: string) {
  return tenantDb(db, tenantId)
    .tenantJoin(
      tenantTable(db, tenantId, 'invoice_charge_details as iid'),
      'invoice_charges as ii',
      'iid.item_id',
      'ii.item_id'
    )
    .where('ii.invoice_id', invoiceId)
    .andWhere('iid.tenant', tenantId)
    .select([
      'iid.item_id',
      'iid.item_detail_id',
      'iid.service_id',
      'iid.service_period_start',
      'iid.service_period_end',
      'iid.billing_timing'
    ]);
}

async function createApprovedTimeEntryForContractLine(params: {
  clientId: string;
  serviceId: string;
  contractLineId?: string | null;
  startTime: string;
  endTime: string;
  approvalStatus?: 'APPROVED' | 'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUESTED' | null;
  invoiced?: boolean;
  billableDuration?: number;
}) {
  const userId = await createUser(db, tenantId, {
    user_type: 'internal',
    email: `${uuidv4()}@time-entry.test`,
  });
  const ticketId = await createTicketWorkItemForClient({
    clientId: params.clientId,
    assignedTo: userId,
  });

  const entry = await createTestTimeEntry(db, tenantId, {
    work_item_id: ticketId,
    work_item_type: 'ticket',
    service_id: params.serviceId,
    user_id: userId,
    approval_status: params.approvalStatus ?? 'APPROVED',
    contract_line_id: params.contractLineId ?? null,
    start_time: new Date(params.startTime),
    end_time: new Date(params.endTime),
    invoiced: params.invoiced ?? false,
    billable_duration:
      params.billableDuration !== undefined
        ? params.billableDuration
        : undefined,
  });

  if (params.approvalStatus === null) {
    await tenantTable(db, tenantId, 'time_entries')
      .where({ tenant: tenantId, entry_id: entry.entry_id })
      .update({ approval_status: null });
  }

  return entry;
}

async function createUsageRecordForContractLine(params: {
  clientId: string;
  serviceId: string;
  contractLineId?: string | null;
  usageDate: string;
  quantity: number;
}) {
  const usageRecord = {
    tenant: tenantId,
    usage_id: uuidv4(),
    client_id: params.clientId,
    service_id: params.serviceId,
    contract_line_id: params.contractLineId,
    usage_date: params.usageDate,
    quantity: params.quantity,
    invoiced: false,
  };

  await tenantTable(db, tenantId, 'usage_tracking').insert(usageRecord);
  return usageRecord;
}

async function createTicketWorkItemForClient(params: {
  clientId: string;
  assignedTo: string;
}) {
  const board = await tenantTable(db, tenantId, 'boards')
    .where({ tenant: tenantId })
    .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'display_order', order: 'asc' }])
    .first('board_id');
  const status = await tenantTable(db, tenantId, 'statuses')
    .where({ tenant: tenantId, status_type: 'ticket' })
    .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'order_number', order: 'asc' }])
    .first('status_id');
  const priority = await tenantTable(db, tenantId, 'priorities')
    .where({ tenant: tenantId, item_type: 'ticket' })
    .orderBy('order_number', 'asc')
    .first('priority_id');

  if (!board?.board_id || !status?.status_id || !priority?.priority_id) {
    throw new Error('Expected seeded ticket board, status, and priority for hourly billing fixtures');
  }

  const ticketId = uuidv4();
  await tenantTable(db, tenantId, 'tickets').insert({
    tenant: tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${Date.now()}-${ticketId.slice(0, 6)}`,
    title: 'Recurring hourly billing work item',
    client_id: params.clientId,
    board_id: board.board_id,
    status_id: status.status_id,
    priority_id: priority.priority_id,
    assigned_to: params.assignedTo,
    entered_by: params.assignedTo,
    entered_at: new Date().toISOString(),
    ticket_origin: 'internal',
  });

  return ticketId;
}

async function getPersistedInvoice(invoiceId: string) {
  return tenantTable(db, tenantId, 'invoices')
    .where({ invoice_id: invoiceId, tenant: tenantId })
    .first(['invoice_id', 'billing_period_start', 'billing_period_end']);
}

async function upsertRecurringServicePeriodRecord(record: IRecurringServicePeriodRecord) {
  const linkage = record.invoiceLinkage;

  await tenantTable(db, tenantId, 'recurring_service_periods')
    .insert({
      record_id: record.recordId,
      tenant: record.sourceObligation.tenant,
      schedule_key: record.scheduleKey,
      period_key: record.periodKey,
      revision: record.revision,
      obligation_id: record.sourceObligation.obligationId,
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

function normalizeTimestampValue(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return new Date(value as any).toISOString();
  } catch (_error) {
    return null;
  }
}

function normalizeDateOnlyValue(value: unknown): string | null {
  const normalizedTimestamp = normalizeTimestampValue(value);
  return normalizedTimestamp ? normalizedTimestamp.slice(0, 10) : null;
}

function mapRecurringServicePeriodRowToRecord(row: any): IRecurringServicePeriodRecord {
  return {
    kind: 'persisted_service_period_record',
    recordId: row.record_id,
    scheduleKey: row.schedule_key,
    periodKey: row.period_key,
    revision: Number(row.revision),
    sourceObligation: {
      tenant: row.tenant,
      obligationId: row.obligation_id,
      chargeFamily: row.charge_family,
    },
    cadenceOwner: row.cadence_owner,
    duePosition: row.due_position,
    lifecycleState: row.lifecycle_state,
    servicePeriod: {
      start: normalizeDateOnlyValue(row.service_period_start)!,
      end: normalizeDateOnlyValue(row.service_period_end)!,
      semantics: 'half_open',
    },
    invoiceWindow: {
      start: normalizeDateOnlyValue(row.invoice_window_start)!,
      end: normalizeDateOnlyValue(row.invoice_window_end)!,
      semantics: 'half_open',
    },
    activityWindow:
      row.activity_window_start && row.activity_window_end
        ? {
            start: normalizeDateOnlyValue(row.activity_window_start)!,
            end: normalizeDateOnlyValue(row.activity_window_end)!,
            semantics: 'half_open',
          }
        : null,
    timingMetadata: row.timing_metadata ?? null,
    provenance: {
      kind: row.provenance_kind,
      sourceRuleVersion: row.source_rule_version,
      reasonCode: row.reason_code ?? null,
      sourceRunKey: row.source_run_key ?? null,
      supersedesRecordId: row.supersedes_record_id ?? null,
    },
    invoiceLinkage:
      row.invoice_id && row.invoice_charge_id && row.invoice_charge_detail_id && row.invoice_linked_at
        ? {
            invoiceId: row.invoice_id,
            invoiceChargeId: row.invoice_charge_id,
            invoiceChargeDetailId: row.invoice_charge_detail_id,
            linkedAt: normalizeTimestampValue(row.invoice_linked_at)!,
          }
        : null,
    createdAt: normalizeTimestampValue(row.created_at)!,
    updatedAt: normalizeTimestampValue(row.updated_at)!,
  };
}

async function loadRecurringServicePeriodRecords(params: {
  obligationId?: string;
  scheduleKeys?: string[];
}) {
  let query = tenantTable(db, tenantId, 'recurring_service_periods')
    .where({ tenant: tenantId })
    .select([
      'record_id',
      'tenant',
      'schedule_key',
      'period_key',
      'revision',
      'obligation_id',
      'charge_family',
      'cadence_owner',
      'due_position',
      'lifecycle_state',
      'service_period_start',
      'service_period_end',
      'invoice_window_start',
      'invoice_window_end',
      'activity_window_start',
      'activity_window_end',
      'timing_metadata',
      'provenance_kind',
      'source_rule_version',
      'reason_code',
      'source_run_key',
      'supersedes_record_id',
      'invoice_id',
      'invoice_charge_id',
      'invoice_charge_detail_id',
      'invoice_linked_at',
      'created_at',
      'updated_at',
    ]);

  if (params.obligationId) {
    query = query.andWhere('obligation_id', params.obligationId);
  }

  if (params.scheduleKeys?.length) {
    query = query.whereIn('schedule_key', params.scheduleKeys);
  }

  const rows = await query.orderBy([
    { column: 'service_period_start', order: 'asc' },
    { column: 'service_period_end', order: 'asc' },
    { column: 'revision', order: 'asc' },
  ]);

  return rows.map(mapRecurringServicePeriodRowToRecord);
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

  await tenantTable(db, tenantId, 'invoices').insert({
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

  await tenantTable(db, tenantId, 'invoice_charges').insert({
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

  await tenantTable(db, tenantId, 'invoice_charge_details').insert({
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

function dateOnlyOf(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Billing Timing Integration Tenant',
    email: 'billing-timing@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
