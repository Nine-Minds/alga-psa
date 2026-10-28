import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publishCommentEvent,
  registerCommentEventContributor,
  resetCommentEventContributors,
} from '../commentEventRegistry';
import {
  admitScheduledComment,
  registerScheduledCommentAdmission,
  resetScheduledCommentAdmission,
} from '../scheduledCommentAdmission';

const event = { tenantId: 't', ticketId: 'k', commentId: 'c', eventType: 'TICKET_COMMENT_ADDED' } as const;
const taskEvent = { tenantId: 't', taskId: 'task', commentId: 'c', eventType: 'TASK_COMMENT_ADDED' } as const;
const trx: any = new Proxy(function () {}, { get() { throw new Error('trx touched'); } });
const openTrx: any = { isTransaction: true };

afterEach(() => {
  resetCommentEventContributors();
  resetScheduledCommentAdmission();
  vi.restoreAllMocks();
});

describe('commentEventRegistry', () => {
  it('with no contributor runs the native publication exactly once', async () => {
    const native = vi.fn(async () => {});
    await expect(publishCommentEvent(trx, 'ticket', event, native)).resolves.toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('a contributor returning true suppresses native publication and later contributors', async () => {
    const native = vi.fn(async () => {});
    const later = vi.fn(async () => false);
    const first = vi.fn(async () => true);
    registerCommentEventContributor({ name: 'a', retain: first });
    registerCommentEventContributor({ name: 'b', retain: later });
    await expect(publishCommentEvent(openTrx, 'ticket', event, native)).resolves.toBe(true);
    expect(first).toHaveBeenCalledWith(openTrx, { source: 'ticket', event });
    expect(native).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });

  it('a contributor returning false falls through to native', async () => {
    const native = vi.fn(async () => {});
    registerCommentEventContributor({ name: 'a', retain: async () => false });
    await publishCommentEvent(openTrx, 'project-task', taskEvent, native);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('isolates a contributor error and continues', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const native = vi.fn(async () => {});
    registerCommentEventContributor({ name: 'bad', retain: async () => { throw new Error('x'); } });
    await expect(publishCommentEvent(openTrx, 'ticket', event, native)).resolves.toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-transaction connection once a contributor could write through it', async () => {
    const native = vi.fn(async () => {});
    const retain = vi.fn(async () => true);
    registerCommentEventContributor({ name: 'outbox', retain });
    const rootConnection: any = { isTransaction: false };
    await expect(publishCommentEvent(rootConnection, 'ticket', event, native)).rejects.toThrow('open transaction');
    expect(retain).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it('a contributor without retain does not trigger the transaction check', async () => {
    const native = vi.fn(async () => {});
    registerCommentEventContributor({ name: 'passive' });
    await expect(publishCommentEvent(trx, 'ticket', event, native)).resolves.toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('types: ids and event names are discriminated by source', () => {
    // @ts-expect-error a ticket event needs ticketId
    void (() => publishCommentEvent(openTrx, 'ticket', { tenantId: 't', commentId: 'c', eventType: 'TICKET_COMMENT_ADDED' }));
    // @ts-expect-error a project-task event cannot carry a ticket event name
    void (() => publishCommentEvent(openTrx, 'project-task', { tenantId: 't', taskId: 'x', commentId: 'c', eventType: 'TICKET_COMMENT_ADDED' }));
    // @ts-expect-error unknown event names are rejected
    void (() => publishCommentEvent(openTrx, 'ticket', { tenantId: 't', ticketId: 'k', commentId: 'c', eventType: 'TICKET_COMENT_ADDED' }));
    registerCommentEventContributor({
      name: 'typed',
      retain: async (_trx, envelope) => {
        const id: string = envelope.source === 'ticket' ? envelope.event.ticketId : envelope.event.taskId;
        return id.length < 0;
      },
    });
  });
});

describe('scheduledCommentAdmission', () => {
  it('admits by default and defers to a registered checker', async () => {
    const ctx = { tenant: 't', ticketId: 'k' };
    await expect(admitScheduledComment(ctx)).resolves.toBe(true);
    registerScheduledCommentAdmission(() => false);
    await expect(admitScheduledComment(ctx)).resolves.toBe(false);
  });
});
