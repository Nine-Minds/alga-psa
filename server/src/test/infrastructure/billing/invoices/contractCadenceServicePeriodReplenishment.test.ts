import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TestContext } from 'server/test-utils/testContext';
import { assignContractLineToClient } from '../../../../../test-utils/billingTestHelpers';
import {
  replenishContractCadenceServicePeriodsSweep,
  runContractCadenceReplenishmentForTenant,
} from '@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization';

/**
 * DB-backed behavior for the nightly contract-cadence replenishment. The
 * primary fixture reproduces the production incident state (a monthly,
 * contract-cadence, arrears line whose ledger stops at 2026-08-08) and asserts
 * the next successful run recovers the missing period and re-establishes the
 * rolling horizon without touching billed/locked/superseded history.
 *
 * All writes go through the canonical synchronization path; the assertions are
 * on persisted recurring_service_periods rows and on the absence of invoices.
 */

const dateOnly = (value: unknown) => new Date(value as string | Date).toISOString().slice(0, 10);

const CLOUDLAB = {
  contractLineId: '90528e81-9f06-410d-8e32-61f148305af0',
  contractId: '2591c219-b976-49c8-a009-cf6df59f677a',
  assignmentId: '7382c090-5129-44a6-8aa1-775390c6a456',
  assignmentStart: '2026-02-08T00:00:00Z',
  rateCents: 1262860,
  invoiceNumber: '0001850',
  billedInvoiceId: '8023a611-fd0e-4713-8f21-706dd608130c',
  billedChargeDetailId: '27d20203-9b5b-4395-8600-73bff5e5b448',
} as const;

