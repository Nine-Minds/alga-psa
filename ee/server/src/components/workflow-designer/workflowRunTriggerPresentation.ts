export type WorkflowRunTriggerType = 'event' | 'schedule' | 'recurring' | null | undefined;
export type WorkflowScheduleStatus = 'scheduled' | 'paused' | 'disabled' | 'completed' | 'failed' | null | undefined;

export const isTimeTriggeredRun = (triggerType: WorkflowRunTriggerType): boolean =>
  triggerType === 'schedule' || triggerType === 'recurring';

export const getWorkflowRunTriggerLabel = (
  triggerType: WorkflowRunTriggerType,
  eventType?: string | null
): string => {
  if (triggerType === 'schedule') return 'One-time schedule';
  if (triggerType === 'recurring') return 'Recurring schedule';
  if (triggerType === 'event') return eventType ? `Event: ${eventType}` : 'Event';
  return 'Manual';
};

export const getWorkflowScheduleStatusLabel = (status: WorkflowScheduleStatus): string => {
  if (!status) return 'Unknown';
  switch (status) {
    case 'scheduled':
      return 'Scheduled';
    case 'paused':
      return 'Paused';
    case 'disabled':
      return 'Disabled';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
};

export const getWorkflowScheduleStatusBadgeClass = (status: WorkflowScheduleStatus): string => {
  switch (status) {
    case 'scheduled':
      return 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30';
    case 'paused':
      return 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30';
    case 'disabled':
      return 'bg-gray-500/15 text-gray-600 border-gray-500/30';
    case 'completed':
      return 'bg-green-500/15 text-green-600 border-green-500/30';
    case 'failed':
      return 'bg-red-500/15 text-red-600 border-red-500/30';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
};
