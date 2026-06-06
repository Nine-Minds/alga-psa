'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail, X } from 'lucide-react';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import MultiContactPicker from '@alga-psa/ui/components/MultiContactPicker';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { Tabs, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { GetUserAvatarUrlsBatch } from '@alga-psa/ui/components/UserPicker';
import type { IContact } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';

export interface MeetingAttendee {
  emailAddress: string;
  name?: string;
}

// A default attendee carries an optional contactId so a prefilled contact is pre-selected
// in the contact multiselect. A default without a contactId is treated as the client's
// location email.
export interface DefaultMeetingAttendee extends MeetingAttendee {
  contactId?: string | null;
  avatarUrl?: string | null;
}

type AttendeeSource = 'user' | 'contact' | 'email' | 'client-location';
type AddMode = 'contact' | 'internal-user' | 'email';

interface EmailAttendee {
  emailAddress: string;
  name?: string;
  source: 'email' | 'client-location';
}

interface DisplayRow {
  key: string;
  emailAddress: string;
  name?: string;
  source: AttendeeSource;
  userId?: string;
  contactId?: string;
  avatarUrl?: string | null;
}

interface MeetingAttendeesPickerProps {
  id: string;
  users: IUser[];
  contacts: IContact[];
  clientId?: string | null;
  defaultAttendees?: DefaultMeetingAttendee[];
  getUserAvatarUrlsBatch?: GetUserAvatarUrlsBatch;
  onAttendeesChange: (attendees: MeetingAttendee[]) => void;
  label?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userDisplayName(user: IUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || user.email;
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function MeetingAttendeesPicker({
  id,
  users,
  contacts,
  clientId,
  defaultAttendees,
  getUserAvatarUrlsBatch,
  onAttendeesChange,
  label,
}: MeetingAttendeesPickerProps) {
  const { t } = useTranslation('msp/clients');
  const [mode, setMode] = useState<AddMode>('contact');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [emailAttendees, setEmailAttendees] = useState<EmailAttendee[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [error, setError] = useState('');
  const seededRef = useRef(false);

  // Seed prefilled attendees (attached contact, or client location email) once.
  useEffect(() => {
    if (seededRef.current) return;
    if (!defaultAttendees || defaultAttendees.length === 0) return;

    const contactIds: string[] = [];
    const emails: EmailAttendee[] = [];
    for (const attendee of defaultAttendees) {
      const email = attendee.emailAddress?.trim();
      if (!email) continue;
      if (attendee.contactId) {
        contactIds.push(attendee.contactId);
      } else {
        emails.push({ emailAddress: email, name: attendee.name?.trim() || undefined, source: 'client-location' });
      }
    }

    if (contactIds.length > 0) setSelectedContactIds(contactIds);
    if (emails.length > 0) setEmailAttendees(emails);
    seededRef.current = true;
  }, [defaultAttendees]);

  // Build the consolidated, de-duplicated attendee rows from each source.
  const displayRows = useMemo<DisplayRow[]>(() => {
    const byEmail = new Map<string, DisplayRow>();

    for (const userId of selectedUserIds) {
      const user = users.find((candidate) => candidate.user_id === userId);
      const email = user?.email?.trim();
      if (user && email) {
        byEmail.set(emailKey(email), {
          key: emailKey(email),
          emailAddress: email,
          name: userDisplayName(user),
          source: 'user',
          userId: user.user_id,
        });
      }
    }

    for (const contactId of selectedContactIds) {
      const contact = contacts.find((candidate) => candidate.contact_name_id === contactId);
      const email = contact?.email?.trim();
      if (contact && email) {
        byEmail.set(emailKey(email), {
          key: emailKey(email),
          emailAddress: email,
          name: contact.full_name,
          source: 'contact',
          contactId: contact.contact_name_id,
          avatarUrl: contact.avatarUrl ?? null,
        });
      }
    }

    for (const attendee of emailAttendees) {
      const email = attendee.emailAddress.trim();
      if (email) {
        byEmail.set(emailKey(email), {
          key: emailKey(email),
          emailAddress: email,
          name: attendee.name,
          source: attendee.source,
        });
      }
    }

    return Array.from(byEmail.values());
  }, [selectedUserIds, selectedContactIds, emailAttendees, users, contacts]);

  const resolvedAttendees = useMemo<MeetingAttendee[]>(
    () => displayRows.map((row) => ({ emailAddress: row.emailAddress, name: row.name })),
    [displayRows],
  );

  useEffect(() => {
    onAttendeesChange(resolvedAttendees);
  }, [resolvedAttendees, onAttendeesChange]);

  const usedKeys = useMemo(() => new Set(displayRows.map((row) => row.key)), [displayRows]);

  const handleAddEmail = useCallback(() => {
    const email = emailInput.trim();
    if (!email) return;
    if (!EMAIL_PATTERN.test(email)) {
      setError(t('interactions.quickAdd.teams.attendees.invalidEmail', { defaultValue: 'Enter a valid email address.' }));
      return;
    }
    if (usedKeys.has(emailKey(email))) {
      setError(t('interactions.quickAdd.teams.attendees.duplicateEmail', { defaultValue: 'That email is already on the attendee list.' }));
      setEmailInput('');
      return;
    }
    setEmailAttendees((prev) => [...prev, { emailAddress: email, source: 'email' }]);
    setEmailInput('');
    setError('');
  }, [emailInput, usedKeys, t]);

  const handleRemove = useCallback((row: DisplayRow) => {
    if (row.source === 'user' && row.userId) {
      setSelectedUserIds((prev) => prev.filter((id) => id !== row.userId));
    } else if (row.source === 'contact' && row.contactId) {
      setSelectedContactIds((prev) => prev.filter((id) => id !== row.contactId));
    } else {
      setEmailAttendees((prev) => prev.filter((attendee) => emailKey(attendee.emailAddress) !== row.key));
    }
  }, []);

  const badgeFor = (source: AttendeeSource): { variant: BadgeVariant; label: string } => {
    switch (source) {
      case 'user':
        return { variant: 'info', label: t('interactions.quickAdd.teams.attendees.badge.internal', { defaultValue: 'Internal' }) };
      case 'contact':
        return { variant: 'secondary', label: t('interactions.quickAdd.teams.attendees.badge.contact', { defaultValue: 'Contact' }) };
      case 'client-location':
        return { variant: 'warning', label: t('interactions.quickAdd.teams.attendees.badge.clientLocation', { defaultValue: 'Client location' }) };
      case 'email':
      default:
        return { variant: 'default-muted', label: t('interactions.quickAdd.teams.attendees.badge.email', { defaultValue: 'Email' }) };
    }
  };

  const renderAvatar = (row: DisplayRow) => {
    if (row.source === 'user' && row.userId) {
      return <UserAvatar userId={row.userId} userName={row.name ?? row.emailAddress} avatarUrl={row.avatarUrl ?? null} size="xs" />;
    }
    if (row.source === 'contact' && row.contactId) {
      return <ContactAvatar contactId={row.contactId} contactName={row.name ?? row.emailAddress} avatarUrl={row.avatarUrl ?? null} size="xs" />;
    }
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">
        <Mail className="h-3.5 w-3.5" />
      </span>
    );
  };

  return (
    <div className="space-y-3" id={id}>
      <div className="space-y-1">
        <label className="text-sm font-medium">
          {label ?? t('interactions.quickAdd.teams.attendees.label', { defaultValue: 'Attendees' })}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('interactions.quickAdd.teams.attendees.helper', {
            defaultValue: 'Attendees receive a Teams calendar invite from the meeting organizer.',
          })}
        </p>
      </div>

      <Tabs value={mode} onValueChange={(value) => { setMode(value as AddMode); setError(''); }}>
        <TabsList className="gap-0">
          <TabsTrigger value="contact" className="px-3 py-1 text-sm">
            {t('interactions.quickAdd.teams.attendees.tabs.contacts', { defaultValue: 'Contacts' })}
          </TabsTrigger>
          <TabsTrigger value="internal-user" className="px-3 py-1 text-sm">
            {t('interactions.quickAdd.teams.attendees.tabs.users', { defaultValue: 'Users' })}
          </TabsTrigger>
          <TabsTrigger value="email" className="px-3 py-1 text-sm">
            {t('interactions.quickAdd.teams.attendees.tabs.email', { defaultValue: 'Email' })}
          </TabsTrigger>
        </TabsList>

        <div className="mt-2">
          {mode === 'contact' && (
            <MultiContactPicker
              id={`${id}-contact-picker`}
              contacts={contacts}
              values={selectedContactIds}
              onValuesChange={(next) => { setSelectedContactIds(next); setError(''); }}
              clientId={clientId ?? undefined}
              placeholder={t('interactions.quickAdd.teams.attendees.addContact', { defaultValue: 'Select contacts...' })}
            />
          )}

          {mode === 'internal-user' && (
            <MultiUserPicker
              id={`${id}-user-picker`}
              values={selectedUserIds}
              onValuesChange={(next) => { setSelectedUserIds(next); setError(''); }}
              users={users}
              getUserAvatarUrlsBatch={getUserAvatarUrlsBatch}
              placeholder={t('interactions.quickAdd.teams.attendees.addUser', { defaultValue: 'Select internal users...' })}
            />
          )}

          {mode === 'email' && (
            <div className="flex items-center gap-2">
              <Input
                id={`${id}-custom-email-input`}
                type="email"
                value={emailInput}
                onChange={(event) => { setEmailInput(event.target.value); if (error) setError(''); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAddEmail();
                  }
                }}
                placeholder={t('interactions.quickAdd.teams.attendees.emailPlaceholder', { defaultValue: 'name@example.com' })}
              />
              <Button
                id={`${id}-add-email`}
                type="button"
                variant="default"
                size="sm"
                onClick={handleAddEmail}
                disabled={!emailInput.trim()}
                className="flex-shrink-0"
              >
                {t('interactions.quickAdd.teams.attendees.add', { defaultValue: 'Add' })}
              </Button>
            </div>
          )}
        </div>
      </Tabs>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {displayRows.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('interactions.quickAdd.teams.attendees.empty', { defaultValue: 'No attendees added yet.' })}
        </p>
      ) : (
        <div className="space-y-1">
          {displayRows.map((row) => {
            const badge = badgeFor(row.source);
            return (
              <div key={row.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[rgb(var(--color-border-50))]">
                {renderAvatar(row)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-[rgb(var(--color-text-900))]">
                      {row.name || row.emailAddress}
                    </span>
                    <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                  </div>
                  {row.name && (
                    <span className="block truncate text-xs text-[rgb(var(--color-text-400))]">{row.emailAddress}</span>
                  )}
                </div>
                <button
                  type="button"
                  id={`${id}-remove-${row.key}`}
                  aria-label={t('interactions.quickAdd.teams.attendees.remove', {
                    defaultValue: 'Remove {{name}}',
                    name: row.name || row.emailAddress,
                  })}
                  onClick={() => handleRemove(row)}
                  className="text-gray-500 hover:text-gray-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MeetingAttendeesPicker;
