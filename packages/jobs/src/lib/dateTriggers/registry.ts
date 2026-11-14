import type { DateTriggerSource, DateTriggerSourceId } from './types';
import { clientAnniversarySource } from './sources/clientAnniversary';
import { contractRenewalDecisionSource } from './sources/contractRenewalDecision';
import { contractEndSource } from './sources/contractEnd';
import { assetWarrantyEndSource } from './sources/assetWarrantyEnd';
import { assetMaintenanceDueSource } from './sources/assetMaintenanceDue';
import { ticketStatusAgeSource } from './sources/ticketStatusAge';

// The list of sources lives in packages/event-schemas/src/schemas/domain/dateTriggerSourceDefinitions.ts. This is the
// query half: one `findOccurrences` per definition id, plus a `domainEvent` emitter exactly where the
// definition declares one (dateTriggers/registry.test.ts checks both).
export const dateTriggerSources: readonly DateTriggerSource[] = [
  clientAnniversarySource,
  contractRenewalDecisionSource,
  contractEndSource,
  assetWarrantyEndSource,
  assetMaintenanceDueSource,
  ticketStatusAgeSource,
];

export function getDateTriggerSource(id: DateTriggerSourceId): DateTriggerSource {
  const source = dateTriggerSources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Unknown date trigger source: ${id}`);
  return source;
}
