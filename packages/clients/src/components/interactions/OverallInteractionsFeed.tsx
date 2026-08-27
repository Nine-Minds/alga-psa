'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDefinition, IClient, IContact, IInteraction, IInteractionType } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import { Filter, Plus, XCircle } from 'lucide-react';
import {
  getAllInteractionTypes,
  getInteractionStatuses,
  getInteractionsPage,
} from '@alga-psa/clients/actions';
import { useClientDrawer, useDrawer } from '@alga-psa/ui';
import { Button } from '@alga-psa/ui/components/Button';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { Input } from '@alga-psa/ui/components/Input';
import InteractionIcon from '@alga-psa/ui/components/InteractionIcon';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import InteractionDetails from './InteractionDetails';
import { QuickAddInteraction } from './QuickAddInteraction';
import ClientQuickView from '../clients/ClientQuickView';
import QuickAddContact from '../contacts/QuickAddContact';
import { useContactQuickViewDrawer } from '../contacts/bento/useContactQuickViewDrawer';

interface OverallInteractionsFeedProps {
  users: IUser[];
  contacts: IContact[];
  clients: IClient[];
  onOpenUser?: (userId: string, onUpdate?: () => void) => void;
}

type InteractionTableRow = IInteraction & { id: string };

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

// Match the compact, colored-dot status pills used by the ticket dashboard.
const STATUS_PILL_HUES = [
  'var(--color-primary-500)',
  'var(--color-secondary-500)',
  'var(--color-accent-500)',
  'var(--color-primary-700)',
  'var(--color-secondary-700)',
  'var(--color-accent-700)',
  'var(--color-text-500)',
] as const;

const hashStatus = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

