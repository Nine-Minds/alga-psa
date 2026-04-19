'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDown, Search, X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAllUsersBasic, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getQuoteRecipientContacts } from '../../../actions/quoteRecipientActions';
import type { IContact, IUser } from '@alga-psa/types';

export type QuoteRecipient = {
  key: string;
  email: string;
  name: string;
  kind: 'internal' | 'contact';
  entityId: string;
  avatarUrl: string | null;
};

interface QuoteSendRecipientsFieldProps {
  clientId: string | null | undefined;
  value: QuoteRecipient[];
  onChange: (next: QuoteRecipient[]) => void;
  disabled?: boolean;
  id: string;
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

function buildUserName(user: IUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || user.email;
}

type PickerRow = {
  key: string;
  email: string;
  name: string;
  kind: 'internal' | 'contact';
  entityId: string;
  avatarUrl: string | null;
  searchText: string;
};

export function QuoteSendRecipientsField({
  clientId,
  value,
  onChange,
  disabled,
  id,
}: QuoteSendRecipientsFieldProps): React.JSX.Element {
  const { t } = useTranslation('msp/quotes');
  const [internalUsers, setInternalUsers] = useState<IUser[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [userAvatarUrls, setUserAvatarUrls] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getAllUsersBasic(false, 'internal')
      .then((users) => {
        if (cancelled) return;
        setInternalUsers(Array.isArray(users) ? users : []);
      })
      .catch(() => {
        if (!cancelled) setInternalUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!clientId) {
      setContacts([]);
      return;
    }
    getQuoteRecipientContacts(clientId, 'active')
      .then((rows) => {
        if (cancelled) return;
        setContacts(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Batch-fetch avatar URLs for internal users (contacts already carry avatarUrl from hydration).
  useEffect(() => {
    if (internalUsers.length === 0) return;
    const tenant = internalUsers[0]?.tenant;
    if (!tenant) return;

    const idsToFetch = internalUsers
      .map((u) => u.user_id)
      .filter((uid) => userAvatarUrls[uid] === undefined);

    if (idsToFetch.length === 0) return;

    let cancelled = false;
    getUserAvatarUrlsBatchAction(idsToFetch, tenant)
      .then((map) => {
        if (cancelled) return;
        const next: Record<string, string | null> = {};
        for (const uid of idsToFetch) next[uid] = map.get(uid) ?? null;
        setUserAvatarUrls((prev) => ({ ...prev, ...next }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [internalUsers]);

  const getPortalContainer = useCallback((): Element => {
    const trigger = triggerRef.current;
    const dialog = trigger?.closest?.('[role="dialog"]');
    return (dialog as Element) ?? document.body;
  }, []);

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const container = getPortalContainer();
    if (container === document.body) {
      setDropdownCoords({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
      return;
    }
    const containerRect = container.getBoundingClientRect();
    setDropdownCoords({
      top: rect.bottom - containerRect.top + 4,
      left: rect.left - containerRect.left,
      width: rect.width,
    });
  }, [getPortalContainer]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideTrigger && !insideDropdown) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  // Reposition dropdown on open, scroll, resize
  useEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    const handle = () => updateDropdownPosition();
    window.addEventListener('resize', handle);
    window.addEventListener('scroll', handle, true);
    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('scroll', handle, true);
    };
  }, [open, updateDropdownPosition]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchInputRef.current?.focus(), 10);
    else setSearch('');
  }, [open]);

  const rows = useMemo<PickerRow[]>(() => {
    const selectedKeys = new Set(value.map((r) => r.key));
    const result: PickerRow[] = [];

    for (const user of internalUsers) {
      const email = (user.email || '').trim();
      if (!email) continue;
      const key = emailKey(email);
      if (selectedKeys.has(key)) continue;
      const name = buildUserName(user);
      result.push({
        key,
        email,
        name,
        kind: 'internal',
        entityId: user.user_id,
        avatarUrl: userAvatarUrls[user.user_id] ?? null,
        searchText: `${name} ${email}`.toLowerCase(),
      });
    }

    for (const contact of contacts) {
      const email = (contact.email || '').trim();
      if (!email) continue;
      const key = emailKey(email);
      if (selectedKeys.has(key)) continue;
      const name = contact.full_name || email;
      result.push({
        key,
        email,
        name,
        kind: 'contact',
        entityId: contact.contact_name_id,
        avatarUrl: contact.avatarUrl ?? null,
        searchText: `${name} ${email}`.toLowerCase(),
      });
    }

    return result;
  }, [internalUsers, contacts, userAvatarUrls, value]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.searchText.includes(query));
  }, [rows, search]);

  const addRecipient = (row: PickerRow) => {
    if (value.some((r) => r.key === row.key)) return;
    onChange([
      ...value,
      {
        key: row.key,
        email: row.email,
        name: row.name,
        kind: row.kind,
        entityId: row.entityId,
        avatarUrl: row.avatarUrl,
      },
    ]);
  };

  const removeRecipient = (key: string) => {
    onChange(value.filter((r) => r.key !== key));
  };

  const triggerLabel = !clientId
    ? t('quoteRecipients.trigger.noClient', { defaultValue: 'Select a client first' })
    : rows.length === 0
      ? t('quoteRecipients.trigger.noneAvailable', { defaultValue: 'No users or contacts available' })
      : t('quoteRecipients.trigger.add', { defaultValue: 'Add internal user or client contact...' });

  const portalContainer = typeof document !== 'undefined' && open ? getPortalContainer() : null;
  const dropdownPositionStyle: React.CSSProperties = portalContainer === document.body
    ? { position: 'fixed' }
    : { position: 'absolute' };

  const dropdownContent = open && !disabled && clientId && dropdownCoords ? (
    <div
      ref={dropdownRef}
      className="z-[10000] rounded-md border border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] shadow-lg"
      style={{
        ...dropdownPositionStyle,
        top: `${dropdownCoords.top}px`,
        left: `${dropdownCoords.left}px`,
        width: `${dropdownCoords.width}px`,
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center border-b border-[rgb(var(--color-border-200))] px-3 py-2">
        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        <Input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('quoteRecipients.searchPlaceholder', {
            defaultValue: 'Search by name or email...',
          })}
          className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </div>
      <div className="max-h-60 overflow-y-auto p-1">
        {filteredRows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? t('quoteRecipients.empty.noneAvailable', { defaultValue: 'No recipients available' })
              : t('quoteRecipients.empty.noMatches', { defaultValue: 'No matches' })}
          </div>
        ) : (
          filteredRows.map((row) => (
            <button
              key={`${row.kind}:${row.key}`}
              type="button"
              onClick={() => {
                addRecipient(row);
                setSearch('');
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-[rgb(var(--color-border-100))] dark:hover:bg-[rgb(var(--color-border-200))] focus:bg-[rgb(var(--color-border-100))] dark:focus:bg-[rgb(var(--color-border-200))] focus:outline-none"
            >
              {row.kind === 'internal' ? (
                <UserAvatar
                  userId={row.entityId}
                  userName={row.name}
                  avatarUrl={row.avatarUrl}
                  size="sm"
                />
              ) : (
                <ContactAvatar
                  contactId={row.entityId}
                  contactName={row.name}
                  avatarUrl={row.avatarUrl}
                  size="sm"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{row.name}</div>
                <div className="truncate text-xs text-muted-foreground">{row.email}</div>
              </div>
              <span className="shrink-0 rounded-full bg-[rgb(var(--color-border-100))] dark:bg-[rgb(var(--color-border-200))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {row.kind === 'internal'
                  ? t('quoteRecipients.kind.internal', { defaultValue: 'Internal' })
                  : t('quoteRecipients.kind.contact', { defaultValue: 'Contact' })}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-2">
      <Button
        id={id}
        ref={triggerRef}
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        disabled={disabled || !clientId}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full justify-between h-10"
      >
        <span className="truncate text-muted-foreground">{triggerLabel}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {dropdownContent && portalContainer && createPortal(dropdownContent, portalContainer)}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((r) => (
            <span
              key={r.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-2 text-xs text-foreground"
              title={r.email}
            >
              {r.kind === 'internal' ? (
                <UserAvatar
                  userId={r.entityId}
                  userName={r.name}
                  avatarUrl={r.avatarUrl}
                  size="xs"
                />
              ) : (
                <ContactAvatar
                  contactId={r.entityId}
                  contactName={r.name}
                  avatarUrl={r.avatarUrl}
                  size="xs"
                />
              )}
              <span className="max-w-[12rem] truncate">{r.name}</span>
              <button
                type="button"
                aria-label={t('quoteRecipients.removeAriaLabel', {
                  email: r.email,
                  defaultValue: 'Remove {{email}}',
                })}
                onClick={() => removeRecipient(r.key)}
                disabled={disabled}
                className="ml-0.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
