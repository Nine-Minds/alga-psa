'use client';

import { resolveTeamsAvailability } from '../../../lib/teamsAvailability';
import { TeamsIntegrationSettings } from './TeamsIntegrationSettings';
import { useEeEnabled } from '@alga-psa/auth/client';

export function TeamsEnterpriseIntegrationSettings() {
  const eeEnabled = useEeEnabled();
  const availability = resolveTeamsAvailability({
    isEnterpriseEdition: eeEnabled,
    requireTenantContext: false,
  });

  if (!availability.enabled) {
    return null;
  }

  return <TeamsIntegrationSettings />;
}
