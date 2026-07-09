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
  disconnectQbo,
  getQboConnectionStatus,
  saveQboCredentials
} from '../../../actions/qboActions';
import { QboLiveMappingManager } from '../../qbo/QboLiveMappingManager';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type QboStatus = Awaited<ReturnType<typeof getQboConnectionStatus>>;
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

interface QboIntegrationSettingsProps {
  syncHealthSlot?: React.ReactNode;
  onboardingSlot?: React.ReactNode;
}

function describeCallbackError(code: string | null, t: TranslateFn): string | null {
  switch (code) {
    case 'config_missing':
      return t('integrations.qbo.settings.callback.configMissing', { defaultValue: 'QuickBooks OAuth could not start because the client ID and client secret were not fully configured.' });
    case 'token_exchange_failed':
      return t('integrations.qbo.settings.callback.tokenExchangeFailed', { defaultValue: 'Intuit did not return the expected tokens. Try connecting again.' });
    case 'oauth_failed':
      return t('integrations.qbo.settings.callback.oauthFailed', { defaultValue: 'The QuickBooks OAuth callback failed. Try connecting again. If the problem persists, review your redirect URI and scopes.' });
    case 'invalid_state':
      return t('integrations.qbo.settings.callback.invalidState', { defaultValue: 'The QuickBooks OAuth state was invalid or expired. Start the connect flow again.' });
    case 'missing_params':
      return t('integrations.qbo.settings.callback.missingParams', { defaultValue: 'The QuickBooks callback was missing required parameters. Start the connect flow again.' });
    case 'access_denied':
      return t('integrations.qbo.settings.callback.accessDenied', { defaultValue: 'QuickBooks access was denied before the connection completed.' });
    default:
      return code ? t('integrations.qbo.settings.callback.generic', { defaultValue: 'QuickBooks returned an OAuth error: {{code}}', code }) : null;
  }
}

function statusBadgeVariant(status?: 'active' | 'expired' | 'error'): 'success' | 'secondary' | 'error' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'expired' || status === 'error') {
    return 'error';
  }
  return 'secondary';
}

