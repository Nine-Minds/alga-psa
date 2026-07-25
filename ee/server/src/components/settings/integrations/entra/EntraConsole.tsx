'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  disconnectEntraIntegration,
  getEntraConfirmedMappings,
  initiateEntraDirectOAuth,
  unmapEntraTenant,
  getEntraReconciliationQueue,
  getEntraSyncRunHistory,
  getEntraSyncSchedule,
  startEntraSync,
  validateEntraCippConnection,
  validateEntraDirectConnection,
  type EntraConfirmedMapping,
  type EntraFieldSyncConfig,
  type EntraStatusResponse,
  type EntraSyncHistoryRun,
  type EntraSyncScheduleSettings,
} from '@alga-psa/integrations/actions';
import EntraReconciliationQueue from '../EntraReconciliationQueue';
import {
  EntraTenantMappingTable,
  type EntraMappingSummary,
  type EntraSkippedTenant,
} from '../EntraTenantMappingTable';
import { EntraCippConnectDialog } from '../EntraCippConnectDialog';
import { EntraDirectConsentDialog } from './EntraDirectConsentDialog';
import { EntraClientsTab } from './EntraClientsTab';
import { EntraHistoryTab } from './EntraHistoryTab';
import { EntraScheduleTab } from './EntraScheduleTab';
import { FieldSyncRules, normalizeEntraFieldSyncConfig } from './FieldSyncRules';
import {
  ENTRA_CONSOLE_TABS,
  buildEntraAttentionItems,
  findLastRealRun,
  parseEntraConsoleTab,
  type EntraAttentionItem,
  type EntraConsoleTab,
} from './entraConsoleModel';

interface EntraConsoleProps {
  status: EntraStatusResponse | null;
  onStatusChanged: () => void | Promise<void>;
}

const TAB_LABEL_KEYS: Record<EntraConsoleTab, string> = {
  overview: 'integrations.entra.console.tabs.overview',
  schedule: 'integrations.entra.console.tabs.schedule',
  clients: 'integrations.entra.console.tabs.clients',
  'field-rules': 'integrations.entra.console.tabs.fieldRules',
  'review-queue': 'integrations.entra.console.tabs.reviewQueue',
  history: 'integrations.entra.console.tabs.history',
  connection: 'integrations.entra.console.tabs.connection',
};

const SEVERITY_CLASS: Record<EntraAttentionItem['severity'], string> = {
  blocking: 'text-destructive',
  warning: 'text-amber-600',
  info: 'text-muted-foreground',
};

function formatDateTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

/**
 * The operations console: what an MSP looks at after setup is done.
 *
 * The old screen served both jobs at once, so a tenant with a working
 * integration still got a four-step onboarding ladder above its actual
 * operational state. Here the first thing on the screen is what needs
 * attention, and everything else lives behind a tab with a deep link.
 */
