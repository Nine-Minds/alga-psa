'use client';

import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { resolveTeamsAvailability } from '../../../lib/teamsAvailability';
import { TeamsIntegrationSettings } from './TeamsIntegrationSettings';

export function TeamsEnterpriseIntegrationSettings() {
  const teamsUiFlag = useFeatureFlag('teams-integration-ui', { defaultValue: false });

  const availability = resolveTeamsAvailability({
    flagEnabled: teamsUiFlag.enabled,
    isEnterpriseEdition: process.env.NEXT_PUBLIC_EDITION === 'enterprise',
    requireTenantContext: false,
  });

  if (!availability.enabled) {
    return null;
  }

  return <TeamsIntegrationSettings />;
}
