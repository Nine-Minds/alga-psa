'use client';

import React, { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { ToggleGroup, ToggleGroupItem } from '@alga-psa/ui/components/ToggleGroup';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import type { IContact, IUser } from '@alga-psa/types';
import { normalizeEmailAddress } from '@shared/lib/email/addressUtils';
import {
  mergeTicketWatchListRecipients,
  parseTicketWatchListAttributes,
  type TicketWatchListRecipientInput,
  type TicketWatchListEntry,
} from '@shared/lib/tickets/watchList';
import styles from './TicketDetails.module.css';

interface TicketWatchListCardProps {
  id: string;
  attributes: unknown;
  onUpdateWatchList?: (watchList: TicketWatchListEntry[]) => Promise<boolean>;
  watchListSaving?: boolean;
  internalUsers?: IUser[];
  clientContacts?: IContact[];
  allContacts?: IContact[];
  allContactsLoading?: boolean;
  onLoadAllContacts?: () => Promise<void>;
}

type WatcherAddMode = 'client-contact' | 'internal-user' | 'email';
type ContactScope = 'client' | 'all';

const TicketWatchListCard: React.FC<TicketWatchListCardProps> = ({
  id,
  attributes,
  onUpdateWatchList,
  watchListSaving = false,
  internalUsers = [],
  clientContacts = [],
  allContacts = [],
  allContactsLoading = false,
  onLoadAllContacts,
}) => {
  const [watchListInput, setWatchListInput] = useState('');
  const [watcherAddMode, setWatcherAddMode] = useState<WatcherAddMode>('client-contact');
  const [contactScope, setContactScope] = useState<ContactScope>('client');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedClientContactId, setSelectedClientContactId] = useState('');
  const [selectedAllContactId, setSelectedAllContactId] = useState('');
  const [watchListError, setWatchListError] = useState<string | null>(null);
  const [watchListSavingInternal, setWatchListSavingInternal] = useState(false);
  const watchList = React.useMemo(() => parseTicketWatchListAttributes(attributes), [attributes]);
  const isWatchListSaving = watchListSaving || watchListSavingInternal;

  const selectedContactId = contactScope === 'all' ? selectedAllContactId : selectedClientContactId;
  const availableContacts = contactScope === 'all' ? allContacts : clientContacts;
  const isContactScopeLoading = contactScope === 'all' && allContactsLoading;

  const persistWatchList = async (nextWatchList: TicketWatchListEntry[]): Promise<boolean> => {
    if (!onUpdateWatchList || isWatchListSaving) {
      return false;
    }

    setWatchListError(null);
    setWatchListSavingInternal(true);
    try {
      const updated = await onUpdateWatchList(nextWatchList);
      if (!updated) {
        setWatchListError('Unable to update watch list. Please try again.');
      }
      return updated;
    } catch (error) {
      console.error('Failed to update watch list:', error);
      setWatchListError('Unable to update watch list. Please try again.');
      return false;
    } finally {
      setWatchListSavingInternal(false);
    }
  };

  const handleModeChange = (mode: string) => {
    if (mode !== 'client-contact' && mode !== 'internal-user' && mode !== 'email') {
      return;
    }
    setWatcherAddMode(mode);
    setWatchListError(null);
  };

  const handleContactScopeChange = async (nextScope: string) => {
    if (nextScope !== 'client' && nextScope !== 'all') {
      return;
    }

    if (nextScope === contactScope) {
      return;
    }
    setContactScope(nextScope);
    setWatchListError(null);
    if (nextScope === 'all' && allContacts.length === 0 && onLoadAllContacts) {
      await onLoadAllContacts();
    }
  };

  const addRecipient = async (
    recipient: TicketWatchListRecipientInput,
    onSuccess: () => void
  ): Promise<void> => {
    const mergedWatchList = mergeTicketWatchListRecipients(watchList, [recipient]);
    if (JSON.stringify(mergedWatchList) === JSON.stringify(watchList)) {
      setWatchListError(null);
      onSuccess();
      return;
    }

    const success = await persistWatchList(mergedWatchList);
    if (success) {
      onSuccess();
    }
  };

  const handleAddEmailWatcher = async () => {
    const normalizedEmail = normalizeEmailAddress(watchListInput);
    if (!normalizedEmail) {
      setWatchListError('Enter a valid email address.');
      return;
    }

    await addRecipient(
      {
        email: normalizedEmail,
        source: 'manual',
      },
      () => setWatchListInput('')
    );
  };

  const handleToggleWatcher = async (email: string, active: boolean) => {
    const nextWatchList = watchList.map((entry) =>
      entry.email === email ? { ...entry, active } : entry
    );
    await persistWatchList(nextWatchList);
  };

  const handleAddInternalUser = async () => {
    if (!selectedUserId) {
      setWatchListError('Select a user to add.');
      return;
    }

    const selectedUser = internalUsers.find((user) => user.user_id === selectedUserId);
    const normalizedEmail = normalizeEmailAddress(selectedUser?.email);
    if (!normalizedEmail) {
      setWatchListError('Selected user does not have a valid email address.');
      return;
    }

    const displayName = `${selectedUser?.first_name || ''} ${selectedUser?.last_name || ''}`.trim();
    await addRecipient(
      {
        email: normalizedEmail,
        source: 'manual',
        name: displayName || undefined,
        entity_type: 'user',
        entity_id: selectedUser.user_id,
      },
      () => setSelectedUserId('')
    );
  };

  const handleRemoveWatcher = async (email: string) => {
    const nextWatchList = watchList.filter((entry) => entry.email !== email);
    await persistWatchList(nextWatchList);
  };

  const handleAddContact = async () => {
    if (!selectedContactId) {
      setWatchListError('Select a contact to add.');
      return;
    }

    const selectedContact = availableContacts.find(
      (contact) => contact.contact_name_id === selectedContactId
    );
    const normalizedEmail = normalizeEmailAddress(selectedContact?.email);
    if (!normalizedEmail) {
      setWatchListError('Selected contact does not have a valid email address.');
      return;
    }

    await addRecipient(
      {
        email: normalizedEmail,
        source: 'manual',
        name: selectedContact.full_name || undefined,
        entity_type: 'contact',
        entity_id: selectedContact.contact_name_id,
      },
      () => {
        if (contactScope === 'all') {
          setSelectedAllContactId('');
        } else {
          setSelectedClientContactId('');
        }
      },
    );
  };

  const handleAddCurrentMode = async () => {
    if (watcherAddMode === 'email') {
      await handleAddEmailWatcher();
      return;
    }

    if (watcherAddMode === 'internal-user') {
      await handleAddInternalUser();
      return;
    }

    await handleAddContact();
  };

  const addButtonAutomationId =
    watcherAddMode === 'email'
      ? `${id}-add-btn`
      : watcherAddMode === 'internal-user'
        ? `${id}-add-user-btn`
        : contactScope === 'all'
          ? `${id}-add-all-contact-btn`
          : `${id}-add-contact-btn`;

  const addButtonDisabled =
    isWatchListSaving ||
    (watcherAddMode === 'internal-user' && !selectedUserId) ||
    (watcherAddMode === 'client-contact' && (!selectedContactId || isContactScopeLoading));

  const addButtonLabel =
    watcherAddMode === 'email'
      ? 'Add Email'
      : watcherAddMode === 'internal-user'
        ? 'Add User'
        : 'Add Contact';

  return (
    <div className={`${styles['card']} p-6 space-y-4`}>
      <h2 className={styles['panel-header']}>Watch List</h2>
      <div className="space-y-3">
        <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3 space-y-3">
          <p className="text-xs font-medium text-[rgb(var(--color-text-600))]">Add by</p>
          <ToggleGroup
            type="single"
            value={watcherAddMode}
            onValueChange={handleModeChange}
            aria-label="Choose watcher source"
            className="w-full grid grid-cols-3"
          >
            <ToggleGroupItem
              value="client-contact"
              className="min-w-0 px-2 text-xs"
              disabled={isWatchListSaving}
            >
              Client
            </ToggleGroupItem>
            <ToggleGroupItem
              value="internal-user"
              className="min-w-0 px-2 text-xs"
              disabled={isWatchListSaving}
            >
              Internal
            </ToggleGroupItem>
            <ToggleGroupItem
              value="email"
              className="min-w-0 px-2 text-xs"
              disabled={isWatchListSaving}
            >
              Email
            </ToggleGroupItem>
          </ToggleGroup>

          {watcherAddMode === 'client-contact' ? (
            <div className="space-y-2">
              <ToggleGroup
                type="single"
                value={contactScope}
                onValueChange={(value) => void handleContactScopeChange(value)}
                aria-label="Choose contact scope"
                className="w-full grid grid-cols-2"
              >
                <ToggleGroupItem
                  {...withDataAutomationId({ id: `${id}-use-ticket-client-contacts-btn` })}
                  value="client"
                  className="min-w-0 px-2 text-xs"
                  disabled={isWatchListSaving}
                >
                  Ticket Client
                </ToggleGroupItem>
                <ToggleGroupItem
                  {...withDataAutomationId({ id: `${id}-search-all-contacts-btn` })}
                  value="all"
                  className="min-w-0 px-2 text-xs"
                  disabled={isWatchListSaving || allContactsLoading}
                >
                  All Contacts
                </ToggleGroupItem>
              </ToggleGroup>
              <ContactPicker
                id={contactScope === 'all' ? `${id}-all-contacts-picker` : `${id}-contact-picker`}
                contacts={availableContacts}
                value={selectedContactId}
                onValueChange={(value) => {
                  if (contactScope === 'all') {
                    setSelectedAllContactId(value);
                  } else {
                    setSelectedClientContactId(value);
                  }
                }}
                placeholder={
                  contactScope === 'all'
                    ? allContactsLoading
                      ? 'Loading contacts...'
                      : 'Search all contacts'
                    : 'Select client contact'
                }
                disabled={isWatchListSaving || isContactScopeLoading}
              />
            </div>
          ) : null}

          {watcherAddMode === 'internal-user' ? (
            <UserPicker
              id={`${id}-user-picker`}
              value={selectedUserId}
              onValueChange={setSelectedUserId}
              users={internalUsers}
              placeholder="Select internal user"
              size="sm"
              disabled={isWatchListSaving}
            />
          ) : null}

          {watcherAddMode === 'email' ? (
            <Input
              {...withDataAutomationId({ id: `${id}-email-input` })}
              value={watchListInput}
              onChange={(event) => setWatchListInput(event.target.value)}
              placeholder="name@example.com"
              disabled={isWatchListSaving}
              onKeyDown={async (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  await handleAddEmailWatcher();
                }
              }}
            />
          ) : null}

          <div className="flex justify-end">
            <Button
              {...withDataAutomationId({ id: addButtonAutomationId })}
              type="button"
              onClick={handleAddCurrentMode}
              disabled={addButtonDisabled}
              size="sm"
            >
              {addButtonLabel}
            </Button>
          </div>
        </div>

        {watchListError ? (
          <p className="text-sm text-red-600 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            {watchListError}
          </p>
        ) : null}

        {watchList.length === 0 ? (
          <p className="text-sm text-gray-500">No watchers added.</p>
        ) : (
          <div className="space-y-2">
            {watchList.map((entry) => (
              <div
                key={entry.email}
                className="flex items-center justify-between gap-3 border border-gray-200 rounded px-3 py-2"
              >
                <label className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={entry.active}
                    disabled={isWatchListSaving}
                    onChange={(event) => void handleToggleWatcher(entry.email, event.target.checked)}
                  />
                  <div className="min-w-0">
                    <div className={`text-sm truncate ${entry.active ? 'text-gray-900' : 'text-gray-500'}`}>
                      {entry.email}
                    </div>
                    {(entry.name || entry.entity_type) ? (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {entry.name ? <span className="truncate">{entry.name}</span> : null}
                        {entry.entity_type ? (
                          <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
                            {entry.entity_type}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </label>
                <Button
                  {...withDataAutomationId({ id: `${id}-remove-btn-${entry.email}` })}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isWatchListSaving}
                  onClick={() => void handleRemoveWatcher(entry.email)}
                >
                  <X className="h-3 w-3 mr-1" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TicketWatchListCard;
