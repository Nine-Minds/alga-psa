'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  getMicrosoftIntegrationStatus,
  resetMicrosoftProvidersToDisconnected,
  saveMicrosoftIntegrationSettings,
} from '@alga-psa/integrations/actions';
import { useToast } from '@alga-psa/ui/hooks/use-toast';

export function MicrosoftIntegrationSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Awaited<ReturnType<typeof getMicrosoftIntegrationStatus>> | null>(null);

  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [tenantId, setTenantId] = React.useState('common');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getMicrosoftIntegrationStatus();
    setStatus(res);

    if (!res.success) {
      setError(res.error || 'Failed to load Microsoft settings');
    } else if (res.config) {
      setClientId(res.config.clientId || '');
      setTenantId(res.config.tenantId || 'common');
    }

    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const canSave = clientId.trim() && clientSecret.trim();

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const res = await saveMicrosoftIntegrationSettings({
        clientId,
        clientSecret,
        tenantId,
      });

      if (!res.success) {
        setError(res.error || 'Failed to save Microsoft settings');
        toast({ title: 'Unable to save Microsoft settings', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }

      setClientSecret('');
      toast({ title: 'Microsoft settings saved', description: 'Tenant Microsoft configuration updated successfully.' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleResetProviders = async () => {
    try {
      setResetting(true);
      setError(null);

      const res = await resetMicrosoftProvidersToDisconnected();
      if (!res.success) {
        setError(res.error || 'Failed to reset Microsoft providers');
        toast({ title: 'Reset failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }

      toast({
        title: 'Microsoft providers reset',
        description: 'All Microsoft providers are now disconnected and require re-authorization.',
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Microsoft</CardTitle>
        <CardDescription>
          Configure tenant-owned Microsoft OAuth credentials for Outlook inbound email, Outlook calendar, and MSP SSO.
          <Button
            id="microsoft-entra-console-link"
            type="button"
            variant="link"
            className="ml-2 p-0 h-auto"
            onClick={() => window.open('https://entra.microsoft.com/', '_blank')}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Microsoft Entra
          </Button>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
              <div className="text-sm font-medium">Redirect URIs (copy into Microsoft app registration)</div>
              <div className="text-sm font-mono break-all">{status?.redirectUris?.email}</div>
              <div className="text-sm font-mono break-all">{status?.redirectUris?.calendar}</div>
              <div className="text-sm font-mono break-all">{status?.redirectUris?.sso}</div>
              <div className="text-sm font-medium mt-2">Scopes</div>
              <div className="text-sm text-muted-foreground">
                Email: {(status?.scopes?.email || []).join(', ')}
              </div>
              <div className="text-sm text-muted-foreground">
                Calendar: {(status?.scopes?.calendar || []).join(', ')}
              </div>
              <div className="text-sm text-muted-foreground">
                SSO: {(status?.scopes?.sso || []).join(', ')}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="microsoft-client-id">Microsoft OAuth Client ID</Label>
                <Input
                  id="microsoft-client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="microsoft-client-secret">Microsoft OAuth Client Secret</Label>
                <Input
                  id="microsoft-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Enter client secret"
                />
                {status?.config?.clientSecretMasked && (
                  <p className="text-xs text-muted-foreground">Stored secret: {status.config.clientSecretMasked}</p>
                )}
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="microsoft-tenant-id">Microsoft Tenant ID</Label>
                <Input
                  id="microsoft-tenant-id"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="common"
                />
                <p className="text-xs text-muted-foreground">Use `common` for multi-tenant apps, or a specific Entra tenant ID.</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Button id="microsoft-settings-refresh" type="button" variant="outline" onClick={load} disabled={loading}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  id="microsoft-settings-reset-providers"
                  type="button"
                  variant="destructive"
                  onClick={handleResetProviders}
                  disabled={resetting}
                >
                  {resetting ? 'Resetting…' : 'Reset Microsoft Providers'}
                </Button>
                <Button id="microsoft-settings-save" type="button" onClick={handleSave} disabled={!canSave || saving}>
                  {saving ? 'Saving…' : 'Save Microsoft Settings'}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
