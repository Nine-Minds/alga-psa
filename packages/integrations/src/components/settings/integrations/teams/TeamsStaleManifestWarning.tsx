'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { AlertTriangle, Package } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function TeamsStaleManifestWarning({
  onRegenerate,
  regenerating,
  canRegenerate = true,
}: {
  onRegenerate: () => void;
  regenerating: boolean;
  canRegenerate?: boolean;
}) {
  const { t } = useTranslation('msp/integrations');

  return (
    <Alert id="teams-stale-manifest-warning" variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {t('integrations.teams.settings.staleManifest.title', { defaultValue: 'Teams app package is out of date' })}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {t('integrations.teams.settings.staleManifest.warning', {
            defaultValue: 'Your Teams app package is out of date — regenerate and re-upload.',
          })}
        </p>
        <Button
          id="teams-stale-manifest-regenerate"
          size="sm"
          onClick={onRegenerate}
          disabled={regenerating || !canRegenerate}
        >
          <Package className="mr-2 h-4 w-4" />
          {regenerating
            ? t('integrations.teams.settings.staleManifest.regenerating', { defaultValue: 'Regenerating...' })
            : t('integrations.teams.settings.staleManifest.regenerate', { defaultValue: 'Regenerate package' })}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
