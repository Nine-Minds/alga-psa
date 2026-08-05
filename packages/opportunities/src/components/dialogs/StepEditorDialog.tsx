'use client';

import React, { useEffect, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityStep, IUser } from '@alga-psa/types';
import type { OpportunityLinkableWorkItem, OpportunityStepAssignee } from '../../actions/opportunityStepActions';

export interface StepEditorValue {
  title: string;
  due_at: string | null;
  has_time: boolean;
  duration_minutes: number;
  assigned_to: string | null;
  ticket_id: string | null;
  project_task_id: string | null;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

/**
 * One dialog for everything a step can carry: what it is, when it happens (and
 * whether it takes a slot in the assignee's calendar), who owns it, and which
 * ticket or project task it points at.
 */
export function StepEditorDialog({
  isOpen,
  onClose,
  step,
  assignees,
  tickets,
  projectTasks,
  focus = 'title',
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Absent when adding a new step. */
  step?: IOpportunityStep | null;
  assignees: OpportunityStepAssignee[];
  tickets: OpportunityLinkableWorkItem[];
  projectTasks: OpportunityLinkableWorkItem[];
  /** Which part of the step the user came to change. */
  focus?: 'title' | 'schedule' | 'ticket' | 'task';
  onSubmit: (value: StepEditorValue) => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<Date | undefined>(undefined);
  const [hasTime, setHasTime] = useState(false);
  const [duration, setDuration] = useState(30);
  const [assignedTo, setAssignedTo] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(step?.title ?? '');
    setDue(step?.due_at ? new Date(step.due_at) : undefined);
    // Arriving via "Schedule" means the user wants a time, not the current answer.
    setHasTime(focus === 'schedule' ? true : (step?.has_time ?? false));
    setDuration(step?.duration_minutes ?? 30);
    setAssignedTo(step?.assigned_to ?? '');
    setTicketId(step?.ticket_id ?? '');
    setTaskId(step?.project_task_id ?? '');
  }, [isOpen, step, focus]);

  const valid = title.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        due_at: due ? due.toISOString() : null,
        has_time: hasTime && Boolean(due),
        duration_minutes: duration,
        assigned_to: assignedTo || null,
        ticket_id: ticketId || null,
        project_task_id: taskId || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button id="opportunity-step-editor-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
        {t('common.cancel', 'Cancel')}
      </Button>
      <Button id="opportunity-step-editor-save" size="sm" onClick={submit} disabled={!valid || saving}>
        {t('common.save', 'Save')}
      </Button>
    </div>
  );

  return (
    <Dialog
      id="opportunity-step-editor-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={step
        ? t('opportunities.steps.editTitle', 'Edit step')
        : t('opportunities.steps.addTitle', 'Add a step')}
      footer={footer}
    >
      <div className="space-y-4 pt-1">
        <Input
          id="opportunity-step-title"
          label={t('opportunities.steps.title', 'Step')}
          placeholder={t('opportunities.steps.titlePlaceholder', 'e.g. Walk the assessment findings with Dana')}
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          autoFocus={focus === 'title'}
          required
        />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="opportunity-step-has-time">
            {t('opportunities.steps.hasTime', 'Give it a time (shows on the calendar)')}
          </Label>
          <Switch
            id="opportunity-step-has-time"
            checked={hasTime}
            onCheckedChange={(checked: boolean) => setHasTime(checked)}
          />
        </div>
        {hasTime ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="opportunity-step-due-at">{t('opportunities.steps.when', 'When')}</Label>
              <DateTimePicker
                id="opportunity-step-due-at"
                label={t('opportunities.steps.when', 'When')}
                value={due}
                onChange={(date?: Date) => setDue(date)}
                clearable
              />
            </div>
            <CustomSelect
              id="opportunity-step-duration"
              label={t('opportunities.steps.duration', 'Length')}
              options={DURATIONS.map((minutes) => ({
                value: String(minutes),
                label: t('opportunities.steps.minutes', '{{count}} min', { count: minutes }),
              }))}
              value={String(duration)}
              onValueChange={(value: string) => setDuration(Number(value))}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="opportunity-step-due">{t('opportunities.steps.due', 'Due')}</Label>
            <DatePicker
              id="opportunity-step-due"
              label={t('opportunities.steps.due', 'Due')}
              value={due}
              onChange={(date?: Date) => setDue(date)}
              clearable
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="opportunity-step-assignee">
            {t('opportunities.steps.assignee', 'Assigned to')}
          </Label>
          <UserPicker
            data-automation-id="opportunity-step-assignee"
            value={assignedTo}
            onValueChange={setAssignedTo}
            users={assignees as unknown as IUser[]}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            labelStyle="none"
            buttonWidth="full"
            placeholder={t('opportunities.steps.unassigned', 'The deal owner')}
            unassignedLabel={t('opportunities.steps.unassigned', 'The deal owner')}
          />
        </div>
        <CustomSelect
          id="opportunity-step-ticket"
          label={t('opportunities.steps.ticket', 'Linked ticket')}
          options={[
            { value: '', label: t('opportunities.steps.noLink', 'Not linked') },
            ...tickets.map((ticket) => ({ value: ticket.id, label: ticket.label })),
          ]}
          value={ticketId}
          onValueChange={setTicketId}
        />
        <CustomSelect
          id="opportunity-step-task"
          label={t('opportunities.steps.projectTask', 'Linked project task')}
          options={[
            { value: '', label: t('opportunities.steps.noLink', 'Not linked') },
            ...projectTasks.map((task) => ({ value: task.id, label: task.label })),
          ]}
          value={taskId}
          onValueChange={setTaskId}
        />
      </div>
    </Dialog>
  );
}
