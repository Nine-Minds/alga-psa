'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  backfillLevelIoAlerts,
  disconnectLevelIoIntegration,
  getLevelIoConnectionSummary,
  getLevelIoSettings,
  getLevelIoWebhookInfo,
  listLevelIoOrganizationMappings,
  saveLevelIoConfiguration,
  syncLevelIoOrganizations,
  testLevelIoConnection,
  triggerLevelIoFullSync,
  updateLevelIoOrganizationMapping,
} from '../../../lib/actions/integrations/levelIoActions';

type MappingRow = {
  mapping_id: string;
  external_organization_id: string;
  external_organization_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  auto_sync_assets: boolean;
  metadata?: { path?: string } | null;
};

type ClientRow = {
  client_id: string;
  client_name: string;
};

type WebhookInfo = {
  url: string;
  headerName: string;
  secret: string;
  payloadTemplate: string;
};

export default function LevelIoIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  const [isActive, setIsActive] = useState(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('pending');
  const [syncError, setSyncError] = useState<string | null>(null);

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [summary, setSummary] = useState<{ mappedGroups: number; devices: number; activeAlerts: number } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isGroupSyncing, startGroupSyncing] = useTransition();
  const [isDeviceSyncing, startDeviceSyncing] = useTransition();
  const [isAlertSyncing, startAlertSyncing] = useTransition();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [settingsResult, mappingResult, webhookResult, summaryResult] = await Promise.all([
        getLevelIoSettings(),
        listLevelIoOrganizationMappings(),
        getLevelIoWebhookInfo(),
        getLevelIoConnectionSummary(),
      ]);

      if (!settingsResult.success) {
        setError(settingsResult.error || t('integrations.rmm.levelio.errors.loadSettings', { defaultValue: 'Failed to load Level settings' }));
      } else {
        const config = settingsResult.config;
        setIsActive(Boolean(config?.isActive));
        setConnectedAt(config?.connectedAt || null);
        setSyncStatus(config?.syncStatus || 'pending');
        setSyncError(config?.syncError || null);
        setHasApiKey(Boolean(settingsResult.credentials?.hasApiKey));
      }

      if (mappingResult.success) {
        setMappings((mappingResult.mappings || []) as MappingRow[]);
        setClients((mappingResult.clients || []) as ClientRow[]);
      }
      if (webhookResult.success && webhookResult.webhook) {
        setWebhook(webhookResult.webhook as WebhookInfo);
      }
      if (summaryResult.success && summaryResult.summary) {
        setSummary(summaryResult.summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('integrations.rmm.levelio.errors.loadState', { defaultValue: 'Failed to load Level integration state' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statusBadge = useMemo(() => {
    if (isActive) return <Badge variant="default">{t('integrations.rmm.levelio.status.connected', { defaultValue: 'Connected' })}</Badge>;
    return <Badge variant="outline">{t('integrations.rmm.levelio.status.disconnected', { defaultValue: 'Not connected' })}</Badge>;
  }, [isActive, t]);

  const handleSave = () => {
    startSaving(async () => {
      setError(null);
      setSuccess(null);
      const result = await saveLevelIoConfiguration({ apiKey: apiKey.trim() || undefined });
      if (result.success) {
        setApiKey('');
        setSuccess(t('integrations.rmm.levelio.success.configurationSaved', { defaultValue: 'Level configuration saved' }));
        await refresh();
      } else {
        setError(result.error || t('integrations.rmm.levelio.errors.saveConfiguration', { defaultValue: 'Failed to save Level configuration' }));
      }
    });
  };

  const handleTest = () => {
    startTesting(async () => {
      setError(null);
      setSuccess(null);
      const result = await testLevelIoConnection();
      if (result.success) {
        setSuccess(t('integrations.rmm.levelio.success.connectionTestSucceeded', { defaultValue: 'Connection to Level succeeded' }));
      } else {
        setError(result.error || t('integrations.rmm.levelio.errors.testConnectionFailed', { defaultValue: 'Connection test failed' }));
      }
      await refresh();
    });
  };

  const handleDisconnect = () => {
    startDisconnecting(async () => {
      setError(null);
      setSuccess(null);
      const result = await disconnectLevelIoIntegration();
      if (result.success) {
        setSuccess(t('integrations.rmm.levelio.success.disconnected', { defaultValue: 'Level integration disconnected' }));
      } else {
        setError(result.error || t('integrations.rmm.levelio.errors.disconnectFailed', { defaultValue: 'Failed to disconnect Level integration' }));
      }
      await refresh();
    });
  };

  const handleGroupSync = () => {
    startGroupSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await syncLevelIoOrganizations();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.levelio.success.groupSyncCompleted', {
            defaultValue: 'Group discovery completed: {{processed}} processed, {{created}} created, {{updated}} updated',
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          })
        );
      } else {
        setError((result as any).error || t('integrations.rmm.levelio.errors.groupSyncFailed', { defaultValue: 'Group discovery failed' }));
      }
      await refresh();
    });
  };

  const handleDeviceSync = () => {
    startDeviceSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await triggerLevelIoFullSync();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.levelio.success.deviceSyncCompleted', {
            defaultValue: 'Device sync completed: {{processed}} processed, {{created}} created, {{updated}} updated',
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          })
        );
      } else {
        setError((result as any).error || t('integrations.rmm.levelio.errors.deviceSyncFailed', { defaultValue: 'Device sync failed' }));
      }
      await refresh();
    });
  };

  const handleAlertBackfill = () => {
    startAlertSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await backfillLevelIoAlerts();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.levelio.success.alertBackfillCompleted', {
            defaultValue: 'Alert backfill completed: {{processed}} alerts processed',
            processed: result.items_processed,
          })
        );
      } else {
        setError((result as any).error || t('integrations.rmm.levelio.errors.alertBackfillFailed', { defaultValue: 'Alert backfill failed' }));
      }
      await refresh();
    });
  };

  const handleMappingClientChange = (mappingId: string, clientId: string) => {
    void (async () => {
      const result = await updateLevelIoOrganizationMapping({
        mappingId,
        clientId: clientId || null,
      });
      if (!result.success) {
        setError(result.error || t('integrations.rmm.levelio.errors.updateMappingFailed', { defaultValue: 'Failed to update mapping' }));
        return;
      }
      await refresh();
    })();
  };

  return (
    <div className="space-y-6" id="levelio-integration-settings">
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
          <CardTitle>{t('integrations.rmm.levelio.connection.title', { defaultValue: 'Level Connection' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.levelio.connection.description', {
              defaultValue: 'Connect to Level (level.io) with an API key. Keys are created in Level under Settings > API.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t('integrations.rmm.levelio.status.label', { defaultValue: 'Status: ' })}{statusBadge}
            </div>
            <div className="text-sm text-muted-foreground">
              {syncError
                ? t('integrations.rmm.levelio.connection.syncLabelWithError', { defaultValue: 'Sync: {{status}} ({{error}})', status: syncStatus, error: syncError })
                : t('integrations.rmm.levelio.connection.syncLabel', { defaultValue: 'Sync: {{status}}', status: syncStatus })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('integrations.rmm.levelio.fields.apiKey', {
                defaultValue: 'API key ({{state}})',
                state: hasApiKey
                  ? t('integrations.rmm.levelio.fields.apiKeyStateSaved', { defaultValue: 'saved' })
                  : t('integrations.rmm.levelio.fields.apiKeyStateRequired', { defaultValue: 'required' }),
              })}
            </label>
            <Input
              id="levelio-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey
                ? t('integrations.rmm.levelio.fields.apiKeyPlaceholderExisting', { defaultValue: 'Enter a new key to replace the saved one' })
                : t('integrations.rmm.levelio.fields.apiKeyPlaceholderNew', { defaultValue: 'Paste your Level API key' })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button id="levelio-save-config" onClick={handleSave} disabled={isSaving || isLoading}>
              {t('integrations.rmm.levelio.actions.saveConfiguration', { defaultValue: 'Save Configuration' })}
            </Button>
            <Button id="levelio-test-connection" variant="outline" onClick={handleTest} disabled={isTesting || isLoading}>
              {t('integrations.rmm.levelio.actions.testConnection', { defaultValue: 'Test Connection' })}
            </Button>
            <Button id="levelio-disconnect" variant="outline" onClick={handleDisconnect} disabled={isDisconnecting || isLoading}>
              {t('integrations.rmm.levelio.actions.disconnect', { defaultValue: 'Disconnect' })}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {t('integrations.rmm.levelio.connection.connectedAt', {
              defaultValue: 'Connected: {{time}}',
              time: connectedAt ? new Date(connectedAt).toLocaleString() : t('integrations.rmm.levelio.connection.never', { defaultValue: 'never' }),
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.levelio.sync.title', { defaultValue: 'Sync & Group Mappings' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.levelio.sync.description', {
              defaultValue: 'Discover Level groups, map them to clients, and sync devices. Devices in unmapped groups are skipped; subgroups inherit the nearest mapped ancestor.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button id="levelio-sync-groups" onClick={handleGroupSync} disabled={isGroupSyncing || isLoading}>
              {t('integrations.rmm.levelio.actions.discoverGroups', { defaultValue: 'Discover Groups' })}
            </Button>
            <Button id="levelio-sync-devices" onClick={handleDeviceSync} disabled={isDeviceSyncing || isLoading}>
              {t('integrations.rmm.levelio.actions.runDeviceSync', { defaultValue: 'Run Device Sync' })}
            </Button>
            <Button id="levelio-backfill-alerts" variant="outline" onClick={handleAlertBackfill} disabled={isAlertSyncing || isLoading}>
              {t('integrations.rmm.levelio.actions.backfillAlerts', { defaultValue: 'Backfill Alerts' })}
            </Button>
          </div>

          {summary ? (
            <div className="text-xs text-muted-foreground">
              {t('integrations.rmm.levelio.sync.summary', {
                defaultValue: '{{mappedGroups}} mapped groups · {{devices}} devices · {{activeAlerts}} active alerts',
                mappedGroups: summary.mappedGroups,
                devices: summary.devices,
                activeAlerts: summary.activeAlerts,
              })}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.levelio.mappings.group', { defaultValue: 'Level Group' })}</th>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.levelio.mappings.mappedClient', { defaultValue: 'Mapped Client' })}</th>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.levelio.mappings.autoSync', { defaultValue: 'Auto Sync' })}</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.mapping_id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {mapping.metadata?.path || mapping.external_organization_name || mapping.external_organization_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('integrations.rmm.levelio.mappings.groupIdLabel', { defaultValue: 'ID: {{id}}', id: mapping.external_organization_id })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="h-9 w-full rounded-md border px-2"
                        value={mapping.client_id || ''}
                        onChange={(e) => handleMappingClientChange(mapping.mapping_id, e.target.value)}
                      >
                        <option value="">{t('integrations.rmm.levelio.mappings.unmapped', { defaultValue: 'Not mapped' })}</option>
                        {clients.map((client) => (
                          <option key={client.client_id} value={client.client_id}>
                            {client.client_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {mapping.auto_sync_assets
                        ? <Badge variant="default">{t('integrations.rmm.levelio.mappings.autoSyncEnabled', { defaultValue: 'Enabled' })}</Badge>
                        : <Badge variant="outline">{t('integrations.rmm.levelio.mappings.autoSyncDisabled', { defaultValue: 'Disabled' })}</Badge>}
                    </td>
                  </tr>
                ))}
                {!mappings.length ? (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                      {isLoading
                        ? t('integrations.rmm.levelio.mappings.loading', { defaultValue: 'Loading…' })
                        : t('integrations.rmm.levelio.mappings.noGroups', { defaultValue: 'No groups discovered yet. Run Discover Groups first.' })}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.levelio.webhook.title', { defaultValue: 'Alert Webhook' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.levelio.webhook.description', {
              defaultValue: 'Level cannot register webhooks via its API. In Level, create an automation with an HTTP POST action using the URL, header, and payload below to push alerts into Alga in real time.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {webhook ? (
            <>
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.levelio.webhook.url', { defaultValue: 'Webhook URL' })}</div>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{webhook.url}</code>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {t('integrations.rmm.levelio.webhook.header', { defaultValue: 'Header: {{name}}', name: webhook.headerName })}
                </div>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{webhook.secret}</code>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.levelio.webhook.payload', { defaultValue: 'Payload template' })}</div>
                <pre className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{webhook.payloadTemplate}</pre>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('integrations.rmm.levelio.webhook.loading', { defaultValue: 'Webhook details load after the integration is configured.' })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
