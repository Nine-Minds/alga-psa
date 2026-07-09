'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Label } from '@alga-psa/ui/components/Label';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import Spinner from '@alga-psa/ui/components/Spinner';
import { CheckCircle2, Circle, Ticket, ListChecks } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useActivityCrossFeature } from '@alga-psa/ui/context';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getAdHocActivity,
  updateAdHocActivity,
  setAdHocActivityDone,
  deleteAdHocActivity,
} from '@alga-psa/user-activities/actions';

interface AdHocDetailPanelProps {
  activityId: string;
  onClose: () => void;
  onActionComplete?: () => void;
}

/**
 * Detail view for an ad-hoc personal to-do. Ad-hoc items are schedule entries with
 * no required time, so the standard schedule EntryPopup (which requires a start time)
 * is not used. This lightweight panel allows editing the title/notes and optional
 * times, marking the item done, and converting it into a ticket or project task.
 */
export function AdHocDetailPanel({ activityId, onClose, onActionComplete }: AdHocDetailPanelProps) {
  const { t } = useTranslation('msp/user-activities');
  const ctx = useActivityCrossFeature();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [start, setStart] = useState<Date | undefined>(undefined);
  const [end, setEnd] = useState<Date | undefined>(undefined);
  const [isDone, setIsDone] = useState(false);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [convertTarget, setConvertTarget] = useState<'ticket' | 'task' | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      const entry = await getAdHocActivity(activityId);
      setTitle(entry.title || '');
      setNotes(entry.notes || '');
      setStart(entry.scheduled_start ? new Date(entry.scheduled_start) : undefined);
      setEnd(entry.scheduled_end ? new Date(entry.scheduled_end) : undefined);
      setIsDone(entry.status === 'closed');
      setAssignedTo(entry.assigned_user_ids?.[0] ?? null);
      setError(null);
    } catch (err) {
      console.error('Error loading ad-hoc item:', err);
      setError(t('drawer.adHoc.loadError', { defaultValue: 'Failed to load this item. Please try again later.' }));
    } finally {
      setIsLoading(false);
    }
  }, [activityId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeRangeInvalid = Boolean(start && end && end <= start);
  const canSave = title.trim().length > 0 && !timeRangeInvalid && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await updateAdHocActivity(activityId, {
        title: title.trim(),
        notes: notes.trim() || null,
        scheduledStart: start ? start.toISOString() : null,
        scheduledEnd: end ? end.toISOString() : null,
      });
      toast.success(t('drawer.adHoc.saveSuccess', { defaultValue: 'Item saved' }));
      onActionComplete?.();
    } catch (err) {
      console.error('Error saving ad-hoc item:', err);
      toast.error(t('drawer.adHoc.saveError', { defaultValue: 'Failed to save item.' }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDone = async () => {
    try {
      await setAdHocActivityDone(activityId, !isDone);
      setIsDone((prev) => !prev);
      onActionComplete?.();
    } catch (err) {
      console.error('Error toggling ad-hoc done state:', err);
      toast.error(t('drawer.adHoc.toggleDoneError', { defaultValue: 'Failed to update item.' }));
    }
  };

  // Delete the ad-hoc item once it has been converted into a ticket/task.
  const handleConverted = async () => {
    try {
      await deleteAdHocActivity(activityId);
    } catch (err) {
      console.error('Error deleting ad-hoc item after conversion:', err);
    } finally {
      setConvertTarget(null);
      onActionComplete?.();
    }
  };

  const convertProps = {
    title: title.trim(),
    description: notes.trim() || undefined,
    assignedTo,
    onConverted: handleConverted,
    onClose: () => setConvertTarget(null),
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col bg-white">
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t('drawer.adHoc.title', { defaultValue: 'Ad hoc item' })}</h2>
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-500/15 text-gray-600 rounded">
              {isDone
                ? t('drawer.adHoc.statusDone', { defaultValue: 'Done' })
                : t('drawer.adHoc.statusOpen', { defaultValue: 'Open' })}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1">
            <Label htmlFor={`adhoc-title-${activityId}`}>
              {t('drawer.adHoc.fields.title', { defaultValue: 'Title' })}
            </Label>
            <Input
              id={`adhoc-title-${activityId}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('drawer.adHoc.fields.titlePlaceholder', { defaultValue: 'Title' })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`adhoc-notes-${activityId}`}>
              {t('drawer.adHoc.fields.notes', { defaultValue: 'Notes' })}
            </Label>
            <TextArea
              id={`adhoc-notes-${activityId}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('drawer.adHoc.fields.notesPlaceholder', { defaultValue: 'Add notes…' })}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor={`adhoc-start-${activityId}`}>
                {t('drawer.adHoc.fields.start', { defaultValue: 'Start (optional)' })}
              </Label>
              <DateTimePicker
                id={`adhoc-start-${activityId}`}
                value={start}
                clearable
                onChange={(date) => setStart(date)}
                placeholder={t('drawer.adHoc.fields.noTime', { defaultValue: 'No time' })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`adhoc-end-${activityId}`}>
                {t('drawer.adHoc.fields.end', { defaultValue: 'End (optional)' })}
              </Label>
              <DateTimePicker
                id={`adhoc-end-${activityId}`}
                value={end}
                clearable
                onChange={(date) => setEnd(date)}
                placeholder={t('drawer.adHoc.fields.noTime', { defaultValue: 'No time' })}
              />
            </div>
          </div>
          {timeRangeInvalid && (
            <p className="text-sm text-destructive">
              {t('drawer.adHoc.endBeforeStart', { defaultValue: 'End time must be after the start time.' })}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4 space-y-3">
          <div className="flex items-center justify-end gap-2">
            <Button
              id={`adhoc-cancel-${activityId}`}
              variant="outline"
              onClick={onClose}
            >
              {t('drawer.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id={`adhoc-save-${activityId}`}
              onClick={handleSave}
              disabled={!canSave}
            >
              {isSaving
                ? t('drawer.actions.saving', { defaultValue: 'Saving...' })
                : t('drawer.actions.save', { defaultValue: 'Save' })}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              id={`adhoc-toggle-done-${activityId}`}
              variant="soft"
              onClick={handleToggleDone}
            >
              {isDone ? <Circle className="h-4 w-4 mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {isDone
                ? t('table.adHoc.markNotDone', { defaultValue: 'Mark as not done' })
                : t('table.adHoc.markDone', { defaultValue: 'Mark as done' })}
            </Button>
            {ctx.renderConvertAdHocToTicket && (
              <Button
                id={`adhoc-convert-ticket-${activityId}`}
                variant="soft"
                onClick={() => setConvertTarget('ticket')}
                disabled={title.trim().length === 0}
              >
                <Ticket className="h-4 w-4 mr-2" />
                {t('table.adHoc.convertToTicket', { defaultValue: 'Convert to ticket' })}
              </Button>
            )}
            {ctx.renderConvertAdHocToProjectTask && (
              <Button
                id={`adhoc-convert-task-${activityId}`}
                variant="soft"
                onClick={() => setConvertTarget('task')}
                disabled={title.trim().length === 0}
              >
                <ListChecks className="h-4 w-4 mr-2" />
                {t('table.adHoc.convertToTask', { defaultValue: 'Convert to project task' })}
              </Button>
            )}
          </div>
        </div>
      </div>
      {convertTarget === 'ticket' && ctx.renderConvertAdHocToTicket?.(convertProps)}
      {convertTarget === 'task' && ctx.renderConvertAdHocToProjectTask?.(convertProps)}
    </>
  );
}

export default AdHocDetailPanel;
