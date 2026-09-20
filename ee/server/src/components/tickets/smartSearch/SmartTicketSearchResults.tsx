'use client';

/**
 * Smart ticket search results: three append-only buckets that fill in as Jev
 * scores stream from the server, with a progress strip, cancel, and the tickets
 * that could not be scored listed last so nothing the chips matched is hidden.
 *
 * The dashboard owns the search box, the chip filters, selection state, and the
 * column definitions; this panel renders the same columns through DataTable so
 * row click, selection, and bulk actions behave exactly as on the main table.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Sparkles, X } from 'lucide-react';

import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Progress } from '@alga-psa/ui/components/Progress';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { loadTicketListItemsByIds } from '@alga-psa/tickets/actions/optimizedTicketActions';
import type {
  SmartSearchBucket,
  SmartSearchRowMetadata,
  SmartSearchScoredItem,
} from '@alga-psa/tickets/lib/smartTicketSearch/types';
import type { ColumnDefinition, ITicketListFilters, ITicketListItem } from '@alga-psa/types';

import { useSmartTicketSearchStream } from './useSmartTicketSearchStream';

export interface SmartTicketSearchResultsProps {
  id: string;
  /** The chip filters. `searchQuery` is ignored by the server. */
  filters: ITicketListFilters;
  query: string;
  /** Bumped by the dashboard to (re)run the search. */
  runToken: number;
  /** True when the chips changed after the last run; the strip offers a rerun. */
  filtersStale: boolean;
  onRerun: () => void;
  columns: ColumnDefinition<ITicketListItem>[];
  rowClassName: (record: ITicketListItem) => string;
  onRowClick: (record: ITicketListItem) => void;
  onVisibleRowsChange: (rows: ITicketListItem[]) => void;
  onRowMetadata: (metadata: SmartSearchRowMetadata) => void;
  onExit: () => void;
}

type RowWithScore = ITicketListItem & { id: string; smart_search_score?: number; smart_search_bucket?: SmartSearchBucket };

const BUCKET_ORDER: SmartSearchBucket[] = ['strong', 'possible', 'unlikely'];

function relevanceChipClass(bucket: SmartSearchBucket): string {
  switch (bucket) {
    case 'strong':
      return 'border-[rgb(var(--badge-success-border))] bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))]';
    case 'possible':
      return 'border-[rgb(var(--badge-warning-border))] bg-[rgb(var(--badge-warning-bg))] text-[rgb(var(--badge-warning-text))]';
    default:
      return 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] text-[rgb(var(--color-text-500))]';
  }
}

