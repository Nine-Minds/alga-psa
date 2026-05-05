'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';

export type RemoveTeamMode = 'remove_all' | 'keep_all' | 'selective';

interface TeamMember {
  additional_user_id: string;
}

interface UserShape {
  user_id: string;
  first_name?: string;
  last_name?: string;
}

interface RemoveTeamDialogProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  /** True when assigning a different team over an existing one. False when just removing. */
  isSwitching: boolean;
  /** Existing role='team_member' resources on the task. */
  teamMembers: TeamMember[];
  /** Users available for name resolution in the selective list. */
  users: UserShape[];
  onConfirm: (mode: RemoveTeamMode, keepUserIds?: string[]) => Promise<void> | void;
}

const MODE_KEYS: Record<RemoveTeamMode, { key: string; fallback: string }> = {
  remove_all: { key: 'removeTeamMode.removeAll', fallback: 'Remove all team members' },
  keep_all: { key: 'removeTeamMode.keepAll', fallback: 'Keep all team members as individual agents' },
  selective: { key: 'removeTeamMode.selective', fallback: 'Select individual members to keep/remove' },
};

export const RemoveTeamDialog: React.FC<RemoveTeamDialogProps> = ({
  id = 'remove-team-dialog',
  isOpen,
  onClose,
  isSwitching,
  teamMembers,
  users,
  onConfirm,
}) => {
  const { t } = useTranslation(['features/projects', 'common']);
  const tr = (key: string, fallback: string) =>
    t(`taskForm.${key}`, { defaultValue: fallback });

  const [mode, setMode] = useState<RemoveTeamMode>('remove_all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode('remove_all');
    setSelectedIds(
      teamMembers.map(m => m.additional_user_id).filter(Boolean) as string[]
    );
  }, [isOpen, teamMembers]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(mode, mode === 'selective' ? selectedIds : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={submitting ? () => {} : onClose}
      title={isSwitching
        ? tr('switchTeamAssignment', 'Switch team assignment')
        : tr('removeTeamAssignment', 'Remove team assignment')}
      id={id}
      footer={
        <div className="flex justify-end space-x-2">
          <Button
            id={`${id}-cancel`}
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id={`${id}-confirm`}
            variant="default"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {t('actions.confirm', { defaultValue: 'Confirm' })}
          </Button>
        </div>
      }
    >
      <DialogContent className="space-y-4">
        <RadioGroup
          name={`${id}-mode`}
          id={`${id}-mode`}
          value={mode}
          onChange={(value) => setMode(value as RemoveTeamMode)}
          disabled={submitting}
          options={(Object.keys(MODE_KEYS) as RemoveTeamMode[]).map(opt => ({
            value: opt,
            label: tr(MODE_KEYS[opt].key, MODE_KEYS[opt].fallback),
          }))}
        />
        {mode === 'selective' && (
          <div className="space-y-2 border border-gray-100 rounded p-3">
            <div className="text-xs text-gray-500">
              {tr(
                'removeTeamMode.selectiveHint',
                'Check members to keep on the task as individual agents. Unchecked members will be removed.'
              )}
            </div>
            {teamMembers.length === 0 ? (
              <div className="text-sm text-gray-500">
                {tr('noTeamMembersFound', 'No team members found on this task.')}
              </div>
            ) : (
              teamMembers.map(member => {
                const memberId = member.additional_user_id;
                const u = users.find(x => x.user_id === memberId);
                const name = u
                  ? `${u.first_name || ''} ${u.last_name || ''}`.trim() ||
                    tr('unnamedUser', 'Unnamed User')
                  : memberId;
                return (
                  <label key={memberId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${id}-member-${memberId}`}
                      checked={selectedIds.includes(memberId)}
                      onChange={() => {
                        setSelectedIds(prev =>
                          prev.includes(memberId)
                            ? prev.filter(x => x !== memberId)
                            : [...prev, memberId]
                        );
                      }}
                      disabled={submitting}
                    />
                    <span>{name}</span>
                  </label>
                );
              })
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RemoveTeamDialog;
