'use client';

import React, { useEffect, useState, useTransition } from 'react';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Alert, AlertDescription } from '../../ui/Alert';
import LoadingIndicator from '../../ui/LoadingIndicator';
import { Link, FileSpreadsheet, Cloud } from 'lucide-react';
import { XeroMappingManager } from '../../integrations/xero/XeroMappingManager';
import XeroCsvSettings from './XeroCsvSettings';
import {
  getXeroConnectionStatus,
  type XeroConnectionStatus
} from 'server/src/lib/actions/integrations/xeroActions';
import {
  getXeroCsvSettings,
  updateXeroCsvSettings,
  type XeroCsvSettings as XeroCsvSettingsType
} from 'server/src/lib/actions/integrations/xeroCsvActions';

type PlaywrightAccountingMocks = {
  status?: {
    xero?: XeroConnectionStatus;
  };
};

function getPlaywrightAccountingMocks(): PlaywrightAccountingMocks | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const globalWithMocks = window as typeof window & {
    __ALGA_PLAYWRIGHT_ACCOUNTING__?: PlaywrightAccountingMocks;
  };
  return globalWithMocks.__ALGA_PLAYWRIGHT_ACCOUNTING__;
}

type IntegrationMode = 'oauth' | 'csv';

const XeroIntegrationSettings: React.FC = () => {
  const [integrationMode, setIntegrationMode] = useState<IntegrationMode>('oauth');
  const [csvSettings, setCsvSettings] = useState<XeroCsvSettingsType | null>(null);
  const [status, setStatus] = useState<XeroConnectionStatus | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefresh] = useTransition();
  const [isSwitchingMode, startModeSwitch] = useTransition();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const statusParam = params.get('xero_status');
      const errorParam = params.get('xero_error');
      const messageParam = params.get('message');

      if (statusParam === 'success') {
        setSuccessMessage('Successfully connected to Xero.');
        setError(null);
      } else if (statusParam === 'failure' || errorParam) {
        const detail = messageParam ?? errorParam ?? '';
        setError(detail ? `Xero connection failed: ${detail}` : 'Xero connection failed.');
        setSuccessMessage(null);
      }

      if (statusParam || errorParam || messageParam) {
        params.delete('xero_status');
        params.delete('xero_error');
        params.delete('message');
        const remaining = params.toString();
        const cleanUrl =
          window.location.pathname +
          (remaining ? `?${remaining}` : '') +
          window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }

    const mocks = getPlaywrightAccountingMocks()?.status?.xero;
    if (mocks) {
      setStatus(mocks);
      setSelectedConnectionId(mocks.defaultConnectionId ?? null);
      setError(mocks.error ?? null);
      if (mocks.error) {
        setSuccessMessage(null);
      }
      setIsLoading(false);
      return;
    }
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      // Load CSV settings first to determine mode
      const csvSettingsResult = await getXeroCsvSettings();
      setCsvSettings(csvSettingsResult);
      setIntegrationMode(csvSettingsResult.integrationMode);

      // Always load OAuth status too (for displaying connection info)
      await refreshStatusInternal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshStatusInternal = async () => {
    try {
      const mocks = getPlaywrightAccountingMocks()?.status?.xero;
      if (mocks) {
        setStatus(mocks);
        setSelectedConnectionId((prev) => {
          const options = mocks.connections ?? [];
          const nextDefault = mocks.defaultConnectionId ?? options[0]?.connectionId ?? null;
          const stillValid = prev && options.some((connection) => connection.connectionId === prev);
          return stillValid ? prev : nextDefault ?? null;
        });
        setError(mocks.error ?? null);
        if (mocks.error) {
          setSuccessMessage(null);
        }
      } else {
        const result = await getXeroConnectionStatus();
        setStatus(result);
        setSelectedConnectionId((prev) => {
          const options = result.connections ?? [];
          const nextDefault = result.defaultConnectionId ?? options[0]?.connectionId ?? null;
          const stillValid = prev && options.some((connection) => connection.connectionId === prev);
          return stillValid ? prev : nextDefault ?? null;
        });
        setError(result.error ?? null);
        if (!result.connections?.length || result.error) {
          setSuccessMessage(null);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Xero status.';
      setError(message);
      setStatus(null);
      setSelectedConnectionId(null);
      setSuccessMessage(null);
    }
  };

  const refreshStatus = () => {
    startRefresh(async () => {
      setIsLoading(true);
      try {
        await refreshStatusInternal();
      } finally {
        setIsLoading(false);
      }
    });
  };

  const handleModeChange = (newMode: IntegrationMode) => {
    startModeSwitch(async () => {
      try {
        await updateXeroCsvSettings({ integrationMode: newMode });
        setIntegrationMode(newMode);
        setSuccessMessage(`Switched to ${newMode === 'csv' ? 'CSV' : 'OAuth'} mode`);
        setError(null);
        setTimeout(() => setSuccessMessage(null), 3000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to switch mode';
        setError(message);
        setSuccessMessage(null);
      }
    });
  };

  const hasConnection = Boolean(status?.connections?.length);
  const canShowMappings = Boolean(hasConnection && selectedConnectionId);
  const isNoConnectionError = error === 'No Xero connections configured.';
  const shouldShowErrorAlert = Boolean(error && !(isNoConnectionError && !hasConnection));

  const selectedConnection = hasConnection
    ? status?.connections?.find((connection) => connection.connectionId === selectedConnectionId) ??
      status?.connections?.[0] ??
      null
    : null;

  const shouldShowConnectInfo =
    !hasConnection || selectedConnection?.status === 'expired' || !status?.connected;

  const handleConnect = () => {
    setError(null);
    setSuccessMessage(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/api/integrations/xero/connect';
    }
  };

  const renderStatusPanel = () => {
    if (isLoading || isRefreshing) {
      return <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Checking Xero connection…" />;
    }

    if (!hasConnection) {
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Not connected to Xero</p>
          <p className="text-sm text-muted-foreground">
            Connect your Xero organisation to manage mappings before running accounting exports.
          </p>
        </div>
      );
    }

    if (!selectedConnection) {
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Connection data unavailable</p>
          <p className="text-sm text-muted-foreground">
            Refresh the connection status or reconnect to continue managing mappings.
          </p>
        </div>
      );
    }

    const connectionNeedsAttention =
      selectedConnection.status === 'expired' || !status?.connected;

    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Connected to organisation&nbsp;
          <span className="font-semibold">{selectedConnection.xeroTenantId}</span>
          {selectedConnection.status === 'expired' ? ' (authorization expired)' : ''}
        </p>
        <p className="text-sm text-muted-foreground">
          {connectionNeedsAttention
            ? 'Reconnect to refresh access before creating invoices or updating mappings.'
            : 'Mappings and exports will use this organisation. Switch organisations with the selector below.'}
        </p>
        {status?.connections && status.connections.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            You have {status.connections.length} organisations connected. Select one below to manage its mappings.
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {/* Integration Mode Toggle Card */}
      <Card id="xero-integration-mode-card">
        <CardHeader>
          <CardTitle>Xero Integration Mode</CardTitle>
          <CardDescription>
            Choose how to integrate with Xero. OAuth provides direct API access, while CSV mode uses file-based import/export.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row">
            <button
              type="button"
              onClick={() => handleModeChange('oauth')}
              disabled={isSwitchingMode || isLoading}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-colors ${
                integrationMode === 'oauth'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <Cloud className={`h-6 w-6 ${integrationMode === 'oauth' ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <p className="font-medium text-foreground">OAuth Integration</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connect directly to Xero via OAuth for automatic invoice sync and real-time updates.
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('csv')}
              disabled={isSwitchingMode || isLoading}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-colors ${
                integrationMode === 'csv'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <FileSpreadsheet className={`h-6 w-6 ${integrationMode === 'csv' ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <p className="font-medium text-foreground">CSV Import/Export</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Use CSV files to export invoices to Xero and import tax calculations back.
                  </p>
                </div>
              </div>
            </button>
          </div>
          {isSwitchingMode && (
            <div className="mt-4">
              <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Switching mode..." />
            </div>
          )}
        </CardContent>
      </Card>

      {/* CSV Mode Content */}
      {integrationMode === 'csv' && (
        <div className="mt-6">
          <XeroCsvSettings />
        </div>
      )}

      {/* OAuth Mode Content */}
      {integrationMode === 'oauth' && (
        <Card id="xero-integration-settings-card" className="mt-6">
          <CardHeader>
            <CardTitle>Xero OAuth Connection</CardTitle>
            <CardDescription>
              Connect your Xero organisation to enable direct API access for accounting exports.
            </CardDescription>
          </CardHeader>
        <CardContent className="space-y-4">
          {successMessage ? (
            <Alert variant="success">
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}

          {shouldShowErrorAlert ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
            {renderStatusPanel()}
          </div>

          {shouldShowConnectInfo ? (
            <p className="text-sm text-muted-foreground">
              Clicking &lsquo;Connect to Xero&rsquo; will redirect you to Xero to authorize the integration. You&apos;ll
              return here once the connection completes.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {hasConnection ? (
              <>
                <Button
                  id="xero-refresh-status"
                  variant="outline"
                  onClick={refreshStatus}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Refreshing…' : 'Refresh Status'}
                </Button>
                <Button
                  id="xero-connect-secondary"
                  variant="secondary"
                  onClick={handleConnect}
                  disabled={isRefreshing}
                >
                  Connect another Xero organisation
                </Button>
              </>
            ) : (
              <Button
                id="xero-connect-primary"
                onClick={handleConnect}
                disabled={isLoading || isRefreshing}
              >
                <Link className="mr-2 h-4 w-4" />
                Connect to Xero
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
      )}

      {/* Mappings Card - Available for both OAuth and CSV modes when OAuth connection exists */}
      {hasConnection && (
        <Card id="xero-mapping-card" className="mt-6">
          <CardHeader>
            <CardTitle>Xero Mappings</CardTitle>
            <CardDescription>
              Map Alga services and tax regions to the corresponding Xero items, accounts, and tax rates.
              {integrationMode === 'csv' && ' These mappings are used when generating CSV exports.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Choose the Xero organisation to manage mapping data.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground" htmlFor="xero-connection-select">
                  Connection
                </label>
                <select
                  id="xero-connection-select"
                  className="rounded-md border px-2 py-1 text-sm"
                  value={selectedConnectionId ?? ''}
                  onChange={(event) => setSelectedConnectionId(event.target.value || null)}
                >
                  {(status?.connections ?? []).map((connection) => (
                    <option key={connection.connectionId} value={connection.connectionId}>
                      {connection.xeroTenantId}
                      {connection.status === 'expired' ? ' (token expired)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
              <p>
                When creating mappings, you can provide optional JSON metadata to control advanced Xero behaviour. For
                example:
              </p>
              <ul className="list-disc pl-5">
                <li>
                  <code>{`{"accountCode": "200"}`}</code> to target a specific revenue account.
                </li>
                <li>
                  <code>{`{"taxComponents": [{"name":"GST","rate":15}]}`}</code> to capture multi-component tax rates.
                </li>
                <li>
                  <code>{`{"tracking":[{"name":"Region","option":"North"}]}`}</code> to set tracking categories.
                </li>
              </ul>
            </div>

            {canShowMappings ? (
              <XeroMappingManager
                connectionId={selectedConnectionId}
                xeroTenantId={selectedConnection?.xeroTenantId ?? null}
              />
            ) : (
              <div className="rounded border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
                Select a connection to manage mappings.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CSV Mode - Show mappings info even without OAuth connection */}
      {integrationMode === 'csv' && !hasConnection && (
        <Card id="xero-mapping-info-card" className="mt-6">
          <CardHeader>
            <CardTitle>Xero Mappings</CardTitle>
            <CardDescription>
              Configure mappings to specify which Xero item codes and tax rates to use in CSV exports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
              <p>
                To configure mappings for CSV export, you can either:
              </p>
              <ul className="list-disc pl-5 mt-2">
                <li>Connect to Xero via OAuth (even temporarily) to fetch available items and tax rates</li>
                <li>Or manually configure mappings in the database</li>
              </ul>
              <p className="mt-2">
                Mappings tell the CSV export which Xero item codes and account codes to use for each service,
                and which Xero tax rate codes to use for each tax region.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default XeroIntegrationSettings;
