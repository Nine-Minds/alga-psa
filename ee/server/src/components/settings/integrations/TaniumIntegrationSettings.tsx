'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
  client_name: string;
};

export default function TaniumIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
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
        setError(settingsResult.error || t('integrations.rmm.tanium.errors.loadSettings'));
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
        setError((prev) => prev || mappingResult.error || t('integrations.rmm.tanium.errors.loadMappings'));
      } else {
        setMappings((mappingResult.mappings || []) as MappingRow[]);
        setClients((mappingResult.clients || []) as ClientRow[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('integrations.rmm.tanium.errors.loadState'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statusBadge = useMemo(() => {
    if (isActive) return <Badge variant="default">{t('integrations.rmm.tanium.status.connected')}</Badge>;
    return <Badge variant="outline">{t('integrations.rmm.tanium.status.disconnected')}</Badge>;
  }, [isActive, t]);

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
        setSuccess(t('integrations.rmm.tanium.success.configurationSaved'));
        await refresh();
      } else {
        setError(result.error || t('integrations.rmm.tanium.errors.saveConfiguration'));
      }
    });
  };

  const handleTest = () => {
    startTesting(async () => {
      setError(null);
      setSuccess(null);
      const result = await testTaniumConnection();
      if (result.success) {
        setSuccess(t('integrations.rmm.tanium.success.connectionTestSucceeded'));
      } else {
        setError(result.error || t('integrations.rmm.tanium.errors.testConnectionFailed'));
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
        setSuccess(t('integrations.rmm.tanium.success.disconnected'));
      } else {
        setError(result.error || t('integrations.rmm.tanium.errors.disconnectFailed'));
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
          t('integrations.rmm.tanium.success.scopeDiscoveryCompleted', {
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          })
        );
      } else {
        setError(result.error || t('integrations.rmm.tanium.errors.scopeDiscoveryFailed'));
      }
      await refresh();
    });
  };

  const handleDeviceSync = () => {
    startDeviceSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await triggerTaniumFullSync();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.tanium.success.inventorySyncCompleted', {
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          })
        );
      } else {
        const message = (result as any).error || t('integrations.rmm.tanium.errors.inventorySyncFailed');
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
        setError(result.error || t('integrations.rmm.tanium.errors.updateMappingFailed'));
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
          <CardTitle>{t('integrations.rmm.tanium.connection.title')}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.tanium.connection.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t('integrations.rmm.tanium.status.label')}{statusBadge}
            </div>
            <div className="text-sm text-muted-foreground">
              {syncError
                ? t('integrations.rmm.tanium.connection.syncLabelWithError', { status: syncStatus, error: syncError })
                : t('integrations.rmm.tanium.connection.syncLabel', { status: syncStatus })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('integrations.rmm.tanium.fields.gatewayUrl')}</label>
              <Input
                id="tanium-gateway-url"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder={t('integrations.rmm.tanium.fields.gatewayUrlPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('integrations.rmm.tanium.fields.assetApiUrl')}</label>
              <Input
                id="tanium-asset-api-url"
                value={assetApiUrl}
                onChange={(e) => setAssetApiUrl(e.target.value)}
                placeholder={t('integrations.rmm.tanium.fields.assetApiUrlPlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('integrations.rmm.tanium.fields.apiToken', {
                state: hasApiToken
                  ? t('integrations.rmm.tanium.fields.apiTokenStateSaved')
                  : t('integrations.rmm.tanium.fields.apiTokenStateRequired'),
              })}
            </label>
            <Input
              id="tanium-api-token"
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={hasApiToken
                ? t('integrations.rmm.tanium.fields.apiTokenPlaceholderExisting')
                : t('integrations.rmm.tanium.fields.apiTokenPlaceholderNew')}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              id="tanium-asset-fallback-enabled"
              type="checkbox"
              checked={useAssetFallback}
              onChange={(e) => setUseAssetFallback(e.target.checked)}
            />
            {t('integrations.rmm.tanium.fields.assetFallbackLabel')}
          </label>

          <div className="flex flex-wrap gap-2">
            <Button id="tanium-save-config" onClick={handleSave} disabled={isSaving || isLoading}>
              {t('integrations.rmm.tanium.actions.saveConfiguration')}
            </Button>
            <Button id="tanium-test-connection" variant="outline" onClick={handleTest} disabled={isTesting || isLoading}>
              {t('integrations.rmm.tanium.actions.testConnection')}
            </Button>
            <Button id="tanium-disconnect" variant="outline" onClick={handleDisconnect} disabled={isDisconnecting || isLoading}>
              {t('integrations.rmm.tanium.actions.disconnect')}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {t('integrations.rmm.tanium.connection.connectedAt', {
              time: connectedAt ? new Date(connectedAt).toLocaleString() : t('integrations.rmm.tanium.connection.never'),
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.tanium.sync.title')}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.tanium.sync.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button id="tanium-sync-scopes" onClick={handleScopeSync} disabled={isScopeSyncing || isLoading}>
              {t('integrations.rmm.tanium.actions.discoverScopes')}
            </Button>
            <Button id="tanium-sync-devices" onClick={handleDeviceSync} disabled={isDeviceSyncing || isLoading}>
              {t('integrations.rmm.tanium.actions.runInventorySync')}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.tanium.mappings.externalScope')}</th>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.tanium.mappings.mappedClient')}</th>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.tanium.mappings.autoSync')}</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.mapping_id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{mapping.external_organization_name || mapping.external_organization_id}</div>
                      <div className="text-xs text-muted-foreground">{t('integrations.rmm.tanium.mappings.scopeIdLabel', { id: mapping.external_organization_id })}</div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="h-9 w-full rounded-md border px-2"
                        value={mapping.client_id || ''}
                        onChange={(e) => handleMappingClientChange(mapping.mapping_id, e.target.value)}
                      >
                        <option value="">{t('integrations.rmm.tanium.mappings.unmapped')}</option>
                        {clients.map((client) => (
                          <option key={client.client_id} value={client.client_id}>
                            {client.client_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {mapping.auto_sync_assets
                        ? <Badge variant="default">{t('integrations.rmm.tanium.mappings.autoSyncEnabled')}</Badge>
                        : <Badge variant="outline">{t('integrations.rmm.tanium.mappings.autoSyncDisabled')}</Badge>}
                    </td>
                  </tr>
                ))}
                {!mappings.length ? (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                      {isLoading
                        ? t('integrations.rmm.tanium.mappings.loading')
                        : t('integrations.rmm.tanium.mappings.noScopes')}
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
