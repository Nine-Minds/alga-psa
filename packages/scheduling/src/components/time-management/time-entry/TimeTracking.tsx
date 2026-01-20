// src/components/TimeTracking.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TimePeriodList } from './TimePeriodList';
import { SkeletonTimeSheet } from './SkeletonTimeSheet';
import { ITimePeriodWithStatusView } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { fetchTimePeriods, fetchOrCreateTimeSheet } from '../../../actions/timeEntryActions';


interface TimeTrackingProps {
  currentUser: IUserWithRoles;
  isManager: boolean;
}

export default function TimeTracking({ currentUser, isManager }: TimeTrackingProps) {
  const router = useRouter();
  const [timePeriods, setTimePeriods] = useState<ITimePeriodWithStatusView[]>([]);
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
    try {
      const timeSheet = await fetchOrCreateTimeSheet(currentUser.user_id, timePeriod.period_id);
      // Navigate to the timesheet page with its ID
      router.push(`/msp/time-entry/timesheet/${timeSheet.id}`);
    } catch (error) {
      console.error('Error creating/fetching timesheet:', error);
    }
  };

  if (isLoading) {
    return <SkeletonTimeSheet />;
  }

  return <TimePeriodList timePeriods={timePeriods} onSelectTimePeriod={handleSelectTimePeriod} />;
}
