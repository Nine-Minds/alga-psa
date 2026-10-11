import { dateTriggerSourceDefinitions } from '@alga-psa/shared/workflow/runtime/dateTriggerSourceDefinitions';
import type { DateTriggerSource, DateTriggerSourceId } from './types';
import { clientAnniversarySource } from './sources/clientAnniversary';
import { contractRenewalDecisionSource } from './sources/contractRenewalDecision';
import { contractEndSource } from './sources/contractEnd';
import { assetWarrantyEndSource } from './sources/assetWarrantyEnd';
import { ticketStatusAgeSource } from './sources/ticketStatusAge';

// The list of sources lives in shared/workflow/runtime/dateTriggerSourceDefinitions.ts. This is the
// query half: one `findOccurrences` per definition id (dateTriggers/registry.test.ts checks none is missing).
export const dateTriggerSources: readonly DateTriggerSource[] = [
  clientAnniversarySource,
  contractRenewalDecisionSource,
  contractEndSource,
  assetWarrantyEndSource,
  ticketStatusAgeSource,
];

export const dateTriggerSourceDomainEvents = new Map<DateTriggerSourceId, { eventType: string; windowDays: number }>(
  dateTriggerSourceDefinitions.flatMap((definition) => ('domainEvent' in definition ? [[definition.id, definition.domainEvent] as const] : [])),
);

export function getDateTriggerSource(id: DateTriggerSourceId): DateTriggerSource {
  const source = dateTriggerSources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Unknown date trigger source: ${id}`);
  return source;
}
