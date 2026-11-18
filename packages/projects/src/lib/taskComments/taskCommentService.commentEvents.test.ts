import { afterEach, describe, expect, it, vi } from 'vitest';

const publishEvent = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEvent = vi.hoisted(() => vi.fn(async () => undefined));

const row = { user_id: 'u1', task_id: 'task1', note: 'old', project_id: 'p1', task_name: 'T' };
function chain(): any {
  const target: any = {
    first: async () => row,
    update: async () => 1,
  };
  return new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : prop === 'then' ? undefined : () => chain()),
  });
}

vi.mock('@alga-psa/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({ isTransaction: true }),
  tenantDb: () => ({ table: () => chain(), tenantJoin: () => undefined }),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent, publishWorkflowEvent }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: () => 'md' }));

import { updateTaskCommentWithDb } from './taskCommentService';
import { registerCommentEventContributor, resetCommentEventContributors } from '@alga-psa/db/commentEventRegistry';

const user = { user_id: 'u1', user_type: 'internal' as const };

afterEach(() => {
  resetCommentEventContributors();
  vi.clearAllMocks();
});

describe('task comment update routes publication through the comment-event registry', () => {
  it('publishes both native events, in order, when no contributor is registered', async () => {
    await updateTaskCommentWithDb({} as any, 't1', user, 'c1', { note: 'new' });
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEvent.mock.invocationCallOrder[0]).toBeLessThan(publishEvent.mock.invocationCallOrder[0]);
  });

  it('a contributor that retains the event suppresses native publication', async () => {
    const retain = vi.fn(async () => true);
    registerCommentEventContributor({ name: 'outbox', retain });
    await updateTaskCommentWithDb({} as any, 't1', user, 'c1', { note: 'new' });
    expect(retain).toHaveBeenCalledWith(expect.anything(), {
      source: 'project-task',
      event: expect.objectContaining({ tenantId: 't1', taskId: 'task1', commentId: 'c1', eventType: 'TASK_COMMENT_UPDATED' }),
    });
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('a contributor that declines leaves native publication intact', async () => {
    registerCommentEventContributor({ name: 'noop', retain: async () => false });
    await updateTaskCommentWithDb({} as any, 't1', user, 'c1', { note: 'new' });
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});
