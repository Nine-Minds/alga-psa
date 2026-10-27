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

const event = { tenantId: 't', ticketId: 'k', commentId: 'c' };
const trx: any = new Proxy(function () {}, { get() { throw new Error('trx touched'); } });

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
    registerCommentEventContributor({ name: 'a', retain: async () => true });
    registerCommentEventContributor({ name: 'b', retain: later });
    await expect(publishCommentEvent({} as any, 'ticket', event, native)).resolves.toBe(true);
    expect(native).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });

  it('a contributor returning false falls through to native', async () => {
    const native = vi.fn(async () => {});
    registerCommentEventContributor({ name: 'a', retain: async () => false });
    await publishCommentEvent({} as any, 'project-task', event, native);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('isolates a contributor error and continues', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const native = vi.fn(async () => {});
    registerCommentEventContributor({ name: 'bad', retain: async () => { throw new Error('x'); } });
    await expect(publishCommentEvent({} as any, 'ticket', event, native)).resolves.toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
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
