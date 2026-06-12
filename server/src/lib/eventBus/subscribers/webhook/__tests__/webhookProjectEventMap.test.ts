import { describe, expect, it } from 'vitest';

import {
  PROJECT_INTERNAL_TO_PUBLIC,
  isProjectTaskEvent,
  publicEventsForProject,
} from '../webhookProjectEventMap';

describe('webhookProjectEventMap', () => {
  it('maps every project internal event to the expected public event', () => {
    expect(PROJECT_INTERNAL_TO_PUBLIC).toEqual({
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
    });

    expect(publicEventsForProject('PROJECT_CLOSED')).toEqual(['project.closed', 'project.completed']);
    expect(publicEventsForProject('UNKNOWN')).toEqual([]);
  });

  it('identifies only project task internal events as task events', () => {
    expect(isProjectTaskEvent('PROJECT_TASK_CREATED')).toBe(true);
    expect(isProjectTaskEvent('PROJECT_TASK_UPDATED')).toBe(true);
    expect(isProjectTaskEvent('PROJECT_TASK_STATUS_CHANGED')).toBe(true);
    expect(isProjectTaskEvent('PROJECT_TASK_ASSIGNED')).toBe(true);
    expect(isProjectTaskEvent('PROJECT_TASK_COMPLETED')).toBe(true);
    expect(isProjectTaskEvent('PROJECT_CREATED')).toBe(false);
    expect(isProjectTaskEvent('PROJECT_CLOSED')).toBe(false);
  });
});
