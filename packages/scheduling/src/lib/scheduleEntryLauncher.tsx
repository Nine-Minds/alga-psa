'use client';

import React from 'react';
import type { OpenDrawerFn, WorkItemScheduleContext } from '@alga-psa/ui/context';
import WorkItemEntryEditor from '../components/schedule/WorkItemEntryEditor';
import { defaultWorkItemSlot } from './workItemScheduling';

interface LaunchScheduleEntryParams {
  openDrawer: OpenDrawerFn;
  closeDrawer: () => void;
  context: WorkItemScheduleContext;
  onComplete?: () => void;
  /** Edit this entry instead of creating one. */
  existingEntryId?: string;
}

/**
 * Opens the work-item entry editor in the global drawer: a new entry for the
 * work item (assigned to its default assignee, else the current user), or an
 * existing one to edit. Tickets can't import Scheduling directly, so this is
 * injected via SchedulingCallbacks.
 */
export async function launchScheduleEntryForWorkItem({
  openDrawer,
  closeDrawer,
  context,
  onComplete,
  existingEntryId,
}: LaunchScheduleEntryParams): Promise<void> {
  const target = existingEntryId
    ? ({ kind: 'edit-by-id', entryId: existingEntryId } as const)
    : ({
        kind: 'create',
        slot: defaultWorkItemSlot(),
        assigneeIds: context.defaultAssigneeId ? [context.defaultAssigneeId] : undefined,
      } as const);

  openDrawer(
    <WorkItemEntryEditor
      context={context}
      target={target}
      presentation="drawer"
      onClose={closeDrawer}
      onSaved={onComplete}
      onDeleted={onComplete}
    />,
    undefined,
    undefined,
    '900px',
  );
}
