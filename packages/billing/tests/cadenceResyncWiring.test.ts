import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relPath: string) =>
  readFileSync(new URL(relPath, import.meta.url), 'utf8');

const applyHelper = read('../src/actions/applyClientCadenceChange.ts');
const cycleActions = read('../src/actions/billingCycleActions.ts');
const scheduleActions = read('../src/actions/billingScheduleActions.ts');
const anchorActions = read('../src/actions/billingCycleAnchorActions.ts');
const regeneration = read('../src/actions/clientCadenceScheduleRegeneration.ts');
const rspActions = read('../src/actions/recurringServicePeriodActions.ts');
const automaticInvoices = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
// The real cadence editor saves through the clients package helper.
const billingHelpers = read('../../clients/src/lib/billingHelpers.ts');
const cadenceEditor = read('../../clients/src/components/clients/ClientBillingSchedule.tsx');

describe('Cadence-change resync wiring', () => {
  it('T011: applyClientCadenceChange updates the schedule then re-materializes the ledger', () => {
    // Shared mutation owns scalar + anchor + windows; this wrapper adds the
    // ledger re-materialization so cadence and ledger can never drift.
    expect(applyHelper).toContain('updateClientBillingScheduleShared(trx, tenant, input)');
    expect(applyHelper).toContain('regenerateClientCadenceServicePeriodsForScheduleChange(trx, {');
  });

  it('T011: every cadence-mutating action routes through applyClientCadenceChange', () => {
    // The scalar-only path that silently stranded clients now re-materializes.
    expect(cycleActions).toContain('applyClientCadenceChange(trx, tenant, {');
    expect(scheduleActions).toContain('await applyClientCadenceChange(trx, tenant, input)');
    expect(anchorActions).toContain('applyClientCadenceChange(trx, tenant, {');
  });

  it('T011: the client billing-schedule editor path re-materializes too', () => {
    // packages/clients ClientBillingSchedule.tsx saves via this helper.
    expect(billingHelpers).toContain("from '@alga-psa/billing/actions/applyClientCadenceChange'");
    expect(billingHelpers).toContain('await applyClientCadenceChange(trx, tenant, input)');
  });

  it('T004/T005: regeneration preserves billed periods', () => {
    expect(regeneration).toContain('legacyBilledThroughEnd: billedBoundaryEnd');
    expect(regeneration).toContain("regenerationReasonCode: 'billing_schedule_changed'");
  });

  it('T003/T010: preview computes impact without persisting', () => {
    expect(regeneration).toContain('export async function previewClientCadenceScheduleChange');
    expect(regeneration).toContain('unbilledPeriodsToRegenerate');
    expect(regeneration).toContain('billedPeriodsInRange');
    // The preview reuses the same plan computation as the persisting regenerate.
    expect(regeneration).toContain('computeClientCadenceRegeneration');
    expect(scheduleActions).toContain('export const previewClientCadenceChange');
  });

  it('T007/T034: tenant repair-all exists and is permission-gated', () => {
    expect(regeneration).toContain('export async function repairAllClientCadenceServicePeriodsForTenant');
    expect(rspActions).toContain('export const repairAllRecurringServicePeriodsForTenant');
    expect(rspActions).toMatch(/repairAllRecurringServicePeriodsForTenant[\s\S]{0,400}requireRecurringServicePeriodPermission\(\s*user,\s*'regenerate'/);
  });

  it('T012: the cadence editor previews impact and applies only on a second confirm click', () => {
    expect(billingHelpers).toContain('export const previewClientCadenceChangeAsync');
    expect(cadenceEditor).toContain('previewClientCadenceChangeAsync');
    // First click reviews, second click (once an impact exists) applies.
    expect(cadenceEditor).toContain('onClick={cadenceImpact ? saveSchedule : reviewChange}');
    expect(cadenceEditor).toContain('client-billing-cadence-impact');
    // Editing the proposed cadence invalidates a stale impact.
    expect(cadenceEditor).toContain('setCadenceImpact(null)');
  });

  it('T013: the invoicing gap panel offers a plain-language "Fix all" recovery', () => {
    expect(automaticInvoices).toContain('handleFixAllServicePeriods');
    expect(automaticInvoices).toContain('repairAllRecurringServicePeriodsForTenant');
    expect(automaticInvoices).toContain('fix-all-service-periods');
    expect(automaticInvoices).toContain('These billing schedules need to be rebuilt');
  });
});
