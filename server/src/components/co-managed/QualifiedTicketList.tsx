'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import type { ColumnDefinition } from '@alga-psa/types';
import type { CoManagedTicketQueueItem, CoManagedTicketQueuePage, CoManagedTicketQueueRequest } from '@alga-psa/co-managed';
import {
  buildTicketListHref,
  isQualifiedHandbackEligible,
  switchTicketListView,
  ticketListDetailHref,
  ticketListIdentityFromQueueItem,
  ticketListIdentityKey,
  ticketListWorkspaceToken,
  type QualifiedTicketListScope,
  type TicketListPresentation,
  type TicketListWorkspace,
  type TicketQueueView,
} from '@alga-psa/tickets/lib';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ShareActionsMenu } from '@alga-psa/ui/components/ShareActionsMenu';
import {
  LIST_FILTER_DENSITY_PRESETS,
  ListCard,
  ListPageHeading,
  ListToolbarResetButton,
  ListToolbarRow,
  ListToolbarSearchInput,
  ListToolbarSurface,
  useDebouncedSearchField,
} from '@alga-psa/ui/components/ListToolbar';
import { useCapability } from '@alga-psa/ui/hooks';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { exportCoManagedTicketQueueAction, getCoManagedTicketQueueAction } from '@/lib/actions/coManagedTicketQueueActions';
import CoManagedTicketHandbackComposer, { type HandbackTarget } from './CoManagedTicketHandbackComposer';

export interface QualifiedTicketListProps {
  /** View and workspace, parsed from the URL by the route. */
  scope: QualifiedTicketListScope;
  /** Search, state, sort, page and page size, parsed from the same URL. */
  presentation: TicketListPresentation;
  idPrefix?: string;
}

/** More pages exist iff the rows up to and including this page do not cover the total. */
export function queueHasMore(result: Pick<CoManagedTicketQueuePage, 'page' | 'pageSize' | 'totalCount'>): boolean {
  return result.page * result.pageSize < result.totalCount;
}

const SORT_COLUMN: Record<TicketListPresentation['sort'], string> = {
  updated: 'updated_at', created: 'updated_at', title: 'title', number: 'ticket_number',
};

/** The request this list reads and exports: everything the URL says, nothing it does not. */
export function queueRequestFromUrlState(scope: QualifiedTicketListScope, presentation: TicketListPresentation): CoManagedTicketQueueRequest {
  return {
    view: scope.view,
    ...(typeof scope.workspace === 'object' ? { workspaceTenant: scope.workspace.tenant } : {}),
    ...(presentation.clientId ? { clientId: presentation.clientId } : {}),
    ...(presentation.searchQuery ? { search: presentation.searchQuery } : {}),
    ...(presentation.signal ? { signal: presentation.signal } : {}),
    state: presentation.state,
    sort: presentation.sort,
    direction: presentation.direction,
    page: presentation.page,
    pageSize: presentation.pageSize,
  };
}

/**
 * The Customer Tickets list (`/msp/tickets/customer`).
 *
 * All list state lives in the URL: the route parses it, this component derives its
 * request from props, and every filter/page/sort change is a `router.replace` to the
 * rebuilt href (the route re-renders with the new props). There is no local copy of
 * the filters and no accumulation of pages: each read is one page, and `hasMore` is
 * whether that page reaches the total.
 *
 * Selection (and with it the handback composer) exists only when a visible row can be
 * handed back, as decided server-side per row (`canHandBack`). A read-only viewer
 * gets a list with no checkboxes, no select-all and no composer.
 */
