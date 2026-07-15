import { describe, expect, it } from 'vitest';

import { EventSchemas } from './eventBusSchema';

const baseEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  timestamp: '2026-07-15T12:00:00.000Z',
};

describe('project billing event schemas', () => {
  it.each(['phase', 'date', 'manual'] as const)(
    'accepts milestone readiness triggered by %s',
    (trigger) => {
      const result = EventSchemas.PROJECT_MILESTONE_READY.safeParse({
        ...baseEvent,
        eventType: 'PROJECT_MILESTONE_READY',
        payload: {
          tenantId: '00000000-0000-4000-8000-000000000002',
          projectId: '00000000-0000-4000-8000-000000000003',
          entryId: '00000000-0000-4000-8000-000000000004',
          description: 'Design approval',
          computedAmount: 12500,
          trigger,
        },
      });

      expect(result.success).toBe(true);
    },
  );

  it('accepts newly recorded project budget threshold crossings', () => {
    const result = EventSchemas.PROJECT_BUDGET_THRESHOLD_REACHED.safeParse({
      ...baseEvent,
      eventType: 'PROJECT_BUDGET_THRESHOLD_REACHED',
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000002',
        projectId: '00000000-0000-4000-8000-000000000003',
        threshold: 80,
        billed: 80000,
        cap: 100000,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects negative currency amounts', () => {
    const result = EventSchemas.PROJECT_MILESTONE_READY.safeParse({
      ...baseEvent,
      eventType: 'PROJECT_MILESTONE_READY',
      payload: {
        tenantId: '00000000-0000-4000-8000-000000000002',
        projectId: '00000000-0000-4000-8000-000000000003',
        entryId: '00000000-0000-4000-8000-000000000004',
        description: 'Design approval',
        computedAmount: -1,
        trigger: 'manual',
      },
    });

    expect(result.success).toBe(false);
  });
});
