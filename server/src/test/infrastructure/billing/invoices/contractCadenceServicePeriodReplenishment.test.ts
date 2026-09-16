import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TestContext } from 'server/test-utils/testContext';
import { assignContractLineToClient } from '../../../../../test-utils/billingTestHelpers';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from 'server/test-utils/billingProfileTestHelpers';
import {
  materializeContractCadenceServicePeriodsForContractLine,
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

const INCIDENT = {
  contractLineId: '7970745c-f3ae-4b5d-b699-bd4e546154d5',
  contractId: 'aebdf1b3-e8f5-4029-b71c-107191c0b31b',
  assignmentId: 'e6aae4f2-0c7b-4905-8921-dd8e64174756',
  assignmentStart: '2026-02-08T00:00:00Z',
  rateCents: 1262860,
  invoiceNumber: '0001850',
  billedInvoiceId: 'f7087063-882a-482b-81b4-b706fed0386b',
  billedChargeDetailId: '3faeb57f-ac24-446e-85e6-acab77031875',
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
    billingTiming?: string;
    billingFrequency?: string;
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
        custom_rate: options.rateCents ?? INCIDENT.rateCents,
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
      source_run_key: `contract_line_update:${input.obligationId}:2026-04-15T03:45:06.058Z`,
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
          invoiceId: isLast ? INCIDENT.billedInvoiceId : uuidv4(),
          invoiceChargeId: uuidv4(),
          invoiceChargeDetailId: isLast ? INCIDENT.billedChargeDetailId : uuidv4(),
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
    const obligationId = await createContractCadenceLine({ contractLineId: INCIDENT.contractLineId });
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
    const obligationId = await createContractCadenceLine({ contractLineId: INCIDENT.contractLineId });
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

  it('does not enumerate unsupported frequency or timing lines, preserving their protected rows', async () => {
    // The read-only audit treats supported frequencies and advance/arrears timing
    // as part of replenisher eligibility. The sweep must agree: an unsupported
    // line otherwise falls through canonical sync to retirement, which would
    // supersede protected locked/edited rows.
    const weeklyLine = await createContractCadenceLine({
      name: 'Weekly Contract Cadence Line',
      billingFrequency: 'weekly',
    });
    const oddTimingLine = await createContractCadenceLine({
      name: 'Unsupported Timing Line',
      billingTiming: 'on_completion',
    });

    const weeklyLockedId = await seedContractPeriod({
      obligationId: weeklyLine,
      serviceStart: '2026-03-08',
      serviceEnd: '2026-04-08',
      invoiceStart: '2026-04-08',
      invoiceEnd: '2026-05-08',
      lifecycleState: 'locked',
    });
    const oddTimingEditedId = await seedContractPeriod({
      obligationId: oddTimingLine,
      serviceStart: '2026-03-08',
      serviceEnd: '2026-04-08',
      invoiceStart: '2026-04-08',
      invoiceEnd: '2026-05-08',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
    });

    const result = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    expect(result.failures).toEqual([]);
    const weeklyRows = await loadContractPeriods(weeklyLine);
    expect(weeklyRows.find((row) => row.record_id === weeklyLockedId)?.lifecycle_state).toBe('locked');
    const oddTimingRows = await loadContractPeriods(oddTimingLine);
    expect(oddTimingRows.find((row) => row.record_id === oddTimingEditedId)?.lifecycle_state).toBe('edited');
  });

  it('replenishes a multi-profile client once without touching profiles or cycles', async () => {
    // Billing profiles are not an input to contract-cadence replenishment. A
    // segmented client must still get exactly one recovered period and no new
    // cycles or invoices; the sweep is not a per-profile pass.
    await ensureDefaultBillingProfile(
      { db: context.db, tenantId: context.tenantId },
      context.clientId,
    );
    await createBillingProfile(
      { db: context.db, tenantId: context.tenantId },
      context.clientId,
      'Site B',
    );

    const obligationId = await createContractCadenceLine({ contractLineId: INCIDENT.contractLineId });
    await seedIncidentLedger(obligationId);

    const cyclesBefore = await context.db('client_billing_cycles')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .count('* as count')
      .first();
    const invoicesBefore = await invoiceCount();

    const result = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });

    expect(result.failures).toEqual([]);
    const active = (await loadContractPeriods(obligationId))
      .filter((row) => row.lifecycle_state !== 'superseded');
    expect(
      active.filter(
        (row) =>
          dateOnly(row.service_period_start) === '2026-08-08'
          && dateOnly(row.service_period_end) === '2026-09-08',
      ),
    ).toHaveLength(1);

    const cyclesAfter = await context.db('client_billing_cycles')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .count('* as count')
      .first();
    expect(Number(cyclesAfter?.count ?? 0)).toBe(Number(cyclesBefore?.count ?? 0));
    expect(await invoiceCount()).toBe(invoicesBefore);
  });

  it('recovers the quarter after preserved monthly slots and stays idempotent', async () => {
    // Quarterly grid anchored 2026-01-08 with two preserved monthly locks. The
    // Jan 8–Apr 8 candidate overlaps both locks and stays suppressed, but the
    // unrelated Apr 8–Jul 8 quarter must still be generated on the first run
    // and not regenerated on the next.
    const obligationId = await createContractCadenceLine({
      startDate: '2026-01-08T00:00:00Z',
      billingFrequency: 'quarterly',
      name: 'Quarterly Locked Monthly Slots',
    });
    for (const [serviceStart, serviceEnd, invoiceStart, invoiceEnd] of [
      ['2026-01-08', '2026-02-08', '2026-02-08', '2026-03-08'],
      ['2026-02-08', '2026-03-08', '2026-03-08', '2026-04-08'],
    ]) {
      await seedContractPeriod({
        obligationId,
        serviceStart,
        serviceEnd,
        invoiceStart,
        invoiceEnd,
        lifecycleState: 'locked',
      });
    }

    const params = { tenant: context.tenantId, sourceRunPrefix: 'test-nightly', asOf: '2026-09-15T00:00:00Z' };
    const first = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(first.failures).toEqual([]);
    // Coverage continuity, not just the furthest end: the missing quarter is
    // reported when it is not recovered.
    expect(first.linesAwaitingCoverage).toBe(0);
    expect(first.unresolvedGapCount).toBe(0);

    const rows = await loadContractPeriods(obligationId);
    expect(
      rows.filter(
        (row) =>
          row.lifecycle_state === 'generated'
          && dateOnly(row.service_period_start) === '2026-04-08'
          && dateOnly(row.service_period_end) === '2026-07-08',
      ),
    ).toHaveLength(1);
    // The January quarter is suppressed by the two locks, not generated.
    expect(
      rows.filter(
        (row) =>
          row.lifecycle_state === 'generated'
          && dateOnly(row.service_period_start) === '2026-01-08'
          && dateOnly(row.service_period_end) === '2026-04-08',
      ),
    ).toHaveLength(0);

    const afterFirst = await loadContractPeriods(obligationId);
    const second = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(second.periodsGenerated).toBe(0);
    expect(second.periodsSuperseded).toBe(0);
    expect(second.linesAwaitingCoverage).toBe(0);
    expect(await loadContractPeriods(obligationId)).toEqual(afterFirst);
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
    const obligationId = await createContractCadenceLine({ contractLineId: INCIDENT.contractLineId });
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
      contractLineId: INCIDENT.contractLineId,
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
      custom_rate: INCIDENT.rateCents,
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
    const obligationId = await createContractCadenceLine({ contractLineId: INCIDENT.contractLineId });
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
    const obligationId = await createContractCadenceLine({ contractLineId: INCIDENT.contractLineId });
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
    expect(lastBilled.invoice_charge_detail_id).toBe(INCIDENT.billedChargeDetailId);

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
    const obligationId = await createContractCadenceLine({ contractLineId: INCIDENT.contractLineId });
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

  it('advances past multiple capped batches and eventually reaches the horizon', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '1980-01-08T00:00:00Z',
      name: 'Ancient Assignment Line',
    });
    const params = {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    };

    const first = await runContractCadenceReplenishmentForTenant(context.db, params);
    const second = await runContractCadenceReplenishmentForTenant(context.db, params);
    const third = await runContractCadenceReplenishmentForTenant(context.db, params);

    expect(first.periodsGenerated).toBe(200);
    expect(second.periodsGenerated).toBe(200);
    // The continuation must walk every already-covered batch, not resume at the
    // end of the first one forever.
    expect(third.periodsGenerated).toBeGreaterThan(0);

    let summary = third;
    let runs = 3;
    while (summary.linesAwaitingCoverage > 0 && runs < 12) {
      summary = await runContractCadenceReplenishmentForTenant(context.db, params);
      runs += 1;
    }
    expect(summary.linesAwaitingCoverage).toBe(0);
    expect(summary.linesAtPeriodCap).toBe(0);

    const rows = await loadContractPeriods(obligationId);
    const active = rows.filter((row) => row.lifecycle_state !== 'superseded');
    const furthest = active.map((row) => dateOnly(row.service_period_end)).sort().at(-1);
    expect(furthest >= '2027-03-14').toBe(true);

    // Once complete, no further run writes anything.
    const finalRun = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(finalRun.periodsGenerated).toBe(0);
    expect(finalRun.periodsSuperseded).toBe(0);
    expect(await loadContractPeriods(obligationId)).toEqual(rows);
  });

  it('retains valid later coverage while filling a capped historical gap', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '1980-01-08T00:00:00Z',
      name: 'Capped Historical Gap Line',
    });
    const laterRecordId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-08-08',
      serviceEnd: '2026-09-08',
      invoiceStart: '2026-09-08',
      invoiceEnd: '2026-10-08',
      lifecycleState: 'generated',
    });
    const before = (await loadContractPeriods(obligationId)).find(
      (row) => row.record_id === laterRecordId,
    );

    const result = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(result.failures).toEqual([]);

    const after = (await loadContractPeriods(obligationId)).find(
      (row) => row.record_id === laterRecordId,
    );
    // Reconciliation is bounded to the generated batch, so a valid later period
    // outside it is neither superseded nor rewritten.
    expect(after).toEqual(before);
    expect(after.lifecycle_state).toBe('generated');
  });

  it('does not create overlapping charges beside an expanded manual override', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2026-08-08T00:00:00Z',
      name: 'Expanded Override Line',
    });
    const overrideId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-08-08',
      serviceEnd: '2026-10-08',
      invoiceStart: '2026-10-08',
      invoiceEnd: '2026-11-08',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
    });
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, record_id: overrideId })
      .update({ period_key: 'period:2026-08-08:2026-09-08' });
    const before = (await loadContractPeriods(obligationId)).find(
      (row) => row.record_id === overrideId,
    );

    const result = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(result.failures).toEqual([]);
    // The mismatch is surfaced rather than silently swallowed.
    expect(result.overrideConflicts).toBeGreaterThanOrEqual(1);

    const after = await loadContractPeriods(obligationId);
    expect(after.find((row) => row.record_id === overrideId)).toEqual(before);
    const overlaps = after.filter(
      (row) =>
        row.record_id !== overrideId
        && row.lifecycle_state !== 'superseded'
        && dateOnly(row.service_period_start) < '2026-10-08'
        && dateOnly(row.service_period_end) > '2026-08-08',
    );
    expect(overlaps).toEqual([]);
  });

  it('does not create overlapping charges beside a shifted manual override', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2026-08-08T00:00:00Z',
      name: 'Shifted Override Line',
    });
    const overrideId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-09-08',
      serviceEnd: '2026-10-08',
      invoiceStart: '2026-10-08',
      invoiceEnd: '2026-11-08',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
    });
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, record_id: overrideId })
      .update({ period_key: 'period:2026-08-08:2026-09-08' });
    const before = (await loadContractPeriods(obligationId)).find(
      (row) => row.record_id === overrideId,
    );

    const result = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(result.failures).toEqual([]);

    const after = await loadContractPeriods(obligationId);
    expect(after.find((row) => row.record_id === overrideId)).toEqual(before);
    const overlaps = after.filter(
      (row) =>
        row.record_id !== overrideId
        && row.lifecycle_state !== 'superseded'
        && dateOnly(row.service_period_start) < '2026-10-08'
        && dateOnly(row.service_period_end) > '2026-09-08',
    );
    expect(overlaps).toEqual([]);
  });

  it('does not create a charge overlapping a partially expanded manual override', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2026-08-08T00:00:00Z',
      name: 'Partial Override Line',
    });
    const overrideId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-08-08',
      serviceEnd: '2026-09-15',
      invoiceStart: '2026-09-15',
      invoiceEnd: '2026-10-15',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
    });
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, record_id: overrideId })
      .update({ period_key: 'period:2026-08-08:2026-09-08' });
    const before = (await loadContractPeriods(obligationId)).find(
      (row) => row.record_id === overrideId,
    );

    const result = await runContractCadenceReplenishmentForTenant(context.db, {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    });
    expect(result.failures).toEqual([]);

    const after = await loadContractPeriods(obligationId);
    expect(after.find((row) => row.record_id === overrideId)).toEqual(before);
    // The generated Sep 8–Oct 8 ideal slot overlaps the override through
    // Sep 15; it must be suppressed rather than inserted beside it.
    const overlaps = after.filter(
      (row) =>
        row.record_id !== overrideId
        && row.lifecycle_state !== 'superseded'
        && dateOnly(row.service_period_start) < '2026-09-15'
        && dateOnly(row.service_period_end) > '2026-08-08',
    );
    expect(overlaps).toEqual([]);
  });

  it('advances capped generation past an expanded override and then idempotents', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2005-01-08T00:00:00Z',
      name: 'Capped Override Line',
    });
    const overrideId = await seedContractPeriod({
      obligationId,
      serviceStart: '2005-01-08',
      serviceEnd: '2005-03-08',
      invoiceStart: '2005-03-08',
      invoiceEnd: '2005-04-08',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
    });
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, record_id: overrideId })
      .update({ period_key: 'period:2005-01-08:2005-02-08' });

    const params = {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    };
    const first = await runContractCadenceReplenishmentForTenant(context.db, params);
    const second = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    // The override's absorbed Jan/Feb slots must not look permanently missing.
    expect(second.periodsGenerated).toBeGreaterThan(0);

    let summary = second;
    let runs = 2;
    while (summary.linesAwaitingCoverage > 0 && runs < 12) {
      summary = await runContractCadenceReplenishmentForTenant(context.db, params);
      runs += 1;
    }
    expect(summary.linesAwaitingCoverage).toBe(0);

    const rows = await loadContractPeriods(obligationId);
    const active = rows.filter((row) => row.lifecycle_state !== 'superseded');
    const furthest = active.map((row) => dateOnly(row.service_period_end)).sort().at(-1);
    expect(furthest >= '2027-03-14').toBe(true);
    // The override itself is untouched.
    expect(rows.find((row) => row.record_id === overrideId)?.lifecycle_state).toBe('edited');

    const finalRun = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(finalRun.periodsGenerated).toBe(0);
    expect(await loadContractPeriods(obligationId)).toEqual(rows);
  });

  it('preserves beyond-horizon rows when capped history is fully covered', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '1980-01-08T00:00:00Z',
      name: 'Completed Catch-up Line',
    });
    const params = {
      tenant: context.tenantId,
      sourceRunPrefix: 'test-nightly',
      asOf: '2026-09-15T00:00:00Z',
    };
    for (let i = 0; i < 4; i += 1) {
      await runContractCadenceReplenishmentForTenant(context.db, params);
    }

    const beyondId = await seedContractPeriod({
      obligationId,
      serviceStart: '2028-01-08',
      serviceEnd: '2028-02-08',
      invoiceStart: '2028-02-08',
      invoiceEnd: '2028-03-08',
      lifecycleState: 'generated',
    });
    const before = (await loadContractPeriods(obligationId)).find(
      (row) => row.record_id === beyondId,
    );

    const result = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(result.failures).toEqual([]);
    expect((await loadContractPeriods(obligationId)).find((row) => row.record_id === beyondId)).toEqual(
      before,
    );
  });

  it('retires mutable rows past a shortened assignment but keeps the override history', async () => {
    const obligationId = await createContractCadenceLine({
      startDate: '2026-02-08T00:00:00Z',
      name: 'Shortened Assignment Line',
    });
    const mutableId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-11-08',
      serviceEnd: '2026-12-08',
      invoiceStart: '2026-12-08',
      invoiceEnd: '2027-01-08',
      lifecycleState: 'generated',
    });
    const lockedId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-12-08',
      serviceEnd: '2027-01-08',
      invoiceStart: '2027-01-08',
      invoiceEnd: '2027-02-08',
      lifecycleState: 'locked',
    });

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: obligationId })
      .first();
    await context.db('client_contracts')
      .where({ tenant: context.tenantId, contract_id: line.contract_id })
      .update({ end_date: '2026-10-08' });

    await materializeContractCadenceServicePeriodsForContractLine(context.db, {
      tenant: context.tenantId,
      contractLineId: obligationId,
      sourceRunPrefix: 'test-assignment-update',
    });

    const rows = await loadContractPeriods(obligationId);
    expect(rows.find((row) => row.record_id === mutableId)?.lifecycle_state).toBe('superseded');
    // Protected records past the assignment end are preserved.
    expect(rows.find((row) => row.record_id === lockedId)?.lifecycle_state).toBe('locked');
  });
  it('preserves an override expanded into the preceding slot without generating an overlapping charge', async () => {
    const obligationId = await createContractCadenceLine({ startDate: '2026-08-08T00:00:00Z' });
    const overrideId = await seedContractPeriod({
      obligationId,
      serviceStart: '2026-08-15', serviceEnd: '2026-10-08',
      invoiceStart: '2026-10-08', invoiceEnd: '2026-11-08',
      lifecycleState: 'edited', provenanceKind: 'user_edited',
    });
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, record_id: overrideId })
      .update({ period_key: 'period:2026-09-08:2026-10-08' });
    const before = (await loadContractPeriods(obligationId)).find((row) => row.record_id === overrideId);
    const params = { tenant: context.tenantId, sourceRunPrefix: 'test-nightly', asOf: '2026-09-15T00:00:00Z' };

    const result = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(result.failures).toEqual([]);
    expect(result.overrideConflicts).toBeGreaterThan(0);
    const after = await loadContractPeriods(obligationId);
    expect(after.find((row) => row.record_id === overrideId)).toEqual(before);
    expect(after.filter((row) => row.record_id !== overrideId && row.lifecycle_state !== 'superseded'
      && dateOnly(row.service_period_start) < '2026-10-08'
      && dateOnly(row.service_period_end) > '2026-08-15')).toEqual([]);
    expect(after.some((row) => dateOnly(row.service_period_start) === '2026-10-08')).toBe(true);
    await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(await loadContractPeriods(obligationId)).toEqual(after);
  });

  it('retires post-end mutable rows when the final assignment period is already billed', async () => {
    const obligationId = await createContractCadenceLine({ startDate: '2026-08-08T00:00:00Z' });
    await seedContractPeriod({
      obligationId, serviceStart: '2026-08-08', serviceEnd: '2026-09-08',
      invoiceStart: '2026-09-08', invoiceEnd: '2026-10-08', lifecycleState: 'billed',
    });
    const mutableId = await seedContractPeriod({
      obligationId, serviceStart: '2026-09-08', serviceEnd: '2026-10-08',
      invoiceStart: '2026-10-08', invoiceEnd: '2026-11-08', lifecycleState: 'generated',
    });
    const lockedId = await seedContractPeriod({
      obligationId, serviceStart: '2026-10-08', serviceEnd: '2026-11-08',
      invoiceStart: '2026-11-08', invoiceEnd: '2026-12-08', lifecycleState: 'locked',
    });
    const before = await loadContractPeriods(obligationId);
    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: obligationId }).first();
    await context.db('client_contracts')
      .where({ tenant: context.tenantId, contract_id: line.contract_id }).update({ end_date: '2026-09-08' });
    const params = { tenant: context.tenantId, contractLineId: obligationId, sourceRunPrefix: 'test-assignment-update' };

    await materializeContractCadenceServicePeriodsForContractLine(context.db, params);
    const after = await loadContractPeriods(obligationId);
    expect(after.find((row) => row.record_id === mutableId)?.lifecycle_state).toBe('superseded');
    expect(after.find((row) => row.record_id === lockedId)).toEqual(before.find((row) => row.record_id === lockedId));
    expect(after.find((row) => row.lifecycle_state === 'billed')).toEqual(before.find((row) => row.lifecycle_state === 'billed'));
    await materializeContractCadenceServicePeriodsForContractLine(context.db, params);
    expect(await loadContractPeriods(obligationId)).toEqual(after);
  });

  it('continues capped catch-up across an override expanded backward into an earlier slot', async () => {
    const obligationId = await createContractCadenceLine({ startDate: '2005-01-08T00:00:00Z' });
    const overrideId = await seedContractPeriod({
      obligationId, serviceStart: '2005-02-15', serviceEnd: '2005-04-08',
      invoiceStart: '2005-04-08', invoiceEnd: '2005-05-08',
      lifecycleState: 'edited', provenanceKind: 'user_edited',
    });
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, record_id: overrideId })
      .update({ period_key: 'period:2005-03-08:2005-04-08' });
    const params = { tenant: context.tenantId, sourceRunPrefix: 'test-nightly', asOf: '2026-09-15T00:00:00Z' };
    const first = await runContractCadenceReplenishmentForTenant(context.db, params);
    const second = await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(second.periodsGenerated).toBeGreaterThan(0);
    expect(second.linesAwaitingCoverage).toBe(0);
    const rows = await loadContractPeriods(obligationId);
    expect(rows.filter((row) => row.record_id !== overrideId && row.lifecycle_state !== 'superseded'
      && dateOnly(row.service_period_start) < '2005-04-08'
      && dateOnly(row.service_period_end) > '2005-02-15')).toEqual([]);
    await runContractCadenceReplenishmentForTenant(context.db, params);
    expect(await loadContractPeriods(obligationId)).toEqual(rows);
  });

  it('does not mistake completed capped coverage beyond a shortened assignment for historical exclusions', async () => {
    const obligationId = await createContractCadenceLine({ startDate: '1980-01-08T00:00:00Z' });
    const params = { tenant: context.tenantId, sourceRunPrefix: 'test-nightly', asOf: '2026-09-15T00:00:00Z' };
    for (let run = 0; run < 3; run += 1) {
      await runContractCadenceReplenishmentForTenant(context.db, params);
    }
    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: obligationId }).first();
    await context.db('client_contracts')
      .where({ tenant: context.tenantId, contract_id: line.contract_id }).update({ end_date: '2026-09-08' });
    await materializeContractCadenceServicePeriodsForContractLine(context.db, {
      tenant: context.tenantId, contractLineId: obligationId, sourceRunPrefix: 'test-assignment-update',
    });
    const rows = await loadContractPeriods(obligationId);
    expect(rows.filter((row) => row.lifecycle_state === 'generated'
      && dateOnly(row.service_period_end) > '2026-09-08')).toEqual([]);
    expect(rows.filter((row) => row.lifecycle_state === 'generated')).not.toHaveLength(0);
  });

});