export function SmartTicketSearchResults({
  id,
  filters,
  query,
  runToken,
  filtersStale,
  onRerun,
  columns,
  rowClassName,
  onRowClick,
  onVisibleRowsChange,
  onRowMetadata,
  onExit,
}: SmartTicketSearchResultsProps) {
  const { t } = useTranslation('features/tickets');
  const { state, run, cancel } = useSmartTicketSearchStream({ onRowMetadata });
  const [showUnlikely, setShowUnlikely] = useState(false);
  const [unscoredRows, setUnscoredRows] = useState<ITicketListItem[]>([]);
  const lastRunTokenRef = useRef<number | null>(null);

  // The dashboard bumps runToken to start a search; each bump is one run.
  useEffect(() => {
    if (lastRunTokenRef.current === runToken) {
      return;
    }
    lastRunTokenRef.current = runToken;
    setShowUnlikely(false);
    setUnscoredRows([]);
    run(filters, query);
    // The filters and query captured at the bump are the ones this run uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToken]);

  // Failed batches are hydrated once the stream has settled so the "could not
  // be scored" section still shows every ticket the chips matched.
  const settled = state.status === 'done' || state.status === 'error' || state.status === 'cancelled';
  useEffect(() => {
    if (!settled || state.unscoredTicketIds.length === 0) {
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await loadTicketListItemsByIds(filters, state.unscoredTicketIds);
      if (cancelled) {
        return;
      }
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        console.error('[smart-ticket-search] failed to hydrate unscored rows', getErrorMessage(result));
        return;
      }
      onRowMetadata(result.metadata);
      setUnscoredRows(result.tickets);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, state.unscoredTicketIds]);

  const columnsWithRelevance = useMemo<ColumnDefinition<RowWithScore>[]>(() => {
    const relevanceColumn: ColumnDefinition<RowWithScore> = {
      title: t('smartSearch.relevanceColumn', 'Match'),
      dataIndex: 'smart_search_score',
      width: '72px',
      sortable: false,
      render: (value: unknown, record: RowWithScore) => {
        const bucket = record.smart_search_bucket;
        if (typeof value !== 'number' || !bucket) {
          return null;
        }
        return (
          <span
            className={`inline-flex h-[20px] min-w-[40px] items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold tabular-nums ${relevanceChipClass(bucket)}`}
            title={t('smartSearch.relevance', '{{percent}}% relevant', { percent: Math.round(value * 100) })}
          >
            {Math.round(value * 100)}%
          </span>
        );
      },
    };
    const base = columns as ColumnDefinition<RowWithScore>[];
    // The dashboard's first column is the selection checkbox; the chip sits right after it.
    return base.length > 0 ? [base[0], relevanceColumn, ...base.slice(1)] : [relevanceColumn];
  }, [columns, t]);

  const rowsFor = useCallback(
    (items: SmartSearchScoredItem[]): RowWithScore[] =>
      items.map((item) => ({ ...item.ticket, id: item.ticket.ticket_id as string, smart_search_score: item.score, smart_search_bucket: item.bucket })),
    []
  );

  const strongRows = useMemo(() => rowsFor(state.buckets.strong), [rowsFor, state.buckets.strong]);
  const possibleRows = useMemo(() => rowsFor(state.buckets.possible), [rowsFor, state.buckets.possible]);
  const unlikelyRows = useMemo(() => rowsFor(state.buckets.unlikely), [rowsFor, state.buckets.unlikely]);
  const unscoredWithIds = useMemo<RowWithScore[]>(
    () => unscoredRows.map((ticket) => ({ ...ticket, id: ticket.ticket_id as string })),
    [unscoredRows]
  );

  // Select-all and the bulk bar work off the rows currently rendered.
  useEffect(() => {
    const visible: ITicketListItem[] = [...strongRows, ...possibleRows, ...(showUnlikely ? unlikelyRows : []), ...unscoredWithIds];
    onVisibleRowsChange(visible);
  }, [strongRows, possibleRows, unlikelyRows, unscoredWithIds, showUnlikely, onVisibleRowsChange]);

  const percent = state.total > 0 ? Math.min(100, Math.round(((state.scored + state.failed) / state.total) * 100)) : 0;
  const isRunning = state.status === 'running';

  const renderSection = (bucket: SmartSearchBucket, rows: RowWithScore[]) => {
    const labels: Record<SmartSearchBucket, string> = {
      strong: t('smartSearch.strong', 'Strong matches'),
      possible: t('smartSearch.possible', 'Possible matches'),
      unlikely: t('smartSearch.unlikely', 'Unlikely matches'),
    };
    const collapsed = bucket === 'unlikely' && !showUnlikely;
    return (
      <section key={bucket} {...withDataAutomationId({ id: `${id}-smart-search-${bucket}` })} className="space-y-2">
        <div className="flex items-center gap-2">
          {bucket === 'unlikely' ? (
            <Button
              id={`${id}-smart-search-show-unlikely`}
              variant="ghost"
              size="sm"
              onClick={() => setShowUnlikely((v) => !v)}
              className="flex items-center gap-1 px-1"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span className="text-sm font-semibold text-[rgb(var(--color-text-700))]">{labels[bucket]}</span>
            </Button>
          ) : (
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-700))]">{labels[bucket]}</h3>
          )}
          <span className="chip-primary inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold">
            {rows.length}
          </span>
        </div>
        {collapsed ? null : rows.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[rgb(var(--color-text-500))]">
            {isRunning ? t('smartSearch.emptyBucketRunning', 'None yet') : t('smartSearch.emptyBucket', 'None')}
          </p>
        ) : (
          <DataTable
            {...withDataAutomationId({ id: `${id}-smart-search-${bucket}-table` })}
            data={rows}
            columns={columnsWithRelevance}
            pagination={false}
            // LEVERAGE: friction datatable-pagination-false-still-slices — DataTable applies its
            // page-row model even with pagination off, so a bucket would silently stop at 10 rows.
            pageSize={Math.max(rows.length, 1)}
            manualSorting={false}
            rowClassName={rowClassName as (record: RowWithScore) => string}
            onRowClick={onRowClick as (record: RowWithScore) => void}
          />
        )}
      </section>
    );
  };

  return (
    <div {...withDataAutomationId({ id: `${id}-smart-search` })} className="space-y-4">
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
          <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
            {isRunning
              ? t('smartSearch.scoring', 'Scored {{scored}} of {{total}} tickets', { scored: state.scored + state.failed, total: state.total })
              : state.status === 'done'
                ? t('smartSearch.summary', 'Scored {{total}} tickets · {{strong}} strong · {{possible}} possible', {
                    total: state.scored,
                    strong: state.buckets.strong.length,
                    possible: state.buckets.possible.length,
                  })
                : state.status === 'cancelled'
                  ? t('smartSearch.cancelled', 'Search cancelled after {{scored}} of {{total}} tickets', { scored: state.scored, total: state.total })
                  : state.status === 'error'
                    ? t('smartSearch.errorTitle', 'Smart search stopped')
                    : t('smartSearch.starting', 'Starting smart search…')}
          </span>
          {isRunning && <Spinner size="xs" />}
          <div className="ml-auto flex items-center gap-1.5">
            {filtersStale && !isRunning && (
              <Button id={`${id}-smart-search-rerun`} variant="soft" size="sm" onClick={onRerun} className="flex items-center gap-1">
                <RefreshCw className="h-3.5 w-3.5" />
                {t('smartSearch.rerun', 'Filters changed. Run again')}
              </Button>
            )}
            {state.status === 'error' && (
              <Button id={`${id}-smart-search-retry`} variant="soft" size="sm" onClick={onRerun} className="flex items-center gap-1">
                <RefreshCw className="h-3.5 w-3.5" />
                {t('smartSearch.retry', 'Retry')}
              </Button>
            )}
            {isRunning ? (
              <Button id={`${id}-smart-search-cancel`} variant="outline" size="sm" onClick={cancel} className="flex items-center gap-1">
                <X className="h-3.5 w-3.5" />
                {t('smartSearch.cancel', 'Cancel')}
              </Button>
            ) : (
              <Button id={`${id}-smart-search-exit`} variant="outline" size="sm" onClick={onExit} className="flex items-center gap-1">
                <X className="h-3.5 w-3.5" />
                {t('smartSearch.exit', 'Back to list')}
              </Button>
            )}
          </div>
        </div>
        {(isRunning || state.status === 'cancelled') && state.total > 0 && (
          <Progress value={percent} className="mt-2 h-1.5" />
        )}
        {state.error && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>
              {state.error.code === 'SMART_SEARCH_NOT_CONFIGURED'
                ? t('smartSearch.notConfigured', 'Smart search is not configured on this server')
                : state.error.code === 'ADD_ON_REQUIRED'
                  ? t('smartSearch.addOnRequired', 'Smart search requires the AI Assistant add-on')
                  : state.error.message}
            </AlertDescription>
          </Alert>
        )}
        {state.failed > 0 && (
          <p className="mt-2 flex items-center gap-1 text-xs text-[rgb(var(--badge-warning-text))]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('smartSearch.failedCount', '{{count}} tickets could not be scored', { count: state.failed })}
          </p>
        )}
      </div>

      {BUCKET_ORDER.map((bucket) =>
        renderSection(bucket, bucket === 'strong' ? strongRows : bucket === 'possible' ? possibleRows : unlikelyRows)
      )}

      {unscoredWithIds.length > 0 && (
        <section {...withDataAutomationId({ id: `${id}-smart-search-unscored` })} className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-700))]">
              {t('smartSearch.unscored', 'Could not be scored')}
            </h3>
            <span className="chip-primary inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold">
              {unscoredWithIds.length}
            </span>
          </div>
          <DataTable
            {...withDataAutomationId({ id: `${id}-smart-search-unscored-table` })}
            data={unscoredWithIds}
            columns={columnsWithRelevance}
            pagination={false}
            pageSize={Math.max(unscoredWithIds.length, 1)}
            manualSorting={false}
            rowClassName={rowClassName as (record: RowWithScore) => string}
            onRowClick={onRowClick as (record: RowWithScore) => void}
          />
        </section>
      )}
    </div>
  );
}

export default SmartTicketSearchResults;
