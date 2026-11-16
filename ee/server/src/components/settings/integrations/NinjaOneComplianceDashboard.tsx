'use client';

/**
 * NinjaOne Compliance Dashboard Widget
 *
 * Displays fleet-wide compliance metrics for RMM-managed devices:
 * - Device online/offline status
 * - Patch compliance summary
 * - Active alert count
 * - Software inventory stats
 */

import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  Monitor,
  MonitorOff,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { getJobProgressAction } from '@alga-psa/jobs/actions';
import { isActionMessageError } from '@alga-psa/ui/lib/errorHandling';
import type {
  RmmInventorySyncKind,
  RmmInventorySyncSettings,
} from '@alga-psa/shared/rmm/inventorySync';
import {
  getRmmComplianceSummary,
  getRmmInventorySyncStatus,
  triggerPatchStatusSync,
  triggerSoftwareInventorySync,
} from '../../../lib/actions/integrations/ninjaoneActions';

interface ComplianceSummary {
  totalDevices: number;
  devicesOnline: number;
  devicesOffline: number;
  devicesWithAlerts: number;
  devicesNeedingPatches: number;
  patchesPending: number;
  patchesFailed: number;
  lastSyncAt?: string;
  inventorySync?: RmmInventorySyncSettings;
}

/**
 * Per-kind sync strip state. Deliberately separate from the summary error: a
 * failed sync must never unmount the metrics and the buttons that retry it.
 */
type SyncKindState =
  | { phase: 'running'; jobId: string; done?: number; total?: number }
  | {
      phase: 'succeeded' | 'partial' | 'failed';
      assetsUpdated: number;
      assetsFailed: number;
      errors: string[];
      errorCount: number;
      message?: string;
    };

type SyncState = Record<RmmInventorySyncKind, SyncKindState | null>;

const SYNC_KINDS: readonly RmmInventorySyncKind[] = ['software', 'patches'];
const JOB_POLL_INTERVAL_MS = 2000;

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  total?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

