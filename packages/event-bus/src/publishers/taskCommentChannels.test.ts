import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builtWorkflowPayload } from '@alga-psa/event-schemas';
import { publishWorkflowEvent } from './index';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../index', () => ({ getEventBus: () => ({ publish }) }));

describe('task comment notification routing', () => {
  beforeEach(() => publish.mockReset());

  it.each([
    ['TASK_COMMENT_ADDED', ['global', 'internal-notifications', 'emailservice::v7']],
    ['TASK_COMMENT_UPDATED', ['global', 'internal-notifications']],
  ] as const)('delivers %s to its notification consumers', async (eventType, channels) => {
    const content = 'Private project discussion';
    await publishWorkflowEvent({
      eventType,
      payload: builtWorkflowPayload(eventType, { taskId: 'task', projectId: 'project', commentContent: content }),
      ctx: { tenantId: 'tenant', actor: { actorType: 'USER', actorUserId: 'author' } },
    });

    expect(publish.mock.calls.map(([, options]) => options.channel ?? 'global')).toEqual(channels);
    for (const [event] of publish.mock.calls) {
      expect(event).toMatchObject({ eventType, payload: { tenantId: 'tenant', commentContent: content } });
    }
  });
});
