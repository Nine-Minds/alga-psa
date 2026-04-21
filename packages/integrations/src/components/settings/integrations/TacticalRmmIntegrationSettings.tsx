'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Eye, EyeOff, RefreshCw, Save, Unlink } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import {
  backfillTacticalRmmAlerts,
  disconnectTacticalRmmIntegration,
  getTacticalRmmConnectionSummary,
  getTacticalRmmSettings,
  getTacticalRmmWebhookInfo,
  ingestTacticalRmmSoftwareInventory,
  listTacticalRmmOrganizationMappings,
  saveTacticalRmmConfiguration,
  syncTacticalRmmOrganizations,
  syncTacticalRmmDevices,
  testTacticalRmmConnection,
  updateTacticalRmmOrganizationMapping,
  type TacticalRmmAuthMode,
} from '@alga-psa/integrations/actions';
import type { IClient } from '@alga-psa/types';
import { getIntegrationClients } from '../../../actions/clientLookupActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function TacticalRmmIntegrationSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [syncingOrgs, setSyncingOrgs] = React.useState(false);
  const [syncingDevices, setSyncingDevices] = React.useState(false);
  const [backfillingAlerts, setBackfillingAlerts] = React.useState(false);
  const [ingestingSoftware, setIngestingSoftware] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [instanceUrl, setInstanceUrl] = React.useState('');
  const [authMode, setAuthMode] = React.useState<TacticalRmmAuthMode>('api_key');

  const [apiKey, setApiKey] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totpCode, setTotpCode] = React.useState('');

  const [showApiKey, setShowApiKey] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  const [credentialsStatus, setCredentialsStatus] = React.useState<{
    hasApiKey: boolean;
    apiKeyMasked?: string;
    hasKnoxCredentials: boolean;
    username?: string;
    hasKnoxToken: boolean;
    knoxTokenMasked?: string;
  } | null>(null);

  const [totpRequired, setTotpRequired] = React.useState(false);

  const [connectionSummary, setConnectionSummary] = React.useState<Awaited<ReturnType<typeof getTacticalRmmConnectionSummary>>['summary'] | null>(null);
  const [orgMappings, setOrgMappings] = React.useState<NonNullable<Awaited<ReturnType<typeof listTacticalRmmOrganizationMappings>>['mappings']>>([]);
  const [clients, setClients] = React.useState<IClient[]>([]);
  const [clientsLoading, setClientsLoading] = React.useState(false);
  const [clientFilterState, setClientFilterState] = React.useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = React.useState<'all' | 'company' | 'individual'>('all');
  const [webhookInfo, setWebhookInfo] = React.useState<Awaited<ReturnType<typeof getTacticalRmmWebhookInfo>>['webhook'] | null>(null);
  const [showWebhookSecret, setShowWebhookSecret] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const [res, summaryRes] = await Promise.all([
        getTacticalRmmSettings(),
        getTacticalRmmConnectionSummary(),
      ]);
      if (!res.success) {
        setError(res.error || t('integrations.rmm.tactical.errors.loadSettings', { defaultValue: 'Failed to load Tactical RMM settings' }));
        return;
      }

      setInstanceUrl(res.config?.instanceUrl || '');
      setAuthMode(res.config?.authMode || 'api_key');
      setCredentialsStatus(res.credentials || null);
      setConnectionSummary(summaryRes.success ? (summaryRes.summary || null) : null);

      if (res.credentials?.username) setUsername(res.credentials.username);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadOrgMappings = React.useCallback(async () => {
    const res = await listTacticalRmmOrganizationMappings();
    if (!res.success) {
      setError(res.error || t('integrations.rmm.tactical.errors.loadOrgMappings', { defaultValue: 'Failed to load organization mappings' }));
      return;
    }
    setOrgMappings(res.mappings || []);
  }, [t]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    void loadOrgMappings();
  }, [loadOrgMappings]);

  const loadWebhookInfo = React.useCallback(async () => {
    const res = await getTacticalRmmWebhookInfo();
    if (!res.success) return;
    setWebhookInfo(res.webhook || null);
  }, []);

  React.useEffect(() => {
    void loadWebhookInfo();
  }, [loadWebhookInfo]);

  React.useEffect(() => {
    const run = async () => {
      setClientsLoading(true);
      try {
        const data = await getIntegrationClients(true);
        setClients(data as any);
      } catch (e) {
        setClients([]);
      } finally {
        setClientsLoading(false);
      }
    };
    void run();
  }, []);

  const canSave = instanceUrl.trim() && (
    authMode === 'api_key'
      ? apiKey.trim().length > 0
      : username.trim().length > 0 && password.trim().length > 0
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    setTotpRequired(false);
    try {
      const res = await saveTacticalRmmConfiguration({
        instanceUrl,
        authMode,
        apiKey: authMode === 'api_key' ? apiKey : undefined,
        username: authMode === 'knox' ? username : undefined,
        password: authMode === 'knox' ? password : undefined,
      });
      if (!res.success) {
        setError(res.error || t('integrations.rmm.tactical.errors.saveConfig', { defaultValue: 'Failed to save Tactical RMM configuration' }));
        toast({ title: t('integrations.rmm.tactical.toasts.saveFailedTitle', { defaultValue: 'Save failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }

      setSuccess(t('integrations.rmm.tactical.success.saved', { defaultValue: 'Tactical RMM configuration saved.' }));
      toast({ title: t('integrations.rmm.tactical.toasts.savedTitle', { defaultValue: 'Saved' }), description: t('integrations.rmm.tactical.toasts.savedDescription', { defaultValue: 'Tactical RMM configuration updated.' }) });

      // Clear sensitive fields after save; status will reflect what is stored.
      setApiKey('');
      setPassword('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await testTacticalRmmConnection(totpRequired ? { totpCode } : undefined);
      if (!res.success) {
        if (res.totpRequired) {
          setTotpRequired(true);
          setError(t('integrations.rmm.tactical.errors.totpRequired', { defaultValue: 'TOTP is required. Enter your current code and test again.' }));
          return;
        }
        setError(res.error || t('integrations.rmm.tactical.errors.connectionTest', { defaultValue: 'Connection test failed' }));
        toast({ title: t('integrations.rmm.tactical.toasts.connectionFailedTitle', { defaultValue: 'Connection failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }

      setTotpRequired(false);
      setTotpCode('');
      setSuccess(t('integrations.rmm.tactical.success.connection', { defaultValue: 'Connection successful.' }));
      toast({ title: t('integrations.rmm.tactical.toasts.connectedTitle', { defaultValue: 'Connected' }), description: t('integrations.rmm.tactical.toasts.connectedDescription', { defaultValue: 'Tactical RMM connection verified.' }) });
      await load();
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    setTotpRequired(false);
    try {
      const res = await disconnectTacticalRmmIntegration();
      if (!res.success) {
        setError(res.error || t('integrations.rmm.tactical.errors.disconnect', { defaultValue: 'Disconnect failed' }));
        toast({ title: t('integrations.rmm.tactical.toasts.disconnectFailedTitle', { defaultValue: 'Disconnect failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }
      setSuccess(t('integrations.rmm.tactical.success.disconnected', { defaultValue: 'Disconnected.' }));
      toast({ title: t('integrations.rmm.tactical.toasts.disconnectedTitle', { defaultValue: 'Disconnected' }), description: t('integrations.rmm.tactical.toasts.disconnectedDescription', { defaultValue: 'Tactical RMM credentials cleared.' }) });
      setApiKey('');
      setPassword('');
      setTotpCode('');
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSyncOrganizations = async () => {
    setSyncingOrgs(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await syncTacticalRmmOrganizations();
      if (!res.success) {
        setError(res.error || t('integrations.rmm.tactical.errors.syncOrgs', { defaultValue: 'Organization sync failed' }));
        toast({ title: t('integrations.rmm.tactical.toasts.syncFailedTitle', { defaultValue: 'Sync failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.tactical.success.orgSyncCompleted', { defaultValue: 'Organization sync completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.tactical.errors.someOrgsFailed', { defaultValue: 'Some organizations failed to sync: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({ title: t('integrations.rmm.tactical.toasts.orgsSyncedTitle', { defaultValue: 'Organizations synced' }), description: t('integrations.rmm.tactical.toasts.orgsSyncedDescription', { defaultValue: 'Tactical clients have been synced into org mappings.' }) });
      await load();
    } finally {
      setSyncingOrgs(false);
    }
  };

  const handleSyncDevices = async () => {
    setSyncingDevices(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await syncTacticalRmmDevices();
      if (!res.success) {
        setError(res.error || t('integrations.rmm.tactical.errors.syncDevices', { defaultValue: 'Device sync failed' }));
        toast({ title: t('integrations.rmm.tactical.toasts.syncFailedTitle', { defaultValue: 'Sync failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.tactical.success.deviceSyncCompleted', { defaultValue: 'Device sync completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}, Deleted: {{deleted}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, deleted: res.items_deleted, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.tactical.errors.someDevicesFailed', { defaultValue: 'Some devices failed to sync: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({ title: t('integrations.rmm.tactical.toasts.devicesSyncedTitle', { defaultValue: 'Devices synced' }), description: t('integrations.rmm.tactical.toasts.devicesSyncedDescription', { defaultValue: 'Tactical agents have been synced into assets.' }) });
      await load();
    } finally {
      setSyncingDevices(false);
    }
  };

  const handleUpdateMapping = async (mappingId: string, patch: { clientId?: string | null; autoSyncAssets?: boolean }) => {
    setError(null);
    const res = await updateTacticalRmmOrganizationMapping({
      mappingId,
      clientId: patch.clientId,
      autoSyncAssets: patch.autoSyncAssets,
    });
    if (!res.success) {
      setError(res.error || t('integrations.rmm.tactical.errors.updateMapping', { defaultValue: 'Failed to update mapping' }));
      toast({ title: t('integrations.rmm.tactical.toasts.updateFailedTitle', { defaultValue: 'Update failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
      return;
    }
    await loadOrgMappings();
  };

  const handleBackfillAlerts = async () => {
    setBackfillingAlerts(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await backfillTacticalRmmAlerts();
      if (!res.success) {
        setError(res.error || t('integrations.rmm.tactical.errors.backfillAlerts', { defaultValue: 'Alert backfill failed' }));
        toast({ title: t('integrations.rmm.tactical.toasts.backfillFailedTitle', { defaultValue: 'Backfill failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.tactical.success.alertBackfillCompleted', { defaultValue: 'Alert backfill completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.tactical.errors.someAlertsFailed', { defaultValue: 'Some alerts failed to upsert: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({ title: t('integrations.rmm.tactical.toasts.alertsSyncedTitle', { defaultValue: 'Alerts synced' }), description: t('integrations.rmm.tactical.toasts.alertsSyncedDescription', { defaultValue: 'Tactical alerts have been backfilled.' }) });
      await load();
    } finally {
      setBackfillingAlerts(false);
    }
  };

  const handleIngestSoftware = async () => {
    setIngestingSoftware(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await ingestTacticalRmmSoftwareInventory();
      if (!res.success) {
        setError(res.error || t('integrations.rmm.tactical.errors.ingestSoftware', { defaultValue: 'Software ingestion failed' }));
        toast({ title: t('integrations.rmm.tactical.toasts.ingestionFailedTitle', { defaultValue: 'Ingestion failed' }), description: res.error || t('integrations.rmm.tactical.toasts.unknownError', { defaultValue: 'Unknown error' }), variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.tactical.success.softwareIngestionCompleted', { defaultValue: 'Software ingestion completed. Processed: {{processed}}, Installed/Updated: {{created}}, Assets Updated: {{updated}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.tactical.errors.someSoftwareFailed', { defaultValue: 'Some software rows failed to ingest: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({ title: t('integrations.rmm.tactical.toasts.softwareIngestedTitle', { defaultValue: 'Software ingested' }), description: t('integrations.rmm.tactical.toasts.softwareIngestedDescription', { defaultValue: 'Cached Tactical software inventory has been ingested.' }) });
      await load();
    } finally {
      setIngestingSoftware(false);
    }
  };

  return (
    <Card id="tacticalrmm-integration-settings-card">
      <CardHeader>
        <CardTitle>{t('integrations.rmm.tactical.title', { defaultValue: 'Tactical RMM' })}</CardTitle>
        <CardDescription>
          {t('integrations.rmm.tactical.description', { defaultValue: 'Connect Tactical RMM to sync assets and ingest alerts.' })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="mb-4">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          <div className="rounded-md border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {connectionSummary?.isActive
                    ? t('integrations.rmm.tactical.status.connected', { defaultValue: 'Connected' })
                    : t('integrations.rmm.tactical.status.disconnected', { defaultValue: 'Disconnected' })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {connectionSummary?.instanceUrl ? connectionSummary.instanceUrl : t('integrations.rmm.tactical.status.instanceUrlNotSet', { defaultValue: 'Instance URL not set' })}
                  {connectionSummary?.authMode
                    ? ` • ${t('integrations.rmm.tactical.status.authPrefix', { defaultValue: 'Auth:' })} ${connectionSummary.authMode === 'api_key' ? t('integrations.rmm.tactical.auth.apiKey', { defaultValue: 'API key' }) : t('integrations.rmm.tactical.auth.knox', { defaultValue: 'Knox' })}`
                    : null}
                </div>
              </div>
              <Button
                id="tacticalrmm-refresh-status"
                type="button"
                variant="outline"
                size="sm"
                onClick={load}
                disabled={loading || saving || testing || disconnecting}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                {t('integrations.rmm.tactical.actions.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </div>

            {connectionSummary && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.tactical.counts.mappedOrgs', { defaultValue: 'Mapped Orgs' })}</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.mappedOrganizations}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.tactical.counts.syncedDevices', { defaultValue: 'Synced Devices' })}</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.syncedDevices}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.tactical.counts.activeAlerts', { defaultValue: 'Active Alerts' })}</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.activeAlerts}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.tactical.counts.lastSync', { defaultValue: 'Last Sync' })}</div>
                  <div className="text-sm font-semibold">
                    {connectionSummary.lastSyncAt ? new Date(connectionSummary.lastSyncAt).toLocaleString() : t('integrations.rmm.tactical.counts.never', { defaultValue: 'Never' })}
                  </div>
                </div>
              </div>
            )}

            {connectionSummary?.syncError && (
              <div className="mt-3 text-xs text-destructive">
                {t('integrations.rmm.tactical.lastError', { defaultValue: 'Last error: {{error}}', error: connectionSummary.syncError })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tacticalrmm-instance-url">{t('integrations.rmm.tactical.fields.instanceUrl', { defaultValue: 'Instance URL' })}</Label>
            <Input
              id="tacticalrmm-instance-url"
              placeholder="https://rmm.example.com"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              disabled={loading || saving || disconnecting}
            />
            <div className="text-xs text-muted-foreground">
              {t('integrations.rmm.tactical.fields.instanceUrlHelp', { defaultValue: 'Use your Tactical base URL (no trailing /api).' })}
            </div>
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.tactical.sections.organizations', { defaultValue: 'Organizations' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.sections.organizationsDescription', { defaultValue: 'Sync Tactical Clients into Alga org mappings, then map them to Alga Clients.' })}
                </div>
              </div>
              <Button
                id="tacticalrmm-sync-organizations"
                type="button"
                onClick={handleSyncOrganizations}
                disabled={syncingOrgs || loading || saving || testing || disconnecting}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncingOrgs ? 'animate-spin' : ''}`} />
                {syncingOrgs
                  ? t('integrations.rmm.tactical.actions.syncing', { defaultValue: 'Syncing...' })
                  : t('integrations.rmm.tactical.actions.syncClients', { defaultValue: 'Sync Clients' })}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-background p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.tactical.sections.orgMapping', { defaultValue: 'Organization Mapping' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.sections.orgMappingDescription', { defaultValue: 'Assign each Tactical Client to an Alga Client and control auto-sync per org.' })}
                </div>
              </div>
              <Button
                id="tacticalrmm-refresh-mappings"
                type="button"
                variant="outline"
                size="sm"
                onClick={loadOrgMappings}
                disabled={loading || syncingOrgs || syncingDevices || saving || testing || disconnecting}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('integrations.rmm.tactical.actions.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </div>

            {orgMappings.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t('integrations.rmm.tactical.sections.orgMappingEmpty', { defaultValue: 'No organizations found. Run "Sync Clients" first.' })}
              </div>
            ) : (
              <div className="space-y-2">
                {orgMappings.map((m) => (
                  <div key={m.mapping_id} className="flex flex-col lg:flex-row lg:items-center gap-3 rounded border p-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {m.external_organization_name || m.external_organization_id}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t('integrations.rmm.tactical.tacticalIdLabel', { defaultValue: 'Tactical ID: {{id}}', id: m.external_organization_id })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <ClientPicker
                        id={`tacticalrmm-org-client-picker-${m.mapping_id}`}
                        clients={clients}
                        selectedClientId={m.client_id || null}
                        onSelect={(clientId) => handleUpdateMapping(m.mapping_id, { clientId })}
                        filterState={clientFilterState}
                        onFilterStateChange={setClientFilterState}
                        clientTypeFilter={clientTypeFilter}
                        onClientTypeFilterChange={setClientTypeFilter}
                        placeholder={clientsLoading
                          ? t('integrations.rmm.tactical.client.loading', { defaultValue: 'Loading clients…' })
                          : t('integrations.rmm.tactical.client.select', { defaultValue: 'Select client' })}
                        fitContent
                        triggerVariant="outline"
                        triggerSize="sm"
                        className="min-w-[220px]"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id={`tacticalrmm-org-autosync-${m.mapping_id}`}
                        checked={Boolean(m.auto_sync_assets)}
                        onCheckedChange={(checked) => handleUpdateMapping(m.mapping_id, { autoSyncAssets: checked })}
                      />
                      <span className="text-sm">{t('integrations.rmm.tactical.autoSync', { defaultValue: 'Auto-sync' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.tactical.sections.devices', { defaultValue: 'Devices' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.sections.devicesDescription', { defaultValue: 'Sync Tactical Agents into Alga Assets for mapped organizations.' })}
                </div>
              </div>
              <Button
                id="tacticalrmm-sync-devices"
                type="button"
                onClick={handleSyncDevices}
                disabled={syncingDevices || loading || saving || testing || disconnecting || backfillingAlerts}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncingDevices ? 'animate-spin' : ''}`} />
                {syncingDevices
                  ? t('integrations.rmm.tactical.actions.syncing', { defaultValue: 'Syncing...' })
                  : t('integrations.rmm.tactical.actions.syncDevices', { defaultValue: 'Sync Devices' })}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.tactical.sections.alerts', { defaultValue: 'Alerts' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.sections.alertsDescription', { defaultValue: 'Optional: backfill historical or active alerts from Tactical into Alga.' })}
                </div>
              </div>
              <Button
                id="tacticalrmm-backfill-alerts"
                type="button"
                variant="secondary"
                onClick={handleBackfillAlerts}
                disabled={backfillingAlerts || loading || saving || testing || disconnecting || syncingOrgs || syncingDevices}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${backfillingAlerts ? 'animate-spin' : ''}`} />
                {backfillingAlerts
                  ? t('integrations.rmm.tactical.actions.syncing', { defaultValue: 'Syncing...' })
                  : t('integrations.rmm.tactical.actions.syncAlerts', { defaultValue: 'Sync Alerts' })}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.tactical.sections.softwareInventory', { defaultValue: 'Software Inventory' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.sections.softwareInventoryDescription', { defaultValue: 'Optional: ingest cached software inventory via Tactical /api/software/ (no per-agent refresh calls).' })}
                </div>
              </div>
              <Button
                id="tacticalrmm-ingest-software"
                type="button"
                variant="secondary"
                onClick={handleIngestSoftware}
                disabled={ingestingSoftware || loading || saving || testing || disconnecting || syncingOrgs || syncingDevices || backfillingAlerts}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${ingestingSoftware ? 'animate-spin' : ''}`} />
                {ingestingSoftware
                  ? t('integrations.rmm.tactical.actions.ingesting', { defaultValue: 'Ingesting...' })
                  : t('integrations.rmm.tactical.actions.ingestSoftware', { defaultValue: 'Ingest Software' })}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-background p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.tactical.sections.webhooks', { defaultValue: 'Webhooks (Alerts)' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.sections.webhooksDescription', { defaultValue: 'Configure a Tactical alert action webhook using the shared secret header below.' })}
                </div>
              </div>
              <Button
                id="tacticalrmm-refresh-webhook-info"
                type="button"
                variant="outline"
                size="sm"
                onClick={loadWebhookInfo}
                disabled={loading || saving || testing || disconnecting}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('integrations.rmm.tactical.actions.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </div>

            {webhookInfo ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="tacticalrmm-webhook-url">{t('integrations.rmm.tactical.webhook.url', { defaultValue: 'Webhook URL' })}</Label>
                  <div className="flex items-center gap-2">
                    <Input id="tacticalrmm-webhook-url" value={webhookInfo.url} readOnly />
                    <Button
                      id="tacticalrmm-copy-webhook-url"
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        await navigator.clipboard.writeText(webhookInfo.url);
                        toast({ title: t('integrations.rmm.tactical.webhook.copiedTitle', { defaultValue: 'Copied' }), description: t('integrations.rmm.tactical.webhook.urlCopied', { defaultValue: 'Webhook URL copied to clipboard.' }) });
                      }}
                    >
                      {t('integrations.rmm.tactical.webhook.copy', { defaultValue: 'Copy' })}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tacticalrmm-webhook-header-name">{t('integrations.rmm.tactical.webhook.headerName', { defaultValue: 'Header Name' })}</Label>
                  <Input id="tacticalrmm-webhook-header-name" value={webhookInfo.headerName} readOnly />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tacticalrmm-webhook-secret">{t('integrations.rmm.tactical.webhook.secret', { defaultValue: 'Header Secret' })}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="tacticalrmm-webhook-secret"
                      type={showWebhookSecret ? 'text' : 'password'}
                      value={webhookInfo.secret}
                      readOnly
                    />
                    <Button
                      id="tacticalrmm-toggle-webhook-secret"
                      type="button"
                      variant="outline"
                      onClick={() => setShowWebhookSecret((s) => !s)}
                    >
                      {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      id="tacticalrmm-copy-webhook-secret"
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        await navigator.clipboard.writeText(webhookInfo.secret);
                        toast({ title: t('integrations.rmm.tactical.webhook.copiedTitle', { defaultValue: 'Copied' }), description: t('integrations.rmm.tactical.webhook.secretCopied', { defaultValue: 'Webhook secret copied to clipboard.' }) });
                      }}
                    >
                      {t('integrations.rmm.tactical.webhook.copy', { defaultValue: 'Copy' })}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tacticalrmm-webhook-payload-template">{t('integrations.rmm.tactical.webhook.payloadTemplate', { defaultValue: 'Payload Template' })}</Label>
                  <TextArea id="tacticalrmm-webhook-payload-template" value={webhookInfo.payloadTemplate} readOnly rows={10} />
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t('integrations.rmm.tactical.webhook.unavailable', { defaultValue: 'Webhook information unavailable. (Requires settings read permission.)' })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tacticalrmm-auth-mode">{t('integrations.rmm.tactical.auth.mode', { defaultValue: 'Authentication' })}</Label>
            <CustomSelect
              id="tacticalrmm-auth-mode"
              value={authMode}
              onValueChange={(v) => {
                setAuthMode(v as TacticalRmmAuthMode);
                setTotpRequired(false);
                setTotpCode('');
                setError(null);
                setSuccess(null);
              }}
              options={[
                { value: 'api_key', label: t('integrations.rmm.tactical.auth.apiKey', { defaultValue: 'API key' }) },
                { value: 'knox', label: t('integrations.rmm.tactical.auth.knoxOption', { defaultValue: 'Username/password (Knox token)' }) },
              ]}
            />
          </div>

          {authMode === 'api_key' ? (
            <div className="space-y-2">
              <Label htmlFor="tacticalrmm-api-key">{t('integrations.rmm.tactical.auth.apiKey', { defaultValue: 'API key' })}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tacticalrmm-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={credentialsStatus?.apiKeyMasked ? credentialsStatus.apiKeyMasked : t('integrations.rmm.tactical.auth.enterApiKey', { defaultValue: 'Enter API key' })}
                  disabled={loading || saving || disconnecting}
                />
                <Button
                  id="tacticalrmm-toggle-api-key-visibility"
                  type="button"
                  variant="outline"
                  onClick={() => setShowApiKey((s) => !s)}
                  disabled={loading || saving || disconnecting}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {credentialsStatus?.hasApiKey && (
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.auth.saved', { defaultValue: 'Saved: {{value}}', value: credentialsStatus.apiKeyMasked })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tacticalrmm-username">{t('integrations.rmm.tactical.auth.username', { defaultValue: 'Username' })}</Label>
                <Input
                  id="tacticalrmm-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('integrations.rmm.tactical.auth.enterUsername', { defaultValue: 'Enter username' })}
                  disabled={loading || saving || disconnecting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tacticalrmm-password">{t('integrations.rmm.tactical.auth.password', { defaultValue: 'Password' })}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tacticalrmm-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={credentialsStatus?.hasKnoxCredentials
                      ? t('integrations.rmm.tactical.auth.savedEnterToUpdate', { defaultValue: 'Saved (enter to update)' })
                      : t('integrations.rmm.tactical.auth.enterPassword', { defaultValue: 'Enter password' })}
                    disabled={loading || saving || disconnecting}
                  />
                  <Button
                    id="tacticalrmm-toggle-password-visibility"
                    type="button"
                    variant="outline"
                    onClick={() => setShowPassword((s) => !s)}
                    disabled={loading || saving || disconnecting}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {totpRequired && (
                <div className="space-y-2">
                  <Label htmlFor="tacticalrmm-totp">{t('integrations.rmm.tactical.auth.totp', { defaultValue: 'TOTP code' })}</Label>
                  <Input
                    id="tacticalrmm-totp"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    disabled={testing || disconnecting}
                  />
                </div>
              )}

              {credentialsStatus?.hasKnoxToken && (
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.tactical.auth.knoxTokenSaved', { defaultValue: 'Knox token saved: {{value}}', value: credentialsStatus.knoxTokenMasked })}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              id="tacticalrmm-save-config"
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving || loading || disconnecting}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving
                ? t('integrations.rmm.tactical.actions.saving', { defaultValue: 'Saving...' })
                : t('integrations.rmm.tactical.actions.save', { defaultValue: 'Save' })}
            </Button>

            <Button
              id="tacticalrmm-test-connection"
              type="button"
              variant="secondary"
              onClick={handleTestConnection}
              disabled={testing || loading || disconnecting || (totpRequired && !totpCode.trim())}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${testing ? 'animate-spin' : ''}`} />
              {testing
                ? t('integrations.rmm.tactical.actions.testing', { defaultValue: 'Testing...' })
                : t('integrations.rmm.tactical.actions.testConnection', { defaultValue: 'Test Connection' })}
            </Button>

            <Button
              id="tacticalrmm-disconnect"
              type="button"
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting || loading}
            >
              <Unlink className="h-4 w-4 mr-2" />
              {disconnecting
                ? t('integrations.rmm.tactical.actions.disconnecting', { defaultValue: 'Disconnecting...' })
                : t('integrations.rmm.tactical.actions.disconnect', { defaultValue: 'Disconnect' })}
            </Button>
          </div>

          {!loading && credentialsStatus && (
            <div className="text-xs text-muted-foreground">
              {credentialsStatus.hasApiKey || credentialsStatus.hasKnoxCredentials
                ? t('integrations.rmm.tactical.statusLine.configured', { defaultValue: 'Status: Configured' })
                : t('integrations.rmm.tactical.statusLine.notConfigured', { defaultValue: 'Status: Not configured' })}
            </div>
          )}

          {loading && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t('integrations.rmm.tactical.loadingSettings', { defaultValue: 'Loading Tactical RMM settings...' })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default TacticalRmmIntegrationSettings;