export function EntraConsole({ status, onStatusChanged }: EntraConsoleProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');

  const [tab, setTab] = React.useState<EntraConsoleTab>('overview');
  const [mappings, setMappings] = React.useState<EntraConfirmedMapping[]>([]);
  const [runs, setRuns] = React.useState<EntraSyncHistoryRun[]>([]);
  const [schedule, setSchedule] = React.useState<EntraSyncScheduleSettings | null>(null);
  const [reviewQueueCount, setReviewQueueCount] = React.useState(0);
  const [fieldSyncConfig, setFieldSyncConfig] = React.useState<EntraFieldSyncConfig>(
    normalizeEntraFieldSyncConfig(null)
  );
  const [loading, setLoading] = React.useState(true);
  const [syncAllBusy, setSyncAllBusy] = React.useState(false);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);
  const [disconnectBusy, setDisconnectBusy] = React.useState(false);
  const [validateBusy, setValidateBusy] = React.useState(false);
  const [rotateDirectOpen, setRotateDirectOpen] = React.useState(false);
  const [rotateCippOpen, setRotateCippOpen] = React.useState(false);
  const [rotateBusy, setRotateBusy] = React.useState(false);
  const [mappingSummary, setMappingSummary] = React.useState<EntraMappingSummary>({
    mapped: 0,
    skipped: 0,
    needsReview: 0,
  });
  const [skippedTenants, setSkippedTenants] = React.useState<EntraSkippedTenant[]>([]);
  const [remapTarget, setRemapTarget] = React.useState<EntraSkippedTenant | null>(null);
  const [remapBusy, setRemapBusy] = React.useState(false);

  // Deep links: ?tab=history lands on history, and switching tabs updates the
  // URL so a console view can be shared or bookmarked.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    setTab(parseEntraConsoleTab(new URLSearchParams(window.location.search).get('tab')));
  }, []);

  const selectTab = React.useCallback((next: EntraConsoleTab) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  const loadConsole = React.useCallback(async () => {
    setLoading(true);
    try {
      const [mappingResult, runsResult, scheduleResult, queueResult] = await Promise.all([
        getEntraConfirmedMappings(),
        getEntraSyncRunHistory(50),
        getEntraSyncSchedule(),
        getEntraReconciliationQueue(50),
      ]);

      if (!('error' in mappingResult)) setMappings(mappingResult.data?.mappings || []);
      if (!('error' in runsResult)) setRuns(runsResult.data?.runs || []);
      if (!('error' in scheduleResult)) setSchedule(scheduleResult.data || null);
      if (!('error' in queueResult)) setReviewQueueCount((queueResult.data?.items || []).length);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadConsole();
  }, [loadConsole]);

  React.useEffect(() => {
    setFieldSyncConfig(normalizeEntraFieldSyncConfig(status?.fieldSyncConfig));
  }, [status?.fieldSyncConfig]);

  const attention = buildEntraAttentionItems({
    status,
    mappings,
    reviewQueueCount,
    scheduleEnabled: Boolean(schedule?.syncEnabled),
    runs,
  });
  const lastRun = findLastRealRun(runs);

  const handleSyncAll = React.useCallback(async () => {
    setSyncAllBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await startEntraSync({ scope: 'all-tenants' });
      if ('error' in result) {
        setActionError(result.error || t('integrations.entra.console.errors.syncFailed'));
        return;
      }
      setActionMessage(t('integrations.entra.console.syncStarted'));
      await loadConsole();
    } finally {
      setSyncAllBusy(false);
    }
  }, [loadConsole, t]);

  const handleValidate = React.useCallback(async () => {
    setValidateBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = status?.connectionType === 'cipp'
        ? await validateEntraCippConnection()
        : await validateEntraDirectConnection();
      if ('error' in result) {
        setActionError(result.error || t('integrations.entra.console.errors.validateFailed'));
        return;
      }
      setActionMessage(t('integrations.entra.console.connection.validated'));
      await onStatusChanged();
    } finally {
      setValidateBusy(false);
    }
  }, [onStatusChanged, status?.connectionType, t]);

  const handleDisconnect = React.useCallback(async () => {
    setDisconnectBusy(true);
    try {
      await disconnectEntraIntegration();
      setDisconnectOpen(false);
      await onStatusChanged();
      await loadConsole();
    } finally {
      setDisconnectBusy(false);
    }
  }, [loadConsole, onStatusChanged]);

  // Rotating a credential re-runs the connect flow for the type already on
  // record: the credential is replaced in place, and mappings, history and
  // links are untouched because nothing disconnects.
  const handleRotate = React.useCallback(async () => {
    if (status?.connectionType === 'cipp') {
      setRotateCippOpen(true);
      return;
    }
    setRotateDirectOpen(true);
  }, [status?.connectionType]);

  const handleRotateDirect = React.useCallback(async () => {
    setRotateBusy(true);
    setActionError(null);
    try {
      const result = await initiateEntraDirectOAuth();
      if ('error' in result) {
        setActionError(result.error);
        setRotateDirectOpen(false);
        return;
      }
      if (result.success && result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      }
    } finally {
      setRotateBusy(false);
    }
  }, []);

  const handleRemapSkipped = React.useCallback(async () => {
    if (!remapTarget) return;
    setRemapBusy(true);
    try {
      await unmapEntraTenant({ managedTenantId: remapTarget.managedTenantId });
      setRemapTarget(null);
      await loadConsole();
    } finally {
      setRemapBusy(false);
    }
  }, [loadConsole, remapTarget]);

  /**
   * The connection record, as evidence. An audit asks "what was connected, by
   * what method, validated when" — and until now the only answer was a
   * screenshot.
   */
  const handleExportConnectionRecord = React.useCallback(() => {
    const record = {
      exportedAt: new Date().toISOString(),
      status: status?.status || 'not_connected',
      connectionType: status?.connectionType || null,
      lastValidatedAt: status?.lastValidatedAt || null,
      lastValidationError: status?.lastValidationError || null,
      cippBaseUrl: status?.connectionDetails?.cippBaseUrl || null,
      directTenantId: status?.connectionDetails?.directTenantId || null,
      directCredentialSource: status?.connectionDetails?.directCredentialSource || null,
      mappedClients: mappings.map((mapping) => ({
        clientName: mapping.clientName,
        entraTenantId: mapping.entraTenantId,
        primaryDomain: mapping.primaryDomain,
        lastSyncedAt: mapping.lastSyncedAt,
        lastRunStatus: mapping.lastRunStatus,
      })),
    };

    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'entra-connection-record.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [mappings, status]);

  const connectionHealthy = status?.status === 'connected';

  return (
    <div className="space-y-4" id="entra-console" data-entra-console-tab={tab}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle>{t('integrations.entra.console.title')}</CardTitle>
              <Badge
                id="entra-console-health"
                variant={connectionHealthy ? 'secondary' : 'outline'}
              >
                {t(`integrations.entra.settings.status.values.${status?.status || 'not_connected'}`, {
                  defaultValue: t('integrations.entra.settings.status.values.unknown'),
                })}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                id="entra-console-sync-now"
                type="button"
                size="sm"
                onClick={() => void handleSyncAll()}
                disabled={syncAllBusy || !connectionHealthy || mappings.length === 0}
              >
                {syncAllBusy
                  ? t('integrations.entra.console.actions.syncingNow')
                  : t('integrations.entra.console.actions.syncNow')}
              </Button>
              <Button
                id="entra-console-refresh"
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void loadConsole()}
                disabled={loading}
              >
                {t('integrations.entra.settings.actions.refresh')}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1" role="tablist" id="entra-console-tabs">
            {ENTRA_CONSOLE_TABS.map((candidate) => (
              <button
                key={candidate}
                id={`entra-console-tab-${candidate}`}
                type="button"
                role="tab"
                aria-selected={tab === candidate}
                className={
                  tab === candidate
                    ? 'rounded-md border border-primary-500 px-3 py-1.5 text-sm font-medium'
                    : 'rounded-md border border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:border-border/70'
                }
                onClick={() => selectTab(candidate)}
              >
                {t(TAB_LABEL_KEYS[candidate])}
                {candidate === 'review-queue' && reviewQueueCount > 0 ? ` · ${reviewQueueCount}` : ''}
              </button>
            ))}
          </div>

          {actionMessage ? (
            <p className="text-sm text-muted-foreground" id="entra-console-message">{actionMessage}</p>
          ) : null}
          {actionError ? (
            <p className="text-sm text-destructive" id="entra-console-error">{actionError}</p>
          ) : null}

          {tab === 'overview' ? (
            <div className="space-y-4" id="entra-console-overview">
              <div className="rounded-lg border border-border/70 bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('integrations.entra.console.attention.title')}
                </p>
                {attention.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground" id="entra-console-attention-empty">
                    {t('integrations.entra.console.attention.empty')}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1" id="entra-console-attention-list">
                    {attention.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-3">
                        <span className={`text-sm ${SEVERITY_CLASS[item.severity]}`}>
                          {t(item.titleKey, item.values)}
                        </span>
                        <Button
                          id={`entra-console-attention-${item.id}`}
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => selectTab(item.tab)}
                        >
                          {t('integrations.entra.console.attention.open')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-background p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('integrations.entra.console.lastRun.title')}
                  </p>
                  {lastRun ? (
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground" id="entra-console-last-run">
                      <p>
                        {t('integrations.entra.console.lastRun.summary', {
                          status: lastRun.status,
                          time: formatDateTime(lastRun.completedAt || lastRun.startedAt, '—'),
                        })}
                      </p>
                      <p>
                        {t('integrations.entra.console.lastRun.tenants', {
                          succeeded: lastRun.succeededTenants,
                          total: lastRun.totalTenants,
                        })}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground" id="entra-console-last-run-empty">
                      {t('integrations.entra.console.lastRun.empty')}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-console-side-rail">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('integrations.entra.console.sideRail.title')}
                  </p>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">
                        {t('integrations.entra.console.sideRail.schedule')}
                      </span>{' '}
                      {schedule?.syncEnabled
                        ? t('integrations.entra.console.sideRail.scheduleOn', {
                            minutes: schedule.syncIntervalMinutes,
                          })
                        : t('integrations.entra.console.sideRail.scheduleOff')}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">
                        {t('integrations.entra.settings.overview.connectionTypeLabel')}
                      </span>{' '}
                      {status?.connectionType
                        ? t(`integrations.entra.settings.connection.types.${status.connectionType}`)
                        : t('integrations.entra.settings.connection.notConfigured')}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">
                        {t('integrations.entra.settings.overview.mappedTenantsLabel')}
                      </span>{' '}
                      {mappings.length}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'schedule' ? (
            <EntraScheduleTab
              schedule={schedule}
              hasCompletedPilot={mappings.some((mapping) => mapping.lastRunStatus === 'completed')}
              onSaved={loadConsole}
            />
          ) : null}

          {tab === 'clients' ? (
            <EntraClientsTab mappings={mappings} loading={loading} onChanged={loadConsole} />
          ) : null}

          {tab === 'field-rules' ? (
            <FieldSyncRules
              config={fieldSyncConfig}
              onConfigChange={setFieldSyncConfig}
              onSaved={onStatusChanged}
            />
          ) : null}

          {tab === 'review-queue' ? <EntraReconciliationQueue /> : null}

          {tab === 'history' ? (
            <EntraHistoryTab runs={runs} mappings={mappings} loading={loading} />
          ) : null}

          {tab === 'connection' ? (
            <div className="space-y-4" id="entra-console-connection">
              <div className="rounded-lg border border-border/70 bg-background p-4">
                <p className="text-sm font-semibold">
                  {t('integrations.entra.settings.connection.details')}
                </p>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">
                      {t('integrations.entra.settings.overview.connectionTypeLabel')}
                    </span>{' '}
                    {status?.connectionType
                      ? t(`integrations.entra.settings.connection.types.${status.connectionType}`)
                      : t('integrations.entra.settings.connection.notConfigured')}
                  </p>
                  {status?.connectionType === 'cipp' ? (
                    <p>
                      <span className="font-medium text-foreground">
                        {t('integrations.entra.settings.connection.cippServerLabel')}
                      </span>{' '}
                      {status.connectionDetails?.cippBaseUrl
                        || t('integrations.entra.settings.connection.notAvailable')}
                    </p>
                  ) : null}
                  {status?.connectionType === 'direct' ? (
                    <p>
                      <span className="font-medium text-foreground">
                        {t('integrations.entra.settings.connection.directTenantLabel')}
                      </span>{' '}
                      {status.connectionDetails?.directTenantId
                        || t('integrations.entra.settings.connection.directTenantDefault')}
                    </p>
                  ) : null}
                  <p>
                    <span className="font-medium text-foreground">
                      {t('integrations.entra.settings.validation.lastValidatedLabel')}
                    </span>{' '}
                    {formatDateTime(
                      status?.lastValidatedAt,
                      t('integrations.entra.settings.validation.neverFormatted')
                    )}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    id="entra-console-validate"
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleValidate()}
                    disabled={validateBusy || !status?.connectionType}
                  >
                    {validateBusy
                      ? t('integrations.entra.console.connection.validating')
                      : t('integrations.entra.console.connection.validate')}
                  </Button>
                  <Button
                    id="entra-console-rotate"
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRotate()}
                    disabled={rotateBusy || !status?.connectionType}
                  >
                    {t('integrations.entra.console.connection.rotate')}
                  </Button>
                  <Button
                    id="entra-console-export-record"
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleExportConnectionRecord}
                  >
                    {t('integrations.entra.console.connection.exportRecord')}
                  </Button>
                  <Button
                    id="entra-console-disconnect"
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDisconnectOpen(true)}
                    disabled={disconnectBusy || !status?.connectionType}
                  >
                    {t('integrations.entra.settings.actions.disconnect')}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-background p-4">
                <p className="text-sm font-semibold">
                  {t('integrations.entra.console.connection.mappingTitle')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('integrations.entra.console.connection.mappingDescription')}
                </p>
                <div className="mb-3 mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
                  <p>
                    <span className="font-medium text-foreground">
                      {t('integrations.entra.settings.mapping.savedLabel')}
                    </span>{' '}
                    {mappings.length}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      {t('integrations.entra.settings.mapping.selectedLabel')}
                    </span>{' '}
                    {mappingSummary.mapped}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      {t('integrations.entra.settings.mapping.skippedLabel')}
                    </span>{' '}
                    {mappingSummary.skipped}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      {t('integrations.entra.settings.mapping.needsReviewLabel')}
                    </span>{' '}
                    {mappingSummary.needsReview}
                  </p>
                </div>
                <EntraTenantMappingTable
                  onSummaryChange={setMappingSummary}
                  onSkippedTenantsChange={setSkippedTenants}
                  onPersistedMappingChange={() => void loadConsole()}
                />
              </div>

              <div
                className="rounded-lg border border-border/70 bg-background p-4"
                id="entra-skipped-tenants-panel"
              >
                <p className="text-sm font-semibold">
                  {t('integrations.entra.settings.skipped.title')}
                </p>
                {skippedTenants.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('integrations.entra.settings.skipped.empty')}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {skippedTenants.map((tenant) => (
                      <div
                        key={tenant.managedTenantId}
                        className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {tenant.displayName || tenant.managedTenantId}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {tenant.primaryDomain
                              || t('integrations.entra.settings.skipped.noPrimaryDomain')}
                          </p>
                        </div>
                        <Button
                          id={`entra-remap-skipped-${tenant.managedTenantId}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setRemapTarget(tenant)}
                          disabled={remapBusy}
                        >
                          {t('integrations.entra.settings.skipped.remap')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <EntraDirectConsentDialog
        open={rotateDirectOpen}
        onOpenChange={setRotateDirectOpen}
        onConfirm={() => void handleRotateDirect()}
        busy={rotateBusy}
      />

      <EntraCippConnectDialog
        open={rotateCippOpen}
        onOpenChange={setRotateCippOpen}
        onSuccess={() => {
          void onStatusChanged();
          void loadConsole();
        }}
      />

      <ConfirmationDialog
        id="entra-console-remap-dialog"
        isOpen={remapTarget !== null}
        onClose={() => setRemapTarget(null)}
        onConfirm={() => handleRemapSkipped()}
        isConfirming={remapBusy}
        title={t('integrations.entra.settings.unmapConfirm.title')}
        message={t('integrations.entra.settings.unmapConfirm.body', {
          tenant: remapTarget?.displayName || remapTarget?.primaryDomain || remapTarget?.managedTenantId || '',
        })}
        confirmLabel={t('integrations.entra.settings.skipped.remap')}
        cancelLabel={t('integrations.entra.settings.actions.cancel')}
      />

      <ConfirmationDialog
        id="entra-console-disconnect-dialog"
        isOpen={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={() => handleDisconnect()}
        isConfirming={disconnectBusy}
        title={t('integrations.entra.settings.disconnectConfirm.title')}
        message={
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('integrations.entra.settings.disconnectConfirm.stops')}</p>
            <p>{t('integrations.entra.settings.disconnectConfirm.keeps')}</p>
            <p>{t('integrations.entra.settings.disconnectConfirm.reconnect')}</p>
          </div>
        }
        confirmLabel={t('integrations.entra.settings.actions.disconnect')}
        cancelLabel={t('integrations.entra.settings.actions.cancel')}
      />
    </div>
  );
}

export default EntraConsole;
