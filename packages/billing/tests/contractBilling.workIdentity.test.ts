import { expect, it } from 'vitest';
import { calculateNormalizedContractCharge, normalizeResolvedContractCharge, type ResolvedContractChargeObligation } from '../src/lib/billing/domain/calculateContractCharge';

function roundTrip(work: Record<string, string>) {
  const charge: ResolvedContractChargeObligation = {
    kind: 'hourly', executionMode: 'live',
    taxContext: {
      getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
      getLocationTaxRegionCode: () => null, getClientDefaultTaxRegionCode: () => null,
      isTaxExemptForProfile: () => true, calculateTax: () => ({ taxRate: 0, taxAmount: 0 }),
    },
    inputs: {
      billingPeriod: { startDate: '2026-09-01', endDate: '2026-10-01' },
      clientContractLine: { tenant: 'msp', client_id: 'client', client_contract_line_id: 'line', contract_line_id: 'line',
        start_date: '2026-09-01', end_date: null, is_active: true, currency_code: 'USD', contract_line_type: 'Hourly' },
      timing: { duePosition: 'advance', servicePeriodStart: '2026-09-01', servicePeriodEnd: '2026-09-30',
        servicePeriodStartExclusive: '2026-09-01', servicePeriodEndExclusive: '2026-10-01', coverageRatio: 1 },
      client: { client_id: 'client', is_tax_exempt: true }, plan: {}, contractCurrency: 'USD',
      serviceConfigMap: new Map([['service', { config: { config_id: 'config', hourly_rate: 12000,
        minimum_billable_time: 1, round_up_to_nearest: 1 }, userTypeRates: new Map() }]]),
      timeEntries: [{ entry_id: 'entry', user_id: 'tech', start_time: new Date('2026-09-08T09:00:00Z'),
        end_time: new Date('2026-09-08T10:00:00Z'), service_id: 'service', service_name: 'Support', currency_rate: 12000, billable_duration: 60, ...work }],
    },
  };
  const normalized = normalizeResolvedContractCharge({ obligationId: 'hourly', tenantId: 'msp', charge });
  const result = calculateNormalizedContractCharge(normalized.obligation.facts, 'live', normalized.taxContext);
  expect(result.charges).toHaveLength(1);
  return (result.charges[0] as any).workItemSnapshot;
}

it.each(['ticket', 'project_task'])('contract facts preserve qualified shared %s evidence through charge calculation', kind => {
  expect(roundTrip({ work_item_type: 'co_managed', work_item_id: 'reference', work_source_tenant: 'customer',
    work_source_kind: kind, work_source_id: 'source', work_relationship_id: 'relationship',
    ticket_number: 'T-1', ticket_title: 'Shared ticket', ticket_description: 'Public description', project_task_name: 'Shared task' }))
    .toMatchObject({ workItemType: kind, workItemId: 'source', sourceTenant: 'customer', relationshipId: 'relationship',
      workReferenceId: 'reference', billedMinutes: 60, netAmount: 12000, title: kind === 'ticket' ? 'Shared ticket' : 'Shared task' });
});

it.each(['ticket', 'project_task'])('contract facts preserve ordinary native %s invoice identity', kind => {
  const snapshot = roundTrip({ work_item_type: kind, work_item_id: 'native', ticket_number: 'N-1',
    ticket_title: 'Native ticket', ticket_description: 'Description', project_task_name: 'Native task' });
  expect(snapshot).toMatchObject({ workItemType: kind, workItemId: 'native', billedMinutes: 60, netAmount: 12000,
    title: kind === 'ticket' ? 'Native ticket' : 'Native task' });
  expect(snapshot.sourceTenant).toBeUndefined();
});

it('contract normalization retains incomplete shared identity so snapshot validation rejects it', () => {
  expect(() => roundTrip({ work_item_type: 'co_managed', work_item_id: 'reference' })).toThrow('qualified retained source');
});
