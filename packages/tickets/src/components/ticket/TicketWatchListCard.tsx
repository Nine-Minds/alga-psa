'use client';

import React, { useState, useMemo } from 'react';
import { AlertCircle, Eye, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { ContentCard } from '@alga-psa/ui/components';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tabs, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import type { GetUserAvatarUrlsBatch } from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import type { GetTeamAvatarUrlsBatch } from '@alga-psa/ui/components/UserAndTeamPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IContact, ITeam, IUser } from '@alga-psa/types';
import { normalizeEmailAddress } from '@shared/lib/email/addressUtils';
import {
  mergeTicketWatchListRecipients,
  parseTicketWatchListAttributes,
  type TicketWatchListRecipientInput,
  type TicketWatchListEntry,
} from '@shared/lib/tickets/watchList';

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
  teams?: ITeam[];
  getUserAvatarUrlsBatch?: GetUserAvatarUrlsBatch;
  getTeamAvatarUrlsBatch?: GetTeamAvatarUrlsBatch;
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
  teams = [],
  getUserAvatarUrlsBatch,
  getTeamAvatarUrlsBatch,
}) => {
  const { t } = useTranslation('features/tickets');
  const [watchListInput, setWatchListInput] = useState('');
  const [watcherAddMode, setWatcherAddMode] = useState<WatcherAddMode>('client-contact');
  const [contactScope, setContactScope] = useState<ContactScope>('client');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedClientContactId, setSelectedClientContactId] = useState('');
  const [selectedAllContactId, setSelectedAllContactId] = useState('');
  const [watchListError, setWatchListError] = useState<string | null>(null);
  const [watchListSavingInternal, setWatchListSavingInternal] = useState(false);
  const watchList = useMemo(() => parseTicketWatchListAttributes(attributes), [attributes]);
  const isWatchListSaving = watchListSaving || watchListSavingInternal;

  const watchListEmails = useMemo(
    () => new Set(watchList.map((entry) => entry.email.toLowerCase())),
    [watchList]
  );

  const filteredInternalUsers = useMemo(
    () => internalUsers.filter((user) => {
      const normalized = normalizeEmailAddress(user.email);
      return !normalized || !watchListEmails.has(normalized.toLowerCase());
    }),
    [internalUsers, watchListEmails]
  );

  const filteredClientContacts = useMemo(
    () => clientContacts.filter((contact) => {
      const normalized = normalizeEmailAddress(contact.email);
      return !normalized || !watchListEmails.has(normalized.toLowerCase());
    }),
    [clientContacts, watchListEmails]
  );

  const filteredAllContacts = useMemo(
    () => allContacts.filter((contact) => {
      const normalized = normalizeEmailAddress(contact.email);
      return !normalized || !watchListEmails.has(normalized.toLowerCase());
    }),
    [allContacts, watchListEmails]
  );

  const selectedContactId = contactScope === 'all' ? selectedAllContactId : selectedClientContactId;
  const availableContacts = contactScope === 'all' ? filteredAllContacts : filteredClientContacts;
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
        setWatchListError(t('watchList.updateFailed', 'Unable to update watch list. Please try again.'));
      }
      return updated;
    } catch (error) {
      console.error('Failed to update watch list:', error);
      setWatchListError(t('watchList.updateFailed', 'Unable to update watch list. Please try again.'));
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
      setWatchListError(t('watchList.validEmail', 'Enter a valid email address.'));
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
      setWatchListError(t('watchList.selectUserToAdd', 'Select a user to add.'));
      return;
    }

    const selectedUser = internalUsers.find((user) => user.user_id === selectedUserId);
    if (!selectedUser) {
      setWatchListError(t('watchList.selectUserToAdd', 'Select a user to add.'));
      return;
    }

    const normalizedEmail = normalizeEmailAddress(selectedUser?.email);
    if (!normalizedEmail) {
      setWatchListError(t('watchList.selectedUserInvalidEmail', 'Selected user does not have a valid email address.'));
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

  const handleAddTeamMembers = async (teamId: string) => {
    const team = teams.find((t) => t.team_id === teamId);
    if (!team || !team.members || team.members.length === 0) {
      setWatchListError(t('watchList.teamHasNoMembers', 'Team has no members.'));
      return;
    }

    const recipients: TicketWatchListRecipientInput[] = [];
    for (const member of team.members) {
      if (member.is_inactive) continue;
      const normalizedEmail = normalizeEmailAddress(member.email);
      if (!normalizedEmail) continue;
      const displayName = `${member.first_name || ''} ${member.last_name || ''}`.trim();
      recipients.push({
        email: normalizedEmail,
        source: 'manual',
        name: displayName || undefined,
        entity_type: 'user',
        entity_id: member.user_id,
      });
    }

    if (recipients.length === 0) {
      setWatchListError(t('watchList.noTeamMembersWithValidEmails', 'No team members with valid email addresses.'));
      return;
    }

    const mergedWatchList = mergeTicketWatchListRecipients(watchList, recipients);
    if (JSON.stringify(mergedWatchList) !== JSON.stringify(watchList)) {
      await persistWatchList(mergedWatchList);
    }
  };

  const handleAddContact = async () => {
    if (!selectedContactId) {
      setWatchListError(t('watchList.selectContactToAdd', 'Select a contact to add.'));
      return;
    }

    const selectedContact = availableContacts.find(
      (contact) => contact.contact_name_id === selectedContactId
    );
    if (!selectedContact) {
      setWatchListError(t('watchList.selectContactToAdd', 'Select a contact to add.'));
      return;
    }

    const normalizedEmail = normalizeEmailAddress(selectedContact?.email);
    if (!normalizedEmail) {
      setWatchListError(t('watchList.selectedContactInvalidEmail', 'Selected contact does not have a valid email address.'));
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
      ? t('watchList.addEmail', 'Add Email')
      : watcherAddMode === 'internal-user'
        ? t('watchList.addUser', 'Add User')
        : t('watchList.addContact', 'Add Contact');

  const getEntityBadgeLabel = (entityType: TicketWatchListEntry['entity_type']) => {
    if (entityType === 'user') {
      return t('watchList.userBadge', 'User');
    }

    if (entityType === 'contact') {
      return t('watchList.contactBadge', 'Contact');
    }

    return entityType;
  };

  return (
    <ContentCard
      id={id}
      collapsible
      defaultExpanded={watchList.length > 0}
      title={t('watchList.title', 'Watch List')}
      headerIcon={<Eye className="w-5 h-5" />}
      count={watchList.length}
    >
      <div className="space-y-3">
        {/* Add watcher section */}
        <Tabs value={watcherAddMode} onValueChange={(value) => handleModeChange(value)}>
          <div className="flex items-center -mx-6 px-6">
            <TabsList className="gap-0 w-full">
              <TabsTrigger value="client-contact" className="px-2 py-1 text-sm" disabled={isWatchListSaving}>
                {t('watchList.tabs.contact', 'Contact')}
              </TabsTrigger>
              <TabsTrigger value="internal-user" className="px-2 py-1 text-sm" disabled={isWatchListSaving}>
                {t('watchList.tabs.internal', 'Internal')}
              </TabsTrigger>
              <TabsTrigger value="email" className="px-2 py-1 text-sm" disabled={isWatchListSaving}>
                {t('watchList.tabs.email', 'Email')}
              </TabsTrigger>
            </TabsList>
            {watcherAddMode === 'client-contact' ? (
              <ViewSwitcher
                currentView={contactScope}
                onChange={(view) => void handleContactScopeChange(view)}
                options={[
                  { value: 'client' as ContactScope, label: t('watchList.scope.ticketClient', 'Ticket client') },
                  { value: 'all' as ContactScope, label: t('watchList.scope.allContacts', 'All contacts') },
                ]}
                className="ml-auto h-7 text-xs flex-shrink-0"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-2 mt-2">
              {watcherAddMode === 'client-contact' ? (
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
                        ? t('watchList.placeholders.loading', 'Loading...')
                        : t('watchList.placeholders.searchAllContacts', 'Search all contacts')
                      : t('watchList.placeholders.selectContact', 'Select contact')
                  }
                  disabled={isWatchListSaving || isContactScopeLoading}
                  buttonWidth="fit"
                  size="sm"
                />
              ) : null}

              {watcherAddMode === 'internal-user' ? (
                teams.length > 0 ? (
                  <UserAndTeamPicker
                    id={`${id}-user-picker`}
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                    onTeamSelect={handleAddTeamMembers}
                    users={filteredInternalUsers}
                    teams={teams}
                    getUserAvatarUrlsBatch={getUserAvatarUrlsBatch}
                    getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatch}
                    placeholder={t('watchList.placeholders.selectUserOrTeam', 'Select user or team')}
                    size="sm"
                    labelStyle="none"
                    buttonWidth="fit"
                    disabled={isWatchListSaving}
                  />
                ) : (
                  <UserPicker
                    id={`${id}-user-picker`}
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                    users={filteredInternalUsers}
                    placeholder={t('watchList.placeholders.selectUser', 'Select user')}
                    size="sm"
                    buttonWidth="fit"
                    disabled={isWatchListSaving}
                  />
                )
              ) : null}

              {watcherAddMode === 'email' ? (
                <Input
                  {...withDataAutomationId({ id: `${id}-email-input` })}
                  value={watchListInput}
                  onChange={(event) => setWatchListInput(event.target.value)}
                  placeholder={t('watchList.placeholders.email', 'name@example.com')}
                  disabled={isWatchListSaving}
                  className="w-auto"
                  onKeyDown={async (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      await handleAddEmailWatcher();
                    }
                  }}
                />
              ) : null}

            <Button
              id={addButtonAutomationId}
              type="button"
              onClick={handleAddCurrentMode}
              disabled={addButtonDisabled}
              size="sm"
              variant="default"
              className="flex-shrink-0 ml-auto"
            >
              {addButtonLabel}
            </Button>
          </div>
        </Tabs>

        {watchListError ? (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            {watchListError}
          </p>
        ) : null}

        {/* Watch list entries */}
        {watchList.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('watchList.empty', 'No watchers added.')}
          </p>
        ) : (
          <div className="space-y-1">
            {watchList.map((entry) => (
              <div
                key={entry.email}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[rgb(var(--color-border-50))] transition-colors"
              >
                <Checkbox
                  checked={entry.active}
                  disabled={isWatchListSaving}
                  onChange={(event) => void handleToggleWatcher(entry.email, event.target.checked)}
                  size="sm"
                  containerClassName=""
                  skipRegistration
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm truncate ${entry.active ? 'text-[rgb(var(--color-text-900))]' : 'text-[rgb(var(--color-text-500))] line-through'}`}>
                      {entry.name || entry.email}
                    </span>
                  {entry.entity_type ? (
                    <Badge variant={entry.entity_type === 'user' ? 'info' : 'secondary'} size="sm">
                        {getEntityBadgeLabel(entry.entity_type)}
                      </Badge>
                    ) : null}
                  </div>
                  {entry.name ? (
                    <span className="text-xs text-[rgb(var(--color-text-400))] truncate block">
                      {entry.email}
                    </span>
                  ) : null}
                </div>
                <Button
                  id={`${id}-remove-btn-${entry.email}`}
                  variant="ghost"
                  size="icon"
                  disabled={isWatchListSaving}
                  onClick={() => void handleRemoveWatcher(entry.email)}
                  aria-label={t('watchList.removeWatcher', 'Remove watcher')}
                  title={t('watchList.removeWatcher', 'Remove watcher')}
                  className="hover:bg-red-50 hover:text-red-600 text-[rgb(var(--color-text-400))]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ContentCard>
  );
};

export default TicketWatchListCard;
