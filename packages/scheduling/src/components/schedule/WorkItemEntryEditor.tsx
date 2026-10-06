'use client';

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WorkItemScheduleContext } from '@alga-psa/ui/context';
import { useUsers } from '@alga-psa/user-composition/hooks';
import type { DeletionValidationResult, IEditScope, IScheduleEntry, IWorkItem } from '@alga-psa/types';
import { isActionResultError } from '@alga-psa/ui/lib/errorHandling';
import {
  addScheduleEntry,
  deleteScheduleEntry,
  getScheduleEntryById,
  updateScheduleEntry,
} from '@alga-psa/scheduling/actions';
import EntryPopup from './EntryPopup';
import { useScheduleViewer, type ScheduleViewer } from '../../hooks/useScheduleViewer';

/** What the editor opens on: a fresh slot, a loaded entry, or an entry to fetch. */
export type WorkItemEntryTarget =
  | { kind: 'create'; slot: { start: Date; end: Date }; assigneeIds?: string[] }
  | { kind: 'edit'; event: IScheduleEntry }
  | { kind: 'edit-by-id'; entryId: string };

export interface WorkItemEntryEditorProps {
  /** Required to create; edits of an existing entry work without it. */
  context?: WorkItemScheduleContext;
  target: WorkItemEntryTarget;
  /** 'drawer' renders inline (the host already provides the surface); 'dialog' overlays. */
  presentation: 'drawer' | 'dialog';
  onClose: () => void;
  onSaved?: (entry: IScheduleEntry) => void;
  onDeleted?: (entryId: string) => void;
  /**
   * Keep the assignment fixed to the target's assignees. The agent calendar
   * drawer uses this: it only shows one agent's entries, so an entry moved to
   * someone else would vanish from view and read as a failed save.
   */
  lockAssignees?: boolean;
  /** Preloaded viewer, when the host already resolved it. */
  viewer?: ScheduleViewer;
}

type DeleteResult = DeletionValidationResult & {
  success: boolean;
  deleted?: boolean;
  error?: string;
  isPrivateError?: boolean;
};

/**
 * The one editor for schedule entries that belong to a work item. Every
 * ticket-page surface (the "schedule time" drawer, the agent calendar, an
 * existing-entry row) renders this, so permissions, defaults, persistence and
 * feedback are decided once.
 */
