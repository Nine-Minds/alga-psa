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

type XeroStatus = Awaited<ReturnType<typeof getXeroConnectionStatus>>;

function describeCallbackError(code: string | null): string | null {
  switch (code) {
    case 'config_missing':
      return 'Xero OAuth could not start because the tenant client ID and client secret were not fully configured.';
    case 'no_connections':
      return 'Xero did not return any organisations for this login. Check your Xero app and organisation access, then try again.';
    case 'connections_unmapped':
      return 'Xero returned organisations, but none included the identifiers required to save a connection.';
    case 'oauth_failed':
      return 'The Xero OAuth callback failed. Try connecting again. If the problem persists, review your redirect URI and scopes.';
    case 'invalid_state':
      return 'The Xero OAuth state was invalid or expired. Start the connect flow again.';
    case 'missing_params':
      return 'The Xero callback was missing required parameters. Start the connect flow again.';
    case 'access_denied':
      return 'Xero access was denied before the connection completed.';
    default:
      return code ? `Xero returned an OAuth error: ${code}` : null;
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
    () => describeCallbackError(searchParams?.get('xero_error') ?? null),
    [searchParams]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getXeroConnectionStatus();
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Xero settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (oauthStatus === 'success') {
      setSuccessMessage('Xero connected successfully. The first connected organisation is now the default live Xero context.');
      void load();
      return;
    }

    if (oauthStatus === 'failure' && oauthError) {
      setError(oauthError);
    }
  }, [load, oauthError, oauthStatus]);

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
        setError(result.error || 'Failed to save Xero credentials.');
        return;
      }

      setClientId('');
      setClientSecret('');
      setSuccessMessage('Xero credentials saved. You can now start the live Xero OAuth flow.');
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
        setError(result.error || 'Failed to disconnect Xero.');
        return;
      }

      setSuccessMessage('The stored Xero connection was removed. Tenant-owned Xero app credentials were preserved.');
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
          <CardTitle>Xero</CardTitle>
          <CardDescription>
            Configure tenant-owned Xero OAuth credentials, connect your default organisation, and keep live Xero available beside the manual Xero CSV workflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How live Xero works in this release</p>
            <p className="mt-2">
              Save a tenant-owned Xero client ID and client secret here, complete the Xero OAuth flow,
              and Alga PSA will use the first connected Xero organisation as the default live context.
            </p>
          </div>

          <Alert variant="info" id="xero-integration-manual-alternative-alert">
            <AlertTitle>Xero CSV remains available</AlertTitle>
            <AlertDescription>
              If you prefer a manual workflow, keep using{' '}
              <strong>Xero CSV</strong> in this same Accounting section and manage exports from{' '}
              <Link href="/msp/billing?tab=accounting-exports" className="font-medium underline underline-offset-4">
                Billing → Accounting Exports
              </Link>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card id="xero-integration-credentials-card">
        <CardHeader>
          <CardTitle>Tenant-Owned OAuth App</CardTitle>
          <CardDescription>
            Paste the Xero app credentials registered for this tenant. Secret values are never returned to the browser after they are saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading Xero settings…</div>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Redirect URI</p>
                  <p className="mt-1 break-all rounded-md bg-background px-3 py-2 font-mono text-xs">
                    {status?.redirectUri}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground">Required Scopes</p>
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
                  <Label htmlFor="xero-client-id">Xero Client ID</Label>
                  <Input
                    id="xero-client-id"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="Paste your tenant-owned Xero client ID"
                  />
                  {status?.credentials.clientIdMasked ? (
                    <p className="text-xs text-muted-foreground">
                      Stored client ID: {status.credentials.clientIdMasked}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No client ID is stored for this tenant yet.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="xero-client-secret">Xero Client Secret</Label>
                  <Input
                    id="xero-client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder="Paste your tenant-owned Xero client secret"
                  />
                  {status?.credentials.clientSecretMasked ? (
                    <p className="text-xs text-muted-foreground">
                      Stored client secret: {status.credentials.clientSecretMasked}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No client secret is stored for this tenant yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status?.credentials.ready ? 'default' : 'secondary'}>
                  {status?.credentials.ready ? 'Credentials Ready' : 'Credentials Required'}
                </Badge>
                {defaultConnection ? (
                  <Badge variant={statusBadgeVariant(defaultConnection.status)}>
                    {defaultConnection.status === 'expired' ? 'Connection Expired' : 'Default Organisation Connected'}
                  </Badge>
                ) : (
                  <Badge variant="secondary">No Organisation Connected</Badge>
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
                  Refresh
                </Button>

                <Button
                  id="xero-settings-save"
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!readyToSave || saving}
                >
                  {saving ? 'Saving…' : 'Save Xero Credentials'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="xero-integration-connection-card">
        <CardHeader>
          <CardTitle>Live Xero Connection</CardTitle>
          <CardDescription>
            Start OAuth only after the tenant-owned Xero app is configured. Disconnecting removes stored Xero access tokens but keeps the tenant-owned app credentials in place.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {defaultConnection ? (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Default organisation</span>
                <Badge variant={statusBadgeVariant(defaultConnection.status)}>
                  {defaultConnection.status ?? 'unknown'}
                </Badge>
              </div>
              <p className="mt-3 text-muted-foreground">
                {defaultConnection.tenantName || defaultConnection.xeroTenantId}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                <span>Connection ID: {defaultConnection.connectionId}</span>
              </div>
            </div>
          ) : (
            <Alert variant="info">
              <AlertDescription>
                No live Xero organisation is connected yet. Save credentials, then click Connect Xero.
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
            {defaultConnection ? 'Reconnect Xero' : 'Connect Xero'}
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              id="xero-disconnect-button"
              type="button"
              variant="destructive"
              disabled={!defaultConnection || disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect Xero'}
            </Button>

            <Button id="xero-open-accounting-exports" asChild variant="outline">
              <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
                Open Accounting Exports
                <ExternalLink className="h-4 w-4 opacity-80" />
              </Link>
            </Button>
          </div>
        </CardFooter>
      </Card>

      {defaultConnection ? (
        <Card id="xero-integration-mapping-card">
          <CardHeader>
            <CardTitle>Live Xero Mapping &amp; Configuration</CardTitle>
            <CardDescription>
              Configure live Xero mappings for the default connected organisation. These mappings are scoped to{' '}
              <strong>{defaultConnection.tenantName || defaultConnection.xeroTenantId}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="info">
              <AlertDescription>
                Xero items, revenue accounts, tax rates, and tracking categories are loaded from the default connected organisation so live exports can keep using the first stored Xero connection in v1.
              </AlertDescription>
            </Alert>
            <XeroLiveMappingManager defaultConnection={defaultConnection} />
          </CardContent>
        </Card>
      ) : (
        <Card id="xero-integration-mapping-placeholder-card">
          <CardHeader>
            <CardTitle>Live Xero Mapping &amp; Configuration</CardTitle>
            <CardDescription>
              Connect a live Xero organisation before configuring live Xero item and tax mappings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="info">
              <AlertDescription>
                The mapping manager becomes available after the first Xero organisation is connected and set as the default live Xero context.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
