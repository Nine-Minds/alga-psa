import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ begin: vi.fn(), upload: vi.fn(), publish: vi.fn(), abandon: vi.fn(), object: vi.fn(), customer: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(),
  user: { user_id: 'user', tenant: 'home', user_type: 'internal' }, knex: {},
  Forbidden: class extends Error {}, Lifecycle: class extends Error {}, Draft: class extends Error { constructor(public code: string) { super(code); } },
  Attachment: class extends Error { constructor(public code: string) { super(code); } }, Comment: class extends Error {}, Private: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/licensing', () => ({ CoManagedLifecycleError: mocks.Lifecycle }));
vi.mock('@alga-psa/co-managed', () => ({ beginCoManagedConversationDraft: mocks.begin, abandonCoManagedConversationDraft: mocks.abandon, uploadCoManagedDraftAttachment: mocks.upload, publishCoManagedConversationDraft: mocks.publish,
  CoManagedSharedWorkError: mocks.Forbidden, CoManagedConversationDraftError: mocks.Draft, CoManagedAttachmentError: mocks.Attachment, CoManagedCommentCreateError: mocks.Comment, CoManagedPrivateCommentError: mocks.Private }));
vi.mock('../../../lib/co-managed/conversationAttachments', () => ({ uploadConversationAttachmentObject: mocks.object }));
vi.mock('../../../lib/co-managed/createTicketComment', () => ({ createSharedTicketComment: mocks.customer }));
import { abandonCoManagedConversationDraftAction, beginCoManagedConversationDraftAction, uploadCoManagedDraftAttachmentAction, publishCoManagedConversationDraftAction } from '../../../lib/actions/coManagedConversationDraftActions';
const resource = { kind: 'ticket' as const, tenant: 'customer', relationshipId: 'relationship', id: 'ticket' };
const reference = { storeTenant: 'customer', operationId: 'operation' };
const request = { operationId: 'operation', audience: 'shared_it' as const, content: { text: 'Message' }, files: [{ attachmentId: 'file', fileName: 'File.txt', mimeType: 'text/plain', size: 5, contentHash: 'a'.repeat(64) }] };
const form = () => { const data = new FormData(); data.append('file', new Blob(['Bytes']), 'File.txt'); return data; };
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex }); mocks.session.mockResolvedValue({ session_id: 'session', user: { id: 'user', tenant: 'home', user_type: 'internal' } }); });
it('forwards immutable manifests, qualified targets, actual session identity and the production publication adapter without a flag dependency', async () => {
  mocks.begin.mockResolvedValue({ ...reference, status: 'draft', uploadedAttachmentIds: [] });
  expect((await beginCoManagedConversationDraftAction(resource, request)).ok).toBe(true);
  expect(mocks.begin).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home', userId: 'user', sessionId: 'session' }, resource, request);
  await uploadCoManagedDraftAttachmentAction(resource, reference, 'file', form());
  expect(mocks.upload.mock.calls[0].slice(2, 6)).toEqual([resource, reference, 'file', new TextEncoder().encode('Bytes')]);
  await mocks.upload.mock.calls[0][6]('qualified/path', new Uint8Array([1]), 'text/plain'); expect(mocks.object).toHaveBeenCalledWith('customer', 'qualified/path', new Uint8Array([1]), 'text/plain');
  await publishCoManagedConversationDraftAction(resource, reference); expect(mocks.publish.mock.calls[0].slice(2)).toEqual([resource, reference, mocks.customer]);
});
it.each(['api', 'client', 'missing', 'foreign-session'])('rejects %s credentials before any draft access', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue({}); if (kind === 'client') mocks.user.user_type = 'client'; if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign-session') mocks.session.mockResolvedValue({ session_id: 'session', user: { id: 'other', tenant: 'elsewhere', user_type: 'internal' } });
  expect(await beginCoManagedConversationDraftAction(resource, request)).toEqual({ ok: false, code: 'forbidden' });
  expect(await uploadCoManagedDraftAttachmentAction(resource, reference, 'file', form())).toEqual({ ok: false, code: 'forbidden' });
  expect(await publishCoManagedConversationDraftAction(resource, reference)).toEqual({ ok: false, code: 'forbidden' });
  expect(mocks.db).not.toHaveBeenCalled();
});
it('distinguishes incomplete uploads, operation conflicts, invalid manifests and uncertain publication', async () => {
  for (const [error, code] of [[new mocks.Draft('CONVERSATION_DRAFT_NOT_READY'), 'notReady'], [new mocks.Draft('CONVERSATION_DRAFT_CONFLICT'), 'operationConflict'],
    [new mocks.Draft('INVALID_CONVERSATION_DRAFT'), 'invalid'], [new mocks.Lifecycle(), 'readOnly'], [new Error('Lost commit response'), 'unknownOutcome']] as const) {
    mocks.publish.mockRejectedValue(error); expect(await publishCoManagedConversationDraftAction(resource, reference)).toEqual({ ok: false, code });
  }
  expect(await beginCoManagedConversationDraftAction(resource, { ...request, files: [null] } as any)).toEqual({ ok: false, code: 'invalid' });
  expect(await uploadCoManagedDraftAttachmentAction(resource, reference, 'file', new FormData())).toEqual({ ok: false, code: 'invalid' });
});

it('cancels only through the actual home session and preserves published and abandoned outcomes', async () => {
  for (const status of ['abandoned', 'published']) {
    mocks.abandon.mockResolvedValue({ status });
    expect(await abandonCoManagedConversationDraftAction(resource, reference)).toEqual({ ok: true, result: { status } });
  }
  expect(mocks.abandon).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home', userId: 'user', sessionId: 'session' }, resource, reference);
  mocks.override.mockReturnValue({}); expect(await abandonCoManagedConversationDraftAction(resource, reference)).toEqual({ ok: false, code: 'forbidden' });
  expect(mocks.abandon).toHaveBeenCalledTimes(2);
});
it('distinguishes discarded drafts from unknown outcomes so explicit resubmission can use a new operation', async () => {
  mocks.begin.mockRejectedValue(new mocks.Draft('CONVERSATION_DRAFT_ABANDONED'));
  expect(await beginCoManagedConversationDraftAction(resource, request)).toEqual({ ok: false, code: 'abandoned' });
});
