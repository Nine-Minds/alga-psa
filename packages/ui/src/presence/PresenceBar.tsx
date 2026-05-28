'use client';

import React from 'react';
import AvatarIcon from '../components/AvatarIcon';
import { useTranslation } from '../lib/i18n/client';

export interface PresenceBarUser {
  id: string;
  name: string;
  color?: string;
  avatarUrl?: string | null;
}

interface PresenceBarProps {
  users: PresenceBarUser[];
  emptyText?: string;
  showNames?: boolean;
  className?: string;
}

function parseName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: 'User', lastName: '' };
  }

  return {
    firstName: parts[0] || 'User',
    lastName: parts.slice(1).join(' '),
  };
}

export function dedupePresenceUsers(users: PresenceBarUser[]): PresenceBarUser[] {
  const seen = new Set<string>();

  return users.filter((user) => {
    if (!user?.id || seen.has(user.id)) {
      return false;
    }

    seen.add(user.id);
    return true;
  });
}

export function PresenceBar({
  users,
  emptyText,
  showNames = false,
  className = '',
}: PresenceBarProps) {
  const { t } = useTranslation('common');
  const dedupedUsers = dedupePresenceUsers(users);
  const fallbackEmptyText = emptyText ?? t('presence.noOneElseEditing', 'No one else is editing');

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
      {dedupedUsers.length === 0 ? (
        <span className="text-sm text-gray-500" data-testid="presence-empty">
          {fallbackEmptyText}
        </span>
      ) : (
        dedupedUsers.map((user) => {
          const { firstName, lastName } = parseName(user.name);

          return (
            <div
              key={user.id}
              className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700"
              data-testid="presence-user"
              title={user.name}
            >
              <AvatarIcon userId={user.id} firstName={firstName} lastName={lastName} size="xs" />
              {showNames ? <span>{user.name}</span> : null}
            </div>
          );
        })
      )}
    </div>
  );
}
