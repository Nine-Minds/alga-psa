'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ITimeEntry, ITimeSheetView, IUserWithRoles } from '@alga-psa/types';
import { saveTimeEntry, fetchOrCreateTimeSheet } from '@alga-psa/scheduling/actions/timeEntryActions';
import { TimeSheet } from './TimeSheet';

interface TimeSheetClientProps {
  timeSheet: ITimeSheetView;
  currentUser: IUserWithRoles;
  isManager: boolean;
}

export default function TimeSheetClient({ timeSheet: initialTimeSheet, currentUser, isManager }: TimeSheetClientProps) {
  const router = useRouter();
  const [timeSheet, setTimeSheet] = useState<ITimeSheetView>(initialTimeSheet);

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
      onSubmitTimeSheet={handleSubmitTimeSheet}
      onBack={handleBack}
    />
  );
}
