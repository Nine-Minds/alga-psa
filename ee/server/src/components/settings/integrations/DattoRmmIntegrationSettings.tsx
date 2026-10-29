'use client';

import { rmmMappingErrorMessage } from '@alga-psa/integrations/components/settings/integrations/rmmMappingErrors';
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { buildRmmPeopleModeOptions, RmmUserContactMappingPanel } from '@alga-psa/integrations/components/settings/integrations/RmmUserContactMappingPanel';
import { RmmOrganizationClientChangeDialog } from '@alga-psa/integrations/components/settings/integrations/RmmOrganizationClientChangeDialog';
import { RmmOrganizationBillingProfileSelect } from '@alga-psa/integrations/components/settings/integrations/RmmOrganizationBillingProfileSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Badge } from '@alga-psa/ui/components/Badge';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Eye, EyeOff, KeyRound, Lightbulb, Plus, RefreshCw, Save, Unlink } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useQuickAddClient } from '@alga-psa/ui/context';
import {
  backfillDattoRmmAlerts,
  createClientsForDattoRmmSites,
  disconnectDattoRmmIntegration,
  getDattoRmmConnectionSummary,
  getDattoRmmSettings,
  getDattoRmmWebhookInfo,
  ingestDattoRmmSoftwareInventory,
  listDattoRmmComponents,
  listDattoRmmSiteMappings,
  regenerateDattoRmmWebhookSecret,
  saveDattoRmmConfiguration,
  syncDattoRmmDevices,
  syncDattoRmmSites,
  testDattoRmmConnection,
  updateDattoRmmSiteMapping,
} from '../../../lib/actions/integrations/dattoRmmActions';
import { getRmmIntegrationIdByProvider } from '@alga-psa/integrations/actions';
import { DATTO_RMM_PLATFORMS, dattoPlatformApiUrl, type DattoRmmPlatform } from '../../../lib/integrations/datto/shared';
import { RmmAlertAutomationSettings } from '@alga-psa/integrations/components/settings/integrations/RmmAlertAutomationSettings';
import { RmmDeviceSyncSettings } from '@alga-psa/integrations/components/settings/integrations/RmmDeviceSyncSettings';
import type { IClient, IContact, ColumnDefinition } from '@alga-psa/types';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type PlatformChoice = DattoRmmPlatform | 'custom';