export default function QboIntegrationSettings({ syncHealthSlot, onboardingSlot }: QboIntegrationSettingsProps = {}) {
  const { t } = useTranslation('msp/integrations');
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState<QboStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');

  const oauthStatus = searchParams?.get('qbo_status');
  const oauthError = React.useMemo(
    () => describeCallbackError(searchParams?.get('qbo_error') ?? null, t),
    [searchParams, t]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getQboConnectionStatus();
      setStatus(result);
    } catch (err) {
      setError(t('integrations.qbo.settings.errors.load', { defaultValue: 'Failed to load QuickBooks settings.' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (oauthStatus === 'success') {
      setSuccessMessage(t('integrations.qbo.settings.connectSuccess', { defaultValue: 'QuickBooks connected successfully. The connected company is now the default live QuickBooks context.' }));
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
      const result = await saveQboCredentials({
        clientId,
        clientSecret
      });

      if (!result.success) {
        setError(t('integrations.qbo.settings.errors.saveCredentials', { defaultValue: 'Failed to save QuickBooks credentials.' }));
        return;
      }

      setClientId('');
      setClientSecret('');
      setSuccessMessage(t('integrations.qbo.settings.credentialsSaved', { defaultValue: 'QuickBooks credentials saved. You can now start the QuickBooks OAuth flow.' }));
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
      const result = await disconnectQbo();
      if (!result.success) {
        setError(t('integrations.qbo.settings.errors.disconnect', { defaultValue: 'Failed to disconnect QuickBooks.' }));
        return;
      }

      setSuccessMessage(t('integrations.qbo.settings.disconnectSuccess', { defaultValue: 'The stored QuickBooks connection was removed. Tenant-owned QuickBooks app credentials were preserved.' }));
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const readyToSave = clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const canConnect = Boolean(status?.credentials.ready);
  const defaultConnection = status?.defaultConnection;

  return (
    <div className="space-y-6" id="qbo-integration-settings">
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

      <Card id="qbo-integration-overview-card">
        <CardHeader>
          <CardTitle>{t('integrations.qbo.settings.title', { defaultValue: 'QuickBooks Online' })}</CardTitle>
          <CardDescription>
            {t('integrations.qbo.settings.description', { defaultValue: 'Configure QuickBooks OAuth credentials, connect your QuickBooks company, and keep live QuickBooks available beside the manual QuickBooks CSV workflow.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('integrations.qbo.settings.howItWorksTitle', { defaultValue: 'How live QuickBooks works in this release' })}</p>
            <p className="mt-2">
              {t('integrations.qbo.settings.howItWorksDescription', { defaultValue: 'Save QuickBooks app credentials here, complete the Intuit OAuth flow, and Alga PSA will use the connected QuickBooks company as the default live context for exports and mappings.' })}
            </p>
          </div>

          <Alert variant="info" id="qbo-integration-manual-alternative-alert">
            <AlertTitle>{t('integrations.qbo.settings.csvAvailableTitle', { defaultValue: 'QuickBooks CSV remains available' })}</AlertTitle>
            <AlertDescription>
              {t('integrations.qbo.settings.csvAvailablePrefix', { defaultValue: 'If you prefer a manual workflow, keep using' })}{' '}
              <strong>{t('integrations.qbo.settings.quickbooksCsv', { defaultValue: 'QuickBooks CSV' })}</strong>{' '}
              {t('integrations.qbo.settings.csvAvailableMiddle', { defaultValue: 'in this same Accounting section and manage exports from' })}{' '}
              <Link href="/msp/billing?tab=accounting-exports" className="font-medium underline underline-offset-4">
                {t('integrations.csv.settings.exports.path', { defaultValue: 'Billing → Accounting Exports' })}
              </Link>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card id="qbo-integration-credentials-card">
        <CardHeader>
          <CardTitle>{t('integrations.qbo.settings.tenantOauthTitle', { defaultValue: 'Tenant-Owned OAuth App' })}</CardTitle>
          <CardDescription>
            {t('integrations.qbo.settings.tenantOauthDescription', { defaultValue: 'Paste the Intuit app credentials registered for this tenant, or leave blank to use the application-level QuickBooks app if one is configured. Secret values are never returned to the browser after they are saved.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="text-sm text-muted-foreground">{t('integrations.qbo.settings.loading', { defaultValue: 'Loading QuickBooks settings…' })}</div>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('integrations.qbo.settings.redirectUri', { defaultValue: 'Redirect URI' })}</p>
                  <p className="mt-1 break-all rounded-md bg-background px-3 py-2 font-mono text-xs">
                    {status?.redirectUri}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground">{t('integrations.qbo.settings.requiredScopes', { defaultValue: 'Required Scopes' })}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {status?.scopes?.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground">{t('integrations.qbo.settings.environment', { defaultValue: 'Intuit Environment' })}</p>
                  <div className="mt-2">
                    <Badge variant={status?.environment === 'production' ? 'default' : 'secondary'}>
                      {status?.environment === 'production'
                        ? t('integrations.qbo.settings.environmentProduction', { defaultValue: 'Production' })
                        : t('integrations.qbo.settings.environmentSandbox', { defaultValue: 'Sandbox' })}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="qbo-client-id">{t('integrations.qbo.settings.clientIdLabel', { defaultValue: 'QuickBooks Client ID' })}</Label>
                  <Input
                    id="qbo-client-id"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder={t('integrations.qbo.settings.clientIdPlaceholder', { defaultValue: 'Paste your Intuit app client ID' })}
                  />
                  {status?.credentials.clientIdMasked ? (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.qbo.settings.storedClientId', { defaultValue: 'Stored client ID: {{value}}', value: status.credentials.clientIdMasked })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.qbo.settings.noClientId', { defaultValue: 'No client ID is stored for this tenant yet.' })}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="qbo-client-secret">{t('integrations.qbo.settings.clientSecretLabel', { defaultValue: 'QuickBooks Client Secret' })}</Label>
                  <Input
                    id="qbo-client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder={t('integrations.qbo.settings.clientSecretPlaceholder', { defaultValue: 'Paste your Intuit app client secret' })}
                  />
                  {status?.credentials.clientSecretMasked ? (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.qbo.settings.storedClientSecret', { defaultValue: 'Stored client secret: {{value}}', value: status.credentials.clientSecretMasked })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.qbo.settings.noClientSecret', { defaultValue: 'No client secret is stored for this tenant yet.' })}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status?.credentials.ready ? 'default' : 'secondary'}>
                  {status?.credentials.ready
                    ? t('integrations.qbo.settings.badges.credentialsReady', { defaultValue: 'Credentials Ready' })
                    : t('integrations.qbo.settings.badges.credentialsRequired', { defaultValue: 'Credentials Required' })}
                </Badge>
                {defaultConnection ? (
                  <Badge variant={statusBadgeVariant(defaultConnection.status)}>
                    {defaultConnection.status === 'active'
                      ? t('integrations.qbo.settings.badges.defaultConnected', { defaultValue: 'Company Connected' })
                      : t('integrations.qbo.settings.badges.connectionExpired', { defaultValue: 'Connection Needs Attention' })}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t('integrations.qbo.settings.badges.noCompany', { defaultValue: 'No Company Connected' })}</Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  id="qbo-settings-refresh"
                  type="button"
                  variant="outline"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('integrations.qbo.settings.actions.refresh', { defaultValue: 'Refresh' })}
                </Button>

                <Button
                  id="qbo-settings-save"
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!readyToSave || saving}
                >
                  {saving
                    ? t('integrations.qbo.settings.actions.saving', { defaultValue: 'Saving…' })
                    : t('integrations.qbo.settings.actions.saveCredentials', { defaultValue: 'Save QuickBooks Credentials' })}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="qbo-integration-connection-card">
        <CardHeader>
          <CardTitle>{t('integrations.qbo.settings.connection.title', { defaultValue: 'Live QuickBooks Connection' })}</CardTitle>
          <CardDescription>
            {t('integrations.qbo.settings.connection.description', { defaultValue: 'Start OAuth only after QuickBooks app credentials are configured. Disconnecting removes stored QuickBooks access tokens but keeps the tenant-owned app credentials in place.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {defaultConnection ? (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t('integrations.qbo.settings.connection.defaultCompany', { defaultValue: 'Connected company' })}</span>
                <Badge variant={statusBadgeVariant(defaultConnection.status)}>
                  {defaultConnection.status ?? t('integrations.qbo.settings.connection.unknown', { defaultValue: 'unknown' })}
                </Badge>
              </div>
              <p className="mt-3 text-muted-foreground">
                {defaultConnection.displayName || defaultConnection.realmId}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                <span>{t('integrations.qbo.settings.connection.realmId', { defaultValue: 'Realm ID: {{id}}', id: defaultConnection.realmId })}</span>
              </div>
            </div>
          ) : (
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.qbo.settings.connection.notConnected', { defaultValue: 'No QuickBooks company is connected yet. Save credentials, then click Connect QuickBooks.' })}
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
            id="qbo-connect-button"
            type="button"
            disabled={!canConnect}
            onClick={() => window.location.assign('/api/integrations/qbo/connect')}
          >
            {defaultConnection
              ? t('integrations.qbo.settings.actions.reconnect', { defaultValue: 'Reconnect QuickBooks' })
              : t('integrations.qbo.settings.actions.connect', { defaultValue: 'Connect QuickBooks' })}
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              id="qbo-disconnect-button"
              type="button"
              variant="destructive"
              disabled={!defaultConnection || disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting
                ? t('integrations.qbo.settings.actions.disconnecting', { defaultValue: 'Disconnecting…' })
                : t('integrations.qbo.settings.actions.disconnect', { defaultValue: 'Disconnect QuickBooks' })}
            </Button>

            <Button id="qbo-open-accounting-exports" asChild variant="outline">
              <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
                {t('integrations.csv.settings.exports.openButton', { defaultValue: 'Open Accounting Exports' })}
                <ExternalLink className="h-4 w-4 opacity-80" />
              </Link>
            </Button>
          </div>
        </CardFooter>
      </Card>

      {defaultConnection ? syncHealthSlot : null}

      {defaultConnection ? onboardingSlot : null}

      {defaultConnection ? (
        <Card id="qbo-integration-mapping-card">
          <CardHeader>
            <CardTitle>{t('integrations.qbo.settings.mapping.title', { defaultValue: 'Live QuickBooks Mapping & Configuration' })}</CardTitle>
            <CardDescription>
              {t('integrations.qbo.settings.mapping.descriptionPrefix', { defaultValue: 'Configure live QuickBooks mappings for the connected company. These mappings are scoped to' })}{' '}
              <strong>{defaultConnection.displayName || defaultConnection.realmId}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.qbo.settings.mapping.alert', { defaultValue: 'QuickBooks items, tax codes, and terms are loaded from the connected company so live exports can keep using the first stored QuickBooks connection in v1.' })}
              </AlertDescription>
            </Alert>
            <QboLiveMappingManager defaultConnection={defaultConnection} />
          </CardContent>
        </Card>
      ) : (
        <Card id="qbo-integration-mapping-placeholder-card">
          <CardHeader>
            <CardTitle>{t('integrations.qbo.settings.mapping.title', { defaultValue: 'Live QuickBooks Mapping & Configuration' })}</CardTitle>
            <CardDescription>
              {t('integrations.qbo.settings.mapping.placeholderDescription', { defaultValue: 'Connect a QuickBooks company before configuring live QuickBooks item and tax mappings.' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.qbo.settings.mapping.placeholderAlert', { defaultValue: 'The mapping manager becomes available after the first QuickBooks company is connected and set as the default live QuickBooks context.' })}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
