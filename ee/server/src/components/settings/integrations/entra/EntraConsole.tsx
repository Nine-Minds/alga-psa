'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { CustomTabs, type TabContent } from '@alga-psa/ui/components/CustomTabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  disconnectEntraIntegration,
  getEntraConfirmedMappings,
  initiateEntraDirectOAuth,
  unmapEntraTenant,
  getEntraReconciliationQueue,
  getEntraSyncRunDetail,
  getEntraSyncRunHistory,
  getEntraSyncSchedule,
  saveEntraSyncSchedule,
  startEntraSync,
  validateEntraCippConnection,
  validateEntraDirectConnection,
  type EntraConfirmedMapping,
  type EntraFieldSyncConfig,
  type EntraStatusResponse,
  type EntraSyncHistoryRun,
  type EntraSyncRunTenantResult,
  type EntraSyncScheduleSettings,
} from '@alga-psa/integrations/actions';
import EntraReconciliationQueue from '../EntraReconciliationQueue';
import {
  EntraTenantMappingTable,
  type EntraMappingSummary,
  type EntraSkippedTenant,
} from '../EntraTenantMappingTable';
import { EntraCippConnectDialog } from '../EntraCippConnectDialog';
import { ConnectionMethodChooser, type EntraConnectionMethod } from './ConnectionMethodChooser';
import { EntraDirectConsentDialog } from './EntraDirectConsentDialog';
import { EntraClientsTab } from './EntraClientsTab';
import { EntraHistoryTab } from './EntraHistoryTab';
import { EntraScheduleTab } from './EntraScheduleTab';
import { FieldSyncRules } from './FieldSyncRules';
import { normalizeEntraFieldSyncConfig } from './fieldSyncModel';
import { MarkList, type MarkListItem } from './MarkList';
import { wasEntraSyncAccepted } from './syncStart';
import {
  ENTRA_CONSOLE_TABS,
  buildEntraAttentionItems,
  findLastRealRun,
  isEntraSyncIntervalChoice,
  parseEntraConsoleTab,
  summarizeEntraRunResults,
  type EntraAttentionItem,
  type EntraConsoleTab,
} from './entraConsoleModel';

