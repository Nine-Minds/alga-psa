'use client';

import { useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDateTriggerSourceDefinition } from '@alga-psa/workflows/authoring';
import type { WorkflowRunTriggerType, WorkflowScheduleStatus } from './workflowRunTriggerPresentation';

const WORKFLOW_NAMESPACE = 'msp/workflows';

export function useFormatWorkflowRunTrigger(): (
  triggerType: WorkflowRunTriggerType,
  eventType?: string | null,
) => string {
  const { t } = useTranslation(WORKFLOW_NAMESPACE);
  return (triggerType, eventType) => {
    if (triggerType === 'schedule') {
      return t('trigger.oneTimeSchedule', { defaultValue: 'One-time schedule' });
    }
    if (triggerType === 'recurring') {
      return t('trigger.recurringSchedule', { defaultValue: 'Recurring schedule' });
    }
    if (triggerType === 'date') {
      return t('trigger.date', { defaultValue: 'Date' });
    }
    if (triggerType === 'event') {
      return eventType
        ? t('trigger.eventWithType', { defaultValue: 'Event: {{eventType}}', eventType })
        : t('trigger.event', { defaultValue: 'Event' });
    }
    // A run started by hand (e.g. from the Run dialog) can carry a sample event; it was not fired by that event.
    if (eventType) {
      return t('trigger.manualWithEvent', { defaultValue: 'Manual test with event: {{eventType}}', eventType });
    }
    return t('trigger.manual', { defaultValue: 'Manual test' });
  };
}


/**
 * What starts a workflow (its definition's trigger), as opposed to what started one run:
 * "Event: TICKET_CREATED", "Contract end date, 30 days before", "Recurring schedule"…, or null when
 * the workflow has no trigger and only runs when started by hand.
 */
export function useDescribeWorkflowTrigger(): (trigger: unknown) => string | null {
  const { t } = useTranslation(WORKFLOW_NAMESPACE);
  return useCallback((trigger: unknown) => {
    if (!trigger || typeof trigger !== 'object') return null;
    const value = trigger as { type?: unknown; eventName?: unknown; source?: unknown; offsetDays?: unknown; params?: unknown };
    switch (value.type) {
      case 'event':
        return typeof value.eventName === 'string' && value.eventName
          ? t('trigger.eventWithType', { defaultValue: 'Event: {{eventType}}', eventType: value.eventName })
          : t('trigger.event', { defaultValue: 'Event' });
      case 'schedule':
        return t('trigger.oneTimeSchedule', { defaultValue: 'One-time schedule' });
      case 'recurring':
        return t('trigger.recurringSchedule', { defaultValue: 'Recurring schedule' });
      case 'date': {
        const sourceDefinition = typeof value.source === 'string' ? getDateTriggerSourceDefinition(value.source) : undefined;
        const sourceLabel = sourceDefinition
          ? t(sourceDefinition.labelKey, { defaultValue: sourceDefinition.defaultLabel })
          : t('trigger.date', { defaultValue: 'Date' });
        const offsetDays = typeof value.offsetDays === 'number' ? value.offsetDays : 0;
        const days = Math.abs(offsetDays);
        const statusAgeDays = sourceDefinition && !sourceDefinition.usesOffset
          ? (value.params as { days?: unknown } | undefined)?.days
          : undefined;
        // Sources without an offset fire on a condition, so "on the day" would mislead: say how long instead.
        const timing = typeof statusAgeDays === 'number'
          ? t('trigger.dateTiming.daysInStatus', { defaultValue: '{{count}} days in the status', count: statusAgeDays })
          : offsetDays < 0
            ? t('trigger.dateTiming.before', { defaultValue: '{{count}} days before', count: days })
            : offsetDays > 0
              ? t('trigger.dateTiming.after', { defaultValue: '{{count}} days after', count: days })
              : t('trigger.dateTiming.onTheDay', { defaultValue: 'on the day' });
        return t('trigger.dateWithTiming', { defaultValue: '{{source}}, {{timing}}', source: sourceLabel, timing });
      }
      default:
        return null;
    }
  }, [t]);
}

export function useFormatWorkflowScheduleStatus(): (status: WorkflowScheduleStatus) => string {
  const { t } = useTranslation(WORKFLOW_NAMESPACE);
  return (status) => {
    if (!status) return t('scheduleStatus.unknown', { defaultValue: 'Unknown' });
    switch (status) {
      case 'scheduled':
        return t('scheduleStatus.scheduled', { defaultValue: 'Scheduled' });
      case 'paused':
        return t('scheduleStatus.paused', { defaultValue: 'Paused' });
      case 'disabled':
        return t('scheduleStatus.disabled', { defaultValue: 'Disabled' });
      case 'completed':
        return t('scheduleStatus.completed', { defaultValue: 'Completed' });
      case 'failed':
        return t('scheduleStatus.failed', { defaultValue: 'Failed' });
      default:
        return status;
    }
  };
}
