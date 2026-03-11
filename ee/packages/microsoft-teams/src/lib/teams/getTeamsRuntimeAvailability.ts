import { getTeamsAvailability, type TeamsAvailability } from './teamsAvailability';
import type { TeamsCapability } from './teamsShared';
import { resolveTeamsTenantContext } from './resolveTeamsTenantContext';

interface GetTeamsRuntimeAvailabilityInput {
  explicitTenantId?: string | null;
  microsoftTenantId?: string | null;
  requiredCapability?: TeamsCapability;
  userId?: string | null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export async function getTeamsRuntimeAvailability(
  input: GetTeamsRuntimeAvailabilityInput
): Promise<TeamsAvailability | null> {
  const explicitTenantId = normalizeOptionalString(input.explicitTenantId);
  const microsoftTenantId = normalizeOptionalString(input.microsoftTenantId);

  if (!explicitTenantId && !microsoftTenantId) {
    return null;
  }

  const tenantContext = await resolveTeamsTenantContext({
    explicitTenantId,
    microsoftTenantId,
    requiredCapability: input.requiredCapability,
  });

  const tenantId = tenantContext.status === 'resolved' ? tenantContext.tenantId : explicitTenantId;
  if (!tenantId) {
    return null;
  }

  return getTeamsAvailability({
    tenantId,
    userId: normalizeOptionalString(input.userId),
  });
}
