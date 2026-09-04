import { resolveTeamsAvailability } from './teamsAvailabilityCore';
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
  return resolveTeamsAvailability(input);
}
