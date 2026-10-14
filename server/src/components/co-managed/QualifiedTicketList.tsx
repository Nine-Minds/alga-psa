'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDefinition } from '@alga-psa/types';
import type {
  CoManagedTicketQueueItem,
  CoManagedTicketQueuePage,
  CoManagedTicketQueueRequest,
} from '@alga-psa/co-managed';
import {
  buildTicketListHref,
  isQualifiedHandbackEligible,
  switchTicketListView,
  ticketListWorkspaceToken,
  type TicketQueueView,
  type TicketListWorkspace,
  ticketListIdentityFromQueueItem,
  ticketListIdentityKey,
  ticketListDetailHref,
  type QualifiedTicketListScope,
  type TicketListIdentity,
  type TicketListPresentation,
} from '@alga-psa/tickets/lib';
import { Download, Filter, XCircle } from 'lucide-react';
import { ShareActionsMenu } from '@alga-psa/ui/components/ShareActionsMenu';
import { getAllClients } from '@alga-psa/clients/actions';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedTicketQueueAction, exportCoManagedTicketQueueAction } from '@/lib/actions/coManagedTicketQueueActions';
import CoManagedTicketListViewMenu, {
  DEFAULT_QUALIFIED_TICKET_LIST_VIEW,
  qualifiedDensityRowClass,
  type QualifiedTicketListView,
} from './CoManagedTicketListViewMenu';
import CoManagedTicketHandbackComposer from './CoManagedTicketHandbackComposer';

export interface QualifiedTicketListProps {
  scope: QualifiedTicketListScope;
  initialPresentation?: Partial<TicketListPresentation>;
  /** Fixed authorized client (client-drawer context): cannot be cleared here. */
  fixedClientId?: string;
  embedded?: boolean;
  idPrefix?: string;
  actorScope: string;
}

const DEFAULT_PRESENTATION: TicketListPresentation = {
  searchQuery: '',
  page: 1,
  pageSize: 10,
  state: 'open',
  sort: 'updated',
  direction: 'desc',
};

/**
 * The one qualified co-managed ticket list: the body of the Customer Tickets
 * page (`/msp/tickets/customer`) and the shared-only list embedded in a client's
 * co-managed section.
 *
 * It owns the qualified read lifecycle (applied filters, request generations,
 * stale-response rejection, export lifetime), the handback selection and
 * composer, and the toolbar (search, collapsible Filters, View, Share). Native
 * controls (boards, bundles, tag editors, Add Ticket) are deliberately absent:
 * a qualified row cannot satisfy those loaders, and creating a ticket belongs
 * to All Tickets.
 */
