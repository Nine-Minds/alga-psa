'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  EntraConfirmedMapping,
  EntraSyncHistoryRun,
} from '@alga-psa/integrations/actions';
import {
  DEFAULT_ENTRA_HISTORY_FILTERS,
  buildEntraRunHistoryCsv,
  filterEntraRuns,
  type EntraHistoryFilters,
} from './entraConsoleModel';

interface EntraHistoryTabProps {
  runs: EntraSyncHistoryRun[];
  mappings: EntraConfirmedMapping[];
  loading: boolean;
}

const PAGE_SIZE = 10;

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

/**
 * Run history that names clients.
 *
 * F12: run details identified tenants by Microsoft GUID — on the feature whose
 * entire purpose is mapping GUIDs to client names. Scope is resolved through
 * the confirmed mappings here, so a single-client run reads "Contoso" and an
 * export can be handed to someone who has never seen a tenant ID.
 */
export function EntraHistoryTab({
  runs,
  mappings,
  loading,
}: EntraHistoryTabProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [filters, setFilters] = React.useState<EntraHistoryFilters>(DEFAULT_ENTRA_HISTORY_FILTERS);
  const [page, setPage] = React.useState(0);

  const clientNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const mapping of mappings) {
      map.set(
        mapping.managedTenantId,
        mapping.clientName || mapping.displayName || mapping.entraTenantId
      );
    }
    return map;
  }, [mappings]);

  const filtered = filterEntraRuns(runs, filters);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const setFilter = <K extends keyof EntraHistoryFilters>(key: K, value: EntraHistoryFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  };

  const handleExport = React.useCallback(() => {
    const csv = buildEntraRunHistoryCsv(filtered, clientNames);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'entra-sync-history.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [clientNames, filtered]);

  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-muted" id="entra-history-loading" />;
  }

  return (
    <div className="space-y-3" id="entra-console-history">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {(['all', 'scheduled', 'manual'] as EntraHistoryFilters['trigger'][]).map((candidate) => (
            <Button
              key={candidate}
              id={`entra-history-trigger-${candidate}`}
              type="button"
              size="sm"
              variant={filters.trigger === candidate ? 'default' : 'ghost'}
              onClick={() => setFilter('trigger', candidate)}
            >
              {t(`integrations.entra.console.history.triggers.${candidate}`)}
            </Button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            id="entra-history-only-failures"
            checked={filters.onlyFailures}
            onCheckedChange={(value) => setFilter('onlyFailures', value)}
          />
          {t('integrations.entra.console.history.onlyFailures')}
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            id="entra-history-include-previews"
            checked={filters.includePreviews}
            onCheckedChange={(value) => setFilter('includePreviews', value)}
          />
          {t('integrations.entra.console.history.includePreviews')}
        </label>

        <Button
          id="entra-history-export"
          type="button"
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={filtered.length === 0}
        >
          {t('integrations.entra.console.history.export')}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground" id="entra-history-empty">
          {t('integrations.entra.console.history.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
          {visible.map((run) => (
            <li key={run.runId} className="p-3" id={`entra-history-run-${run.runId}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t('integrations.entra.console.history.runHeader', {
                      scope: run.scopeManagedTenantId
                        ? clientNames.get(run.scopeManagedTenantId) || run.scopeManagedTenantId
                        : t('integrations.entra.console.history.allClients'),
                      status: run.status,
                    })}
                    {run.isDryRun
                      ? ` · ${t('integrations.entra.console.history.previewBadge')}`
                      : ''}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t('integrations.entra.console.history.runMeta', {
                      started: formatDateTime(run.startedAt),
                      completed: formatDateTime(run.completedAt),
                      runType: run.runType,
                    })}
                  </p>
                </div>
                <p className="flex-shrink-0 text-xs text-muted-foreground">
                  {t('integrations.entra.console.history.tenantCounts', {
                    succeeded: run.succeededTenants,
                    failed: run.failedTenants,
                    total: run.totalTenants,
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            id="entra-history-prev"
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={currentPage === 0}
          >
            {t('integrations.entra.console.history.previous')}
          </Button>
          <span className="text-sm text-muted-foreground" id="entra-history-page">
            {t('integrations.entra.console.history.page', {
              page: currentPage + 1,
              pages: pageCount,
            })}
          </span>
          <Button
            id="entra-history-next"
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={currentPage >= pageCount - 1}
          >
            {t('integrations.entra.console.history.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default EntraHistoryTab;
