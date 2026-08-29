import { isFeatureFlagEnabled, RELEASE_V1_5_FEATURE_FLAG } from '@alga-psa/core/features';
import {
  disabledTeamsAvailability,
  resolveTeamsAvailability,
} from './teamsAvailabilityCore';
import type {
  GetTeamsAvailabilityInput,
  TeamsAvailability,
} from './teamsAvailabilityCore';

export {
  isTeamsEnterpriseEdition,
  resolveTeamsAvailability,
  TEAMS_AVAILABILITY_MESSAGES,
} from './teamsAvailabilityCore';
export type {
  GetTeamsAvailabilityInput,
  ResolveTeamsAvailabilityInput,
  TeamsAvailability,
  TeamsAvailabilityDisabledReason,
} from './teamsAvailabilityCore';

export async function getTeamsAvailability(input: GetTeamsAvailabilityInput = {}): Promise<TeamsAvailability> {
  const baseAvailability = resolveTeamsAvailability(input);
  if (baseAvailability.enabled === false) {
    return baseAvailability;
  }

  const tenantId = (input.tenantId || '').trim();
  if (tenantId && !(await isFeatureFlagEnabled(RELEASE_V1_5_FEATURE_FLAG, {
    tenantId,
    userId: input.userId || undefined,
  }))) {
    return disabledTeamsAvailability('feature_disabled');
  }

  return baseAvailability;
}
