import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(), user: { user_id: 'requester', user_type: 'client', tenant: 'customer' }, Forbidden: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ getConnection: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({ CoManagedSharedWorkError: mocks.Forbidden }));
vi.mock('../../../lib/co-managed/portalAttachments', () => ({ listPortalConversationAttachments: mocks.list }));
import { getPortalConversationAttachmentsAction } from '../../../lib/actions/coManagedPortalAttachmentActions';
const target = { ticketId: 'ticket', threadId: 'thread', commentId: 'comment' };
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'client'; mocks.db.mockResolvedValue('db'); mocks.list.mockResolvedValue([]);
  mocks.session.mockResolvedValue({ session_id: 'tracked', user: { tenant: 'customer', id: 'requester', user_type: 'client' } }); });
it('returns only current requester attachment metadata with verified home identity and no flag dependency', async () => {
  expect(await getPortalConversationAttachmentsAction(target)).toEqual({ actor: { tenant: 'customer', userId: 'requester' }, attachments: [] });
  expect(mocks.list).toHaveBeenCalledWith('db', { kind: 'session', tenant: 'customer', userId: 'requester', sessionId: 'tracked' }, target);
});
it.each(['api', 'internal', 'missing', 'foreign'])('rejects %s credentials before querying attachments', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue({});
  if (kind === 'internal') mocks.user.user_type = 'internal';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { tenant: 'other', id: 'requester', user_type: 'client' } });
  await expect(getPortalConversationAttachmentsAction(target)).rejects.toBeInstanceOf(mocks.Forbidden); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
});
