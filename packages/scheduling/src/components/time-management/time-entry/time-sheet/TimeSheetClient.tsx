'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  IExtendedWorkItem,
  ITimeEntry,
  ITimeEntryWithWorkItem,
  ITimeSheetComment,
  ITimeSheetView,
  IUser,
  IUserWithRoles,
} from '@alga-psa/types';
import { saveTimeEntry, fetchOrCreateTimeSheet } from '@alga-psa/scheduling/actions/timeEntryActions';
import { fetchEligibleTimeEntrySubjects } from '@alga-psa/scheduling/actions/timeEntryDelegationActions';
import { fetchTimeSheet, reverseTimeSheetApproval } from '@alga-psa/scheduling/actions/timeSheetActions';
import { TimeSheet } from './TimeSheet';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

interface TimeSheetClientProps {
  timeSheet: ITimeSheetView;
  currentUser: IUserWithRoles;
  isManager: boolean;
  canReopenForEdits: boolean;
  initialEntries: ITimeEntryWithWorkItem[];
  initialWorkItems: IExtendedWorkItem[];
  initialComments: ITimeSheetComment[];
}

export default function TimeSheetClient({
  timeSheet: initialTimeSheet,
  currentUser,
  isManager,
  canReopenForEdits,
  initialEntries,
  initialWorkItems,
  initialComments,
}: TimeSheetClientProps) {
  const { t } = useTranslation('msp/time-entry');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [timeSheet, setTimeSheet] = useState<ITimeSheetView>(initialTimeSheet);
  const [subjectUser, setSubjectUser] = useState<IUser | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  const formatUserName = (u: Pick<IUser, 'first_name' | 'last_name' | 'email'>): string =>
    `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;

  const isDelegated = timeSheet.user_id !== currentUser.user_id;
  const { enabled: delegatedTimeEntryEnabled, loading: delegatedTimeEntryLoading } = useFeatureFlag(
    'delegated-time-entry',
    { defaultValue: false }
  );
  const allowDelegatedEditing = delegatedTimeEntryEnabled && !delegatedTimeEntryLoading;

  useEffect(() => {
    setTimeSheet(initialTimeSheet);
  }, [initialTimeSheet]);

  useEffect(() => {
    const loadSubjectUser = async () => {
      if (!isDelegated || !allowDelegatedEditing) {
        setSubjectUser(currentUser);
        return;
      }

      const subjects = await fetchEligibleTimeEntrySubjects();
      const match = subjects.find((u) => u.user_id === timeSheet.user_id) ?? null;
      setSubjectUser(match);
    };

    void loadSubjectUser();
  }, [allowDelegatedEditing, currentUser, isDelegated, timeSheet.user_id]);

  const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
    if (isDelegated && !allowDelegatedEditing) {
      throw new Error(t('timeSheetClient.errors.delegationDisabled', {
        defaultValue: 'Delegated time entry is disabled'
      }));
    }
    try {
      console.log('Saving time entry:', timeEntry);
      timeEntry.time_sheet_id = timeSheet.id;
      timeEntry.user_id = timeSheet.user_id;
      const savedTimeEntry = await saveTimeEntry(timeEntry);
      console.log('Time entry saved successfully:', savedTimeEntry);

      const updatedTimeSheet = await fetchOrCreateTimeSheet(timeSheet.user_id, timeSheet.period_id);
      setTimeSheet(updatedTimeSheet);
    } catch (error) {
      console.error('Error saving time entry:', error);
      throw error;
    }
  };

  const handleSubmitTimeSheet = async () => {
    router.refresh();
  };

  const openReopenDialog = async () => {
    setIsReopenDialogOpen(true);
  };

  const confirmReopenForEdits = async () => {
    setIsReopening(true);
    try {
      await reverseTimeSheetApproval(timeSheet.id, currentUser.user_id, t('timeSheetClient.reopen.reason', {
        defaultValue: 'Reopened for edits'
      }));
      const updatedTimeSheet = await fetchTimeSheet(timeSheet.id);
      setTimeSheet(updatedTimeSheet);
      setIsReopenDialogOpen(false);
      toast.success(t('timeSheetClient.reopen.success', { defaultValue: 'Time sheet reopened for edits' }));
    } catch (error) {
      handleError(error, t('timeSheetClient.errors.failedReopen', { defaultValue: 'Failed to reopen time sheet' }));
    } finally {
      setIsReopening(false);
    }
  };

  const handleBack = () => {
    const subjectUserIdForBack = searchParams?.get('subjectUserId') ?? (
      timeSheet.user_id !== currentUser.user_id ? timeSheet.user_id : null
    );

    if (subjectUserIdForBack && subjectUserIdForBack !== currentUser.user_id) {
      router.push(`/msp/time-entry?subjectUserId=${encodeURIComponent(subjectUserIdForBack)}`);
      return;
    }

    router.push('/msp/time-entry');
  };

  return (
    <>
      <TimeSheet
        timeSheet={timeSheet}
        initialEntries={initialEntries}
        initialWorkItems={initialWorkItems}
        initialComments={initialComments}
        onSaveTimeEntry={handleSaveTimeEntry}
        isManager={isManager}
        subjectName={allowDelegatedEditing && subjectUser ? formatUserName(subjectUser) : undefined}
        actorName={allowDelegatedEditing ? formatUserName(currentUser) : undefined}
        isDelegated={isDelegated}
        allowDelegatedEditing={allowDelegatedEditing}
        canReopenForEdits={canReopenForEdits}
        onReopenForEdits={openReopenDialog}
        onSubmitTimeSheet={handleSubmitTimeSheet}
        onBack={handleBack}
      />

      {isReopenDialogOpen && (
        <ConfirmationDialog
          id="timesheet-client-reopen-confirmation"
          isOpen={true}
          onClose={() => setIsReopenDialogOpen(false)}
          onConfirm={confirmReopenForEdits}
          title={t('timeSheetClient.reopen.title', { defaultValue: 'Reopen for edits?' })}
          message={t('timeSheetClient.reopen.message', {
            defaultValue: 'This will move the time sheet back to Changes Requested so time entries can be edited.'
          })}
          confirmLabel={t('common.actions.reopen', { defaultValue: 'Reopen' })}
          cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
          isConfirming={isReopening}
        />
      )}
    </>
  );
}
