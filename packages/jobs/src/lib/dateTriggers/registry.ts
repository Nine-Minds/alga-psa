import type { DateTriggerSource, DateTriggerSourceId } from './types';
import { clientAnniversarySource } from './sources/clientAnniversary';
import { contractRenewalDecisionSource } from './sources/contractRenewalDecision';
import { contractEndSource } from './sources/contractEnd';
import { assetWarrantyEndSource } from './sources/assetWarrantyEnd';

// To add a date source today: write sources/<name>.ts and list it here. Also update every place listed
// in shared/workflow/runtime/schemas/dateTriggerPayloadSchemas.ts.
// LEVERAGE: pattern date-trigger-source-list — this should become the query half of the shared definitions.
export const dateTriggerSources: readonly DateTriggerSource[] = [clientAnniversarySource, contractRenewalDecisionSource, contractEndSource, assetWarrantyEndSource];
export function getDateTriggerSource(id: DateTriggerSourceId): DateTriggerSource {
  const source = dateTriggerSources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Unknown date trigger source: ${id}`);
  return source;
}
