'use client';

import React from 'react';
import SchedulePage from '@alga-psa/scheduling/components/schedule/SchedulePage';
import AppointmentRequestsPanel from './AppointmentRequestsPanel';

export default function MspSchedulePage() {
  return <SchedulePage AppointmentRequestsPanelComponent={AppointmentRequestsPanel} />;
}
