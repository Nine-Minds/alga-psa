'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { EntraCippConnectionView } from './entraConsoleModel';

interface EntraCippConnectionDetailsProps {
  view: EntraCippConnectionView;
  /** Prefix for element ids, so the console and wizard instances stay unique. */
  idPrefix: string;
  /** Opens the connect dialog in reconnect mode. */
  onReconnect: () => void;
  disabled?: boolean;
}

// LEVERAGE: pattern label-value-row — a third copy of the console's KeyValue row; a shared row primitive in @alga-psa/ui would remove these.
function Row({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm" id={id}>
      <span className="flex-shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right" title={value}>{value}</span>
    </div>
  );
}

/**
 * The CIPP connection's identity: auth type, API URL, client ID and tenant ID.
 * Everything here is an identifier; the client secret and legacy API key are
 * not part of the status payload and are never rendered. A legacy connection
 * is labelled and offered a Reconnect, which opens the API-client dialog —
 * nothing migrates until that dialog's Save succeeds.
 */
export function EntraCippConnectionDetails({
  view,
  idPrefix,
  onReconnect,
  disabled = false,
}: EntraCippConnectionDetailsProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const na = t('integrations.entra.settings.connection.notAvailable');

  return (
    <div id={`${idPrefix}-cipp-details`}>
      {view.authType ? (
        <div className="flex items-center justify-between gap-3 py-1 text-sm" id={`${idPrefix}-cipp-auth-type`}>
          <span className="flex-shrink-0 text-muted-foreground">
            {t('integrations.entra.settings.connection.authTypeLabel')}
          </span>
          {view.isLegacy ? (
            <Badge variant="warning" id={`${idPrefix}-cipp-legacy-badge`}>
              {t('integrations.entra.settings.connection.authTypes.legacy_api_token')}
            </Badge>
          ) : (
            <span>{t('integrations.entra.settings.connection.authTypes.api_client')}</span>
          )}
        </div>
      ) : null}
      <Row
        id={`${idPrefix}-cipp-api-url`}
        label={t('integrations.entra.settings.connection.apiUrlLabel')}
        value={view.apiUrl || na}
      />
      {view.authType === 'api_client' ? (
        <>
          <Row
            id={`${idPrefix}-cipp-client-id`}
            label={t('integrations.entra.settings.connection.clientIdLabel')}
            value={view.clientId || na}
          />
          <Row
            id={`${idPrefix}-cipp-tenant-id`}
            label={t('integrations.entra.settings.connection.cippTenantIdLabel')}
            value={view.tenantId || na}
          />
        </>
      ) : null}
      {view.isLegacy ? (
        <div className="mt-2 space-y-2" id={`${idPrefix}-cipp-legacy-notice`}>
          <p className="text-sm text-muted-foreground">
            {t('integrations.entra.settings.connection.legacyNotice')}
          </p>
          <Button
            id={`${idPrefix}-cipp-reconnect`}
            type="button"
            size="sm"
            variant="outline"
            onClick={onReconnect}
            disabled={disabled}
          >
            {t('integrations.entra.settings.connection.reconnectCipp')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
