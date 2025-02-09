// src/components/TimeTracking.tsx
'use client';

import { useState, useEffect } from 'react';
import { TimeSheet } from './time-sheet/TimeSheet';
import { TimePeriodList } from './TimePeriodList';
import { SkeletonTimeSheet } from './SkeletonTimeSheet';
import { ITimeSheetView, ITimePeriodWithStatusView, ITimeEntry } from '@/interfaces/timeEntry.interfaces';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import { fetchTimePeriods, fetchOrCreateTimeSheet, saveTimeEntry } from '@/lib/actions/timeEntryActions';
import { useTeamAuth } from '@/hooks/useTeamAuth';


interface TimeTrackingProps {
  currentUser: IUserWithRoles;
  isManager: boolean;
}

export default function TimeTracking({ currentUser, isManager }: TimeTrackingProps) {
  const [timePeriods, setTimePeriods] = useState<ITimePeriodWithStatusView[]>([]);
  const [selectedTimeSheet, setSelectedTimeSheet] = useState<ITimeSheetView | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    loadTimePeriods();
  }, [currentUser.user_id]);

  const loadTimePeriods = async () => {
    try {
      const periods = await fetchTimePeriods(currentUser.user_id);
      setTimePeriods(periods);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectTimePeriod = async (timePeriod: ITimePeriodWithStatusView) => {
    const timeSheet = await fetchOrCreateTimeSheet(currentUser.user_id, timePeriod.period_id);
    setSelectedTimeSheet(timeSheet);
  };

  const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
    try {
      console.log('Saving time entry:', timeEntry);
      timeEntry.time_sheet_id = selectedTimeSheet?.id;
      const savedTimeEntry = await saveTimeEntry(timeEntry);
      console.log('Time entry saved successfully:', savedTimeEntry);

      // Optionally, update the local state or refresh the time entries
      // For example, you might want to refresh the entire time sheet
      if (selectedTimeSheet) {
        const updatedTimeSheet = await fetchOrCreateTimeSheet(currentUser.user_id, selectedTimeSheet.period_id);
        setSelectedTimeSheet(updatedTimeSheet);
      }

      // You can also add some user feedback here, like a toast notification
    } catch (error) {
      console.error('Error saving time entry:', error);
      // Handle the error (e.g., show an error message to the user)
    }
  };

  const handleSubmitTimeSheet = async () => {
    // Implement submit logic
  };

  const handleBack = () => {
    setSelectedTimeSheet(null);
  };

  if (selectedTimeSheet) {
    return (
      <TimeSheet
        timeSheet={selectedTimeSheet}
        onSaveTimeEntry={handleSaveTimeEntry}
        isManager={isManager}
        onSubmitTimeSheet={handleSubmitTimeSheet}
        onBack={handleBack}
      />
    );
  }

  if (isLoading) {
    return <SkeletonTimeSheet />;
  }

  return <TimePeriodList timePeriods={timePeriods} onSelectTimePeriod={handleSelectTimePeriod} />;
}