describe('Contract-cadence service-period replenishment', () => {
  let context: TestContext;

  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext,
  } = TestContext.createHelpers();

  async function createContractCadenceLine(options: {
    name?: string;
    startDate?: string;
    endDate?: string | null;
    billingTiming?: 'advance' | 'arrears';
    billingFrequency?: 'monthly' | 'quarterly' | 'semi-annually' | 'annually';
    lineActive?: boolean;
    contractActive?: boolean;
    assignmentActive?: boolean;
    contractHeaderStatus?: string;
    contractLineId?: string;
    contractId?: string;
    assignmentId?: string;
    rateCents?: number;
  } = {}) {
    const contractLineId = options.contractLineId ?? uuidv4();
    await context.createEntity(
      'contract_lines',
      {
        contract_line_id: contractLineId,
        contract_line_name: options.name ?? `Contract Cadence Line ${contractLineId.slice(0, 8)}`,
        billing_frequency: options.billingFrequency ?? 'monthly',
        billing_timing: options.billingTiming ?? 'arrears',
        is_custom: false,
        contract_line_type: 'Fixed',
        cadence_owner: 'contract',
        is_active: options.lineActive ?? true,
        custom_rate: options.rateCents ?? CLOUDLAB.rateCents,
      },
      'contract_line_id',
    );

    await assignContractLineToClient(context, contractLineId, {
      contractId: options.contractId,
      clientContractId: options.assignmentId,
      startDate: options.startDate ?? '2026-02-08T00:00:00Z',
      endDate: options.endDate ?? null,
      contractHeaderIsActive: options.contractActive ?? true,
      contractHeaderStatus: options.contractHeaderStatus ?? 'Active',
      isActive: options.assignmentActive ?? true,
      assignmentStatus: 'pending',
      materializeServicePeriods: false,
    });

    return contractLineId;
  }

  async function seedContractPeriod(input: {
    recordId?: string;
    obligationId: string;
    serviceStart: string;
    serviceEnd: string;
    invoiceStart: string;
    invoiceEnd: string;
    duePosition?: 'advance' | 'arrears';
    lifecycleState: 'generated' | 'billed' | 'locked' | 'superseded' | 'skipped' | 'edited';
    provenanceKind?: 'generated' | 'regenerated' | 'user_edited' | 'repair';
    reasonCode?: string | null;
    invoiceLinkage?: {
      invoiceId: string;
      invoiceChargeId: string;
      invoiceChargeDetailId: string;
      linkedAt: string;
    } | null;
    revision?: number;
    supersedesRecordId?: string | null;
    tenant?: string;
  }) {
    const tenant = input.tenant ?? context.tenantId;
    const duePosition = input.duePosition ?? 'arrears';
    const recordId = input.recordId ?? uuidv4();
    await context.db('recurring_service_periods').insert({
      record_id: recordId,
      tenant,
      schedule_key: `schedule:${tenant}:contract_line:${input.obligationId}:contract:${duePosition}`,
      period_key: `period:${dateOnly(input.serviceStart)}:${dateOnly(input.serviceEnd)}`,
      revision: input.revision ?? 1,
      obligation_id: input.obligationId,
      obligation_type: 'contract_line',
      charge_family: 'fixed',
      cadence_owner: 'contract',
      due_position: duePosition,
      lifecycle_state: input.lifecycleState,
      service_period_start: dateOnly(input.serviceStart),
      service_period_end: dateOnly(input.serviceEnd),
      invoice_window_start: dateOnly(input.invoiceStart),
      invoice_window_end: dateOnly(input.invoiceEnd),
      activity_window_start: null,
      activity_window_end: null,
      timing_metadata: null,
      provenance_kind: input.provenanceKind ?? 'generated',
      source_rule_version:
        'contract_cadence|billing_cycle:monthly|anchor:2026-02-08|due:arrears',
      reason_code: input.reasonCode ?? 'initial_materialization',
      source_run_key: 'contract_line_update:90528e81-9f06-410d-8e32-61f148305af0:2026-04-15T03:45:06.058Z',
      supersedes_record_id: input.supersedesRecordId ?? null,
      invoice_id: input.invoiceLinkage?.invoiceId ?? null,
      invoice_charge_id: input.invoiceLinkage?.invoiceChargeId ?? null,
      invoice_charge_detail_id: input.invoiceLinkage?.invoiceChargeDetailId ?? null,
      invoice_linked_at: input.invoiceLinkage?.linkedAt ?? null,
      created_at: '2026-04-15T03:45:06.058Z',
      updated_at: input.lifecycleState === 'locked' ? '2026-09-14T00:00:00Z' : '2026-04-15T03:45:06.058Z',
    });
    return recordId;
  }

  async function seedIncidentLedger(obligationId: string) {
    // Feb 8 – Mar 8 is intentionally locked with no invoice linkage.
    await seedContractPeriod({
      obligationId,
      serviceStart: '2026-02-08',
      serviceEnd: '2026-03-08',
      invoiceStart: '2026-03-08',
      invoiceEnd: '2026-04-08',
      lifecycleState: 'locked',
      reasonCode: null,
    });

    const billedPeriods: Array<[string, string, string, string]> = [
      ['2026-03-08', '2026-04-08', '2026-04-08', '2026-05-08'],
      ['2026-04-08', '2026-05-08', '2026-05-08', '2026-06-08'],
      ['2026-05-08', '2026-06-08', '2026-06-08', '2026-07-08'],
      ['2026-06-08', '2026-07-08', '2026-07-08', '2026-08-08'],
      ['2026-07-08', '2026-08-08', '2026-08-08', '2026-09-08'],
    ];

    for (const [serviceStart, serviceEnd, invoiceStart, invoiceEnd] of billedPeriods) {
      const isLast = serviceEnd === '2026-08-08';
      await seedContractPeriod({
        obligationId,
        serviceStart,
        serviceEnd,
        invoiceStart,
        invoiceEnd,
        lifecycleState: 'billed',
        provenanceKind: 'regenerated',
        reasonCode: 'source_rule_changed',
        invoiceLinkage: {
          invoiceId: isLast ? CLOUDLAB.billedInvoiceId : uuidv4(),
          invoiceChargeId: uuidv4(),
          invoiceChargeDetailId: isLast ? CLOUDLAB.billedChargeDetailId : uuidv4(),
          linkedAt: isLast ? '2026-08-13T04:02:55.799Z' : '2026-05-01T00:00:00.000Z',
        },
      });
    }
  }

  async function seedSupersededClientCadenceHistory(obligationId: string) {
    // The April operator repair created client-cadence rows that were superseded
    // when the line moved to contract cadence. They must never be revived.
    await context.db('recurring_service_periods').insert({
      record_id: uuidv4(),
      tenant: context.tenantId,
      schedule_key: `schedule:${context.tenantId}:client_contract_line:${obligationId}:client:arrears`,
      period_key: 'period:2026-08-01:2026-09-01',
      revision: 1,
      obligation_id: obligationId,
      obligation_type: 'client_contract_line',
      charge_family: 'fixed',
      cadence_owner: 'client',
      due_position: 'arrears',
      lifecycle_state: 'superseded',
      service_period_start: '2026-08-01',
      service_period_end: '2026-09-01',
      invoice_window_start: '2026-09-01',
      invoice_window_end: '2026-10-01',
      activity_window_start: null,
      activity_window_end: null,
      timing_metadata: null,
      provenance_kind: 'generated',
      source_rule_version: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
      reason_code: 'initial_materialization',
      source_run_key: 'operator-repair:april',
      supersedes_record_id: null,
      invoice_id: null,
      invoice_charge_id: null,
      invoice_charge_detail_id: null,
      invoice_linked_at: null,
      created_at: '2026-04-15T03:45:06.058Z',
      updated_at: '2026-04-15T03:45:06.058Z',
    });
  }

  async function loadContractPeriods(obligationId: string) {
    return context.db('recurring_service_periods')
      .where({
        tenant: context.tenantId,
        obligation_id: obligationId,
        obligation_type: 'contract_line',
        cadence_owner: 'contract',
      })
      .orderBy('service_period_start', 'asc')
      .orderBy('revision', 'asc');
  }

  async function invoiceCount() {
    const row = await context.db('invoices')
      .where({ tenant: context.tenantId })
      .count('* as count')
      .first();
    return Number(row?.count ?? 0);
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'recurring_service_periods',
        'client_billing_cycles',
        'client_billing_settings',
      ],
      clientName: 'Contract Cadence Replenishment Client',
      userType: 'internal',
    });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
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

  it('recovers the missing Aug 8–Sep 8 period and establishes future coverage while preserving history', async () => {
    const obligationId = await createContractCadenceLine({ contractLineId: CLOUDLAB.contractLineId });
    await seedIncidentLedger(obligationId);
    await seedSupersededClientCadenceHistory(obligationId);

    const before = await loadContractPeriods(obligationId);
    const beforeInvoices = await invoiceCount();
    const lockedBefore = before.find((row) => row.lifecycle_state === 'locked');
    const billedBefore = before.filter((row) => row.lifecycle_state === 'billed');

    const summary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    expect(summary.failures).toEqual([]);
    expect(summary.linesExamined).toBeGreaterThanOrEqual(1);
    expect(summary.periodsGenerated).toBeGreaterThanOrEqual(1);
    expect(summary.asOf).toBe('2026-09-15T00:00:00Z');
    // The incident line was already exhausted before the run, which is exactly
    // the signal the old nightly silently missed.
    expect(summary.linesExhaustedBeforeRun).toBeGreaterThanOrEqual(1);
    expect(summary.linesAwaitingCoverage).toBe(0);

    const after = await loadContractPeriods(obligationId);
    const recovered = after.find(
      (row) =>
        row.lifecycle_state !== 'superseded'
        && dateOnly(row.service_period_start) === '2026-08-08'
        && dateOnly(row.service_period_end) === '2026-09-08',
    );
    expect(recovered).toBeTruthy();
    expect(recovered.lifecycle_state).toBe('generated');
    expect(dateOnly(recovered.invoice_window_start)).toBe('2026-09-08');
    expect(dateOnly(recovered.invoice_window_end)).toBe('2026-10-08');

    // Future coverage reaches today + 180d (2027-03-14) rather than stopping at
    // the first recovered period.
    const active = after.filter((row) => row.lifecycle_state !== 'superseded');
    const furthest = active
      .map((row) => dateOnly(row.service_period_end))
      .sort()
      .at(-1);
    expect(furthest >= '2027-03-14').toBe(true);

    // Billed and locked history is byte-for-byte untouched.
    expect(after.find((row) => row.record_id === lockedBefore.record_id)).toEqual(lockedBefore);
    for (const billed of billedBefore) {
      expect(after.find((row) => row.record_id === billed.record_id)).toEqual(billed);
    }
    expect(after.find((row) => row.record_id === lockedBefore.record_id).invoice_id).toBeNull();

    // Superseded client-cadence history stays superseded.
    const supersededClientRows = await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, obligation_id: obligationId, cadence_owner: 'client' });
    expect(supersededClientRows).toHaveLength(1);
    expect(supersededClientRows[0].lifecycle_state).toBe('superseded');

    // Replenishment writes service periods only.
    expect(await invoiceCount()).toBe(beforeInvoices);
  });

  it('is idempotent across repeated runs and advances the horizon without invoices', async () => {
    const obligationId = await createContractCadenceLine({ contractLineId: CLOUDLAB.contractLineId });
    await seedIncidentLedger(obligationId);

    await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    const firstRows = await loadContractPeriods(obligationId);
    const firstInvoices = await invoiceCount();

    const secondSummary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    const secondRows = await loadContractPeriods(obligationId);

    expect(secondRows).toEqual(firstRows);
    expect(secondSummary.periodsGenerated).toBe(0);
    expect(secondSummary.periodsSuperseded).toBe(0);
    expect(secondSummary.linesExhaustedBeforeRun).toBe(0);
    expect(secondSummary.linesAwaitingCoverage).toBe(0);
    expect(secondRows.filter((row) => row.lifecycle_state === 'superseded')).toHaveLength(0);

    // A later scheduled run moves the horizon forward and still creates no invoices.
    const laterSummary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2027-01-15T00:00:00Z',
    });
    const laterRows = await loadContractPeriods(obligationId);
    expect(laterRows.length).toBeGreaterThan(secondRows.length);
    expect(laterSummary.periodsGenerated).toBeGreaterThanOrEqual(1);
    const furthest = laterRows
      .filter((row) => row.lifecycle_state !== 'superseded')
      .map((row) => dateOnly(row.service_period_end))
      .sort()
      .at(-1);
    expect(furthest >= '2027-07-14').toBe(true);
    expect(await invoiceCount()).toBe(firstInvoices);
  });

  it('keeps advance service-period and invoice windows aligned for an anniversary anchor', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2026-05-15T00:00:00Z',
      billingTiming: 'advance',
      name: 'Advance Anniversary Line',
    });

    await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    const rows = await loadContractPeriods(obligationId);
    expect(rows.length).toBeGreaterThan(1);
    const first = rows.find((row) => dateOnly(row.service_period_start) === '2026-05-15');
    expect(first).toBeTruthy();
    expect(first.due_position).toBe('advance');
    expect(dateOnly(first.service_period_end)).toBe('2026-06-15');
    expect(dateOnly(first.invoice_window_start)).toBe('2026-05-15');
    expect(dateOnly(first.invoice_window_end)).toBe('2026-06-15');
  });

  it('recovers prolonged inactivity for a month-end anchor and folds short months', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2026-01-31T00:00:00Z',
      name: 'Month End Anchor Line',
    });

    await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    const rows = await loadContractPeriods(obligationId);
    const starts = rows.filter((row) => row.lifecycle_state !== 'superseded').map((row) => dateOnly(row.service_period_start));
    expect(starts).toContain('2026-01-31');
    expect(starts).toContain('2026-02-28');
    expect(starts).toContain('2026-03-31');
    const furthest = rows
      .filter((row) => row.lifecycle_state !== 'superseded')
      .map((row) => dateOnly(row.service_period_end))
      .sort()
      .at(-1);
    expect(furthest >= '2027-03-14').toBe(true);
  });

  it('skips inactive, ended, future-start, and client-cadence lines', async () => {
    const inactiveContractLine = await createContractCadenceLine({
      contractActive: false,
      startDate: '2026-02-08T00:00:00Z',
      name: 'Inactive Contract Line',
    });
    const inactiveLine = await createContractCadenceLine({
      lineActive: false,
      startDate: '2026-02-08T00:00:00Z',
      name: 'Inactive Contract Cadence Line',
    });
    const endedAssignment = await createContractCadenceLine({
      startDate: '2026-02-08T00:00:00Z',
      endDate: '2026-09-01T00:00:00Z',
      name: 'Ended Assignment Line',
    });
    const futureStart = await createContractCadenceLine({
      startDate: '2026-12-01T00:00:00Z',
      name: 'Future Start Line',
    });
    const inactiveAssignment = await createContractCadenceLine({
      startDate: '2026-02-08T00:00:00Z',
      assignmentActive: false,
      name: 'Inactive Assignment Line',
    });

    // A client-cadence line for the same client must be left for the client pass.
    const clientCadenceLineId = uuidv4();
    await context.createEntity(
      'contract_lines',
      {
        contract_line_id: clientCadenceLineId,
        contract_line_name: 'Client Cadence Line',
        billing_frequency: 'monthly',
        billing_timing: 'arrears',
        is_custom: false,
        contract_line_type: 'Fixed',
        cadence_owner: 'client',
        is_active: true,
      },
      'contract_line_id',
    );
    await assignContractLineToClient(context, clientCadenceLineId, {
      startDate: '2026-02-08T00:00:00Z',
      materializeServicePeriods: false,
    });

    await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    for (const obligationId of [
      inactiveContractLine,
      inactiveLine,
      endedAssignment,
      futureStart,
      inactiveAssignment,
      clientCadenceLineId,
    ]) {
      const rows = await context.db('recurring_service_periods')
        .where({ tenant: context.tenantId, obligation_id: obligationId })
        .whereNotIn('lifecycle_state', ['superseded', 'archived']);
      expect(rows).toHaveLength(0);
    }
  });

  it('isolates a failing line, rolls back its writes, and recovers on retry', async () => {
    // Billed history ends mid-period (Aug 20) so the first regenerated candidate
    // overlaps the historical boundary and the canonical backfill refuses it.
    const failingLine = await createContractCadenceLine({
      startDate: '2026-02-08T00:00:00Z',
      name: 'Overlap Failure Line',
    });
    await seedContractPeriod({
      obligationId: failingLine,
      serviceStart: '2026-07-20',
      serviceEnd: '2026-08-20',
      invoiceStart: '2026-08-20',
      invoiceEnd: '2026-09-20',
      lifecycleState: 'billed',
      provenanceKind: 'regenerated',
    });

    const healthyLine = await createContractCadenceLine({
      startDate: '2026-02-08T00:00:00Z',
      name: 'Healthy Line',
    });
    await seedIncidentLedger(healthyLine);

    const summary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    expect(summary.failures.map((failure) => failure.contractLineId)).toContain(failingLine);
    const failingRowsBeforeFix = await loadContractPeriods(failingLine);
    expect(failingRowsBeforeFix.filter((row) => row.lifecycle_state === 'generated')).toHaveLength(0);

    // The healthy line still got repaired in the same run.
    const healthyRows = await loadContractPeriods(healthyLine);
    expect(
      healthyRows.some(
        (row) =>
          row.lifecycle_state !== 'superseded'
          && dateOnly(row.service_period_start) === '2026-08-08',
      ),
    ).toBe(true);

    // Remove the malformed billed boundary and retry: the previously failing
    // line now heals with no duplicate or partial rows.
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, obligation_id: failingLine, lifecycle_state: 'billed' })
      .update({
        lifecycle_state: 'superseded',
        invoice_id: null,
        invoice_charge_id: null,
        invoice_charge_detail_id: null,
        invoice_linked_at: null,
      });

    const retry = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(retry.failures).toEqual([]);
    const healedRows = await loadContractPeriods(failingLine);
    expect(
      healedRows.some(
        (row) =>
          row.lifecycle_state !== 'superseded'
          && dateOnly(row.service_period_start) === '2026-08-08'
          && dateOnly(row.service_period_end) === '2026-09-08',
      ),
    ).toBe(true);
    const keys = healedRows
      .filter((row) => row.lifecycle_state !== 'superseded')
      .map((row) => `${row.schedule_key}:${row.period_key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('preserves skipped and deferred periods while recovering the gaps before them', async () => {
    const obligationId = await createContractCadenceLine({ contractLineId: CLOUDLAB.contractLineId });
    await seedIncidentLedger(obligationId);

    const skippedId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-10-08',
      serviceEnd: '2026-11-08',
      invoiceStart: '2026-11-08',
      invoiceEnd: '2026-12-08',
      lifecycleState: 'skipped',
      provenanceKind: 'user_edited',
      reasonCode: 'skip',
      revision: 2,
    });
    const deferredId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-11-08',
      serviceEnd: '2026-12-08',
      invoiceStart: '2027-01-08',
      invoiceEnd: '2027-02-08',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
      reasonCode: 'defer',
      revision: 2,
    });

    await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    const rows = await loadContractPeriods(obligationId);
    const active = rows.filter((row) => row.lifecycle_state !== 'superseded');

    // The two missing periods before the preserved pair were recovered.
    for (const [start, end] of [['2026-08-08', '2026-09-08'], ['2026-09-08', '2026-10-08']]) {
      expect(
        active.some(
          (row) => dateOnly(row.service_period_start) === start
            && dateOnly(row.service_period_end) === end,
        ),
      ).toBe(true);
    }

    // Skipped and deferred rows keep their identity, state, and windows.
    const skippedAfter = rows.find((row) => row.record_id === skippedId);
    expect(skippedAfter.lifecycle_state).toBe('skipped');
    expect(dateOnly(skippedAfter.service_period_start)).toBe('2026-10-08');
    expect(dateOnly(skippedAfter.service_period_end)).toBe('2026-11-08');
    const deferredAfter = rows.find((row) => row.record_id === deferredId);
    expect(deferredAfter.lifecycle_state).toBe('edited');
    expect(deferredAfter.reason_code).toBe('defer');
    expect(dateOnly(deferredAfter.invoice_window_start)).toBe('2027-01-08');

    // No service period is active twice.
    const activePeriodBounds = active.map(
      (row) => `${dateOnly(row.service_period_start)}:${dateOnly(row.service_period_end)}`,
    );
    expect(new Set(activePeriodBounds).size).toBe(activePeriodBounds.length);
  });

  it('does not touch another tenant contract-cadence line', async () => {
    const obligationId = await createContractCadenceLine({
      contractLineId: CLOUDLAB.contractLineId,
      startDate: '2026-02-08T00:00:00Z',
    });
    await seedIncidentLedger(obligationId);

    const otherTenant = uuidv4();
    const otherClient = uuidv4();
    const otherContract = uuidv4();
    const otherAssignment = uuidv4();
    const otherLine = uuidv4();
    await context.db('tenants').insert({
      tenant: otherTenant,
      client_name: 'Other Tenant',
      phone_number: '555-0101',
      email: `other-${otherTenant.slice(0, 8)}@example.com`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      payment_platform_id: `platform-${otherTenant.slice(0, 8)}`,
      payment_method_id: `method-${otherTenant.slice(0, 8)}`,
      auth_service_id: `auth-${otherTenant.slice(0, 8)}`,
      plan: 'pro',
      product_code: 'psa',
    });
    await context.db('clients').insert({
      client_id: otherClient,
      tenant: otherTenant,
      client_name: 'Other Tenant Client',
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      url: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_inactive: false,
      properties: {},
    });
    await context.db('contracts').insert({
      contract_id: otherContract,
      tenant: otherTenant,
      contract_name: 'Other Tenant Contract',
      contract_description: 'isolation fixture',
      billing_frequency: 'monthly',
      is_active: true,
      status: 'Active',
      is_template: false,
      currency_code: 'USD',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await context.db('client_contracts').insert({
      client_contract_id: otherAssignment,
      tenant: otherTenant,
      client_id: otherClient,
      contract_id: otherContract,
      start_date: '2026-02-08',
      end_date: null,
      is_active: true,
      status: 'pending',
      po_required: false,
      po_number: null,
      po_amount: null,
      template_contract_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await context.db('contract_lines').insert({
      contract_line_id: otherLine,
      tenant: otherTenant,
      contract_id: otherContract,
      contract_line_name: 'Other Tenant Line',
      billing_frequency: 'monthly',
      billing_timing: 'arrears',
      is_custom: false,
      contract_line_type: 'Fixed',
      cadence_owner: 'contract',
      is_active: true,
      custom_rate: CLOUDLAB.rateCents,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    const otherRows = await context.db('recurring_service_periods')
      .where({ tenant: otherTenant, obligation_id: otherLine });
    expect(otherRows).toHaveLength(0);

    const otherSummary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: otherTenant,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(otherSummary.linesExamined).toBe(1);
    const otherRowsAfter = await context.db('recurring_service_periods')
      .where({ tenant: otherTenant, obligation_id: otherLine });
    expect(otherRowsAfter.length).toBeGreaterThan(0);

    // The first tenant's ledger is unaffected by the second tenant's run.
    const firstTenantRows = await loadContractPeriods(obligationId);
    expect(firstTenantRows.some((row) => row.lifecycle_state !== 'superseded')).toBe(true);
  });

  it('backfills multiple missed periods for a never-invoiced assignment and reaches the horizon', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2024-02-08T00:00:00Z',
      name: 'Never Invoiced Line',
    });

    const summary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(summary.failures).toEqual([]);

    const rows = await loadContractPeriods(obligationId);
    const active = rows.filter((row) => row.lifecycle_state !== 'superseded');
    const starts = active.map((row) => dateOnly(row.service_period_start));
    for (const expected of ['2024-02-08', '2024-03-08', '2026-08-08', '2026-09-08']) {
      expect(starts).toContain(expected);
    }
    const furthest = active.map((row) => dateOnly(row.service_period_end)).sort().at(-1);
    expect(furthest >= '2027-03-14').toBe(true);
  });

  it('recovers an interior gap even when later generated rows already exist', async () => {
    const obligationId = await createContractCadenceLine({ contractLineId: CLOUDLAB.contractLineId });
    await seedIncidentLedger(obligationId);

    // A later future row already exists (Oct 8 – Nov 8) while Aug 8 – Oct 8 is
    // missing; the sweep must fill the hole without duplicating the later row.
    await seedContractPeriod({
      obligationId,
      serviceStart: '2026-10-08',
      serviceEnd: '2026-11-08',
      invoiceStart: '2026-11-08',
      invoiceEnd: '2026-12-08',
      lifecycleState: 'generated',
    });

    const summary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(summary.failures).toEqual([]);

    const rows = await loadContractPeriods(obligationId);
    const active = rows.filter((row) => row.lifecycle_state !== 'superseded');
    for (const [start, end] of [
      ['2026-08-08', '2026-09-08'],
      ['2026-09-08', '2026-10-08'],
      ['2026-10-08', '2026-11-08'],
    ]) {
      const matches = active.filter(
        (row) =>
          dateOnly(row.service_period_start) === start
          && dateOnly(row.service_period_end) === end,
      );
      expect(matches).toHaveLength(1);
    }
    const bounds = active.map(
      (row) => `${dateOnly(row.service_period_start)}:${dateOnly(row.service_period_end)}`,
    );
    expect(new Set(bounds).size).toBe(bounds.length);
  });

  it('backfills a capped catch-up across runs instead of regenerating the same batch', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2005-01-08T00:00:00Z',
      name: 'Ancient Assignment Line',
    });

    // The first run can only emit the 200-period cap, so it honestly reports
    // incomplete coverage instead of claiming the horizon is met.
    const first = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(first.linesAtPeriodCap).toBe(1);
    expect(first.linesAwaitingCoverage).toBe(1);
    const firstActive = (await loadContractPeriods(obligationId)).filter(
      (row) => row.lifecycle_state !== 'superseded',
    );
    expect(firstActive).toHaveLength(200);
    const firstFurthest = firstActive
      .map((row) => dateOnly(row.service_period_end))
      .sort()
      .at(-1);
    expect(firstFurthest < '2027-03-14').toBe(true);

    // The second run resumes after the covered prefix instead of regenerating
    // the same initial batch, and completes the horizon.
    const second = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(second.linesAtPeriodCap).toBe(0);
    expect(second.linesAwaitingCoverage).toBe(0);
    expect(second.periodsGenerated).toBeGreaterThan(0);
    const secondRows = await loadContractPeriods(obligationId);
    const secondActive = secondRows.filter((row) => row.lifecycle_state !== 'superseded');
    expect(secondActive.length).toBeGreaterThan(firstActive.length);
    const secondFurthest = secondActive
      .map((row) => dateOnly(row.service_period_end))
      .sort()
      .at(-1);
    expect(secondFurthest >= '2027-03-14').toBe(true);

    const third = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(third.periodsGenerated).toBe(0);
    expect(third.periodsSuperseded).toBe(0);
    expect(await loadContractPeriods(obligationId)).toEqual(secondRows);
  });

  it('preserves the last billed period under its following-month invoice header', async () => {
    const obligationId = await createContractCadenceLine({ contractLineId: CLOUDLAB.contractLineId });
    await seedIncidentLedger(obligationId);

    const before = await loadContractPeriods(obligationId);
    const lastBilled = before.find(
      (row) =>
        row.lifecycle_state === 'billed'
        && dateOnly(row.service_period_start) === '2026-07-08',
    );
    expect(lastBilled).toBeTruthy();
    expect(dateOnly(lastBilled.invoice_window_start)).toBe('2026-08-08');
    expect(dateOnly(lastBilled.invoice_window_end)).toBe('2026-09-08');
    expect(lastBilled.invoice_charge_detail_id).toBe(CLOUDLAB.billedChargeDetailId);

    await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    const after = await loadContractPeriods(obligationId);
    expect(after.find((row) => row.record_id === lastBilled.record_id)).toEqual(lastBilled);
    const active = after.filter((row) => row.lifecycle_state !== 'superseded');
    // The Aug–Sep invoice header belongs to July–Aug service; the Aug–Sep service
    // period was genuinely missing and is now represented exactly once.
    expect(
      active.filter(
        (row) =>
          dateOnly(row.service_period_start) === '2026-07-08'
          && dateOnly(row.service_period_end) === '2026-08-08',
      ),
    ).toHaveLength(1);
    expect(
      active.filter(
        (row) =>
          dateOnly(row.service_period_start) === '2026-08-08'
          && dateOnly(row.service_period_end) === '2026-09-08',
      ),
    ).toHaveLength(1);
  });

  it('sweeps tenants independently and isolates a tenant-level failure', async () => {
    const obligationId = await createContractCadenceLine({ contractLineId: CLOUDLAB.contractLineId });
    await seedIncidentLedger(obligationId);

    const failingTenant = uuidv4();
    await context.db('tenants').insert({
      tenant: failingTenant,
      client_name: 'Unreachable Tenant',
      phone_number: '555-0199',
      email: `unreachable-${failingTenant.slice(0, 8)}@example.com`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      payment_platform_id: `platform-${failingTenant.slice(0, 8)}`,
      payment_method_id: `method-${failingTenant.slice(0, 8)}`,
      auth_service_id: `auth-${failingTenant.slice(0, 8)}`,
      plan: 'pro',
      product_code: 'psa',
    });

    const summary = await replenishContractCadenceServicePeriodsSweep({
      asOf: '2026-09-15T00:00:00Z',
      resolveConnection: async (tenant) => {
        if (tenant === failingTenant) {
          throw new Error('connection unavailable');
        }
        return context.db;
      },
    });

    expect(summary.tenantsFailed).toBe(1);
    const tenantSummary = summary.summaries.find((entry) => entry.tenant === context.tenantId);
    expect(tenantSummary?.periodsGenerated).toBeGreaterThanOrEqual(1);
    expect(summary.summaries.find((entry) => entry.tenant === failingTenant)).toBeUndefined();

    const rows = await loadContractPeriods(obligationId);
    expect(rows.some((row) => dateOnly(row.service_period_start) === '2026-08-08')).toBe(true);
  });

  it('applies anniversary cadence and invoice windows for quarterly, semi-annual and annual arrears', async () => {
    const quarterly = await createContractCadenceLine({
      startDate: '2026-02-08T00:00:00Z',
      billingFrequency: 'quarterly',
      name: 'Quarterly Line',
    });
    const semiAnnual = await createContractCadenceLine({
      startDate: '2026-02-08T00:00:00Z',
      billingFrequency: 'semi-annually',
      name: 'Semi Annual Line',
    });
    const annual = await createContractCadenceLine({
      startDate: '2026-02-28T00:00:00Z',
      billingFrequency: 'annually',
      name: 'Annual Line',
    });

    const summary = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(summary.failures).toEqual([]);

    const quarterlyRows = await loadContractPeriods(quarterly);
    expect(dateOnly(quarterlyRows[0].service_period_start)).toBe('2026-02-08');
    expect(dateOnly(quarterlyRows[0].service_period_end)).toBe('2026-05-08');
    expect(dateOnly(quarterlyRows[0].invoice_window_start)).toBe('2026-05-08');
    expect(dateOnly(quarterlyRows[0].invoice_window_end)).toBe('2026-08-08');
    expect(dateOnly(quarterlyRows[1].service_period_end)).toBe('2026-08-08');

    const semiAnnualRows = await loadContractPeriods(semiAnnual);
    expect(dateOnly(semiAnnualRows[0].service_period_end)).toBe('2026-08-08');
    expect(dateOnly(semiAnnualRows[0].invoice_window_end)).toBe('2027-02-08');

    const annualRows = await loadContractPeriods(annual);
    expect(dateOnly(annualRows[0].service_period_start)).toBe('2026-02-28');
    expect(dateOnly(annualRows[0].service_period_end)).toBe('2027-02-28');
    expect(dateOnly(annualRows[0].invoice_window_start)).toBe('2027-02-28');
    expect(dateOnly(annualRows[0].invoice_window_end)).toBe('2028-02-28');
  });
});
