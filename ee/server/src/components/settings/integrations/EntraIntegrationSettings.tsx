'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
  { id: 'connect' as const, titleKey: 'integrations.entra.settings.wizard.connect.title', descriptionKey: 'integrations.entra.settings.wizard.connect.description' },
  { id: 'discover' as const, titleKey: 'integrations.entra.settings.wizard.discover.title', descriptionKey: 'integrations.entra.settings.wizard.discover.description' },
  { id: 'map' as const, titleKey: 'integrations.entra.settings.wizard.map.title', descriptionKey: 'integrations.entra.settings.wizard.map.description' },
  { id: 'sync' as const, titleKey: 'integrations.entra.settings.wizard.sync.title', descriptionKey: 'integrations.entra.settings.wizard.sync.description' },
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
  labelKey: string;
  descriptionKey: string;
};

const FIELD_SYNC_OPTIONS: FieldSyncOption[] = [
  {
    key: 'displayName',
    labelKey: 'integrations.entra.settings.fieldSync.options.displayName.label',
    descriptionKey: 'integrations.entra.settings.fieldSync.options.displayName.description',
  },
  {
    key: 'email',
    labelKey: 'integrations.entra.settings.fieldSync.options.email.label',
    descriptionKey: 'integrations.entra.settings.fieldSync.options.email.description',
  },
  {
    key: 'phone',
    labelKey: 'integrations.entra.settings.fieldSync.options.phone.label',
    descriptionKey: 'integrations.entra.settings.fieldSync.options.phone.description',
  },
  {
    key: 'role',
    labelKey: 'integrations.entra.settings.fieldSync.options.role.label',
    descriptionKey: 'integrations.entra.settings.fieldSync.options.role.description',
  },
  {
    key: 'upn',
    labelKey: 'integrations.entra.settings.fieldSync.options.upn.label',
    descriptionKey: 'integrations.entra.settings.fieldSync.options.upn.description',
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

interface EntraIntegrationSettingsProps {
  /** Whether the user can use CIPP (premium feature). Defaults to true. */
  canUseCipp?: boolean;
}

export default function EntraIntegrationSettings({ canUseCipp: canUseCippTier = true }: EntraIntegrationSettingsProps) {
  const { t } = useTranslation('msp/integrations');
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
        setStatusError(result.error || t('integrations.entra.settings.errors.loadStatus'));
      } else {
        setStatus(result.data || null);
        setFieldSyncConfig(normalizeFieldSyncConfig(result.data?.fieldSyncConfig));
        setFieldSyncDirty(false);
      }
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

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
      ? status.connectionDetails?.directTenantId || t('integrations.entra.settings.connection.directTenantDefault')
      : null;
  const directCredentialSourceLabel =
    status?.connectionType === 'direct'
      ? status.connectionDetails?.directCredentialSource || t('integrations.entra.settings.errors.unknown')
      : null;

  const formatDateTime = (value: string | null | undefined): string => {
    if (!value) return t('integrations.entra.settings.validation.neverFormatted');
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Date(parsed).toLocaleString();
  };

  const connectionOptions = buildEntraConnectionOptions(cippFlag.enabled && canUseCippTier);
  // Only count rows the server confirms exist in entra_client_tenant_mappings. Auto-match
  // candidates surfaced by the preview table must not advance the wizard to Step 4 —
  // otherwise the map step never becomes "current" after discovery even though no confirm
  // action has run, and the wizard jumps straight to Run Initial Sync without mappings.
  const mappedTenantCount = status?.mappedTenantCount ?? 0;
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
        title: t('integrations.entra.settings.currentStep.connect.title'),
        guidance: t('integrations.entra.settings.currentStep.connect.guidance'),
      };
    }
    if (guidedStepState.currentStep === 'discover') {
      return {
        title: t('integrations.entra.settings.currentStep.discover.title'),
        guidance: t('integrations.entra.settings.currentStep.discover.guidance'),
      };
    }
    if (guidedStepState.currentStep === 'map') {
      return {
        title: t('integrations.entra.settings.currentStep.map.title'),
        guidance: t('integrations.entra.settings.currentStep.map.guidance'),
      };
    }
    return {
      title: t('integrations.entra.settings.currentStep.sync.title'),
      guidance: t('integrations.entra.settings.currentStep.sync.guidance'),
    };
  }, [guidedStepState.currentStep, t]);

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
        setSyncAllMessage(result.error || t('integrations.entra.settings.syncAll.failed'));
        return;
      }

      setSyncAllMessage(
        result.data?.runId
          ? t('integrations.entra.settings.syncAll.started', { runId: result.data.runId })
          : t('integrations.entra.settings.syncAll.startedNoId')
      );
      await loadStatus();
      await loadMaintenanceSignal();
    } finally {
      setSyncAllLoading(false);
    }
  }, [loadMaintenanceSignal, loadStatus, t]);

  const handleRunDiscovery = React.useCallback(async () => {
    setDiscoveryLoading(true);
    setDiscoveryMessage(null);
    try {
      const result = await discoverEntraManagedTenants();
      if ('error' in result) {
        setDiscoveryMessage(result.error || t('integrations.entra.settings.discovery.failed'));
        return;
      }

      const discoveredCount = Number(result.data?.discoveredTenantCount || 0);
      setDiscoveryMessage(
        discoveredCount === 1
          ? t('integrations.entra.settings.discovery.completedOne', { count: discoveredCount })
          : t('integrations.entra.settings.discovery.completed', { count: discoveredCount })
      );
      setTableRefreshKey((current) => current + 1);
      await loadStatus();
    } finally {
      setDiscoveryLoading(false);
    }
  }, [loadStatus, t]);

  const handleRunInitialSync = React.useCallback(async () => {
    setInitialSyncLoading(true);
    setInitialSyncMessage(null);
    try {
      const result = await startEntraSync({ scope: 'initial' });
      if ('error' in result) {
        setInitialSyncMessage(result.error || t('integrations.entra.settings.initialSync.failed'));
        return;
      }

      setInitialSyncMessage(
        result.data?.runId
          ? t('integrations.entra.settings.initialSync.started', { runId: result.data.runId })
          : t('integrations.entra.settings.initialSync.startedNoId')
      );
      await loadStatus();
      await loadMaintenanceSignal();
    } finally {
      setInitialSyncLoading(false);
    }
  }, [loadMaintenanceSignal, loadStatus, t]);

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
        setDirectError(err instanceof Error ? err.message : t('integrations.entra.settings.errors.unknown'));
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
        setFieldSyncMessage(result.error || t('integrations.entra.settings.fieldSync.feedback.saveFailed'));
        return;
      }

      setFieldSyncConfig(normalizeFieldSyncConfig(result.data));
      setFieldSyncDirty(false);
      setFieldSyncMessage(t('integrations.entra.settings.fieldSync.feedback.saved'));
      await loadStatus();
    } finally {
      setFieldSyncSaving(false);
    }
  }, [fieldSyncConfig, loadStatus, t]);

  React.useEffect(() => {
    // Auto-open the mapping panel whenever the map step is the active step or we're in
    // maintenance mode. Don't force-close it otherwise — the Review/Remap button owns
    // the closed state post-discovery so users can still re-open the preview.
    if (settingsMode === 'maintenance' || isMapStepCurrent) {
      setShowMappingDetails(true);
    }
  }, [isMapStepCurrent, settingsMode]);

  const mappingAndSkippedSection = (
    <>
      <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-mapping-step-panel">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('integrations.entra.settings.mapping.stepLabel')}</p>
        <p className="mt-1 text-sm font-semibold">{t('integrations.entra.settings.mapping.title')}</p>
        <p className="mt-1 text-sm text-muted-foreground" id="entra-mapping-step-guidance">
          {t('integrations.entra.settings.mapping.description')}
        </p>
        {isMapStepCurrent ? (
          <p className="mt-2 text-xs text-muted-foreground">{t('integrations.entra.settings.guidedStep.thisIsCurrent')}</p>
        ) : null}
        <div className="mb-3 mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
          <p><span className="font-medium text-foreground">{t('integrations.entra.settings.mapping.savedLabel')}</span> {status?.mappedTenantCount ?? 0}</p>
          <p><span className="font-medium text-foreground">{t('integrations.entra.settings.mapping.selectedLabel')}</span> {mappingSummary.mapped}</p>
          <p><span className="font-medium text-foreground">{t('integrations.entra.settings.mapping.skippedLabel')}</span> {mappingSummary.skipped}</p>
          <p><span className="font-medium text-foreground">{t('integrations.entra.settings.mapping.needsReviewLabel')}</span> {mappingSummary.needsReview}</p>
        </div>
        <EntraTenantMappingTable
          onSummaryChange={setMappingSummary}
          onSkippedTenantsChange={setSkippedTenants}
          onPersistedMappingChange={loadStatus}
          refreshKey={tableRefreshKey}
        />
      </div>

      <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-skipped-tenants-panel">
        <p className="text-sm font-semibold">{t('integrations.entra.settings.skipped.title')}</p>
        {skippedTenants.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('integrations.entra.settings.skipped.empty')}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {skippedTenants.map((tenant) => (
              <div
                key={tenant.managedTenantId}
                className="flex items-center justify-between rounded-md border border-border/60 p-2"
              >
                <div>
                  <p className="text-sm font-medium">{tenant.displayName || tenant.managedTenantId}</p>
                  <p className="text-xs text-muted-foreground">{tenant.primaryDomain || t('integrations.entra.settings.skipped.noPrimaryDomain')}</p>
                </div>
                <Button
                  id={`entra-remap-skipped-${tenant.managedTenantId}`}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRemapSkipped(tenant.managedTenantId)}
                  disabled={remappingRows[tenant.managedTenantId]}
                >
                  {t('integrations.entra.settings.skipped.remap')}
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
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('integrations.entra.settings.status.connectionHealth')}</p>
          <p className="mt-1 text-sm font-semibold">{t('integrations.entra.settings.status.label')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            id="entra-status-connection-badge"
            variant={status?.status === 'connected' ? 'secondary' : 'outline'}
          >
            {status?.status || t('integrations.entra.settings.connection.notConnectedStatus')}
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
              {t('integrations.entra.settings.actions.disconnect')}
            </Button>
          ) : (
            <Button
              id="entra-reconnect"
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleConnectionOptionClick('direct')}
              disabled={directLoading || statusLoading}
            >
              {directLoading
                ? t('integrations.entra.settings.actions.reconnecting')
                : t('integrations.entra.settings.actions.reconnect')}
            </Button>
          )}
          <Button id="entra-refresh-status" type="button" size="sm" variant="ghost" onClick={loadStatus} disabled={statusLoading}>
            {t('integrations.entra.settings.actions.refresh')}
          </Button>
        </div>
      </div>

      <div className="entra-status-section mt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('integrations.entra.settings.overview.label')}</p>
        <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('integrations.entra.settings.overview.connectionLabel')}</span> {status?.status || t('integrations.entra.settings.connection.notConnectedStatus')}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('integrations.entra.settings.overview.connectionTypeLabel')}</span> {status?.connectionType || t('integrations.entra.settings.connection.notConfigured')}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('integrations.entra.settings.overview.mappedTenantsLabel')}</span> {status?.mappedTenantCount ?? 0}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('integrations.entra.settings.overview.nextSyncIntervalLabel')}</span>{' '}
            {status?.nextSyncIntervalMinutes
              ? t('integrations.entra.settings.overview.nextSyncIntervalEvery', { minutes: status.nextSyncIntervalMinutes })
              : t('integrations.entra.settings.connection.notConfigured')}
          </p>
        </div>
      </div>

      <div className="entra-status-section mt-3">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('integrations.entra.settings.connection.details')}</p>
          {status?.connectionType === 'cipp' ? (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('integrations.entra.settings.connection.cippServerLabel')}</span> {cippBaseUrl || t('integrations.entra.settings.connection.notAvailable')}
            </p>
          ) : null}
          {status?.connectionType === 'direct' ? (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('integrations.entra.settings.connection.directTenantLabel')}</span> {directTenantIdLabel}
            </p>
          ) : null}
          {status?.connectionType === 'direct' ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('integrations.entra.settings.connection.directCredentialSourceLabel')}</span> {directCredentialSourceLabel}
            </p>
          ) : null}
          {!status?.connectionType ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('integrations.entra.settings.connection.promptDetails')}</p>
          ) : null}
          </div>

          <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('integrations.entra.settings.validation.label')}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('integrations.entra.settings.validation.lastDiscoveryLabel')}</span> {formatDateTime(status?.lastDiscoveryAt)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('integrations.entra.settings.validation.lastValidatedLabel')}</span> {formatDateTime(status?.lastValidatedAt)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('integrations.entra.settings.validation.validationErrorLabel')}</span> {validationMessage || t('integrations.entra.settings.validation.noneValidationError')}
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
          <p className="text-sm font-semibold">{t('integrations.entra.settings.fieldSync.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('integrations.entra.settings.fieldSync.description')}
          </p>
        </div>
        {settingsMode === 'onboarding' && isSyncStepCurrent ? (
          <Badge variant="outline">{t('integrations.entra.settings.badges.reviewBeforeInitialSync')}</Badge>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">
        {FIELD_SYNC_OPTIONS.map((option) => (
          <div
            key={option.key}
            className="flex items-start justify-between gap-3 rounded-md border border-border/50 p-3"
          >
            <div>
              <p className="text-sm font-medium">{t(option.labelKey)}</p>
              <p className="text-xs text-muted-foreground">{t(option.descriptionKey)}</p>
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
          {fieldSyncSaving
            ? t('integrations.entra.settings.actions.savingFieldSync')
            : t('integrations.entra.settings.actions.saveFieldSync')}
        </Button>
        <Button
          id="entra-field-sync-reset"
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleResetFieldSync()}
          disabled={!fieldSyncDirty || fieldSyncSaving}
        >
          {t('integrations.entra.settings.actions.resetFieldSync')}
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
            <CardTitle>{t('integrations.entra.settings.disabled.title')}</CardTitle>
            <CardDescription>
              {t('integrations.entra.settings.disabled.description')}
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
            <CardTitle>{t('integrations.entra.settings.title')}</CardTitle>
            <Badge variant="secondary">{t('integrations.entra.settings.badges.enterprise')}</Badge>
          </div>
          <CardDescription>
            {t('integrations.entra.settings.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div
            className="rounded-lg border border-border/70 bg-background p-4"
            id={settingsMode === 'onboarding' ? 'entra-mode-heading-onboarding' : 'entra-mode-heading-maintenance'}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {settingsMode === 'onboarding'
                ? t('integrations.entra.settings.onboarding.title')
                : t('integrations.entra.settings.maintenance.title')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {settingsMode === 'onboarding'
                ? t('integrations.entra.settings.onboarding.description')
                : t('integrations.entra.settings.maintenance.description')}
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
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('integrations.entra.settings.guidedStep.stepLabel', { number: step.stepNumber })}</p>
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t(`integrations.entra.settings.guidedStep.${step.visualState}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold">{t(step.titleKey)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t(step.descriptionKey)}</p>
                    {step.id === 'map' && step.visualState === 'complete' ? (
                      <Button
                        id="entra-step-3-review-remap"
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        onClick={() => void handleToggleMappingDetails()}
                      >
                        {showMappingDetails
                          ? t('integrations.entra.settings.actions.hideReviewRemap')
                          : t('integrations.entra.settings.actions.reviewRemap')}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-current-step-card">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('integrations.entra.settings.currentStep.label')}</p>
                <p className="mt-1 text-sm font-semibold">{currentStepMeta.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{currentStepMeta.guidance}</p>

                <div className="mt-3">
                  {isConnectStepCurrent ? (
                    <p className="text-sm text-muted-foreground">
                      {t('integrations.entra.settings.currentStep.connectionsBelow')}
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
                        {discoveryLoading
                          ? t('integrations.entra.settings.actions.runDiscoveryRunning')
                          : t('integrations.entra.settings.actions.runDiscovery')}
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
                      {t('integrations.entra.settings.actions.reviewMappings')}
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
                        {initialSyncLoading
                          ? t('integrations.entra.settings.actions.runInitialSyncRunning')
                          : t('integrations.entra.settings.actions.runInitialSync')}
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
                  <p className="text-sm font-semibold">{t('integrations.entra.settings.connection.optionsTitle')}</p>
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
                          {option.id === 'direct' && directLoading && t('integrations.entra.settings.connection.connectingSuffix')}
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
              <p className="text-sm font-semibold">{t('integrations.entra.settings.maintenance.healthTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('integrations.entra.settings.maintenance.healthDescription')}
              </p>
            </div>
          )}

          {settingsMode === 'maintenance' ? fieldSyncControlsPanel : null}

          {settingsMode === 'onboarding' && showMappingDetails ? mappingAndSkippedSection : null}

          <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-ongoing-operations-panel">
            <p className="text-sm font-semibold">{t('integrations.entra.settings.ongoing.title')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('integrations.entra.settings.ongoing.description')}
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
                  {discoveryLoading
                    ? t('integrations.entra.settings.actions.runDiscoveryRunning')
                    : t('integrations.entra.settings.actions.runDiscoveryAgain')}
                </Button>
              ) : null}
              <Button
                id="entra-sync-all-tenants"
                type="button"
                variant="outline"
                disabled={!hasConfirmedMappings || syncAllLoading}
                onClick={() => void handleSyncAllTenants()}
              >
                {syncAllLoading
                  ? t('integrations.entra.settings.actions.syncAllStarting')
                  : t('integrations.entra.settings.actions.syncAll')}
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
