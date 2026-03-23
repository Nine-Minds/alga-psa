'use client';

import { Profiler } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import TimeTracking from './TimeTracking';
import type { IUserWithRoles } from '@alga-psa/types';

interface Props {
  initialUser: IUserWithRoles | null;
  initialIsManager: boolean;
}

export default function TimeTrackingClient({ initialUser, initialIsManager }: Props) {
  const { t } = useTranslation('msp/time-entry');
  if (!initialUser) {
    return <div>{t('common.fallbacks.noUserFound', { defaultValue: 'No user found' })}</div>;
  }

  const onRender = (
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    console.log('Profiler Data:', {
      id,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    });
  };

  return (
    <Profiler id="TimeTrackingPage" onRender={onRender}>
      <TimeTracking currentUser={initialUser} isManager={initialIsManager} />
    </Profiler>
  );
}
