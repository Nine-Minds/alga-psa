'use client';

import React from 'react';
import TimeSheetClient from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeSheetClient';
import { WorkItemDrawer } from './WorkItemDrawer';
import { WorkItemPicker } from './WorkItemPicker';
import TimeEntryEditForm from './TimeEntryEditForm';
import { TimeEntryProvider, useTimeEntry } from './TimeEntryProvider';

export default function MspTimeSheetClient(props: React.ComponentProps<typeof TimeSheetClient>) {
  return (
    <TimeSheetClient
      {...props}
      WorkItemDrawerComponent={WorkItemDrawer}
      WorkItemPickerComponent={WorkItemPicker}
      TimeEntryProviderComponent={TimeEntryProvider}
      useTimeEntryHook={useTimeEntry}
      TimeEntryEditFormComponent={TimeEntryEditForm}
    />
  );
}
