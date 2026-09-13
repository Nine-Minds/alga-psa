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
  ticketListIdentityFromQueueItem,
  ticketListIdentityKey,
  ticketListDetailHref,
  type QualifiedTicketListScope,
  type TicketListIdentity,
  type TicketListPresentation,
} from '@alga-psa/tickets/lib';
import { TicketListShell } from '@alga-psa/tickets/components';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';
import { getCoManagedTicketQueueAction, exportCoManagedTicketQueueAction } from '@/lib/actions/coManagedTicketQueueActions';
import TicketListScopeBar from '@/components/tickets/TicketListScopeBar';
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
 * The qualified co-managed list body, shared by the global `/msp/tickets`
 * destination and the client-record embedded slot.
 *
 * It owns the qualified read lifecycle (applied filters, request generations,
 * stale-response rejection, export lifetime) and delegates presentation to the
 * shared `TicketListShell`. Native-only controls (boards, bundles, tag editors,
 * assignee metadata) are deliberately absent: a qualified row cannot satisfy
 * those loaders.
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
    ...(typeof scope.workspace === 'object' ? { workspaceTenant: scope.workspace.tenant } : {}),
    ...(clientId ? { clientId } : {}),
    ...(presentation.searchQuery ? { search: presentation.searchQuery } : {}),
    state: presentation.state,
    sort: presentation.sort,
    direction: presentation.direction,
    page: presentation.page,
    pageSize: presentation.pageSize,
  }), [scope, clientId, presentation]);

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
        window.history.replaceState(null, '', buildTicketListHref(scope, next, { includeClient: Boolean(next.clientId) }));
      }
      return next;
    });
  }, [embedded, scope]);

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
            <div className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">{record.workspaceName}</div>
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
    return [...(hasEligible ? [selectionColumn] : []), ticketColumn, statusColumn, priorityColumn, responsibilityColumn, updatedColumn];
  }, [eligibleKeys.size, formatDate, openIdentity, selectionColumn, t, unknown]);

  const toolbar = (
    <div className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex min-w-[260px] flex-1 items-end gap-2"
          onSubmit={event => { event.preventDefault(); updatePresentation({ searchQuery: searchDraft }); }}
        >
          <div className="flex-1">
            <Label htmlFor={`${idPrefix}-search`}>{t('coManaged.queue.search', 'Search tickets')}</Label>
            <Input
              id={`${idPrefix}-search`}
              value={searchDraft}
              maxLength={200}
              placeholder={t('coManaged.queue.searchPlaceholder', 'Search by number or title')}
              onChange={event => setSearchDraft(event.target.value)}
            />
          </div>
          <Button id={`${idPrefix}-search-submit`} type="submit">{t('coManaged.queue.search', 'Search tickets')}</Button>
        </form>
        <CustomSelect
          id={`${idPrefix}-state`}
          label={t('coManaged.queue.state', 'Status')}
          value={presentation.state}
          options={(['open', 'closed', 'all'] as const).map(value => ({ value, label: t(`coManaged.queue.${value}`) }))}
          onValueChange={value => updatePresentation({ state: value as TicketListPresentation['state'] })}
        />
        <CustomSelect
          id={`${idPrefix}-sort`}
          label={t('coManaged.queue.sort', 'Sort by')}
          value={presentation.sort}
          options={(['updated', 'created', 'title', 'number'] as const).map(value => ({ value, label: t(`coManaged.queue.sortFields.${value}`) }))}
          onValueChange={value => updatePresentation({ sort: value as TicketListPresentation['sort'] })}
        />
        <CustomSelect
          id={`${idPrefix}-direction`}
          label={t('coManaged.queue.direction', 'Order')}
          value={presentation.direction}
          options={(['asc', 'desc'] as const).map(value => ({ value, label: t(`coManaged.queue.${value}`) }))}
          onValueChange={value => updatePresentation({ direction: value as TicketListPresentation['direction'] })}
        />
        <Button
          id={`${idPrefix}-reset`}
          type="button"
          variant="ghost"
          onClick={() => updatePresentation({ searchQuery: '', state: 'open', sort: 'updated', direction: 'desc', page: 1, pageSize: presentation.pageSize })}
        >
          {t('resetFilters', 'Reset')}
        </Button>
      </div>
    </div>
  );

  const actions = (
    <>
      <Button id={`${idPrefix}-export`} variant="outline" disabled={!result || exporting} onClick={() => void exportTickets()}>
        {t(exporting ? 'coManaged.queue.exporting' : 'coManaged.queue.export')}
      </Button>
      <Button
        id={`${idPrefix}-add-msp-ticket`}
        onClick={() => router.push(buildCreateTicketHref(clientId ? { client: { id: clientId, name: '' } } : {}))}
      >
        {t('coManaged.queue.addMspTicket', 'Add MSP ticket')}
      </Button>
    </>
  );

  return (
    <TicketListShell
      id={idPrefix}
      title={embedded ? undefined : t('dashboard.title', 'Ticketing Dashboard')}
      subtitle={embedded ? undefined : t(`coManaged.queue.${scope.view}Description`)}
      embedded={embedded}
      actions={actions}
      scope={(
        <TicketListScopeBar
          scope={scope}
          clientId={clientId}
          presentation={presentation}
          fixedClient={Boolean(fixedClientId)}
          workspaceOptions={result?.workspaces}
          idPrefix={`${idPrefix}-scope`}
        />
      )}
      toolbar={toolbar}
    >
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
                rowClassName={() => 'cursor-pointer'}
              />
            </div>
          )}
        </>
      )}
    </TicketListShell>
  );
}
