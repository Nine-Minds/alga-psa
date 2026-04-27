'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getEntraSyncRunHistory, type EntraSyncHistoryRun } from '@alga-psa/integrations/actions';

interface EntraRunDetail {
  run: {
    runId: string;
    status: string;
    runType: string;
    startedAt: string;
    completedAt: string | null;
    totalTenants: number;
    processedTenants: number;
    succeededTenants: number;
    failedTenants: number;
  } | null;
  tenantResults: Array<{
    managedTenantId: string | null;
    clientId: string | null;
    status: string;
    created: number;
    linked: number;
    updated: number;
    ambiguous: number;
    inactivated: number;
    errorMessage: string | null;
  }>;
}

export default function EntraSyncHistoryPanel() {
  const { t } = useTranslation('msp/integrations');
  const formatDateTime = React.useCallback((value: string | null): string => {
    if (!value) return t('integrations.entra.syncHistory.run.inProgress');
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Date(parsed).toLocaleString();
  }, [t]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<EntraSyncHistoryRun[]>([]);
  const [expandedRunId, setExpandedRunId] = React.useState<string | null>(null);
  const [detailsByRunId, setDetailsByRunId] = React.useState<Record<string, EntraRunDetail>>({});

  const loadHistory = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getEntraSyncRunHistory(10);
      if ('error' in result) {
        setRuns([]);
        setError(result.error || t('integrations.entra.syncHistory.errors.loadFailed'));
      } else {
        const nextRuns = (result.data?.runs || []).slice().sort((a, b) => {
          return Date.parse(b.startedAt) - Date.parse(a.startedAt);
        });
        setRuns(nextRuns);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const loadDetails = React.useCallback(async (runId: string) => {
    if (detailsByRunId[runId]) {
      return;
    }

    const response = await fetch(`/api/integrations/entra/sync/runs/${runId}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: EntraRunDetail;
      error?: string;
    } | null;

    if (!response.ok || !payload?.success || !payload.data) {
      throw new Error(payload?.error || `Failed to load run ${runId}.`);
    }

    setDetailsByRunId((current) => ({
      ...current,
      [runId]: payload.data as EntraRunDetail,
    }));
  }, [detailsByRunId]);

  const toggleExpanded = React.useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }

    setExpandedRunId(runId);
    try {
      await loadDetails(runId);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : t('integrations.entra.syncHistory.errors.loadDetailFailed'));
    }
  }, [expandedRunId, loadDetails]);

  return (
    <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-sync-history-panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t('integrations.entra.syncHistory.title')}</p>
        <Button id="entra-sync-history-refresh" type="button" size="sm" variant="ghost" onClick={loadHistory} disabled={loading}>
          {t('integrations.entra.syncHistory.actions.refresh')}
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">{t('integrations.entra.syncHistory.loading')}</p> : null}
      {!loading && runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.entra.syncHistory.empty')}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

      {runs.length > 0 ? (
        <div className="space-y-2">
          {runs.map((run) => {
            const details = detailsByRunId[run.runId];
            return (
              <div key={run.runId} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-medium">
                      {t('integrations.entra.syncHistory.run.header', { runType: run.runType, status: run.status })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.entra.syncHistory.run.timing', {
                        started: formatDateTime(run.startedAt),
                        completed: formatDateTime(run.completedAt),
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.entra.syncHistory.run.tenants', {
                        processed: run.processedTenants,
                        total: run.totalTenants,
                        success: run.succeededTenants,
                        failed: run.failedTenants,
                      })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    id={`entra-sync-run-drilldown-${run.runId}`}
                    onClick={() => void toggleExpanded(run.runId)}
                  >
                    {expandedRunId === run.runId
                      ? t('integrations.entra.syncHistory.actions.hideDetails')
                      : t('integrations.entra.syncHistory.actions.viewDetails')}
                  </Button>
                </div>

                {expandedRunId === run.runId && details ? (
                  <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                    {details.tenantResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('integrations.entra.syncHistory.details.noResults')}</p>
                    ) : (
                      details.tenantResults.map((tenant, index) => (
                        <div
                          key={`${run.runId}-${tenant.managedTenantId || index}`}
                          className="rounded border border-border/50 p-2 text-xs"
                        >
                          <p className="font-medium">
                            {t('integrations.entra.syncHistory.details.tenantHeader', {
                              tenant: tenant.managedTenantId || t('integrations.entra.syncHistory.details.unknownTenant'),
                              status: tenant.status,
                            })}
                          </p>
                          <p className="text-muted-foreground">
                            {t('integrations.entra.syncHistory.details.stats', {
                              created: tenant.created,
                              linked: tenant.linked,
                              updated: tenant.updated,
                              ambiguous: tenant.ambiguous,
                              inactivated: tenant.inactivated,
                            })}
                          </p>
                          {tenant.errorMessage ? (
                            <p className="text-destructive">{tenant.errorMessage}</p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
