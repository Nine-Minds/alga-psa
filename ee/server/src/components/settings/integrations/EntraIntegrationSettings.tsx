'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import {
  getEntraIntegrationStatus,
  startEntraSync,
  initiateEntraDirectOAuth,
  disconnectEntraIntegration,
  unmapEntraTenant,
  type EntraStatusResponse,
} from '@alga-psa/integrations/actions';
import {
  EntraTenantMappingTable,
  type EntraMappingSummary,
  type EntraSkippedTenant,
} from './EntraTenantMappingTable';
import EntraSyncHistoryPanel from './EntraSyncHistoryPanel';
import EntraReconciliationQueue from './EntraReconciliationQueue';
import {
  buildEntraConnectionOptions,
  shouldShowAmbiguousQueue,
  shouldShowFieldSyncControls,
} from './entraIntegrationSettingsGates';
import { EntraCippConnectDialog } from './EntraCippConnectDialog';

type GuidedStepId = 'connect' | 'discover' | 'map' | 'sync';
type GuidedStepVisualState = 'current' | 'complete' | 'locked';

const WIZARD_STEPS = [
  { id: 'connect' as const, title: 'Connect', description: 'Choose Direct Microsoft partner auth or CIPP.' },
  { id: 'discover' as const, title: 'Discover Tenants', description: 'Load and persist managed Entra tenants for this MSP tenant.' },
  { id: 'map' as const, title: 'Map Tenants to Clients', description: 'Review auto-match suggestions and confirm mappings.' },
  { id: 'sync' as const, title: 'Initial Sync', description: 'Start the first sync run for confirmed mappings.' },
] as const;

