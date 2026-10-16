import { describe, expect, it, vi } from 'vitest';
import { dateTriggerSourceDefinitions } from '@alga-psa/event-schemas';

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/event-bus/workflow/dateDomainEvents', () => ({ toTenantLocalDate: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  buildClientAnniversaryUpcomingPayload: vi.fn(),
  buildContractRenewalUpcomingPayload: vi.fn(),
  buildAssetWarrantyExpiringPayload: vi.fn(),
}));

import { dateTriggerSources } from './registry';

describe('date trigger source registry', () => {
  it('has a findOccurrences query for every shared source definition, and no extras', () => {
    const ids = dateTriggerSourceDefinitions.map((definition) => definition.id).sort();
    expect(dateTriggerSources.map((source) => source.id).sort()).toEqual(ids);
    for (const source of dateTriggerSources) expect(typeof source.findOccurrences).toBe('function');
  });

  it('provides a domain-event emitter exactly for the definitions that declare one, with the same event type and window', () => {
    for (const definition of dateTriggerSourceDefinitions) {
      const source = dateTriggerSources.find((candidate) => candidate.id === definition.id)!;
      if ('domainEvent' in definition) {
        expect(source.domainEvent).toMatchObject({ eventType: definition.domainEvent.eventType, windowDays: definition.domainEvent.windowDays });
      } else {
        expect(source.domainEvent).toBeUndefined();
      }
    }
  });
});
