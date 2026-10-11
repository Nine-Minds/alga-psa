import { assertPsaOnlyTenantAccess, ProductAccessError } from '@shared/services/productAccessGuard';
import { resolveTeamsAvailability, disabledTeamsAvailability } from './teamsAvailabilityCore';
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
  const availability = resolveTeamsAvailability(input);
  if (!availability.enabled || !input.tenantId?.trim()) return availability;
  try { await assertPsaOnlyTenantAccess(input.tenantId, 'teams_integration'); }
  catch (error) {
    if (error instanceof ProductAccessError) return disabledTeamsAvailability('product_unavailable');
    throw error;
  }
  return availability;
}