interface EntraConsoleProps {
  status: EntraStatusResponse | null;
  /** CIPP is offered only when both the tier and the soft-launch flag allow it. */
  cippAvailable: boolean;
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

const SEVERITY_ICON: Record<EntraAttentionItem['severity'], typeof AlertCircle> = {
  blocking: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_CLASS: Record<EntraAttentionItem['severity'], string> = {
  blocking: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground',
};

function formatDateTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function formatTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed)
    ? value
    : new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** One number, its label, and what it means — the overview's smallest unit. */
function Stat({
  id,
  label,
  value,
  sub,
  tone,
}: {
  id: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'default' | 'danger';
}): React.JSX.Element {
  return (
    <div id={id} className="min-w-[6rem]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-2xl font-semibold tabular-nums ${
          tone === 'danger' ? 'text-destructive' : ''
        }`}
        data-stat-value={typeof value === 'number' ? value : undefined}
      >
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** A labelled value row, right-aligned — the side rail's smallest unit. */
function KeyValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'danger';
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="flex-shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate text-right ${tone === 'danger' ? 'text-destructive' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function RailCard({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-4" id={id}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * The operations console: what an MSP looks at after setup is done.
 *
 * The old screen served both jobs at once, so a tenant with a working
 * integration still got a four-step onboarding ladder above its actual
 * operational state. Here the first thing on the screen is what needs
 * attention, then what the last run did to the contact list, and everything
 * else lives behind a tab with a deep link.
 */
export function EntraConsole({
  status,
  cippAvailable,
  onStatusChanged,
}: EntraConsoleProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');

  const [tab, setTab] = React.useState<EntraConsoleTab>('overview');
  const [mappings, setMappings] = React.useState<EntraConfirmedMapping[]>([]);
  const [runs, setRuns] = React.useState<EntraSyncHistoryRun[]>([]);
  const [lastRunResults, setLastRunResults] = React.useState<EntraSyncRunTenantResult[]>([]);
  const [schedule, setSchedule] = React.useState<EntraSyncScheduleSettings | null>(null);
  const [reviewQueueCount, setReviewQueueCount] = React.useState(0);
  const [fieldSyncConfig, setFieldSyncConfig] = React.useState<EntraFieldSyncConfig>(
    normalizeEntraFieldSyncConfig(null)
  );
  const [loading, setLoading] = React.useState(true);
  const [syncAllBusy, setSyncAllBusy] = React.useState(false);
  const [pauseBusy, setPauseBusy] = React.useState(false);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);
  const [disconnectBusy, setDisconnectBusy] = React.useState(false);
  const [validateBusy, setValidateBusy] = React.useState(false);
  const [rotateDirectOpen, setRotateDirectOpen] = React.useState(false);
  const [rotateCippOpen, setRotateCippOpen] = React.useState(false);
  const [rotateBusy, setRotateBusy] = React.useState(false);
  // Disconnecting is not a one-way door: the console keeps the contacts and the
  // mappings, so it has to keep a way back in as well.
  const [reconnectMethod, setReconnectMethod] = React.useState<EntraConnectionMethod | null>(null);
  const [reconnectBusy, setReconnectBusy] = React.useState(false);
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
      if (!('error' in scheduleResult)) setSchedule(scheduleResult.data || null);
      if (!('error' in queueResult)) setReviewQueueCount((queueResult.data?.items || []).length);

      if (!('error' in runsResult)) {
        const loadedRuns = runsResult.data?.runs || [];
        setRuns(loadedRuns);

        // What the last real run did to the contact list, per client. The
        // history list carries tenant counts only.
        const lastReal = findLastRealRun(loadedRuns);
        if (lastReal) {
          const detail = await getEntraSyncRunDetail(lastReal.runId);
          setLastRunResults(!('error' in detail) ? detail.data?.tenantResults || [] : []);
        } else {
          setLastRunResults([]);
        }
      }
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
  const totals = summarizeEntraRunResults(lastRunResults);
  const failingCount = mappings.filter((mapping) => mapping.lastRunStatus === 'failed').length;

  const clientNameByTenant = new Map(
    mappings.map((mapping) => [
      mapping.managedTenantId,
      mapping.clientName || mapping.displayName || mapping.primaryDomain || mapping.entraTenantId,
    ])
  );
  const clientNameById = new Map(
    mappings.map((mapping) => [
      mapping.clientId,
      mapping.clientName || mapping.displayName || mapping.primaryDomain || mapping.entraTenantId,
    ])
  );

  const resultClientName = (result: EntraSyncRunTenantResult): string =>
    (result.managedTenantId ? clientNameByTenant.get(result.managedTenantId) : undefined)
    || (result.clientId ? clientNameById.get(result.clientId) : undefined)
    || result.managedTenantId
    || result.clientId
    || t('integrations.entra.syncHistory.details.unknownTenant');

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
      if (!wasEntraSyncAccepted(result)) {
        setActionError(t('integrations.entra.console.errors.syncNotStarted'));
        return;
      }
      setActionMessage(t('integrations.entra.console.syncStarted'));
      await loadConsole();
    } finally {
      setSyncAllBusy(false);
    }
  }, [loadConsole, t]);

  /**
   * Pause is the button an operator reaches for when a sync is doing something
   * they did not expect, so it is on the header rather than two tabs away.
   */
  const handleTogglePause = React.useCallback(async () => {
    if (!schedule) return;
    setPauseBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const next = !schedule.syncEnabled;
      const result = await saveEntraSyncSchedule({
        syncEnabled: next,
        syncIntervalMinutes: schedule.syncIntervalMinutes,
      });
      if ('error' in result) {
        setActionError(result.error || t('integrations.entra.console.schedule.saveFailed'));
        return;
      }
      setSchedule(result.data || null);
      setActionMessage(
        next
          ? t('integrations.entra.console.schedule.resumed')
          : t('integrations.entra.console.schedule.paused')
      );
    } finally {
      setPauseBusy(false);
    }
  }, [schedule, t]);

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

  const handleReconnect = React.useCallback(() => {
    setActionError(null);
    if (reconnectMethod === 'cipp') {
      setRotateCippOpen(true);
      return;
    }
    if (reconnectMethod === 'direct') {
      setRotateDirectOpen(true);
    }
  }, [reconnectMethod]);

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

  /**
   * "on, Day" — the rail was interpolating the schedule select's option label
   * ("Day", the noun after "Run every") into a sentence, and the two do not
   * compose in English or in any of the nine other locales. A cadence sentence
   * is its own string.
   */
  const scheduleCadenceLabel = !schedule?.syncEnabled
    ? t('integrations.entra.console.sideRail.scheduleOff')
    : isEntraSyncIntervalChoice(schedule.syncIntervalMinutes)
      ? t('integrations.entra.console.sideRail.runs', {
          cadence: t(
            `integrations.entra.console.schedule.cadence.${schedule.syncIntervalMinutes}`
          ),
        })
      : t('integrations.entra.console.sideRail.runsMinutes', {
          minutes: schedule.syncIntervalMinutes,
        });

  const connectionHealthy = status?.status === 'connected';
  const connectionMethodLabel = status?.connectionType
    ? t(`integrations.entra.settings.connection.types.${status.connectionType}`)
    : t('integrations.entra.settings.connection.notConfigured');

  const permissionItems: MarkListItem[] = [
    {
      id: 'read-tenants',
      mark: 'affirm',
      text: t('integrations.entra.setup.disclosure.capabilities.readTenants'),
    },
    {
      id: 'read-users',
      mark: 'affirm',
      text: t('integrations.entra.setup.disclosure.capabilities.readUsers'),
    },
    {
      id: 'no-write',
      mark: 'deny',
      text: t('integrations.entra.setup.disclosure.capabilities.noWrite'),
    },
  ];

  const overviewPanel = (
    <div className="space-y-4" id="entra-console-overview">
      <div className="rounded-lg border border-border/70 bg-background p-4">
        <p className="text-sm font-semibold">{t('integrations.entra.console.attention.title')}</p>
        {attention.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" id="entra-console-attention-empty">
            {t('integrations.entra.console.attention.empty')}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60" id="entra-console-attention-list">
            {attention.map((item) => {
              const Icon = SEVERITY_ICON[item.severity];
              return (
                <li key={item.id} className="flex items-start gap-3 py-2">
                  <Icon
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 ${SEVERITY_CLASS[item.severity]}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t(item.titleKey, item.values)}</p>
                    {item.detailKey ? (
                      <p className="text-sm text-muted-foreground">
                        {t(item.detailKey, item.values)}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    id={`entra-console-attention-${item.id}`}
                    type="button"
                    size="sm"
                    variant={item.severity === 'blocking' ? 'default' : 'outline'}
                    className="flex-shrink-0"
                    onClick={() => selectTab(item.tab)}
                  >
                    {t(item.actionKey)}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border/70 bg-background p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t('integrations.entra.console.lastRun.title')}</p>
            <Button
              id="entra-console-open-history"
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => selectTab('history')}
            >
              {t('integrations.entra.console.lastRun.fullHistory')}
            </Button>
          </div>

          {lastRun ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground" id="entra-console-last-run">
                {t('integrations.entra.console.lastRun.summary', {
                  status: lastRun.status,
                  time: formatDateTime(lastRun.completedAt || lastRun.startedAt, '—'),
                })}
              </p>

              <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3" id="entra-console-last-run-stats">
                <Stat
                  id="entra-console-stat-linked"
                  label={t('integrations.entra.console.lastRun.stats.linked')}
                  value={totals.linked}
                  sub={t('integrations.entra.console.lastRun.stats.linkedSub')}
                />
                <Stat
                  id="entra-console-stat-created"
                  label={t('integrations.entra.console.lastRun.stats.created')}
                  value={totals.created}
                  sub={t('integrations.entra.console.lastRun.stats.createdSub')}
                />
                <Stat
                  id="entra-console-stat-updated"
                  label={t('integrations.entra.console.lastRun.stats.updated')}
                  value={totals.updated}
                  sub={t('integrations.entra.console.lastRun.stats.updatedSub')}
                />
                <Stat
                  id="entra-console-stat-inactivated"
                  label={t('integrations.entra.console.lastRun.stats.inactivated')}
                  value={totals.inactivated}
                  sub={t('integrations.entra.console.lastRun.stats.inactivatedSub')}
                />
                {lastRun.failedTenants > 0 ? (
                  <Stat
                    id="entra-console-stat-failed"
                    label={t('integrations.entra.console.lastRun.stats.failed')}
                    value={lastRun.failedTenants}
                    sub={t('integrations.entra.console.lastRun.stats.failedSub')}
                    tone="danger"
                  />
                ) : null}
              </div>

              {lastRunResults.length > 0 ? (
                <div className="mt-4 overflow-x-auto" id="entra-console-last-run-clients">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('integrations.entra.console.lastRun.columns.client')}</TableHead>
                        <TableHead>{t('integrations.entra.console.lastRun.columns.result')}</TableHead>
                        <TableHead className="text-right">
                          {t('integrations.entra.console.lastRun.columns.linked')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('integrations.entra.console.lastRun.columns.created')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('integrations.entra.console.lastRun.columns.inactivated')}
                        </TableHead>
                        <TableHead>{t('integrations.entra.console.lastRun.columns.when')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lastRunResults.map((result) => (
                        <TableRow key={`${result.managedTenantId || result.clientId}`}>
                          <TableCell className="font-medium">
                            {resultClientName(result)}
                            {/* Why it failed, where the failure is: "Failed" on
                                its own sends the operator hunting through logs. */}
                            {result.errorMessage ? (
                              <span className="mt-0.5 block text-xs font-normal text-destructive">
                                {result.errorMessage}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                result.status === 'failed'
                                  ? 'error'
                                  : result.ambiguous > 0
                                    ? 'warning'
                                    : 'success'
                              }
                              size="sm"
                            >
                              {result.status === 'failed'
                                ? t('integrations.entra.console.lastRun.results.failed')
                                : result.ambiguous > 0
                                  ? t('integrations.entra.console.lastRun.results.toReview', {
                                      count: result.ambiguous,
                                    })
                                  : t('integrations.entra.console.lastRun.results.done')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{result.linked}</TableCell>
                          <TableCell className="text-right tabular-nums">{result.created}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {result.inactivated}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatTime(result.completedAt || result.startedAt, '—')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground" id="entra-console-last-run-empty">
              {t('integrations.entra.console.lastRun.empty')}
            </p>
          )}
        </div>

        <div className="space-y-4" id="entra-console-side-rail">
          <RailCard id="entra-console-rail-schedule" title={t('integrations.entra.console.schedule.title')}>
            <p className="text-sm">{scheduleCadenceLabel}</p>
            <div className="mt-2">
              <KeyValue
                label={t('integrations.entra.console.sideRail.lastRun')}
                value={formatDateTime(
                  lastRun?.completedAt || lastRun?.startedAt,
                  t('integrations.entra.settings.validation.neverFormatted')
                )}
              />
              <KeyValue
                label={t('integrations.entra.console.sideRail.covers')}
                value={t(
                  mappings.length === 1
                    ? 'integrations.entra.console.sideRail.coversClientsOne'
                    : 'integrations.entra.console.sideRail.coversClients',
                  { count: mappings.length }
                )}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                id="entra-console-rail-pause"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleTogglePause()}
                disabled={pauseBusy || !schedule}
              >
                {schedule?.syncEnabled
                  ? t('integrations.entra.console.actions.pause')
                  : t('integrations.entra.console.actions.resume')}
              </Button>
              <Button
                id="entra-console-rail-change-schedule"
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => selectTab('schedule')}
              >
                {t('integrations.entra.console.sideRail.change')}
              </Button>
            </div>
          </RailCard>

          <RailCard
            id="entra-console-rail-connection"
            title={t('integrations.entra.settings.connection.details')}
          >
            <KeyValue
              label={t('integrations.entra.settings.overview.connectionTypeLabel')}
              value={connectionMethodLabel}
            />
            {status?.connectionType === 'cipp' ? (
              <KeyValue
                label={t('integrations.entra.settings.connection.cippServerLabel')}
                value={
                  status.connectionDetails?.cippBaseUrl
                  || t('integrations.entra.settings.connection.notAvailable')
                }
              />
            ) : null}
            <KeyValue
              label={t('integrations.entra.settings.validation.lastValidatedLabel')}
              value={formatDateTime(
                status?.lastValidatedAt,
                t('integrations.entra.settings.validation.neverFormatted')
              )}
              tone={connectionHealthy ? 'default' : 'danger'}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                id="entra-console-rail-rotate"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleRotate()}
                disabled={rotateBusy || !status?.connectionType}
              >
                {t('integrations.entra.console.connection.rotate')}
              </Button>
              <Button
                id="entra-console-rail-open-connection"
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => selectTab('connection')}
              >
                {t('integrations.entra.console.sideRail.change')}
              </Button>
            </div>
          </RailCard>

          <RailCard
            id="entra-console-rail-overwrites"
            title={t('integrations.entra.console.overwrites.title')}
          >
            <KeyValue
              label={t('integrations.entra.settings.fieldSync.options.displayName.label')}
              value={
                fieldSyncConfig.displayName
                  ? t('integrations.entra.console.overwrites.on')
                  : t('integrations.entra.console.overwrites.off')
              }
            />
            <KeyValue
              label={t('integrations.entra.settings.fieldSync.options.phone.label')}
              value={
                fieldSyncConfig.phone
                  ? t('integrations.entra.console.overwrites.on')
                  : t('integrations.entra.console.overwrites.off')
              }
            />
            <KeyValue
              label={t('integrations.entra.settings.fieldSync.options.role.label')}
              value={
                fieldSyncConfig.role
                  ? t('integrations.entra.console.overwrites.on')
                  : t('integrations.entra.console.overwrites.off')
              }
            />
            <Button
              id="entra-console-rail-field-rules"
              type="button"
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => selectTab('field-rules')}
            >
              {t('integrations.entra.console.overwrites.change')}
            </Button>
          </RailCard>
        </div>
      </div>
    </div>
  );

  const connectionPanel = (
    <div className="space-y-4" id="entra-console-connection">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-background p-4">
          <p className="text-sm font-semibold">
            {t('integrations.entra.settings.connection.details')}
          </p>
          <div className="mt-2">
            <KeyValue
              label={t('integrations.entra.settings.overview.connectionTypeLabel')}
              value={connectionMethodLabel}
            />
            {status?.connectionType === 'cipp' ? (
              <KeyValue
                label={t('integrations.entra.settings.connection.cippServerLabel')}
                value={
                  status.connectionDetails?.cippBaseUrl
                  || t('integrations.entra.settings.connection.notAvailable')
                }
              />
            ) : null}
            {status?.connectionType === 'direct' ? (
              <KeyValue
                label={t('integrations.entra.settings.connection.directTenantLabel')}
                value={
                  status.connectionDetails?.directTenantId
                  || t('integrations.entra.settings.connection.directTenantDefault')
                }
              />
            ) : null}
            <KeyValue
              label={t('integrations.entra.settings.validation.lastValidatedLabel')}
              value={formatDateTime(
                status?.lastValidatedAt,
                t('integrations.entra.settings.validation.neverFormatted')
              )}
            />
          </div>

          {!status?.connectionType ? (
            <div className="mt-4" id="entra-console-reconnect">
              <ConnectionMethodChooser
                cippAvailable={cippAvailable}
                value={reconnectMethod}
                onChange={setReconnectMethod}
                onContinue={handleReconnect}
                busy={reconnectBusy || rotateBusy}
              />
            </div>
          ) : null}

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
              variant="destructive"
              className="ml-auto"
              onClick={() => setDisconnectOpen(true)}
              disabled={disconnectBusy || !status?.connectionType}
            >
              {t('integrations.entra.settings.actions.disconnect')}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-console-permissions">
          <p className="text-sm font-semibold">
            {t('integrations.entra.console.connection.permissionsTitle')}
          </p>
          <MarkList className="mt-2" items={permissionItems} />
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
        <p className="text-sm font-semibold">{t('integrations.entra.settings.skipped.title')}</p>
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
  );

  const panels: Record<EntraConsoleTab, React.ReactNode> = {
    overview: overviewPanel,
    schedule: (
      <EntraScheduleTab
        schedule={schedule}
        hasCompletedPilot={mappings.some((mapping) => mapping.lastRunStatus === 'completed')}
        onSaved={loadConsole}
      />
    ),
    clients: (
      <EntraClientsTab
        mappings={mappings}
        loading={loading}
        onChanged={loadConsole}
        onOpenConnection={() => selectTab('connection')}
      />
    ),
    'field-rules': (
      <FieldSyncRules
        config={fieldSyncConfig}
        onConfigChange={setFieldSyncConfig}
        onSaved={onStatusChanged}
      />
    ),
    'review-queue': <EntraReconciliationQueue />,
    history: <EntraHistoryTab runs={runs} mappings={mappings} loading={loading} />,
    connection: connectionPanel,
  };

  const tabCounts: Partial<Record<EntraConsoleTab, number>> = {
    clients: mappings.length,
    'review-queue': reviewQueueCount,
  };

  const tabs: TabContent[] = ENTRA_CONSOLE_TABS.map((candidate) => ({
    id: candidate,
    label: (
      <span className="flex items-center gap-1.5">
        {t(TAB_LABEL_KEYS[candidate])}
        {tabCounts[candidate] ? (
          <Badge
            variant={candidate === 'review-queue' ? 'warning' : 'default-muted'}
            size="sm"
          >
            {tabCounts[candidate]}
          </Badge>
        ) : null}
      </span>
    ),
    content: panels[candidate],
  }));

  return (
    <div className="space-y-5" id="entra-console" data-entra-console-tab={tab}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {t('integrations.entra.summary.title')}
            </h1>
            <Badge variant="secondary">{t('integrations.entra.settings.badges.pro')}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground" id="entra-console-lead">
            {t('integrations.entra.console.lead', {
              clients: mappings.length,
              method: connectionMethodLabel,
            })}
          </p>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <Badge
            id="entra-console-health"
            variant={connectionHealthy ? (failingCount > 0 ? 'warning' : 'success') : 'error'}
          >
            {connectionHealthy
              ? failingCount > 0
                ? t(
                    failingCount === 1
                      ? 'integrations.entra.console.health.failingClientsOne'
                      : 'integrations.entra.console.health.failingClients',
                    { count: failingCount }
                  )
                : t('integrations.entra.console.health.healthy')
              : t(`integrations.entra.settings.status.values.${status?.status || 'not_connected'}`, {
                  defaultValue: t('integrations.entra.settings.status.values.unknown'),
                })}
          </Badge>
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
            id="entra-console-pause"
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleTogglePause()}
            disabled={pauseBusy || !schedule}
          >
            {schedule?.syncEnabled
              ? t('integrations.entra.console.actions.pause')
              : t('integrations.entra.console.actions.resume')}
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

      {actionMessage ? (
        <p className="text-sm text-muted-foreground" id="entra-console-message">{actionMessage}</p>
      ) : null}
      {actionError ? (
        <p className="text-sm text-destructive" id="entra-console-error">{actionError}</p>
      ) : null}

      <CustomTabs
        tabs={tabs}
        value={tab}
        onTabChange={(next) => selectTab(parseEntraConsoleTab(next))}
        idPrefix="entra-console-tab"
      />

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
