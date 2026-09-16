import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TestContext } from 'server/test-utils/testContext';
import { assignContractLineToClient } from '../../../../../test-utils/billingTestHelpers';
import {
  runContractCadenceCoverageAudit,
  type ContractCadenceCoverageRow,
} from '@alga-psa/billing/actions/contractCadenceCoverageAudit';

/**
 * Validates the read-only coverage audit against fixtures for absent, leading,
 * interior-gap, bounded, and intentionally-excluded coverage. The audit SQL is
 * the executable source of truth in
 * packages/billing/src/actions/contractCadenceCoverageAudit.ts.
 */

const dateOnly = (value: unknown) => new Date(value as string | Date).toISOString().slice(0, 10);

const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

describe('Contract-cadence coverage audit', () => {
  let context: TestContext;

  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext,
  } = TestContext.createHelpers();

  async function createLine(options: {
    startDate: string;
    endDate?: string | null;
    name?: string;
    lineActive?: boolean;
  } = { startDate: '2026-02-08' }) {
    const contractLineId = uuidv4();
    await context.createEntity(
      'contract_lines',
      {
        contract_line_id: contractLineId,
        contract_line_name: options.name ?? `Audit Line ${contractLineId.slice(0, 8)}`,
        billing_frequency: 'monthly',
        billing_timing: 'arrears',
        is_custom: false,
        contract_line_type: 'Fixed',
        cadence_owner: 'contract',
        is_active: options.lineActive ?? true,
        custom_rate: 100000,
      },
      'contract_line_id',
    );
    await assignContractLineToClient(context, contractLineId, {
      startDate: options.startDate,
      endDate: options.endDate ?? null,
      contractHeaderIsActive: true,
      isActive: true,
      assignmentStatus: 'pending',
      materializeServicePeriods: false,
    });
    return contractLineId;
  }

  async function seedPeriod(input: {
    obligationId: string;
    serviceStart: string;
    serviceEnd: string;
    lifecycleState: 'generated' | 'billed' | 'locked' | 'edited' | 'skipped';
    invoiceLinked?: boolean;
    provenanceKind?: 'generated' | 'user_edited' | 'repair' | 'regenerated';
    periodKey?: string;
  }) {
    await context.db('recurring_service_periods').insert({
      record_id: uuidv4(),
      tenant: context.tenantId,
      schedule_key: `schedule:${context.tenantId}:contract_line:${input.obligationId}:contract:arrears`,
      period_key: input.periodKey ?? `period:${input.serviceStart}:${input.serviceEnd}`,
      revision: 1,
      obligation_id: input.obligationId,
      obligation_type: 'contract_line',
      charge_family: 'fixed',
      cadence_owner: 'contract',
      due_position: 'arrears',
      lifecycle_state: input.lifecycleState,
      service_period_start: input.serviceStart,
      service_period_end: input.serviceEnd,
      invoice_window_start: input.serviceEnd,
      invoice_window_end: addDays(input.serviceEnd, 31),
      activity_window_start: null,
      activity_window_end: null,
      timing_metadata: null,
      provenance_kind: input.provenanceKind ?? 'generated',
      source_rule_version: 'contract_cadence|billing_cycle:monthly|anchor:2026-02-08|due:arrears',
      reason_code: 'initial_materialization',
      source_run_key: 'audit-fixture',
      supersedes_record_id: null,
      invoice_id: input.invoiceLinked ? uuidv4() : null,
      invoice_charge_id: input.invoiceLinked ? uuidv4() : null,
      invoice_charge_detail_id: input.invoiceLinked ? uuidv4() : null,
      invoice_linked_at: input.invoiceLinked ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  async function audit(asOf: string, tenant = context.tenantId) {
    const result = await runContractCadenceCoverageAudit(context.db, { asOf, tenant });
    const byLine = new Map<string, ContractCadenceCoverageRow>(
      result.coverage.map((row) => [String(row.contract_line_id), row]),
    );
    return { ...result, byLine };
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: ['recurring_service_periods', 'client_billing_cycles', 'client_billing_settings'],
      clientName: 'Coverage Audit Client',
      userType: 'internal',
    });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('flags absent and leading-gap coverage', async () => {
    const absent = await createLine({ startDate: '2026-02-08', name: 'Absent Coverage' });
    const leading = await createLine({ startDate: '2026-02-08', name: 'Leading Gap' });
    await seedPeriod({
      obligationId: leading,
      serviceStart: '2026-04-08',
      serviceEnd: '2026-05-08',
      lifecycleState: 'generated',
    });

    const { byLine } = await audit('2026-09-15');

    const absentRow = byLine.get(absent)!;
    expect(absentRow).toBeTruthy();
    expect(absentRow.furthest_end).toBeNull();
    expect(absentRow.exhausted).toBe(true);
    expect(absentRow.below_threshold).toBe(true);
    expect(absentRow.meets_target).toBe(false);
    expect(absentRow.leading_gap).toBe(true);
    expect(absentRow.leading_gap_intentional).toBe(false);

    const leadingRow = byLine.get(leading)!;
    expect(dateOnly(leadingRow.first_start)).toBe('2026-04-08');
    expect(dateOnly(leadingRow.coverage_floor_start)).toBe('2026-02-08');
    expect(leadingRow.leading_gap).toBe(true);
    expect(leadingRow.leading_gap_intentional).toBe(false);
  });

  it('classifies a protected leading exclusion as intentional, not a missing first period', async () => {
    // An edited override that shifts the first period forward but retains the
    // Aug 8–Sep 8 slot protects that candidate. The Aug 8–Aug 15 hole is an
    // intentional exclusion, so it must not count as a recoverable leading gap.
    const shifted = await createLine({ startDate: '2026-08-08', name: 'Shifted Leading Override' });
    await seedPeriod({
      obligationId: shifted,
      serviceStart: '2026-08-15',
      serviceEnd: '2026-09-08',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
      periodKey: 'period:2026-08-08:2026-09-08',
    });
    await seedPeriod({
      obligationId: shifted,
      serviceStart: '2026-09-08',
      serviceEnd: '2026-10-08',
      lifecycleState: 'generated',
    });

    const { byLine } = await audit('2026-09-15');
    const row = byLine.get(shifted)!;

    expect(dateOnly(row.first_start)).toBe('2026-08-15');
    expect(dateOnly(row.coverage_floor_start)).toBe('2026-08-08');
    expect(row.leading_gap).toBe(false);
    expect(row.leading_gap_intentional).toBe(true);
  });

  it('reports interior gaps, separating intentional exclusions before the billed floor', async () => {
    const recoverable = await createLine({ startDate: '2026-02-08', name: 'Recoverable Gap' });
    await seedPeriod({ obligationId: recoverable, serviceStart: '2026-02-08', serviceEnd: '2026-03-08', lifecycleState: 'generated' });
    await seedPeriod({ obligationId: recoverable, serviceStart: '2026-04-08', serviceEnd: '2026-05-08', lifecycleState: 'generated' });

    const intentional = await createLine({ startDate: '2026-01-08', name: 'Intentional Gap' });
    await seedPeriod({ obligationId: intentional, serviceStart: '2026-01-08', serviceEnd: '2026-02-08', lifecycleState: 'locked' });
    await seedPeriod({ obligationId: intentional, serviceStart: '2026-04-08', serviceEnd: '2026-05-08', lifecycleState: 'billed', invoiceLinked: true });

    const { interiorGaps } = await audit('2026-09-15');

    const recoverableGap = interiorGaps.find((gap) => gap.obligation_id === recoverable);
    expect(recoverableGap).toBeTruthy();
    expect(dateOnly(recoverableGap!.gap_start)).toBe('2026-04-08');
    expect(recoverableGap!.is_intentional).toBe(false);

    const intentionalGap = interiorGaps.find((gap) => gap.obligation_id === intentional);
    expect(intentionalGap).toBeTruthy();
    expect(dateOnly(intentionalGap!.gap_start)).toBe('2026-04-08');
    expect(intentionalGap!.is_intentional).toBe(true);
  });

  it('marks a gap left by a protected override intentional without hiding an unrelated gap', async () => {
    // The Aug 8–Sep 15 override retains the Aug 8–Sep 8 slot, so canonical
    // protection suppresses the Sep 8–Oct 8 candidate and the ledger jumps to
    // Oct 8. The resulting Sep 15–Oct 8 hole is an intentional exclusion, not
    // recoverable. A genuinely missing month on another line must still be
    // reported as recoverable.
    const overridden = await createLine({ startDate: '2026-08-08', name: 'Protected Override Gap' });
    await seedPeriod({
      obligationId: overridden,
      serviceStart: '2026-08-08',
      serviceEnd: '2026-09-15',
      lifecycleState: 'edited',
      provenanceKind: 'user_edited',
      periodKey: 'period:2026-08-08:2026-09-08',
    });
    await seedPeriod({
      obligationId: overridden,
      serviceStart: '2026-10-08',
      serviceEnd: '2026-11-08',
      lifecycleState: 'generated',
    });

    const recoverable = await createLine({ startDate: '2026-02-08', name: 'Unrelated Recoverable Gap' });
    await seedPeriod({ obligationId: recoverable, serviceStart: '2026-02-08', serviceEnd: '2026-03-08', lifecycleState: 'generated' });
    await seedPeriod({ obligationId: recoverable, serviceStart: '2026-04-08', serviceEnd: '2026-05-08', lifecycleState: 'generated' });

    const { interiorGaps } = await audit('2026-09-15');

    const overriddenGap = interiorGaps.find((gap) => gap.obligation_id === overridden);
    expect(overriddenGap).toBeTruthy();
    expect(dateOnly(overriddenGap!.gap_start)).toBe('2026-10-08');
    expect(overriddenGap!.is_intentional).toBe(true);

    const recoverableGap = interiorGaps.find((gap) => gap.obligation_id === recoverable);
    expect(recoverableGap).toBeTruthy();
    expect(dateOnly(recoverableGap!.gap_start)).toBe('2026-04-08');
    expect(recoverableGap!.is_intentional).toBe(false);
  });

  it('clips the target to the assignment end for short assignments', async () => {
    const bounded = await createLine({
      startDate: '2026-02-08',
      endDate: '2026-08-08',
      name: 'Bounded Assignment',
    });
    await seedPeriod({ obligationId: bounded, serviceStart: '2026-06-08', serviceEnd: '2026-08-08', lifecycleState: 'generated' });

    const { byLine } = await audit('2026-06-01');
    const row = byLine.get(bounded)!;

    // Target for asOf 2026-06-01 is 2026-11-28, but the assignment ends
    // 2026-08-08; coverage through the assignment end is complete.
    expect(dateOnly(row.effective_target_end)).toBe('2026-08-08');
    expect(row.meets_target).toBe(true);
    expect(row.below_threshold).toBe(false);
    expect(row.exhausted).toBe(false);
  });

  it('excludes ineligible lines (client cadence, inactive, ended) from coverage', async () => {
    const clientCadenceId = uuidv4();
    await context.createEntity(
      'contract_lines',
      {
        contract_line_id: clientCadenceId,
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
    await assignContractLineToClient(context, clientCadenceId, {
      startDate: '2026-02-08',
      materializeServicePeriods: false,
    });

    const ended = await createLine({ startDate: '2026-02-08', endDate: '2026-05-08', name: 'Ended Before Audit' });

    const { byLine } = await audit('2026-09-15');
    expect(byLine.has(clientCadenceId)).toBe(false);
    expect(byLine.has(ended)).toBe(false);
  });
});
