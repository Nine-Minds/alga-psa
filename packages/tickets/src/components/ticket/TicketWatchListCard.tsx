'use client';

import React, { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import type { IContact, IUser } from '@alga-psa/types';
import { normalizeEmailAddress } from '@shared/lib/email/addressUtils';
import {
  mergeTicketWatchListRecipients,
  parseTicketWatchListAttributes,
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
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedAllContactId, setSelectedAllContactId] = useState('');
  const [showAllContactsSearch, setShowAllContactsSearch] = useState(false);
  const [watchListError, setWatchListError] = useState<string | null>(null);
  const [watchListSavingInternal, setWatchListSavingInternal] = useState(false);
  const watchList = React.useMemo(() => parseTicketWatchListAttributes(attributes), [attributes]);
  const isWatchListSaving = watchListSaving || watchListSavingInternal;

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

  const handleAddWatcher = async () => {
    const normalizedEmail = normalizeEmailAddress(watchListInput);
    if (!normalizedEmail) {
      setWatchListError('Enter a valid email address.');
      return;
    }

    const mergedWatchList = mergeTicketWatchListRecipients(watchList, [
      {
        email: normalizedEmail,
        source: 'manual',
      },
    ]);

    if (JSON.stringify(mergedWatchList) === JSON.stringify(watchList)) {
      setWatchListError(null);
      setWatchListInput('');
      return;
    }

    const success = await persistWatchList(mergedWatchList);
    if (success) {
      setWatchListInput('');
    }
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
    const mergedWatchList = mergeTicketWatchListRecipients(watchList, [
      {
        email: normalizedEmail,
        source: 'manual',
        name: displayName || undefined,
        entity_type: 'user',
        entity_id: selectedUser.user_id,
      },
    ]);

    if (JSON.stringify(mergedWatchList) === JSON.stringify(watchList)) {
      setWatchListError(null);
      setSelectedUserId('');
      return;
    }

    const success = await persistWatchList(mergedWatchList);
    if (success) {
      setSelectedUserId('');
    }
  };

  const handleRemoveWatcher = async (email: string) => {
    const nextWatchList = watchList.filter((entry) => entry.email !== email);
    await persistWatchList(nextWatchList);
  };

  const handleAddClientContact = async () => {
    if (!selectedContactId) {
      setWatchListError('Select a contact to add.');
      return;
    }

    const selectedContact = clientContacts.find(
      (contact) => contact.contact_name_id === selectedContactId
    );
    const normalizedEmail = normalizeEmailAddress(selectedContact?.email);
    if (!normalizedEmail) {
      setWatchListError('Selected contact does not have a valid email address.');
      return;
    }

    const mergedWatchList = mergeTicketWatchListRecipients(watchList, [
      {
        email: normalizedEmail,
        source: 'manual',
        name: selectedContact.full_name || undefined,
        entity_type: 'contact',
        entity_id: selectedContact.contact_name_id,
      },
    ]);

    if (JSON.stringify(mergedWatchList) === JSON.stringify(watchList)) {
      setWatchListError(null);
      setSelectedContactId('');
      return;
    }

    const success = await persistWatchList(mergedWatchList);
    if (success) {
      setSelectedContactId('');
    }
  };

  const handleAddAllContact = async () => {
    if (!selectedAllContactId) {
      setWatchListError('Select a contact to add.');
      return;
    }

    const selectedContact = allContacts.find((contact) => contact.contact_name_id === selectedAllContactId);
    const normalizedEmail = normalizeEmailAddress(selectedContact?.email);
    if (!normalizedEmail) {
      setWatchListError('Selected contact does not have a valid email address.');
      return;
    }

    const mergedWatchList = mergeTicketWatchListRecipients(watchList, [
      {
        email: normalizedEmail,
        source: 'manual',
        name: selectedContact.full_name || undefined,
        entity_type: 'contact',
        entity_id: selectedContact.contact_name_id,
      },
    ]);

    if (JSON.stringify(mergedWatchList) === JSON.stringify(watchList)) {
      setWatchListError(null);
      setSelectedAllContactId('');
      return;
    }

    const success = await persistWatchList(mergedWatchList);
    if (success) {
      setSelectedAllContactId('');
    }
  };

  const handleShowAllContactsSearch = async () => {
    setShowAllContactsSearch(true);
    if (allContacts.length === 0 && onLoadAllContacts) {
      await onLoadAllContacts();
    }
  };

  return (
    <div className={`${styles['card']} p-6 space-y-4`}>
      <h2 className={styles['panel-header']}>Watch List</h2>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            {...withDataAutomationId({ id: `${id}-email-input` })}
            value={watchListInput}
            onChange={(event) => setWatchListInput(event.target.value)}
            placeholder="name@example.com"
            disabled={isWatchListSaving}
            onKeyDown={async (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                await handleAddWatcher();
              }
            }}
          />
          <Button
            {...withDataAutomationId({ id: `${id}-add-btn` })}
            type="button"
            onClick={handleAddWatcher}
            disabled={isWatchListSaving}
            size="sm"
          >
            Add
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <UserPicker
              id={`${id}-user-picker`}
              value={selectedUserId}
              onValueChange={setSelectedUserId}
              users={internalUsers}
              placeholder="Select internal user"
              size="sm"
              disabled={isWatchListSaving}
            />
          </div>
          <Button
            {...withDataAutomationId({ id: `${id}-add-user-btn` })}
            type="button"
            onClick={handleAddInternalUser}
            disabled={isWatchListSaving || !selectedUserId}
            size="sm"
          >
            Add User
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ContactPicker
              id={`${id}-contact-picker`}
              contacts={clientContacts}
              value={selectedContactId}
              onValueChange={setSelectedContactId}
              placeholder="Select client contact"
              disabled={isWatchListSaving}
            />
          </div>
          <Button
            {...withDataAutomationId({ id: `${id}-add-contact-btn` })}
            type="button"
            onClick={handleAddClientContact}
            disabled={isWatchListSaving || !selectedContactId}
            size="sm"
          >
            Add Contact
          </Button>
        </div>

        {!showAllContactsSearch ? (
          <div className="flex justify-start">
            <Button
              {...withDataAutomationId({ id: `${id}-search-all-contacts-btn` })}
              type="button"
              variant="outline"
              size="sm"
              disabled={isWatchListSaving || allContactsLoading}
              onClick={() => void handleShowAllContactsSearch()}
            >
              Search all contacts
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ContactPicker
                  id={`${id}-all-contacts-picker`}
                  contacts={allContacts}
                  value={selectedAllContactId}
                  onValueChange={setSelectedAllContactId}
                  placeholder={allContactsLoading ? 'Loading contacts...' : 'Search all contacts'}
                  disabled={isWatchListSaving || allContactsLoading}
                />
              </div>
              <Button
                {...withDataAutomationId({ id: `${id}-add-all-contact-btn` })}
                type="button"
                onClick={handleAddAllContact}
                disabled={isWatchListSaving || allContactsLoading || !selectedAllContactId}
                size="sm"
              >
                Add Contact
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Secondary path for cross-client contacts.
            </p>
          </div>
        )}

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
                  <span className={`text-sm ${entry.active ? 'text-gray-900' : 'text-gray-500'}`}>
                    {entry.email}
                  </span>
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
