import type { ProjectServiceSource } from '@alga-psa/types';
import type { ITimeEntryWithNew } from './types';

type PrefillFields = Pick<
  ITimeEntryWithNew,
  '_isServicePrefilled' | '_serviceSource' | '_originalServiceId' | 'service_id'
>;

/**
 * Which level a new entry's prefilled service came from, for the provenance
 * badge next to the Service label. Returns null once the picker no longer holds
 * the prefilled value, so an overridden service makes no claim about its origin.
 */
export function resolvePrefilledServiceSource(
  entry: PrefillFields | undefined | null
): ProjectServiceSource | null {
  if (!entry?._isServicePrefilled || !entry._serviceSource) return null;
  if ((entry.service_id ?? null) !== (entry._originalServiceId ?? null)) return null;
  return entry._serviceSource;
}