export default function QualifiedTicketList({
  scope,
  initialPresentation,
  fixedClientId,
  embedded = false,
  idPrefix = 'co-managed-ticket-list',
  actorScope,
}: QualifiedTicketListProps) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const router = useRouter();

  const [presentation, setPresentation] = useState<TicketListPresentation>(() => ({
    ...DEFAULT_PRESENTATION,
    ...initialPresentation,
    ...(fixedClientId ? { clientId: fixedClientId } : {}),
  }));
  const [workspace, setWorkspace] = useState<TicketListWorkspace>(scope.workspace);
  const [showFilters, setShowFilters] = useState(() => Boolean(initialPresentation?.signal));
  const [clientOptions, setClientOptions] = useState<Array<{ client_id: string; client_name: string }> | null>(null);
  const [view, setView] = useViewPreference(actorScope);
  const [searchDraft, setSearchDraft] = useState(() => presentation.searchQuery);
  const [result, setResult] = useState<CoManagedTicketQueuePage | null>(null);
  const [error, setError] = useState<'load' | 'export' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const generation = useRef(0);

  // Keep the search box in step with a scope/history-driven presentation change.
  useEffect(() => { setSearchDraft(presentation.searchQuery); }, [presentation.searchQuery]);

  const clientId = fixedClientId ?? presentation.clientId;

  const request = useMemo<CoManagedTicketQueueRequest>(() => ({
    view: scope.view,
    ...(typeof workspace === 'object' ? { workspaceTenant: workspace.tenant } : {}),
    ...(clientId ? { clientId } : {}),
    ...(presentation.searchQuery ? { search: presentation.searchQuery } : {}),
    ...(presentation.signal ? { signal: presentation.signal } : {}),
    state: presentation.state,
    sort: presentation.sort,
    direction: presentation.direction,
    page: presentation.page,
    pageSize: presentation.pageSize,
  }), [scope.view, workspace, clientId, presentation]);

  useEffect(() => {
    // LEVERAGE: pattern qualified-queue-request-lifetime — every applied filter,
    // page and scope change invalidates the previous read; stale rows/counts
    // must never land on a scope the user has already left.
    const current = ++generation.current;
    setResult(null);
    setError(null);
    setExporting(false);
    setSelectedKeys([]);
    void getCoManagedTicketQueueAction(request)
      .then(page => { if (generation.current === current) setResult(page); })
      .catch(() => { if (generation.current === current) setError('load'); });
    return () => { generation.current += 1; };
  }, [request, refresh]);

  const updatePresentation = useCallback((patch: Partial<TicketListPresentation>, options: { replaceHistory?: boolean } = {}) => {
    setPresentation(current => {
      const next = { ...current, ...patch, page: patch.page ?? 1 };
      if (!embedded && options.replaceHistory !== false && typeof window !== 'undefined') {
        // Local filter changes replace the current history entry so refining a
        // view does not bury the previous page. Explicit view/workspace moves
        // are navigations handled by the scope bar.
        window.history.replaceState(null, '', buildTicketListHref({ ...scope, workspace }, next, { includeClient: Boolean(next.clientId) }));
      }
      return next;
    });
  }, [embedded, scope, workspace]);

  const exportTickets = useCallback(async () => {
    if (exporting) return;
    const current = generation.current;
    const { page: _page, pageSize: _pageSize, ...filters } = request;
    setExporting(true);
    try {
      const exported = await exportCoManagedTicketQueueAction(filters);
      if (generation.current !== current) return;
      const url = URL.createObjectURL(new Blob([exported.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.id = `${idPrefix}-export-download`;
      link.href = url;
      link.download = exported.filename;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch {
      // The export action cannot distinguish transport from permission failure.
      // Retaining protected rows would be unsafe, so stale contents are dropped
      // (matching the existing qualified queue contract).
      if (generation.current === current) { setResult(null); setError('export'); }
    } finally {
      if (generation.current === current) setExporting(false);
    }
  }, [exporting, idPrefix, request]);

  const openIdentity = useCallback((identity: TicketListIdentity) => {
    const href = ticketListDetailHref(identity);
    router.push(href);
  }, [router]);

  const items = result?.items ?? [];
  const unknown = t('coManaged.ticket.restricted', 'Restricted');
  const eligibleKeys = useMemo(
    () => new Set(items.filter(isQualifiedHandbackEligible).map(item => ticketListIdentityKey(ticketListIdentityFromQueueItem(item)))),
    [items],
  );
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const eligibleSelected = useMemo(
    () => items.filter(item => eligibleKeys.has(ticketListIdentityKey(ticketListIdentityFromQueueItem(item))) && selectedSet.has(ticketListIdentityKey(ticketListIdentityFromQueueItem(item)))),
    [eligibleKeys, items, selectedSet],
  );
  const allEligibleSelected = eligibleKeys.size > 0 && Array.from(eligibleKeys).every(key => selectedSet.has(key));

  const selectionColumn = useMemo<ColumnDefinition<CoManagedTicketQueueItem>>(() => ({
    title: (
      <div className="flex items-center justify-center" onClick={event => event.stopPropagation()}>
        <Checkbox
          id={`${idPrefix}-select-all`}
          checked={allEligibleSelected}
          indeterminate={eligibleSelected.length > 0 && !allEligibleSelected}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            event.stopPropagation();
            setSelectedKeys(event.target.checked ? Array.from(eligibleKeys) : []);
          }}
          className="m-0"
          skipRegistration
        />
      </div>
    ),
    dataIndex: 'selection',
    width: '48px',
    sortable: false,
    render: (_value: unknown, record: CoManagedTicketQueueItem) => {
      const identity = ticketListIdentityFromQueueItem(record);
      const key = ticketListIdentityKey(identity);
      if (!eligibleKeys.has(key)) return null;
      return (
        <div className="flex items-center justify-center" onClick={event => event.stopPropagation()}>
          <Checkbox
            id={`${idPrefix}-select-${key}`}
            checked={selectedSet.has(key)}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              event.stopPropagation();
              setSelectedKeys(previous => event.target.checked ? [...previous, key] : previous.filter(existing => existing !== key));
            }}
            className="m-0"
            skipRegistration
          />
        </div>
      );
    },
  }), [allEligibleSelected, eligibleKeys, eligibleSelected.length, idPrefix, selectedSet]);

  const columns = useMemo<ColumnDefinition<CoManagedTicketQueueItem>[]>(() => {
    const ticketColumn: ColumnDefinition<CoManagedTicketQueueItem> = {
      title: t('coManaged.queue.columns.ticket', 'Ticket'),
      dataIndex: 'title',
      render: (_value, record) => {
        const identity = ticketListIdentityFromQueueItem(record);
        const label = [record.fields.ticket_number, record.fields.title].filter(Boolean).join(' · ') || unknown;
        return (
          <div className="min-w-0">
            <Link
              href={ticketListDetailHref(identity)}
              prefetch={false}
              className="text-primary underline underline-offset-2"
              onClick={event => {
                if (event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                event.stopPropagation();
                openIdentity(identity);
              }}
            >
              {label}
            </Link>
            {view.columns.workspace && <div className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">{record.workspaceName}</div>}
          </div>
        );
      },
    };
    const statusColumn: ColumnDefinition<CoManagedTicketQueueItem> = {
      title: t('coManaged.queue.columns.state', 'Status'),
      dataIndex: 'status_name',
      sortable: false,
      render: (_value, record) => record.fields.status_name ?? unknown,
    };
    const priorityColumn: ColumnDefinition<CoManagedTicketQueueItem> = {
      title: t('coManaged.queue.columns.priority', 'Priority'),
      dataIndex: 'priority_name',
      sortable: false,
      render: (_value, record) => record.fields.priority_name ?? unknown,
    };
    const responsibilityColumn: ColumnDefinition<CoManagedTicketQueueItem> = {
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
    };
    const updatedColumn: ColumnDefinition<CoManagedTicketQueueItem> = {
      title: t('coManaged.queue.columns.updated', 'Updated'),
      dataIndex: 'updated_at',
      render: (_value, record) => record.fields.updated_at ? formatDate(new Date(record.fields.updated_at)) : unknown,
    };
    const hasEligible = eligibleKeys.size > 0;
    return [
      ...(hasEligible ? [selectionColumn] : []),
      ticketColumn,
      ...(view.columns.status ? [statusColumn] : []),
      ...(view.columns.priority ? [priorityColumn] : []),
      ...(view.columns.responsibility ? [responsibilityColumn] : []),
      ...(view.columns.updated ? [updatedColumn] : []),
    ];
  }, [eligibleKeys.size, formatDate, openIdentity, selectionColumn, t, unknown, view.columns]);

  // Workspace options come from the authorized reader's own result (never a
  // foreign directory); the selected one is kept even if it later disappears so
  // the user sees an empty, resettable result instead of a silent widening.
  const workspaceOptions = useMemo(() => {
    const list = [{ value: 'all', label: t('coManaged.queue.allWorkspaces', 'All workspaces') }];
    const seen = new Set(['all']);
    for (const option of result?.workspaces ?? []) {
      const value = option.tenant.toLowerCase();
      if (seen.has(value)) continue;
      seen.add(value);
      list.push({ value, label: option.name });
    }
    const selected = ticketListWorkspaceToken(workspace);
    if (!seen.has(selected)) list.push({ value: selected, label: selected });
    return list;
  }, [result?.workspaces, t, workspace]);

  // The client chooser is loaded the first time Filters opens: it is the
  // sponsor's own client list, narrowed again by the reader's authorization.
  useEffect(() => {
    if (!showFilters || fixedClientId || clientOptions) return;
    let cancelled = false;
    void getAllClients(false)
      .then(clients => { if (!cancelled) setClientOptions(Array.isArray(clients) ? clients.map(({ client_id, client_name }) => ({ client_id, client_name })) : []); })
      .catch(() => { if (!cancelled) setClientOptions([]); });
    return () => { cancelled = true; };
  }, [clientOptions, fixedClientId, showFilters]);

  const activeFilterCount = (workspace !== 'all' ? 1 : 0) + (!fixedClientId && presentation.clientId ? 1 : 0)
    + (presentation.state !== 'open' ? 1 : 0) + (presentation.signal ? 1 : 0);
  const isFiltered = activeFilterCount > 0 || Boolean(presentation.searchQuery);

  const resetFilters = () => {
    setWorkspace('all');
    updatePresentation({ searchQuery: '', state: 'open', signal: undefined, ...(fixedClientId ? {} : { clientId: undefined }), pageSize: presentation.pageSize });
  };

  const selectView = (nextView: TicketQueueView) => {
    if (nextView === scope.view) return;
    router.push(buildTicketListHref(switchTicketListView({ ...scope, workspace }, nextView), { ...presentation, signal: undefined, page: 1 }, { includeClient: Boolean(clientId) }));
  };

  const signalLabel = presentation.signal
    ? t(presentation.signal === 'escalated_unassigned' ? 'coManaged.customerTickets.signals.escalatedUnassigned' : 'coManaged.customerTickets.signals.awaitingReply')
    : null;

  // LEVERAGE: pattern list-toolbar-filters-toggle — search + Filters toggle + Reset repeats the native dashboard toolbar markup; a shared presentational toolbar below TicketingDashboard would serve both lists.
  const toolbar = (
    <div id={`${idPrefix}-toolbar`} className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-[260px] flex-1 items-center gap-2"
          onSubmit={event => { event.preventDefault(); updatePresentation({ searchQuery: searchDraft }); }}
        >
          <Input
            id={`${idPrefix}-search`}
            aria-label={t('coManaged.queue.search', 'Search tickets')}
            value={searchDraft}
            maxLength={200}
            placeholder={t('coManaged.queue.searchPlaceholder', 'Search by number or title')}
            onChange={event => setSearchDraft(event.target.value)}
            className="h-[38px] w-full text-sm"
          />
          <Button id={`${idPrefix}-search-submit`} type="submit" variant="outline" className="shrink-0 h-[38px]">{t('coManaged.queue.search', 'Search tickets')}</Button>
        </form>
        <Button
          id={`${idPrefix}-toggle-filters`}
          type="button"
          variant={showFilters ? 'soft' : 'outline'}
          aria-expanded={showFilters}
          onClick={() => setShowFilters(value => !value)}
          className="shrink-0 flex items-center gap-1.5 h-[38px]"
        >
          <Filter className="h-4 w-4" />
          {t('coManaged.customerTickets.filters', 'Filters')}
          {activeFilterCount > 0 && (
            <span className="chip-primary ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold">{activeFilterCount}</span>
          )}
        </Button>
        <Button
          id={`${idPrefix}-reset`}
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetFilters}
          className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
          disabled={!isFiltered}
        >
          <XCircle className="h-4 w-4" />
          {t('resetFilters', 'Reset')}
        </Button>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <CoManagedTicketListViewMenu id={`${idPrefix}-view-menu`} view={view} onChange={setView} />
          <ShareActionsMenu
            id={`${idPrefix}-share`}
            tooltip={t('coManaged.customerTickets.share', 'Share')}
            disabled={!result || exporting}
            actions={[{
              id: `${idPrefix}-export`,
              icon: Download,
              label: t(exporting ? 'coManaged.queue.exporting' : 'coManaged.queue.export'),
              onSelect: () => { void exportTickets(); },
              disabled: !result || exporting,
            }]}
          />
        </div>
      </div>
      {signalLabel && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip-primary inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--color-primary-100))] py-1 pl-2.5 pr-1.5 text-xs font-medium">
            <span>{signalLabel}</span>
            <button
              type="button"
              id={`${idPrefix}-clear-signal`}
              aria-label={t('coManaged.customerTickets.clearSignal', 'Remove filter')}
              onClick={() => updatePresentation({ signal: undefined })}
              className="chip-primary inline-flex h-4 w-4 items-center justify-center rounded-full"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 border-t border-[rgb(var(--color-border-200))] pt-3">
          <div className="min-w-[220px]">
            <CustomSelect
              id={`${idPrefix}-workspace`}
              label={t('coManaged.queue.workspace', 'Workspace')}
              value={ticketListWorkspaceToken(workspace)}
              options={workspaceOptions}
              onValueChange={token => { setWorkspace(token === 'all' ? 'all' : { tenant: token }); updatePresentation({}); }}
            />
          </div>
          {!fixedClientId && (
            <div className="min-w-[220px]">
              <CustomSelect
                id={`${idPrefix}-client`}
                label={t('coManaged.customerTickets.client', 'Client')}
                value={presentation.clientId ?? 'all'}
                options={[
                  { value: 'all', label: t('coManaged.customerTickets.allClients', 'All clients') },
                  ...(clientOptions ?? []).map(client => ({ value: client.client_id, label: client.client_name })),
                  ...(presentation.clientId && !(clientOptions ?? []).some(client => client.client_id === presentation.clientId)
                    ? [{ value: presentation.clientId, label: presentation.clientId }] : []),
                ]}
                onValueChange={value => updatePresentation({ clientId: value === 'all' ? undefined : value })}
              />
            </div>
          )}
          <div className="min-w-[180px]">
            <CustomSelect
              id={`${idPrefix}-state`}
              label={t('coManaged.queue.state', 'Status')}
              value={presentation.state}
              options={(['open', 'closed', 'all'] as const).map(value => ({ value, label: t(`coManaged.queue.${value}`) }))}
              onValueChange={value => updatePresentation({ state: value as TicketListPresentation['state'] })}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div id={idPrefix} data-automation-id={idPrefix} className={embedded ? undefined : 'p-6'}>
      {!embedded && (
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{t('coManaged.customerTickets.title', 'Customer Tickets')}</h1>
          <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">{t(`coManaged.queue.${scope.view}Description`)}</p>
          <div
            role="group"
            aria-label={t('coManaged.queue.view', 'View')}
            className="mt-4 inline-flex rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-0.5"
          >
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
        </div>
      )}
      {toolbar}
      {error ? (
        <p role="alert" className="mt-4 text-destructive">
          {t(error === 'export' ? 'coManaged.queue.exportError' : 'coManaged.queue.loadError')}
        </p>
      ) : !result ? (
        <p role="status" className="mt-4">{t('coManaged.ticket.loading', 'Loading tickets…')}</p>
      ) : (
        <>
          <p role="status" className="mt-4 text-sm text-[rgb(var(--color-text-500))]">
            {t('coManaged.queue.counts', { total: result.totalCount, open: result.openCount, closed: result.closedCount })}
          </p>
          <div className="mt-3">
            <CoManagedTicketHandbackComposer
              idPrefix={idPrefix}
              actorScope={actorScope}
              selectedItems={eligibleSelected}
              onDone={() => setRefresh(value => value + 1)}
            />
          </div>
          {!result.items.length ? (
            <p className="mt-4">{t('coManaged.queue.empty', 'No permitted tickets match these filters.')}</p>
          ) : (
            <div className="mt-3">
              <DataTable
                id={`${idPrefix}-table`}
                data={result.items}
                columns={columns}
                columnFitMode="scroll"
                pagination={true}
                currentPage={result.page}
                onPageChange={page => updatePresentation({ page }, { replaceHistory: true })}
                pageSize={result.pageSize}
                totalItems={result.totalCount}
                onItemsPerPageChange={pageSize => updatePresentation({ pageSize, page: 1 }, { replaceHistory: true })}
                manualSorting={true}
                sortBy={presentation.sort === 'updated' ? 'updated_at' : presentation.sort === 'title' ? 'title' : presentation.sort}
                sortDirection={presentation.direction}
                onSortChange={(columnId, direction) => updatePresentation({
                  sort: columnId === 'updated_at' ? 'updated' : 'title',
                  direction,
                }, { replaceHistory: true })}
                onRowClick={record => openIdentity(ticketListIdentityFromQueueItem(record))}
                rowClassName={() => `cursor-pointer ${qualifiedDensityRowClass(view.density)}`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const VIEW_STORAGE_PREFIX = 'alga.coManaged.customerTickets.view:';

/**
 * Browser-local arrangement for this list (supported columns + density). It is
 * keyed by viewer and never touches the native saved View defaults.
 */
function useViewPreference(actorScope: string): [QualifiedTicketListView, (view: QualifiedTicketListView) => void] {
  const [view, setViewState] = useState<QualifiedTicketListView>(DEFAULT_QUALIFIED_TICKET_LIST_VIEW);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`${VIEW_STORAGE_PREFIX}${actorScope}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<QualifiedTicketListView>;
      setViewState({
        columns: { ...DEFAULT_QUALIFIED_TICKET_LIST_VIEW.columns, ...(parsed.columns ?? {}) },
        density: typeof parsed.density === 'number' ? Math.min(100, Math.max(0, parsed.density)) : DEFAULT_QUALIFIED_TICKET_LIST_VIEW.density,
      });
    } catch { /* storage unavailable or corrupt: keep the defaults */ }
  }, [actorScope]);
  const setView = useCallback((next: QualifiedTicketListView) => {
    setViewState(next);
    try { window.localStorage.setItem(`${VIEW_STORAGE_PREFIX}${actorScope}`, JSON.stringify(next)); } catch { /* not persisted */ }
  }, [actorScope]);
  return [view, setView];
}
