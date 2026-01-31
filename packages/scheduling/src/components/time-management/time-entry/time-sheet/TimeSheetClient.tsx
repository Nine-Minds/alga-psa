'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ITimeEntry, ITimeSheetView, IUser, IUserWithRoles } from '@alga-psa/types';
import { saveTimeEntry, fetchOrCreateTimeSheet } from '@alga-psa/scheduling/actions/timeEntryActions';
import { fetchEligibleTimeEntrySubjects } from '@alga-psa/scheduling/actions/timeEntryDelegationActions';
import { fetchTimeSheet, reverseTimeSheetApproval } from '@alga-psa/scheduling/actions/timeSheetActions';
import { TimeSheet } from './TimeSheet';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';

interface TimeSheetClientProps {
  timeSheet: ITimeSheetView;
  currentUser: IUserWithRoles;
  isManager: boolean;
  canReopenForEdits: boolean;
}

export default function TimeSheetClient({ timeSheet: initialTimeSheet, currentUser, isManager, canReopenForEdits }: TimeSheetClientProps) {
  const router = useRouter();
  const [timeSheet, setTimeSheet] = useState<ITimeSheetView>(initialTimeSheet);
  const [subjectUser, setSubjectUser] = useState<IUser | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  const formatUserName = (u: Pick<IUser, 'first_name' | 'last_name' | 'email'>): string =>
    `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;

  const isDelegated = timeSheet.user_id !== currentUser.user_id;

  useEffect(() => {
    const loadSubjectUser = async () => {
      if (!isDelegated) {
        setSubjectUser(currentUser);
        return;
      }

      const subjects = await fetchEligibleTimeEntrySubjects();
      const match = subjects.find((u) => u.user_id === timeSheet.user_id) ?? null;
      setSubjectUser(match);
    };

    void loadSubjectUser();
  }, [currentUser, isDelegated, timeSheet.user_id]);

  const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
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
      await reverseTimeSheetApproval(timeSheet.id, currentUser.user_id, 'Reopened for edits');
      const updatedTimeSheet = await fetchTimeSheet(timeSheet.id);
      setTimeSheet(updatedTimeSheet);
      setIsReopenDialogOpen(false);
      toast.success('Time sheet reopened for edits');
    } catch (error) {
      console.error('Error reopening time sheet:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to reopen time sheet');
    } finally {
      setIsReopening(false);
    }
  };

  const handleBack = () => {
    router.push('/msp/time-entry');
  };

  return (
    <>
      <TimeSheet
        timeSheet={timeSheet}
        onSaveTimeEntry={handleSaveTimeEntry}
        isManager={isManager}
        subjectName={subjectUser ? formatUserName(subjectUser) : timeSheet.user_id}
        actorName={formatUserName(currentUser)}
        isDelegated={isDelegated}
        canReopenForEdits={canReopenForEdits}
        onReopenForEdits={openReopenDialog}
        onSubmitTimeSheet={handleSubmitTimeSheet}
        onBack={handleBack}
      />

      <ConfirmationDialog
        isOpen={isReopenDialogOpen}
        onClose={() => setIsReopenDialogOpen(false)}
        onConfirm={confirmReopenForEdits}
        title="Reopen for edits?"
        message="This will move the time sheet back to Changes Requested so time entries can be edited."
        confirmLabel="Reopen"
        cancelLabel="Cancel"
        isConfirming={isReopening}
      />
    </>
  );
}
