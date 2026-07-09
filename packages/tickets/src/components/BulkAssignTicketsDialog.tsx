'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeams, getTeamAvatarUrlsBatchAction, isTeamActionError, teamActionErrorMessage } from '@alga-psa/teams/actions';
import type { IUser, ITeam } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';
import type { BulkTicketAssignSelection } from '../actions/ticketActions';
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from './ticket/TicketNotificationSuppressionControl';

interface BulkAssignTicketsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  ticketCount: number;
  users: IUser[];
  failed: Array<{ ticketId: string; message: string; label?: string }>;
  isSubmitting: boolean;
  onConfirm: (
    selection: BulkTicketAssignSelection,
    options?: TicketNotificationSuppressionValue
  ) => Promise<void>;
  idPrefix?: string;
}

export default function BulkAssignTicketsDialog({
  isOpen,
  onClose,
  ticketCount,
  users,
  failed,
  isSubmitting,
  onConfirm,
  idPrefix = 'ticket-bulk-assign',
}: BulkAssignTicketsDialogProps) {
  const { t } = useTranslation(['features/tickets', 'common']);
  const [pickerValue, setPickerValue] = useState<string>('');
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const [teamsLoadError, setTeamsLoadError] = useState<string | null>(null);
  const [notificationSuppression, setNotificationSuppression] = useState<TicketNotificationSuppressionValue>({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  });

  useEffect(() => {
    if (!isOpen) return;
    setPickerValue('');
    setPendingTeamId(null);
    setTeamsLoadError(null);
    setNotificationSuppression({
      suppressContactNotifications: false,
      suppressInternalNotifications: false,
    });
    let cancelled = false;
    setIsLoadingTeams(true);
    getTeams()
      .then((fetched) => {
        if (cancelled) return;
        if (isTeamActionError(fetched)) {
          setTeams([]);
          setTeamsLoadError(teamActionErrorMessage(fetched));
          return;
        }
        setTeams(fetched);
      })
      .catch((error) => {
        console.error('[BulkAssignTicketsDialog] Failed to load teams:', error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTeams(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

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
    const options = notificationSuppression.suppressContactNotifications ? notificationSuppression : undefined;
    if (pendingTeamId) {
      await (options
        ? onConfirm({ kind: 'team', teamId: pendingTeamId }, options)
        : onConfirm({ kind: 'team', teamId: pendingTeamId }));
    } else {
      await (options
        ? onConfirm({ kind: 'user', userId: pickerValue || null }, options)
        : onConfirm({ kind: 'user', userId: pickerValue || null }));
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={t('bulk.assign.dialogTitle', 'Assign Selected Tickets')}
      className="max-w-md"
    >
      <DialogContent>
        {failed.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('bulk.assign.failedHeading', 'The following tickets could not be reassigned:')}
              </p>
              <ul className="mt-2 space-y-1">
                {failed.map((error) => (
                  <li key={error.ticketId}>
                    <span className="font-medium">{error.label ?? error.ticketId}</span>: {error.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {teamsLoadError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{teamsLoadError}</AlertDescription>
          </Alert>
        )}
        <div className="mb-3 text-sm text-gray-600">
          {t('bulk.assign.message', 'Reassign {{count}} selected ticket(s) to:', { count: ticketCount })}
        </div>
        <div className="mb-3">
          <UserAndTeamPicker
            id={`${idPrefix}-picker`}
            value={pickerValue}
            onValueChange={handleUserChange}
            onTeamSelect={handleTeamSelect}
            users={users}
            teams={assignableTeams}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
            buttonWidth="full"
            labelStyle="none"
            placeholder={t('bulk.assign.unassigned', 'Not assigned')}
            disabled={isLoadingTeams || isSubmitting}
          />
        </div>
        {pendingTeamId && (
          <p className="mb-6 text-xs text-gray-500">
            {t(
              'bulk.assign.teamHint',
              'The team lead becomes the primary assignee; other team members are added as additional agents.',
            )}
          </p>
        )}
        <div className="mb-4">
          <TicketNotificationSuppressionControl
            idPrefix={`${idPrefix}-notification-suppression`}
            value={notificationSuppression}
            onChange={setNotificationSuppression}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex justify-end space-x-2">
          <Button id={`${idPrefix}-cancel`} variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button id={`${idPrefix}-confirm`} onClick={handleConfirm} disabled={isSubmitting || isLoadingTeams}>
            {isSubmitting
              ? t('bulk.assign.submitting', 'Reassigning...')
              : t('bulk.assign.confirm', {
                  count: ticketCount,
                  defaultValue: ticketCount === 1 ? 'Reassign {{count}} Ticket' : 'Reassign {{count}} Tickets',
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
