'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import type { IUserWithRoles, ITeam } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';

type BulkAssignSelection =
  | { kind: 'user'; userId: string | null }
  | { kind: 'team'; teamId: string };

interface BulkAssignDialogProps {
  isOpen: boolean;
  onClose: () => void;
  taskCount: number;
  users: IUserWithRoles[];
  teams: ITeam[];
  onConfirm: (selection: BulkAssignSelection) => Promise<void>;
}

export default function BulkAssignDialog({
  isOpen,
  onClose,
  taskCount,
  users,
  teams,
  onConfirm,
}: BulkAssignDialogProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [pickerValue, setPickerValue] = useState<string>('');
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPickerValue('');
      setPendingTeamId(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Only teams with a lead can be assigned — assignTeamToProjectTask requires
  // a manager to fall back to as primary assignee for tasks with no assignee.
  const assignableTeams = teams.filter((team) => !!team.manager_id);

  const handleUserChange = (value: string) => {
    setPickerValue(value);
    setPendingTeamId(null);
  };

  const handleTeamSelect = (teamId: string) => {
    setPendingTeamId(teamId);
    setPickerValue(teamId);
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      if (pendingTeamId) {
        await onConfirm({ kind: 'team', teamId: pendingTeamId });
      } else {
        await onConfirm({ kind: 'user', userId: pickerValue || null });
      }
    } catch (error) {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('dialogs.bulkAssign.title', 'Assign Tasks')}
      className="max-w-md"
    >
      <DialogContent>
        <div className="mb-3 text-sm text-gray-600">
          {t('dialogs.bulkAssign.message', 'Assign {{count}} selected task(s) to:', { count: taskCount })}
        </div>

        <div className="mb-3">
          <UserAndTeamPicker
            value={pickerValue}
            onValueChange={handleUserChange}
            onTeamSelect={handleTeamSelect}
            users={users}
            teams={assignableTeams}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
            buttonWidth="full"
            labelStyle="none"
            placeholder={t('dialogs.bulkAssign.unassigned', 'Not assigned')}
          />
        </div>

        {pendingTeamId && (
          <p className="mb-6 text-xs text-gray-500">
            {t(
              'dialogs.bulkAssign.teamReplaceNotice',
              'Tasks already assigned to a different team will have that team replaced.',
            )}
          </p>
        )}

        <div className="flex justify-end space-x-2">
          <Button id="cancel-bulk-assign-button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button id="confirm-bulk-assign-button" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting
              ? t('dialogs.bulkAssign.assigning', 'Assigning...')
              : t('dialogs.bulkAssign.confirm', 'Assign Tasks')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
