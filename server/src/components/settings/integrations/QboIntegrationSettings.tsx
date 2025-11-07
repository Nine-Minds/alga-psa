'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Alert, AlertDescription } from '../../ui/Alert';
import LoadingIndicator from '../../ui/LoadingIndicator';
import { CheckCircle, AlertCircle, Link, Unlink } from 'lucide-react';
import {
  disconnectQbo,
  getQboConnectionStatus,
  type QboConnectionStatus,
  type QboConnectionSummary
} from '../../../lib/actions/integrations/qboActions';
import QboDisconnectConfirmModal from './QboDisconnectConfirmModal';
import { QboMappingManager } from '../../integrations/qbo/QboMappingManager';

type PlaywrightAccountingMocks = {
  status?: {
    qbo?: QboConnectionStatus;
  };
};

type LegacyQboMocks = {
  connectionStatus?: QboConnectionStatus;
};

function getMockedQboStatus(): QboConnectionStatus | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const globalWithMocks = window as typeof window & {
    __ALGA_PLAYWRIGHT_ACCOUNTING__?: PlaywrightAccountingMocks;
    __ALGA_PLAYWRIGHT_QBO__?: LegacyQboMocks;
  };

  return (
    globalWithMocks.__ALGA_PLAYWRIGHT_ACCOUNTING__?.status?.qbo ??
    globalWithMocks.__ALGA_PLAYWRIGHT_QBO__?.connectionStatus
  );
}

