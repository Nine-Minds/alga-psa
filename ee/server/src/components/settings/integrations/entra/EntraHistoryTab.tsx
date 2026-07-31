'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  EntraConfirmedMapping,
  EntraSyncHistoryRun,
} from '@alga-psa/integrations/actions';
import {
  DEFAULT_ENTRA_HISTORY_FILTERS,
  buildEntraRunHistoryCsv,
  ENTRA_RUN_RESULT_BADGE_VARIANTS,
  ENTRA_RUN_RESULT_LABEL_KEYS,
  entraRunResultOutcome,
  filterEntraRuns,
  isScheduledEntraRun,
  type EntraHistoryFilters,
} from './entraConsoleModel';
import { RelativeTime } from './RelativeTime';

interface EntraHistoryTabProps {
  runs: EntraSyncHistoryRun[];
  mappings: EntraConfirmedMapping[];
  loading: boolean;
}

const PAGE_SIZE = 10;

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

  // DataTable owns the page now, and resets to the first one when its data
  // changes — which is exactly what changing a filter does.
  const setFilter = <K extends keyof EntraHistoryFilters>(key: K, value: EntraHistoryFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
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

  const columns: ColumnDefinition<EntraSyncHistoryRun>[] = [
    {
      title: t('integrations.entra.console.history.columns.when'),
      dataIndex: 'startedAt',
      width: '150px',
      render: (_value, run) => <RelativeTime value={run.startedAt} fallback="—" />,
    },
    {
      title: t('integrations.entra.console.history.columns.trigger'),
      dataIndex: 'runType',
      width: '120px',
      // Not `runType`: "all-tenants" and "preflight" are schema words, and this
      // screen's own filter already has English ones for the same distinction.
      render: (_value, run) =>
        t(
          isScheduledEntraRun(run)
            ? 'integrations.entra.console.history.triggers.scheduled'
            : 'integrations.entra.console.history.triggers.manual'
        ),
    },
    {
      title: t('integrations.entra.console.history.columns.scope'),
      dataIndex: 'scopeManagedTenantId',
      render: (_value, run) =>
        run.scopeManagedTenantId
          ? clientNames.get(run.scopeManagedTenantId) || run.scopeManagedTenantId
          : t('integrations.entra.console.history.allClients'),
    },
    {
      title: t('integrations.entra.console.history.columns.clients'),
      dataIndex: 'totalTenants',
      width: '110px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
    {
      title: t('integrations.entra.console.history.columns.succeeded'),
      dataIndex: 'succeededTenants',
      width: '120px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
    {
      title: t('integrations.entra.console.history.columns.failed'),
      dataIndex: 'failedTenants',
      width: '104px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
    {
      title: t('integrations.entra.console.lastRun.columns.result'),
      dataIndex: 'status',
      width: '170px',
      render: (_value, run) => {
        const outcome = entraRunResultOutcome(run);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* The badge used to print `run.status` — the raw enum, untranslated
                in all ten locales. */}
            <Badge size="sm" variant={ENTRA_RUN_RESULT_BADGE_VARIANTS[outcome]}>
              {t(ENTRA_RUN_RESULT_LABEL_KEYS[outcome])}
            </Badge>
            {run.isDryRun ? (
              <Badge size="sm" variant="default-muted">
                {t('integrations.entra.console.history.previewBadge')}
              </Badge>
            ) : null}
          </div>
        );
      },
    },
  ];

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
        <DataTable
          id="entra-history-table"
          data={filtered}
          columns={columns}
          pagination={filtered.length > PAGE_SIZE}
          pageSize={PAGE_SIZE}
        />
      )}

    </div>
  );
}

export default EntraHistoryTab;
