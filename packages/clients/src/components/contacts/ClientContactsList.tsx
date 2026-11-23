'use client';

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import type { IContact, IClientWithLocation } from '@alga-psa/types';
import {
  getContactsByClient,
  getPortalInvitationStatesForClient,
  searchContactListIds,
} from '@alga-psa/clients/actions';
import { getContactPortalPermissions } from '@alga-psa/auth/actions';
import type {
  PortalInvitationState,
  PortalInvitationStateTarget,
} from '@alga-psa/portal-shared/types';
import { contactMatchesPhoneDigits, phoneSearchDigits } from '../../lib/contactSearchMatch';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { PhoneText } from '@alga-psa/ui/components/PhoneText';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Eye, ExternalLink, MoreVertical, Pen } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { ColumnDefinition } from '@alga-psa/types';
import { contactLocationCell } from '../../lib/contactLocationDisplay';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { isPlainLeftClick } from '@alga-psa/ui/lib/plainLeftClick';
import { useContactQuickViewDrawer } from './bento/useContactQuickViewDrawer';
import { useContactEditDrawer } from './bento/useContactEditDrawer';
import QuickAddContact from './QuickAddContact';
import BulkPortalInvitationDialog, { type BulkPortalInvitationTarget } from './BulkPortalInvitationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientContactsListProps {
  clientId: string;
  client: IClientWithLocation; // The client being viewed (QuickAddContact scope and phone default country)
}

// Extended contact type with id for stable DataTable keys
type ContactWithId = IContact & { id: string };

// Helper to ensure contacts have stable id for DataTable row keys
// This prevents React DOM reconciliation errors when rows are re-rendered
// Uses existing id if present, otherwise falls back to contact_name_id
const addIdToContacts = (contacts: IContact[]): ContactWithId[] => {
  return contacts.map(contact => ({
    ...contact,
    id: (contact as any).id ?? contact.contact_name_id
  }));
};

