import { File } from 'node:buffer';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ begin: vi.fn(), upload: vi.fn(), publish: vi.fn() }));
vi.mock('../../../lib/actions/coManagedConversationDraftActions', () => ({ beginCoManagedConversationDraftAction: mocks.begin,
  uploadCoManagedDraftAttachmentAction: mocks.upload, publishCoManagedConversationDraftAction: mocks.publish }));
import { prepareConversationDraft, submitConversationDraft } from '../../../components/co-managed/conversationDraftSubmission';
const resource = { tenant: randomUUID(), relationshipId: randomUUID(), kind: 'ticket' as const, id: randomUUID() };
const home = randomUUID();
const input = () => ({ resource: { ...resource }, actorTenant: home, operationId: randomUUID(), audience: 'shared_it' as const,
  document: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Message', styles: {} }] }],
  files: [new File(['one'], 'one.txt', { type: 'text/plain' }), new File(['two'], 'two.txt')] as unknown as globalThis.File[] });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto);
  mocks.begin.mockImplementation(async (_resource, request) => ({ ok: true, draft: { operationId: request.operationId,
    storeTenant: request.parent?.storeTenant ?? (request.audience === 'organization_private' ? home : resource.tenant), status: 'draft', uploadedAttachmentIds: [] } }));
  mocks.upload.mockResolvedValue({ ok: true }); mocks.publish.mockResolvedValue({ ok: true, receipt: {} });
});
afterEach(() => vi.unstubAllGlobals());
it('captures content and qualified destination before hashing immutable files and preserves each digest', async () => {
  const request = input(), original = request.files.slice(), pending = prepareConversationDraft(request);
  request.document[0].content[0].text = 'Changed'; request.resource.id = randomUUID(); request.files.length = 0;
  const prepared = await pending;
  expect(prepared.resource).toEqual(resource); expect(prepared.request.content.document?.[0].content).toEqual([{ type: 'text', text: 'Message', styles: {} }]);
  expect(prepared.files.map(item => item.file)).toEqual(original);
  expect(prepared.request.files).toEqual(['one', 'two'].map((value, index) => ({ attachmentId: prepared.files[index].attachmentId,
    fileName: `${value}.txt`, mimeType: index ? 'application/octet-stream' : 'text/plain', size: 3, contentHash: createHash('sha256').update(value).digest('hex') })));
});
it('uses the parent store and displayed audience for replies, including both private organizations', async () => {
  const parent = { storeTenant: home, threadId: randomUUID(), commentId: randomUUID() };
  const reply = await prepareConversationDraft({ ...input(), parent, audience: 'organization_private' });
  expect(reply.storeTenant).toBe(home); expect(reply.request).toMatchObject({ parent, expectedAudience: 'organization_private' });
  expect(reply.request.audience).toBeUndefined();
  expect((await prepareConversationDraft({ ...input(), audience: 'organization_private' })).storeTenant).toBe(home);
  expect((await prepareConversationDraft({ ...input(), actorTenant: resource.tenant, audience: 'organization_private' })).storeTenant).toBe(resource.tenant);
});
it('waits for all files before publication and skips acknowledged files on a retry with the same IDs', async () => {
  const prepared = await prepareConversationDraft(input()), progress = vi.fn();
  mocks.upload.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('Lost acknowledgement'));
  await expect(submitConversationDraft(prepared, () => true, progress)).rejects.toThrow('Lost acknowledgement');
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.begin.mockResolvedValueOnce({ ok: true, draft: { storeTenant: resource.tenant, operationId: prepared.request.operationId,
    status: 'draft', uploadedAttachmentIds: [prepared.files[0].attachmentId] } });
  expect(await submitConversationDraft(prepared, () => true, progress)).toMatchObject({ ok: true });
  expect(mocks.begin.mock.calls[1]).toEqual(mocks.begin.mock.calls[0]);
  expect(mocks.upload.mock.calls.map(call => call[2])).toEqual([prepared.files[0].attachmentId, prepared.files[1].attachmentId, prepared.files[1].attachmentId]);
  expect(await (mocks.upload.mock.calls[2][3].get('file') as globalThis.File).text()).toBe('two');
  expect(mocks.publish).toHaveBeenCalledOnce(); expect(progress).toHaveBeenLastCalledWith({ phase: 'publishing', completed: 2, total: 2 });
});
it('recovers lost begin and publish acknowledgements without allocating another message or reuploading published files', async () => {
  const prepared = await prepareConversationDraft(input());
  mocks.begin.mockRejectedValueOnce(new Error('Lost begin'));
  await expect(submitConversationDraft(prepared, () => true, vi.fn())).rejects.toThrow(); expect(mocks.upload).not.toHaveBeenCalled();
  mocks.publish.mockRejectedValueOnce(new Error('Lost publish'));
  await expect(submitConversationDraft(prepared, () => true, vi.fn())).rejects.toThrow('Lost publish');
  mocks.begin.mockResolvedValueOnce({ ok: true, draft: { storeTenant: resource.tenant, operationId: prepared.request.operationId, status: 'published', uploadedAttachmentIds: [] } });
  expect(await submitConversationDraft(prepared, () => true, vi.fn())).toMatchObject({ ok: true });
  expect(mocks.upload).toHaveBeenCalledTimes(2); expect(mocks.publish.mock.calls[1]).toEqual(mocks.publish.mock.calls[0]);
});
it.each(['begin', 'upload'])('stops after access or identity changes during %s', async phase => {
  const prepared = await prepareConversationDraft(input()); let current = true;
  const action = phase === 'begin' ? mocks.begin : mocks.upload;
  action.mockImplementationOnce(async () => { current = false; return { ok: true }; });
  expect(await submitConversationDraft(prepared, () => current, vi.fn())).toEqual({ ok: false, code: 'aborted' });
  expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.upload).toHaveBeenCalledTimes(phase === 'begin' ? 0 : 1);
});
it.each(['begin', 'upload'])('does not publish after an explicit %s rejection', async phase => {
  const prepared = await prepareConversationDraft(input());
  (phase === 'begin' ? mocks.begin : mocks.upload).mockResolvedValueOnce({ ok: false, code: 'forbidden' });
  expect(await submitConversationDraft(prepared, () => true, vi.fn())).toEqual({ ok: false, code: 'forbidden' }); expect(mocks.publish).not.toHaveBeenCalled();
});
it('rejects inconsistent server draft identity before transferring any bytes', async () => {
  const prepared = await prepareConversationDraft(input());
  mocks.begin.mockResolvedValueOnce({ ok: true, draft: { storeTenant: home, operationId: prepared.request.operationId, status: 'draft', uploadedAttachmentIds: [] } });
  await expect(submitConversationDraft(prepared, () => true, vi.fn())).rejects.toThrow('Unexpected draft identity');
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
});
