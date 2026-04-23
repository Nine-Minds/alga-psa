'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { ExternalLink, Link2, RefreshCw } from 'lucide-react';
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
      return t('integrations.xero.settings.callback.oauthFailed', { defaultValue: 'The Xero OAuth callback failed. Try connecting again. If the problem persists, review your redirect URI and scopes.' });
    case 'invalid_state':
      return t('integrations.xero.settings.callback.invalidState', { defaultValue: 'The Xero OAuth state was invalid or expired. Start the connect flow again.' });
    case 'missing_params':
      return t('integrations.xero.settings.callback.missingParams', { defaultValue: 'The Xero callback was missing required parameters. Start the connect flow again.' });
    case 'access_denied':
      return t('integrations.xero.settings.callback.accessDenied', { defaultValue: 'Xero access was denied before the connection completed.' });
    default:
      return code ? t('integrations.xero.settings.callback.generic', { defaultValue: 'Xero returned an OAuth error: {{code}}', code }) : null;
  }
}

function statusBadgeVariant(status?: 'connected' | 'expired'): 'success' | 'secondary' | 'error' {
  if (status === 'expired') {
    return 'error';
  }
  if (status === 'connected') {
    return 'success';
  }
  return 'secondary';
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
      setSuccessMessage(t('integrations.xero.settings.credentialsSaved', { defaultValue: 'Xero credentials saved. You can now start the live Xero OAuth flow.' }));
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

  return (
    <div className="space-y-6" id="xero-integration-settings">
      {successMessage ? (
        <Alert variant="success">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card id="xero-integration-overview-card">
        <CardHeader>
          <CardTitle>{t('integrations.xero.settings.title', { defaultValue: 'Xero' })}</CardTitle>
          <CardDescription>
            {t('integrations.xero.settings.description', { defaultValue: 'Configure tenant-owned Xero OAuth credentials, connect your default organisation, and keep live Xero available beside the manual Xero CSV workflow.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('integrations.xero.settings.howItWorksTitle', { defaultValue: 'How live Xero works in this release' })}</p>
            <p className="mt-2">
              {t('integrations.xero.settings.howItWorksDescription', { defaultValue: 'Save a tenant-owned Xero client ID and client secret here, complete the Xero OAuth flow, and Alga PSA will use the first connected Xero organisation as the default live context.' })}
            </p>
          </div>

          <Alert variant="info" id="xero-integration-manual-alternative-alert">
            <AlertTitle>{t('integrations.xero.settings.csvAvailableTitle', { defaultValue: 'Xero CSV remains available' })}</AlertTitle>
            <AlertDescription>
              {t('integrations.xero.settings.csvAvailablePrefix', { defaultValue: 'If you prefer a manual workflow, keep using' })}{' '}
              <strong>{t('integrations.xero.settings.xeroCsv', { defaultValue: 'Xero CSV' })}</strong>{' '}
              {t('integrations.xero.settings.csvAvailableMiddle', { defaultValue: 'in this same Accounting section and manage exports from' })}{' '}
              <Link href="/msp/billing?tab=accounting-exports" className="font-medium underline underline-offset-4">
                {t('integrations.csv.settings.exports.path', { defaultValue: 'Billing → Accounting Exports' })}
              </Link>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card id="xero-integration-credentials-card">
        <CardHeader>
          <CardTitle>{t('integrations.xero.settings.tenantOauthTitle', { defaultValue: 'Tenant-Owned OAuth App' })}</CardTitle>
          <CardDescription>
            {t('integrations.xero.settings.tenantOauthDescription', { defaultValue: 'Paste the Xero app credentials registered for this tenant. Secret values are never returned to the browser after they are saved.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="text-sm text-muted-foreground">{t('integrations.xero.settings.loading', { defaultValue: 'Loading Xero settings…' })}</div>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('integrations.xero.settings.redirectUri', { defaultValue: 'Redirect URI' })}</p>
                  <p className="mt-1 break-all rounded-md bg-background px-3 py-2 font-mono text-xs">
                    {status?.redirectUri}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground">{t('integrations.xero.settings.requiredScopes', { defaultValue: 'Required Scopes' })}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {status?.scopes?.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="xero-client-id">{t('integrations.xero.settings.clientIdLabel', { defaultValue: 'Xero Client ID' })}</Label>
                  <Input
                    id="xero-client-id"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder={t('integrations.xero.settings.clientIdPlaceholder', { defaultValue: 'Paste your tenant-owned Xero client ID' })}
                  />
                  {status?.credentials.clientIdMasked ? (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.xero.settings.storedClientId', { defaultValue: 'Stored client ID: {{value}}', value: status.credentials.clientIdMasked })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.xero.settings.noClientId', { defaultValue: 'No client ID is stored for this tenant yet.' })}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="xero-client-secret">{t('integrations.xero.settings.clientSecretLabel', { defaultValue: 'Xero Client Secret' })}</Label>
                  <Input
                    id="xero-client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder={t('integrations.xero.settings.clientSecretPlaceholder', { defaultValue: 'Paste your tenant-owned Xero client secret' })}
                  />
                  {status?.credentials.clientSecretMasked ? (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.xero.settings.storedClientSecret', { defaultValue: 'Stored client secret: {{value}}', value: status.credentials.clientSecretMasked })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.xero.settings.noClientSecret', { defaultValue: 'No client secret is stored for this tenant yet.' })}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status?.credentials.ready ? 'default' : 'secondary'}>
                  {status?.credentials.ready
                    ? t('integrations.xero.settings.badges.credentialsReady', { defaultValue: 'Credentials Ready' })
                    : t('integrations.xero.settings.badges.credentialsRequired', { defaultValue: 'Credentials Required' })}
                </Badge>
                {defaultConnection ? (
                  <Badge variant={statusBadgeVariant(defaultConnection.status)}>
                    {defaultConnection.status === 'expired'
                      ? t('integrations.xero.settings.badges.connectionExpired', { defaultValue: 'Connection Expired' })
                      : t('integrations.xero.settings.badges.defaultConnected', { defaultValue: 'Default Organisation Connected' })}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t('integrations.xero.settings.badges.noOrganisation', { defaultValue: 'No Organisation Connected' })}</Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
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

                <Button
                  id="xero-settings-save"
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!readyToSave || saving}
                >
                  {saving
                    ? t('integrations.xero.settings.actions.saving', { defaultValue: 'Saving…' })
                    : t('integrations.xero.settings.actions.saveCredentials', { defaultValue: 'Save Xero Credentials' })}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="xero-integration-connection-card">
        <CardHeader>
          <CardTitle>{t('integrations.xero.settings.connection.title', { defaultValue: 'Live Xero Connection' })}</CardTitle>
          <CardDescription>
            {t('integrations.xero.settings.connection.description', { defaultValue: 'Start OAuth only after the tenant-owned Xero app is configured. Disconnecting removes stored Xero access tokens but keeps the tenant-owned app credentials in place.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {defaultConnection ? (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t('integrations.xero.settings.connection.defaultOrganisation', { defaultValue: 'Default organisation' })}</span>
                <Badge variant={statusBadgeVariant(defaultConnection.status)}>
                  {defaultConnection.status ?? t('integrations.xero.settings.connection.unknown', { defaultValue: 'unknown' })}
                </Badge>
              </div>
              <p className="mt-3 text-muted-foreground">
                {defaultConnection.tenantName || defaultConnection.xeroTenantId}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                <span>{t('integrations.xero.settings.connection.connectionId', { defaultValue: 'Connection ID: {{id}}', id: defaultConnection.connectionId })}</span>
              </div>
            </div>
          ) : (
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.xero.settings.connection.notConnected', { defaultValue: 'No live Xero organisation is connected yet. Save credentials, then click Connect Xero.' })}
              </AlertDescription>
            </Alert>
          )}

          {status?.error && defaultConnection ? (
            <Alert variant={status.connected ? 'info' : 'destructive'}>
              <AlertDescription>{status.error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
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

          <div className="flex flex-wrap items-center gap-2">
            <Button
              id="xero-disconnect-button"
              type="button"
              variant="destructive"
              disabled={!defaultConnection || disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting
                ? t('integrations.xero.settings.actions.disconnecting', { defaultValue: 'Disconnecting…' })
                : t('integrations.xero.settings.actions.disconnect', { defaultValue: 'Disconnect Xero' })}
            </Button>

            <Button id="xero-open-accounting-exports" asChild variant="outline">
              <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
                {t('integrations.csv.settings.exports.openButton', { defaultValue: 'Open Accounting Exports' })}
                <ExternalLink className="h-4 w-4 opacity-80" />
              </Link>
            </Button>
          </div>
        </CardFooter>
      </Card>

      {defaultConnection ? (
        <Card id="xero-integration-mapping-card">
          <CardHeader>
            <CardTitle>{t('integrations.xero.settings.mapping.title', { defaultValue: 'Live Xero Mapping & Configuration' })}</CardTitle>
            <CardDescription>
              {t('integrations.xero.settings.mapping.descriptionPrefix', { defaultValue: 'Configure live Xero mappings for the default connected organisation. These mappings are scoped to' })}{' '}
              <strong>{defaultConnection.tenantName || defaultConnection.xeroTenantId}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.xero.settings.mapping.alert', { defaultValue: 'Xero items, revenue accounts, tax rates, and tracking categories are loaded from the default connected organisation so live exports can keep using the first stored Xero connection in v1.' })}
              </AlertDescription>
            </Alert>
            <XeroLiveMappingManager defaultConnection={defaultConnection} />
          </CardContent>
        </Card>
      ) : (
        <Card id="xero-integration-mapping-placeholder-card">
          <CardHeader>
            <CardTitle>{t('integrations.xero.settings.mapping.title', { defaultValue: 'Live Xero Mapping & Configuration' })}</CardTitle>
            <CardDescription>
              {t('integrations.xero.settings.mapping.placeholderDescription', { defaultValue: 'Connect a live Xero organisation before configuring live Xero item and tax mappings.' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.xero.settings.mapping.placeholderAlert', { defaultValue: 'The mapping manager becomes available after the first Xero organisation is connected and set as the default live Xero context.' })}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
