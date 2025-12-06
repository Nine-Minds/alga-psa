'use client';

/**
 * NinjaOne Integration Settings Component
 *
 * Provides UI for connecting, configuring, and managing the NinjaOne RMM integration.
 * Displays connection status, organization mappings, and sync controls.
 */

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import LoadingIndicator from '@/components/ui/LoadingIndicator';
import {
  CheckCircle,
  AlertCircle,
  Link,
  Unlink,
  RefreshCw,
  Building2,
  AlertTriangle,
  Monitor,
} from 'lucide-react';
import NinjaOneComplianceDashboard from './NinjaOneComplianceDashboard';
import OrganizationMappingManager from './ninjaone/OrganizationMappingManager';
import {
  getNinjaOneConnectionStatus,
  disconnectNinjaOneIntegration,
  testNinjaOneConnection,
  syncNinjaOneOrganizations,
  triggerNinjaOneFullSync,
  getNinjaOneConnectUrl,
} from '../../../lib/actions/integrations/ninjaoneActions';
import { RmmConnectionStatus } from '../../../interfaces/rmm.interfaces';
import { NinjaOneRegion, NINJAONE_REGIONS } from '../../../interfaces/ninjaone.interfaces';

const NinjaOneIntegrationSettings: React.FC = () => {
  const [status, setStatus] = useState<RmmConnectionStatus | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<NinjaOneRegion>('US');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefresh] = useTransition();
  const [isDisconnecting, startDisconnectTransition] = useTransition();
  const [isSyncing, startSyncTransition] = useTransition();
  const [isSyncingDevices, startDeviceSyncTransition] = useTransition();
  const [isTesting, startTestTransition] = useTransition();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const refreshStatus = useCallback(() => {
    startRefresh(async () => {
      setIsLoading(true);
      try {
        const result = await getNinjaOneConnectionStatus();
        setStatus(result);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load NinjaOne connection status.';
        setStatus(null);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  // Check for OAuth callback status in URL params
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const ninjaStatus = params.get('ninjaone_status');
      const ninjaError = params.get('error');
      const ninjaMessage = params.get('message');

      if (ninjaStatus === 'success') {
        setSuccessMessage('Successfully connected to NinjaOne.');
        setError(null);
      } else if (ninjaStatus === 'failure' || ninjaError) {
        const detail = ninjaMessage ?? ninjaError ?? '';
        setError(detail ? `NinjaOne connection failed: ${detail}` : 'NinjaOne connection failed.');
        setSuccessMessage(null);
      }

      // Clean up URL params
      if (ninjaStatus || ninjaError || ninjaMessage) {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }

    refreshStatus();
  }, [refreshStatus]);

  const handleConnect = async () => {
    setSuccessMessage(null);
    setError(null);
    try {
      const connectUrl = await getNinjaOneConnectUrl(selectedRegion);
      if (typeof window !== 'undefined') {
        window.location.href = connectUrl;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initiate NinjaOne connection.';
      setError(message);
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
          setSuccessMessage('NinjaOne connection successfully disconnected.');
        } else {
          setError(result.error ?? 'Failed to disconnect NinjaOne.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred while disconnecting.';
        setError(message);
      } finally {
        refreshStatus();
      }
    });
  };

  const handleTestConnection = () => {
    startTestTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await testNinjaOneConnection();
        if (result.success) {
          setSuccessMessage('NinjaOne connection test successful.');
        } else {
          setError(result.error ?? 'Connection test failed.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection test failed.';
        setError(message);
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
          setSuccessMessage(
            `Organization sync completed. Processed: ${result.items_processed}, ` +
            `Created: ${result.items_created}, Updated: ${result.items_updated}`
          );
        } else {
          setError(
            result.errors?.join('; ') ?? 'Organization sync failed.'
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Organization sync failed.';
        setError(message);
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
          setSuccessMessage(
            `Device sync completed. Processed: ${result.items_processed}, ` +
            `Created: ${result.items_created}, Updated: ${result.items_updated}`
          );
        } else {
          setError(
            result.errors?.join('; ') ?? 'Device sync failed.'
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Device sync failed.';
        setError(message);
      } finally {
        refreshStatus();
      }
    });
  };

  const isConnected = status?.is_connected;
  const isActive = status?.is_active;

  const renderStatusPanel = () => {
    if (isLoading || isRefreshing) {
      return <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Checking NinjaOne connection..." />;
    }

    if (!isConnected) {
      return (
        <div className="flex gap-3">
          <AlertCircle className="mt-1 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Not connected to NinjaOne</p>
            <p className="text-sm text-muted-foreground">
              Connect your NinjaOne account to sync devices, receive alerts, and enable remote access.
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
            {hasError ? 'NinjaOne connected with sync errors' : 'Connected to NinjaOne'}
          </p>
          {status?.instance_url && (
            <p className="text-sm text-muted-foreground">
              Instance: <span className="font-semibold">{status.instance_url}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {status?.organization_count !== undefined && (
              <span className="flex items-center gap-1">
                <Building2 className="h-4 w-4" />
                {status.organization_count} organizations
              </span>
            )}
            {status?.device_count !== undefined && (
              <span className="flex items-center gap-1">
                <Monitor className="h-4 w-4" />
                {status.device_count} devices
              </span>
            )}
            {status?.active_alert_count !== undefined && status.active_alert_count > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                {status.active_alert_count} active alerts
              </span>
            )}
          </div>
          {status?.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Last synced: {new Date(status.last_sync_at).toLocaleString()}
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
      <Card id="ninjaone-integration-settings-card">
        <CardHeader>
          <CardTitle>NinjaOne RMM Integration</CardTitle>
          <CardDescription>
            Connect your NinjaOne account to synchronize devices, receive alerts, and enable remote access capabilities.
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
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select your NinjaOne region, then click &lsquo;Connect to NinjaOne&rsquo; to authorize access.
              </p>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium" htmlFor="ninjaone-region-select">
                  Region:
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
                  {isRefreshing ? 'Refreshing...' : 'Refresh Status'}
                </Button>
                <Button
                  id="ninjaone-test-connection"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
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
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Organizations
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
                      Syncing Devices...
                    </>
                  ) : (
                    <>
                      <Monitor className="mr-2 h-4 w-4" />
                      Sync Devices
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
                    <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Disconnecting..." />
                  ) : (
                    <>
                      <Unlink className="mr-2 h-4 w-4" /> Disconnect
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                id="ninjaone-connect-button"
                onClick={handleConnect}
                disabled={isLoading || isRefreshing}
              >
                <Link className="mr-2 h-4 w-4" />
                Connect to NinjaOne
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>

      {/* Disconnect Confirmation Modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl border border-border">
            <h3 className="text-lg font-semibold text-foreground">Disconnect NinjaOne</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to disconnect NinjaOne? This will stop device synchronization and alert notifications.
              Organization mappings will be preserved.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button id="ninjaone-disconnect-cancel-btn" variant="outline" onClick={() => setShowDisconnectConfirm(false)}>
                Cancel
              </Button>
              <Button id="ninjaone-disconnect-confirm-btn" variant="destructive" onClick={handleDisconnect}>
                Disconnect
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Organization Mappings - shown when connected */}
      {isConnected && isActive && (
        <div className="mt-6">
          <OrganizationMappingManager onMappingChanged={refreshStatus} />
        </div>
      )}

      {/* Compliance Dashboard - shown when connected */}
      {isConnected && isActive && (
        <div className="mt-6">
          <NinjaOneComplianceDashboard />
        </div>
      )}
    </>
  );
};

export default NinjaOneIntegrationSettings;