const MetricCard: React.FC<MetricCardProps> = ({
  icon: Icon,
  label,
  value,
  total,
  variant = 'default',
}) => {
  const variantClasses = {
    default: 'text-muted-foreground',
    success: 'text-green-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  };

  const iconClasses = {
    default: 'text-muted-foreground',
    success: 'text-green-500',
    warning: 'text-amber-500',
    danger: 'text-red-500',
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className={`p-2 rounded-full bg-background ${iconClasses[variant]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-semibold ${variantClasses[variant]}`}>
          {value}
          {total !== undefined && (
            <span className="text-sm font-normal text-muted-foreground">
              /{total}
            </span>
          )}
        </p>
      </div>
    </div>
  );
};

/** Latest per-batch progress row written by the rmm-inventory-sync handler. */
function latestProgress(details: Array<{ result?: unknown }>): { done: number; total: number } | null {
  for (let i = details.length - 1; i >= 0; i--) {
    let value = details[i]?.result as unknown;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    const rec = value as { done?: unknown; total?: unknown } | null;
    if (rec && typeof rec.done === 'number' && typeof rec.total === 'number') {
      return { done: rec.done, total: rec.total };
    }
  }
  return null;
}

/**
 * Polls while a sync is running, every 2s, until the sync is over or the panel
 * unmounts. Deliberately no client-side timeout: a 30-minute fleet sync is
 * exactly the case this exists for.
 *
 * Liveness is read from the stored settings record (heartbeat), NOT from the
 * job's status: on Temporal the job is forwarded fire-and-forget, so its `jobs`
 * row reads terminal as soon as the event is published while the walk is still
 * running. A terminal job with a fresh running record therefore keeps polling.
 * The sync is over when the record is no longer this job's running record, or
 * its heartbeat has gone stale. done/total come from the record; job_details
 * progress (getJobProgressAction) is only a fallback before the first batch.
 */
// LEVERAGE: friction job-progress-polling — useJobMonitor (@alga-psa/jobs/hooks) polls on a fixed 5s and never stops on a terminal status, and jobs.status is not trustworthy for forwarded (Temporal) jobs, so this panel re-implements the poll loop over the settings record
function useInventoryJobPolling(
  kind: RmmInventorySyncKind,
  jobId: string | null,
  onProgress: (done: number, total: number) => void,
  onFinished: () => void,
): void {
  const progressRef = useRef(onProgress);
  const finishedRef = useRef(onFinished);
  progressRef.current = onProgress;
  finishedRef.current = onFinished;

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      let finished = false;
      try {
        const status = await getRmmInventorySyncStatus();
        if (cancelled) return;
        if (status.success && status.inventorySync) {
          const record = status.inventorySync[kind];
          if (!record || record.jobId !== jobId || record.status !== 'running' || record.stale) {
            finished = true;
          } else if (record.done !== undefined && record.total !== undefined) {
            progressRef.current(record.done, record.total);
          } else {
            // No batch finished yet: fall back to the job_details progress rows.
            const progress = await getJobProgressAction(jobId);
            if (cancelled) return;
            if (!isActionMessageError(progress)) {
              const latest = latestProgress(progress.details as Array<{ result?: unknown }>);
              if (latest) progressRef.current(latest.done, latest.total);
            }
          }
        }
      } catch (err) {
        // Transient (network/server restart): keep polling.
        console.error('Failed to poll inventory sync status:', err);
      }
      if (cancelled) return;
      if (finished) {
        finishedRef.current();
      } else {
        timer = setTimeout(tick, JOB_POLL_INTERVAL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, kind]);
}

interface NinjaOneComplianceDashboardProps {
  /**
   * When this value changes, re-fetch compliance summary.
   * Used to refresh after device sync.
   */
  refreshKey?: number;
}

const NinjaOneComplianceDashboard: React.FC<NinjaOneComplianceDashboardProps> = ({ refreshKey }) => {
  const { t } = useTranslation('msp/integrations');
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  // Set ONLY by fetchSummary: the one thing that may replace the panel with the
  // "unavailable + Retry" card. Sync problems live in `syncState`.
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>({ software: null, patches: null });
  const [detailsOpen, setDetailsOpen] = useState<Record<RmmInventorySyncKind, boolean>>({
    software: false,
    patches: false,
  });
  const [isStarting, setIsStarting] = useState<Record<RmmInventorySyncKind, boolean>>({
    software: false,
    patches: false,
  });

  const patchSyncState = (kind: RmmInventorySyncKind, next: SyncKindState | null) =>
    setSyncState((prev) => ({ ...prev, [kind]: next }));

  /**
   * Maps the durable settings record to strip state. `overwrite` is false for
   * seeding (panel load / manual refresh must not clobber a live local state)
   * and true once polling saw the sync end, when the stored record is the truth.
   */
  const applyInventorySync = (records: RmmInventorySyncSettings | undefined, overwrite: boolean) => {
    if (!records) return;
    setSyncState((prev) => {
      const next = { ...prev };
      for (const kind of SYNC_KINDS) {
        const record = records[kind];
        if (!record) continue;
        if (!overwrite && prev[kind]) continue;
        if (record.status === 'running') {
          next[kind] = record.stale
            // Heartbeat expired: the run died without writing an outcome
            // (ineligible no-op, killed worker). A *fresh* record stays running
            // however the job row reads.
            ? {
                phase: 'failed',
                assetsUpdated: 0,
                assetsFailed: 0,
                errors: [],
                errorCount: 0,
                message: t('integrations.rmm.ninjaOne.compliance.sync.endedWithoutResult'),
              }
            : { phase: 'running', jobId: record.jobId, done: record.done, total: record.total };
        } else {
          next[kind] = {
            phase: record.status,
            assetsUpdated: record.assetsUpdated,
            assetsFailed: record.assetsFailed,
            errors: record.errors ?? [],
            errorCount: record.errorCount ?? record.errors?.length ?? 0,
            message: record.status === 'failed' ? record.errors?.[0] : undefined,
          };
        }
      }
      return next;
    });
  };

  const fetchSummary = async (overwriteSync = false): Promise<RmmInventorySyncSettings | null> => {
    let records: RmmInventorySyncSettings | null = null;
    setIsLoading(true);
    setSummaryError(null);
    try {
      const result = await getRmmComplianceSummary();
      if (!result.success || result.error) {
        setSummaryError(result.error ?? t('integrations.rmm.ninjaOne.compliance.summaryError'));
        setSummary(null);
      } else if (result.summary) {
        setSummary(result.summary);
        applyInventorySync(result.summary.inventorySync, overwriteSync);
        records = result.summary.inventorySync ?? {};
      } else {
        setSummary(null);
      }
    } catch (err) {
      console.error('Failed to load NinjaOne compliance summary:', err);
      setSummaryError(t('integrations.rmm.ninjaOne.compliance.summaryError'));
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
    return records;
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  // Parent-driven refresh without double-fetching on mount.
  const lastRefreshKeyRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (refreshKey === undefined) return;
    if (lastRefreshKeyRef.current === undefined) {
      lastRefreshKeyRef.current = refreshKey;
      return;
    }
    if (refreshKey !== lastRefreshKeyRef.current) {
      lastRefreshKeyRef.current = refreshKey;
      fetchSummary();
    }
  }, [refreshKey]);

  const runningJobId = (kind: RmmInventorySyncKind): string | null => {
    const state = syncState[kind];
    return state?.phase === 'running' ? state.jobId : null;
  };

  const trackJob = (kind: RmmInventorySyncKind) => ({
    onProgress: (done: number, total: number) =>
      setSyncState((prev) => {
        const current = prev[kind];
        return current?.phase === 'running' ? { ...prev, [kind]: { ...current, done, total } } : prev;
      }),
    // One summary refetch picks up the durable outcome written by the handler.
    onFinished: () => {
      void fetchSummary(true).then((records) => {
        // Could not read an outcome (summary failed, or the record is gone): drop
        // the "running" state so the buttons come back; a later successful load
        // re-seeds it from settings.
        if (!records?.[kind]) patchSyncState(kind, null);
      });
    },
  });
  const softwareTracking = trackJob('software');
  const patchesTracking = trackJob('patches');
  useInventoryJobPolling('software', runningJobId('software'), softwareTracking.onProgress, softwareTracking.onFinished);
  useInventoryJobPolling('patches', runningJobId('patches'), patchesTracking.onProgress, patchesTracking.onFinished);

  const startSync = async (kind: RmmInventorySyncKind) => {
    setIsStarting((prev) => ({ ...prev, [kind]: true }));
    setDetailsOpen((prev) => ({ ...prev, [kind]: false }));
    try {
      const result = kind === 'software'
        ? await triggerSoftwareInventorySync({ trackChanges: true })
        : await triggerPatchStatusSync();
      if (!result.success || !result.jobId) {
        patchSyncState(kind, {
          phase: 'failed',
          assetsUpdated: 0,
          assetsFailed: 0,
          errors: [],
          errorCount: 0,
          message: result.error ?? t('integrations.rmm.ninjaOne.compliance.sync.startFailed'),
        });
        return;
      }
      patchSyncState(kind, { phase: 'running', jobId: result.jobId });
    } catch (err) {
      console.error(`Failed to start ${kind} sync:`, err);
      patchSyncState(kind, {
        phase: 'failed',
        assetsUpdated: 0,
        assetsFailed: 0,
        errors: [],
        errorCount: 0,
        message: t('integrations.rmm.ninjaOne.compliance.sync.startFailed'),
      });
    } finally {
      setIsStarting((prev) => ({ ...prev, [kind]: false }));
    }
  };

  const isBusy = (kind: RmmInventorySyncKind) =>
    isStarting[kind] || syncState[kind]?.phase === 'running';

  const renderSyncStrip = (kind: RmmInventorySyncKind) => {
    const state = syncState[kind];
    if (!state) return null;
    const prefix = 'integrations.rmm.ninjaOne.compliance.sync';

    if (state.phase === 'running') {
      return (
        <Alert key={kind} id={`ninjaone-sync-${kind}-strip`} variant="info" showIcon={false}>
          <AlertDescription className="flex items-center gap-2">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>{t(`${prefix}.running.${kind}`)}</span>
            {state.total !== undefined && state.done !== undefined && (
              <span className="text-muted-foreground">
                {t(`${prefix}.progress`, { done: state.done, total: state.total })}
              </span>
            )}
          </AlertDescription>
        </Alert>
      );
    }

    if (state.phase === 'failed') {
      return (
        <Alert key={kind} id={`ninjaone-sync-${kind}-strip`} variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{t(`${prefix}.failed.${kind}`, { reason: state.message ?? t(`${prefix}.startFailed`) })}</span>
            <Button
              id={`ninjaone-sync-${kind}-retry-btn`}
              variant="outline"
              size="sm"
              onClick={() => startSync(kind)}
              disabled={isBusy(kind)}
            >
              {t(`${prefix}.retry`)}
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    const isPartial = state.phase === 'partial';
    return (
      <Alert key={kind} id={`ninjaone-sync-${kind}-strip`} variant={isPartial ? 'warning' : 'success'}>
        <AlertDescription>
          <div className="flex items-center justify-between gap-2">
            <span>
              {t(`${prefix}.${isPartial ? 'partial' : 'succeeded'}.${kind}`)}
              {' · '}
              {t(`${prefix}.updated`, { value: state.assetsUpdated })}
              {isPartial && (
                <>
                  {' · '}
                  {t(`${prefix}.failedCount`, { value: state.assetsFailed })}
                </>
              )}
            </span>
            {isPartial && state.errors.length > 0 && (
              <Button
                id={`ninjaone-sync-${kind}-details-btn`}
                variant="ghost"
                size="sm"
                onClick={() => setDetailsOpen((prev) => ({ ...prev, [kind]: !prev[kind] }))}
                aria-expanded={detailsOpen[kind]}
              >
                {t(`${prefix}.details`)}
              </Button>
            )}
          </div>
          {isPartial && detailsOpen[kind] && (
            <div className="mt-2 text-xs">
              <ul className="list-disc pl-4 space-y-0.5">
                {state.errors.map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
              {state.errorCount > state.errors.length && (
                <p className="mt-1 text-muted-foreground">
                  {t(`${prefix}.truncated`, { shown: state.errors.length, total: state.errorCount })}
                </p>
              )}
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  };

  // Only the very first load replaces the panel; refetches (refresh button, a
  // finished sync) keep the metrics and buttons on screen.
  if (isLoading && !summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('integrations.rmm.ninjaOne.compliance.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <LoadingIndicator
            spinnerProps={{ size: 'sm' }}
            text={t('integrations.rmm.ninjaOne.compliance.loading')}
          />
        </CardContent>
      </Card>
    );
  }

  // The ONLY consumer of summaryError: a sync never lands here.
  if (summaryError || !summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('integrations.rmm.ninjaOne.compliance.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {summaryError || t('integrations.rmm.ninjaOne.compliance.noData')}
          </div>
          <Button
            id="ninjaone-compliance-retry-btn"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => fetchSummary()}
          >
            {t('integrations.rmm.ninjaOne.compliance.actions.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Calculate compliance scores
  const onlinePercentage = summary.totalDevices > 0
    ? Math.round((summary.devicesOnline / summary.totalDevices) * 100)
    : 0;

  const patchCompliant = summary.totalDevices - (summary.patchesPending > 0 ? 1 : 0) - (summary.patchesFailed > 0 ? 1 : 0);
  const isHealthy = summary.devicesOffline === 0 && summary.patchesFailed === 0 && summary.devicesWithAlerts === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {t('integrations.rmm.ninjaOne.compliance.title')}
              {isHealthy && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {t('integrations.rmm.ninjaOne.compliance.description')}
            </CardDescription>
          </div>
          <Button
            id="ninjaone-compliance-refresh-btn"
            variant="ghost"
            size="sm"
            onClick={() => fetchSummary()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Device Status */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={Monitor}
            label={t('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline')}
            value={summary.devicesOnline}
            total={summary.totalDevices}
            variant={onlinePercentage >= 90 ? 'success' : onlinePercentage >= 70 ? 'warning' : 'danger'}
          />
          <MetricCard
            icon={MonitorOff}
            label={t('integrations.rmm.ninjaOne.compliance.metrics.devicesOffline')}
            value={summary.devicesOffline}
            variant={summary.devicesOffline === 0 ? 'success' : summary.devicesOffline < 5 ? 'warning' : 'danger'}
          />
        </div>

        {/* Patch Status */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={ShieldAlert}
            label={t('integrations.rmm.ninjaOne.compliance.metrics.patchesPending')}
            value={summary.patchesPending}
            variant={summary.patchesPending === 0 ? 'success' : summary.patchesPending < 10 ? 'warning' : 'danger'}
          />
          <MetricCard
            icon={summary.patchesFailed === 0 ? ShieldCheck : XCircle}
            label={t('integrations.rmm.ninjaOne.compliance.metrics.patchesFailed')}
            value={summary.patchesFailed}
            variant={summary.patchesFailed === 0 ? 'success' : 'danger'}
          />
        </div>

        {/* Alerts */}
        <MetricCard
          icon={AlertTriangle}
          label={t('integrations.rmm.ninjaOne.compliance.metrics.devicesWithAlerts')}
          value={summary.devicesWithAlerts}
          variant={summary.devicesWithAlerts === 0 ? 'success' : summary.devicesWithAlerts < 5 ? 'warning' : 'danger'}
        />

        {/* Sync Actions: always visible while the summary is present; each is
            disabled only while its own kind of sync is in flight. */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            id="ninjaone-sync-patches-btn"
            variant="outline"
            size="sm"
            onClick={() => startSync('patches')}
            disabled={isBusy('patches')}
            className="flex-1"
          >
            {isBusy('patches') ? (
              <>
                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                {t('integrations.rmm.ninjaOne.compliance.actions.syncing')}
              </>
            ) : (
              t('integrations.rmm.ninjaOne.compliance.actions.syncPatches')
            )}
          </Button>
          <Button
            id="ninjaone-sync-software-btn"
            variant="outline"
            size="sm"
            onClick={() => startSync('software')}
            disabled={isBusy('software')}
            className="flex-1"
          >
            {isBusy('software') ? (
              <>
                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                {t('integrations.rmm.ninjaOne.compliance.actions.syncing')}
              </>
            ) : (
              t('integrations.rmm.ninjaOne.compliance.actions.syncSoftware')
            )}
          </Button>
        </div>

        {/* Sync strip: running / partial / failed per kind */}
        {SYNC_KINDS.map((kind) => renderSyncStrip(kind))}
      </CardContent>
    </Card>
  );
};

export default NinjaOneComplianceDashboard;
