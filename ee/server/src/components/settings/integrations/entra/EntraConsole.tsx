'use client';

import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Info,
  KeyRound,
  PencilLine,
  Plug,
  RefreshCw,
  SkipForward,
} from 'lucide-react';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { CustomTabs, type TabContent } from '@alga-psa/ui/components/CustomTabs';
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
import { ENTRA_OVERWRITE_RULES, normalizeEntraFieldSyncConfig } from './fieldSyncModel';
import { EntraSection, type EntraSectionTone } from './EntraSection';
import { MarkList, type MarkListItem } from './MarkList';
import { RelativeTime } from './RelativeTime';
import { formatEntraExactTime, formatEntraRelativeTime } from './timeFormat';
import { wasEntraSyncAccepted } from './syncStart';
import {
  ENTRA_CONSOLE_TABS,
  ENTRA_RUN_RESULT_BADGE_VARIANTS,
  ENTRA_RUN_RESULT_LABEL_KEYS,
  ENTRA_RUN_RESULT_ROW_LIMIT,
  buildEntraAttentionItems,
  entraRunResultOutcome,
  failingEntraClients,
  findLastRealRun,
  isEntraSyncIntervalChoice,
  parseEntraConsoleTab,
  sortEntraRunResultsWorstFirst,
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

/** One page of the review queue. A page is not a total; see reviewQueueAtLimit. */
const REVIEW_QUEUE_PAGE_SIZE = 50;

const SEVERITY_ICON: Record<EntraAttentionItem['severity'], typeof AlertCircle> = {
  blocking: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/**
 * Severity reached a screen reader through nothing: the icon is aria-hidden
 * and SEVERITY_CLASS is colour, so a blocking connection failure and an
 * informational "the schedule is off" were identical in the accessibility
 * tree. The word is visually hidden because sighted readers have the icon.
 */
const SEVERITY_LABEL_KEYS: Record<EntraAttentionItem['severity'], string> = {
  blocking: 'integrations.entra.console.attention.severity.blocking',
  warning: 'integrations.entra.console.attention.severity.warning',
  info: 'integrations.entra.console.attention.severity.info',
};

const SEVERITY_CLASS: Record<EntraAttentionItem['severity'], string> = {
  blocking: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground',
};

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
      {/* text-lg, not text-2xl: the stat row was the only 24px type in the
          whole Entra feature, which made "0 new contacts" louder than the page
          title above it and far louder than "Needs attention", the one thing
          this screen exists to surface. Nothing in a panel outruns the h1. */}
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
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
      {/* `truncate` clips the tail whatever the alignment, and the tail of a
          CIPP URL is the part that says which server it is — so the full value
          goes on the title, where it stays recoverable. Right-anchored is
          deliberate: these rows are a two-column rail, and a clean right edge
          is what makes them scan as a column at all. */}
      <span
        className={`min-w-0 truncate text-right ${tone === 'danger' ? 'text-destructive' : ''}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
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
  /**
   * True when the queue came back full. `getEntraReconciliationQueue` takes a
   * page size, and the console was rendering `items.length` as a total — so
   * five thousand pending identities read "50 identities are waiting", in the
   * attention item and in the tab badge, and an operator planned around it.
   */
  const [reviewQueueAtLimit, setReviewQueueAtLimit] = React.useState(false);
  const [fieldSyncConfig, setFieldSyncConfig] = React.useState<EntraFieldSyncConfig>(
    normalizeEntraFieldSyncConfig(null)
  );
  const [loading, setLoading] = React.useState(true);
  // Distinct from `loading`: a refresh should not blank a screen the operator
  // is already reading, but the *first* paint must not answer questions it has
  // no data for.
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
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
        getEntraReconciliationQueue(REVIEW_QUEUE_PAGE_SIZE),
      ]);

      // Every reader returns a Forbidden or failure envelope rather than
      // throwing. Each of these used to be an `if` with no `else`, which left
      // the state at its empty default — so a read-only admin, or a backend
      // outage, produced a screen reading "Healthy · 0 clients mapped ·
      // Nothing needs attention", indistinguishable from a working tenant that
      // happens to have nothing in it.
      const failures: string[] = [];

      if ('error' in mappingResult) failures.push(mappingResult.error);
      else setMappings(mappingResult.data?.mappings || []);

      if ('error' in scheduleResult) failures.push(scheduleResult.error);
      else setSchedule(scheduleResult.data || null);

      if ('error' in queueResult) {
        failures.push(queueResult.error);
      } else {
        const queued = (queueResult.data?.items || []).length;
        setReviewQueueCount(queued);
        setReviewQueueAtLimit(queued >= REVIEW_QUEUE_PAGE_SIZE);
      }

      if ('error' in runsResult) {
        failures.push(runsResult.error);
      } else {
        const loadedRuns = runsResult.data?.runs || [];
        setRuns(loadedRuns);

        // What the last real run did to the contact list, per client. The
        // history list carries tenant counts only.
        const lastReal = findLastRealRun(loadedRuns);
        if (lastReal) {
          const detail = await getEntraSyncRunDetail(lastReal.runId);
          if ('error' in detail) {
            // Otherwise the stat strip reads 0/0/0/0 under a green "completed",
            // which says the run did nothing rather than that we cannot tell.
            failures.push(detail.error);
            setLastRunResults([]);
          } else {
            setLastRunResults(detail.data?.tenantResults || []);
          }
        } else {
          setLastRunResults([]);
        }
      }

      setLoadError(failures[0] || null);
    } catch (error) {
      // The envelope check above covers a reader that refuses. A reader that
      // never answers — the server action itself failing, the network dropping
      // — rejects, and without this the state stays at its empty default and
      // the screen tells the same lie by a different route.
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void loadConsole();
  }, [loadConsole]);

  React.useEffect(() => {
    setFieldSyncConfig(normalizeEntraFieldSyncConfig(status?.fieldSyncConfig));
  }, [status?.fieldSyncConfig]);

  /**
   * Before the first load lands, `mappings`, `runs` and the queue are all empty
   * — which the attention rules read as "nothing is wrong" and the header reads
   * as "Healthy". The screen an operator opens to triage was opening with four
   * reassurances it had not checked.
   */
  const initialLoad = loading && !loaded;

  const attention = buildEntraAttentionItems({
    status,
    mappings,
    reviewQueueCount,
    reviewQueueAtLimit,
    schedule,
  });
  const lastRun = findLastRealRun(runs);
  const totals = summarizeEntraRunResults(lastRunResults);
  const shownRunResults = sortEntraRunResultsWorstFirst(lastRunResults).slice(
    0,
    ENTRA_RUN_RESULT_ROW_LIMIT
  );
  const failingCount = failingEntraClients(mappings).length;

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

  /**
   * The one badge visible from every tab. A broken connection is known from
   * `status`, which is a prop and already loaded; the per-client verdict is not,
   * so during the first load the badge says it is still looking rather than
   * asserting "Healthy" against an empty list.
   */
  const headline: { variant: BadgeVariant; label: string } = !connectionHealthy
    ? {
        variant: 'error',
        label: t(`integrations.entra.settings.status.values.${status?.status || 'not_connected'}`, {
          defaultValue: t('integrations.entra.settings.status.values.unknown'),
        }),
      }
    : initialLoad
      ? { variant: 'default-muted', label: t('integrations.entra.console.health.checking') }
      : loadError
        ? { variant: 'warning', label: t('integrations.entra.console.health.unknown') }
        : failingCount > 0
          ? {
              variant: 'warning',
              label: t(
                failingCount === 1
                  ? 'integrations.entra.console.health.failingClientsOne'
                  : 'integrations.entra.console.health.failingClients',
                { count: failingCount }
              ),
            }
          : { variant: 'success', label: t('integrations.entra.console.health.healthy') };

  /**
   * The run, in a sentence.
   *
   * This used to be `"{{status}} at {{time}}"` with the backend enum passed
   * straight through, so ten locales rendered "completed at 7/25/2026,
   * 8:08:11 PM" — a lowercase database value doing the work of a verb, and a
   * timestamp precise to the second on something that runs nightly at best.
   */
  const lastRunStatus = (lastRun?.status || '').toLowerCase();
  const lastRunInProgress = Boolean(lastRun) && lastRunStatus === 'running';
  const lastRunAt = lastRunInProgress
    ? lastRun?.startedAt
    : lastRun?.completedAt || lastRun?.startedAt;
  const lastRunExactTime = formatEntraExactTime(lastRunAt) || '';

  const LAST_RUN_SUMMARY_KEYS: Record<string, string> = {
    completed: 'integrations.entra.console.lastRun.summaries.completed',
    partial: 'integrations.entra.console.lastRun.summaries.partial',
    failed: 'integrations.entra.console.lastRun.summaries.failed',
    running: 'integrations.entra.console.lastRun.summaries.running',
  };
  const lastRunSummary = {
    key:
      LAST_RUN_SUMMARY_KEYS[lastRunStatus]
      || 'integrations.entra.console.lastRun.summaries.unknown',
    time:
      formatEntraRelativeTime(lastRunAt)
      || t('integrations.entra.settings.validation.neverFormatted'),
  };

  const overwrittenFields = ENTRA_OVERWRITE_RULES.filter(
    (rule) => fieldSyncConfig[rule.key]
  ).map((rule) => t(rule.labelKey));

  /**
   * The section's tone is the tone of what it holds — a card that is red
   * whatever it contains teaches an operator to stop looking at it.
   */
  const attentionTone: EntraSectionTone = loadError
    ? 'blocking'
    : attention.some((item) => item.severity === 'blocking')
      ? 'blocking'
      : attention.some((item) => item.severity === 'warning')
        ? 'warning'
        : attention.length === 0 && !initialLoad
          ? 'success'
          : 'default';

  /**
   * One row per client in the last run, worst first.
   *
   * Counts take pixel widths: they hold one or two digits at any viewport, and
   * an explicit pixel width is also the one thing that bypasses DataTable's
   * natural-width floor — with percentages the header labels alone were wide
   * enough to push three columns into the "3 columns hidden" state inside a
   * two-thirds-width card. The client name takes whatever is left, which is
   * the column that actually benefits from more room.
   */
  const lastRunColumns: ColumnDefinition<EntraSyncRunTenantResult>[] = [
    {
      title: t('integrations.entra.console.lastRun.columns.client'),
      dataIndex: 'managedTenantId',
      render: (_value, result) => (
        <div className="min-w-0">
          <span className="font-medium">{resultClientName(result)}</span>
          {/* Why it failed, where the failure is: "Failed" on its own sends the
              operator hunting through logs. */}
          {result.errorMessage ? (
            <span className="mt-0.5 block whitespace-normal text-xs text-destructive">
              {result.errorMessage}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      title: t('integrations.entra.console.lastRun.columns.result'),
      dataIndex: 'status',
      width: '112px',
      render: (_value, result) => {
        const outcome = entraRunResultOutcome(result);
        return (
          <Badge
            variant={ENTRA_RUN_RESULT_BADGE_VARIANTS[outcome]}
            size="sm"
            className="whitespace-nowrap"
          >
            {outcome === 'review'
              ? t('integrations.entra.console.lastRun.results.toReview', {
                  count: result.ambiguous,
                })
              : t(ENTRA_RUN_RESULT_LABEL_KEYS[outcome])}
          </Badge>
        );
      },
    },
    {
      title: t('integrations.entra.console.lastRun.columns.linked'),
      dataIndex: 'linked',
      width: '72px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
    {
      title: t('integrations.entra.console.lastRun.columns.created'),
      dataIndex: 'created',
      width: '78px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
    {
      title: t('integrations.entra.console.lastRun.columns.updated'),
      dataIndex: 'updated',
      width: '84px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
    {
      title: t('integrations.entra.console.lastRun.columns.inactivated'),
      dataIndex: 'inactivated',
      width: '110px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
  ];

  /** Why "Sync now" is unavailable, in the words the operator needs. */
  const syncBlockedReason = !connectionHealthy
    ? t('integrations.entra.console.actions.syncNeedsConnection')
    : mappings.length === 0
      ? t('integrations.entra.console.actions.syncNeedsClients')
      : null;

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
      <EntraSection
        icon={attentionTone === 'success' ? CheckCircle2 : AlertTriangle}
        title={t('integrations.entra.console.attention.title')}
        tone={attentionTone}
        bodyClassName="mt-3"
      >
        {initialLoad ? (
          <div className="mt-2 space-y-2" id="entra-console-attention-loading" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : loadError ? (
          // The list below is computed from state the failed reader never
          // filled, so "Nothing needs attention" would be a claim about data
          // this screen does not have.
          <div className="mt-2 flex items-start gap-3" id="entra-console-load-error">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {t('integrations.entra.console.errors.loadFailed')}
              </p>
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </div>
            <Button
              id="entra-console-load-retry"
              type="button"
              size="sm"
              variant="default"
              className="flex-shrink-0"
              onClick={() => void loadConsole()}
              disabled={loading}
            >
              {t('integrations.entra.settings.actions.refresh')}
            </Button>
          </div>
        ) : attention.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" id="entra-console-attention-empty">
            {t('integrations.entra.console.attention.empty')}
          </p>
        ) : (
          <ul
            className="mt-2 divide-y divide-border/60"
            id="entra-console-attention-list"
            aria-label={t('integrations.entra.console.attention.title')}
          >
            {attention.map((item) => {
              const Icon = SEVERITY_ICON[item.severity];
              return (
                <li key={item.id} className="flex items-start gap-3 py-2">
                  <Icon
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 ${SEVERITY_CLASS[item.severity]}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      <span className="sr-only">{t(SEVERITY_LABEL_KEYS[item.severity])}: </span>
                      {t(item.titleKey, item.values)}
                    </p>
                    {item.detail || item.detailKey ? (
                      <p className="text-sm text-muted-foreground">
                        {item.detail || t(item.detailKey as string, item.values)}
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
      </EntraSection>

        <EntraSection
          icon={RefreshCw}
          title={t('integrations.entra.console.lastRun.title')}
        >
          {initialLoad ? (
            <div className="space-y-3" id="entra-console-last-run-loading" aria-busy="true">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : lastRun ? (
            <>
              <Tooltip content={lastRunExactTime}>
                <p
                  className="w-fit text-sm text-muted-foreground"
                  id="entra-console-last-run"
                  tabIndex={0}
                >
                  {t(lastRunSummary.key, { time: lastRunSummary.time })}
                </p>
              </Tooltip>

              {/* A run still in flight has written no per-client results yet, so
                  the stat strip would read 0 linked / 0 created — "the sync did
                  nothing" rather than "the sync is not finished". */}
              {lastRunInProgress ? (
                <p className="mt-3 text-sm" id="entra-console-last-run-progress">
                  {t('integrations.entra.console.lastRun.progress', {
                    processed: lastRun.processedTenants,
                    total: lastRun.totalTenants,
                  })}
                </p>
              ) : (
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
              )}

              {!lastRunInProgress && lastRunResults.length > 0 ? (
                <div className="mt-4" id="entra-console-last-run-clients">
                  <DataTable
                    id="entra-console-last-run-table"
                    data={shownRunResults}
                    columns={lastRunColumns}
                    pagination={false}
                  />
                  {lastRunResults.length > shownRunResults.length ? (
                    <Button
                      id="entra-console-last-run-show-all"
                      type="button"
                      size="sm"
                      variant="link"
                      className="mt-2 px-0"
                      onClick={() => selectTab('history')}
                    >
                      {t('integrations.entra.console.lastRun.showAll', {
                        count: lastRunResults.length,
                      })}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p
              className="text-sm text-muted-foreground"
              id={loadError ? 'entra-console-last-run-unavailable' : 'entra-console-last-run-empty'}
            >
              {/* "No sync has run yet" is a fact about the run history. Without
                  the run history, it is a guess. */}
              {loadError
                ? t('integrations.entra.console.lastRun.unavailable')
                : t('integrations.entra.console.lastRun.empty')}
            </p>
          )}
        </EntraSection>

        {/* The machinery, three abreast rather than stacked in a third of the
            width. The run table is six columns wide; squeezed into two thirds
            it hid three of them behind DataTable's "show all" banner, and the
            rail it was making room for is three short cards that read better
            side by side anyway. */}
        <div className="grid gap-4 md:grid-cols-3" id="entra-console-side-rail">
          <EntraSection
            id="entra-console-rail-schedule"
            icon={Clock}
            title={t('integrations.entra.console.schedule.title')}
          >
            {/* "Last run" and "Covers" used to sit here: the first is the same
                timestamp as the last-sync card 600px to the left, the second
                the same count as the header lead and the Clients tab badge.
                Pause was here too, identical to the header button that is
                visible from every tab. */}
            <p className="text-sm">{scheduleCadenceLabel}</p>
            <div className="mt-3">
              <Button
                id="entra-console-rail-change-schedule"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => selectTab('schedule')}
              >
                {t('integrations.entra.console.schedule.changeAction')}
              </Button>
            </div>
          </EntraSection>

          <EntraSection
            id="entra-console-rail-connection"
            icon={Plug}
            title={t('integrations.entra.settings.connection.details')}
            tone={connectionHealthy ? 'default' : 'blocking'}
          >
            {/* The connection *type* is in the header lead ("connected via
                CIPP"); what belongs here is where it points, which the lead
                does not say. The direct tenant row was missing entirely, so a
                direct-connected tenant's rail identified nothing at all. */}
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
            {/* No danger tone on the timestamp: the date is not what is wrong,
                the connection is — and the header badge and the blocking
                attention row both already say so. */}
            <KeyValue
              label={t('integrations.entra.settings.validation.lastValidatedLabel')}
              value={
                <RelativeTime
                  value={status?.lastValidatedAt}
                  fallback={t('integrations.entra.settings.validation.neverFormatted')}
                />
              }
            />
            <div className="mt-3">
              <Button
                id="entra-console-rail-open-connection"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => selectTab('connection')}
              >
                {t('integrations.entra.console.connection.changeAction')}
              </Button>
            </div>
          </EntraSection>

          <EntraSection
            id="entra-console-rail-overwrites"
            icon={PencilLine}
            title={t('integrations.entra.console.overwrites.title')}
          >
            {/* Three of the five overwrite rules used to be listed here as
                copy-pasted rows, so turning on the email or UPN rule changed
                the sync and changed nothing on the card that exists to say what
                the sync may change. Naming the rules that are on beats five
                rows of "Off", four of which never vary on most tenants. */}
            <p className="text-sm" id="entra-console-overwrites-summary">
              {overwrittenFields.length === 0
                ? t('integrations.entra.console.overwrites.none')
                : overwrittenFields.join(', ')}
            </p>
            {/* The rule that produces the "Made inactive" number two cards to
                the left, and the only one in the set that defaults on. It was
                the one the card never mentioned. */}
            <p className="mt-2 text-sm text-muted-foreground" id="entra-console-overwrites-inactivate">
              {fieldSyncConfig.markInactiveWhenDisabled
                ? t('integrations.entra.console.overwrites.inactivateOn')
                : t('integrations.entra.console.overwrites.inactivateOff')}
            </p>
            <div className="mt-3">
              <Button
                id="entra-console-rail-field-rules"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => selectTab('field-rules')}
              >
                {t('integrations.entra.console.overwrites.change')}
              </Button>
            </div>
          </EntraSection>
      </div>
    </div>
  );

  const connectionPanel = (
    <div className="space-y-4" id="entra-console-connection">
      <div className="grid gap-4 md:grid-cols-2">
        <EntraSection
          icon={Plug}
          title={t('integrations.entra.settings.connection.details')}
          tone={connectionHealthy ? 'default' : 'blocking'}
        >
          <div>
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
              value={
                <RelativeTime
                  value={status?.lastValidatedAt}
                  fallback={t('integrations.entra.settings.validation.neverFormatted')}
                />
              }
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
        </EntraSection>

        <EntraSection
          id="entra-console-permissions"
          icon={KeyRound}
          title={t('integrations.entra.console.connection.permissionsTitle')}
        >
          <MarkList items={permissionItems} />
        </EntraSection>
      </div>

      <EntraSection
        icon={Building2}
        title={t('integrations.entra.console.connection.mappingTitle')}
        description={t('integrations.entra.console.connection.mappingDescription')}
      >
        <div className="mb-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
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
      </EntraSection>

      <EntraSection
        id="entra-skipped-tenants-panel"
        icon={SkipForward}
        title={t('integrations.entra.settings.skipped.title')}
        tone={skippedTenants.length > 0 ? 'warning' : 'default'}
      >
        {skippedTenants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
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
      </EntraSection>
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

  const tabCounts: Partial<Record<EntraConsoleTab, React.ReactNode>> = {
    clients: mappings.length,
    'review-queue': reviewQueueCount
      ? `${reviewQueueCount}${reviewQueueAtLimit ? '+' : ''}`
      : 0,
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
          <Badge id="entra-console-health" variant={headline.variant}>
            {headline.label}
          </Badge>
          {/* A disabled control that will not say why is a dead end. The span
              carries the tooltip because a disabled button swallows the pointer
              events Radix listens for. */}
          <Tooltip content={syncBlockedReason || ''} open={syncBlockedReason ? undefined : false}>
            <span data-sync-blocked={syncBlockedReason || undefined}>
              <Button
                id="entra-console-sync-now"
                type="button"
                size="sm"
                onClick={() => void handleSyncAll()}
                disabled={syncAllBusy || Boolean(syncBlockedReason)}
              >
                {syncAllBusy
                  ? t('integrations.entra.console.actions.syncingNow')
                  : t('integrations.entra.console.actions.syncNow')}
              </Button>
            </span>
          </Tooltip>
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
