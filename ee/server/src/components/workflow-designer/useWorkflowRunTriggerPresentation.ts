'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
    if (triggerType === 'event') {
      return eventType
        ? t('trigger.eventWithType', { defaultValue: 'Event: {{eventType}}', eventType })
        : t('trigger.event', { defaultValue: 'Event' });
    }
    return t('trigger.manual', { defaultValue: 'Manual' });
  };
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