const ClientContactsList: React.FC<ClientContactsListProps> = ({ clientId, client }) => {
  const { t } = useTranslation('msp/contacts');
  const [contacts, setContacts] = useState<ContactWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  // 'all' | 'remote' | 'none' | a location id. Options come from the contacts on screen, so the
  // filter never offers a site nobody here works at.
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [indexedSearchContactIds, setIndexedSearchContactIds] = useState<Set<string> | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [invitationTarget, setInvitationTarget] = useState<BulkPortalInvitationTarget | null>(null);
  // Each contact's standing with the portal, so a rollout can be read off this
  // list: 'all' leaves the list alone, the rest narrow it to who needs chasing.
  // `null` is "this reader cannot see invitation state", which hides the column
  // rather than claiming nobody was ever invited.
  const [invitationStates, setInvitationStates] = useState<
    Map<string, { state: PortalInvitationState; expiresAt: string | null }> | null
  >(null);
  const [invitationFilter, setInvitationFilter] = useState<'all' | 'expired' | 'pending' | 'open'>('all');
  // False until the check resolves, so the invite affordances never flash in
  // for a reader who would only meet a server refusal. Same gate the contact's
  // own Portal tab uses.
  const [canInvite, setCanInvite] = useState(false);
  const openContactQuickView = useContactQuickViewDrawer();
  const openContactEdit = useContactEditDrawer();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    const fetchContacts = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchedContacts = await getContactsByClient(clientId, statusFilter);
        setContacts(addIdToContacts(fetchedContacts));
      } catch (err) {
        console.error('Error fetching client contacts:', err);
        setError(t('clientContactsList.errors.loadFailed', {
          defaultValue: 'Failed to load contacts.'
        }));
      } finally {
        setLoading(false);
      }
    };

    fetchContacts();
  }, [clientId, statusFilter, t]);

  useEffect(() => {
    let isCancelled = false;
    getContactPortalPermissions()
      .then((permissions) => {
        if (!isCancelled) setCanInvite(Boolean(permissions?.canInvite));
      })
      .catch((err) => console.error('Error checking portal invitation permission:', err));
    return () => {
      isCancelled = true;
    };
  }, []);

  const refreshInvitationStates = useCallback(() => {
    getPortalInvitationStatesForClient(clientId)
      .then((rows) => setInvitationStates(rows === null ? null : new Map(
        rows.map((row) => [row.contactId, { state: row.state, expiresAt: row.expiresAt }]),
      )))
      .catch((err) => {
        console.error('Error loading portal invitation states:', err);
        setInvitationStates(null);
      });
  }, [clientId]);

  useEffect(() => {
    refreshInvitationStates();
  }, [refreshInvitationStates]);

  // Re-run the list query so a contact moved to another client drops out of
  // this list as soon as the drawer saves.
  const refreshContacts = () => {
    getContactsByClient(clientId, statusFilter)
      .then(data => setContacts(addIdToContacts(data)))
      .catch(err => console.error('Error refreshing contacts after drawer save:', err));
    refreshInvitationStates();
  };

  const handleQuickView = (contact: IContact) => {
    void openContactQuickView(contact.contact_name_id, { onChangesSaved: refreshContacts });
  };

  const handleContactClick = (contact: IContact) => {
    // Open quick view drawer (same behavior as dropdown quick view)
    handleQuickView(contact);
  };

  const handleEditContact = (contact: IContact) => {
    // Edit in a drawer so the client context survives (the full contact page
    // is still reachable from Quick View's "Go to contact").
    void openContactEdit(contact.contact_name_id, { onSaved: refreshContacts });
  };

  // Notes written in the rich-text editor live in a document, not on the contact
  // row, so the indexed search is what finds them here — the same query the main
  // contacts list runs. Results are intersected with this client's contacts.
  useEffect(() => {
    const query = searchTerm.trim();
    if (!query) {
      setIndexedSearchContactIds(null);
      return;
    }

    setIndexedSearchContactIds(null);
    let isCancelled = false;
    const timeout = setTimeout(() => {
      searchContactListIds(query)
        .then((contactIds) => {
          if (!isCancelled) {
            setIndexedSearchContactIds(new Set(contactIds));
          }
        })
        .catch((err) => {
          console.error('Error searching client contacts:', err);
          if (!isCancelled) {
            setIndexedSearchContactIds(new Set());
          }
        });
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
    };
  }, [searchTerm]);

  // Client-side search: getContactsByClient returns the client's full contact
  // set, so filtering here scales to the realistic per-client contact count.
  const filteredContacts = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return contacts;
    // Phones are formatted for display, so match them digits-only across every
    // number on the contact rather than the default number's literal text.
    const searchDigits = phoneSearchDigits(needle);
    return contacts.filter((contact) =>
      [contact.full_name, contact.email, contact.role, contact.notes]
        .some((field) => field && field.toLowerCase().includes(needle))
      || (searchDigits !== null && contactMatchesPhoneDigits(contact, searchDigits))
      || indexedSearchContactIds?.has(contact.contact_name_id) === true
    );
  }, [contacts, searchTerm, indexedSearchContactIds]);

  const locationFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const contact of contacts) {
      for (const location of contact.locations ?? []) {
        byId.set(location.location_id, location.location_name?.trim() || location.address_line1?.trim() || '—');
      }
    }
    return [
      { value: 'all', label: t('clientContactsList.filter.allLocations', { defaultValue: 'All locations' }) },
      ...[...byId.entries()]
        .sort((left, right) => left[1].localeCompare(right[1]))
        .map(([value, label]) => ({ value, label })),
      { value: 'remote', label: t('contactLocations.arrangement.remote', { defaultValue: 'Remote' }) },
      { value: 'none', label: t('clientContactsList.filter.noLocation', { defaultValue: 'No location' }) },
    ];
  }, [contacts, t]);

  const locationFilteredContacts = useMemo(() => {
    const byLocation = locationFilter === 'all'
      ? filteredContacts
      : locationFilter === 'remote'
        ? filteredContacts.filter((contact) => contact.work_arrangement === 'remote')
        : locationFilter === 'none'
          ? filteredContacts.filter((contact) => (contact.locations ?? []).length === 0)
          : filteredContacts.filter((contact) =>
            (contact.locations ?? []).some((location) => location.location_id === locationFilter));

    if (invitationFilter === 'all' || !invitationStates) return byLocation;
    // Same classification the resend acts on, so what the MSP filtered to is
    // what the batch mails.
    const wanted: PortalInvitationState[] = invitationFilter === 'open'
      ? ['expired', 'pending']
      : [invitationFilter];
    return byLocation.filter((contact) => {
      const state = invitationStates.get(contact.contact_name_id)?.state;
      return state !== undefined && wanted.includes(state);
    });
  }, [filteredContacts, locationFilter, invitationFilter, invitationStates]);

  /** The states a "Resend" from here would act on; the filter names the set. */
  const resendStates: PortalInvitationStateTarget[] = invitationFilter === 'pending'
    ? ['pending']
    : invitationFilter === 'open'
      ? ['expired', 'pending']
      : ['expired'];

  const invitationStateCell = (contactId: string): React.ReactNode => {
    const entry = invitationStates?.get(contactId);
    if (!entry || entry.state === 'none') {
      return <span className="text-gray-400">{t('clientContactsList.invitation.none', { defaultValue: 'Not invited' })}</span>;
    }
    if (entry.state === 'active_user') {
      return t('clientContactsList.invitation.activeUser', { defaultValue: 'Active portal user' });
    }
    if (entry.state === 'pending') {
      return t('clientContactsList.invitation.pendingUntil', {
        defaultValue: 'Pending until {{date}}',
        date: entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString() : '',
      });
    }
    return (
      <span className="text-[rgb(var(--color-status-warning))]">
        {t('clientContactsList.invitation.expired', { defaultValue: 'Invitation expired' })}
      </span>
    );
  };

  // Select-all covers exactly what the filters left on screen, so the header
  // box never quietly ticks a contact the user cannot see.
  const selectedOnScreen = useMemo(
    () => locationFilteredContacts.filter((contact) => selectedContactIds.has(contact.contact_name_id)),
    [locationFilteredContacts, selectedContactIds],
  );
  const allOnScreenSelected = locationFilteredContacts.length > 0
    && selectedOnScreen.length === locationFilteredContacts.length;

  const toggleContactSelection = (contactId: string, selected: boolean) => {
    setSelectedContactIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(contactId); else next.delete(contactId);
      return next;
    });
  };

  const toggleSelectAllOnScreen = (selected: boolean) => {
    setSelectedContactIds((previous) => {
      const next = new Set(previous);
      for (const contact of locationFilteredContacts) {
        if (selected) next.add(contact.contact_name_id); else next.delete(contact.contact_name_id);
      }
      return next;
    });
  };

  // The selection column exists only to feed the bulk invitation, so it is
  // gated on the same permission as the buttons it serves.
  const selectColumn: ColumnDefinition<IContact>[] = canInvite ? [
    {
      title: (
        <Checkbox
          id="client-contacts-select-all"
          checked={allOnScreenSelected}
          indeterminate={selectedOnScreen.length > 0 && !allOnScreenSelected}
          onChange={(e) => toggleSelectAllOnScreen(e.target.checked)}
          aria-label={t('clientContactsList.actions.selectAll', { defaultValue: 'Select all contacts' })}
        />
      ),
      dataIndex: 'contact_name_id',
      id: 'select',
      width: '3%',
      sortable: false,
      render: (value, record): React.ReactNode => (
        <Checkbox
          id={`client-contacts-select-${record.contact_name_id}`}
          checked={selectedContactIds.has(record.contact_name_id)}
          onChange={(e) => toggleContactSelection(record.contact_name_id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('clientContactsList.actions.selectContact', {
            defaultValue: 'Select {{name}}',
            name: record.full_name,
          })}
        />
      ),
    },
  ] : [];

  // A rollout is run from this list, so who still owes the portal a visit
  // belongs on the row rather than inside each contact's Portal tab — but only
  // for a reader the server actually tells.
  const invitationColumn: ColumnDefinition<IContact>[] = invitationStates ? [
    {
      title: t('clientContactsList.table.portalInvitation', { defaultValue: 'Portal invitation' }),
      dataIndex: 'contact_name_id',
      id: 'portal-invitation',
      width: '15%',
      sortable: false,
      render: (value, record): React.ReactNode => invitationStateCell(record.contact_name_id),
    },
  ] : [];

  const columns: ColumnDefinition<IContact>[] = [
    ...selectColumn,
    {
      title: t('clientContactsList.table.name', { defaultValue: 'Name' }),
      dataIndex: 'full_name',
      width: '30%',
      render: (value, record): React.ReactNode => (
        <div className="flex items-center">
          <ContactAvatar
            contactId={record.contact_name_id}
            contactName={record.full_name}
            avatarUrl={record.avatarUrl || null}
            size="sm"
            className="mr-2"
          />
          {/* Plain click keeps Quick View, so the client context survives;
              modified and middle clicks fall through to the browser and open
              the full contact page (in a new tab when asked for). */}
          <Link
            id={`client-contact-name-link-${record.contact_name_id}`}
            href={`/msp/contacts/${record.contact_name_id}`}
            prefetch={false}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              handleContactClick(record);
            }}
            className="text-blue-600 hover:underline cursor-pointer"
          >
            {record.full_name}
          </Link>
          {record.contact_kind === 'shared_mailbox' && <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">{t('contactsPage.sharedMailbox', { defaultValue: 'Shared mailbox' })}</span>}
        </div>
      ),
    },
    {
      // W7 (roast gap): role was already on every row but never shown —
      // "who do I call for X" needs it.
      title: t('clientContactsList.table.role', { defaultValue: 'Role' }),
      dataIndex: 'role',
      width: '15%',
      render: (value, record): React.ReactNode =>
        record.role || <span className="text-gray-400">—</span>,
    },
    {
      title: t('clientContactsList.table.email', { defaultValue: 'Email' }),
      dataIndex: 'email',
      width: '22%',
      render: (value, record): React.ReactNode =>
        record.email || t('common.states.na', { defaultValue: 'N/A' }),
    },
    ...invitationColumn,
    {
      title: t('clientContactsList.table.location', { defaultValue: 'Location' }),
      // The nested name, so the table sorts the column by it rather than by the object.
      dataIndex: ['primaryLocation', 'location_name'],
      width: '15%',
      render: (value, record): React.ReactNode => {
        const cell = contactLocationCell(record);
        if (!cell.label) {
          return cell.isRemote
            ? t('contactLocations.arrangement.remote', { defaultValue: 'Remote' })
            : '';
        }
        return (
          <span className="truncate">
            {cell.label}
            {cell.extraCount > 0 ? (
              <span className="text-gray-500">
                {' '}
                {t('contactLocations.extraCount', { defaultValue: '+{{count}}', count: cell.extraCount })}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      title: t('clientContactsList.table.phoneNumber', {
        defaultValue: 'Phone number'
      }),
      dataIndex: 'default_phone_number',
      width: '15%',
      render: (value, record): React.ReactNode =>
        <PhoneText value={record.default_phone_number || record.phone_numbers?.find((phoneNumber: any) => phoneNumber.is_default)?.phone_number} extension={record.phone_numbers?.find((phoneNumber: any) => phoneNumber.is_default)?.extension} defaultCountry={client.location_country_code} fallback={t('common.states.na', { defaultValue: 'N/A' })} />,
    },
    {
      title: '',
      dataIndex: 'actions',
      width: '5%',
      render: (value, record): React.ReactNode => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              id="client-contacts-actions-menu"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">
                {t('clientContactsList.actions.openMenu', { defaultValue: 'Open menu' })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            align="end"
            className="bg-white rounded-md shadow-lg p-1 border border-gray-200 min-w-[120px] z-50"
          >
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
              onSelect={() => handleQuickView(record)}
            >
              <ExternalLink size={14} className="mr-2" />
              {t('clientContactsList.actions.quickView', { defaultValue: 'Quick View' })}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
              onSelect={() => handleEditContact(record)}
            >
              <Pen size={14} className="mr-2" />
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-pulse flex flex-col space-y-4 w-full">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-12 bg-gray-200 rounded w-full"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded w-full"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
        <Alert variant="destructive">
        <AlertDescription>
          <p className="font-semibold">
            {t('clientContactsList.errors.loadingTitle', {
              defaultValue: 'Error loading contacts'
            })}
          </p>
          <p>{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              getContactsByClient(clientId, statusFilter)
                .then(data => setContacts(addIdToContacts(data)))
                .catch(err => {
                  console.error('Error retrying contact fetch:', err);
                  setError(t('clientContactsList.errors.retryFailed', {
                    defaultValue: 'Failed to load contacts. Please try again.'
                  }));
                })
                .finally(() => setLoading(false));
            }}
            className="mt-2 px-4 py-2 bg-destructive/20 hover:bg-destructive/30 rounded-md"
          >
            {t('common.actions.retry', { defaultValue: 'Retry' })}
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">
            {t('clientContactsList.filter.show', { defaultValue: 'Show:' })}
          </span>
          <CustomSelect
            id="contact-status-filter"
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as 'active' | 'inactive' | 'all')}
            options={[
              {
                value: 'active',
                label: t('clientContactsList.filter.active', {
                  defaultValue: 'Active Contacts'
                })
              },
              {
                value: 'inactive',
                label: t('clientContactsList.filter.inactive', {
                  defaultValue: 'Inactive Contacts'
                })
              },
              {
                value: 'all',
                label: t('clientContactsList.filter.all', {
                  defaultValue: 'All Contacts'
                })
              }
            ]}
          />
          <CustomSelect
            id="contact-location-filter"
            value={locationFilter}
            onValueChange={setLocationFilter}
            options={locationFilterOptions}
          />
          {invitationStates && <CustomSelect
            id="contact-invitation-state-filter"
            value={invitationFilter}
            onValueChange={(value) => {
              setInvitationFilter(value as 'all' | 'expired' | 'pending' | 'open');
              setCurrentPage(1);
            }}
            options={[
              {
                value: 'all',
                label: t('clientContactsList.filter.allInvitationStates', {
                  defaultValue: 'Any invitation state',
                }),
              },
              {
                value: 'expired',
                label: t('clientContactsList.filter.invitationExpired', {
                  defaultValue: 'Expired invitations',
                }),
              },
              {
                value: 'pending',
                label: t('clientContactsList.filter.invitationPending', {
                  defaultValue: 'Pending invitations',
                }),
              },
              {
                value: 'open',
                label: t('clientContactsList.filter.invitationExpiredOrPending', {
                  defaultValue: 'Expired or pending',
                }),
              },
            ]}
          />}
          {/* W7 (roast gap): a client with dozens of contacts had no search. */}
          <Input
            id="client-contacts-search"
            placeholder={t('clientContactsList.filter.searchPlaceholder', { defaultValue: 'Search contacts...' })}
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="h-[38px] text-sm"
            containerClassName="w-[220px]"
          />
        </div>
        <div className="flex items-center gap-2">
          {canInvite && selectedContactIds.size > 0 && (
            <Button
              id="invite-selected-contacts-btn"
              variant="secondary"
              onClick={() => setInvitationTarget({ mode: 'selected', contactIds: [...selectedContactIds] })}
            >
              {t('clientContactsList.actions.inviteSelected', {
                defaultValue: 'Invite to portal ({{selected}})',
                selected: selectedContactIds.size
              })}
            </Button>
          )}
          {canInvite && invitationStates && selectedContactIds.size === 0 && (
            <Button
              id="resend-portal-invitations-btn"
              variant="secondary"
              onClick={() => setInvitationTarget({ mode: 'invitationState', states: resendStates })}
            >
              {resendStates.length > 1
                ? t('clientContactsList.actions.resendOpen', {
                  defaultValue: 'Resend expired or pending',
                })
                : resendStates[0] === 'pending'
                  ? t('clientContactsList.actions.resendPending', { defaultValue: 'Resend pending' })
                  : t('clientContactsList.actions.resendExpired', { defaultValue: 'Resend expired' })}
            </Button>
          )}
          {canInvite && (
            <Button
              id="invite-all-eligible-contacts-btn"
              variant="secondary"
              onClick={() => setInvitationTarget({ mode: 'allEligible' })}
            >
              {t('clientContactsList.actions.inviteAllEligible', {
                defaultValue: 'Invite all eligible'
              })}
            </Button>
          )}
          <Button
            id="add-new-contact-btn"
            onClick={() => setIsQuickAddContactOpen(true)}
          >
            {t('clientContactsList.actions.addNewContact', {
              defaultValue: 'Add contact'
            })}
          </Button>
        </div>
      </div>
      <DataTable
        id="client-contacts-list"
        data={locationFilteredContacts}
        columns={columns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
      />
      <QuickAddContact
        isOpen={isQuickAddContactOpen}
        onClose={() => setIsQuickAddContactOpen(false)}
        onContactAdded={() => {
          getContactsByClient(clientId, statusFilter)
            .then(data => setContacts(addIdToContacts(data)))
            .catch(err => console.error('Error refreshing contacts after quick add:', err));
        }}
        selectedClientId={clientId}
      />
      {invitationTarget && (
        <BulkPortalInvitationDialog
          isOpen
          clientId={clientId}
          target={invitationTarget}
          statusFilter={statusFilter}
          contacts={contacts}
          onClose={() => setInvitationTarget(null)}
          onSent={() => {
            setSelectedContactIds(new Set());
            refreshContacts();
          }}
        />
      )}
    </div>
  );
};

export default ClientContactsList;
