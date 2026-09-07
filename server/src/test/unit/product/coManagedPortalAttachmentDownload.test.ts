import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ download: vi.fn(), provider: vi.fn(), bytes: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(), Forbidden: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ getConnection: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({ CoManagedSharedWorkError: mocks.Forbidden }));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({ StorageProviderFactory: { createProvider: mocks.provider } }));
vi.mock('../../../lib/co-managed/portalAttachments', () => ({ downloadPortalConversationAttachment: mocks.download }));
import { GET } from '../../../app/api/client-portal/conversation-attachments/[attachmentId]/route';
const request = () => ({ nextUrl: new URL('https://alga.test/api/client-portal/conversation-attachments/file?ticketId=ticket&threadId=thread&commentId=comment&storeTenant=foreign') }) as any;
const params = { params: Promise.resolve({ attachmentId: 'file' }) };
beforeEach(() => { vi.resetAllMocks(); mocks.db.mockResolvedValue('db'); mocks.provider.mockResolvedValue({ download: mocks.bytes });
  mocks.session.mockResolvedValue({ session_id: 'session', user: { id: 'requester', tenant: 'customer', user_type: 'client' } }); });
it('binds the store to the requester session and transports only an authorized path with non-executable response headers', async () => {
  mocks.bytes.mockResolvedValue(Buffer.from('<script>literal</script>'));
  mocks.download.mockImplementation(async (_db, _actor, _target, _id, transfer) => ({ attachment: { fileName: 'Résumé "note".html' }, content: await transfer('authorized/path') }));
  const result = await GET(request(), params);
  expect(mocks.download).toHaveBeenCalledWith('db', { kind: 'session', tenant: 'customer', userId: 'requester', sessionId: 'session' },
    { ticketId: 'ticket', threadId: 'thread', commentId: 'comment' }, 'file', expect.any(Function));
  expect(mocks.bytes).toHaveBeenCalledWith('authorized/path'); expect(await result.text()).toBe('<script>literal</script>');
  expect(result.headers.get('content-type')).toBe('application/octet-stream'); expect(result.headers.get('cache-control')).toBe('no-store, private');
  expect(result.headers.get('content-security-policy')).toContain('sandbox'); expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  expect(result.headers.get('content-disposition')).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%22note%22.html");
});
it.each(['api', 'internal', 'missing'])('rejects %s credentials before storage access', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue({});
  if (kind === 'internal') mocks.session.mockResolvedValue({ session_id: 'session', user: { id: 'actor', tenant: 'customer', user_type: 'internal' } });
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  expect((await GET(request(), params)).status).toBe(401); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
});
it('returns opaque denials and storage failures without disclosing paths', async () => {
  mocks.download.mockRejectedValue(new mocks.Forbidden()); expect((await GET(request(), params)).status).toBe(404);
  mocks.download.mockRejectedValue(new Error('private/storage')); const response = await GET(request(), params);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private/storage'); expect(mocks.provider).not.toHaveBeenCalled();
});
