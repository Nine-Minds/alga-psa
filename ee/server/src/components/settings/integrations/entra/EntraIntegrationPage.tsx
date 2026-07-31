'use client';

import React from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEntraIntegrationStatus,
  type EntraStatusResponse,
} from '@alga-psa/integrations/actions';
import { buildEntraCallbackErrorKey } from './entraCallbackErrors';
import { EntraConsole } from './EntraConsole';
import { EntraSetupWizard } from './EntraSetupWizard';
import { selectEntraSurfaceMode } from './entraSetupModel';

interface EntraIntegrationPageProps {
  /** Whether the tenant's tier includes CIPP. Defaults to true. */
  canUseCipp?: boolean;
}

/**
 * The Entra surface's own route. It owns the one status fetch both modes need
 * and decides which mode is showing: guided setup until a real sync has
 * completed, the operations console afterwards.
 */
export default function EntraIntegrationPage({
  canUseCipp: canUseCippTier = true,
}: EntraIntegrationPageProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const cippFlag = useFeatureFlag('entra-integration-cipp', { defaultValue: false });
  const [status, setStatus] = React.useState<EntraStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [callbackError, setCallbackError] = React.useState<string | null>(null);

  const loadStatus = React.useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const result = await getEntraIntegrationStatus();
      if ('error' in result) {
        setStatus(null);
        setStatusError(result.error || t('integrations.entra.settings.errors.loadStatus'));
        return;
      }
      setStatus(result.data || null);
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Report the Direct OAuth round trip. The callback validates against Graph
  // before persisting, so a rejected connection lands back here having written
  // nothing — which without a message reads as "the button did nothing". The
  // params are consumed once so a refresh does not re-raise the error.
  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const callbackStatus = params.get('entra_status');
    if (!callbackStatus) {
      return;
    }

    if (callbackStatus === 'failure') {
      setCallbackError(t(buildEntraCallbackErrorKey(params.get('error'))));
    }

    params.delete('entra_status');
    params.delete('error');
    params.delete('message');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );
  }, [t]);

  const cippAvailable = cippFlag.enabled && canUseCippTier;
  const mode = selectEntraSurfaceMode({ hasCompletedFirstSync: status?.hasCompletedFirstSync });

  return (
    <div className="space-y-4" id="entra-integration-page" data-entra-surface-mode={mode}>
      {callbackError ? (
        <p className="text-sm text-destructive" id="entra-callback-error">
          {callbackError}
        </p>
      ) : null}
      {statusError ? (
        <p className="text-sm text-destructive" id="entra-page-status-error">
          {statusError}
        </p>
      ) : null}

      {mode === 'setup' ? (
        <EntraSetupWizard
          status={status}
          statusLoading={statusLoading}
          cippAvailable={cippAvailable}
          onStatusChanged={loadStatus}
        />
      ) : (
        <EntraConsole
          status={status}
          cippAvailable={cippAvailable}
          onStatusChanged={loadStatus}
        />
      )}
    </div>
  );
}
