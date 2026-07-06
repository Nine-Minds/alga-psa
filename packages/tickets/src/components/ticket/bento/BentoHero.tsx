'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, SlidersHorizontal, Flame } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { TagManager } from '@alga-psa/tags/components';
import type { ITag, ITicket } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile } from '@alga-psa/ui/components/bento/BentoTile';
import { computeSlaClocks, formatSlaLabel, type TicketSlaFields } from './slaClocks';

interface HeroSelectOption {
  value: string;
  label: string;
  is_closed?: boolean;
  board_id?: string | null;
  color?: string | null;
}

interface BentoHeroProps {
  id: string;
  ticket: ITicket & TicketSlaFields & { escalated?: boolean; escalation_level?: number | null };
  statusOptions: HeroSelectOption[];
  priorityOptions: HeroSelectOption[];
  boardOptions: HeroSelectOption[];
  agentOptions: HeroSelectOption[];
  onSelectChange: (field: keyof ITicket, newValue: string | null) => Promise<void> | void;
  responseStateTrackingEnabled?: boolean;
  hideSlaStatus?: boolean;
  /** Locks workflow fields when the ticket is a bundle child. */
  workflowLocked?: boolean;
  /** Opens the drawer hosting the full details form. */
  onOpenAllFields: () => void;
  // Tags
  tags?: ITag[];
  onTagsChange?: (tags: ITag[]) => void;
  /** Rendered create-task / link-task actions (injected node). */
  taskActions?: React.ReactNode;
  // Live collaboration signals (subset of the full TicketInfo treatment).
  liveHighlightedFields?: string[];
  liveFrozenFields?: string[];
}

function HeroField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] mb-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Grid layout hero band: the fields a technician touches constantly, editable
 * in place (each control persists immediately through the existing
 * handleSelectChange pipeline). Everything else lives behind "All fields".
 */
