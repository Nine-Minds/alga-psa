'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Link2,
  RefreshCw
} from 'lucide-react';
import {
  disconnectXero,
  getXeroConnectionStatus,
  saveXeroCredentials
} from '@alga-psa/integrations/actions';
import { XeroLiveMappingManager } from '../../xero/XeroLiveMappingManager';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type XeroStatus = Awaited<ReturnType<typeof getXeroConnectionStatus>>;
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function describeCallbackError(code: string | null, t: TranslateFn): string | null {
  switch (code) {
    case 'config_missing':
      return t('integrations.xero.settings.callback.configMissing', { defaultValue: 'Xero OAuth could not start because the tenant client ID and client secret were not fully configured.' });
    case 'no_connections':
      return t('integrations.xero.settings.callback.noConnections', { defaultValue: 'Xero did not return any organisations for this login. Check your Xero app and organisation access, then try again.' });
    case 'connections_unmapped':
      return t('integrations.xero.settings.callback.connectionsUnmapped', { defaultValue: 'Xero returned organisations, but none included the identifiers required to save a connection.' });
    case 'oauth_failed':
      return t('integrations.xero.settings.callback.oauthFailed', { defaultValue: 'Xero could not finish connecting. Try again. If it keeps failing, review app setup.' });
    case 'invalid_state':
      return t('integrations.xero.settings.callback.invalidState', { defaultValue: 'This Xero connection attempt expired. Start again.' });
    case 'missing_params':
      return t('integrations.xero.settings.callback.missingParams', { defaultValue: 'The Xero callback was missing required parameters. Start the connect flow again.' });
    case 'access_denied':
      return t('integrations.xero.settings.callback.accessDenied', { defaultValue: 'Xero access was denied before the connection completed.' });
    default:
      return code ? t('integrations.xero.settings.callback.generic', { defaultValue: 'Xero returned an OAuth error: {{code}}', code }) : null;
  }
}