export default function QualifiedTicketList({ scope, presentation, idPrefix = 'customer-tickets' }: QualifiedTicketListProps) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const router = useRouter();
  // Handback is a write: the server decides per row (canHandBack), and the capability must also admit it.
  const { admitted } = useCapability('co-managed');
  const [result, setResult] = useState<CoManagedTicketQueuePage | null>(null);
  const [error, setError] = useState<'load' | 'export' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const generation = useRef(0);

  const request = useMemo(() => queueRequestFromUrlState(scope, presentation), [scope, presentation]);
  const requestKey = JSON.stringify(request);

  // DataTable fires onItemsPerPageChange and then onPageChange(1) in one tick, before the router has re-rendered us with the
  // new URL. Remember what we last asked for (keyed to the presentation it started from) so back-to-back changes stack.
  const pending = useRef<{ from: TicketListPresentation; value: TicketListPresentation } | null>(null);
  const hrefFor = useCallback((nextScope: QualifiedTicketListScope, next: Partial<TicketListPresentation>) =>
    buildTicketListHref(nextScope, { ...presentation, ...next }, { includeClient: true }), [presentation]);
  /** Apply a change to the URL. Anything but a page move starts again at page 1. */
  const apply = useCallback((next: Partial<TicketListPresentation>, nextScope: QualifiedTicketListScope = scope) => {
    const base = pending.current?.from === presentation ? pending.current.value : presentation;
    const value = { ...base, page: 1, ...next };
    pending.current = { from: presentation, value };
    router.replace(buildTicketListHref(nextScope, value, { includeClient: true }));
  }, [presentation, router, scope]);

  useEffect(() => {
    const current = ++generation.current;
    setResult(null);
    setError(null);
    setSelectedKeys([]);
    void getCoManagedTicketQueueAction(JSON.parse(requestKey) as CoManagedTicketQueueRequest)
      .then(page => { if (generation.current === current) setResult(page); })
      .catch(() => { if (generation.current === current) setError('load'); });
    return () => { generation.current += 1; };
  }, [requestKey, refresh]);

  // A page past the end (a stale link, or rows that left the queue) lands on the last page instead of an empty one.
  useEffect(() => {
    if (!result || result.items.length || result.totalCount === 0 || result.page <= 1) return;
    router.replace(hrefFor(scope, { page: Math.max(1, Math.ceil(result.totalCount / result.pageSize)) }));
  }, [hrefFor, result, router, scope]);

  const { draft: searchDraft, setDraft: setSearchDraft, flush: flushSearch } = useDebouncedSearchField(
    presentation.searchQuery,
    searchQuery => { if (searchQuery !== presentation.searchQuery) apply({ searchQuery }); },
  );
  const density = LIST_FILTER_DENSITY_PRESETS[0];

  const exportTickets = useCallback(async () => {
    if (exporting) return;
    const current = generation.current;
    const { page: _page, pageSize: _pageSize, ...filters } = request;
    setExporting(true);
    try {
      const exported = await exportCoManagedTicketQueueAction(filters);
      const url = URL.createObjectURL(new Blob([exported.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.id = `${idPrefix}-export-download`;
      link.href = url;
      link.download = exported.filename;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch {
      if (generation.current === current) setError('export');
    } finally {
      setExporting(false);
    }
  }, [exporting, idPrefix, request]);

  const returnTo = hrefFor(scope, {});
  const detailHref = useCallback((item: CoManagedTicketQueueItem) =>
    `${ticketListDetailHref(ticketListIdentityFromQueueItem(item))}?returnTo=${encodeURIComponent(returnTo)}`, [returnTo]);

  const items = result?.items ?? [];
  const unknown = t('coManaged.ticket.restricted', 'Restricted');
  const keyOf = (item: CoManagedTicketQueueItem) => ticketListIdentityKey(ticketListIdentityFromQueueItem(item));
  const eligible = useMemo(() => admitted ? items.filter(isQualifiedHandbackEligible) : [], [admitted, items]);
  const eligibleKeys = useMemo(() => new Set(eligible.map(keyOf)), [eligible]);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selected = eligible.filter(item => selectedSet.has(keyOf(item)));
  const allSelected = eligible.length > 0 && selected.length === eligible.length;
  const targets = useMemo<HandbackTarget[]>(() => selected.map(item => ({
    key: keyOf(item),
    label: `${item.workspaceName} · ${[item.fields.ticket_number, item.fields.title].filter(Boolean).join(' · ') || unknown}`,
    tenant: item.tenant,
    relationshipId: item.relationshipId as string,
    ticketId: item.ticketId,
    expectedRevision: item.fields.work_revision as number,
  })), [selected, unknown]);

  const columns = useMemo<ColumnDefinition<CoManagedTicketQueueItem>[]>(() => {
    const selection: ColumnDefinition<CoManagedTicketQueueItem> = {
      title: (
        <div className="flex items-center justify-center" onClick={event => event.stopPropagation()}>
          <Checkbox
            id={`${idPrefix}-select-all`}
            aria-label={t('coManaged.queue.bulkHandback.selectAll', 'Select all returnable tickets')}
            checked={allSelected}
            indeterminate={selected.length > 0 && !allSelected}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSelectedKeys(event.target.checked ? [...eligibleKeys] : [])}
            className="m-0"
            skipRegistration
          />
        </div>
      ),
      dataIndex: 'selection',
      width: '48px',
      sortable: false,
      render: (_value, record) => {
        const key = keyOf(record);
        if (!eligibleKeys.has(key)) return null;
        return (
          <div className="flex items-center justify-center" onClick={event => event.stopPropagation()}>
            <Checkbox
              id={`${idPrefix}-select-${key}`}
              aria-label={t('coManaged.queue.bulkHandback.selectRow', 'Select ticket')}
              checked={selectedSet.has(key)}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setSelectedKeys(previous => event.target.checked ? [...previous, key] : previous.filter(existing => existing !== key))}
              className="m-0"
              skipRegistration
            />
          </div>
        );
      },
    };
    return [
      // No row can be handed back => no selection column at all (a read-only viewer).
      ...(eligible.length ? [selection] : []),
      {
        title: t('coManaged.queue.columns.ticket', 'Ticket'),
        dataIndex: 'ticket_number',
        render: (_value, record) => (
          <Link
            href={detailHref(record)}
            prefetch={false}
            className="text-primary underline underline-offset-2"
            onClick={event => event.stopPropagation()}
          >
            {record.fields.ticket_number ?? unknown}
          </Link>
        ),
      },
      { title: t('coManaged.queue.columns.title', 'Title'), dataIndex: 'title', render: (_value, record) => record.fields.title ?? unknown },
      { title: t('coManaged.queue.columns.workspace', 'Customer'), dataIndex: 'workspace', sortable: false, render: (_value, record) => record.workspaceName },
      { title: t('coManaged.queue.columns.state', 'Status'), dataIndex: 'status_name', sortable: false, render: (_value, record) => record.fields.status_name ?? unknown },
      { title: t('coManaged.queue.columns.priority', 'Priority'), dataIndex: 'priority_name', sortable: false, render: (_value, record) => record.fields.priority_name ?? unknown },
      {
        title: t('coManaged.queue.columns.responsibility', 'Responsible organization'),
        dataIndex: 'responsibility',
        sortable: false,
        render: (_value, record) => (
          <div className="flex flex-col gap-0.5">
            <span>{record.fields.responsibility ? t(`coManaged.queue.organizations.${record.fields.responsibility}`) : unknown}</span>
            {record.fields.responsibility === 'customer' && record.fields.has_msp_assignment === true && (
              <Badge variant="secondary">{t('coManaged.queue.mspAlsoAssigned', 'MSP also assigned')}</Badge>
            )}
          </div>
        ),
      },
      {
        title: t('coManaged.queue.columns.updated', 'Updated'),
        dataIndex: 'updated_at',
        render: (_value, record) => record.fields.updated_at ? formatDate(new Date(record.fields.updated_at)) : unknown,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyOf is pure; items drive eligibility
  }, [allSelected, detailHref, eligible.length, eligibleKeys, formatDate, idPrefix, selected.length, selectedSet, t, unknown]);

  // Workspace options come from the admitted read's own answer, never a separate tenant list.
  // The selected one is kept even if it vanished, so the user sees an empty, resettable result.
  const workspaceOptions = useMemo(() => {
    const list = [{ value: 'all', label: t('coManaged.queue.allWorkspaces', 'All workspaces') }];
    const seen = new Set(['all']);
    for (const option of result?.workspaces ?? []) {
      const value = option.tenant.toLowerCase();
      if (seen.has(value)) continue;
      seen.add(value);
      list.push({ value, label: option.name });
    }
    const current = ticketListWorkspaceToken(scope.workspace);
    if (!seen.has(current)) list.push({ value: current, label: t('coManaged.queue.unavailableWorkspace', 'Unavailable workspace') });
    return list;
  }, [result?.workspaces, scope.workspace, t]);

  const isFiltered = scope.workspace !== 'all' || presentation.state !== 'open' || Boolean(presentation.searchQuery) || Boolean(presentation.signal) || Boolean(presentation.clientId);
  const reset = () => apply({ searchQuery: '', state: 'open', signal: undefined, clientId: undefined }, { ...scope, workspace: 'all' });
  const selectView = (view: TicketQueueView) => { if (view !== scope.view) apply({ signal: undefined }, switchTicketListView(scope, view)); };

  return (
    <div id={idPrefix} data-automation-id={idPrefix} className="p-6">
      <ListPageHeading
        title={t('coManaged.customerTickets.title', 'Customer Tickets')}
        subtitle={t(`coManaged.queue.${scope.view}Description`)}
        actions={(
          <ShareActionsMenu
            id={`${idPrefix}-share`}
            tooltip={t('coManaged.customerTickets.share', 'Share')}
            disabled={!result || exporting}
            actions={[{
              id: `${idPrefix}-export`,
              icon: Download,
              label: t(exporting ? 'coManaged.queue.exporting' : 'coManaged.queue.export', exporting ? 'Exporting…' : 'Export CSV'),
              onSelect: () => { void exportTickets(); },
              disabled: !result || exporting,
            }]}
          />
        )}
      />
      <div role="group" aria-label={t('coManaged.queue.view', 'View')} className="mb-4 inline-flex rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-0.5">
        {(['working', 'oversight'] as const).map(candidate => (
          <Button
            key={candidate}
            id={`${idPrefix}-view-${candidate}`}
            type="button"
            size="sm"
            variant={scope.view === candidate ? 'soft' : 'ghost'}
            aria-pressed={scope.view === candidate}
            onClick={() => selectView(candidate)}
          >
            {t(`coManaged.queue.${candidate}`, candidate === 'working' ? 'Working queue' : 'Customer oversight')}
          </Button>
        ))}
      </div>
      <ListCard>
        <ListToolbarSurface id={`${idPrefix}-toolbar`} density={density}>
          <ListToolbarRow>
            <ListToolbarSearchInput
              id={`${idPrefix}-search`}
              aria-label={t('coManaged.queue.search', 'Search tickets')}
              value={searchDraft}
              maxLength={200}
              placeholder={t('coManaged.queue.searchPlaceholder', 'Search by number or title')}
              onChange={event => setSearchDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); flushSearch(); } }}
            />
            <CustomSelect
              id={`${idPrefix}-workspace`}
              value={ticketListWorkspaceToken(scope.workspace)}
              options={workspaceOptions}
              placeholder={t('coManaged.queue.workspace', 'Workspace')}
              onValueChange={token => apply({}, { ...scope, workspace: (token === 'all' ? 'all' : { tenant: token }) as TicketListWorkspace })}
            />
            <CustomSelect
              id={`${idPrefix}-state`}
              value={presentation.state}
              options={(['open', 'closed', 'all'] as const).map(value => ({ value, label: t(`coManaged.queue.${value}`) }))}
              placeholder={t('coManaged.queue.state', 'Status')}
              onValueChange={value => apply({ state: value as TicketListPresentation['state'] })}
            />
            <ListToolbarResetButton id={`${idPrefix}-reset`} active={isFiltered} label={t('coManaged.queue.reset', 'Reset')} onClick={reset} />
          </ListToolbarRow>
        </ListToolbarSurface>
        <div className={density.filterPadding}>
          {error ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-destructive">
              <span>{t(error === 'export' ? 'coManaged.queue.exportError' : 'coManaged.queue.loadError')}</span>
              <Button id={`${idPrefix}-retry`} type="button" variant="outline" size="sm" onClick={() => { setError(null); setRefresh(value => value + 1); }}>
                {t('coManaged.queue.retry', 'Retry')}
              </Button>
            </div>
          ) : !result ? (
            <p role="status">{t('coManaged.ticket.loading', 'Loading tickets…')}</p>
          ) : (
            <>
              <p role="status" className="text-sm text-[rgb(var(--color-text-500))]">
                {t('coManaged.queue.counts', { count: result.totalCount, open: result.openCount, closed: result.closedCount })}
              </p>
              {targets.length > 0 && (
                <div className="mt-3">
                  <CoManagedTicketHandbackComposer
                    idPrefix={`${idPrefix}-handback`}
                    targets={targets}
                    onDone={() => setRefresh(value => value + 1)}
                  />
                </div>
              )}
              {!result.items.length ? (
                <p className="mt-4">{isFiltered
                  ? t('coManaged.queue.empty', 'No permitted tickets match these filters.')
                  : t('coManaged.queue.emptyUnfiltered', 'No customer tickets to show yet.')}</p>
              ) : (
                <div className="mt-3">
                  <DataTable
                    id={`${idPrefix}-table`}
                    data={result.items}
                    columns={columns}
                   
                    pagination={true}
                    currentPage={result.page}
                    onPageChange={page => apply({ page })}
                    pageSize={result.pageSize}
                    totalItems={result.totalCount}
                    onItemsPerPageChange={pageSize => apply({ pageSize })}
                    manualSorting={true}
                    sortBy={SORT_COLUMN[presentation.sort]}
                    sortDirection={presentation.direction}
                    onSortChange={(columnId, direction) => apply({
                      sort: columnId === 'title' ? 'title' : columnId === 'ticket_number' ? 'number' : 'updated',
                      direction,
                    })}
                    onRowClick={record => router.push(detailHref(record))}
                    rowClassName={() => 'cursor-pointer'}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </ListCard>
    </div>
  );
}