function deriveGuidedStepState(params: {
  status: EntraStatusResponse | null;
  mappedCount: number;
}): {
  currentStep: GuidedStepId;
  isConnected: boolean;
  hasDiscovery: boolean;
  hasConfirmedMappings: boolean;
} {
  const isConnected = params.status?.status === 'connected';
  const hasDiscovery = Boolean(params.status?.lastDiscoveryAt);
  const hasConfirmedMappings = params.mappedCount > 0;

  if (!isConnected) {
    return { currentStep: 'connect', isConnected, hasDiscovery, hasConfirmedMappings };
  }

  if (!hasDiscovery) {
    return { currentStep: 'discover', isConnected, hasDiscovery, hasConfirmedMappings };
  }

  if (!hasConfirmedMappings) {
    return { currentStep: 'map', isConnected, hasDiscovery, hasConfirmedMappings };
  }

  return { currentStep: 'sync', isConnected, hasDiscovery, hasConfirmedMappings };
}

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
  const [syncAllLoading, setSyncAllLoading] = React.useState(false);
  const [syncAllMessage, setSyncAllMessage] = React.useState<string | null>(null);

  const [cippDialogOpen, setCippDialogOpen] = React.useState(false);
  const [directLoading, setDirectLoading] = React.useState(false);
  const [directError, setDirectError] = React.useState<string | null>(null);
  const [disconnectLoading, setDisconnectLoading] = React.useState(false);
  const [remappingRows, setRemappingRows] = React.useState<Record<string, boolean>>({});
  const [tableRefreshKey, setTableRefreshKey] = React.useState(0);

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
  const cippBaseUrl =
    status?.connectionType === 'cipp'
      ? status.connectionDetails?.cippBaseUrl || null
      : null;
  const directTenantIdLabel =
    status?.connectionType === 'direct'
      ? status.connectionDetails?.directTenantId || 'common (multi-tenant)'
      : null;
  const directCredentialSourceLabel =
    status?.connectionType === 'direct'
      ? status.connectionDetails?.directCredentialSource || 'unknown'
      : null;

  const formatDateTime = (value: string | null | undefined): string => {
    if (!value) return 'Never';
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Date(parsed).toLocaleString();
  };

  const connectionOptions = buildEntraConnectionOptions(cippFlag.enabled);
  const mappedTenantCount = Math.max(status?.mappedTenantCount ?? 0, mappingSummary.mapped);
  const guidedStepState = deriveGuidedStepState({
    status,
    mappedCount: mappedTenantCount,
  });
  const hasConfirmedMappings = guidedStepState.hasConfirmedMappings;
  const currentStepIndex = WIZARD_STEPS.findIndex((step) => step.id === guidedStepState.currentStep);
  const stepStates = WIZARD_STEPS.map((step, index) => {
    let state: GuidedStepVisualState = 'locked';
    if (index < currentStepIndex) {
      state = 'complete';
    } else if (index === currentStepIndex) {
      state = 'current';
    }

    return {
      ...step,
      stepNumber: index + 1,
      visualState: state,
    };
  });

  const currentStepMeta = React.useMemo(() => {
    if (guidedStepState.currentStep === 'connect') {
      return {
        title: 'Step 1: Connect',
        guidance: 'Select a connection option to continue onboarding.',
      };
    }
    if (guidedStepState.currentStep === 'discover') {
      return {
        title: 'Step 2: Discover',
        guidance: 'Run discovery to load managed Entra tenants before mapping.',
      };
    }
    if (guidedStepState.currentStep === 'map') {
      return {
        title: 'Step 3: Map',
        guidance: 'Confirm or adjust tenant mappings to unlock initial sync.',
      };
    }
    return {
      title: 'Step 4: Initial Sync',
      guidance: 'Start the first sync run for confirmed mappings.',
    };
  }, [guidedStepState.currentStep]);

  const handleScrollToMapping = React.useCallback(() => {
    const mappingPanel = document.getElementById('entra-mapping-step-panel');
    mappingPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSyncAllTenants = React.useCallback(async () => {
    setSyncAllLoading(true);
    setSyncAllMessage(null);
    try {
      const result = await startEntraSync({ scope: 'all-tenants' });
      if ('error' in result) {
        setSyncAllMessage(result.error || 'Failed to start full Entra sync.');
        return;
      }

      setSyncAllMessage(
        result.data?.runId ? `Sync started. Run ID: ${result.data.runId}` : 'Sync start request accepted.'
      );
      await loadStatus();
    } finally {
      setSyncAllLoading(false);
    }
  }, [loadStatus]);

  const handleConnectionOptionClick = async (optionId: string) => {
    if (optionId === 'cipp') {
      setCippDialogOpen(true);
    } else if (optionId === 'direct') {
      setDirectLoading(true);
      setDirectError(null);
      try {
        const result = await initiateEntraDirectOAuth();
        if ('error' in result) {
          setDirectError(result.error);
        } else if (result.success && result.data?.authUrl) {
          window.location.href = result.data.authUrl;
        }
      } catch (err: unknown) {
        setDirectError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setDirectLoading(false);
      }
    }
  };

  const handleDisconnect = async () => {
    setDisconnectLoading(true);
    try {
      await disconnectEntraIntegration();
      await loadStatus();
    } finally {
      setDisconnectLoading(false);
    }
  };

  const handleRemapSkipped = async (managedTenantId: string) => {
    setRemappingRows((curr) => ({ ...curr, [managedTenantId]: true }));
    try {
      await unmapEntraTenant({ managedTenantId });
      setTableRefreshKey((curr) => curr + 1);
    } finally {
      setRemappingRows((curr) => ({ ...curr, [managedTenantId]: false }));
    }
  };

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
            {stepStates.map((step) => (
              <div
                key={step.stepNumber}
                className="rounded-lg border border-border/60 bg-muted/30 p-4"
                id={`entra-step-${step.stepNumber}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Step {step.stepNumber}</p>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {step.visualState}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold">{step.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-current-step-card">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Step</p>
            <p className="mt-1 text-sm font-semibold">{currentStepMeta.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{currentStepMeta.guidance}</p>

            <div className="mt-3">
              {guidedStepState.currentStep === 'connect' ? (
                <p className="text-sm text-muted-foreground">
                  Connection options appear below.
                </p>
              ) : null}
              {guidedStepState.currentStep === 'discover' ? (
                <Button id="entra-run-discovery" type="button">
                  Run Discovery
                </Button>
              ) : null}
              {guidedStepState.currentStep === 'map' ? (
                <Button id="entra-review-mappings" type="button" onClick={() => handleScrollToMapping()}>
                  Review Mappings
                </Button>
              ) : null}
              {guidedStepState.currentStep === 'sync' ? (
                <Button
                  id="entra-run-initial-sync"
                  type="button"
                  disabled={!hasConfirmedMappings}
                >
                  Run Initial Sync
                </Button>
              ) : null}
            </div>
          </div>

          {status?.status !== 'connected' ? (
            <div className="space-y-3 rounded-lg border border-border/70 bg-background p-4">
              <p className="text-sm font-semibold">Connection Options</p>
              {directError ? (
                <p className="text-sm text-destructive">{directError}</p>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {connectionOptions.map((option) => (
                  <div
                    key={option.id}
                    className="cursor-pointer rounded-lg border border-border/60 bg-muted/20 p-3 transition-colors hover:border-primary/50 hover:bg-muted/40"
                    id={`entra-connection-option-${option.id}`}
                    onClick={() => !directLoading && handleConnectionOptionClick(option.id)}
                  >
                    <p className="text-sm font-medium">
                      {option.title}
                      {option.id === 'direct' && directLoading && ' (Connecting...)'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-mapping-step-panel">
            <div className="mb-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <p><span className="font-medium text-foreground">Mapped:</span> {mappingSummary.mapped}</p>
              <p><span className="font-medium text-foreground">Skipped:</span> {mappingSummary.skipped}</p>
              <p><span className="font-medium text-foreground">Needs Review:</span> {mappingSummary.needsReview}</p>
            </div>
            <EntraTenantMappingTable
              onSummaryChange={setMappingSummary}
              onSkippedTenantsChange={setSkippedTenants}
              onPersistedMappingChange={loadStatus}
              refreshKey={tableRefreshKey}
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
                      onClick={() => void handleRemapSkipped(tenant.managedTenantId)}
                      disabled={remappingRows[tenant.managedTenantId]}
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
              <div className="flex gap-2">
                {status?.status === 'connected' ? (
                  <Button
                    id="entra-disconnect"
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleDisconnect()}
                    disabled={disconnectLoading || statusLoading}
                  >
                    Disconnect
                  </Button>
                ) : null}
                <Button id="entra-refresh-status" type="button" size="sm" variant="ghost" onClick={loadStatus} disabled={statusLoading}>
                  Refresh
                </Button>
              </div>
            </div>
            <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">Connection:</span> {status?.status || 'not_connected'}</p>
              <p><span className="font-medium text-foreground">Connection Type:</span> {status?.connectionType || 'Not configured'}</p>
              {status?.connectionType === 'cipp' ? (
                <p><span className="font-medium text-foreground">CIPP Server:</span> {cippBaseUrl || 'Not available'}</p>
              ) : null}
              {status?.connectionType === 'direct' ? (
                <p><span className="font-medium text-foreground">Microsoft Tenant:</span> {directTenantIdLabel}</p>
              ) : null}
              {status?.connectionType === 'direct' ? (
                <p><span className="font-medium text-foreground">Credential Source:</span> {directCredentialSourceLabel}</p>
              ) : null}
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

          {shouldShowFieldSyncControls(fieldSyncFlag.enabled) ? (
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

          {shouldShowAmbiguousQueue(ambiguousQueueFlag.enabled) ? (
            <EntraReconciliationQueue />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              id="entra-sync-all-tenants"
              type="button"
              variant="outline"
              disabled={!hasConfirmedMappings || syncAllLoading}
              onClick={() => void handleSyncAllTenants()}
            >
              {syncAllLoading ? 'Starting…' : 'Sync All Tenants Now'}
            </Button>
          </div>
          {syncAllMessage ? (
            <p className="text-sm text-muted-foreground" id="entra-sync-all-tenants-feedback">
              {syncAllMessage}
            </p>
          ) : null}

          <EntraSyncHistoryPanel />
        </CardContent>
      </Card>

      <EntraCippConnectDialog
        open={cippDialogOpen}
        onOpenChange={setCippDialogOpen}
        onSuccess={loadStatus}
      />
    </div>
  );
}
