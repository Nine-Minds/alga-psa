'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ITimeEntry, ITimeSheetView, IUser, IUserWithRoles } from '@alga-psa/types';
import { saveTimeEntry, fetchOrCreateTimeSheet } from '@alga-psa/scheduling/actions/timeEntryActions';
import { fetchEligibleTimeEntrySubjects } from '@alga-psa/scheduling/actions/timeEntryDelegationActions';
import { TimeSheet } from './TimeSheet';

interface TimeSheetClientProps {
  timeSheet: ITimeSheetView;
  currentUser: IUserWithRoles;
  isManager: boolean;
}

export default function TimeSheetClient({ timeSheet: initialTimeSheet, currentUser, isManager }: TimeSheetClientProps) {
  const router = useRouter();
  const [timeSheet, setTimeSheet] = useState<ITimeSheetView>(initialTimeSheet);
  const [subjectUser, setSubjectUser] = useState<IUser | null>(null);

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

  const handleBack = () => {
    router.push('/msp/time-entry');
  };

  return (
    <TimeSheet
      timeSheet={timeSheet}
      onSaveTimeEntry={handleSaveTimeEntry}
      isManager={isManager}
      subjectName={subjectUser ? formatUserName(subjectUser) : timeSheet.user_id}
      actorName={formatUserName(currentUser)}
      isDelegated={isDelegated}
      onSubmitTimeSheet={handleSubmitTimeSheet}
      onBack={handleBack}
    />
  );
}
