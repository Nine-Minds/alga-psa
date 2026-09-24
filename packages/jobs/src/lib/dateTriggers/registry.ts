import type { DateTriggerSource, DateTriggerSourceId } from './types';
import { clientAnniversarySource } from './sources/clientAnniversary';
import { contractRenewalDecisionSource } from './sources/contractRenewalDecision';
import { contractEndSource } from './sources/contractEnd';
import { assetWarrantyEndSource } from './sources/assetWarrantyEnd';

export const dateTriggerSources: readonly DateTriggerSource[] = [clientAnniversarySource, contractRenewalDecisionSource, contractEndSource, assetWarrantyEndSource];
export function getDateTriggerSource(id: DateTriggerSourceId): DateTriggerSource {
  const source = dateTriggerSources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Unknown date trigger source: ${id}`);
  return source;
}