function FeedbackMessage({
  tone,
  children
}: {
  tone: 'success' | 'error';
  children: React.ReactNode;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${toneClass}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export default function XeroIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState<XeroStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');

  const oauthStatus = searchParams?.get('xero_status');
  const oauthError = React.useMemo(
    () => describeCallbackError(searchParams?.get('xero_error') ?? null, t),
    [searchParams, t]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getXeroConnectionStatus();
      setStatus(result);
    } catch (err) {
      setError(t('integrations.xero.settings.errors.load', { defaultValue: 'Failed to load Xero settings.' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (oauthStatus === 'success') {
      setSuccessMessage(t('integrations.xero.settings.connectSuccess', { defaultValue: 'Xero connected successfully. The first connected organisation is now the default live Xero context.' }));
      void load();
      return;
    }

    if (oauthStatus === 'failure' && oauthError) {
      setError(oauthError);
    }
  }, [load, oauthError, oauthStatus, t]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await saveXeroCredentials({
        clientId,
        clientSecret
      });

      if (!result.success) {
        setError(t('integrations.xero.settings.errors.saveCredentials', { defaultValue: 'Failed to save Xero credentials.' }));
        return;
      }

      setClientId('');
      setClientSecret('');
      setSuccessMessage(t('integrations.xero.settings.credentialsSaved', { defaultValue: 'Xero credentials saved. You can now connect a Xero organisation.' }));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await disconnectXero();
      if (!result.success) {
        setError(t('integrations.xero.settings.errors.disconnect', { defaultValue: 'Failed to disconnect Xero.' }));
        return;
      }

      setSuccessMessage(t('integrations.xero.settings.disconnectSuccess', { defaultValue: 'The stored Xero connection was removed. Tenant-owned Xero app credentials were preserved.' }));
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const readyToSave = clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const canConnect = Boolean(status?.credentials.ready);
  const defaultConnection = status?.defaultConnection;
  const isConnected = defaultConnection?.status === 'connected';
  const isExpired = defaultConnection?.status === 'expired';

  const connectionStatusLabel = loading
    ? t('integrations.xero.settings.connection.checking', { defaultValue: 'Checking connection' })
    : isConnected
      ? t('integrations.xero.settings.connection.connected', { defaultValue: 'Connected' })
      : isExpired
        ? t('integrations.xero.settings.connection.needsAttention', { defaultValue: 'Needs attention' })
        : canConnect
          ? t('integrations.xero.settings.connection.ready', { defaultValue: 'Ready to connect' })
          : t('integrations.xero.settings.connection.setupRequired', { defaultValue: 'Setup required' });

  const connectionStatusDescription = loading
    ? t('integrations.xero.settings.connection.checkingDescription', { defaultValue: 'Reading the tenant Xero configuration.' })
    : defaultConnection
      ? isExpired
        ? t('integrations.xero.settings.connection.expiredDescription', { defaultValue: 'Reconnect Xero to resume live exports and mappings.' })
        : t('integrations.xero.settings.connection.connectedDescription', { defaultValue: 'Live exports and mappings use this Xero organisation.' })
      : t('integrations.xero.settings.connection.notConnected', { defaultValue: 'No live Xero organisation is connected yet. Save credentials, then click Connect Xero.' });

  const connectionDotClass = loading
    ? 'bg-muted-foreground/60'
    : isConnected
      ? 'bg-emerald-500'
      : isExpired
        ? 'bg-amber-500'
        : canConnect
          ? 'bg-sky-500'
          : 'bg-muted-foreground/60';

  return (
    <div className="space-y-8" id="xero-integration-settings">
      {successMessage ? (
        <FeedbackMessage tone="success">{successMessage}</FeedbackMessage>
      ) : null}

      {error ? <FeedbackMessage tone="error">{error}</FeedbackMessage> : null}

      <section id="xero-integration-connection-card" className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${connectionDotClass}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h4 className="text-base font-semibold text-foreground">
                {connectionStatusLabel}
              </h4>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {connectionStatusDescription}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              id="xero-connect-button"
              type="button"
              disabled={!canConnect}
              onClick={() => window.location.assign('/api/integrations/xero/connect')}
            >
              {defaultConnection
                ? t('integrations.xero.settings.actions.reconnect', { defaultValue: 'Reconnect Xero' })
                : t('integrations.xero.settings.actions.connect', { defaultValue: 'Connect Xero' })}
            </Button>

            <Button
              id="xero-settings-refresh"
              type="button"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('integrations.xero.settings.actions.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </div>

        {status?.error && defaultConnection ? (
          <p className={isConnected ? 'text-sm text-muted-foreground' : 'text-sm text-red-600'}>
            {status.error}
          </p>
        ) : null}

        {defaultConnection ? (
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('integrations.xero.settings.connection.defaultOrganisation', { defaultValue: 'Organisation' })}
              </dt>
              <dd className="mt-1 truncate text-foreground">
                {defaultConnection.tenantName || defaultConnection.xeroTenantId}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('integrations.xero.settings.connection.statusLabel', { defaultValue: 'Status' })}
              </dt>
              <dd className="mt-1 text-foreground">
                {isExpired
                  ? t('integrations.xero.settings.badges.connectionExpired', { defaultValue: 'Connection Expired' })
                  : t('integrations.xero.settings.badges.connected', { defaultValue: 'Connected' })}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('integrations.xero.settings.connection.connectionIdLabel', { defaultValue: 'Connection ID' })}
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 font-mono text-xs text-foreground">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{defaultConnection.connectionId}</span>
              </dd>
            </div>
          </dl>
        ) : null}

        <div className="rounded-lg border">
          <div className="px-4 py-3">
            <h4 className="text-sm font-semibold text-foreground">
              {t('integrations.xero.settings.tenantOauthTitle', { defaultValue: 'Xero app setup' })}
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('integrations.xero.settings.tenantOauthDescription', { defaultValue: 'Paste the credentials from your Xero app registration. Secret values are hidden after they are saved.' })}
            </p>
          </div>
          <div className="space-y-6 border-t px-4 py-5">
            {loading ? (
              <div className="text-sm text-muted-foreground">{t('integrations.xero.settings.loading', { defaultValue: 'Loading Xero settings…' })}</div>
            ) : (
              <>
                <dl className="grid gap-4 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('integrations.xero.settings.redirectUri', { defaultValue: 'Redirect URI' })}</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-foreground">{status?.redirectUri}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('integrations.xero.settings.requiredScopes', { defaultValue: 'Required scopes' })}</dt>
                    <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {status?.scopes?.map((scope) => (
                        <code key={scope} className="font-mono text-xs text-foreground">{scope}</code>
                      ))}
                    </dd>
                  </div>
                </dl>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="xero-client-id">{t('integrations.xero.settings.clientIdLabel', { defaultValue: 'Xero Client ID' })}</Label>
                    <Input
                      id="xero-client-id"
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      placeholder={t('integrations.xero.settings.clientIdPlaceholder', { defaultValue: 'Paste your Xero client ID' })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {status?.credentials.clientIdMasked
                        ? t('integrations.xero.settings.storedClientId', { defaultValue: 'Stored client ID: {{value}}', value: status.credentials.clientIdMasked })
                        : t('integrations.xero.settings.noClientId', { defaultValue: 'No client ID is stored yet.' })}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="xero-client-secret">{t('integrations.xero.settings.clientSecretLabel', { defaultValue: 'Xero Client Secret' })}</Label>
                    <Input
                      id="xero-client-secret"
                      type="password"
                      value={clientSecret}
                      onChange={(event) => setClientSecret(event.target.value)}
                      placeholder={t('integrations.xero.settings.clientSecretPlaceholder', { defaultValue: 'Paste your Xero client secret' })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {status?.credentials.clientSecretMasked
                        ? t('integrations.xero.settings.storedClientSecret', { defaultValue: 'Stored client secret: {{value}}', value: status.credentials.clientSecretMasked })
                        : t('integrations.xero.settings.noClientSecret', { defaultValue: 'No client secret is stored yet.' })}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {status?.credentials.ready
                      ? t('integrations.xero.settings.credentialsReady', { defaultValue: 'Xero app credentials are saved.' })
                      : t('integrations.xero.settings.badges.credentialsRequired', { defaultValue: 'Credentials Required' })}
                  </p>
                  <Button
                    id="xero-settings-save"
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!readyToSave || saving}
                  >
                    {saving
                      ? t('integrations.xero.settings.actions.saving', { defaultValue: 'Saving…' })
                      : t('integrations.xero.settings.actions.saveCredentials', { defaultValue: 'Save credentials' })}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button
            id="xero-disconnect-button"
            type="button"
            variant="outline"
            disabled={!defaultConnection || disconnecting}
            onClick={() => void handleDisconnect()}
          >
            {disconnecting
              ? t('integrations.xero.settings.actions.disconnecting', { defaultValue: 'Disconnecting…' })
              : t('integrations.xero.settings.actions.disconnect', { defaultValue: 'Disconnect Xero' })}
          </Button>

          {defaultConnection ? (
            <Button id="xero-open-accounting-exports" asChild variant="link">
              <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-1.5">
                {t('integrations.accounting.settings.viewExportHistory', { defaultValue: 'View export history' })}
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground" id="xero-integration-manual-alternative">
          <span className="font-medium text-foreground">
            {t('integrations.xero.settings.csvAvailableTitle', { defaultValue: 'Xero CSV remains available' })}
          </span>{' '}
          {t('integrations.xero.settings.csvAvailablePrefix', { defaultValue: 'If you prefer a manual workflow, keep using' })}{' '}
          <strong>{t('integrations.xero.settings.xeroCsv', { defaultValue: 'Xero CSV' })}</strong>{' '}
          {t('integrations.xero.settings.csvAvailableMiddle', { defaultValue: 'and manage exports from' })}{' '}
          <Link href="/msp/billing?tab=accounting-exports" className="font-medium underline underline-offset-4">
            {t('integrations.csv.settings.exports.path', { defaultValue: 'Billing → Accounting Exports' })}
          </Link>
          .
        </p>
      </section>

      {defaultConnection ? (
        <section id="xero-integration-mapping-card" className="space-y-4 border-t pt-6">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {t('integrations.xero.settings.mapping.title', { defaultValue: 'Mappings' })}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t('integrations.xero.settings.mapping.description', {
                defaultValue:
                  'Match your services, tax rates, and accounts to {{organisation}} so invoices land correctly in Xero.',
                organisation: defaultConnection.tenantName || defaultConnection.xeroTenantId
              })}
            </p>
          </div>
          <XeroLiveMappingManager defaultConnection={defaultConnection} />
        </section>
      ) : (
        <section id="xero-integration-mapping-placeholder-card" className="space-y-2 border-t pt-6">
          <h3 className="text-base font-semibold text-foreground">
            {t('integrations.xero.settings.mapping.title', { defaultValue: 'Mappings' })}
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t('integrations.xero.settings.mapping.placeholderDescription', {
              defaultValue:
                'Connect a Xero organisation to map your services, tax rates, and accounts.'
            })}
          </p>
        </section>
      )}
    </div>
  );
}
