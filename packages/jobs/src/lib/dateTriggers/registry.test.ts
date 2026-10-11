import { describe, expect, it, vi } from 'vitest';
import { dateTriggerSourceDefinitions } from '@alga-psa/shared/workflow/runtime/dateTriggerSourceDefinitions';

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/event-bus/workflow/dateDomainEvents', () => ({ toTenantLocalDate: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildClientAnniversaryUpcomingPayload: vi.fn(),
  buildContractRenewalUpcomingPayload: vi.fn(),
  buildAssetWarrantyExpiringPayload: vi.fn(),
}));

import { dateTriggerSources, dateTriggerSourceDomainEvents } from './registry';

describe('date trigger source registry', () => {
  it('has a findOccurrences query for every shared source definition, and no extras', () => {
    const ids = dateTriggerSourceDefinitions.map((definition) => definition.id).sort();
    expect(dateTriggerSources.map((source) => source.id).sort()).toEqual(ids);
    for (const source of dateTriggerSources) expect(typeof source.findOccurrences).toBe('function');
  });

  it('provides a domain-event payload builder exactly for the definitions that declare a domain event', () => {
    for (const definition of dateTriggerSourceDefinitions) {
      const source = dateTriggerSources.find((candidate) => candidate.id === definition.id)!;
      const declares = 'domainEvent' in definition;
      expect(dateTriggerSourceDomainEvents.has(definition.id)).toBe(declares);
      expect(typeof source.buildDomainEventPayload === 'function').toBe(declares);
    }
  });
});
