'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import {
  getEntraIntegrationStatus,
  getEntraSyncRunHistory,
  discoverEntraManagedTenants,
  startEntraSync,
  updateEntraFieldSyncConfig,
  initiateEntraDirectOAuth,
  disconnectEntraIntegration,
  unmapEntraTenant,
  type EntraFieldSyncConfig,
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

const DEFAULT_FIELD_SYNC_CONFIG: EntraFieldSyncConfig = {
  displayName: false,
  email: false,
  phone: false,
  role: false,
  upn: false,
};

type FieldSyncOption = {
  key: keyof EntraFieldSyncConfig;
  label: string;
  description: string;
};

const FIELD_SYNC_OPTIONS: FieldSyncOption[] = [
  {
    key: 'displayName',
    label: 'Display Name',
    description: 'Allow Entra display name to overwrite contact full name on linked contacts.',
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Allow Entra email/UPN to overwrite contact email on linked contacts.',
  },
  {
    key: 'phone',
    label: 'Phone',
    description: 'Allow Entra phone values to overwrite contact phone number on linked contacts.',
  },
  {
    key: 'role',
    label: 'Role',
    description: 'Allow Entra job title to overwrite contact role on linked contacts.',
  },
  {
    key: 'upn',
    label: 'UPN',
    description: 'Allow Entra UPN to overwrite the stored Entra principal name on linked contacts.',
  },
];