const QboIntegrationSettings: React.FC = () => {
  const [status, setStatus] = useState<QboConnectionStatus | null>(null);
  const [selectedRealmId, setSelectedRealmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefresh] = useTransition();
  const [isDisconnecting, startDisconnectTransition] = useTransition();
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  const applyStatus = useCallback((next: QboConnectionStatus | null) => {
    setStatus(next);
    if (!next) {
      setSelectedRealmId(null);
      return;
    }

    setSelectedRealmId((prev) => {
      const connections = next.connections ?? [];
      if (connections.length === 0) {
        return null;
      }
      if (prev && connections.some((connection) => connection.realmId === prev)) {
        return prev;
      }
      return next.defaultRealmId ?? connections[0]?.realmId ?? null;
    });
  }, []);

  const refreshStatus = useCallback(() => {
    startRefresh(async () => {
      setIsLoading(true);
      try {
        const mockStatus = getMockedQboStatus();
        if (mockStatus) {
          applyStatus(mockStatus);
          return;
        }

        const result = await getQboConnectionStatus();
        applyStatus(result);
        setError(result.error ?? null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load QuickBooks connection status.';
        setStatus(null);
        setSelectedRealmId(null);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    });
  }, [applyStatus]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qboStatus = params.get('qbo_status');
      const qboError = params.get('qbo_error');
      const qboMessage = params.get('message');

      if (qboStatus === 'success') {
        setSuccessMessage('Successfully connected to QuickBooks Online.');
        setError(null);
      } else if (qboStatus === 'failure' || qboError) {
        const detail = qboMessage ?? qboError ?? '';
        setError(
          detail
            ? `QuickBooks connection failed: ${detail}`
            : 'QuickBooks connection failed.'
        );
        setSuccessMessage(null);
      }

      if (qboStatus || qboError || qboMessage) {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }

    const mockStatus = getMockedQboStatus();
    if (mockStatus) {
      applyStatus(mockStatus);
      setIsLoading(false);
      return;
    }

    refreshStatus();
  }, [applyStatus, refreshStatus]);

  const handleConnect = () => {
    setSuccessMessage(null);
    setError(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/api/integrations/qbo/connect';
    }
  };

  const handleDisconnectConfirm = () => {
    setShowDisconnectModal(false);
    startDisconnectTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await disconnectQbo();
        if (result.success) {
          setSuccessMessage('QuickBooks Online connection successfully disconnected.');
        } else {
          setError(result.error ?? 'Failed to disconnect QuickBooks Online.');
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while disconnecting QuickBooks.';
        setError(message);
      } finally {
        refreshStatus();
      }
    });
  };

  const hasConnections = Boolean(status?.connections?.length);
  const selectedConnection: QboConnectionSummary | null = useMemo(() => {
    if (!status?.connections?.length) {
      return null;
    }
    return (
      status.connections.find((connection) => connection.realmId === selectedRealmId) ??
      status.connections[0] ??
      null
    );
  }, [status, selectedRealmId]);

  const displayedError = error ?? status?.error ?? null;
  const shouldShowErrorAlert =
    Boolean(displayedError) &&
    !(displayedError === 'No QuickBooks connections configured.' && !hasConnections);

  const shouldShowConnectInfo =
    !hasConnections ||
    !selectedConnection ||
    selectedConnection.status === 'expired' ||
    selectedConnection.status === 'error';

  const isMappingAvailable =
    Boolean(selectedConnection) && selectedConnection?.status === 'active';

  const renderStatusPanel = () => {
    if (isLoading || isRefreshing) {
      return <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Checking QuickBooks connection…" />;
    }

    if (!hasConnections) {
      return (
        <div className="flex gap-3">
          <AlertCircle className="mt-1 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Not connected to QuickBooks Online</p>
            <p className="text-sm text-muted-foreground">
              Connect your QuickBooks Online company to manage mappings and export invoices manually.
            </p>
          </div>
        </div>
      );
    }

    if (!selectedConnection) {
      return (
        <div className="flex gap-3">
          <AlertCircle className="mt-1 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Connection data unavailable</p>
            <p className="text-sm text-muted-foreground">
              Refresh the connection status or reconnect QuickBooks to continue managing mappings.
            </p>
          </div>
        </div>
      );
    }

    const connectionNeedsAttention = selectedConnection.status !== 'active';

    return (
      <div className="flex gap-3">
        {connectionNeedsAttention ? (
          <AlertCircle className="mt-1 h-5 w-5 text-red-500" />
        ) : (
          <CheckCircle className="mt-1 h-5 w-5 text-green-500" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {connectionNeedsAttention
              ? 'QuickBooks connection requires attention'
              : 'Connected to QuickBooks Online'}
          </p>
          <p className="text-sm text-muted-foreground">
            {connectionNeedsAttention ? 'Realm' : 'Active realm'}{' '}
            <span className="font-semibold">{selectedConnection.displayName}</span>
            {selectedConnection.status === 'expired'
              ? ' (authorization expired)'
              : ''}
          </p>
          {connectionNeedsAttention && selectedConnection.error ? (
            <p className="text-xs text-muted-foreground">{selectedConnection.error}</p>
          ) : null}
          {status?.connections && status.connections.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              You have {status.connections.length} QuickBooks realms connected. Select one below to manage its mappings.
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <>
      <Card id="qbo-integration-settings-card">
        <CardHeader>
          <CardTitle>QuickBooks Online Integration</CardTitle>
          <CardDescription>
            Connect your QuickBooks Online realm to manage mappings and deliver accounting export batches from the billing dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {successMessage ? (
            <Alert variant="success" id="qbo-success-alert">
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}

          {shouldShowErrorAlert ? (
            <Alert variant="destructive" id="qbo-error-alert">
              <AlertDescription>{displayedError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
            {renderStatusPanel()}
          </div>

          {shouldShowConnectInfo ? (
            <p className="text-sm text-muted-foreground" id="qbo-connect-info-text">
              Clicking &lsquo;Connect to QuickBooks Online&rsquo; opens Intuit authorisation in a new window. You&rsquo;ll
              return here once the connection completes.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {hasConnections ? (
              <>
                <Button
                  id="qbo-refresh-status"
                  variant="outline"
                  onClick={refreshStatus}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Refreshing…' : 'Refresh Status'}
                </Button>
                <Button
                  id="qbo-connect-secondary"
                  variant="secondary"
                  onClick={handleConnect}
                  disabled={isRefreshing}
                >
                  Connect another QuickBooks realm
                </Button>
                <Button
                  id="qbo-disconnect-button"
                  variant="destructive"
                  onClick={() => setShowDisconnectModal(true)}
                  disabled={isDisconnecting}
                >
                  {isDisconnecting ? (
                    <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Disconnecting…" />
                  ) : (
                    <>
                      <Unlink className="mr-2 h-4 w-4" /> Disconnect
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                id="qbo-connect-button"
                onClick={handleConnect}
                disabled={isLoading || isRefreshing}
              >
                <Link className="mr-2 h-4 w-4" />
                Connect to QuickBooks Online
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center sm:text-right">
            Need help? Review the QuickBooks onboarding guide before inviting finance to export invoices.
          </p>
        </CardFooter>
      </Card>

      <QboDisconnectConfirmModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        onConfirm={handleDisconnectConfirm}
        isDisconnecting={isDisconnecting}
      />

      {hasConnections ? (
        <Card id="qbo-mapping-card" className="mt-6">
          <CardHeader>
            <CardTitle>QuickBooks Online Mappings</CardTitle>
            <CardDescription>
              Map Alga services, tax regions, and payment terms to QuickBooks items, tax codes, and payment terms before exporting invoices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Choose the QuickBooks realm to manage mapping data.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground" htmlFor="qbo-realm-select">
                  Realm
                </label>
                <select
                  id="qbo-realm-select"
                  className="rounded-md border px-2 py-1 text-sm"
                  value={selectedRealmId ?? ''}
                  onChange={(event) => setSelectedRealmId(event.target.value || null)}
                >
                  {(status?.connections ?? []).map((connection) => (
                    <option key={connection.realmId} value={connection.realmId}>
                      {connection.displayName}
                      {connection.status === 'expired' ? ' (reauthorisation required)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
              <p className="mb-2">
                Optional metadata can store QuickBooks-specific instructions. Examples:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <code>{'{"classId":"100000000000123456"}'}</code> to assign a class to exported invoices.
                </li>
                <li>
                  <code>{'{"departmentId":"1"}'}</code> to route revenue to a department.
                </li>
                <li>
                  <code>{'{"skipSyncToken": true}'}</code> to bypass sync token checks when an invoice is recreated.
                </li>
              </ul>
            </div>

            {isMappingAvailable && selectedConnection ? (
              <QboMappingManager
                realmId={selectedConnection.realmId}
                realmDisplayValue={selectedConnection.displayName}
              />
            ) : (
              <div className="rounded border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
                {selectedConnection?.status === 'expired'
                  ? 'Reconnect this QuickBooks realm to manage mappings.'
                  : 'Select a QuickBooks realm to manage mappings.'}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
};

export default QboIntegrationSettings;
