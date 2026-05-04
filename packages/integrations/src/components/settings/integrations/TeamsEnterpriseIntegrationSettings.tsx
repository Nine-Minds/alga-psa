'use client';

import { resolveTeamsAvailability } from '../../../lib/teamsAvailability';
import { TeamsIntegrationSettings } from './TeamsIntegrationSettings';

export function TeamsEnterpriseIntegrationSettings() {
  const availability = resolveTeamsAvailability({
    isEnterpriseEdition: process.env.NEXT_PUBLIC_EDITION === 'enterprise',
    requireTenantContext: false,
  });

  if (!availability.enabled) {
    return null;
  }

  return <TeamsIntegrationSettings />;
}
