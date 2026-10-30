'use client';

import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { MoreVertical } from 'lucide-react';
import {
  CUSTODY_QUEUE_TABS,
  type ColumnDefinition,
  type CustodyPurpose,
  type CustodyQueueTab,
  type ICustodyQueueFilters,
  type ICustodyQueueRow,
  type IClient,
} from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCalendarDate, getCurrentDateInUserTimeZone } from '@alga-psa/core';
import { listCustodyQueue } from '../../actions/assetCustodyActions';
import { getAllClientsForAssets } from '../../actions/clientLookupActions';
import { useAssetCrossFeature } from '../../context/AssetCrossFeatureContext';
import { formatCustodyPlace, isFollowUpOverdue } from '../../lib/custodyDisplay';
import { custodyOutcome, useCustodyLocations, useCustodyUsers } from './custodyClient';
import { usePartyLabels, usePurposeOptions } from './CustodyFields';
import { CustodyStepDialog, type CustodyDialogKind } from './CustodyDialogs';

const DEFAULT_PAGE_SIZE = 25;

/** "Equipment in custody": open custody episodes the user can read, with the dialogs for each step. */
export function CustodyQueue() {
  const { t } = useTranslation('msp/assets');
  const crossFeature = useAssetCrossFeature();
  const purposes = usePurposeOptions();
  const parties = usePartyLabels();
  const users = useCustodyUsers();
  const { locations, canUpdate } = useCustodyLocations();

  const [tab, setTab] = useState<CustodyQueueTab>('all_open');
  const [clientId, setClientId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const [holderId, setHolderId] = useState('');
  const [purpose, setPurpose] = useState<CustodyPurpose | ''>('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [action, setAction] = useState<{ kind: CustodyDialogKind; row: ICustodyQueueRow } | null>(null);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const { data: clients } = useSWR(['custody', 'queue', 'clients'], async () => {
    try {
      return (await getAllClientsForAssets(true)) as IClient[];
    } catch {
      return [] as IClient[];
    }
  });

  const filters = useMemo<ICustodyQueueFilters>(
    () => ({
      tab,
      client_id: clientId || undefined,
      location_id: locationId || undefined,
      holder_user_id: holderId || undefined,
      purpose: purpose || undefined,
      mine: mine || undefined,
      page,
      pageSize,
    }),
    [tab, clientId, locationId, holderId, purpose, mine, page, pageSize]
  );

  const { data, error, isLoading, mutate } = useSWR(['custody', 'queue', filters], async () => {
    const outcome = custodyOutcome<import('@alga-psa/types').ICustodyQueuePage>(await listCustodyQueue(filters));
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.data;
  });

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const today = getCurrentDateInUserTimeZone();
  const withVendor = t('custody.card.withVendor', { defaultValue: 'With vendor' });

  const openAsset = useCallback((row: ICustodyQueueRow) => {
    window.location.assign(`/msp/assets/${row.asset_id}`);
  }, []);

  const menuItems = useCallback(
    (row: ICustodyQueueRow): Array<{ kind: CustodyDialogKind; label: string }> => {
      const items: Array<{ kind: CustodyDialogKind; label: string }> = [];
      if (row.state === 'in_office') {
        items.push(
          { kind: 'move', label: t('custody.actions.move', { defaultValue: 'Move' }) },
          { kind: 'handOff', label: t('custody.actions.handOff', { defaultValue: 'Hand off' }) },
          { kind: 'ship', label: t('custody.actions.ship', { defaultValue: 'Ship to vendor' }) }
        );
      } else {
        items.push({ kind: 'receiveBack', label: t('custody.actions.receiveBack', { defaultValue: 'Receive back' }) });
      }
      items.push(
        { kind: 'edit', label: t('custody.actions.edit', { defaultValue: 'Edit details' }) },
        { kind: 'return', label: t('custody.actions.returnToClient', { defaultValue: 'Return to client' }) }
      );
      return items;
    },
    [t]
  );

  const columns: ColumnDefinition<ICustodyQueueRow>[] = useMemo(
    () => [
      {
        title: t('custody.queue.columns.asset', { defaultValue: 'Asset' }),
        dataIndex: 'asset_name',
        render: (_v: unknown, row: ICustodyQueueRow) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.asset_name ?? '-'}</div>
            {row.asset_tag ? <div className="truncate text-xs text-[rgb(var(--color-text-400))]">{row.asset_tag}</div> : null}
          </div>
        ),
      },
      { title: t('custody.queue.columns.client', { defaultValue: 'Client' }), dataIndex: 'client_name', render: (v: unknown) => (v as string) || '-' },
      {
        title: t('custody.queue.columns.location', { defaultValue: 'Location' }),
        dataIndex: 'location_name',
        render: (_v: unknown, row: ICustodyQueueRow) =>
          row.state === 'with_vendor' ? (
            withVendor
          ) : (
            <span className="whitespace-normal break-words" title={formatCustodyPlace(row.location_name, row.bin) || undefined}>
              {formatCustodyPlace(row.location_name, row.bin) || '-'}
            </span>
          ),
      },
      {
        title: t('custody.queue.columns.holder', { defaultValue: 'Holder' }),
        dataIndex: 'holder_name',
        render: (_v: unknown, row: ICustodyQueueRow) => (row.state === 'with_vendor' ? '-' : row.holder_name || '-'),
      },
      {
        title: t('custody.queue.columns.purpose', { defaultValue: 'Purpose' }),
        dataIndex: 'purpose',
        render: (v: unknown) => purposes.find((p) => p.value === v)?.label ?? String(v ?? ''),
      },
      {
        title: t('custody.queue.columns.nextAction', { defaultValue: 'Next action' }),
        dataIndex: 'next_action_party',
        render: (_v: unknown, row: ICustodyQueueRow) => (
          <div className="min-w-0">
            <div>{parties[row.next_action_party]}</div>
            {row.next_action_note ? <div className="truncate text-xs text-[rgb(var(--color-text-400))]">{row.next_action_note}</div> : null}
          </div>
        ),
      },
      {
        title: t('custody.queue.columns.followUp', { defaultValue: 'Follow up' }),
        dataIndex: 'follow_up_on',
        render: (_v: unknown, row: ICustodyQueueRow) =>
          row.follow_up_on ? (
            <span className={isFollowUpOverdue(row.follow_up_on, today) ? 'text-red-600 dark:text-red-400' : undefined}>
              {formatCalendarDate(row.follow_up_on, 'MMM d, yyyy')}
            </span>
          ) : (
            '-'
          ),
      },
      { title: t('custody.queue.columns.daysHeld', { defaultValue: 'Days held' }), dataIndex: 'days_held', render: (v: unknown) => String(v ?? 0) },
      {
        title: t('custody.queue.columns.ticket', { defaultValue: 'Ticket' }),
        dataIndex: 'ticket_number',
        render: (_v: unknown, row: ICustodyQueueRow) =>
          row.ticket_id ? (
            <button
              id={`custody-ticket-link-${row.custody_id}`}
              type="button"
              className="text-[rgb(var(--color-primary-600))] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                void crossFeature.openTicketDetailsDrawer({ ticketId: row.ticket_id! });
              }}
            >
              {row.ticket_number ?? t('custody.card.openTicket', { defaultValue: 'Open ticket' })}
            </button>
          ) : (
            '-'
          ),
      },
      ...(canUpdate
        ? [
            {
              title: t('custody.queue.columns.actions', { defaultValue: 'Actions' }),
              dataIndex: 'custody_id',
              sortable: false,
              width: '4%',
              render: (_v: unknown, row: ICustodyQueueRow) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id={`custody-actions-menu-${row.custody_id}`}
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="sr-only">{t('custody.queue.openMenu', { defaultValue: 'Open menu' })}</span>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {menuItems(row).map((item) => (
                      <DropdownMenuItem
                        key={item.kind}
                        id={`${item.kind}-custody-menu-item-${row.custody_id}`}
                        className={item.kind === 'return' ? 'text-red-600 focus:text-red-600' : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAction({ kind: item.kind, row });
                        }}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } as ColumnDefinition<ICustodyQueueRow>,
          ]
        : []),
    ],
    [t, withVendor, purposes, parties, today, crossFeature, canUpdate, menuItems]
  );

  const tabLabels: Record<CustodyQueueTab, string> = {
    all_open: t('custody.queue.tabs.all_open', { defaultValue: 'All open' }),
    in_office: t('custody.queue.tabs.in_office', { defaultValue: 'In office' }),
    waiting_on_vendor: t('custody.queue.tabs.waiting_on_vendor', { defaultValue: 'Waiting on vendor' }),
    waiting_on_client: t('custody.queue.tabs.waiting_on_client', { defaultValue: 'Waiting on client' }),
    overdue: t('custody.queue.tabs.overdue', { defaultValue: 'Overdue' }),
  };

  const tabs = CUSTODY_QUEUE_TABS.map((id) => ({
    id,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {tabLabels[id]}
        <span className="rounded-full bg-[rgb(var(--color-border-100))] px-1.5 text-xs">{data?.tabCounts?.[id] ?? 0}</span>
      </span>
    ),
    content: null,
  }));

  return (
    <div id="custody-queue" className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{t('custody.queue.title', { defaultValue: 'Equipment in custody' })}</h1>

      <CustomTabs
        idPrefix="custody-queue-tabs"
        tabs={tabs}
        value={tab}
        onTabChange={(v) => {
          setTab(v as CustodyQueueTab);
          setPage(1);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <ClientPicker
          id="custody-client-filter"
          clients={clients ?? []}
          selectedClientId={clientId}
          onSelect={(id) => {
            setClientId(id);
            setPage(1);
          }}
          filterState={clientFilterState}
          onFilterStateChange={setClientFilterState}
          clientTypeFilter={clientTypeFilter}
          onClientTypeFilterChange={setClientTypeFilter}
          placeholder={t('custody.queue.filters.client', { defaultValue: 'Client' })}
          fitContent
          triggerVariant="ghost"
          triggerSize="sm"
        />
        <CustomSelect
          id="custody-location-filter"
          value={locationId}
          onValueChange={resetPage(setLocationId)}
          options={[
            { value: '', label: t('custody.queue.filters.allLocations', { defaultValue: 'All locations' }) },
            ...locations.map((l) => ({ value: l.location_id, label: l.name })),
          ]}
          className="min-w-[160px]"
        />
        <UserPicker
          id="custody-holder-filter"
          users={users}
          value={holderId}
          onValueChange={resetPage(setHolderId)}
          placeholder={t('custody.queue.filters.holder', { defaultValue: 'Holder' })}
          size="sm"
        />
        <CustomSelect
          id="custody-purpose-filter"
          value={purpose}
          onValueChange={resetPage((v: string) => setPurpose(v as CustodyPurpose | ''))}
          options={[
            { value: '', label: t('custody.queue.filters.allPurposes', { defaultValue: 'All purposes' }) },
            ...purposes,
          ]}
          className="min-w-[160px]"
        />
        <Checkbox
          id="custody-mine-filter"
          label={t('custody.queue.filters.mine', { defaultValue: 'Mine' })}
          checked={mine}
          onChange={(e) => {
            setMine(e.target.checked);
            setPage(1);
          }}
        />
      </div>

      {error ? (
        <div id="custody-queue-error" role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error instanceof Error ? error.message : String(error)}
        </div>
      ) : null}

      <DataTable
        id="custody-queue-table"
        data={data?.rows ?? []}
        columns={columns}
        pagination
        currentPage={page}
        pageSize={pageSize}
        totalItems={data?.total ?? 0}
        onPageChange={setPage}
        onItemsPerPageChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRowClick={openAsset}
        manualSorting={false}
      />
      {isLoading ? null : (data?.rows?.length ?? 0) === 0 && !error ? (
        <p id="custody-queue-empty" className="text-sm text-[rgb(var(--color-text-400))]">
          {t('custody.queue.empty', { defaultValue: 'No equipment is in custody for this view.' })}
        </p>
      ) : null}

      {action ? (
        <CustodyStepDialog
          kind={action.kind}
          custody={action.row}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            void mutate();
          }}
        />
      ) : null}
    </div>
  );
}

export default CustodyQueue;
