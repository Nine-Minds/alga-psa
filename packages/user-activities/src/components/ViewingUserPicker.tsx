'use client';

import React from 'react';
import type { IUser } from '@alga-psa/types';
import { Label } from '@alga-psa/ui/components/Label';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ViewingUserPickerProps {
  id: string;
  /** '' = myself. */
  value: string;
  onChange: (userId: string) => void;
  users: IUser[];
  className?: string;
}

/** "Viewing: [user]" selector shared by the table and cards views. */
export function ViewingUserPicker({ id, value, onChange, users, className }: ViewingUserPickerProps) {
  const { t } = useTranslation('msp/user-activities');
  return (
    <div className={className ?? 'flex items-center gap-2'}>
      <Label htmlFor={id} className="text-sm font-medium whitespace-nowrap mb-0">
        {t('table.viewingUser.label', { defaultValue: 'Viewing:' })}
      </Label>
      <UserPicker
        id={id}
        value={value}
        onValueChange={onChange}
        users={users}
        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
        userTypeFilter="internal"
        placeholder={t('table.viewingUser.me', { defaultValue: 'My activities' })}
        unassignedLabel={t('table.viewingUser.me', { defaultValue: 'My activities' })}
        buttonWidth="fit"
        size="sm"
      />
    </div>
  );
}
