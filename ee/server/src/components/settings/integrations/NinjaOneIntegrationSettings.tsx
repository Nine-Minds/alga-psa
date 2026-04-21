'use client';

/**
 * NinjaOne Integration Settings Component
 *
 * Provides UI for connecting, configuring, and managing the NinjaOne RMM integration.
 * Displays connection status, organization mappings, and sync controls.
 */

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  CheckCircle,
  AlertCircle,
  Link,
  Unlink,
  RefreshCw,
  Building2,
  AlertTriangle,
  Monitor,
  ExternalLink,
  Eye,
  EyeOff,
  Save,
  Info,
} from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
import NinjaOneComplianceDashboard from './NinjaOneComplianceDashboard';
import OrganizationMappingManager from './ninjaone/OrganizationMappingManager';
import {
  getNinjaOneConnectionStatus,
  disconnectNinjaOneIntegration,
  syncNinjaOneOrganizations,
  triggerNinjaOneFullSync,
  getNinjaOneConnectUrl,
  saveNinjaOneCredentials,
  getNinjaOneCredentialsStatus,
} from '../../../lib/actions/integrations/ninjaoneActions';
import { RmmConnectionStatus } from '../../../interfaces/rmm.interfaces';
import { NinjaOneRegion, NINJAONE_REGIONS } from '../../../interfaces/ninjaone.interfaces';

const NinjaOneIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');
  const [status, setStatus] = useState<RmmConnectionStatus | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<NinjaOneRegion>('US');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefresh] = useTransition();
  const [isDisconnecting, startDisconnectTransition] = useTransition();
  const [isSyncing, startSyncTransition] = useTransition();
  const [isSyncingDevices, startDeviceSyncTransition] = useTransition();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [orgMappingsRefreshKey, setOrgMappingsRefreshKey] = useState(0);
  const [fleetComplianceRefreshKey, setFleetComplianceRefreshKey] = useState(0);

  // Credential management state
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [credentialsStatus, setCredentialsStatus] = useState<{
    hasCredentials: boolean;
    clientId?: string;
    clientSecretMasked?: string;
  }>({ hasCredentials: false });
  const [isSavingCredentials, startSaveCredentials] = useTransition();
  const [isLoadingCredentials, setIsLoadingCredentials] = useState(true);

  const refreshStatus = useCallback(() => {
    startRefresh(async () => {
      setIsLoading(true);
      try {
        const result = await getNinjaOneConnectionStatus();
        setStatus(result);
        setError(null);
      } catch (err) {
        console.error('Failed to load NinjaOne connection status:', err);
        setStatus(null);
        setError(t('integrations.rmm.ninjaOne.errors.loadStatus', { defaultValue: 'Failed to load NinjaOne connection status.' }));
      } finally {
        setIsLoading(false);
      }
    });
  }, [t]);

  // Load credentials status
  const loadCredentialsStatus = useCallback(async () => {
    setIsLoadingCredentials(true);
    try {
      const result = await getNinjaOneCredentialsStatus();
      setCredentialsStatus(result);
      // If credentials exist, populate the Client ID field for display
      if (result.hasCredentials && result.clientId) {
        setClientId(result.clientId);
      }
    } catch (err) {
      console.error('Failed to load NinjaOne credentials status:', err);
    } finally {
      setIsLoadingCredentials(false);
    }
  }, []);

  // Handle saving credentials
  const handleSaveCredentials = () => {
    startSaveCredentials(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await saveNinjaOneCredentials(clientId.trim(), clientSecret.trim());
        if (result.success) {
          setSuccessMessage(t('integrations.rmm.ninjaOne.toasts.credentialsSaved', { defaultValue: 'NinjaOne API credentials saved successfully.' }));
          setClientSecret(''); // Clear the secret from the form after saving
          await loadCredentialsStatus(); // Refresh to show masked status
        } else {
          console.error('NinjaOne save credentials failed:', result.error);
          setError(t('integrations.rmm.ninjaOne.errors.saveCredentials', { defaultValue: 'Failed to save credentials.' }));
        }
      } catch (err) {
        console.error('NinjaOne save credentials error:', err);
        setError(t('integrations.rmm.ninjaOne.errors.saveCredentials', { defaultValue: 'Failed to save credentials.' }));
      }
    });
  };

  // Check for OAuth callback status in URL params
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const ninjaStatus = params.get('ninjaone_status');
      const ninjaError = params.get('error');
      const ninjaMessage = params.get('message');

      if (ninjaStatus === 'success') {
        setSuccessMessage(t('integrations.rmm.ninjaOne.toasts.connectSuccess', { defaultValue: 'Successfully connected to NinjaOne.' }));
        setError(null);
      } else if (ninjaStatus === 'failure' || ninjaError) {
        const detail = ninjaMessage ?? ninjaError ?? '';
        setError(
          detail
            ? t('integrations.rmm.ninjaOne.toasts.connectFailedWithDetail', { defaultValue: 'NinjaOne connection failed: {{detail}}', detail })
            : t('integrations.rmm.ninjaOne.toasts.connectFailed', { defaultValue: 'NinjaOne connection failed.' })
        );
        setSuccessMessage(null);
      }

      // Clean up only NinjaOne callback params, preserve tab/category
      if (ninjaStatus || ninjaError || ninjaMessage) {
        params.delete('ninjaone_status');
        params.delete('error');
        params.delete('message');
        const remaining = params.toString();
        const cleanUrl =
          window.location.pathname +
          (remaining ? `?${remaining}` : '') +
          window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }

    refreshStatus();
  }, [refreshStatus]);

  // Load credentials status on mount
  useEffect(() => {
    loadCredentialsStatus();
  }, [loadCredentialsStatus]);

  const handleConnect = async () => {
    setSuccessMessage(null);
    setError(null);
    try {
      const connectUrl = await getNinjaOneConnectUrl(selectedRegion);
      if (typeof window !== 'undefined') {
        window.location.href = connectUrl;
      }
    } catch (err) {
      console.error('NinjaOne connect error:', err);
      setError(t('integrations.rmm.ninjaOne.errors.connect', { defaultValue: 'Failed to initiate NinjaOne connection.' }));
    }
  };

  const handleDisconnect = () => {
    setShowDisconnectConfirm(false);
    startDisconnectTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await disconnectNinjaOneIntegration();
        if (result.success) {
          setSuccessMessage(t('integrations.rmm.ninjaOne.toasts.disconnectSuccess', { defaultValue: 'NinjaOne connection successfully disconnected.' }));
        } else {
          console.error('NinjaOne disconnect failed:', result.error);
          setError(t('integrations.rmm.ninjaOne.errors.disconnect', { defaultValue: 'Failed to disconnect NinjaOne.' }));
        }
      } catch (err) {
        console.error('NinjaOne disconnect error:', err);
        setError(t('integrations.rmm.ninjaOne.errors.disconnectUnexpected', { defaultValue: 'An unexpected error occurred while disconnecting.' }));
      } finally {
        refreshStatus();
        loadCredentialsStatus(); // Reload credential status since disconnect clears them
      }
    });
  };

  const handleSyncOrganizations = () => {
    startSyncTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await syncNinjaOneOrganizations();
        if (result.success) {
          setSuccessMessage(t('integrations.rmm.ninjaOne.toasts.orgSyncSuccess', {
            defaultValue: 'Organization sync completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}',
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          }));
          // Ensure mapping list reflects newly-synced orgs.
          setOrgMappingsRefreshKey((prev) => prev + 1);
        } else {
          console.error('NinjaOne org sync failed:', result.errors);
          setError(t('integrations.rmm.ninjaOne.errors.orgSyncFailed', { defaultValue: 'Organization sync failed.' }));
        }
      } catch (err) {
        console.error('NinjaOne org sync error:', err);
        setError(t('integrations.rmm.ninjaOne.errors.orgSyncFailed', { defaultValue: 'Organization sync failed.' }));
      } finally {
        refreshStatus();
      }
    });
  };

  const handleSyncDevices = () => {
    startDeviceSyncTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await triggerNinjaOneFullSync();
        if (result.success) {
          setSuccessMessage(t('integrations.rmm.ninjaOne.toasts.deviceSyncSuccess', {
            defaultValue: 'Device sync completed. Processed: {{processed}}, Created: {{created}}, Updated: {{updated}}',
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          }));
          // Refresh fleet compliance to reflect newly-synced devices.
          setFleetComplianceRefreshKey((prev) => prev + 1);
        } else {
          console.error('NinjaOne device sync failed:', result.errors);
          setError(t('integrations.rmm.ninjaOne.errors.deviceSyncFailed', { defaultValue: 'Device sync failed.' }));
        }
      } catch (err) {
        console.error('NinjaOne device sync error:', err);
        setError(t('integrations.rmm.ninjaOne.errors.deviceSyncFailed', { defaultValue: 'Device sync failed.' }));
      } finally {
        refreshStatus();
      }
    });
  };

  const isConnected = status?.is_connected;
  const isActive = status?.is_active;

  const renderStatusPanel = () => {
    if (isLoading || isRefreshing) {
      return <LoadingIndicator spinnerProps={{ size: 'sm' }} text={t('integrations.rmm.ninjaOne.status.checking', { defaultValue: 'Checking NinjaOne connection...' })} />;
    }

    if (!isConnected) {
      return (
        <div className="flex gap-3">
          <AlertCircle className="mt-1 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('integrations.rmm.ninjaOne.status.notConnected.title', { defaultValue: 'Not connected to NinjaOne' })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('integrations.rmm.ninjaOne.status.notConnected.description', { defaultValue: 'Connect your NinjaOne account to sync devices, receive alerts, and enable remote access.' })}
            </p>
          </div>
        </div>
      );
    }

    const hasError = status?.sync_status === 'error';

    return (
      <div className="flex gap-3">
        {hasError ? (
          <AlertTriangle className="mt-1 h-5 w-5 text-amber-500" />
        ) : (
          <CheckCircle className="mt-1 h-5 w-5 text-green-500" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {hasError
              ? t('integrations.rmm.ninjaOne.status.connectedWithErrors', { defaultValue: 'NinjaOne connected with sync errors' })
              : t('integrations.rmm.ninjaOne.status.connected', { defaultValue: 'Connected to NinjaOne' })}
          </p>
          {status?.instance_url && (
            <p className="text-sm text-muted-foreground">
              {t('integrations.rmm.ninjaOne.status.instanceLabel', { defaultValue: 'Instance:' })}{' '}
              <span className="font-semibold">{status.instance_url}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {status?.organization_count !== undefined && (
              <span className="flex items-center gap-1">
                <Building2 className="h-4 w-4" />
                {t('integrations.rmm.ninjaOne.status.organizations', { defaultValue: '{{count}} organizations', count: status.organization_count })}
              </span>
            )}
            {status?.device_count !== undefined && (
              <span className="flex items-center gap-1">
                <Monitor className="h-4 w-4" />
                {t('integrations.rmm.ninjaOne.status.devices', { defaultValue: '{{count}} devices', count: status.device_count })}
              </span>
            )}
            {status?.active_alert_count !== undefined && status.active_alert_count > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                {t('integrations.rmm.ninjaOne.status.activeAlerts', { defaultValue: '{{count}} active alerts', count: status.active_alert_count })}
              </span>
            )}
          </div>
          {status?.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              {t('integrations.rmm.ninjaOne.status.lastSynced', { defaultValue: 'Last synced: {{time}}', time: new Date(status.last_sync_at).toLocaleString() })}
            </p>
          )}
          {hasError && status?.sync_error && (
            <p className="text-xs text-amber-600">{status.sync_error}</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {(isLoading || isLoadingCredentials) && (
        <SettingsTabSkeleton
          title={t('integrations.rmm.ninjaOne.card.title', { defaultValue: 'NinjaOne RMM Integration' })}
          description={t('integrations.rmm.ninjaOne.card.skeletonDescription', { defaultValue: 'Loading NinjaOne integration...' })}
          showForm
          showDropdowns
          showTable={false}
        />
      )}
      {!(isLoading || isLoadingCredentials) && (
      <Card id="ninjaone-integration-settings-card">
        <CardHeader>
          <CardTitle>{t('integrations.rmm.ninjaOne.card.title', { defaultValue: 'NinjaOne RMM Integration' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.ninjaOne.card.description', { defaultValue: 'Connect your NinjaOne account to synchronize devices, receive alerts, and enable remote access capabilities.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {successMessage && (
            <Alert variant="success" id="ninjaone-success-alert">
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" id="ninjaone-error-alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
            {renderStatusPanel()}
          </div>

          {!isConnected && (
            <div className="space-y-4">
              {/* Setup Instructions */}
              <div className="rounded-lg border-l-4 border-l-primary-500 border-y-0 border-r-0 bg-primary-50 p-4">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-5 w-5 text-primary-600 flex-shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-primary-800">
                      {t('integrations.rmm.ninjaOne.setup.title', { defaultValue: 'Setup Instructions' })}
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-sm text-primary-800">
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.login', { defaultValue: 'Log into your NinjaOne dashboard' })}</li>
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.navigate', { defaultValue: 'Navigate to Administration → Apps → API' })}</li>
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.addClient', { defaultValue: 'Click "+ Add client app" to create a new API application' })}</li>
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.platform', { defaultValue: 'Set Application Platform to "Web (PHP, Java, .Net Core, etc.)"' })}</li>
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.name', { defaultValue: 'Enter a Name (e.g., "Alga PSA")' })}</li>
                      <li>
                        {t('integrations.rmm.ninjaOne.setup.steps.redirectUri', { defaultValue: 'Add the redirect URI:' })}{' '}
                        <code className="bg-primary-100 px-1 py-0.5 rounded text-xs break-all">
                          {typeof window !== 'undefined'
                            ? `${window.location.origin}/api/integrations/ninjaone/callback`
                            : '/api/integrations/ninjaone/callback'}
                        </code>
                      </li>
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.scopes', { defaultValue: 'Under "Scopes", check "Monitoring" and "Management"' })}</li>
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.grantTypes', { defaultValue: 'Under "Allowed grant types", check "Authorization code", "Client credentials", and "Refresh token"' })}</li>
                      <li>{t('integrations.rmm.ninjaOne.setup.steps.addAndCopy', { defaultValue: 'Click "Add" and copy the Client ID and Client Secret below' })}</li>
                    </ol>
                    <p className="text-xs text-primary-700 mt-2">
                      {t('integrations.rmm.ninjaOne.setup.docsPrefix', { defaultValue: 'For detailed setup instructions, see' })}{' '}
                      <a
                        href="https://nineminds.com/documentation?doc=1015-setting-up-ninjaone-integration-in-alga-psa"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-primary-800"
                      >
                        {t('integrations.rmm.ninjaOne.setup.docsSection', { defaultValue: 'Section 10.15' })}
                      </a>{' '}
                      {t('integrations.rmm.ninjaOne.setup.docsSuffix', { defaultValue: 'in the documentation.' })}
                    </p>
                    <Button
                      id="ninjaone-open-api-settings"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-primary-700"
                      onClick={() => window.open('https://www.ninjaone.com/login/', '_blank')}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      {t('integrations.rmm.ninjaOne.setup.openApiSettings', { defaultValue: 'Open NinjaOne API Settings' })}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Credentials Input */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {t('integrations.rmm.ninjaOne.credentials.title', { defaultValue: 'API Credentials' })}
                </p>
                {credentialsStatus.hasCredentials && (
                  <Alert variant="success" showIcon={false}>
                    <AlertDescription>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        <span>{t('integrations.rmm.ninjaOne.credentials.saved', { defaultValue: 'Credentials saved' })}</span>
                      </div>
                      <p className="mt-1 text-xs">
                        {t('integrations.rmm.ninjaOne.credentials.clientIdLabel', { defaultValue: 'Client ID' })}: {credentialsStatus.clientId}
                        {credentialsStatus.clientSecretMasked && (
                          <> • {t('integrations.rmm.ninjaOne.credentials.secretMaskedLabel', { defaultValue: 'Secret' })}: ****{credentialsStatus.clientSecretMasked}</>
                        )}
                      </p>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-3">
                  <div>
                    <label className="text-sm text-muted-foreground" htmlFor="ninjaone-client-id">
                      {t('integrations.rmm.ninjaOne.credentials.clientIdLabel', { defaultValue: 'Client ID' })}
                    </label>
                    <Input
                      id="ninjaone-client-id"
                      type="text"
                      placeholder={t('integrations.rmm.ninjaOne.credentials.clientIdPlaceholder', { defaultValue: 'Enter your NinjaOne Client ID' })}
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground" htmlFor="ninjaone-client-secret">
                      {t('integrations.rmm.ninjaOne.credentials.clientSecretLabel', { defaultValue: 'Client Secret' })}
                    </label>
                    <div className="relative mt-1">
                      <Input
                        id="ninjaone-client-secret"
                        type={showSecret ? 'text' : 'password'}
                        placeholder={credentialsStatus.hasCredentials
                          ? t('integrations.rmm.ninjaOne.credentials.clientSecretUpdatePlaceholder', { defaultValue: 'Enter new secret to update' })
                          : t('integrations.rmm.ninjaOne.credentials.clientSecretPlaceholder', { defaultValue: 'Enter your NinjaOne Client Secret' })}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="pr-10"
                      />
                      <Button
                        id="ninjaone-toggle-secret-visibility"
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                        onClick={() => setShowSecret(!showSecret)}
                      >
                        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button
                    id="ninjaone-save-credentials"
                    variant="secondary"
                    onClick={handleSaveCredentials}
                    disabled={isSavingCredentials || !clientId.trim() || !clientSecret.trim()}
                    className="w-fit"
                  >
                    {isSavingCredentials ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        {t('integrations.rmm.ninjaOne.credentials.saving', { defaultValue: 'Saving...' })}
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        {t('integrations.rmm.ninjaOne.credentials.save', { defaultValue: 'Save Credentials' })}
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Region Selection */}
              <div className="space-y-2 pt-2 border-t">
                <p className="text-sm text-muted-foreground">
                  {t('integrations.rmm.ninjaOne.region.hint', { defaultValue: 'Select your NinjaOne region, then click ‘Connect to NinjaOne’ to authorize access.' })}
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium" htmlFor="ninjaone-region-select">
                    {t('integrations.rmm.ninjaOne.region.label', { defaultValue: 'Region:' })}
                  </label>
                  <select
                    id="ninjaone-region-select"
                    className="rounded-md border px-3 py-1.5 text-sm"
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value as NinjaOneRegion)}
                  >
                    {Object.entries(NINJAONE_REGIONS).map(([region, url]) => (
                      <option key={region} value={region}>
                        {region} ({url.replace('https://', '')})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {isConnected ? (
              <>
                <Button
                  id="ninjaone-refresh-status"
                  variant="outline"
                  onClick={refreshStatus}
                  disabled={isRefreshing}
                >
                  {isRefreshing
                    ? t('integrations.rmm.ninjaOne.actions.refreshing', { defaultValue: 'Refreshing...' })
                    : t('integrations.rmm.ninjaOne.actions.refreshStatus', { defaultValue: 'Refresh Status' })}
                </Button>
                <Button
                  id="ninjaone-sync-orgs"
                  variant="secondary"
                  onClick={handleSyncOrganizations}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      {t('integrations.rmm.ninjaOne.actions.syncing', { defaultValue: 'Syncing...' })}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {t('integrations.rmm.ninjaOne.actions.syncOrganizations', { defaultValue: 'Sync Organizations' })}
                    </>
                  )}
                </Button>
                <Button
                  id="ninjaone-sync-devices"
                  variant="secondary"
                  onClick={handleSyncDevices}
                  disabled={isSyncingDevices}
                >
                  {isSyncingDevices ? (
                    <>
                      <Monitor className="mr-2 h-4 w-4 animate-spin" />
                      {t('integrations.rmm.ninjaOne.actions.syncingDevices', { defaultValue: 'Syncing Devices...' })}
                    </>
                  ) : (
                    <>
                      <Monitor className="mr-2 h-4 w-4" />
                      {t('integrations.rmm.ninjaOne.actions.syncDevices', { defaultValue: 'Sync Devices' })}
                    </>
                  )}
                </Button>
                <Button
                  id="ninjaone-disconnect-button"
                  variant="destructive"
                  onClick={() => setShowDisconnectConfirm(true)}
                  disabled={isDisconnecting}
                >
                  {isDisconnecting ? (
                    <LoadingIndicator spinnerProps={{ size: 'sm' }} text={t('integrations.rmm.ninjaOne.actions.disconnecting', { defaultValue: 'Disconnecting...' })} />
                  ) : (
                    <>
                      <Unlink className="mr-2 h-4 w-4" /> {t('integrations.rmm.ninjaOne.actions.disconnect', { defaultValue: 'Disconnect' })}
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                id="ninjaone-connect-button"
                onClick={handleConnect}
                disabled={!credentialsStatus.hasCredentials || isLoadingCredentials}
              >
                <Link className="mr-2 h-4 w-4" />
                {t('integrations.rmm.ninjaOne.actions.connect', { defaultValue: 'Connect to NinjaOne' })}
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
      )}

      {/* Disconnect Confirmation Modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl border border-border">
            <h3 className="text-lg font-semibold text-foreground">
              {t('integrations.rmm.ninjaOne.disconnectModal.title', { defaultValue: 'Disconnect NinjaOne' })}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('integrations.rmm.ninjaOne.disconnectModal.description', { defaultValue: 'Are you sure you want to disconnect NinjaOne? This will stop device synchronization and alert notifications, and remove your stored API credentials. Organization mappings will be preserved.' })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button id="ninjaone-disconnect-cancel-btn" variant="outline" onClick={() => setShowDisconnectConfirm(false)}>
                {t('integrations.rmm.ninjaOne.disconnectModal.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button id="ninjaone-disconnect-confirm-btn" variant="destructive" onClick={handleDisconnect}>
                {t('integrations.rmm.ninjaOne.disconnectModal.confirm', { defaultValue: 'Disconnect' })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Organization Mappings - shown when connected */}
      {isConnected && isActive && (
        <div className="mt-6">
          <OrganizationMappingManager
            onMappingChanged={refreshStatus}
            refreshKey={orgMappingsRefreshKey}
          />
        </div>
      )}

      {/* Compliance Dashboard - shown when connected */}
      {isConnected && isActive && (
        <div className="mt-6">
          <NinjaOneComplianceDashboard refreshKey={fleetComplianceRefreshKey} />
        </div>
      )}
    </>
  );
};

export default NinjaOneIntegrationSettings;
