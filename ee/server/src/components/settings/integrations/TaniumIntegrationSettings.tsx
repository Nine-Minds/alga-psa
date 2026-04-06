'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import {
  disconnectTaniumIntegration,
  getTaniumOrganizationMappings,
  getTaniumSettings,
  saveTaniumConfiguration,
  syncTaniumScopes,
  testTaniumConnection,
  triggerTaniumFullSync,
  updateTaniumOrganizationMapping,
} from '../../../lib/actions/integrations/taniumActions';

type MappingRow = {
  mapping_id: string;
  external_organization_id: string;
  external_organization_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  auto_sync_assets: boolean;
};

type ClientRow = {
  client_id: string;
  company_name: string;
};

export default function TaniumIntegrationSettings() {
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [assetApiUrl, setAssetApiUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [useAssetFallback, setUseAssetFallback] = useState(false);

  const [isActive, setIsActive] = useState(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('pending');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [hasApiToken, setHasApiToken] = useState(false);

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isScopeSyncing, startScopeSyncing] = useTransition();
  const [isDeviceSyncing, startDeviceSyncing] = useTransition();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [settingsResult, mappingResult] = await Promise.all([
        getTaniumSettings(),
        getTaniumOrganizationMappings(),
      ]);

      if (!settingsResult.success) {
        setError(settingsResult.error || 'Failed to load Tanium settings.');
      } else {
        const config = settingsResult.config;
        setGatewayUrl(config?.gatewayUrl || '');
        setAssetApiUrl(config?.assetApiUrl || '');
        setUseAssetFallback(Boolean(config?.useAssetApiFallback));
        setIsActive(Boolean(config?.isActive));
        setConnectedAt(config?.connectedAt || null);
        setSyncStatus(config?.syncStatus || 'pending');
        setSyncError(config?.syncError || null);
        setHasApiToken(Boolean(settingsResult.credentials?.hasApiToken));
      }

      if (!mappingResult.success) {
        setError((prev) => prev || mappingResult.error || 'Failed to load Tanium mappings.');
      } else {
        setMappings((mappingResult.mappings || []) as MappingRow[]);
        setClients((mappingResult.clients || []) as ClientRow[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Tanium integration state.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statusBadge = useMemo(() => {
    if (isActive) return <Badge variant="default">Connected</Badge>;
    return <Badge variant="outline">Disconnected</Badge>;
  }, [isActive]);

  const handleSave = () => {
    startSaving(async () => {
      setError(null);
      setSuccess(null);
      const result = await saveTaniumConfiguration({
        gatewayUrl,
        apiToken: apiToken.trim() || undefined,
        assetApiUrl: assetApiUrl.trim() || undefined,
        useAssetApiFallback: useAssetFallback,
      });

      if (result.success) {
        setApiToken('');
        setSuccess('Tanium configuration saved.');
        await refresh();
      } else {
        setError(result.error || 'Failed to save Tanium configuration.');
      }
    });
  };

  const handleTest = () => {
    startTesting(async () => {
      setError(null);
      setSuccess(null);
      const result = await testTaniumConnection();
      if (result.success) {
        setSuccess('Tanium connection test succeeded.');
      } else {
        setError(result.error || 'Tanium connection test failed.');
      }
      await refresh();
    });
  };

  const handleDisconnect = () => {
    startDisconnecting(async () => {
      setError(null);
      setSuccess(null);
      const result = await disconnectTaniumIntegration();
      if (result.success) {
        setSuccess('Tanium integration disconnected.');
      } else {
        setError(result.error || 'Failed to disconnect Tanium integration.');
      }
      await refresh();
    });
  };

  const handleScopeSync = () => {
    startScopeSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await syncTaniumScopes();
      if (result.success) {
        setSuccess(
          `Scope discovery completed. Processed: ${result.items_processed}, Created: ${result.items_created}, Updated: ${result.items_updated}`
        );
      } else {
        setError(result.error || 'Scope discovery failed.');
      }
      await refresh();
    });
  };

  const handleDeviceSync = () => {
    startDeviceSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await triggerTaniumFullSync();
      if ('items_processed' in result) {
        setSuccess(
          `Inventory sync completed. Processed: ${result.items_processed}, Created: ${result.items_created}, Updated: ${result.items_updated}`
        );
      } else {
        const message = (result as any).error || 'Inventory sync failed.';
        setError(message);
      }
      await refresh();
    });
  };

  const handleMappingClientChange = (mappingId: string, clientId: string) => {
    void (async () => {
      const result = await updateTaniumOrganizationMapping({
        mappingId,
        clientId: clientId || null,
      });
      if (!result.success) {
        setError(result.error || 'Failed to update mapping.');
        return;
      }
      await refresh();
    })();
  };

  return (
    <div className="space-y-6" id="tanium-integration-settings">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tanium Connection</CardTitle>
          <CardDescription>
            Configure Tanium Gateway credentials and verify tenant-scoped access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Status: {statusBadge}
            </div>
            <div className="text-sm text-muted-foreground">
              Sync: {syncStatus}{syncError ? ` (${syncError})` : ''}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Gateway URL</label>
              <Input
                id="tanium-gateway-url"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder="https://example.cloud.tanium.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Asset API URL (optional)</label>
              <Input
                id="tanium-asset-api-url"
                value={assetApiUrl}
                onChange={(e) => setAssetApiUrl(e.target.value)}
                placeholder="https://example.cloud.tanium.com/plugin/products/asset"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              API Token {hasApiToken ? '(saved)' : '(required)'}
            </label>
            <Input
              id="tanium-api-token"
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={hasApiToken ? 'Leave blank to keep existing token' : 'Paste Tanium API token'}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              id="tanium-asset-fallback-enabled"
              type="checkbox"
              checked={useAssetFallback}
              onChange={(e) => setUseAssetFallback(e.target.checked)}
            />
            Enable Asset API fallback for aged-out endpoint coverage
          </label>

          <div className="flex flex-wrap gap-2">
            <Button id="tanium-save-config" onClick={handleSave} disabled={isSaving || isLoading}>
              Save Configuration
            </Button>
            <Button id="tanium-test-connection" variant="outline" onClick={handleTest} disabled={isTesting || isLoading}>
              Test Connection
            </Button>
            <Button id="tanium-disconnect" variant="outline" onClick={handleDisconnect} disabled={isDisconnecting || isLoading}>
              Disconnect
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Connected at: {connectedAt ? new Date(connectedAt).toLocaleString() : 'Never'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tanium Sync</CardTitle>
          <CardDescription>
            Discover scopes from Tanium computer groups, map them to clients, then run inventory sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button id="tanium-sync-scopes" onClick={handleScopeSync} disabled={isScopeSyncing || isLoading}>
              Discover Scopes
            </Button>
            <Button id="tanium-sync-devices" onClick={handleDeviceSync} disabled={isDeviceSyncing || isLoading}>
              Run Inventory Sync
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">External Scope</th>
                  <th className="px-3 py-2 text-left">Mapped Client</th>
                  <th className="px-3 py-2 text-left">Auto Sync</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.mapping_id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{mapping.external_organization_name || mapping.external_organization_id}</div>
                      <div className="text-xs text-muted-foreground">ID: {mapping.external_organization_id}</div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="h-9 w-full rounded-md border px-2"
                        value={mapping.client_id || ''}
                        onChange={(e) => handleMappingClientChange(mapping.mapping_id, e.target.value)}
                      >
                        <option value="">Unmapped</option>
                        {clients.map((client) => (
                          <option key={client.client_id} value={client.client_id}>
                            {client.company_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {mapping.auto_sync_assets ? <Badge variant="default">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}
                    </td>
                  </tr>
                ))}
                {!mappings.length ? (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                      {isLoading ? 'Loading mappings...' : 'No Tanium scopes discovered yet.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
