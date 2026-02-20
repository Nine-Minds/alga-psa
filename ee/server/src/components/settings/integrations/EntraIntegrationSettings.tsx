'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { getEntraIntegrationStatus, type EntraStatusResponse } from '@alga-psa/integrations/actions';
import {
  EntraTenantMappingTable,
  type EntraMappingSummary,
  type EntraSkippedTenant,
} from './EntraTenantMappingTable';
import EntraSyncHistoryPanel from './EntraSyncHistoryPanel';

const WIZARD_STEPS = [
  { id: 1, title: 'Connect', description: 'Choose Direct Microsoft partner auth or CIPP.' },
  { id: 2, title: 'Discover Tenants', description: 'Load and persist managed Entra tenants for this MSP tenant.' },
  { id: 3, title: 'Map Tenants to Clients', description: 'Review auto-match suggestions and confirm mappings.' },
  { id: 4, title: 'Initial Sync', description: 'Start the first sync run for confirmed mappings.' },
] as const;

export default function EntraIntegrationSettings() {
  const uiFlag = useFeatureFlag('entra-integration-ui', { defaultValue: false });
  const cippFlag = useFeatureFlag('entra-integration-cipp', { defaultValue: false });
  const fieldSyncFlag = useFeatureFlag('entra-integration-field-sync', { defaultValue: false });
  const ambiguousQueueFlag = useFeatureFlag('entra-integration-ambiguous-queue', { defaultValue: false });
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<EntraStatusResponse | null>(null);
  const [mappingSummary, setMappingSummary] = React.useState<EntraMappingSummary>({
    mapped: 0,
    skipped: 0,
    needsReview: 0,
  });
  const [skippedTenants, setSkippedTenants] = React.useState<EntraSkippedTenant[]>([]);

  const loadStatus = React.useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const result = await getEntraIntegrationStatus();
      if ('error' in result) {
        setStatus(null);
        setStatusError(result.error || 'Failed to load Entra connection status.');
      } else {
        setStatus(result.data || null);
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const validationMessage =
    status?.lastValidationError && typeof status.lastValidationError === 'object'
      ? String((status.lastValidationError as { message?: unknown }).message || '')
      : '';

  const formatDateTime = (value: string | null | undefined): string => {
    if (!value) return 'Never';
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Date(parsed).toLocaleString();
  };

  const connectionOptions = [
    {
      id: 'direct',
      title: 'Direct Microsoft Partner',
      description: 'Use Microsoft delegated partner access with the configured OAuth app credentials.',
    },
    ...(cippFlag.enabled
      ? [
          {
            id: 'cipp',
            title: 'CIPP',
            description: 'Use a CIPP endpoint/token as the Entra data source for discovery and sync.',
          },
        ]
      : []),
  ];
  const hasConfirmedMappings = (status?.mappedTenantCount || 0) > 0;

  if (!uiFlag.enabled) {
    return (
      <div className="space-y-6" id="entra-integration-settings-disabled">
        <Card>
          <CardHeader>
            <CardTitle>Microsoft Entra Integration</CardTitle>
            <CardDescription>
              Entra integration UI is currently disabled for this tenant.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" id="entra-integration-settings">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Microsoft Entra Integration</CardTitle>
            <Badge variant="secondary">Enterprise</Badge>
          </div>
          <CardDescription>
            Configure partner-level Entra access, discover managed tenants, map them to clients, and run sync workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            {WIZARD_STEPS.map((step) => (
              <div
                key={step.id}
                className="rounded-lg border border-border/60 bg-muted/30 p-4"
                id={`entra-step-${step.id}`}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Step {step.id}</p>
                <p className="mt-1 text-sm font-semibold">{step.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border border-border/70 bg-background p-4">
            <p className="text-sm font-semibold">Connection Options</p>
            <div className="grid gap-3 md:grid-cols-2">
              {connectionOptions.map((option) => (
                <div
                  key={option.id}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3"
                  id={`entra-connection-option-${option.id}`}
                >
                  <p className="text-sm font-medium">{option.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background p-4">
            <div className="mb-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <p><span className="font-medium text-foreground">Mapped:</span> {mappingSummary.mapped}</p>
              <p><span className="font-medium text-foreground">Skipped:</span> {mappingSummary.skipped}</p>
              <p><span className="font-medium text-foreground">Needs Review:</span> {mappingSummary.needsReview}</p>
            </div>
            <EntraTenantMappingTable
              onSummaryChange={setMappingSummary}
              onSkippedTenantsChange={setSkippedTenants}
            />
          </div>

          <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-skipped-tenants-panel">
            <p className="text-sm font-semibold">Skipped Tenants</p>
            {skippedTenants.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No tenants are currently marked as skipped.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {skippedTenants.map((tenant) => (
                  <div
                    key={tenant.managedTenantId}
                    className="flex items-center justify-between rounded-md border border-border/60 p-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{tenant.displayName || tenant.managedTenantId}</p>
                      <p className="text-xs text-muted-foreground">{tenant.primaryDomain || 'No primary domain'}</p>
                    </div>
                    <Button
                      id={`entra-remap-skipped-${tenant.managedTenantId}`}
                      type="button"
                      size="sm"
                      variant="outline"
                    >
                      Remap
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4" id="entra-connection-status-panel">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Status</p>
              <Button id="entra-refresh-status" type="button" size="sm" variant="ghost" onClick={loadStatus} disabled={statusLoading}>
                Refresh
              </Button>
            </div>
            <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">Connection:</span> {status?.status || 'not_connected'}</p>
              <p><span className="font-medium text-foreground">Connection Type:</span> {status?.connectionType || 'Not configured'}</p>
              <p><span className="font-medium text-foreground">Last Discovery:</span> {formatDateTime(status?.lastDiscoveryAt)}</p>
              <p><span className="font-medium text-foreground">Mapped Tenants:</span> {status?.mappedTenantCount ?? 0}</p>
              <p>
                <span className="font-medium text-foreground">Next Sync Interval:</span>{' '}
                {status?.nextSyncIntervalMinutes ? `Every ${status.nextSyncIntervalMinutes} minutes` : 'Not configured'}
              </p>
              <p><span className="font-medium text-foreground">Last Validated:</span> {formatDateTime(status?.lastValidatedAt)}</p>
              <p><span className="font-medium text-foreground">Validation Error:</span> {validationMessage || 'None'}</p>
            </div>
            {statusError ? (
              <p className="mt-2 text-sm text-destructive">{statusError}</p>
            ) : null}
          </div>

          {fieldSyncFlag.enabled ? (
            <div
              className="rounded-lg border border-border/70 bg-background p-4"
              id="entra-field-sync-controls-panel"
            >
              <p className="text-sm font-semibold">Field Sync Controls</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which Entra profile fields may overwrite local contact fields during sync.
              </p>
            </div>
          ) : null}

          {ambiguousQueueFlag.enabled ? (
            <div
              className="rounded-lg border border-border/70 bg-background p-4"
              id="entra-ambiguous-queue-panel"
            >
              <p className="text-sm font-semibold">Ambiguous Match Queue</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Review and resolve Entra users that matched multiple contacts or require manual linking.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button id="entra-run-discovery" type="button" variant="outline" disabled>
              Run Discovery
            </Button>
            <Button
              id="entra-run-initial-sync"
              type="button"
              variant="outline"
              disabled={!hasConfirmedMappings}
            >
              Run Initial Sync
            </Button>
            <Button id="entra-sync-all-tenants" type="button" variant="outline" disabled={!hasConfirmedMappings}>
              Sync All Tenants Now
            </Button>
          </div>

          <EntraSyncHistoryPanel />
        </CardContent>
      </Card>
    </div>
  );
}
