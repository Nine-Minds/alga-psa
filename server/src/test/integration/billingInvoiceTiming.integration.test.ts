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
import { createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { Temporal } from '@js-temporal/polyfill';
import { BillingEngine } from '@alga-psa/billing/services';
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

let db: Knex;
let tenantId: string;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let generateInvoiceForSelectionInput: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoiceForSelectionInput;
let calculateBillingForSelectionInputAction: typeof import('@alga-psa/billing/actions/invoiceGeneration').calculateBillingForSelectionInput;
let previewInvoiceForSelectionInputAction: typeof import('@alga-psa/billing/actions/invoiceGeneration').previewInvoiceForSelectionInput;
let getAvailableRecurringDueWorkAction: typeof import('@alga-psa/billing/actions/billingAndTax').getAvailableRecurringDueWork;
let hardDeleteInvoiceAction: typeof import('@alga-psa/billing/actions/invoiceModification').hardDeleteInvoice;
let getInvoicedBillingCyclesPaginatedAction: typeof import('@alga-psa/billing/actions/billingCycleActions').getInvoicedBillingCyclesPaginated;
let reverseRecurringInvoiceAction: typeof import('@alga-psa/billing/actions/billingCycleActions').reverseRecurringInvoice;
let hardDeleteRecurringInvoiceAction: typeof import('@alga-psa/billing/actions/billingCycleActions').hardDeleteRecurringInvoice;
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
    ({
      generateInvoice,
      generateInvoiceForSelectionInput,
      calculateBillingForSelectionInput: calculateBillingForSelectionInputAction,
      previewInvoiceForSelectionInput: previewInvoiceForSelectionInputAction,
    } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({
      getAvailableRecurringDueWork: getAvailableRecurringDueWorkAction,
    } = await import('@alga-psa/billing/actions/billingAndTax'));
    ({ hardDeleteInvoice: hardDeleteInvoiceAction } = await import('@alga-psa/billing/actions/invoiceModification'));
    ({
      getInvoicedBillingCyclesPaginated: getInvoicedBillingCyclesPaginatedAction,
      reverseRecurringInvoice: reverseRecurringInvoiceAction,
      hardDeleteRecurringInvoice: hardDeleteRecurringInvoiceAction,
    } = await import('@alga-psa/billing/actions/billingCycleActions'));
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
    baseRateCents: 18500,
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
      obligationType: 'contract_line',
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

  const billedRow = await db('recurring_service_periods')
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
    baseRateCents: 22500,
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
      obligationType: 'contract_line',
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

  const billedRow = await db('recurring_service_periods')
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
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

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
    windowStart: '2025-02-08T00:00:00Z',
    windowEnd: '2025-03-08T00:00:00Z',
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
    expect(charge.billingTiming).toBe('advance');
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
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

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
    windowStart: '2025-02-08T00:00:00Z',
    windowEnd: '2025-03-08T00:00:00Z',
  });

  const invoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(invoice).toMatchObject({
    billing_cycle_id: null,
    subtotal: 0,
    total: 0,
  });
  expect(invoice?.invoice_charges ?? []).toHaveLength(0);
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
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

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
    windowStart: '2025-02-08T00:00:00Z',
    windowEnd: '2025-03-08T00:00:00Z',
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
    expect(charge.billingTiming).toBe('advance');
  }
}, HOOK_TIMEOUT);

