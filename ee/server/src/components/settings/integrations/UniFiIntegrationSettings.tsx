'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import type { IClient, IContact, ColumnDefinition } from '@alga-psa/types';
import {
  disconnectUniFiIntegration,
  getUniFiConnectionSummary,
  getUniFiSettings,
  listUniFiSiteMappings,
  saveUniFiConfiguration,
  syncUniFiSites,
  testUniFiConnection,
  updateUniFiSiteMapping,
} from '../../../lib/actions/integrations/uniFiActions';
import { RmmDeviceSyncSettings } from '@alga-psa/integrations/components/settings/integrations/RmmDeviceSyncSettings';

type ConnectionMode = 'site_manager' | 'local';

type MappingRow = {
  mapping_id: string;
  external_organization_id: string;
  external_organization_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  default_contact_id?: string | null;
  auto_sync_assets: boolean;
  metadata?: { hostName?: string; siteId?: string } | null;
};

export default function UniFiIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');

  // The key is write-only: this state only ever holds what the user is typing now.
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('site_manager');
  const [localBaseUrl, setLocalBaseUrl] = useState('');
  const [reconnectRequired, setReconnectRequired] = useState(false);

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
  const [summary, setSummary] = useState<{ mappedSites: number; devices: number; activeAlerts: number } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isSiteSyncing, startSiteSyncing] = useTransition();

  const refresh = useCallback(async (background = false) => {
    if (!background) setIsLoading(true);
    setError(null);
    try {
      const [settingsResult, mappingResult, summaryResult, contactsResult, clientsResult] = await Promise.all([
        getUniFiSettings(),
        listUniFiSiteMappings(),
        getUniFiConnectionSummary(),
        getAllContacts('active'),
        getAllClients(false),
      ]);

      setContacts(contactsResult ?? []);
      setClients(clientsResult ?? []);

      if (!settingsResult.success) {
        setError(settingsResult.error || t('integrations.rmm.unifi.errors.loadSettings', { defaultValue: 'Failed to load UniFi settings' }));
      } else {
        const config = settingsResult.config;
        setIntegrationId(config?.integrationId || null);
        setIsActive(Boolean(config?.isActive));
        setConnectedAt(config?.connectedAt || null);
        setSyncStatus(config?.syncStatus || 'pending');
        setSyncError(config?.syncError || null);
        setConnectionMode(config?.connectionMode === 'local' ? 'local' : 'site_manager');
        setLocalBaseUrl(config?.localBaseUrl || '');
        setReconnectRequired(Boolean(config?.reconnectRequired));
        setHasApiKey(Boolean(settingsResult.credentials?.hasApiKey));
      }

      if (!mappingResult.success) {
        setError((prev) => prev || mappingResult.error || t('integrations.rmm.unifi.errors.loadMappings', { defaultValue: 'Failed to load UniFi site mappings' }));
      } else {
        setMappings((mappingResult.mappings || []) as MappingRow[]);
      }

      if (!summaryResult.success) {
        setError((prev) => prev || summaryResult.error || t('integrations.rmm.unifi.errors.loadSummary', { defaultValue: 'Failed to load UniFi connection summary' }));
      } else {
        setSummary(summaryResult.summary ?? null);
      }
    } catch (err) {
      console.error('Failed to load UniFi integration state:', err);
      setError(t('integrations.rmm.unifi.errors.loadState', { defaultValue: 'Failed to load UniFi integration state' }));
    } finally {
      if (!background) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statusBadge = reconnectRequired
    ? <Badge variant="error">{t('integrations.rmm.unifi.status.reconnectRequired', { defaultValue: 'Reconnect required' })}</Badge>
    : isActive
      ? <Badge variant="default">{t('integrations.rmm.unifi.status.connected', { defaultValue: 'Connected' })}</Badge>
      : <Badge variant="outline">{t('integrations.rmm.unifi.status.disconnected', { defaultValue: 'Not connected' })}</Badge>;
  const syncStatusLabel = syncStatus.charAt(0).toUpperCase() + syncStatus.slice(1);

  const handleSave = () => {
    startSaving(async () => {
      setError(null);
      setSuccess(null);
      const result = await saveUniFiConfiguration({
        apiKey: apiKey.trim() || undefined,
        connectionMode,
        localBaseUrl: connectionMode === 'local' ? localBaseUrl.trim() : undefined,
      });
      if (result.success) {
        setApiKey('');
        setSuccess(t('integrations.rmm.unifi.success.configurationSaved', { defaultValue: 'UniFi configuration saved' }));
        await refresh(true);
      } else {
        setError(result.error || t('integrations.rmm.unifi.errors.saveConfiguration', { defaultValue: 'Failed to save UniFi configuration' }));
      }
    });
  };

  const handleTest = () => {
    startTesting(async () => {
      setError(null);
      setSuccess(null);
      const result = await testUniFiConnection();
      if (result.success) {
        setSuccess(t('integrations.rmm.unifi.success.connectionTestSucceeded', { defaultValue: 'Connection to UniFi succeeded' }));
      } else {
        setError(result.error || t('integrations.rmm.unifi.errors.testConnectionFailed', { defaultValue: 'Connection test failed' }));
      }
      await refresh(true);
    });
  };

  const handleDisconnect = () => {
    startDisconnecting(async () => {
      setError(null);
      setSuccess(null);
      const result = await disconnectUniFiIntegration();
      if (result.success) {
        setSuccess(t('integrations.rmm.unifi.success.disconnected', { defaultValue: 'UniFi integration disconnected' }));
      } else {
        setError(result.error || t('integrations.rmm.unifi.errors.disconnectFailed', { defaultValue: 'Failed to disconnect UniFi integration' }));
      }
      await refresh(true);
    });
  };

  const handleSiteSync = () => {
    startSiteSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await syncUniFiSites();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.unifi.success.siteSyncCompleted', {
            defaultValue: 'Site discovery completed: {{processed}} processed, {{created}} created, {{updated}} updated',
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          })
        );
        if ('errors' in result && result.errors?.length) {
          setError(result.errors.join('; '));
        }
      } else {
        setError(('error' in result && result.error) || t('integrations.rmm.unifi.errors.siteSyncFailed', { defaultValue: 'Site discovery failed' }));
      }
      await refresh(true);
    });
  };

  const handleMappingClientChange = (mappingId: string, clientId: string | null) => {
    void (async () => {
      const result = await updateUniFiSiteMapping({ mappingId, clientId: clientId || null, defaultContactId: null });
      if (!result.success) {
        setError(result.error || t('integrations.rmm.unifi.errors.updateMappingFailed', { defaultValue: 'Failed to update mapping' }));
        return;
      }
      await refresh(true);
    })();
  };

  const handleDefaultContactChange = (mappingId: string, contactId: string) => {
    void (async () => {
      const result = await updateUniFiSiteMapping({ mappingId, defaultContactId: contactId || null });
      if (!result.success) {
        setError(result.error || t('integrations.rmm.unifi.errors.updateMappingFailed', { defaultValue: 'Failed to update mapping' }));
        return;
      }
      await refresh(true);
    })();
  };

  const modeOptions = [
    { value: 'site_manager', label: t('integrations.rmm.unifi.fields.modeSiteManager', { defaultValue: 'Site Manager (cloud)' }) },
    { value: 'local', label: t('integrations.rmm.unifi.fields.modeLocal', { defaultValue: 'Local controller' }) },
  ];

  const columns: ColumnDefinition<MappingRow>[] = [
    {
      title: t('integrations.rmm.unifi.mappings.site', { defaultValue: 'UniFi Site' }),
      dataIndex: 'external_organization_id',
      render: (_v, mapping) => (
        <>
          <div className="font-medium">{mapping.external_organization_name || mapping.external_organization_id}</div>
          <div className="text-xs text-muted-foreground">
            {t('integrations.rmm.unifi.mappings.siteIdLabel', { defaultValue: 'ID: {{id}}', id: mapping.external_organization_id })}
          </div>
        </>
      ),
    },
    {
      title: t('integrations.rmm.unifi.mappings.mappedClient', { defaultValue: 'Mapped Client' }),
      dataIndex: 'client_id',
      sortable: false,
      render: (_v, mapping) => (
        <ClientPicker
          id={`unifi-client-picker-${mapping.mapping_id}`}
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
      title: t('integrations.rmm.unifi.mappings.defaultContact', { defaultValue: 'Default Contact' }),
      dataIndex: 'default_contact_id',
      sortable: false,
      render: (_v, mapping) => (
        <ContactPicker
          id={`unifi-default-contact-${mapping.mapping_id}`}
          contacts={contacts}
          value={mapping.default_contact_id ?? ''}
          onValueChange={(contactId) => handleDefaultContactChange(mapping.mapping_id, contactId)}
          clientId={mapping.client_id ?? undefined}
          disabled={!mapping.client_id}
          placeholder={t('integrations.rmm.unifi.mappings.selectContact', { defaultValue: 'Select contact' })}
          onAddNew={mapping.client_id ? () => setQuickAddContactFor({ mappingId: mapping.mapping_id, clientId: mapping.client_id! }) : undefined}
        />
      ),
    },
    {
      title: t('integrations.rmm.unifi.mappings.autoSync', { defaultValue: 'Auto Sync' }),
      dataIndex: 'auto_sync_assets',
      sortable: false,
      render: (_v, mapping) => (
        mapping.auto_sync_assets
          ? <Badge variant="default">{t('integrations.rmm.unifi.mappings.autoSyncEnabled', { defaultValue: 'Enabled' })}</Badge>
          : <Badge variant="outline">{t('integrations.rmm.unifi.mappings.autoSyncDisabled', { defaultValue: 'Disabled' })}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6" id="unifi-integration-settings">
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
      {reconnectRequired ? (
        <Alert variant="destructive" id="unifi-reconnect-alert">
          <AlertDescription>
            {t('integrations.rmm.unifi.errors.reconnectRequired', {
              defaultValue: 'UniFi rejected the saved API key. Paste a new key and save to resume syncing.',
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.unifi.connection.title', { defaultValue: 'UniFi Connection' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.unifi.connection.description', {
              defaultValue: 'Connect with a UniFi API key. Use Site Manager to reach every console on your account, or Local controller for a controller you can reach directly. Adopted gateways, switches and access points are synced.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t('integrations.rmm.unifi.status.label', { defaultValue: 'Status: ' })}{statusBadge}
            </div>
            <div className="text-sm text-muted-foreground">
              {syncError
                ? t('integrations.rmm.unifi.connection.syncLabelWithError', { defaultValue: 'Sync: {{status}} ({{error}})', status: syncStatusLabel, error: syncError })
                : t('integrations.rmm.unifi.connection.syncLabel', { defaultValue: 'Sync: {{status}}', status: syncStatusLabel })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="unifi-connection-mode">
              {t('integrations.rmm.unifi.fields.connectionMode', { defaultValue: 'Connection mode' })}
            </label>
            <CustomSelect
              id="unifi-connection-mode"
              options={modeOptions}
              value={connectionMode}
              onValueChange={(value) => setConnectionMode(value === 'local' ? 'local' : 'site_manager')}
            />
          </div>

          {connectionMode === 'local' ? (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="unifi-local-base-url">
                {t('integrations.rmm.unifi.fields.localBaseUrl', { defaultValue: 'Controller URL' })}
              </label>
              <Input
                id="unifi-local-base-url"
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                placeholder={t('integrations.rmm.unifi.fields.localBaseUrlPlaceholder', { defaultValue: 'https://unifi.example.com' })}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="unifi-api-key">
              {t('integrations.rmm.unifi.fields.apiKey', {
                defaultValue: 'API key ({{state}})',
                state: hasApiKey
                  ? t('integrations.rmm.unifi.fields.apiKeyStateSaved', { defaultValue: 'saved' })
                  : t('integrations.rmm.unifi.fields.apiKeyStateRequired', { defaultValue: 'required' }),
              })}
            </label>
            <Input
              id="unifi-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey
                ? t('integrations.rmm.unifi.fields.apiKeyPlaceholderExisting', { defaultValue: 'Key saved. Enter a new key to replace it' })
                : t('integrations.rmm.unifi.fields.apiKeyPlaceholderNew', { defaultValue: 'Paste your UniFi API key' })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button id="unifi-save-config" onClick={handleSave} disabled={isSaving || isLoading || (!apiKey.trim() && !hasApiKey)}>
              {t('integrations.rmm.unifi.actions.saveConfiguration', { defaultValue: 'Save Configuration' })}
            </Button>
            <Button id="unifi-test-connection" variant="outline" onClick={handleTest} disabled={isTesting || isLoading || !hasApiKey}>
              {t('integrations.rmm.unifi.actions.testConnection', { defaultValue: 'Test Connection' })}
            </Button>
            <Button id="unifi-disconnect" variant="outline" onClick={handleDisconnect} disabled={isDisconnecting || isLoading || (!isActive && !hasApiKey)}>
              {t('integrations.rmm.unifi.actions.disconnect', { defaultValue: 'Disconnect' })}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {t('integrations.rmm.unifi.connection.connectedAt', {
              defaultValue: 'Connected: {{time}}',
              time: connectedAt ? new Date(connectedAt).toLocaleString() : t('integrations.rmm.unifi.connection.never', { defaultValue: 'never' }),
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.unifi.sync.title', { defaultValue: 'Sync & Site Mappings' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.unifi.sync.description', {
              defaultValue: 'Discover UniFi sites and map each to a client. Devices in unmapped sites are skipped.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button id="unifi-sync-sites" onClick={handleSiteSync} disabled={isSiteSyncing || isLoading || !isActive}>
              {t('integrations.rmm.unifi.actions.discoverSites', { defaultValue: 'Discover Sites' })}
            </Button>
          </div>

          {summary ? (
            <div className="text-xs text-muted-foreground">
              {t('integrations.rmm.unifi.sync.summary', {
                defaultValue: '{{mappedSites}} mapped sites · {{devices}} devices · {{activeAlerts}} active alerts',
                mappedSites: summary.mappedSites,
                devices: summary.devices,
                activeAlerts: summary.activeAlerts,
              })}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border">
            <DataTable id="unifi-site-mappings" data={mappings} columns={columns} pagination />
          </div>
        </CardContent>
      </Card>

      {isActive && (
        <RmmDeviceSyncSettings provider="unifi" onSaved={() => void refresh(true)} />
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
