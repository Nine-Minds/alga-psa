import { describe, expect, it } from 'vitest';

import { EventSchemas } from './eventBusSchema';

// PROJECT_TASK_UPDATED is the shared event consumed by both the project
// webhook subscriber and the search index subscriber. Its canonical payload
// is ProjectTaskSearchEventPayloadSchema: { tenantId, projectId, taskId,
// phaseId?, userId?, timestamp?, changes? }.
const validEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  eventType: 'PROJECT_TASK_UPDATED',
  timestamp: '2026-05-15T13:00:00.000Z',
  payload: {
    tenantId: '00000000-0000-4000-8000-000000000002',
    projectId: '00000000-0000-4000-8000-000000000003',
    taskId: '00000000-0000-4000-8000-000000000004',
    phaseId: '00000000-0000-4000-8000-000000000005',
    userId: '00000000-0000-4000-8000-000000000006',
    timestamp: '2026-05-15T13:00:00.000Z',
    changes: {
      task_name: {
        previous: 'Original task',
        new: 'Updated task',
      },
    },
  },
};

describe('PROJECT_TASK_UPDATED event schema', () => {
  it('accepts a valid project task update payload', () => {
    expect(EventSchemas.PROJECT_TASK_UPDATED.safeParse(validEvent).success).toBe(true);
  });

  it('accepts a payload without the optional phaseId', () => {
    const event = {
      ...validEvent,
      payload: { ...validEvent.payload },
    };
    delete (event.payload as Record<string, unknown>).phaseId;

    expect(EventSchemas.PROJECT_TASK_UPDATED.safeParse(event).success).toBe(true);
  });

  it.each(['tenantId', 'projectId', 'taskId'] as const)(
    'rejects payloads missing %s',
    (field) => {
      const event = {
        ...validEvent,
        payload: {
          ...validEvent.payload,
        },
      };
      delete event.payload[field];

      expect(EventSchemas.PROJECT_TASK_UPDATED.safeParse(event).success).toBe(false);
    },
  );
});