function normalizeFieldSyncConfig(value: unknown): EntraFieldSyncConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_FIELD_SYNC_CONFIG };
  }

  const source = value as Record<string, unknown>;
  return {
    displayName: source.displayName === true,
    email: source.email === true,
    phone: source.phone === true,
    role: source.role === true,
    upn: source.upn === true,
  };
}

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
  const [discoveryLoading, setDiscoveryLoading] = React.useState(false);
  const [discoveryMessage, setDiscoveryMessage] = React.useState<string | null>(null);
  const [initialSyncLoading, setInitialSyncLoading] = React.useState(false);
  const [initialSyncMessage, setInitialSyncMessage] = React.useState<string | null>(null);
  const [hasMaintenanceSyncRun, setHasMaintenanceSyncRun] = React.useState(false);
  const [maintenanceSignalLoaded, setMaintenanceSignalLoaded] = React.useState(false);
  const [showMappingDetails, setShowMappingDetails] = React.useState(false);
  const [fieldSyncConfig, setFieldSyncConfig] = React.useState<EntraFieldSyncConfig>({
    ...DEFAULT_FIELD_SYNC_CONFIG,
  });
  const [fieldSyncDirty, setFieldSyncDirty] = React.useState(false);
  const [fieldSyncSaving, setFieldSyncSaving] = React.useState(false);
  const [fieldSyncMessage, setFieldSyncMessage] = React.useState<string | null>(null);

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
        setFieldSyncConfig(normalizeFieldSyncConfig(result.data?.fieldSyncConfig));
        setFieldSyncDirty(false);
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadMaintenanceSignal = React.useCallback(async () => {
    try {
      const result = await getEntraSyncRunHistory(10);
      if ('error' in result) {
        return;
      }

      const runs = Array.isArray(result.data?.runs) ? result.data.runs : [];
      const hasOperationalRun = runs.some((run) => run?.runType === 'initial' || run?.runType === 'all-tenants');
      setHasMaintenanceSyncRun(hasOperationalRun);
    } finally {
      setMaintenanceSignalLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    void loadMaintenanceSignal();
  }, [loadMaintenanceSignal]);

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
  const isConnectStepCurrent = guidedStepState.currentStep === 'connect';
  const isDiscoverStepCurrent = guidedStepState.currentStep === 'discover';
  const isMapStepCurrent = guidedStepState.currentStep === 'map';
  const isSyncStepCurrent = guidedStepState.currentStep === 'sync';
  const settingsMode: 'onboarding' | 'maintenance' = hasMaintenanceSyncRun ? 'maintenance' : 'onboarding';
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

  const handleOpenMappingDetails = React.useCallback(() => {
    setShowMappingDetails(true);
    requestAnimationFrame(() => {
      handleScrollToMapping();
    });
  }, [handleScrollToMapping]);

  const handleToggleMappingDetails = React.useCallback(() => {
    setShowMappingDetails((current) => {
      const next = !current;
      if (next) {
        requestAnimationFrame(() => {
          handleScrollToMapping();
        });
      }
      return next;
    });
  }, [handleScrollToMapping]);

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
      await loadMaintenanceSignal();
    } finally {
      setSyncAllLoading(false);
    }
  }, [loadMaintenanceSignal, loadStatus]);

  const handleRunDiscovery = React.useCallback(async () => {
    setDiscoveryLoading(true);
    setDiscoveryMessage(null);
    try {
      const result = await discoverEntraManagedTenants();
      if ('error' in result) {
        setDiscoveryMessage(result.error || 'Failed to run tenant discovery.');
        return;
      }

      const discoveredCount = Number(result.data?.discoveredTenantCount || 0);
      setDiscoveryMessage(
        `Discovery completed. ${discoveredCount} tenant${discoveredCount === 1 ? '' : 's'} discovered.`
      );
      setTableRefreshKey((current) => current + 1);
      await loadStatus();
    } finally {
      setDiscoveryLoading(false);
    }
  }, [loadStatus]);

  const handleRunInitialSync = React.useCallback(async () => {
    setInitialSyncLoading(true);
    setInitialSyncMessage(null);
    try {
      const result = await startEntraSync({ scope: 'initial' });
      if ('error' in result) {
        setInitialSyncMessage(result.error || 'Failed to start initial Entra sync.');
        return;
      }

      setInitialSyncMessage(
        result.data?.runId
          ? `Initial sync started. Run ID: ${result.data.runId}`
          : 'Initial sync start request accepted.'
      );
      await loadStatus();
      await loadMaintenanceSignal();
    } finally {
      setInitialSyncLoading(false);
    }
  }, [loadMaintenanceSignal, loadStatus]);

  const handleConnectionOptionClick = async (optionId: string) => {
    if (!isConnectStepCurrent) {
      return;
    }

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

  const handleFieldSyncToggle = React.useCallback((key: keyof EntraFieldSyncConfig, checked: boolean) => {
    setFieldSyncConfig((current) => ({
      ...current,
      [key]: checked,
    }));
    setFieldSyncDirty(true);
    setFieldSyncMessage(null);
  }, []);

  const handleResetFieldSync = React.useCallback(() => {
    setFieldSyncConfig(normalizeFieldSyncConfig(status?.fieldSyncConfig));
    setFieldSyncDirty(false);
    setFieldSyncMessage(null);
  }, [status?.fieldSyncConfig]);

  const handleSaveFieldSync = React.useCallback(async () => {
    setFieldSyncSaving(true);
    setFieldSyncMessage(null);
    try {
      const result = await updateEntraFieldSyncConfig(fieldSyncConfig);
      if ('error' in result) {
        setFieldSyncMessage(result.error || 'Failed to save field sync controls.');
        return;
      }

      setFieldSyncConfig(normalizeFieldSyncConfig(result.data));
      setFieldSyncDirty(false);
      setFieldSyncMessage('Field sync controls saved.');
      await loadStatus();
    } finally {
      setFieldSyncSaving(false);
    }
  }, [fieldSyncConfig, loadStatus]);

  React.useEffect(() => {
    if (settingsMode === 'maintenance' || isMapStepCurrent) {
      setShowMappingDetails(true);
      return;
    }

    setShowMappingDetails(false);
  }, [isMapStepCurrent, settingsMode]);

  const mappingAndSkippedSection = (
    <>
      <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-mapping-step-panel">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Step 3</p>
        <p className="mt-1 text-sm font-semibold">Map Tenants to Clients</p>
        <p className="mt-1 text-sm text-muted-foreground" id="entra-mapping-step-guidance">
          Review suggested matches, choose the correct client for each tenant, and confirm mappings before initial sync.
        </p>
        {isMapStepCurrent ? (
          <p className="mt-2 text-xs text-muted-foreground">This is your current onboarding step.</p>
        ) : null}
        <div className="mb-3 mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
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
    </>
  );

  const statusPanel = (
    <div className="entra-status-panel p-4" id="entra-connection-status-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connection Health</p>
          <p className="mt-1 text-sm font-semibold">Status</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            id="entra-status-connection-badge"
            variant={status?.status === 'connected' ? 'secondary' : 'outline'}
          >
            {status?.status || 'not_connected'}
          </Badge>
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

      <div className="entra-status-section mt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Overview</p>
        <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Connection:</span> {status?.status || 'not_connected'}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Connection Type:</span> {status?.connectionType || 'Not configured'}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Mapped Tenants:</span> {status?.mappedTenantCount ?? 0}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Next Sync Interval:</span>{' '}
            {status?.nextSyncIntervalMinutes ? `Every ${status.nextSyncIntervalMinutes} minutes` : 'Not configured'}
          </p>
        </div>
      </div>

      <div className="entra-status-section mt-3">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Connection Details</p>
          {status?.connectionType === 'cipp' ? (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">CIPP Server:</span> {cippBaseUrl || 'Not available'}
            </p>
          ) : null}
          {status?.connectionType === 'direct' ? (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Microsoft Tenant:</span> {directTenantIdLabel}
            </p>
          ) : null}
          {status?.connectionType === 'direct' ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Credential Source:</span> {directCredentialSourceLabel}
            </p>
          ) : null}
          {!status?.connectionType ? (
            <p className="mt-2 text-sm text-muted-foreground">Connect Entra to populate provider details.</p>
          ) : null}
          </div>

          <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Validation & Discovery</p>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Last Discovery:</span> {formatDateTime(status?.lastDiscoveryAt)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Last Validated:</span> {formatDateTime(status?.lastValidatedAt)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Validation Error:</span> {validationMessage || 'None'}
          </p>
          </div>
        </div>
      </div>
      {statusError ? (
        <p className="mt-2 text-sm text-destructive">{statusError}</p>
      ) : null}
    </div>
  );

  const fieldSyncControlsPanel = shouldShowFieldSyncControls(fieldSyncFlag.enabled) ? (
    <div
      className="rounded-lg border border-border/70 bg-background p-4"
      id="entra-field-sync-controls-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Field Sync Controls</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which Entra profile fields may overwrite local contact fields during sync.
          </p>
        </div>
        {settingsMode === 'onboarding' && isSyncStepCurrent ? (
          <Badge variant="outline">Review Before Initial Sync</Badge>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">
        {FIELD_SYNC_OPTIONS.map((option) => (
          <div
            key={option.key}
            className="flex items-start justify-between gap-3 rounded-md border border-border/50 p-3"
          >
            <div>
              <p className="text-sm font-medium">{option.label}</p>
              <p className="text-xs text-muted-foreground">{option.description}</p>
            </div>
            <Switch
              id={`entra-field-sync-${option.key}`}
              checked={fieldSyncConfig[option.key]}
              onCheckedChange={(value) => handleFieldSyncToggle(option.key, value)}
              disabled={fieldSyncSaving}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          id="entra-field-sync-save"
          type="button"
          size="sm"
          onClick={() => void handleSaveFieldSync()}
          disabled={!fieldSyncDirty || fieldSyncSaving}
        >
          {fieldSyncSaving ? 'Saving…' : 'Save Field Sync Controls'}
        </Button>
        <Button
          id="entra-field-sync-reset"
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleResetFieldSync()}
          disabled={!fieldSyncDirty || fieldSyncSaving}
        >
          Reset
        </Button>
      </div>
      {fieldSyncMessage ? (
        <p className="mt-2 text-sm text-muted-foreground" id="entra-field-sync-feedback">
          {fieldSyncMessage}
        </p>
      ) : null}
    </div>
  ) : null;

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
    <div
      className="space-y-6"
      id="entra-integration-settings"
      data-entra-mode={settingsMode}
      data-entra-mode-ready={maintenanceSignalLoaded ? 'true' : 'false'}
    >
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
          <div
            className="rounded-lg border border-border/70 bg-background p-4"
            id={settingsMode === 'onboarding' ? 'entra-mode-heading-onboarding' : 'entra-mode-heading-maintenance'}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {settingsMode === 'onboarding' ? 'Setup Mode' : 'Ongoing Operations Mode'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {settingsMode === 'onboarding'
                ? 'Complete each onboarding step in order: connect, discover, map, then run your first sync.'
                : 'Initial setup is complete. Focus here on sync operations, health checks, and maintenance reviews.'}
            </p>
          </div>

          {statusPanel}

          {settingsMode === 'onboarding' ? (
            <>
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
                    {step.id === 'map' && step.visualState === 'complete' ? (
                      <Button
                        id="entra-step-3-review-remap"
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        onClick={() => void handleToggleMappingDetails()}
                      >
                        {showMappingDetails ? 'Hide Review / Remap' : 'Review / Remap'}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-current-step-card">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Step</p>
                <p className="mt-1 text-sm font-semibold">{currentStepMeta.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{currentStepMeta.guidance}</p>

                <div className="mt-3">
                  {isConnectStepCurrent ? (
                    <p className="text-sm text-muted-foreground">
                      Connection options appear below.
                    </p>
                  ) : null}
                  {isDiscoverStepCurrent ? (
                    <div className="space-y-2">
                      <Button
                        id="entra-run-discovery"
                        type="button"
                        onClick={() => void handleRunDiscovery()}
                        disabled={discoveryLoading}
                      >
                        {discoveryLoading ? 'Running Discovery…' : 'Run Discovery'}
                      </Button>
                      {discoveryMessage ? (
                        <p className="text-sm text-muted-foreground" id="entra-run-discovery-feedback">
                          {discoveryMessage}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {isMapStepCurrent ? (
                    <Button id="entra-review-mappings" type="button" onClick={() => void handleOpenMappingDetails()}>
                      Review Mappings
                    </Button>
                  ) : null}
                  {isSyncStepCurrent ? (
                    <div className="space-y-2">
                      <Button
                        id="entra-run-initial-sync"
                        type="button"
                        onClick={() => void handleRunInitialSync()}
                        disabled={!hasConfirmedMappings || initialSyncLoading}
                      >
                        {initialSyncLoading ? 'Starting Initial Sync…' : 'Run Initial Sync'}
                      </Button>
                      {initialSyncMessage ? (
                        <p className="text-sm text-muted-foreground" id="entra-run-initial-sync-feedback">
                          {initialSyncMessage}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {fieldSyncControlsPanel}

              {isConnectStepCurrent ? (
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
            </>
          ) : (
            <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-maintenance-health-summary">
              <p className="text-sm font-semibold">Health Summary</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Review connection health, run maintenance operations, and monitor sync activity.
              </p>
            </div>
          )}

          {settingsMode === 'maintenance' ? fieldSyncControlsPanel : null}

          {settingsMode === 'onboarding' && showMappingDetails ? mappingAndSkippedSection : null}

          <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-ongoing-operations-panel">
            <p className="text-sm font-semibold">Ongoing Operations</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use these controls for manual sync operations after onboarding steps are complete.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {settingsMode === 'maintenance' ? (
                <Button
                  id="entra-run-discovery-maintenance"
                  type="button"
                  variant="outline"
                  onClick={() => void handleRunDiscovery()}
                  disabled={discoveryLoading}
                >
                  {discoveryLoading ? 'Running Discovery…' : 'Run Discovery Again'}
                </Button>
              ) : null}
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
            {settingsMode === 'maintenance' && discoveryMessage ? (
              <p className="mt-2 text-sm text-muted-foreground" id="entra-run-discovery-maintenance-feedback">
                {discoveryMessage}
              </p>
            ) : null}
            {syncAllMessage ? (
              <p className="mt-2 text-sm text-muted-foreground" id="entra-sync-all-tenants-feedback">
                {syncAllMessage}
              </p>
            ) : null}
          </div>

          <EntraSyncHistoryPanel />

          {shouldShowAmbiguousQueue(ambiguousQueueFlag.enabled) ? (
            <EntraReconciliationQueue />
          ) : null}

          {settingsMode === 'maintenance' ? mappingAndSkippedSection : null}
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
