import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ download: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(), Forbidden: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ getConnection: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({ CoManagedSharedWorkError: mocks.Forbidden }));
vi.mock('../../../lib/co-managed/conversationAttachments', () => ({ downloadConversationAttachment: mocks.download }));
import { GET } from '../../../app/api/co-management/attachments/[attachmentId]/route';
const request = () => ({ nextUrl: new URL('https://alga.test/api/co-management/attachments/file?customerTenant=customer&relationshipId=relationship&ticketId=ticket&storeTenant=customer&threadId=thread&commentId=comment') }) as any;
const params = { params: Promise.resolve({ attachmentId: 'file' }) };
beforeEach(() => { vi.resetAllMocks(); mocks.db.mockResolvedValue('db'); mocks.session.mockResolvedValue({ session_id: 'session', user: { id: 'actor', tenant: 'home', user_type: 'internal' } }); });
it('qualifies the complete target and serves a private, non-executable download with safe Unicode filename headers', async () => {
  mocks.download.mockResolvedValue({ attachment: { fileName: 'Résumé "bad".html' }, content: Buffer.from('<script>literal</script>') });
  const result = await GET(request(), params);
  expect(result.status).toBe(200); expect(await result.text()).toBe('<script>literal</script>');
  expect(result.headers.get('content-type')).toBe('application/octet-stream'); expect(result.headers.get('cache-control')).toBe('no-store, private');
  expect(result.headers.get('content-security-policy')).toContain('sandbox'); expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  expect(result.headers.get('content-disposition')).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%22bad%22.html");
  expect(mocks.download).toHaveBeenCalledWith('db', { kind: 'session', tenant: 'home', userId: 'actor', sessionId: 'session' },
    { kind: 'ticket', tenant: 'customer', relationshipId: 'relationship', id: 'ticket' }, { attachmentId: 'file', storeTenant: 'customer', threadId: 'thread', commentId: 'comment' });
});
it.each(['api', 'client', 'missing'])('rejects %s credentials before file transport', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue({});
  if (kind === 'client') mocks.session.mockResolvedValue({ session_id: 'session', user: { id: 'actor', tenant: 'home', user_type: 'client' } });
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  expect((await GET(request(), params)).status).toBe(401); expect(mocks.download).not.toHaveBeenCalled();
});
it('returns an opaque denial and never exposes transport details or storage paths', async () => {
  mocks.download.mockRejectedValue(new mocks.Forbidden()); const denied = await GET(request(), params); expect(denied.status).toBe(404);
  mocks.download.mockRejectedValue(new Error('private/storage/path')); const failed = await GET(request(), params); expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('private/storage/path'); expect(failed.headers.get('cache-control')).toBe('no-store, private');
});
it('qualifies a task parent and rejects mixed or repeated parent selectors before transport', async () => {
  mocks.download.mockResolvedValue({ attachment: { fileName: 'task.txt' }, content: Buffer.from('Task') });
  const task = request(); task.nextUrl.searchParams.delete('ticketId'); task.nextUrl.searchParams.set('taskId', 'task');
  expect((await GET(task, params)).status).toBe(200);
  expect(mocks.download.mock.calls[0][2]).toEqual({ kind: 'project_task', tenant: 'customer', relationshipId: 'relationship', id: 'task' });
  mocks.download.mockClear(); task.nextUrl.searchParams.append('taskId', 'other');
  expect((await GET(task, params)).status).toBe(404); expect(mocks.download).not.toHaveBeenCalled();
  task.nextUrl.searchParams.set('taskId', 'task'); task.nextUrl.searchParams.set('ticketId', 'task');
  expect((await GET(task, params)).status).toBe(404); expect(mocks.download).not.toHaveBeenCalled();
});