export function BentoHero({
  id,
  ticket,
  statusOptions,
  priorityOptions,
  boardOptions,
  agentOptions,
  onSelectChange,
  responseStateTrackingEnabled,
  hideSlaStatus,
  workflowLocked,
  onOpenAllFields,
  tags,
  onTagsChange,
  taskActions,
  liveHighlightedFields = [],
  liveFrozenFields = [],
}: BentoHeroProps) {
  const { t } = useTranslation('features/tickets');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(ticket.title ?? '');

  const responseStateOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'awaiting_internal', label: t('bento.hero.responseWaitingOnUs', 'Waiting on us') },
      { value: 'awaiting_client', label: t('bento.hero.responseWaitingOnClient', 'Waiting on client') },
      { value: 'none', label: t('bento.hero.responseNone', 'No reply needed') },
    ],
    [t],
  );

  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(ticket.title ?? '');
  }, [ticket.title, isEditingTitle]);

  const isFrozen = (field: string) => liveFrozenFields.includes(field);
  const fieldWrapClass = (field: string) =>
    liveHighlightedFields.includes(field)
      ? 'rounded-md ring-2 ring-[rgb(var(--color-primary-300))] transition-shadow'
      : '';

  // Statuses are board-scoped in the options payload; only offer the ones
  // that belong to this ticket's board (plus unscoped statuses).
  const scopedStatusOptions = useMemo(
    () =>
      statusOptions.filter(
        (option) => !option.board_id || option.board_id === ticket.board_id,
      ),
    [statusOptions, ticket.board_id],
  );

  // Priority options may carry the priority color; render it as a dot.
  const priorityJsxOptions = useMemo<SelectOption[]>(
    () =>
      priorityOptions
        .filter((option) => option.value !== 'all')
        .map((option) => ({
          value: option.value,
          textValue: option.label,
          label: (
            <span className="inline-flex items-center gap-2 min-w-0">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: option.color || 'rgb(var(--color-border-400))' }}
              />
              <span className="truncate">{option.label}</span>
            </span>
          ),
        })),
    [priorityOptions],
  );

  const agentJsxOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'unassigned', label: t('bento.hero.notAssigned', 'Not assigned') },
      ...agentOptions.map((option) => ({
        value: option.value,
        textValue: option.label,
        label: (
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[rgb(var(--color-primary-100))] dark:bg-[rgb(var(--color-primary-400)/0.3)] text-[8px] font-bold text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))] flex-shrink-0">
              {initials(option.label)}
            </span>
            <span className="truncate">{option.label}</span>
          </span>
        ),
      })),
    ],
    [agentOptions, t],
  );

  const dueDate = ticket.due_date ? new Date(ticket.due_date as unknown as string) : undefined;

  const handleDueDateChange = (date: Date | undefined) => {
    if (!date) {
      void onSelectChange('due_date', null);
      return;
    }
    // Preserve the existing time-of-day when only the date changes.
    const next = new Date(date);
    if (dueDate && !Number.isNaN(dueDate.getTime())) {
      next.setHours(dueDate.getHours(), dueDate.getMinutes(), 0, 0);
    }
    void onSelectChange('due_date', next.toISOString());
  };

  const slaClocks = useMemo(() => computeSlaClocks(ticket), [ticket]);

  const commitTitle = async () => {
    setIsEditingTitle(false);
    const next = titleDraft.trim();
    if (next && next !== ticket.title) {
      await onSelectChange('title', next);
    } else {
      setTitleDraft(ticket.title ?? '');
    }
  };

  return (
    <BentoTile id={id}>
      <div>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            {isEditingTitle ? (
              <Input
                id={`${id}-title-input`}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void commitTitle();
                  if (event.key === 'Escape') {
                    setTitleDraft(ticket.title ?? '');
                    setIsEditingTitle(false);
                  }
                }}
                autoFocus
                className="text-lg font-bold"
                containerClassName="mb-0"
              />
            ) : (
              <h2 className="text-lg font-bold text-[rgb(var(--color-text-900))] flex items-center gap-2 min-w-0">
                <span className="truncate">{ticket.title}</span>
                <button
                  id={`${id}-title-edit`}
                  type="button"
                  aria-label={t('bento.hero.editTitle', 'Edit title')}
                  className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))] flex-shrink-0"
                  onClick={() => setIsEditingTitle(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </h2>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {ticket.escalated ? (
              <span
                id={`${id}-escalated-chip`}
                className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-800 dark:text-red-300"
              >
                <Flame className="h-3 w-3" />
                {t('bento.hero.escalated', 'Escalated')}{typeof ticket.escalation_level === 'number' && ticket.escalation_level > 0 ? ` · L${ticket.escalation_level}` : ''}
              </span>
            ) : null}
            {!hideSlaStatus && slaClocks.policyApplied ? (
              <span
                id={`${id}-sla-slab`}
                className="text-xs font-medium text-[rgb(var(--color-text-500))]"
              >
                {t('bento.hero.resolutionSla', 'Resolution SLA:')}{' '}
                <span
                  className={
                    slaClocks.resolution.state === 'overdue' || slaClocks.resolution.state === 'missed'
                      ? 'font-semibold text-red-700 dark:text-red-400'
                      : slaClocks.resolution.state === 'met'
                        ? 'font-semibold text-green-700 dark:text-green-400'
                        : 'font-semibold text-amber-700 dark:text-amber-400'
                  }
                >
                  {formatSlaLabel(slaClocks.resolution.label, t)}
                </span>
              </span>
            ) : null}
            {taskActions}
            <Button
              id={`${id}-all-fields-button`}
              variant="outline"
              size="sm"
              onClick={onOpenAllFields}
              className="flex items-center gap-1.5"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t('bento.hero.allFields', 'All fields')}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <HeroField label={t('bento.hero.status', 'Status')}>
            <div className={fieldWrapClass('status_id')}>
              <CustomSelect
                id={`${id}-status-select`}
                value={ticket.status_id ?? ''}
                options={scopedStatusOptions}
                onValueChange={(value: string) => void onSelectChange('status_id', value)}
                disabled={workflowLocked || isFrozen('status_id')}
                className="!w-full"
              />
            </div>
          </HeroField>
          <HeroField label={t('bento.hero.priority', 'Priority')}>
            <div className={fieldWrapClass('priority_id')}>
              <CustomSelect
                id={`${id}-priority-select`}
                value={ticket.priority_id ?? ''}
                options={priorityJsxOptions}
                onValueChange={(value: string) => void onSelectChange('priority_id', value)}
                disabled={workflowLocked || isFrozen('priority_id')}
                className="!w-full"
              />
            </div>
          </HeroField>
          <HeroField label={t('bento.hero.board', 'Board')}>
            <div className={fieldWrapClass('board_id')}>
              <CustomSelect
                id={`${id}-board-select`}
                value={ticket.board_id ?? ''}
                options={boardOptions}
                onValueChange={(value: string) => void onSelectChange('board_id', value)}
                disabled={workflowLocked || isFrozen('board_id')}
                className="!w-full"
              />
            </div>
          </HeroField>
          <HeroField label={t('bento.hero.assignedTo', 'Assigned to')}>
            <div className={fieldWrapClass('assigned_to')}>
              <CustomSelect
                id={`${id}-assignee-select`}
                value={ticket.assigned_to ?? 'unassigned'}
                options={agentJsxOptions}
                onValueChange={(value: string) => void onSelectChange('assigned_to', value)}
                disabled={isFrozen('assigned_to')}
                className="!w-full"
              />
            </div>
          </HeroField>
          <HeroField label={t('bento.hero.due', 'Due')}>
            <div className={fieldWrapClass('due_date')}>
              <DatePicker
                id={`${id}-due-date-picker`}
                value={dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : undefined}
                onChange={handleDueDateChange}
                placeholder={t('bento.hero.noDueDate', 'No due date')}
                disabled={isFrozen('due_date')}
              />
            </div>
          </HeroField>
          {responseStateTrackingEnabled ? (
            <HeroField label={t('bento.hero.replyStatus', 'Reply status')}>
              <div className={fieldWrapClass('response_state')}>
                <CustomSelect
                  id={`${id}-response-state-select`}
                  value={(ticket.response_state as string | null) ?? 'none'}
                  options={responseStateOptions}
                  onValueChange={(value: string) =>
                    void onSelectChange('response_state', value === 'none' ? null : value)
                  }
                  disabled={isFrozen('response_state')}
                  className="!w-full"
                />
              </div>
            </HeroField>
          ) : null}
        </div>

        {ticket.ticket_id && onTagsChange ? (
          <div id={`${id}-tags-row`} className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
              {t('bento.hero.tags', 'Tags')}
            </span>
            <TagManager
              entityId={ticket.ticket_id}
              entityType="ticket"
              initialTags={tags ?? []}
              onTagsChange={onTagsChange}
              useInlineInput
            />
          </div>
        ) : null}
      </div>
    </BentoTile>
  );
}

export default BentoHero;