function InteractionStatusPill({ name, isClosed }: { name?: string; isClosed?: boolean }) {
  if (!name) return <span className="text-[rgb(var(--color-text-400))]">—</span>;

  const hue = isClosed
    ? 'var(--color-status-success)'
    : STATUS_PILL_HUES[hashStatus(name) % STATUS_PILL_HUES.length];

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-text-700))]"
      style={{ backgroundColor: `rgb(${hue} / 0.14)`, borderColor: `rgb(${hue} / 0.30)` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `rgb(${hue})` }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

function EntityLinkCell({
  id,
  name,
  ariaLabel,
  avatar,
  onOpen,
}: {
  id: string;
  name: string | null | undefined;
  ariaLabel: string;
  avatar: React.ReactNode;
  onOpen?: () => void;
}) {
  if (!name) return <span className="text-[rgb(var(--color-text-400))]">—</span>;

  const content = (
    <span className="flex min-w-0 items-center gap-2">
      {avatar}
      <span className="truncate font-medium transition-colors group-hover:text-[rgb(var(--color-primary-700))]">
        {name}
      </span>
    </span>
  );

  if (!onOpen) return content;

  return (
    <button
      id={id}
      type="button"
      aria-label={ariaLabel}
      className="group block max-w-full border-0 bg-transparent p-0 text-left text-[rgb(var(--color-text-700))]"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {content}
    </button>
  );
}

export default function OverallInteractionsFeed({
  users,
  contacts,
  clients,
  onOpenUser,
}: OverallInteractionsFeedProps) {
  const { t } = useTranslation('msp/clients');
  const { openDrawer } = useDrawer();
  const clientDrawer = useClientDrawer();
  const openContactDrawer = useContactQuickViewDrawer();
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
  const [isQuickAddInteractionOpen, setIsQuickAddInteractionOpen] = useState(false);
  const [userAvatarUrls, setUserAvatarUrls] = useState<Record<string, string | null>>({});

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

  useEffect(() => {
    const visibleUserIds = Array.from(new Set(interactions.map((interaction) => interaction.user_id).filter(Boolean)));
    const tenant = interactions[0]?.tenant
      ?? users.find((user) => visibleUserIds.includes(user.user_id))?.tenant;
    if (!tenant || visibleUserIds.length === 0) return;

    let cancelled = false;
    void getUserAvatarUrlsBatchAction(visibleUserIds, tenant)
      .then((avatarMap) => {
        if (!cancelled) setUserAvatarUrls(Object.fromEntries(avatarMap));
      })
      .catch((error) => console.error('Error loading interaction user avatars:', error));

    return () => {
      cancelled = true;
    };
  }, [interactions, users]);

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

  const handleInteractionClick = useCallback((interaction: IInteraction) => {
    openDrawer(
      <InteractionDetails
        interaction={interaction}
        onInteractionDeleted={refreshInteractions}
        onInteractionUpdated={refreshInteractions}
      />,
    );
  }, [openDrawer, refreshInteractions]);

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.client_id, client])),
    [clients],
  );
  const contactsById = useMemo(
    () => new Map(allContacts.map((contact) => [contact.contact_name_id, contact])),
    [allContacts],
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.user_id, user])),
    [users],
  );

  const handleClientClick = useCallback((clientId: string) => {
    if (clientDrawer) {
      clientDrawer.openClientDrawer(clientId);
      return;
    }

    const client = clientsById.get(clientId);
    if (client) {
      openDrawer(<ClientQuickView client={client} isInDrawer quickView />);
    }
  }, [clientDrawer, clientsById, openDrawer]);

  const columns = useMemo<ColumnDefinition<InteractionTableRow>[]>(() => [
    {
      title: t('interactions.overall.columns.title', { defaultValue: 'Title' }),
      dataIndex: 'title',
      width: '26%',
      sortable: false,
      render: (value, interaction) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))]">
            <InteractionIcon icon={interaction.icon} typeName={interaction.type_name} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <button
              id={`overall-interaction-title-${interaction.interaction_id}`}
              type="button"
              aria-label={t('interactions.overall.openInteraction', {
                defaultValue: 'Open interaction {{title}}',
                title: value || interaction.type_name,
              })}
              className="max-w-full truncate border-0 bg-transparent p-0 text-left font-semibold text-[rgb(var(--color-text-900))] hover:text-[rgb(var(--color-primary-700))]"
              onClick={(event) => {
                event.stopPropagation();
                handleInteractionClick(interaction);
              }}
            >
              {value || '—'}
            </button>
            <span className="truncate text-[11px] capitalize leading-tight text-[rgb(var(--color-text-500))]">
              {interaction.type_name || '—'}
            </span>
          </span>
        </div>
      ),
    },
    {
      title: t('interactions.overall.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status_name',
      width: '12%',
      sortable: false,
      render: (_value, interaction) => (
        <InteractionStatusPill name={interaction.status_name} isClosed={interaction.is_status_closed} />
      ),
    },
    {
      title: t('interactions.overall.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      width: '15%',
      sortable: false,
      render: (_value, interaction) => {
        const client = interaction.client_id ? clientsById.get(interaction.client_id) : undefined;
        const name = client?.client_name ?? interaction.client_name;
        return (
          <EntityLinkCell
            id={`overall-interaction-client-${interaction.interaction_id}`}
            name={name}
            ariaLabel={t('interactions.overall.openClient', {
              defaultValue: 'Open client {{name}}',
              name,
            })}
            avatar={name && interaction.client_id ? (
              <ClientAvatar
                clientId={interaction.client_id}
                clientName={name}
                logoUrl={client?.logoUrl ?? null}
                size="xs"
              />
            ) : null}
            onOpen={interaction.client_id ? () => handleClientClick(interaction.client_id!) : undefined}
          />
        );
      },
    },
    {
      title: t('interactions.overall.columns.contact', { defaultValue: 'Contact' }),
      dataIndex: 'contact_name',
      width: '15%',
      sortable: false,
      render: (_value, interaction) => {
        const contact = interaction.contact_name_id ? contactsById.get(interaction.contact_name_id) : undefined;
        const name = contact?.full_name ?? interaction.contact_name;
        return (
          <EntityLinkCell
            id={`overall-interaction-contact-${interaction.interaction_id}`}
            name={name}
            ariaLabel={t('interactions.overall.openContact', {
              defaultValue: 'Open contact {{name}}',
              name,
            })}
            avatar={name && interaction.contact_name_id ? (
              <ContactAvatar
                contactId={interaction.contact_name_id}
                contactName={name}
                avatarUrl={contact?.avatarUrl ?? null}
                size="xs"
              />
            ) : null}
            onOpen={interaction.contact_name_id
              ? () => void openContactDrawer(interaction.contact_name_id!, { onChangesSaved: refreshInteractions })
              : undefined}
          />
        );
      },
    },
    {
      title: t('interactions.overall.columns.user', { defaultValue: 'User' }),
      dataIndex: 'user_name',
      width: '14%',
      sortable: false,
      render: (_value, interaction) => {
        const user = usersById.get(interaction.user_id);
        const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ');
        const name = fullName || interaction.user_name;
        return (
          <EntityLinkCell
            id={`overall-interaction-user-${interaction.interaction_id}`}
            name={name}
            ariaLabel={t('interactions.overall.openUser', {
              defaultValue: 'Open user {{name}}',
              name,
            })}
            avatar={name ? (
              <UserAvatar
                userId={interaction.user_id}
                userName={name}
                avatarUrl={userAvatarUrls[interaction.user_id] ?? null}
                size="xs"
              />
            ) : null}
            onOpen={onOpenUser ? () => onOpenUser(interaction.user_id, refreshInteractions) : undefined}
          />
        );
      },
    },
    {
      title: t('interactions.overall.columns.date', { defaultValue: 'Date' }),
      dataIndex: 'interaction_date',
      width: '14%',
      sortable: false,
      render: (value) => {
        if (!value) return <span className="text-[rgb(var(--color-text-400))]">—</span>;
        const date = new Date(value);
        return (
          <span className="flex flex-col leading-tight">
            <span className="font-medium text-[rgb(var(--color-text-700))]">
              {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="text-[11px] text-[rgb(var(--color-text-400))]">
              {date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          </span>
        );
      },
    },
  ], [clientsById, contactsById, handleClientClick, handleInteractionClick, onOpenUser, openContactDrawer, refreshInteractions, t, userAvatarUrls, usersById]);

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
          <Button
            id="overall-interactions-add"
            className="h-[38px] shrink-0 gap-1.5"
            onClick={() => setIsQuickAddInteractionOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t('interactions.feed.addInteraction', { defaultValue: 'Add Interaction' })}
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
          rowClassName={() => 'cursor-pointer outline-none focus:outline-none focus-visible:outline-none focus-within:outline-none hover:!bg-table-hover'}
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
      <QuickAddInteraction
        id="overall-interactions-quick-add"
        isOpen={isQuickAddInteractionOpen}
        onClose={() => setIsQuickAddInteractionOpen(false)}
        onInteractionAdded={() => {
          setIsQuickAddInteractionOpen(false);
          refreshInteractions();
        }}
      />
    </section>
  );
}
