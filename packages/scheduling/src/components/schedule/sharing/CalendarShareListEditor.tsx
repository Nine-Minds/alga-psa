'use client'

import React, { useState } from 'react';
import { Trash2, Users, User } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CalendarAccessLevel, ICalendarShareView, ITeam, IUser } from '@alga-psa/types';

interface CalendarShareListEditorProps {
  id: string;
  shares: ICalendarShareView[];
  onChange: (shares: ICalendarShareView[]) => void;
  levels: CalendarAccessLevel[];
  defaultLevel: CalendarAccessLevel;
  users: IUser[];
  teams: ITeam[];
  /** Users that cannot be added (e.g. the calendar owner). */
  excludeUserIds?: string[];
  disabled?: boolean;
}

export function useAccessLevelLabel() {
  const { t } = useTranslation('msp/schedule');
  return (level: CalendarAccessLevel) => {
    switch (level) {
      case 'free_busy':
        return t('sharing.levels.freeBusy', { defaultValue: 'Free/busy' });
      case 'read':
        return t('sharing.levels.read', { defaultValue: 'View details' });
      case 'edit':
        return t('sharing.levels.edit', { defaultValue: 'Edit' });
      case 'manage':
        return t('sharing.levels.manage', { defaultValue: 'Manage' });
      default:
        return level;
    }
  };
}

/** Editable list of calendar shares with an add-recipient picker. */
const CalendarShareListEditor: React.FC<CalendarShareListEditorProps> = ({
  id,
  shares,
  onChange,
  levels,
  defaultLevel,
  users,
  teams,
  excludeUserIds = [],
  disabled = false,
}) => {
  const { t } = useTranslation('msp/schedule');
  const levelLabel = useAccessLevelLabel();
  const [pickerValue, setPickerValue] = useState('');

  const levelOptions = levels.map((level) => ({ value: level, label: levelLabel(level) }));
  const sharedUserIds = new Set(shares.filter((s) => s.grantee_type === 'user').map((s) => s.grantee_id));
  const sharedTeamIds = new Set(shares.filter((s) => s.grantee_type === 'team').map((s) => s.grantee_id));
  const availableUsers = users.filter(
    (user) => user.user_type === 'internal' && !user.is_inactive &&
      !sharedUserIds.has(user.user_id) && !excludeUserIds.includes(user.user_id)
  );
  const availableTeams = teams.filter((team) => !sharedTeamIds.has(team.team_id));

  const addShare = (granteeType: 'user' | 'team', granteeId: string) => {
    if (!granteeId) return;
    const name = granteeType === 'user'
      ? (() => {
          const user = users.find((u) => u.user_id === granteeId);
          return user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() : '';
        })()
      : teams.find((team) => team.team_id === granteeId)?.team_name ?? '';
    onChange([
      ...shares,
      { grantee_type: granteeType, grantee_id: granteeId, grantee_name: name, access_level: defaultLevel },
    ]);
    setPickerValue('');
  };

  return (
    <div className="space-y-3">
      <UserAndTeamPicker
        id={`${id}-add-recipient`}
        value={pickerValue}
        onValueChange={(userId) => addShare('user', userId)}
        onTeamSelect={(teamId) => addShare('team', teamId)}
        users={availableUsers}
        teams={availableTeams}
        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
        buttonWidth="full"
        labelStyle="none"
        placeholder={t('sharing.addRecipient', { defaultValue: 'Add a person or team' })}
        disabled={disabled}
        modal
      />

      {shares.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('sharing.noRecipients', { defaultValue: 'Not shared with anyone yet.' })}
        </p>
      ) : (
        <ul className="divide-y divide-[rgb(var(--color-border-200))] border border-[rgb(var(--color-border-200))] rounded-md">
          {shares.map((share) => {
            const key = `${share.grantee_type}:${share.grantee_id}`;
            return (
              <li key={key} className="flex items-center gap-2 px-3 py-2">
                {share.grantee_type === 'team'
                  ? <Users className="h-4 w-4 flex-shrink-0 text-[rgb(var(--color-text-500))]" aria-hidden />
                  : <User className="h-4 w-4 flex-shrink-0 text-[rgb(var(--color-text-500))]" aria-hidden />}
                <span className="flex-1 truncate text-sm">
                  {share.grantee_name ||
                    t('sharing.unknownRecipient', { defaultValue: 'Unknown recipient' })}
                </span>
                <CustomSelect
                  id={`${id}-level-${share.grantee_id}`}
                  className="w-40"
                  size="sm"
                  options={levelOptions}
                  value={share.access_level}
                  onValueChange={(value) =>
                    onChange(shares.map((s) =>
                      `${s.grantee_type}:${s.grantee_id}` === key
                        ? { ...s, access_level: value as CalendarAccessLevel }
                        : s
                    ))
                  }
                  disabled={disabled}
                  modal
                />
                <Button
                  id={`${id}-remove-${share.grantee_id}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(shares.filter((s) => `${s.grantee_type}:${s.grantee_id}` !== key))}
                  disabled={disabled}
                  aria-label={t('sharing.removeRecipient', {
                    defaultValue: 'Remove {{name}}',
                    name: share.grantee_name,
                  })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CalendarShareListEditor;