export default function WorkItemEntryEditor({
  context,
  target,
  presentation,
  onClose,
  onSaved,
  onDeleted,
  lockAssignees = false,
  viewer: providedViewer,
}: WorkItemEntryEditorProps) {
  const { t } = useTranslation('msp/schedule');
  const ownViewer = useScheduleViewer(
    t('agentView.errors.loadPermissions', { defaultValue: 'Failed to load user permissions' })
  );
  const viewer = providedViewer ?? ownViewer;
  const { users = [], loading: usersLoading } = useUsers();

  const [fetchedEvent, setFetchedEvent] = useState<IScheduleEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (target.kind !== 'edit-by-id') return;
    let active = true;
    setFetchedEvent(null);
    setLoadError(null);
    getScheduleEntryById(target.entryId)
      .then((result) => {
        if (!active) return;
        if (!result) {
          setLoadError(t('workItemEditor.loadFailed', { defaultValue: 'Failed to load schedule entry' }));
          return;
        }
        if (isActionResultError(result)) {
          setLoadError(t('workItemEditor.loadFailed'));
          return;
        }
        setFetchedEvent(result);
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to load schedule entry:', err);
        setLoadError(t('workItemEditor.loadFailed', { defaultValue: 'Failed to load schedule entry' }));
      });
    return () => {
      active = false;
    };
  }, [target, t]);

  const event: IScheduleEntry | null =
    target.kind === 'edit' ? target.event : target.kind === 'edit-by-id' ? fetchedEvent : null;
  const isCreating = target.kind === 'create';

  const error = viewer.error ?? loadError;
  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!viewer.loaded || !viewer.currentUserId || (target.kind === 'edit-by-id' && !event)) {
    return (
      <div id="work-item-entry-editor-loading" className="flex items-center justify-center p-8">
        <Spinner size="sm" />
      </div>
    );
  }

  if (isCreating && !context) {
    throw new Error('WorkItemEntryEditor needs a work item context to create an entry');
  }

  if (isCreating && !viewer.canModifySchedule) {
    return (
      <div className="p-4">
        <Alert>
          <AlertDescription>
            {t('workItemEditor.noPermission', {
              defaultValue: 'You need the schedule update permission to schedule work.',
            })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const currentUserId = viewer.currentUserId;
  const assigneeIds =
    target.kind === 'create' && target.assigneeIds && target.assigneeIds.length > 0
      ? target.assigneeIds
      : undefined;
  const focusedTechnicianId = assigneeIds?.[0] ?? event?.assigned_user_ids?.[0] ?? currentUserId;

  const initialWorkItem: Omit<IWorkItem, 'tenant'> | null =
    isCreating && context
      ? { work_item_id: context.workItemId, type: context.workItemType, name: context.title, description: '' }
      : null;

  const handleSave = async (entryData: Omit<IScheduleEntry, 'tenant'> & { updateType?: string }) => {
    try {
      if (event) {
        const result = await updateScheduleEntry(event.entry_id, {
          ...entryData,
          recurrence_pattern: entryData.recurrence_pattern || null,
          ...(event.entry_id.includes('_') ? { original_entry_id: event.original_entry_id } : {}),
        });
        if (!result.success || !result.entry) {
          toast.error(
            t('workItemEditor.updateFailed', { defaultValue: 'Failed to update schedule entry' })
          );
          return;
        }
        toast.success(t('workItemEditor.updated', { defaultValue: 'Schedule entry updated' }));
        onSaved?.(result.entry);
        context?.onScheduled?.();
        onClose();
        return;
      }

      const workItem = context!;
      const result = await addScheduleEntry({
        ...entryData,
        work_item_id: workItem.workItemId,
        work_item_type: workItem.workItemType,
        title: entryData.title || workItem.title,
        recurrence_pattern: entryData.recurrence_pattern || null,
      });
      if (!result.success || !result.entry) {
        toast.error(
          t('workItemEditor.createFailed', { defaultValue: 'Failed to schedule this work' })
        );
        return;
      }
      toast.success(t('workItemEditor.created', { defaultValue: 'Scheduled {{title}}', title: workItem.title }));
      onSaved?.(result.entry);
      workItem.onScheduled?.();
      onClose();
    } catch (err) {
      console.error('Failed to save schedule entry:', err);
      toast.error(
        event
          ? t('workItemEditor.updateFailed', { defaultValue: 'Failed to update schedule entry' })
          : t('workItemEditor.createFailed', { defaultValue: 'Failed to schedule this work' })
      );
    }
  };

  const handleDelete = async (entryId: string, deleteType?: IEditScope): Promise<DeleteResult> => {
    const failure = (message: string): DeleteResult => ({
      success: false,
      error: message,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message,
      dependencies: [],
      alternatives: [],
    });
    try {
      const result = await deleteScheduleEntry(entryId, deleteType);
      if (result.success) {
        toast.success(t('workItemEditor.deleted', { defaultValue: 'Schedule entry deleted' }));
        onDeleted?.(entryId);
        context?.onScheduled?.();
        onClose();
      } else {
        toast.error(
          t('workItemEditor.deleteFailed', { defaultValue: 'Failed to delete schedule entry' })
        );
      }
      return result;
    } catch (err) {
      console.error('Failed to delete schedule entry:', err);
      const message = t('workItemEditor.deleteFailed', { defaultValue: 'Failed to delete schedule entry' });
      toast.error(message);
      return failure(message);
    }
  };

  const canModify = viewer.canModifySchedule;

  return (
    <EntryPopup
      event={event}
      slot={target.kind === 'create' ? { ...target.slot, assigned_user_ids: assigneeIds, defaultAssigneeId: assigneeIds?.[0] } : undefined}
      initialWorkItem={initialWorkItem}
      onClose={onClose}
      onSave={handleSave}
      onDelete={canModify ? handleDelete : undefined}
      canAssignMultipleAgents={canModify && !lockAssignees}
      users={users}
      currentUserId={currentUserId}
      loading={usersLoading}
      error={null}
      canModifySchedule={canModify}
      focusedTechnicianId={focusedTechnicianId}
      canAssignOthers={canModify && !lockAssignees}
      viewOnly={!canModify}
      lockWorkItem={Boolean(context)}
      // Inside the agent calendar drawer the header already names the work
      // item; in the standalone drawer the dialog is the only place it shows.
      hideWorkItemRow={presentation === 'dialog' && Boolean(context)}
      isInDrawer={presentation === 'drawer'}
    />
  );
}
