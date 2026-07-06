'use client';

import React from 'react';
import { toast } from 'react-hot-toast';
import { getCurrentUser, getAllUsersBasic } from '@alga-psa/user-composition/actions';
import type { IScheduleEntry, IWorkItem } from '@alga-psa/types';
import type { OpenDrawerFn, ScheduleEntryLaunchContext } from '@alga-psa/ui/context';
import EntryPopup from '../components/schedule/EntryPopup';
import { addScheduleEntry } from '../actions/scheduleActions';

interface LaunchScheduleEntryParams {
  openDrawer: OpenDrawerFn;
  closeDrawer: () => void;
  context: ScheduleEntryLaunchContext;
  onComplete?: () => void;
}

/** Default one-hour slot starting at the next quarter hour. */
function defaultSlot(): { start: Date; end: Date } {
  const start = new Date();
  start.setSeconds(0, 0);
  const minutes = start.getMinutes();
  start.setMinutes(minutes - (minutes % 15) + 15);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

/**
 * Opens the schedule-entry editor (EntryPopup) in the global drawer, pre-scoped
 * to a work item (e.g. a ticket). Mirrors launchTimeEntryForWorkItem: tickets
 * can't import Scheduling directly, so this is injected via SchedulingCallbacks.
 */
export async function launchScheduleEntryForWorkItem({
  openDrawer,
  closeDrawer,
  context,
  onComplete,
}: LaunchScheduleEntryParams): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user?.user_id) {
      toast.error('Unable to load current user for scheduling.');
      return;
    }

    const users = await getAllUsersBasic(true, 'internal');
    const { start, end } = defaultSlot();

    const initialWorkItem: Omit<IWorkItem, 'tenant'> = {
      work_item_id: context.workItemId,
      type: context.workItemType,
      name: context.title,
      description: '',
    };

    openDrawer(
      <EntryPopup
        event={null}
        slot={{ start, end, assigned_user_ids: [user.user_id] }}
        initialWorkItem={initialWorkItem}
        onClose={closeDrawer}
        onSave={async (entryData: Omit<IScheduleEntry, 'tenant'> & { updateType?: string }) => {
          try {
            const result = await addScheduleEntry(
              {
                ...entryData,
                work_item_id: context.workItemId,
                work_item_type: context.workItemType,
                title: entryData.title || context.title,
              },
              { assignedUserIds: entryData.assigned_user_ids },
            );

            if (result.success) {
              toast.success('Visit scheduled.');
              closeDrawer();
              if (onComplete) onComplete();
            } else {
              toast.error(result.error || 'Failed to schedule visit.');
            }
          } catch (error) {
            console.error('Failed to schedule visit:', error);
            toast.error('Failed to schedule visit. Please try again.');
          }
        }}
        canAssignMultipleAgents={true}
        users={users}
        currentUserId={user.user_id}
        canModifySchedule={true}
        canAssignOthers={true}
        focusedTechnicianId={user.user_id}
        isInDrawer={true}
      />,
      undefined,
      undefined,
      '900px',
    );
  } catch (error) {
    console.error('Failed to launch schedule entry dialog:', error);
    toast.error('An error occurred while preparing the scheduler. Please try again.');
  }
}
