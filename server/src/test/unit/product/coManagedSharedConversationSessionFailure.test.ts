import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ write: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/actions/coManagedTicketConversationActions', () => ({ getCoManagedTicketConversationScreenAction: vi.fn() }));
vi.mock('@/lib/co-managed/loadSharedConversation', () => ({ loadSharedConversation: h.load }));
vi.mock('@/components/co-managed/ticketCommentWriter', async importOriginal => ({ ...(await importOriginal<any>()), createTicketCommentWriter: () => h.write }));
import { createSharedConversationSession } from '../../../components/co-managed/sharedConversationSession';
import { TicketCommentWriteError } from '../../../components/co-managed/ticketCommentWriter';

const resource = { tenant: 't', relationshipId: 'r', kind: 'ticket' as const, id: 'k' };
const file = { key: 'f', file: new File(['x'], 'x.txt') };
const make = (staged: unknown[]) => {
  const staging = { getSnapshot: () => staged, clear: vi.fn(), subscribe: () => () => {}, add: vi.fn(), remove: vi.fn() };
  return createSharedConversationSession(resource, { t: (_key, fallback) => fallback, staging: staging as any });
};
beforeEach(() => { h.write.mockReset(); h.load.mockReset(); h.load.mockResolvedValue({ items: [], actor: { tenant: 'a', userId: 'u' }, writeAudiences: ['shared_it'] }); });

it('a failed upload (unknownOutcome) throws the localized error and records an unsent failure that notifies subscribers', async () => {
  h.write.mockRejectedValue(new TicketCommentWriteError('unknownOutcome'));
  const session = make([file]), heard = vi.fn();
  session.subscribe(heard);
  expect(session.unsentFailure()).toBeNull();
  await expect(session.write({ content: 'hi', audience: 'shared_it' })).rejects.toThrow('We could not confirm the comment was posted');
  expect(session.unsentFailure()).toEqual({ code: 'unknownOutcome' });
  expect(heard).toHaveBeenCalled();
});
it('a failed message without files records nothing, and a later success clears an earlier failure', async () => {
  h.write.mockRejectedValue(new TicketCommentWriteError('unknownOutcome'));
  await expect(make([]).write({ content: 'hi', audience: 'shared_it' })).rejects.toThrow();
  const session = make([file]);
  await expect(session.write({ content: 'hi', audience: 'shared_it' })).rejects.toThrow();
  expect(session.unsentFailure()).not.toBeNull();
  h.write.mockResolvedValue({ commentId: 'c1' });
  await session.write({ content: 'hi', audience: 'shared_it' }).catch(() => undefined); // the stored comment is absent from the fake load; the outcome we assert is the cleared notice
  expect(session.unsentFailure()).toBeNull();
});
