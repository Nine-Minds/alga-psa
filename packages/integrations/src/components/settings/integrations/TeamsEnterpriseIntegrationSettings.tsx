'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { resolveTeamsAvailability } from '../../../lib/teamsAvailability';

const EnterpriseTeamsIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/TeamsIntegrationSettings'),
  {
    loading: () => (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <span className="text-sm text-muted-foreground">Loading Microsoft Teams settings...</span>
          </div>
        </CardContent>
      </Card>
    ),
    ssr: false,
  }
);

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

  return <EnterpriseTeamsIntegrationSettings />;
}
