'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import type { IClient, IContact, ColumnDefinition } from '@alga-psa/types';
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
import { RmmAlertAutomationSettings } from '@alga-psa/integrations/components/settings/integrations/RmmAlertAutomationSettings';

type MappingRow = {
  mapping_id: string;
  external_organization_id: string;
  external_organization_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  default_contact_id?: string | null;
  auto_sync_assets: boolean;
  metadata?: { path?: string } | null;
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

  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('pending');
  const [syncError, setSyncError] = useState<string | null>(null);

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const { renderQuickAddContact } = useQuickAddClient();
  const [quickAddContactFor, setQuickAddContactFor] = useState<{ mappingId: string; clientId: string } | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [summary, setSummary] = useState<{ mappedGroups: number; devices: number; activeAlerts: number } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isGroupSyncing, startGroupSyncing] = useTransition();
  const [isDeviceSyncing, startDeviceSyncing] = useTransition();
  const [isAlertSyncing, startAlertSyncing] = useTransition();

  const refresh = useCallback(async (background = false) => {
    if (!background) setIsLoading(true);
    setError(null);
    try {
      const [settingsResult, mappingResult, webhookResult, summaryResult, contactsResult, clientsResult] = await Promise.all([
        getLevelIoSettings(),
        listLevelIoOrganizationMappings(),
        getLevelIoWebhookInfo(),
        getLevelIoConnectionSummary(),
        getAllContacts('active'),
        getAllClients(false),
      ]);

      setContacts(contactsResult ?? []);
      setClients(clientsResult ?? []);

      if (!settingsResult.success) {
        setError(settingsResult.error || t('integrations.rmm.levelio.errors.loadSettings', { defaultValue: 'Failed to load Level settings' }));
      } else {
        const config = settingsResult.config;
        setIntegrationId(config?.integrationId || null);
        setIsActive(Boolean(config?.isActive));
        setConnectedAt(config?.connectedAt || null);
        setSyncStatus(config?.syncStatus || 'pending');
        setSyncError(config?.syncError || null);
        setHasApiKey(Boolean(settingsResult.credentials?.hasApiKey));
      }

      if (!mappingResult.success) {
        setError((prev) => prev || mappingResult.error || t('integrations.rmm.levelio.errors.loadMappings', { defaultValue: 'Failed to load Level group mappings' }));
      } else {
        setMappings((mappingResult.mappings || []) as MappingRow[]);
      }

      if (!webhookResult.success) {
        setError((prev) => prev || webhookResult.error || t('integrations.rmm.levelio.errors.loadWebhook', { defaultValue: 'Failed to load Level webhook details' }));
      } else {
        setWebhook((webhookResult.webhook as WebhookInfo | null) ?? null);
      }

      if (!summaryResult.success) {
        setError((prev) => prev || summaryResult.error || t('integrations.rmm.levelio.errors.loadSummary', { defaultValue: 'Failed to load Level connection summary' }));
      } else {
        setSummary(summaryResult.summary ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('integrations.rmm.levelio.errors.loadState', { defaultValue: 'Failed to load Level integration state' }));
    } finally {
      if (!background) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statusBadge = isActive
    ? <Badge variant="default">{t('integrations.rmm.levelio.status.connected', { defaultValue: 'Connected' })}</Badge>
    : <Badge variant="outline">{t('integrations.rmm.levelio.status.disconnected', { defaultValue: 'Not connected' })}</Badge>;
  const syncStatusLabel = syncStatus.charAt(0).toUpperCase() + syncStatus.slice(1);

  const handleSave = () => {
    startSaving(async () => {
      setError(null);
      setSuccess(null);
      const result = await saveLevelIoConfiguration({ apiKey: apiKey.trim() || undefined });
      if (result.success) {
        setApiKey('');
        setSuccess(t('integrations.rmm.levelio.success.configurationSaved', { defaultValue: 'Level configuration saved' }));
        await refresh(true);
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
      await refresh(true);
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
      await refresh(true);
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
        setError(('error' in result && result.error) || t('integrations.rmm.levelio.errors.groupSyncFailed', { defaultValue: 'Group discovery failed' }));
      }
      await refresh(true);
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
        setError(('error' in result && result.error) || t('integrations.rmm.levelio.errors.deviceSyncFailed', { defaultValue: 'Device sync failed' }));
      }
      await refresh(true);
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
        setError(('error' in result && result.error) || t('integrations.rmm.levelio.errors.alertBackfillFailed', { defaultValue: 'Alert backfill failed' }));
      }
      await refresh(true);
    });
  };

  const handleMappingClientChange = (mappingId: string, clientId: string | null) => {
    void (async () => {
      const result = await updateLevelIoOrganizationMapping({
        mappingId,
        clientId: clientId || null,
        defaultContactId: null,
      });
      if (!result.success) {
        setError(result.error || t('integrations.rmm.levelio.errors.updateMappingFailed', { defaultValue: 'Failed to update mapping' }));
        return;
      }
      await refresh(true);
    })();
  };

  const handleDefaultContactChange = (mappingId: string, contactId: string) => {
    void (async () => {
      const result = await updateLevelIoOrganizationMapping({
        mappingId,
        defaultContactId: contactId || null,
      });
      if (!result.success) {
        setError(result.error || t('integrations.rmm.levelio.errors.updateMappingFailed', { defaultValue: 'Failed to update mapping' }));
        return;
      }
      await refresh(true);
    })();
  };

  const handleCopy = (field: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
    });
  };

  const copyLabel = (field: string) =>
    copiedField === field
      ? t('integrations.rmm.levelio.webhook.copied', { defaultValue: 'Copied' })
      : t('integrations.rmm.levelio.webhook.copy', { defaultValue: 'Copy' });

  const columns: ColumnDefinition<MappingRow>[] = [
    {
      title: t('integrations.rmm.levelio.mappings.group', { defaultValue: 'Level Group' }),
      dataIndex: 'external_organization_id',
      render: (_v, mapping) => (
        <>
          <div className="font-medium">
            {mapping.metadata?.path || mapping.external_organization_name || mapping.external_organization_id}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('integrations.rmm.levelio.mappings.groupIdLabel', { defaultValue: 'ID: {{id}}', id: mapping.external_organization_id })}
          </div>
        </>
      ),
    },
    {
      title: t('integrations.rmm.levelio.mappings.mappedClient', { defaultValue: 'Mapped Client' }),
      dataIndex: 'client_id',
      sortable: false,
      render: (_v, mapping) => (
        <ClientPicker
          id={`levelio-client-picker-${mapping.mapping_id}`}
          clients={clients}
          selectedClientId={mapping.client_id ?? null}
          onSelect={(clientId) => handleMappingClientChange(mapping.mapping_id, clientId)}
          filterState="active"
          onFilterStateChange={() => {}}
          clientTypeFilter="all"
          onClientTypeFilterChange={() => {}}
        />
      ),
    },
    {
      title: t('integrations.rmm.levelio.mappings.defaultContact', { defaultValue: 'Default Contact' }),
      dataIndex: 'default_contact_id',
      sortable: false,
      render: (_v, mapping) => (
        <ContactPicker
          id={`levelio-default-contact-${mapping.mapping_id}`}
          contacts={contacts}
          value={mapping.default_contact_id ?? ''}
          onValueChange={(contactId) => handleDefaultContactChange(mapping.mapping_id, contactId)}
          clientId={mapping.client_id ?? undefined}
          disabled={!mapping.client_id}
          placeholder={t('integrations.rmm.levelio.mappings.selectContact', { defaultValue: 'Select contact' })}
          onAddNew={mapping.client_id ? () => setQuickAddContactFor({ mappingId: mapping.mapping_id, clientId: mapping.client_id! }) : undefined}
        />
      ),
    },
    {
      title: t('integrations.rmm.levelio.mappings.autoSync', { defaultValue: 'Auto Sync' }),
      dataIndex: 'auto_sync_assets',
      sortable: false,
      render: (_v, mapping) => (
        mapping.auto_sync_assets
          ? <Badge variant="default">{t('integrations.rmm.levelio.mappings.autoSyncEnabled', { defaultValue: 'Enabled' })}</Badge>
          : <Badge variant="outline">{t('integrations.rmm.levelio.mappings.autoSyncDisabled', { defaultValue: 'Disabled' })}</Badge>
      ),
    },
  ];

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
                ? t('integrations.rmm.levelio.connection.syncLabelWithError', { defaultValue: 'Sync: {{status}} ({{error}})', status: syncStatusLabel, error: syncError })
                : t('integrations.rmm.levelio.connection.syncLabel', { defaultValue: 'Sync: {{status}}', status: syncStatusLabel })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="levelio-api-key">
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
            <Button id="levelio-save-config" onClick={handleSave} disabled={isSaving || isLoading || (!apiKey.trim() && !hasApiKey)}>
              {t('integrations.rmm.levelio.actions.saveConfiguration', { defaultValue: 'Save Configuration' })}
            </Button>
            <Button id="levelio-test-connection" variant="outline" onClick={handleTest} disabled={isTesting || isLoading || !hasApiKey}>
              {t('integrations.rmm.levelio.actions.testConnection', { defaultValue: 'Test Connection' })}
            </Button>
            <Button id="levelio-disconnect" variant="outline" onClick={handleDisconnect} disabled={isDisconnecting || isLoading || (!isActive && !hasApiKey)}>
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
            <Button id="levelio-sync-groups" onClick={handleGroupSync} disabled={isGroupSyncing || isLoading || !isActive}>
              {t('integrations.rmm.levelio.actions.discoverGroups', { defaultValue: 'Discover Groups' })}
            </Button>
            <Button id="levelio-sync-devices" onClick={handleDeviceSync} disabled={isDeviceSyncing || isLoading || !isActive}>
              {t('integrations.rmm.levelio.actions.runDeviceSync', { defaultValue: 'Run Device Sync' })}
            </Button>
            <Button id="levelio-backfill-alerts" variant="outline" onClick={handleAlertBackfill} disabled={isAlertSyncing || isLoading || !isActive}>
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
            <DataTable id="levelio-org-mappings" data={mappings} columns={columns} pagination />
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
                <label className="text-sm font-medium" htmlFor="levelio-webhook-url">
                  {t('integrations.rmm.levelio.webhook.url', { defaultValue: 'Webhook URL' })}
                </label>
                <div className="flex items-center gap-2">
                  <Input id="levelio-webhook-url" value={webhook.url} readOnly containerClassName="flex-1" className="font-mono text-xs" />
                  <Button id="levelio-copy-webhook-url" type="button" variant="outline" size="sm" onClick={() => handleCopy('url', webhook.url)}>
                    <Copy className="mr-1 h-4 w-4" />
                    {copyLabel('url')}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="levelio-webhook-secret">
                  {t('integrations.rmm.levelio.webhook.header', { defaultValue: 'Header: {{name}}', name: webhook.headerName })}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="levelio-webhook-secret"
                    type={showWebhookSecret ? 'text' : 'password'}
                    value={webhook.secret}
                    readOnly
                    containerClassName="flex-1"
                    className="font-mono text-xs"
                  />
                  <Button
                    id="levelio-toggle-webhook-secret"
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={showWebhookSecret
                      ? t('integrations.rmm.levelio.webhook.hideSecret', { defaultValue: 'Hide secret' })
                      : t('integrations.rmm.levelio.webhook.showSecret', { defaultValue: 'Show secret' })}
                    onClick={() => setShowWebhookSecret((current) => !current)}
                  >
                    {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button id="levelio-copy-webhook-secret" type="button" variant="outline" size="sm" onClick={() => handleCopy('secret', webhook.secret)}>
                    <Copy className="mr-1 h-4 w-4" />
                    {copyLabel('secret')}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{t('integrations.rmm.levelio.webhook.payload', { defaultValue: 'Payload template' })}</div>
                  <Button id="levelio-copy-webhook-payload" type="button" variant="outline" size="sm" onClick={() => handleCopy('payload', webhook.payloadTemplate)}>
                    <Copy className="mr-1 h-4 w-4" />
                    {copyLabel('payload')}
                  </Button>
                </div>
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
      {isActive && integrationId && (
        <RmmAlertAutomationSettings integrationId={integrationId} provider="levelio" />
      )}
      {renderQuickAddContact({
        isOpen: !!quickAddContactFor,
        onClose: () => setQuickAddContactFor(null),
        onContactAdded: (newContact) => {
          setContacts((prev) => {
            const i = prev.findIndex((c) => c.contact_name_id === newContact.contact_name_id);
            if (i >= 0) {
              const next = [...prev];
              next[i] = newContact;
              return next;
            }
            return [...prev, newContact];
          });
          if (quickAddContactFor) {
            handleDefaultContactChange(quickAddContactFor.mappingId, newContact.contact_name_id);
          }
          setQuickAddContactFor(null);
        },
        clients,
        selectedClientId: quickAddContactFor?.clientId ?? null,
      })}
    </div>
  );
}
