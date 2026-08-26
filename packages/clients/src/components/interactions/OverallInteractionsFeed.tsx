'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDefinition, IClient, IContact, IInteraction, IInteractionType } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import { Filter, XCircle } from 'lucide-react';
import {
  getAllInteractionTypes,
  getInteractionStatuses,
  getInteractionsPage,
} from '@alga-psa/clients/actions';
import { useDrawer } from '@alga-psa/ui';
import { Button } from '@alga-psa/ui/components/Button';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { Input } from '@alga-psa/ui/components/Input';
import InteractionIcon from '@alga-psa/ui/components/InteractionIcon';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import InteractionDetails from './InteractionDetails';
import QuickAddContact from '../contacts/QuickAddContact';

interface OverallInteractionsFeedProps {
  users: IUser[];
  contacts: IContact[];
  clients: IClient[];
}

type InteractionTableRow = IInteraction & { id: string };

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

export default function OverallInteractionsFeed({
  users,
  contacts,
  clients,
}: OverallInteractionsFeedProps) {
  const { t } = useTranslation('msp/clients');
  const { openDrawer } = useDrawer();
  const latestRequestRef = useRef(0);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [statuses, setStatuses] = useState<Array<{ status_id: string; name: string }>>([]);
  const [selectedUser, setSelectedUser] = useState('all');
  const [selectedContact, setSelectedContact] = useState('all');
  const [selectedClient, setSelectedClient] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [startTime, setStartTime] = useState<Date | undefined>();
  const [endTime, setEndTime] = useState<Date | undefined>();
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [allContacts, setAllContacts] = useState(contacts);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);

  useEffect(() => {
    setAllContacts(contacts);
  }, [contacts]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    void Promise.all([getAllInteractionTypes(), getInteractionStatuses()])
      .then(([typesResult, statusesResult]) => {
        if (!isReturnedActionError(typesResult)) {
          setInteractionTypes([...typesResult].sort((a, b) => a.type_name.localeCompare(b.type_name)));
        }
        if (!isReturnedActionError(statusesResult)) {
          setStatuses(statusesResult);
        }
      })
      .catch((error) => console.error('Error loading interaction filter options:', error));
  }, []);

  useEffect(() => {
    const requestId = ++latestRequestRef.current;
    setIsLoading(true);
    setLoadError(null);

    void getInteractionsPage({
      search: debouncedSearch || undefined,
      userId: selectedUser === 'all' ? undefined : selectedUser,
      contactId: selectedContact === 'all' ? undefined : selectedContact,
      clientId: selectedClient === 'all' ? undefined : selectedClient,
      statusId: selectedStatus === 'all' ? undefined : selectedStatus,
      typeId: selectedType === 'all' ? undefined : selectedType,
      dateFrom: startTime,
      dateTo: endTime,
      page: currentPage,
      pageSize,
    })
      .then((result) => {
        if (requestId !== latestRequestRef.current) return;
        if (isReturnedActionError(result)) {
          setInteractions([]);
          setTotal(0);
          setLoadError(getErrorMessage(result));
          return;
        }
        setInteractions(result.interactions);
        setTotal(result.total);
      })
      .catch((error) => {
        if (requestId !== latestRequestRef.current) return;
        console.error('Error fetching interactions:', error);
        setInteractions([]);
        setTotal(0);
        setLoadError(t('interactions.feed.loadFailed', {
          defaultValue: 'Interactions could not be loaded. Please try again.',
        }));
      })
      .finally(() => {
        if (requestId === latestRequestRef.current) setIsLoading(false);
      });
  }, [currentPage, debouncedSearch, endTime, pageSize, reloadVersion, selectedClient, selectedContact, selectedStatus, selectedType, selectedUser, startTime, t]);

  const changeFilter = useCallback((update: () => void) => {
    update();
    setCurrentPage(1);
  }, []);

  const filteredContacts = useMemo(
    () => selectedClient === 'all'
      ? allContacts
      : allContacts.filter((contact) => contact.client_id === selectedClient),
    [allContacts, selectedClient],
  );

  const activeFilterCount = [
    debouncedSearch,
    selectedUser !== 'all',
    selectedContact !== 'all',
    selectedClient !== 'all',
    selectedStatus !== 'all',
    selectedType !== 'all',
    Boolean(startTime),
    Boolean(endTime),
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setSelectedUser('all');
    setSelectedContact('all');
    setSelectedClient('all');
    setSelectedStatus('all');
    setSelectedType('all');
    setStartTime(undefined);
    setEndTime(undefined);
    setCurrentPage(1);
  };

  const refreshInteractions = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  const handleInteractionClick = (interaction: IInteraction) => {
    openDrawer(
      <InteractionDetails
        interaction={interaction}
        onInteractionDeleted={refreshInteractions}
        onInteractionUpdated={refreshInteractions}
      />,
    );
  };

  const columns = useMemo<ColumnDefinition<InteractionTableRow>[]>(() => [
    {
      title: t('interactions.overall.columns.type', { defaultValue: 'Type' }),
      dataIndex: 'type_name',
      sortable: false,
      render: (_value, interaction) => (
        <span className="flex items-center gap-2">
          <InteractionIcon icon={interaction.icon} typeName={interaction.type_name} />
          <span className="capitalize">{interaction.type_name || '—'}</span>
        </span>
      ),
    },
    { title: t('interactions.overall.columns.title', { defaultValue: 'Title' }), dataIndex: 'title', sortable: false },
    { title: t('interactions.overall.columns.client', { defaultValue: 'Client' }), dataIndex: 'client_name', sortable: false, render: (value) => value || '—' },
    { title: t('interactions.overall.columns.contact', { defaultValue: 'Contact' }), dataIndex: 'contact_name', sortable: false, render: (value) => value || '—' },
    { title: t('interactions.overall.columns.user', { defaultValue: 'User' }), dataIndex: 'user_name', sortable: false, render: (value) => value || '—' },
    {
      title: t('interactions.overall.columns.date', { defaultValue: 'Date' }),
      dataIndex: 'interaction_date',
      sortable: false,
      render: (value) => value ? new Date(value).toLocaleString() : '—',
    },
    { title: t('interactions.overall.columns.status', { defaultValue: 'Status' }), dataIndex: 'status_name', sortable: false, render: (value) => value || '—' },
  ], [t]);

  const tableData = useMemo<InteractionTableRow[]>(
    () => interactions.map((interaction) => ({ ...interaction, id: interaction.interaction_id })),
    [interactions],
  );

  return (
    <section className="overflow-hidden rounded-lg bg-[rgb(var(--color-card))] shadow" id="overall-interactions-feed" aria-label={t('interactions.overall.title', { defaultValue: 'Recent Interactions' })}>
      <div className="space-y-3 border-b border-[rgb(var(--color-border-200))] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="overall-interactions-search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={t('interactions.feed.searchPlaceholder', { defaultValue: 'Search interactions' })}
            className="h-[38px]"
            containerClassName="min-w-[260px] max-w-[460px] flex-1"
          />
          <Button id="overall-interactions-toggle-filters" variant={showFilters ? 'soft' : 'outline'} onClick={() => setShowFilters((visible) => !visible)} className="h-[38px] shrink-0 gap-1.5">
            <Filter className="h-4 w-4" />
            {t('interactions.feed.filter', { defaultValue: 'Filters' })}
            {activeFilterCount > 0 ? <span className="chip-primary ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold">{activeFilterCount}</span> : null}
          </Button>
        </div>

        {showFilters ? (
          <div className="grid gap-3 border-t border-[rgb(var(--color-border-200))] pt-3 md:grid-cols-2 xl:grid-cols-4" id="overall-interactions-expanded-filters">
            <CustomSelect
              id="overall-interactions-type-filter"
              options={[
                { value: 'all', label: t('interactions.feed.allTypes', { defaultValue: 'All Types' }) },
                ...interactionTypes.map((type) => ({ value: type.type_id, label: type.type_name })),
              ]}
              value={selectedType}
              onValueChange={(value) => changeFilter(() => setSelectedType(value))}
              placeholder={t('interactions.feed.typePlaceholder', { defaultValue: 'Interaction Type' })}
            />
            <UserPicker
              users={users}
              value={selectedUser === 'all' ? '' : selectedUser}
              onValueChange={(value) => changeFilter(() => setSelectedUser(value || 'all'))}
              getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
              placeholder={t('interactions.overall.allUsers', { defaultValue: 'All Users' })}
              buttonWidth="full"
            />
            <ClientPicker
              id="overall-interactions-client-filter"
              clients={clients}
              onSelect={(clientId) => changeFilter(() => {
                setSelectedClient(clientId || 'all');
                setSelectedContact('all');
              })}
              selectedClientId={selectedClient === 'all' ? null : selectedClient}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              fitContent={false}
            />
            <ContactPicker
              contacts={filteredContacts}
              value={selectedContact === 'all' ? '' : selectedContact}
              onValueChange={(value) => changeFilter(() => setSelectedContact(value || 'all'))}
              placeholder={selectedClient === 'all'
                ? t('interactions.overall.allContacts', { defaultValue: 'All Contacts' })
                : t('interactions.overall.contactsFromClient', { defaultValue: 'Contacts from selected client' })}
              buttonWidth="full"
              onAddNew={() => setIsQuickAddContactOpen(true)}
            />
            <CustomSelect
              id="overall-interactions-status-filter"
              options={[
                { value: 'all', label: t('interactions.overall.allStatuses', { defaultValue: 'All Statuses' }) },
                ...statuses.map((status) => ({ value: status.status_id, label: status.name })),
              ]}
              value={selectedStatus}
              onValueChange={(value) => changeFilter(() => setSelectedStatus(value))}
              placeholder={t('interactions.overall.statusPlaceholder', { defaultValue: 'Status' })}
            />
            <DateTimePicker id="overall-interactions-start-time" value={startTime} onChange={(value) => changeFilter(() => setStartTime(value))} placeholder={t('interactions.overall.startTimePlaceholder', { defaultValue: 'Filter from this start time' })} label={t('interactions.overall.startTime', { defaultValue: 'Start Time' })} />
            <DateTimePicker id="overall-interactions-end-time" value={endTime} onChange={(value) => changeFilter(() => setEndTime(value))} placeholder={t('interactions.overall.endTimePlaceholder', { defaultValue: 'Filter until this end time' })} label={t('interactions.overall.endTime', { defaultValue: 'End Time' })} minDate={startTime} />
            <div className="flex items-end justify-end">
              <Button
                id="overall-interactions-reset-filters"
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                disabled={activeFilterCount === 0}
                className="gap-1"
              >
                <XCircle className="h-4 w-4" />
                {t('interactions.feed.reset', { defaultValue: 'Reset' })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {loadError ? <p className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{loadError}</p> : null}
      {isLoading ? (
        <p className="p-6 text-sm text-[rgb(var(--color-text-500))]" id="overall-interactions-loading">{t('interactions.overall.loading', { defaultValue: 'Loading interactions…' })}</p>
      ) : tableData.length === 0 ? (
        <p className="p-6 text-sm text-[rgb(var(--color-text-500))]" id="overall-interactions-empty">{t('interactions.overall.empty', { defaultValue: 'No interactions match these filters.' })}</p>
      ) : (
        <DataTable
          id="overall-interactions-table"
          data={tableData}
          columns={columns}
          pagination
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          totalItems={total}
          onItemsPerPageChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setCurrentPage(1);
          }}
          rowClassName={() => 'cursor-pointer hover:!bg-table-hover'}
          onRowClick={handleInteractionClick}
        />
      )}

      <QuickAddContact
        isOpen={isQuickAddContactOpen}
        onClose={() => setIsQuickAddContactOpen(false)}
        onContactAdded={(newContact) => {
          setAllContacts((previousContacts) => [
            ...previousContacts.filter((contact) => contact.contact_name_id !== newContact.contact_name_id),
            newContact,
          ]);
          setSelectedContact(newContact.contact_name_id);
          setCurrentPage(1);
          setIsQuickAddContactOpen(false);
        }}
        clients={clients}
        selectedClientId={selectedClient === 'all' ? undefined : selectedClient}
      />
    </section>
  );
}
