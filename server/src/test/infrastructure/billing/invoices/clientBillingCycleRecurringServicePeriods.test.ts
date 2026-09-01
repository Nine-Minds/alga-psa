import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createClientContractLineCycles } from '../../../../../../packages/billing/src/lib/billing/createBillingCycles';
import { TestContext } from 'server/test-utils/testContext';
import { assignContractLineToClient } from '../../../../../test-utils/billingTestHelpers';
import { seedBillingCycle } from '../../../../../test-utils/billingProfileTestHelpers';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

const dateOnly = (value: unknown) => new Date(value as string | Date).toISOString().slice(0, 10);

describe('Client billing-cycle recurring service-period replenishment', () => {
  let context: TestContext;

  async function createClientCadenceLine(options: {
    startDate?: string;
    endDate?: string | null;
    billingTiming?: 'arrears' | 'advance';
    name?: string;
    contractActive?: boolean;
    lineActive?: boolean;
  } = {}) {
    const contractLineId = await context.createEntity('contract_lines', {
      contract_line_name: options.name ?? `Client Cadence Line ${uuidv4().slice(0, 8)}`,
      billing_frequency: 'monthly',
      billing_timing: options.billingTiming ?? 'arrears',
      is_custom: false,
      contract_line_type: 'Fixed',
      cadence_owner: 'client',
      is_active: options.lineActive ?? true,
    }, 'contract_line_id');

    await assignContractLineToClient(context, contractLineId, {
      startDate: options.startDate ?? '2026-07-01T00:00:00Z',
      endDate: options.endDate ?? null,
      contractHeaderIsActive: options.contractActive ?? true,
      materializeServicePeriods: false,
    });

    return contractLineId;
  }

  async function seedCycle(start: string, end: string) {
    const billingCycleId = uuidv4();
    await seedBillingCycle(context.db, context.tenantId, {
      billing_cycle_id: billingCycleId,
      tenant: context.tenantId,
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: start,
      period_start_date: start,
      period_end_date: end,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return billingCycleId;
  }

  async function loadPeriods(obligationId: string) {
    return context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, obligation_id: obligationId })
      .orderBy('service_period_start', 'asc')
      .orderBy('revision', 'asc');
  }

  async function insertHistoricalPeriod(input: {
    recordId: string;
    obligationId: string;
    revision: number;
    lifecycleState: 'billed' | 'superseded';
    provenanceKind: 'generated' | 'regenerated';
    supersedesRecordId?: string | null;
    invoiceLinkage?: {
      invoiceId: string;
      invoiceChargeId: string;
      invoiceChargeDetailId: string;
      linkedAt: string;
    };
    createdAt: string;
    updatedAt: string;
  }) {
    await context.db('recurring_service_periods').insert({
      record_id: input.recordId,
      tenant: context.tenantId,
      schedule_key: `schedule:${context.tenantId}:client_contract_line:${input.obligationId}:client:arrears`,
      period_key: 'period:2026-06-01:2026-07-01',
      revision: input.revision,
      obligation_id: input.obligationId,
      obligation_type: 'client_contract_line',
      charge_family: 'fixed',
      cadence_owner: 'client',
      due_position: 'arrears',
      lifecycle_state: input.lifecycleState,
      service_period_start: '2026-06-01',
      service_period_end: '2026-07-01',
      invoice_window_start: '2026-07-01',
      invoice_window_end: '2026-08-01',
      activity_window_start: null,
      activity_window_end: null,
      timing_metadata: null,
      provenance_kind: input.provenanceKind,
      source_rule_version: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
      reason_code: input.provenanceKind === 'regenerated' ? 'billing_schedule_changed' : 'initial_materialization',
      source_run_key: 'historical-test-run',
      supersedes_record_id: input.supersedesRecordId ?? null,
      invoice_id: input.invoiceLinkage?.invoiceId ?? null,
      invoice_charge_id: input.invoiceLinkage?.invoiceChargeId ?? null,
      invoice_charge_detail_id: input.invoiceLinkage?.invoiceChargeDetailId ?? null,
      invoice_linked_at: input.invoiceLinkage?.linkedAt ?? null,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'recurring_service_periods',
        'client_billing_cycles',
        'client_billing_settings',
      ],
      clientName: 'Recurring Period Replenishment Client',
      userType: 'internal',
    });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));

    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ billing_cycle: 'monthly' });
    context.client.billing_cycle = 'monthly';
  }, 30000);

  afterEach(async () => {
    vi.useRealTimers();
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('replenishes the arrears period due in a newly advanced client cycle', async () => {
    const obligationId = await createClientCadenceLine({
      startDate: '2026-06-01T00:00:00Z',
      billingTiming: 'arrears',
    });
    await seedCycle('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');

    const result = await createClientContractLineCycles(context.db, context.client);

    expect(result).toEqual({ success: true });
    const advancedCycle = await context.db('client_billing_cycles')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .andWhere('period_start_date', '2026-08-01T00:00:00Z')
      .first();
    expect(advancedCycle).toBeTruthy();
    expect(dateOnly(advancedCycle.period_end_date)).toBe('2026-09-01');

    const duePeriod = (await loadPeriods(obligationId)).find((row) =>
      dateOnly(row.service_period_start) === '2026-07-01'
      && dateOnly(row.service_period_end) === '2026-08-01'
      && row.lifecycle_state !== 'superseded',
    );
    expect(duePeriod).toBeTruthy();
    expect(dateOnly(duePeriod.invoice_window_start)).toBe('2026-08-01');
    expect(dateOnly(duePeriod.invoice_window_end)).toBe('2026-09-01');
    expect(duePeriod.due_position).toBe('arrears');
  });

  it('replenishes the advance period due in a newly advanced client cycle', async () => {
    const obligationId = await createClientCadenceLine({
      startDate: '2026-07-01T00:00:00Z',
      billingTiming: 'advance',
    });
    await seedCycle('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');

    await createClientContractLineCycles(context.db, context.client);

    const duePeriod = (await loadPeriods(obligationId)).find((row) =>
      dateOnly(row.service_period_start) === '2026-08-01'
      && dateOnly(row.service_period_end) === '2026-09-01'
      && row.lifecycle_state !== 'superseded',
    );
    expect(duePeriod).toBeTruthy();
    expect(dateOnly(duePeriod.invoice_window_start)).toBe('2026-08-01');
    expect(dateOnly(duePeriod.invoice_window_end)).toBe('2026-09-01');
    expect(duePeriod.due_position).toBe('advance');
  });

  it('heals a no-op nightly pass and repeated runs do not add cycles, revisions, or superseded rows', async () => {
    const obligationId = await createClientCadenceLine({ startDate: '2026-07-01T00:00:00Z' });
    await seedCycle('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');

    await createClientContractLineCycles(context.db, context.client);

    const firstCycles = await context.db('client_billing_cycles')
      .where({ tenant: context.tenantId, client_id: context.clientId });
    const firstRows = await loadPeriods(obligationId);
    expect(firstCycles).toHaveLength(1);
    expect(firstRows.length).toBeGreaterThan(1);
    expect(firstRows.some((row) => dateOnly(row.service_period_start) === '2026-07-01')).toBe(true);

    await createClientContractLineCycles(context.db, context.client);

    const secondCycles = await context.db('client_billing_cycles')
      .where({ tenant: context.tenantId, client_id: context.clientId });
    const secondRows = await loadPeriods(obligationId);
    expect(secondCycles).toHaveLength(firstCycles.length);
    expect(secondRows).toEqual(firstRows);
    expect(secondRows.filter((row) => row.lifecycle_state === 'superseded')).toHaveLength(0);
    expect(new Set(secondRows.map((row) => `${row.schedule_key}:${row.period_key}`)).size).toBe(secondRows.length);
  });

  it('replenishes every active line while skipping inactive contracts and contract lines', async () => {
    const firstObligationId = await createClientCadenceLine({
      startDate: '2026-06-01T00:00:00Z',
      name: 'First Active Line',
    });
    const secondObligationId = await createClientCadenceLine({
      startDate: '2026-07-01T00:00:00Z',
      name: 'Second Active Line',
    });
    const inactiveContractObligationId = await createClientCadenceLine({
      startDate: '2026-06-01T00:00:00Z',
      name: 'Inactive Contract Line',
      contractActive: false,
    });
    const inactiveLineObligationId = await createClientCadenceLine({
      startDate: '2026-06-01T00:00:00Z',
      name: 'Inactive Line',
      lineActive: false,
    });
    await seedCycle('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');

    await createClientContractLineCycles(context.db, context.client);

    for (const obligationId of [firstObligationId, secondObligationId]) {
      const rows = await loadPeriods(obligationId);
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.every((row) => row.obligation_id === obligationId)).toBe(true);
      expect(rows.some((row) =>
        dateOnly(row.service_period_start) === '2026-07-01'
        && dateOnly(row.invoice_window_start) === '2026-08-01',
      )).toBe(true);
    }

    for (const obligationId of [inactiveContractObligationId, inactiveLineObligationId]) {
      const liveRows = (await loadPeriods(obligationId))
        .filter((row) => row.lifecycle_state !== 'superseded');
      expect(liveRows).toHaveLength(0);
    }
  });

  it('preserves billed audit history and superseded revisions while filling future gaps', async () => {
    const obligationId = await createClientCadenceLine({ startDate: '2026-06-01T00:00:00Z' });
    await seedCycle('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');

    const supersededRecordId = uuidv4();
    const billedRecordId = uuidv4();
    const invoiceLinkage = {
      invoiceId: uuidv4(),
      invoiceChargeId: uuidv4(),
      invoiceChargeDetailId: uuidv4(),
      linkedAt: '2026-07-02T15:30:00Z',
    };
    await insertHistoricalPeriod({
      recordId: supersededRecordId,
      obligationId,
      revision: 1,
      lifecycleState: 'superseded',
      provenanceKind: 'generated',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-07-02T15:00:00Z',
    });
    await insertHistoricalPeriod({
      recordId: billedRecordId,
      obligationId,
      revision: 2,
      lifecycleState: 'billed',
      provenanceKind: 'regenerated',
      supersedesRecordId: supersededRecordId,
      invoiceLinkage,
      createdAt: '2026-07-02T15:00:00Z',
      updatedAt: '2026-07-02T15:30:00Z',
    });

    const before = await loadPeriods(obligationId);
    await createClientContractLineCycles(context.db, context.client);
    const after = await loadPeriods(obligationId);

    const billedBefore = before.find((row) => row.record_id === billedRecordId);
    const billedAfter = after.find((row) => row.record_id === billedRecordId);
    expect(billedAfter).toEqual(billedBefore);
    expect(billedAfter).toMatchObject({
      revision: 2,
      lifecycle_state: 'billed',
      supersedes_record_id: supersededRecordId,
      invoice_id: invoiceLinkage.invoiceId,
      invoice_charge_id: invoiceLinkage.invoiceChargeId,
      invoice_charge_detail_id: invoiceLinkage.invoiceChargeDetailId,
    });
    expect(after.find((row) => row.record_id === supersededRecordId)).toEqual(
      before.find((row) => row.record_id === supersededRecordId),
    );
    expect(after.some((row) =>
      row.lifecycle_state !== 'superseded'
      && dateOnly(row.service_period_start) === '2026-07-01'
      && dateOnly(row.service_period_end) === '2026-08-01',
    )).toBe(true);
  });

  it('clips assignment bounds and fills the configured generation horizon', async () => {
    const boundedObligationId = await createClientCadenceLine({
      startDate: '2026-07-15T00:00:00Z',
      endDate: '2026-11-15T00:00:00Z',
      name: 'Bounded Line',
    });
    const horizonObligationId = await createClientCadenceLine({
      startDate: '2026-07-01T00:00:00Z',
      name: 'Horizon Line',
    });
    await seedCycle('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');

    await createClientContractLineCycles(context.db, context.client);

    const boundedRows = await loadPeriods(boundedObligationId);
    expect(boundedRows.length).toBeGreaterThan(1);
    for (const row of boundedRows) {
      const effectiveStart = dateOnly(row.activity_window_start ?? row.service_period_start);
      const effectiveEnd = dateOnly(row.activity_window_end ?? row.service_period_end);
      expect(effectiveStart >= '2026-07-15').toBe(true);
      expect(effectiveEnd <= '2026-11-15').toBe(true);
    }
    expect(dateOnly(boundedRows[0].activity_window_start)).toBe('2026-07-15');
    expect(dateOnly(boundedRows.at(-1)?.activity_window_end)).toBe('2026-11-15');

    const horizonRows = await loadPeriods(horizonObligationId);
    const lastHorizonRow = horizonRows.at(-1);
    expect(horizonRows.length).toBeGreaterThan(5);
    expect(dateOnly(lastHorizonRow?.service_period_start) < '2027-02-03').toBe(true);
    expect(dateOnly(lastHorizonRow?.service_period_end) >= '2027-02-03').toBe(true);
  });
});
