'use client';

import React, { useEffect, useState, useTransition } from 'react';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Alert, AlertDescription } from '../../ui/Alert';
import LoadingIndicator from '../../ui/LoadingIndicator';
import { XeroMappingManager } from '../../integrations/xero/XeroMappingManager';
import {
  getXeroConnectionStatus,
  type XeroConnectionStatus
} from 'server/src/lib/actions/integrations/xeroActions';

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

const XeroIntegrationSettings: React.FC = () => {
  const [status, setStatus] = useState<XeroConnectionStatus | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefresh] = useTransition();

  useEffect(() => {
    const mocks = getPlaywrightAccountingMocks()?.status?.xero;
    if (mocks) {
      setStatus(mocks);
      setSelectedConnectionId(mocks.defaultConnectionId ?? null);
      setError(mocks.error ?? null);
      setIsLoading(false);
      return;
    }
    refreshStatus();
  }, []);

  const refreshStatus = () => {
    startRefresh(async () => {
      setIsLoading(true);
      try {
        const mocks = getPlaywrightAccountingMocks()?.status?.xero;
        if (mocks) {
          setStatus(mocks);
          setSelectedConnectionId((prev) => prev ?? mocks.defaultConnectionId ?? null);
          setError(mocks.error ?? null);
        } else {
          const result = await getXeroConnectionStatus();
          setStatus(result);
          setSelectedConnectionId((prev) => prev ?? result.defaultConnectionId ?? null);
          setError(result.error ?? null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load Xero status.';
        setError(message);
        setStatus(null);
        setSelectedConnectionId(null);
      } finally {
        setIsLoading(false);
      }
    });
  };

  const hasConnection = status?.connections?.length && status.connections.length > 0;
  const canShowMappings = Boolean(hasConnection && selectedConnectionId);

  return (
    <Card id="xero-mapping-card">
      <CardHeader>
        <CardTitle>Xero Integration</CardTitle>
        <CardDescription>Manage mappings between Alga PSA and your Xero organisation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(isLoading || isRefreshing) && (
          <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Loading Xero connection…" />
        )}

        {!isLoading && !isRefreshing ? (
          <>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {!hasConnection ? (
              <div className="rounded border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
                No Xero connection is configured for this tenant. Connect Xero before managing mappings.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {status?.connected ? 'Xero connection active' : 'Xero connection needs attention'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Choose the Xero connection to manage mapping data.
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
                    When creating mappings, you can provide optional JSON metadata to control advanced Xero
                    behaviour. For example:
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
                  <XeroMappingManager connectionId={selectedConnectionId} />
                ) : (
                  <div className="rounded border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
                    Select a connection to manage mappings.
                  </div>
                )}
              </>
            )}
          </>
        ) : null}
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <Button
          id="xero-refresh-status"
          variant="outline"
          onClick={refreshStatus}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh Status'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Need help? Review the Xero onboarding guide for connection setup steps.
        </p>
      </CardFooter>
    </Card>
  );
};

export default XeroIntegrationSettings;