it('T072: usage recurring charges with no usage inside the service period produce no recurring invoice line while preserving due-window identity', async () => {
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
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'contract',
  });

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
    windowStart: '2025-02-08T00:00:00Z',
    windowEnd: '2025-03-08T00:00:00Z',
  });

  const invoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(invoice).toMatchObject({
    billing_cycle_id: null,
    subtotal: 0,
    total: 0,
  });
  expect(invoice?.invoice_charges ?? []).toHaveLength(0);
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
    baseRateCents: 15000,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  const hourlyLine = await createHourlyContractLine(contextLike, {
    serviceName: 'Mixed Hourly Service',
    planName: 'Mixed Window Contract Hourly',
    baseRateCents: 12500,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
    contractId: fixedLine.contractId,
    clientContractId: fixedLine.clientContractId,
  });
  const usageLine = await createUsageContractLine(contextLike, {
    serviceName: 'Mixed Usage Service',
    planName: 'Mixed Window Contract Usage',
    baseRateCents: 700,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
    contractId: fixedLine.contractId,
    clientContractId: fixedLine.clientContractId,
  });

  await createApprovedTimeEntryForContractLine({
    clientId: contextLike.clientId,
    serviceId: hourlyLine.serviceId,
    contractLineId: hourlyLine.contractLineId,
    startTime: '2025-02-14T09:00:00.000Z',
    endTime: '2025-02-14T11:00:00.000Z',
  });
  await createUsageRecordForContractLine({
    clientId: contextLike.clientId,
    serviceId: usageLine.serviceId,
    contractLineId: usageLine.contractLineId,
    usageDate: '2025-02-20',
    quantity: 6,
  });

  const invoice = await generateInvoice(cycleId);
  expect(invoice).toBeTruthy();

  const invoiceChargeRows = await db('invoice_charges')
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
  expect(new Set(detailRows.map((row) => row.service_id))).toEqual(new Set([fixedLine.serviceId]));
  const detailRowsForCurrentWindow = detailRows.filter(
    (row) =>
      normalizeDateValue(row.service_period_start) === currentPeriodStart
      && normalizeDateValue(row.service_period_end) === currentPeriodEnd,
  );
  expect(detailRowsForCurrentWindow).toHaveLength(1);
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
    baseRateCents: 24500,
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
      obligationType: 'contract_line',
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

  const deletedInvoice = await db('invoices')
    .where({ tenant: tenantId, invoice_id: generatedInvoice!.invoice_id })
    .first(['invoice_id']);
  expect(deletedInvoice).toBeUndefined();

  const reopenedRow = await db('recurring_service_periods')
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

  const invoiceableRows = await db('recurring_service_periods')
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
    baseRateCents: 19900,
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
      obligationType: 'contract_line',
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
    baseRateCents: 22100,
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
      obligationType: 'contract_line',
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
    baseRateCents: 18800,
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
      obligationType: 'contract_line',
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

  expect(dueWork.rows.find((row) => row.clientName === 'Required Schema Client')).toBeUndefined();
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
    error: 'Recurring service periods were not materialized for this recurring execution window.',
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
    baseRateCents: 20100,
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
      obligationType: 'contract_line',
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

  const reopenedRow = await db('recurring_service_periods')
    .where({ tenant: tenantId, record_id: materializationPlan.records[0].recordId })
    .first(['lifecycle_state', 'invoice_id', 'invoice_charge_id', 'invoice_charge_detail_id']);
  expect(reopenedRow).toMatchObject({
    lifecycle_state: 'locked',
    invoice_id: null,
    invoice_charge_id: null,
    invoice_charge_detail_id: null,
  });

  const billingCycle = await db('client_billing_cycles')
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
    baseRateCents: 24500,
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
      obligationType: 'contract_line',
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

  const reopenedRow = await db('recurring_service_periods')
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
    baseRateCents: 20500,
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
      obligationType: 'contract_line',
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

  const preservedBillingCycle = await db('client_billing_cycles')
    .where({ tenant: tenantId, billing_cycle_id: clientSetup.cycleId })
    .first(['billing_cycle_id', 'is_active']);
  expect(preservedBillingCycle).toMatchObject({
    billing_cycle_id: clientSetup.cycleId,
    is_active: true,
  });

  const reopenedClientRow = await db('recurring_service_periods')
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
    baseRateCents: 24700,
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
      obligationType: 'contract_line',
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

  const reopenedContractRow = await db('recurring_service_periods')
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
    baseRateCents: 21400,
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
      obligationType: 'contract_line',
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
  const dueRow = dueWork.rows.find((row) =>
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

  await createFixedContractLine(contextLike, {
    serviceName: 'Client Happy Path Service',
    planName: 'Client Happy Path Plan',
    baseRateCents: 19800,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

  const dueWork = await getAvailableRecurringDueWorkAction({
    page: 1,
    pageSize: 10,
    searchTerm: 'Client Happy Path Reader',
  });
  const dueRow = dueWork.rows.find((row) =>
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
  expect(normalizeDateValue(historyRow?.servicePeriodEnd)).toBe(currentPeriodEnd);
  expect(normalizeDateValue(historyRow?.invoiceWindowStart)).toBe(currentPeriodStart);
  expect(normalizeDateValue(historyRow?.invoiceWindowEnd)).toBe(nextPeriodStart);
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
    baseRateCents: 16200,
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
      obligationType: 'contract_line',
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
    baseRateCents: 23600,
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
      obligationType: 'contract_line',
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
  const clientRow = dueWork.rows.find((row) => row.clientName === 'Mixed Batch Client Reader');
  const contractRow = dueWork.rows.find((row) =>
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
    baseRateCents: 24300,
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
      obligationType: 'contract_line',
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
  const reopenedRow = dueWork.rows.find((row) =>
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
    baseRateCents: 20700,
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
      obligationType: 'contract_line',
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
  const reopenedRow = dueWork.rows.find((row) =>
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
    baseRateCents: 24000,
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

  const generatedInvoice = await generateInvoiceForSelectionInput(selectorInput);
  expect(generatedInvoice).toBeTruthy();

  const persistedInvoices = await db('invoices')
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
  expect(recurringCharge?.recurring_projection).toMatchObject({
    source: 'canonical_detail_rows',
    detail_period_count: 1,
  });
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
    baseRateCents: 96000,
    startDate: currentPeriodStart,
    billingTiming: 'advance',
    billingFrequency: 'annually',
    cadenceOwner: 'contract',
  });

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
  expect(recurringCharge?.recurring_projection).toMatchObject({
    source: 'canonical_detail_rows',
    detail_period_count: 1,
  });
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
    baseRateCents: 17500,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });

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
    expect(recurringCharge?.recurring_projection).toMatchObject({
      source: 'canonical_detail_rows',
      detail_period_count: 1,
    });
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

  const linkedDetailRow = await db('invoice_charge_details')
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
    baseRateCents: 20500,
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
      obligationType: 'client_contract_line',
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
    baseRateCents: 21500,
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
      obligationType: 'client_contract_line',
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

  const configRow = await db('contract_line_service_configuration')
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

  const billedHistoryRow = await db('recurring_service_periods')
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
    baseRateCents: 22500,
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
      obligationType: 'client_contract_line',
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

  await db('default_billing_settings')
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
    baseRateCents: 23500,
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
      obligationType: 'contract_line',
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
    baseRateCents: 24500,
    startDate: '2024-12-01',
    billingTiming: 'advance',
    billingFrequency: 'monthly',
    cadenceOwner: 'client',
  });
  const contractCadenceLine = await createFixedContractLine(contextLike, {
    serviceName: 'Persisted Mixed Contract Service',
    planName: 'Persisted Mixed Contract Plan',
    baseRateCents: 25500,
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
      obligationType: 'contract_line',
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
      obligationType: 'contract_line',
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

  const mixedRows = await db('recurring_service_periods')
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

async function createHourlyContractLine(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  options: FixedLineOptions,
): Promise<{ serviceId: string; contractLineId: string; clientContractLineId: string; contractId: string; clientContractId: string }> {
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'hourly',
    default_rate: options.baseRateCents,
    unit_of_measure: 'hour',
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
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'usage',
    default_rate: options.baseRateCents,
    unit_of_measure: 'unit',
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
  const configRow = await contextLike.db('contract_line_service_configuration')
    .where({
      tenant: contextLike.tenantId,
      contract_line_id: params.contractLineId,
      service_id: params.serviceId,
    })
    .first('config_id');

  if (!configRow?.config_id) {
    throw new Error(`Missing configuration for contract line ${params.contractLineId}`);
  }

  await contextLike.db('contract_lines')
    .where({ tenant: contextLike.tenantId, contract_line_id: params.contractLineId })
    .update({ contract_line_type: params.type });

  if (await contextLike.db.schema.hasTable('billing_plans')) {
    await contextLike.db('billing_plans')
      .where({ tenant: contextLike.tenantId, plan_id: params.contractLineId })
      .update({ plan_type: params.type });
  }

  await contextLike.db('contract_line_service_configuration')
    .where({ tenant: contextLike.tenantId, config_id: configRow.config_id })
    .update({ configuration_type: params.type });

  if (await contextLike.db.schema.hasTable('plan_service_configuration')) {
    await contextLike.db('plan_service_configuration')
      .where({ tenant: contextLike.tenantId, config_id: configRow.config_id })
      .update({ configuration_type: params.type });
  }

  if (params.type === 'Hourly') {
    if (await contextLike.db.schema.hasTable('contract_line_service_hourly_configs')) {
      await contextLike.db('contract_line_service_hourly_configs')
        .insert({
          tenant: contextLike.tenantId,
          config_id: configRow.config_id,
          hourly_rate: params.baseRateCents / 100,
          minimum_billable_time: 15,
          round_up_to_nearest: 15,
          created_at: now,
          updated_at: now,
        })
        .onConflict(['tenant', 'config_id'])
        .merge({
          hourly_rate: params.baseRateCents / 100,
          minimum_billable_time: 15,
          round_up_to_nearest: 15,
          updated_at: now,
        });
    }

    if (await contextLike.db.schema.hasTable('contract_line_service_hourly_config')) {
      await contextLike.db('contract_line_service_hourly_config')
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
  } else if (await contextLike.db.schema.hasTable('contract_line_service_usage_config')) {
    await contextLike.db('contract_line_service_usage_config')
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
  contractLineId: string;
  startTime: string;
  endTime: string;
}) {
  const userId = await createUser(db, tenantId, {
    user_type: 'internal',
    email: `${uuidv4()}@time-entry.test`,
  });
  const ticketId = await createTicketWorkItemForClient({
    clientId: params.clientId,
    assignedTo: userId,
  });

  return createTestTimeEntry(db, tenantId, {
    work_item_id: ticketId,
    work_item_type: 'ticket',
    service_id: params.serviceId,
    user_id: userId,
    approval_status: 'APPROVED',
    contract_line_id: params.contractLineId,
    start_time: new Date(params.startTime),
    end_time: new Date(params.endTime),
    invoiced: false,
  });
}

async function createUsageRecordForContractLine(params: {
  clientId: string;
  serviceId: string;
  contractLineId: string;
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

  await db('usage_tracking').insert(usageRecord);
  return usageRecord;
}

async function createTicketWorkItemForClient(params: {
  clientId: string;
  assignedTo: string;
}) {
  const board = await db('boards')
    .where({ tenant: tenantId })
    .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'display_order', order: 'asc' }])
    .first('board_id');
  const status = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket' })
    .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'order_number', order: 'asc' }])
    .first('status_id');
  const priority = await db('priorities')
    .where({ tenant: tenantId, item_type: 'ticket' })
    .orderBy('order_number', 'asc')
    .first('priority_id');

  if (!board?.board_id || !status?.status_id || !priority?.priority_id) {
    throw new Error('Expected seeded ticket board, status, and priority for hourly billing fixtures');
  }

  const ticketId = uuidv4();
  await db('tickets').insert({
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
      obligationType: row.obligation_type,
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
  let query = db('recurring_service_periods')
    .where({ tenant: tenantId })
    .select([
      'record_id',
      'tenant',
      'schedule_key',
      'period_key',
      'revision',
      'obligation_id',
      'obligation_type',
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
