import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), list: vi.fn(), hint: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(),
  user: { user_id: 'home-user', tenant: 'home-tenant', user_type: 'internal' }, knex: {},
  Forbidden: class extends Error {}, Lifecycle: class extends Error {}, Command: class extends Error { constructor(public code: string) { super(code); } } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/licensing', () => ({ CoManagedLifecycleError: mocks.Lifecycle }));
vi.mock('@alga-psa/co-managed', () => ({ CoManagedSharedWorkError: mocks.Forbidden, CoManagedAttachmentError: mocks.Command, listCoManagedConversationAttachments: mocks.list, canManageCoManagedConversationAttachments: mocks.hint, removeCoManagedConversationAttachment: mocks.remove }));
vi.mock('../../../lib/co-managed/conversationAttachments', () => ({ uploadConversationAttachment: mocks.upload }));
import { removeCoManagedAttachmentAction, uploadCoManagedAttachmentAction, listCoManagedAttachmentsAction, getCoManagedAttachmentsScreenAction } from '../../../lib/actions/coManagedAttachmentActions';
const resource = { tenant: 'customer', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
const comment = { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' };
const form = () => { const value = new FormData(); value.append('file', new Blob(['Bytes'], { type: 'text/plain' }), 'Upload.txt'); return value; };
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { id: mocks.user.user_id, tenant: mocks.user.tenant, user_type: 'internal' } }); });
it('preserves qualified targets and actual browser identity without a release flag dependency', async () => {
  mocks.upload.mockResolvedValue({ attachmentId: 'upload' });
  expect(await uploadCoManagedAttachmentAction(resource, comment, 'upload', form())).toEqual({ ok: true, attachment: { attachmentId: 'upload' } });
  expect(mocks.upload).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home-tenant', userId: 'home-user', sessionId: 'tracked-session' }, resource,
    { attachmentId: 'upload', comment, fileName: 'Upload.txt', mimeType: 'text/plain', content: new TextEncoder().encode('Bytes') });
  await listCoManagedAttachmentsAction(resource, comment); expect(mocks.list.mock.calls[0].slice(2)).toEqual([resource, comment]);
});
it.each(['api', 'client', 'missing', 'foreign-session'])('rejects %s credentials before accessing attachments', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user);
  if (kind === 'client') mocks.user.user_type = 'client';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign-session') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'other', tenant: 'other', user_type: 'internal' } });
  expect(await uploadCoManagedAttachmentAction(resource, comment, 'upload', form())).toEqual({ ok: false, code: 'forbidden' });
  await expect(listCoManagedAttachmentsAction(resource, comment)).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});
it('distinguishes invalid files, conflicts and lifecycle rejection from uncertain transport or commit outcomes', async () => {
  expect(await uploadCoManagedAttachmentAction(resource, comment, 'upload', new FormData())).toEqual({ ok: false, code: 'invalid' });
  for (const [error, code] of [[new mocks.Command('INVALID_ATTACHMENT'), 'invalid'], [new mocks.Command('ATTACHMENT_OPERATION_CONFLICT'), 'operationConflict'],
    [new mocks.Lifecycle(), 'readOnly'], [new Error('Lost upload acknowledgement'), 'unknownOutcome']] as const) {
    mocks.upload.mockRejectedValue(error); expect(await uploadCoManagedAttachmentAction(resource, comment, 'upload', form())).toEqual({ ok: false, code });
  }
});

it('returns current attachment write hints and transport limits with the actual browser identity', async () => {
  mocks.hint.mockResolvedValue(false); mocks.list.mockResolvedValue([]);
  const result = await getCoManagedAttachmentsScreenAction(resource, comment);
  expect(result).toMatchObject({ canUpload: false, attachments: [], actor: { tenant: 'home-tenant', userId: 'home-user' } });
  expect(result.maxBytes).toBeGreaterThan(0); expect(result.maxBytes).toBeLessThan(20 * 1048576);
});

it('removes the immutable qualified attachment under the actual browser identity without a release-flag dependency', async () => {
  const attachment = { ...comment, attachmentId: 'file' };
  mocks.remove.mockResolvedValue({ ...attachment, removedAt: '2026-09-07T00:00:00.000Z' });
  expect(await removeCoManagedAttachmentAction(resource, attachment)).toEqual({ ok: true, receipt: { ...attachment, removedAt: '2026-09-07T00:00:00.000Z' } });
  expect(mocks.remove).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home-tenant', userId: 'home-user', sessionId: 'tracked-session' }, resource, attachment);
  mocks.override.mockReturnValue({}); expect(await removeCoManagedAttachmentAction(resource, attachment)).toEqual({ ok: false, code: 'forbidden' });
  expect(mocks.remove).toHaveBeenCalledOnce();
});
it('keeps removal available when upload transport is disabled, while respecting actual write hints', async () => {
  const old = process.env.SERVER_ACTIONS_BODY_LIMIT; process.env.SERVER_ACTIONS_BODY_LIMIT = '1kb';
  try {
    mocks.hint.mockResolvedValue(true); mocks.list.mockResolvedValue([]);
    expect(await getCoManagedAttachmentsScreenAction(resource, comment)).toMatchObject({ canUpload: false, canRemove: true });
    mocks.hint.mockResolvedValue(false);
    expect(await getCoManagedAttachmentsScreenAction(resource, comment)).toMatchObject({ canUpload: false, canRemove: false });
  } finally { if (old === undefined) delete process.env.SERVER_ACTIONS_BODY_LIMIT; else process.env.SERVER_ACTIONS_BODY_LIMIT = old; }
});
