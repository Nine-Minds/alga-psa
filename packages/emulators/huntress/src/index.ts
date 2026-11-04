import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { HuntressEmulatorCore } from './core';
import { register } from './register';
import { wire } from './wire';

const huntressEmulator: EmulatorPackage<HuntressEmulatorCore> = {
  id: 'huntress',
  displayName: 'Huntress',
  defaultPort: 4090,
  createCore: (env) => new HuntressEmulatorCore(env),
  wire,
  register,
};

export default huntressEmulator;
export { huntressEmulator as emulator };
export {
  HuntressEmulatorCore,
  HuntressWireError,
  HUNTRESS_ACCOUNT_STATUSES,
  HUNTRESS_AGENT_PLATFORMS,
  HUNTRESS_CREDENTIAL_ERROR,
  HUNTRESS_DEFAULT_API_KEY,
  HUNTRESS_DEFAULT_API_SECRET,
  HUNTRESS_DETERMINATIONS,
  HUNTRESS_ESCALATION_STATUSES,
  HUNTRESS_INCIDENT_FILTER_STATUSES,
  HUNTRESS_INCIDENT_PLATFORMS,
  HUNTRESS_INCIDENT_STATUSES,
  HUNTRESS_INDICATOR_TYPES,
  HUNTRESS_NOT_FOUND_ERROR,
  HUNTRESS_RESOLUTION_METHODS,
  HUNTRESS_RESOLUTION_SCOPES,
  HUNTRESS_SEVERITIES,
  HUNTRESS_SORT_FIELDS,
  HUNTRESS_SUPPORT_TYPES,
  HUNTRESS_UNWANTED_ACCESS_TYPE_CODES,
} from './core';
export type {
  AuthFailureRecord,
  HuntressAccountRecord,
  HuntressAgentRecord,
  HuntressConfig,
  HuntressCredential,
  HuntressDetermination,
  HuntressEscalationEntity,
  HuntressEscalationRecord,
  HuntressEscalationStatus,
  HuntressIncidentRecord,
  HuntressIncidentStatus,
  HuntressOrganizationRecord,
  HuntressRemediationRecord,
  HuntressResolutionMethod,
  HuntressResolutionParameters,
  HuntressResolutionScope,
  HuntressResource,
  HuntressSeverity,
  HuntressSnapshot,
  OperationFault,
  PresentedEscalation,
} from './core';
