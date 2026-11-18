/**
 * The registry now lives in @alga-psa/types so feature packages that may not
 * depend on integrations (assets) can share it. This module keeps the existing
 * import path working.
 */
export {
  RMM_KNOWN_CONNECTION_TYPES,
  RMM_GENERIC_CONNECTION_LABEL_KEY,
  normalizeRmmConnectionType,
  describeRmmConnectionType,
  parseRmmConnectionType,
  rmmConnectionTypesForProvider,
} from '@alga-psa/types';
export type {
  RmmConnectionIcon,
  RmmKnownConnectionTypeEntry,
  KnownRmmRemoteConnectionType,
  RmmRemoteConnectionType,
  RmmConnectionTypeDescription,
} from '@alga-psa/types';
