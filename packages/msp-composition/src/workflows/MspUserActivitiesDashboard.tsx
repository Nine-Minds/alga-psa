'use client';

import React from 'react';
import { UserActivitiesDashboard } from '@alga-psa/workflows/components';
import { TicketsSection } from './TicketsSection';
import { ProjectsSection } from './ProjectsSection';
import { ActivityDetailViewerDrawer } from './ActivityDetailViewerDrawer';

export default function MspUserActivitiesDashboard() {
  return (
    <UserActivitiesDashboard
      TicketsSectionComponent={TicketsSection}
      ProjectsSectionComponent={ProjectsSection}
      ActivityDetailViewerDrawerComponent={ActivityDetailViewerDrawer}
    />
  );
}
