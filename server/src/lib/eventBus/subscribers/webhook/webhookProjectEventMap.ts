import type { EventType } from '@alga-psa/event-schemas';

export type ProjectWebhookPublicEvent =
  | 'project.created'
  | 'project.updated'
  | 'project.status_changed'
  | 'project.assigned'
  | 'project.closed'
  | 'project.completed'
  | 'project.task.created'
  | 'project.task.updated'
  | 'project.task.status_changed'
  | 'project.task.assigned'
  | 'project.task.completed';

export type ProjectWebhookInternalEvent =
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_STATUS_CHANGED'
  | 'PROJECT_ASSIGNED'
  | 'PROJECT_CLOSED'
  | 'PROJECT_TASK_CREATED'
  | 'PROJECT_TASK_UPDATED'
  | 'PROJECT_TASK_STATUS_CHANGED'
  | 'PROJECT_TASK_ASSIGNED'
  | 'PROJECT_TASK_COMPLETED';

export const PROJECT_INTERNAL_TO_PUBLIC = {
  PROJECT_CREATED: ['project.created'],
  PROJECT_UPDATED: ['project.updated'],
  PROJECT_STATUS_CHANGED: ['project.status_changed'],
  PROJECT_ASSIGNED: ['project.assigned'],
  PROJECT_CLOSED: ['project.closed', 'project.completed'],
  PROJECT_TASK_CREATED: ['project.task.created'],
  PROJECT_TASK_UPDATED: ['project.task.updated'],
  PROJECT_TASK_STATUS_CHANGED: ['project.task.status_changed'],
  PROJECT_TASK_ASSIGNED: ['project.task.assigned'],
  PROJECT_TASK_COMPLETED: ['project.task.completed'],
} as const satisfies Partial<Record<EventType, readonly ProjectWebhookPublicEvent[]>>;

const PROJECT_TASK_INTERNAL_EVENTS = new Set<ProjectWebhookInternalEvent>([
  'PROJECT_TASK_CREATED',
  'PROJECT_TASK_UPDATED',
  'PROJECT_TASK_STATUS_CHANGED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_COMPLETED',
]);

export function publicEventsForProject(eventType: EventType | string): ProjectWebhookPublicEvent[] {
  const mapped = PROJECT_INTERNAL_TO_PUBLIC[eventType as ProjectWebhookInternalEvent];
  return mapped ? [...mapped] : [];
}

export function isProjectTaskEvent(eventType: EventType | string): boolean {
  return PROJECT_TASK_INTERNAL_EVENTS.has(eventType as ProjectWebhookInternalEvent);
}