// Names, not words: platform regions are Datto's own labels and are not translated.
function platformLabel(platform: DattoRmmPlatform): string {
  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)} (${platform}-api.centrastage.net)`;
}

function getActionFailureMessage(result: { error?: string } | null | undefined, fallback: string): string {
  return result?.error || fallback;
}

export function DattoRmmIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = React.useState(false);
  const [regeneratingSecret, setRegeneratingSecret] = React.useState(false);
  const [confirmRegenerateSecretOpen, setConfirmRegenerateSecretOpen] = React.useState(false);
  const [syncingSites, setSyncingSites] = React.useState(false);
  const [syncingDevices, setSyncingDevices] = React.useState(false);
  const [backfillingAlerts, setBackfillingAlerts] = React.useState(false);
  const [ingestingSoftware, setIngestingSoftware] = React.useState(false);
  const [savingOptions, setSavingOptions] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [platform, setPlatform] = React.useState<PlatformChoice>('merlot');
  const [customUrl, setCustomUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [apiSecret, setApiSecret] = React.useState('');
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [showApiSecret, setShowApiSecret] = React.useState(false);

  // What is stored, as opposed to what is typed in the form: the option
  // toggles below save against the stored connection, never against an
  // unsaved edit to the platform or credentials.
  const [saved, setSaved] = React.useState<{ platform: PlatformChoice; instanceUrl: string } | null>(null);
  const [resolveOnClose, setResolveOnClose] = React.useState(false);
  const [softwareOnSync, setSoftwareOnSync] = React.useState(false);
  const [autoCreateClients, setAutoCreateClients] = React.useState(false);
  // 'all' while the bulk run is going, otherwise the mapping being provisioned.
  const [creatingClientsFor, setCreatingClientsFor] = React.useState<string | null>(null);
  const [confirmCreateAllOpen, setConfirmCreateAllOpen] = React.useState(false);
  const [rebootComponentUid, setRebootComponentUid] = React.useState('');
  const [savedRebootComponentUid, setSavedRebootComponentUid] = React.useState('');

  const [credentialsStatus, setCredentialsStatus] = React.useState<{
    hasApiKey: boolean;
    hasApiSecret: boolean;
    apiKeyMasked?: string;
  } | null>(null);

  const [connectionSummary, setConnectionSummary] = React.useState<Awaited<ReturnType<typeof getDattoRmmConnectionSummary>>['summary'] | null>(null);
  const [siteMappings, setSiteMappings] = React.useState<NonNullable<Awaited<ReturnType<typeof listDattoRmmSiteMappings>>['mappings']>>([]);
  const [clients, setClients] = React.useState<IClient[]>([]);
  const [contacts, setContacts] = React.useState<IContact[]>([]);
  const { renderQuickAddContact } = useQuickAddClient();
  const [quickAddContactFor, setQuickAddContactFor] = React.useState<{ mappingId: string; clientId: string } | null>(null);
  const [clientsLoading, setClientsLoading] = React.useState(false);
  const [clientFilterState, setClientFilterState] = React.useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = React.useState<'all' | 'company' | 'individual'>('all');
  const [webhookInfo, setWebhookInfo] = React.useState<Awaited<ReturnType<typeof getDattoRmmWebhookInfo>>['webhook'] | null>(null);
  const [showWebhookSecret, setShowWebhookSecret] = React.useState(false);
  const [integrationId, setIntegrationId] = React.useState<string | null>(null);

  const [components, setComponents] = React.useState<Array<{ uid: string; name: string; description: string | null; categoryCode: string | null }> | null>(null);
  const [componentsError, setComponentsError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    // Does not touch error/success: handlers call load() after setting their
    // own message, and clear the previous one themselves when they start.
    setLoading(true);
    try {
      const [res, summaryRes, idRes] = await Promise.all([
        getDattoRmmSettings(),
        getDattoRmmConnectionSummary(),
        getRmmIntegrationIdByProvider({ provider: 'datto' }),
      ]);
      if (!res.success) {
        setError(getActionFailureMessage(res, t('integrations.rmm.datto.errors.loadSettings', { defaultValue: 'Failed to load Datto RMM settings' })));
        return;
      }

      const storedPlatform = res.config?.platform || 'merlot';
      setPlatform(storedPlatform);
      setCustomUrl(storedPlatform === 'custom' ? res.config?.instanceUrl || '' : '');
      setSaved(res.config?.instanceUrl ? { platform: storedPlatform, instanceUrl: res.config.instanceUrl } : null);
      setResolveOnClose(Boolean(res.config?.resolveAlertsOnTicketClose));
      setSoftwareOnSync(Boolean(res.config?.softwareIngestOnSync));
      setAutoCreateClients(Boolean(res.config?.autoCreateClientsForNewSites));
      setRebootComponentUid(res.config?.rebootComponentUid || '');
      setSavedRebootComponentUid(res.config?.rebootComponentUid || '');
      setCredentialsStatus(res.credentials || null);
      setConnectionSummary(summaryRes.success ? (summaryRes.summary || null) : null);
      if (idRes.success && idRes.data?.integrationId) setIntegrationId(idRes.data.integrationId);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadSiteMappings = React.useCallback(async () => {
    const res = await listDattoRmmSiteMappings();
    if (!res.success) {
      setError(getActionFailureMessage(res, t('integrations.rmm.datto.errors.loadSiteMappings', { defaultValue: 'Failed to load site mappings' })));
      return;
    }
    setSiteMappings(res.mappings || []);
  }, [t]);

  const loadWebhookInfo = React.useCallback(async () => {
    const res = await getDattoRmmWebhookInfo();
    if (!res.success) return;
    setWebhookInfo(res.webhook || null);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    void loadSiteMappings();
  }, [loadSiteMappings]);

  React.useEffect(() => {
    void loadWebhookInfo();
  }, [loadWebhookInfo]);

  const loadClientsAndContacts = React.useCallback(async () => {
    setClientsLoading(true);
    try {
      const [clientsData, contactsData] = await Promise.all([
        getAllClients(true),
        getAllContacts('active'),
      ]);
      setClients(clientsData as any);
      setContacts((contactsData as any) ?? []);
    } catch (e) {
      setClients([]);
      setContacts([]);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadClientsAndContacts();
  }, [loadClientsAndContacts]);

  // The component list needs an authenticated, permitted API user, so it is
  // only requested once the connection is live. A failure is not an error
  // state: the reboot component falls back to a free-text UID.
  const isConnected = Boolean(connectionSummary?.isActive);
  React.useEffect(() => {
    if (!isConnected) {
      setComponents(null);
      setComponentsError(null);
      return;
    }
    let mounted = true;
    void (async () => {
      const res = await listDattoRmmComponents();
      if (!mounted) return;
      if (res.success) {
        setComponents(res.components || []);
        setComponentsError(null);
      } else {
        setComponents(null);
        setComponentsError(res.error || null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isConnected]);

  const hasStoredCredentials = Boolean(credentialsStatus?.hasApiKey && credentialsStatus?.hasApiSecret);
  const enteredBothCredentials = apiKey.trim().length > 0 && apiSecret.trim().length > 0;
  // Changing the host means the stored key and secret must be typed in again
  // (the server enforces this too); a custom URL is compared as typed.
  const hostChanged = Boolean(saved) && (
    platform === 'custom'
      ? saved!.platform !== 'custom' || customUrl.trim() !== saved!.instanceUrl
      : dattoPlatformApiUrl(platform) !== saved!.instanceUrl
  );
  const canSave =
    (platform !== 'custom' || customUrl.trim().length > 0) &&
    (hostChanged ? enteredBothCredentials : hasStoredCredentials || enteredBothCredentials);
  // Option toggles save against stored credentials, which Disconnect removes.
  const optionsLocked = !saved || !hasStoredCredentials;
  const optionsLockedHint = !loading && saved && !hasStoredCredentials ? (
    <div className="text-xs text-muted-foreground">
      {t('integrations.rmm.datto.fields.optionsNeedCredentials', { defaultValue: 'Save the API key and secret first. These options are locked while no credentials are stored.' })}
    </div>
  ) : null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await saveDattoRmmConfiguration({
        platform,
        instanceUrl: platform === 'custom' ? customUrl : undefined,
        apiKey: apiKey.trim() ? apiKey : undefined,
        apiSecret: apiSecret.trim() ? apiSecret : undefined,
      });
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.saveConfig', { defaultValue: 'Failed to save Datto RMM configuration' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.saveFailedTitle', { defaultValue: 'Save failed' }), description: message, variant: 'destructive' });
        return;
      }

      setSuccess(t('integrations.rmm.datto.success.saved', { defaultValue: 'Datto RMM configuration saved. Run Test Connection to activate it.' }));
      toast({ title: t('integrations.rmm.datto.toasts.savedTitle', { defaultValue: 'Saved' }), description: t('integrations.rmm.datto.toasts.savedDescription', { defaultValue: 'Datto RMM configuration updated.' }) });

      // Clear sensitive fields after save; status will reflect what is stored.
      setApiKey('');
      setApiSecret('');
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
      const res = await testDattoRmmConnection();
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.connectionTest', { defaultValue: 'Connection test failed' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.connectionFailedTitle', { defaultValue: 'Connection failed' }), description: message, variant: 'destructive' });
        return;
      }

      const account = res.accountName || t('integrations.rmm.datto.success.unnamedAccount', { defaultValue: 'your account' });
      setSuccess(
        t('integrations.rmm.datto.success.connection', {
          defaultValue: 'Connection successful. Account: {{account}}. Sites: {{sites}}, Devices: {{devices}}.',
          account,
          sites: res.siteCount ?? '-',
          devices: res.deviceCount ?? '-',
        })
      );
      toast({ title: t('integrations.rmm.datto.toasts.connectedTitle', { defaultValue: 'Connected' }), description: t('integrations.rmm.datto.toasts.connectedDescription', { defaultValue: 'Datto RMM connection verified.' }) });
      await load();
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await disconnectDattoRmmIntegration();
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.disconnect', { defaultValue: 'Disconnect failed' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.disconnectFailedTitle', { defaultValue: 'Disconnect failed' }), description: message, variant: 'destructive' });
        return;
      }
      setSuccess(t('integrations.rmm.datto.success.disconnected', { defaultValue: 'Disconnected.' }));
      toast({ title: t('integrations.rmm.datto.toasts.disconnectedTitle', { defaultValue: 'Disconnected' }), description: t('integrations.rmm.datto.toasts.disconnectedDescription', { defaultValue: 'Datto RMM credentials cleared. Site mappings were kept.' }) });
      setApiKey('');
      setApiSecret('');
      await load();
      // Disconnect removed the webhook secret; drop the old one and show the fresh one.
      setWebhookInfo(null);
      await loadWebhookInfo();
    } finally {
      setDisconnecting(false);
      setConfirmDisconnectOpen(false);
    }
  };

  const handleRegenerateWebhookSecret = async () => {
    setRegeneratingSecret(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await regenerateDattoRmmWebhookSecret();
      if (!res.success || !res.webhook) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.regenerateWebhookSecret', { defaultValue: 'Could not regenerate the webhook secret' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.errors.regenerateWebhookSecret', { defaultValue: 'Could not regenerate the webhook secret' }), description: message, variant: 'destructive' });
        return;
      }
      setWebhookInfo(res.webhook);
      toast({
        title: t('integrations.rmm.datto.toasts.webhookSecretRegeneratedTitle', { defaultValue: 'Webhook secret regenerated' }),
        description: t('integrations.rmm.datto.toasts.webhookSecretRegeneratedDescription', { defaultValue: 'Update the header value in your Datto webhook responses.' }),
      });
    } finally {
      setRegeneratingSecret(false);
      setConfirmRegenerateSecretOpen(false);
    }
  };

  const handleSyncSites = async () => {
    setSyncingSites(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await syncDattoRmmSites();
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.syncSites', { defaultValue: 'Site sync failed' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.syncFailedTitle', { defaultValue: 'Sync failed' }), description: message, variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.datto.success.siteSyncCompleted', { defaultValue: 'Site sync completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.datto.errors.someSitesFailed', { defaultValue: 'Some sites failed to sync: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({
        title: t('integrations.rmm.datto.toasts.sitesSyncedTitle', { defaultValue: 'Sites synced' }),
        description: res.auto_clients
          ? t('integrations.rmm.datto.toasts.sitesSyncedWithClients', {
              defaultValue: 'Datto sites have been synced. New sites: {{created}} clients created, {{linked}} linked, {{failed}} failed.',
              created: res.auto_clients.created,
              linked: res.auto_clients.linked,
              failed: res.auto_clients.failed,
            })
          : t('integrations.rmm.datto.toasts.sitesSyncedDescription', { defaultValue: 'Datto sites have been synced into site mappings.' }),
      });
      await Promise.all([load(), loadSiteMappings(), ...(res.auto_clients ? [loadClientsAndContacts()] : [])]);
    } finally {
      setSyncingSites(false);
    }
  };

  const handleSyncDevices = async () => {
    setSyncingDevices(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await syncDattoRmmDevices();
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.syncDevices', { defaultValue: 'Device sync failed' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.syncFailedTitle', { defaultValue: 'Sync failed' }), description: message, variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.datto.success.deviceSyncCompleted', { defaultValue: 'Device sync completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.datto.errors.someDevicesFailed', { defaultValue: 'Some devices failed to sync: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({ title: t('integrations.rmm.datto.toasts.devicesSyncedTitle', { defaultValue: 'Devices synced' }), description: t('integrations.rmm.datto.toasts.devicesSyncedDescription', { defaultValue: 'Datto devices have been synced into assets.' }) });
      await load();
    } finally {
      setSyncingDevices(false);
    }
  };

  const handleUpdateMapping = async (mappingId: string, patch: { clientId?: string | null; defaultContactId?: string | null; autoSyncAssets?: boolean; contactAssignmentMode?: string; billingProfileId?: string | null }) => {
    setError(null);
    const res = await updateDattoRmmSiteMapping(mappingId, {
      clientId: patch.clientId,
      defaultContactId: patch.defaultContactId,
      autoSyncAssets: patch.autoSyncAssets,
      contactAssignmentMode: patch.contactAssignmentMode,
      billingProfileId: patch.billingProfileId,
    });
    if (!res.success) {
      const message = rmmMappingErrorMessage(
        t,
        res.error,
        t('integrations.rmm.datto.errors.updateMapping', { defaultValue: 'Failed to update mapping' }),
      );
      setError(message);
      toast({ title: t('integrations.rmm.datto.toasts.updateFailedTitle', { defaultValue: 'Update failed' }), description: message, variant: 'destructive' });
      return;
    }
    await loadSiteMappings();
  };

  const siteFlags = (m: (typeof siteMappings)[number]) => {
    const metadata = (m.metadata ?? {}) as Record<string, unknown>;
    return { missing: metadata.missing_in_datto === true, onDemand: metadata.on_demand === true };
  };

  // Sites the bulk "Create clients" would act on; mirrors the server's filter.
  const provisionableSites = siteMappings.filter((m) => {
    if (m.client_id) return false;
    const flags = siteFlags(m);
    return !flags.onDemand && !flags.missing;
  });

  // Signed-in users for one site at a time: each panel loads its own data, so
  // mounting one per mapped site does N requests on every page view.
  const mappedSites = siteMappings.filter((m) => m.client_id);
  const [signedInSiteId, setSignedInSiteId] = React.useState<string>('');
  const signedInSite = mappedSites.find((m) => m.mapping_id === signedInSiteId) ?? null;

  const handleCreateClients = async (mappingIds?: string[]) => {
    setCreatingClientsFor(mappingIds?.length === 1 ? mappingIds[0]! : 'all');
    setError(null);
    setSuccess(null);
    try {
      const res = await createClientsForDattoRmmSites(mappingIds);
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.createClients', { defaultValue: 'Failed to create clients for Datto sites' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.createClientsFailedTitle', { defaultValue: 'Client creation failed' }), description: message, variant: 'destructive' });
        return;
      }
      setSuccess(t('integrations.rmm.datto.success.clientsCreated', {
        defaultValue: 'Created {{created}} clients and linked {{linked}} existing clients. Skipped: {{skipped}}, Failed: {{failed}}',
        created: res.created,
        linked: res.linked,
        skipped: res.skipped,
        failed: res.failed,
      }));
      const problems = res.results.filter((r) => r.outcome === 'failed' || (mappingIds?.length && r.outcome === 'skipped'));
      if (problems.length) {
        setError(t('integrations.rmm.datto.errors.someClientsFailed', {
          defaultValue: 'Some sites were not mapped: {{errors}}',
          errors: problems.slice(0, 3).map((r) => `${r.siteName || r.siteUid}: ${r.reason ?? r.outcome}`).join('; '),
        }));
      }
      await Promise.all([loadSiteMappings(), loadClientsAndContacts()]);
    } finally {
      setCreatingClientsFor(null);
    }
  };

  const peopleModeOptions = buildRmmPeopleModeOptions(t);

  // Re-pointing a site moves its devices, so confirm first.
  const [pendingClientChange, setPendingClientChange] = React.useState<{ mappingId: string; clientId: string | null } | null>(null);

  const handleClientChange = (mappingId: string, clientId: string | null) => {
    const current = siteMappings.find((m) => m.mapping_id === mappingId);
    if (clientId && current?.client_id && current.client_id !== clientId) {
      setPendingClientChange({ mappingId, clientId });
      return;
    }
    void handleUpdateMapping(mappingId, { clientId, defaultContactId: null });
  };

  const handleDefaultContactChange = (mappingId: string, contactId: string) =>
    handleUpdateMapping(mappingId, { defaultContactId: contactId || null });

  const handleBackfillAlerts = async () => {
    setBackfillingAlerts(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await backfillDattoRmmAlerts();
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.backfillAlerts', { defaultValue: 'Alert backfill failed' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.backfillFailedTitle', { defaultValue: 'Backfill failed' }), description: message, variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.datto.success.alertBackfillCompleted', { defaultValue: 'Alert backfill completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.datto.errors.someAlertsFailed', { defaultValue: 'Some alerts failed to upsert: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({ title: t('integrations.rmm.datto.toasts.alertsSyncedTitle', { defaultValue: 'Alerts synced' }), description: t('integrations.rmm.datto.toasts.alertsSyncedDescription', { defaultValue: 'Open Datto alerts have been backfilled.' }) });
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
      const res = await ingestDattoRmmSoftwareInventory({ force: true });
      if (!res.success) {
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.ingestSoftware', { defaultValue: 'Software ingestion failed' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.ingestionFailedTitle', { defaultValue: 'Ingestion failed' }), description: message, variant: 'destructive' });
        return;
      }
      setSuccess(
        t('integrations.rmm.datto.success.softwareIngestionCompleted', { defaultValue: 'Software ingestion completed. Processed: {{processed}}, Installed/Updated: {{created}}, Assets Updated: {{updated}}, Failed: {{failed}}', processed: res.items_processed, created: res.items_created, updated: res.items_updated, failed: res.items_failed })
      );
      if (res.errors?.length) {
        setError(t('integrations.rmm.datto.errors.someSoftwareFailed', { defaultValue: 'Some devices failed to ingest software: {{errors}}', errors: res.errors.slice(0, 3).join('; ') }));
      }
      toast({ title: t('integrations.rmm.datto.toasts.softwareIngestedTitle', { defaultValue: 'Software ingested' }), description: t('integrations.rmm.datto.toasts.softwareIngestedDescription', { defaultValue: 'Datto software inventory has been ingested.' }) });
      await load();
    } finally {
      setIngestingSoftware(false);
    }
  };

  // Option toggles persist against the stored connection (see `saved`).
  const handleSaveOptions = async (
    options: { resolveAlertsOnTicketClose?: boolean; softwareIngestOnSync?: boolean; autoCreateClientsForNewSites?: boolean; rebootComponentUid?: string | null },
    onFailure: () => void
  ) => {
    if (!saved || !hasStoredCredentials) return;
    setSavingOptions(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await saveDattoRmmConfiguration({
        platform: saved.platform,
        instanceUrl: saved.platform === 'custom' ? saved.instanceUrl : undefined,
        ...options,
      });
      if (!res.success) {
        onFailure();
        const message = getActionFailureMessage(res, t('integrations.rmm.datto.errors.saveConfig', { defaultValue: 'Failed to save Datto RMM configuration' }));
        setError(message);
        toast({ title: t('integrations.rmm.datto.toasts.saveFailedTitle', { defaultValue: 'Save failed' }), description: message, variant: 'destructive' });
        return;
      }
      toast({ title: t('integrations.rmm.datto.toasts.savedTitle', { defaultValue: 'Saved' }), description: t('integrations.rmm.datto.toasts.optionsSavedDescription', { defaultValue: 'Datto RMM options updated.' }) });
      if (typeof options.rebootComponentUid !== 'undefined') setSavedRebootComponentUid(options.rebootComponentUid || '');
    } finally {
      setSavingOptions(false);
    }
  };

  const siteMappingColumns: ColumnDefinition<(typeof siteMappings)[number]>[] = [
    {
      title: t('integrations.rmm.datto.mappings.site', { defaultValue: 'Datto Site' }),
      dataIndex: 'external_organization_name',
      render: (_v, m) => (
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {m.external_organization_name || m.external_organization_id}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {t('integrations.rmm.datto.dattoIdLabel', { defaultValue: 'Datto ID: {{id}}', id: m.external_organization_id })}
          </div>
          {/* Device sync skips both; say so instead of letting the row look normal. */}
          {(siteFlags(m).missing || siteFlags(m).onDemand) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {siteFlags(m).missing && (
                <Badge variant="warning" size="sm">
                  {t('integrations.rmm.datto.mappings.missingBadge', { defaultValue: 'Not in Datto' })}
                </Badge>
              )}
              {siteFlags(m).onDemand && (
                <Badge variant="default-muted" size="sm">
                  {t('integrations.rmm.datto.mappings.onDemandBadge', { defaultValue: 'On-demand' })}
                </Badge>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('integrations.rmm.datto.mappings.client', { defaultValue: 'Alga Client' }),
      dataIndex: 'client_id',
      sortable: false,
      render: (_v, m) => (
        <div className="space-y-1">
          <ClientPicker
            id={`datto-rmm-site-client-picker-${m.mapping_id}`}
            clients={clients}
            selectedClientId={m.client_id || null}
            onSelect={(clientId) => handleClientChange(m.mapping_id, clientId)}
            filterState={clientFilterState}
            onFilterStateChange={setClientFilterState}
            clientTypeFilter={clientTypeFilter}
            onClientTypeFilterChange={setClientTypeFilter}
            placeholder={clientsLoading
              ? t('integrations.rmm.datto.client.loading', { defaultValue: 'Loading clients…' })
              : t('integrations.rmm.datto.client.select', { defaultValue: 'Select client' })}
            fitContent
            triggerVariant="outline"
            triggerSize="sm"
            className="min-w-[220px]"
          />
          {/* A suggestion is never applied on its own; the admin confirms it. */}
          {!m.client_id && m.suggested_client_id && (
            <Button
              id={`datto-rmm-site-suggestion-${m.mapping_id}`}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => handleClientChange(m.mapping_id, m.suggested_client_id)}
            >
              <Lightbulb className="h-3 w-3 mr-1" />
              {t('integrations.rmm.datto.client.suggested', {
                defaultValue: 'Suggested: {{client}}',
                client: m.suggested_client_name || m.suggested_client_id,
              })}
            </Button>
          )}
          {/* Or make one named after the site (links instead if that name exists). */}
          {!m.client_id && (
            <Button
              id={`datto-rmm-site-create-client-${m.mapping_id}`}
              type="button"
              variant="outline"
              size="xs"
              disabled={creatingClientsFor !== null || busy}
              onClick={() => void handleCreateClients([m.mapping_id])}
            >
              <Plus className="h-3 w-3 mr-1" />
              {creatingClientsFor === m.mapping_id
                ? t('integrations.rmm.datto.client.creating', { defaultValue: 'Creating…' })
                : t('integrations.rmm.datto.client.create', {
                    defaultValue: 'Create client "{{name}}"',
                    name: m.external_organization_name || m.external_organization_id,
                  })}
            </Button>
          )}
        </div>
      ),
    },
    {
      title: t('integrations.rmm.datto.mappings.defaultContact', { defaultValue: 'Default Contact' }),
      dataIndex: 'default_contact_id',
      sortable: false,
      render: (_v, m) => (
        <ContactPicker
          id={`datto-rmm-default-contact-${m.mapping_id}`}
          contacts={contacts}
          value={m.default_contact_id ?? ''}
          onValueChange={(contactId) => handleDefaultContactChange(m.mapping_id, contactId)}
          clientId={m.client_id ?? undefined}
          disabled={!m.client_id}
          buttonWidth="fit"
          placeholder={t('integrations.rmm.datto.contact.select', { defaultValue: 'Select contact' })}
          className="min-w-[220px]"
          onAddNew={m.client_id ? () => setQuickAddContactFor({ mappingId: m.mapping_id, clientId: m.client_id! }) : undefined}
        />
      ),
    },
    {
      // What sync does with the device's signed-in user.
      title: t('integrations.rmm.peopleMode.label', { defaultValue: 'People' }),
      dataIndex: 'contact_assignment_mode',
      sortable: false,
      render: (_v, m) => (
        <CustomSelect
          id={`rmm-org-people-mode-${m.mapping_id}`}
          value={m.contact_assignment_mode ?? 'suggest'}
          onValueChange={(mode) => handleUpdateMapping(m.mapping_id, { contactAssignmentMode: mode })}
          options={peopleModeOptions}
          className="min-w-[160px]"
        />
      ),
    },
    {
      // Which profile this site's alert tickets bill to.
      title: t('integrations.rmm.billingProfile.label', { defaultValue: 'Billing profile' }),
      dataIndex: 'billing_profile_id',
      sortable: false,
      render: (_v, m) => (
        <RmmOrganizationBillingProfileSelect
          mappingId={m.mapping_id}
          clientId={m.client_id}
          value={m.billing_profile_id}
          onChange={(billingProfileId) => handleUpdateMapping(m.mapping_id, { billingProfileId })}
        />
      ),
    },
    {
      title: t('integrations.rmm.datto.autoSync', { defaultValue: 'Auto-sync' }),
      dataIndex: 'auto_sync_assets',
      sortable: false,
      render: (_v, m) => (
        <Switch
          id={`datto-rmm-site-autosync-${m.mapping_id}`}
          checked={Boolean(m.auto_sync_assets)}
          disabled={siteFlags(m).missing}
          onCheckedChange={(checked) => handleUpdateMapping(m.mapping_id, { autoSyncAssets: checked })}
        />
      ),
    },
  ];

  const platformOptions = [
    ...DATTO_RMM_PLATFORMS.map((p) => ({ value: p, label: platformLabel(p) })),
    { value: 'custom', label: t('integrations.rmm.datto.platform.custom', { defaultValue: 'Custom URL' }) },
  ];

  const busy = loading || saving || testing || disconnecting;

  const copyToClipboard = async (value: string, description: string) => {
    await navigator.clipboard.writeText(value);
    toast({ title: t('integrations.rmm.datto.webhook.copiedTitle', { defaultValue: 'Copied' }), description });
  };

  return (
    <>
    <RmmOrganizationClientChangeDialog
      mappingId={pendingClientChange?.mappingId ?? null}
      pendingClientName={clients.find((c) => c.client_id === pendingClientChange?.clientId)?.client_name ?? null}
      isOpen={Boolean(pendingClientChange)}
      onCancel={() => setPendingClientChange(null)}
      onConfirm={() => {
        const pending = pendingClientChange;
        setPendingClientChange(null);
        if (pending) void handleUpdateMapping(pending.mappingId, { clientId: pending.clientId, defaultContactId: null });
      }}
    />
    <ConfirmationDialog
      id="datto-rmm-create-clients-confirm"
      isOpen={confirmCreateAllOpen}
      onClose={() => setConfirmCreateAllOpen(false)}
      onConfirm={() => {
        setConfirmCreateAllOpen(false);
        void handleCreateClients();
      }}
      isConfirming={creatingClientsFor === 'all'}
      title={t('integrations.rmm.datto.createClientsConfirm.title', { defaultValue: 'Create clients for unmapped sites?' })}
      message={t('integrations.rmm.datto.createClientsConfirm.message', {
        defaultValue: 'Each of the {{count}} unmapped sites gets an Alga client named after it and is mapped to it. A site whose name matches an existing client is linked to that client instead. On-demand sites and sites no longer in Datto are left alone.',
        count: provisionableSites.length,
      })}
      confirmLabel={t('integrations.rmm.datto.actions.createClients', { defaultValue: 'Create clients' })}
      cancelLabel={t('common:actions.cancel', { defaultValue: 'Cancel' })}
    />
    <ConfirmationDialog
      id="datto-rmm-regenerate-webhook-secret-confirm"
      isOpen={confirmRegenerateSecretOpen}
      onClose={() => setConfirmRegenerateSecretOpen(false)}
      onConfirm={handleRegenerateWebhookSecret}
      isConfirming={regeneratingSecret}
      title={t('integrations.rmm.datto.regenerateSecretConfirm.title', { defaultValue: 'Regenerate the webhook secret?' })}
      message={t('integrations.rmm.datto.regenerateSecretConfirm.message', {
        defaultValue: 'The current secret stops working immediately. Webhook alerts are rejected until every Datto webhook response sends the new header value. Polling is not affected.',
      })}
      confirmLabel={t('integrations.rmm.datto.actions.regenerateSecret', { defaultValue: 'Regenerate secret' })}
      cancelLabel={t('common:actions.cancel', { defaultValue: 'Cancel' })}
    />
    <ConfirmationDialog
      id="datto-rmm-disconnect-confirm"
      isOpen={confirmDisconnectOpen}
      onClose={() => setConfirmDisconnectOpen(false)}
      onConfirm={handleDisconnect}
      isConfirming={disconnecting}
      title={t('integrations.rmm.datto.disconnectConfirm.title', { defaultValue: 'Disconnect Datto RMM?' })}
      message={t('integrations.rmm.datto.disconnectConfirm.message', {
        defaultValue: 'The stored API key and secret are removed, the webhook secret is reset, and scheduled syncs stop. Site mappings and synced assets are kept.',
      })}
      confirmLabel={t('integrations.rmm.datto.actions.disconnect', { defaultValue: 'Disconnect' })}
      cancelLabel={t('common:actions.cancel', { defaultValue: 'Cancel' })}
    />
    <Card id="datto-rmm-integration-settings-card">
      <CardHeader>
        <CardTitle>{t('integrations.rmm.datto.title', { defaultValue: 'Datto RMM' })}</CardTitle>
        <CardDescription>
          {t('integrations.rmm.datto.description', { defaultValue: 'Connect Datto RMM to sync sites and devices, ingest alerts, and open Web Remote from assets.' })}
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
                    ? t('integrations.rmm.datto.status.connected', { defaultValue: 'Connected' })
                    : t('integrations.rmm.datto.status.disconnected', { defaultValue: 'Disconnected' })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {connectionSummary?.instanceUrl ? connectionSummary.instanceUrl : t('integrations.rmm.datto.status.instanceUrlNotSet', { defaultValue: 'API URL not set' })}
                </div>
              </div>
              <Button
                id="datto-rmm-refresh-status"
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  void load();
                }}
                disabled={busy}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                {t('integrations.rmm.datto.actions.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </div>

            {connectionSummary && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.datto.counts.mappedSites', { defaultValue: 'Mapped Sites' })}</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.mappedSites}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.datto.counts.syncedDevices', { defaultValue: 'Synced Devices' })}</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.syncedDevices}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.datto.counts.activeAlerts', { defaultValue: 'Active Alerts' })}</div>
                  <div className="text-sm font-semibold">{connectionSummary.counts.activeAlerts}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="text-muted-foreground">{t('integrations.rmm.datto.counts.lastSync', { defaultValue: 'Last Sync' })}</div>
                  <div className="text-sm font-semibold">
                    {connectionSummary.lastSyncAt ? new Date(connectionSummary.lastSyncAt).toLocaleString() : t('integrations.rmm.datto.counts.never', { defaultValue: 'Never' })}
                  </div>
                </div>
              </div>
            )}

            {connectionSummary?.syncError && (
              <div className="mt-3 text-xs text-destructive">
                {t('integrations.rmm.datto.lastError', { defaultValue: 'Last error: {{error}}', error: connectionSummary.syncError })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="datto-rmm-platform">{t('integrations.rmm.datto.fields.platform', { defaultValue: 'Platform' })}</Label>
            <CustomSelect
              id="datto-rmm-platform"
              className="!w-auto"
              value={platform}
              onValueChange={(v) => {
                setPlatform(v as PlatformChoice);
                setError(null);
                setSuccess(null);
              }}
              options={platformOptions}
              disabled={busy}
            />
            <div className="text-xs text-muted-foreground">
              {t('integrations.rmm.datto.fields.platformHelp', { defaultValue: 'Pick the region in the address you use to sign in to Datto RMM (for example https://merlot.rmm.datto.com is Merlot).' })}
            </div>
          </div>

          {platform === 'custom' && (
            <div className="space-y-2">
              <Label htmlFor="datto-rmm-instance-url">{t('integrations.rmm.datto.fields.instanceUrl', { defaultValue: 'API URL' })}</Label>
              <Input
                id="datto-rmm-instance-url"
                placeholder="https://merlot-api.centrastage.net"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                disabled={busy}
              />
              <div className="text-xs text-muted-foreground">
                {t('integrations.rmm.datto.fields.instanceUrlHelp', { defaultValue: 'The Datto API host, e.g. https://merlot-api.centrastage.net. A trailing /api is added automatically.' })}
              </div>
            </div>
          )}

          <Alert variant="info">
            <AlertDescription className="text-xs">
              {t('integrations.rmm.datto.fields.apiUserNote', { defaultValue: 'Create a dedicated Datto API user for Alga. Open that user in Datto RMM to generate its API key and secret, and give its security level read access to the account, sites, devices, alerts, and audit data.' })}
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="datto-rmm-api-key">{t('integrations.rmm.datto.auth.apiKey', { defaultValue: 'API key' })}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="datto-rmm-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={credentialsStatus?.apiKeyMasked ? credentialsStatus.apiKeyMasked : t('integrations.rmm.datto.auth.enterApiKey', { defaultValue: 'Enter API key' })}
                autoComplete="off"
                disabled={busy}
              />
              <Button
                id="datto-rmm-toggle-api-key-visibility"
                type="button"
                variant="outline"
                onClick={() => setShowApiKey((s) => !s)}
                disabled={busy}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {credentialsStatus?.hasApiKey && (
              <div className="text-xs text-muted-foreground">
                {t('integrations.rmm.datto.auth.saved', { defaultValue: 'Saved: {{value}}', value: credentialsStatus.apiKeyMasked })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="datto-rmm-api-secret">{t('integrations.rmm.datto.auth.apiSecret', { defaultValue: 'API secret' })}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="datto-rmm-api-secret"
                type={showApiSecret ? 'text' : 'password'}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder={credentialsStatus?.hasApiSecret
                  ? t('integrations.rmm.datto.auth.savedEnterToUpdate', { defaultValue: 'Saved (enter to update)' })
                  : t('integrations.rmm.datto.auth.enterApiSecret', { defaultValue: 'Enter API secret' })}
                autoComplete="off"
                disabled={busy}
              />
              <Button
                id="datto-rmm-toggle-api-secret-visibility"
                type="button"
                variant="outline"
                onClick={() => setShowApiSecret((s) => !s)}
                disabled={busy}
              >
                {showApiSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {hostChanged && !enteredBothCredentials && (
              <div id="datto-rmm-host-changed-hint" className="text-xs text-muted-foreground">
                {t('integrations.rmm.datto.fields.hostChangedHint', { defaultValue: 'The platform or API URL changed. Enter the API key and API secret again to save.' })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              id="datto-rmm-save-config"
              type="button"
              onClick={handleSave}
              disabled={!canSave || busy}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving
                ? t('integrations.rmm.datto.actions.saving', { defaultValue: 'Saving...' })
                : t('integrations.rmm.datto.actions.save', { defaultValue: 'Save' })}
            </Button>

            <Button
              id="datto-rmm-test-connection"
              type="button"
              variant="secondary"
              onClick={handleTestConnection}
              disabled={busy || !hasStoredCredentials}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${testing ? 'animate-spin' : ''}`} />
              {testing
                ? t('integrations.rmm.datto.actions.testing', { defaultValue: 'Testing...' })
                : t('integrations.rmm.datto.actions.testConnection', { defaultValue: 'Test Connection' })}
            </Button>

            <Button
              id="datto-rmm-disconnect"
              type="button"
              variant="destructive"
              onClick={() => setConfirmDisconnectOpen(true)}
              disabled={disconnecting || loading}
            >
              <Unlink className="h-4 w-4 mr-2" />
              {disconnecting
                ? t('integrations.rmm.datto.actions.disconnecting', { defaultValue: 'Disconnecting...' })
                : t('integrations.rmm.datto.actions.disconnect', { defaultValue: 'Disconnect' })}
            </Button>
          </div>

          {!loading && credentialsStatus && (
            <div className="text-xs text-muted-foreground">
              {hasStoredCredentials
                ? t('integrations.rmm.datto.statusLine.configured', { defaultValue: 'Status: Configured' })
                : t('integrations.rmm.datto.statusLine.notConfigured', { defaultValue: 'Status: Not configured' })}
            </div>
          )}

          {loading && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t('integrations.rmm.datto.loadingSettings', { defaultValue: 'Loading Datto RMM settings...' })}
            </div>
          )}

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.datto.sections.sites', { defaultValue: 'Sites' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.sections.sitesDescription', { defaultValue: 'Sync Datto sites into Alga site mappings, then map them to Alga Clients.' })}
                </div>
              </div>
              <Button
                id="datto-rmm-sync-sites"
                type="button"
                onClick={handleSyncSites}
                disabled={syncingSites || busy || syncingDevices}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncingSites ? 'animate-spin' : ''}`} />
                {syncingSites
                  ? t('integrations.rmm.datto.actions.syncing', { defaultValue: 'Syncing...' })
                  : t('integrations.rmm.datto.actions.syncSites', { defaultValue: 'Sync Sites' })}
              </Button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 rounded border p-3">
              <div className="space-y-1">
                <Label htmlFor="datto-rmm-auto-create-clients">
                  {t('integrations.rmm.datto.fields.autoCreateClients', { defaultValue: 'Create clients for new sites automatically' })}
                </Label>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.fields.autoCreateClientsHelp', { defaultValue: 'Sites are refreshed before every scheduled device sync. When this is on, a site seen for the first time gets an Alga client named after it, or is linked to the client that already has that name. Existing unmapped sites and on-demand sites are left alone.' })}
                </div>
                {optionsLockedHint}
              </div>
              <Switch
                id="datto-rmm-auto-create-clients"
                checked={autoCreateClients}
                disabled={optionsLocked || savingOptions || busy}
                onCheckedChange={(checked) => {
                  setAutoCreateClients(checked);
                  void handleSaveOptions({ autoCreateClientsForNewSites: checked }, () => setAutoCreateClients(!checked));
                }}
              />
            </div>
          </div>

          <div className="rounded-md border bg-background p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.datto.sections.siteMapping', { defaultValue: 'Site Mapping' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.sections.siteMappingDescription', { defaultValue: 'Assign each Datto site to an Alga Client and control auto-sync per site. Suggestions come from the site name or its Autotask company name and are never applied automatically.' })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  id="datto-rmm-create-clients-for-unmapped"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmCreateAllOpen(true)}
                  disabled={!provisionableSites.length || creatingClientsFor !== null || busy || syncingSites || syncingDevices}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('integrations.rmm.datto.actions.createClientsForUnmapped', {
                    defaultValue: 'Create clients for unmapped ({{count}})',
                    count: provisionableSites.length,
                  })}
                </Button>
                <Button
                  id="datto-rmm-refresh-mappings"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={loadSiteMappings}
                  disabled={busy || syncingSites || syncingDevices}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('integrations.rmm.datto.actions.refresh', { defaultValue: 'Refresh' })}
                </Button>
              </div>
            </div>

            {siteMappings.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t('integrations.rmm.datto.sections.siteMappingEmpty', { defaultValue: 'No sites found. Run "Sync Sites" first.' })}
              </div>
            ) : (
              <DataTable
                id="datto-rmm-site-mappings"
                data={siteMappings}
                columns={siteMappingColumns}
                pagination
              />
            )}

            {mappedSites.length > 0 && (
              <div className="mt-4 border-t pt-4 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="datto-rmm-signed-in-site">
                    {t('integrations.rmm.datto.mappings.signedInUsersSite', { defaultValue: 'Signed-in users for site' })}
                  </Label>
                  <CustomSelect
                    id="datto-rmm-signed-in-site"
                    className="min-w-[280px] max-w-md"
                    value={signedInSiteId}
                    onValueChange={(id) => setSignedInSiteId(id)}
                    options={mappedSites.map((m) => ({
                      value: m.mapping_id,
                      label: m.external_organization_name || m.external_organization_id,
                    }))}
                    placeholder={t('integrations.rmm.datto.mappings.signedInUsersSelect', { defaultValue: 'Choose a mapped site' })}
                    allowClear
                  />
                </div>
                {signedInSite && (
                  <RmmUserContactMappingPanel
                    key={signedInSite.mapping_id}
                    mappingId={signedInSite.mapping_id}
                    clientId={signedInSite.client_id}
                    contacts={contacts}
                    idPrefix={`datto-rmm-signed-in-${signedInSite.mapping_id}`}
                  />
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border bg-background p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.datto.sections.devices', { defaultValue: 'Devices' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.sections.devicesDescription', { defaultValue: 'Sync Datto devices into Alga Assets for sites with auto-sync turned on.' })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  id="datto-rmm-sync-devices"
                  type="button"
                  onClick={handleSyncDevices}
                  disabled={syncingDevices || busy || backfillingAlerts || ingestingSoftware}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncingDevices ? 'animate-spin' : ''}`} />
                  {syncingDevices
                    ? t('integrations.rmm.datto.actions.syncing', { defaultValue: 'Syncing...' })
                    : t('integrations.rmm.datto.actions.syncDevices', { defaultValue: 'Sync Devices' })}
                </Button>
                <Button
                  id="datto-rmm-ingest-software"
                  type="button"
                  variant="secondary"
                  onClick={handleIngestSoftware}
                  disabled={ingestingSoftware || busy || syncingSites || syncingDevices || backfillingAlerts}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${ingestingSoftware ? 'animate-spin' : ''}`} />
                  {ingestingSoftware
                    ? t('integrations.rmm.datto.actions.ingesting', { defaultValue: 'Ingesting...' })
                    : t('integrations.rmm.datto.actions.ingestSoftware', { defaultValue: 'Ingest Software' })}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded border p-3">
              <div className="space-y-1">
                <Label htmlFor="datto-rmm-software-on-sync">
                  {t('integrations.rmm.datto.fields.softwareOnSync', { defaultValue: 'Ingest software during device sync' })}
                </Label>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.fields.softwareOnSyncHelp', { defaultValue: 'Reads each changed device’s software audit as part of the sync. This makes one extra API call per changed device, which can be slow on large accounts.' })}
                </div>
                {optionsLockedHint}
              </div>
              <Switch
                id="datto-rmm-software-on-sync"
                checked={softwareOnSync}
                disabled={optionsLocked || savingOptions || busy}
                onCheckedChange={(checked) => {
                  setSoftwareOnSync(checked);
                  void handleSaveOptions({ softwareIngestOnSync: checked }, () => setSoftwareOnSync(!checked));
                }}
              />
            </div>
          </div>

          <div className="rounded-md border bg-background p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.datto.sections.alerts', { defaultValue: 'Alerts' })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.sections.alertsDescription', { defaultValue: 'Alerts are polled on the schedule configured under Alert automation below. Use Sync Alerts to pull open alerts now.' })}
                </div>
              </div>
              <Button
                id="datto-rmm-backfill-alerts"
                type="button"
                variant="secondary"
                onClick={handleBackfillAlerts}
                disabled={backfillingAlerts || busy || syncingSites || syncingDevices || ingestingSoftware}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${backfillingAlerts ? 'animate-spin' : ''}`} />
                {backfillingAlerts
                  ? t('integrations.rmm.datto.actions.syncing', { defaultValue: 'Syncing...' })
                  : t('integrations.rmm.datto.actions.syncAlerts', { defaultValue: 'Sync Alerts' })}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded border p-3">
              <div className="space-y-1">
                <Label htmlFor="datto-rmm-resolve-on-close">
                  {t('integrations.rmm.datto.fields.resolveOnClose', { defaultValue: 'Resolve the Datto alert when its ticket closes' })}
                </Label>
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.fields.resolveOnCloseHelp', { defaultValue: 'Requires a Datto API user with write access to alerts. Leave off for a read-only API user.' })}
                </div>
                {optionsLockedHint}
              </div>
              <Switch
                id="datto-rmm-resolve-on-close"
                checked={resolveOnClose}
                disabled={optionsLocked || savingOptions || busy}
                onCheckedChange={(checked) => {
                  setResolveOnClose(checked);
                  void handleSaveOptions({ resolveAlertsOnTicketClose: checked }, () => setResolveOnClose(!checked));
                }}
              />
            </div>

            <div className="border-t pt-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t('integrations.rmm.datto.sections.webhooks', { defaultValue: 'Webhook (optional fast path)' })}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('integrations.rmm.datto.sections.webhooksDescription', { defaultValue: 'Polling is the guaranteed path. To get alerts in seconds, add a webhook response action to your Datto monitor policies using the URL, custom header, and body template below.' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    id="datto-rmm-regenerate-webhook-secret"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmRegenerateSecretOpen(true)}
                    disabled={busy || regeneratingSecret || !webhookInfo}
                  >
                    <KeyRound className="h-4 w-4 mr-2" />
                    {t('integrations.rmm.datto.actions.regenerateSecret', { defaultValue: 'Regenerate secret' })}
                  </Button>
                  <Button
                    id="datto-rmm-refresh-webhook-info"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadWebhookInfo}
                    disabled={busy}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('integrations.rmm.datto.actions.refresh', { defaultValue: 'Refresh' })}
                  </Button>
                </div>
              </div>

              {webhookInfo ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="datto-rmm-webhook-url">{t('integrations.rmm.datto.webhook.url', { defaultValue: 'Webhook URL' })}</Label>
                    <div className="flex items-center gap-2">
                      <Input id="datto-rmm-webhook-url" value={webhookInfo.url} readOnly />
                      <Button
                        id="datto-rmm-copy-webhook-url"
                        type="button"
                        variant="outline"
                        onClick={() => copyToClipboard(webhookInfo.url, t('integrations.rmm.datto.webhook.urlCopied', { defaultValue: 'Webhook URL copied to clipboard.' }))}
                      >
                        {t('integrations.rmm.datto.webhook.copy', { defaultValue: 'Copy' })}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="datto-rmm-webhook-header-name">{t('integrations.rmm.datto.webhook.headerName', { defaultValue: 'Custom Header Name' })}</Label>
                    <div className="flex items-center gap-2">
                      <Input id="datto-rmm-webhook-header-name" value={webhookInfo.headerName} readOnly />
                      <Button
                        id="datto-rmm-copy-webhook-header-name"
                        type="button"
                        variant="outline"
                        onClick={() => copyToClipboard(webhookInfo.headerName, t('integrations.rmm.datto.webhook.headerNameCopied', { defaultValue: 'Webhook header name copied to clipboard.' }))}
                      >
                        {t('integrations.rmm.datto.webhook.copy', { defaultValue: 'Copy' })}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="datto-rmm-webhook-secret">{t('integrations.rmm.datto.webhook.secret', { defaultValue: 'Header Secret' })}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="datto-rmm-webhook-secret"
                        type={showWebhookSecret ? 'text' : 'password'}
                        value={webhookInfo.secret}
                        readOnly
                      />
                      <Button
                        id="datto-rmm-toggle-webhook-secret"
                        type="button"
                        variant="outline"
                        onClick={() => setShowWebhookSecret((s) => !s)}
                      >
                        {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        id="datto-rmm-copy-webhook-secret"
                        type="button"
                        variant="outline"
                        onClick={() => copyToClipboard(webhookInfo.secret, t('integrations.rmm.datto.webhook.secretCopied', { defaultValue: 'Webhook secret copied to clipboard.' }))}
                      >
                        {t('integrations.rmm.datto.webhook.copy', { defaultValue: 'Copy' })}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="datto-rmm-webhook-body-template">{t('integrations.rmm.datto.webhook.bodyTemplate', { defaultValue: 'Body Template (alert triggered)' })}</Label>
                    <div className="flex items-start gap-2">
                      <TextArea id="datto-rmm-webhook-body-template" value={webhookInfo.bodyTemplate} readOnly rows={10} />
                      <Button
                        id="datto-rmm-copy-webhook-body-template"
                        type="button"
                        variant="outline"
                        onClick={() => copyToClipboard(webhookInfo.bodyTemplate, t('integrations.rmm.datto.webhook.bodyTemplateCopied', { defaultValue: 'Body template copied to clipboard.' }))}
                      >
                        {t('integrations.rmm.datto.webhook.copy', { defaultValue: 'Copy' })}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="datto-rmm-webhook-resolve-body-template">{t('integrations.rmm.datto.webhook.resolveBodyTemplate', { defaultValue: 'Body Template (alert resolved)' })}</Label>
                    <div className="flex items-start gap-2">
                      <TextArea id="datto-rmm-webhook-resolve-body-template" value={webhookInfo.resolveBodyTemplate} readOnly rows={10} />
                      <Button
                        id="datto-rmm-copy-webhook-resolve-body-template"
                        type="button"
                        variant="outline"
                        onClick={() => copyToClipboard(webhookInfo.resolveBodyTemplate, t('integrations.rmm.datto.webhook.resolveBodyTemplateCopied', { defaultValue: 'Resolved body template copied to clipboard.' }))}
                      >
                        {t('integrations.rmm.datto.webhook.copy', { defaultValue: 'Copy' })}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t('integrations.rmm.datto.webhook.unavailable', { defaultValue: 'Webhook information unavailable. (Requires settings update permission.)' })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border bg-background p-4 space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">{t('integrations.rmm.datto.sections.assetActions', { defaultValue: 'Asset actions' })}</div>
              <div className="text-xs text-muted-foreground">
                {t('integrations.rmm.datto.sections.assetActionsDescription', { defaultValue: 'Choose the Datto component that reboots a device when a technician clicks Reboot on an asset. It runs as a quick job and needs an API user with write access.' })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="datto-rmm-reboot-component">{t('integrations.rmm.datto.fields.rebootComponent', { defaultValue: 'Reboot component' })}</Label>
              <div className="flex flex-wrap items-center gap-2">
                {components ? (
                  <CustomSelect
                    id="datto-rmm-reboot-component"
                    className="min-w-[320px]"
                    value={rebootComponentUid}
                    onValueChange={(uid) => setRebootComponentUid(uid)}
                    options={components.map((c) => ({
                      value: c.uid,
                      label: c.name,
                      textValue: c.name,
                    }))}
                    placeholder={t('integrations.rmm.datto.fields.rebootComponentSelect', { defaultValue: 'Select a component' })}
                    allowClear
                    disabled={optionsLocked || busy}
                  />
                ) : (
                  <Input
                    id="datto-rmm-reboot-component"
                    className="min-w-[320px] max-w-md"
                    value={rebootComponentUid}
                    onChange={(e) => setRebootComponentUid(e.target.value)}
                    placeholder={t('integrations.rmm.datto.fields.rebootComponentUid', { defaultValue: 'Component UID' })}
                    disabled={optionsLocked || busy}
                  />
                )}
                <Button
                  id="datto-rmm-save-reboot-component"
                  type="button"
                  variant="secondary"
                  onClick={() => void handleSaveOptions(
                    { rebootComponentUid: rebootComponentUid.trim() || null },
                    () => setRebootComponentUid(savedRebootComponentUid)
                  )}
                  disabled={optionsLocked || savingOptions || busy || rebootComponentUid.trim() === savedRebootComponentUid}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {t('integrations.rmm.datto.actions.save', { defaultValue: 'Save' })}
                </Button>
              </div>
              {!components && isConnected && (
                <div className="text-xs text-muted-foreground">
                  {t('integrations.rmm.datto.fields.rebootComponentFallback', {
                    defaultValue: 'The component list is unavailable ({{reason}}). Paste the component UID instead.',
                    reason: componentsError || t('integrations.rmm.datto.fields.rebootComponentUnknownReason', { defaultValue: 'unknown error' }),
                  })}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {t('integrations.rmm.datto.fields.rebootComponentHelp', { defaultValue: 'Leave empty to disable the Reboot action. Only components already in your Datto account can run.' })}
              </div>
              {optionsLockedHint}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    {connectionSummary?.isActive && integrationId && (
      <RmmAlertAutomationSettings integrationId={integrationId} provider="datto" />
    )}

    {connectionSummary?.isActive && (
      <RmmDeviceSyncSettings provider="datto" onSaved={() => void load()} />
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
    </>
  );
}

export default DattoRmmIntegrationSettings;
