'use client';

import React from 'react';
import type { OpenDrawerFn, WorkItemScheduleContext } from '@alga-psa/ui/context';
import WorkItemEntryEditor, { type WorkItemEntryTarget } from '../components/schedule/WorkItemEntryEditor';
import {
  defaultWorkItemSlot,
  slotFromCalendarSelection,
  WORK_ITEM_ENTRY_DEFAULT_DURATION_MS,
  type CalendarSelection,
} from './workItemScheduling';

/** Shared creation draft for the ticket tile and the agent's calendar. */
export function createForWorkItem(
  context: WorkItemScheduleContext,
  defaults: { viewedAgentId?: string; selection?: CalendarSelection; view?: string; now?: Date } = {},
): Extract<WorkItemEntryTarget, { kind: 'create' }> {
  let slot = defaultWorkItemSlot(defaults.now);
  if (defaults.selection) {
    if (defaults.view === 'month') {
      // A date-only selection uses the same time and duration as the launcher.
      const start = new Date(defaults.selection.start);
      start.setHours(slot.start.getHours(), slot.start.getMinutes(), 0, 0);
      slot = { start, end: new Date(start.getTime() + WORK_ITEM_ENTRY_DEFAULT_DURATION_MS) };
    } else {
      slot = slotFromCalendarSelection(defaults.selection, defaults.view ?? 'week', {
        durationMs: WORK_ITEM_ENTRY_DEFAULT_DURATION_MS,
      });
    }
  }
  // An explicit agent calendar keeps the assignee locked to the viewed agent.
  const assigneeId = defaults.viewedAgentId ?? context.defaultAssigneeId;
  return { kind: 'create', slot, assigneeIds: assigneeId ? [assigneeId] : undefined };
}

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
    : createForWorkItem(context);

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
