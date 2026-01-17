'use client';

import { useRouter } from 'next/navigation';
import { TimeSheet } from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeSheet';
import { ITimeSheetView, ITimeEntry } from 'server/src/interfaces/timeEntry.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { saveTimeEntry } from '@alga-psa/scheduling/actions/timeEntryActions';
import { fetchOrCreateTimeSheet } from '@alga-psa/scheduling/actions/timeEntryActions';
import { useState } from 'react';

interface TimeSheetClientProps {
  timeSheet: ITimeSheetView;
  currentUser: IUserWithRoles;
  isManager: boolean;
}

export default function TimeSheetClient({ 
  timeSheet: initialTimeSheet, 
  currentUser, 
  isManager 
}: TimeSheetClientProps) {
  const router = useRouter();
  const [timeSheet, setTimeSheet] = useState<ITimeSheetView>(initialTimeSheet);

  const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
    try {
      console.log('Saving time entry:', timeEntry);
      timeEntry.time_sheet_id = timeSheet.id;
      const savedTimeEntry = await saveTimeEntry(timeEntry);
      console.log('Time entry saved successfully:', savedTimeEntry);

      // Refresh the time sheet
      const updatedTimeSheet = await fetchOrCreateTimeSheet(currentUser.user_id, timeSheet.period_id);
      setTimeSheet(updatedTimeSheet);
    } catch (error) {
      console.error('Error saving time entry:', error);
      throw error;
    }
  };

  const handleSubmitTimeSheet = async () => {
    // Implement submit logic
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
