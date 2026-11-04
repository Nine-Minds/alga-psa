import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), priv: vi.fn() }));
vi.mock('@/lib/actions/coManagedTicketCommentActions', () => ({ createCoManagedTicketCommentAction: mocks.create }));
vi.mock('@/lib/actions/coManagedPrivateTicketCommentActions', () => ({ saveCoManagedPrivateTicketCommentAction: mocks.priv }));
import { createTicketCommentWriter, registerCommentWriter, registerFileStager, resolveCommentWriter, resolveFileStager,
  resetCommentWriterRegistry, PLAIN_TEXT_WRITER, TicketCommentWriteError } from '../../../components/co-managed/ticketCommentWriter';
const resource = { tenant: 'customer', relationshipId: 'rel', kind: 'ticket' as const, id: 'ticket' };
const receipt = { commentId: 'c', storeTenant: 'customer', threadId: 't' };
const make = (over: Partial<{ actorTenant: string; writeAudiences: any[]; canWrite: boolean; files: unknown[] }> = {}) => createTicketCommentWriter({
  resource, parent: () => null, files: () => over.files ?? [],
  context: () => ({ canWrite: over.canWrite ?? true, actorTenant: over.actorTenant ?? 'msp', writeAudiences: over.writeAudiences ?? ['requester', 'shared_it', 'organization_private'] }) });
beforeEach(() => { vi.resetAllMocks(); resetCommentWriterRegistry(); });

it('ships only the plain-text writer and an empty native file-stager registry', () => {
  expect(resolveCommentWriter(PLAIN_TEXT_WRITER)).toBeTypeOf('function');
  expect(resolveCommentWriter('rich')).toBeUndefined();
  expect(resolveFileStager(PLAIN_TEXT_WRITER)).toBeUndefined();
});
it('registers additional writer kinds by name and resolves them', async () => {
  const sent = vi.fn().mockResolvedValue(receipt);
  registerCommentWriter('custom', () => sent);
  expect(await createTicketCommentWriter({ kind: 'custom', resource, parent: () => null, context: () => ({ canWrite: true, actorTenant: 'x', writeAudiences: [] }) })({ content: 'hi', audience: 'requester' })).toEqual(receipt);
  expect(sent).toHaveBeenCalledOnce();
  registerFileStager('custom', async () => ({ ok: true, receipt }));
  expect(resolveFileStager('custom')).toBeTypeOf('function');
  resetCommentWriterRegistry();
  expect(resolveCommentWriter('custom')).toBeUndefined(); expect(resolveFileStager('custom')).toBeUndefined();
});
it('refuses an unknown writer kind', () => {
  expect(() => createTicketCommentWriter({ kind: 'missing', resource, parent: () => null, context: () => ({ canWrite: true, actorTenant: 'x', writeAudiences: [] }) })).toThrow(TicketCommentWriteError);
});
it('refuses audiences the viewer cannot write and staged files no stager owns', async () => {
  await expect(make({ writeAudiences: ['shared_it'] })({ content: 'hi', audience: 'requester' })).rejects.toMatchObject({ code: 'forbidden' });
  await expect(make({ canWrite: false })({ content: 'hi', audience: 'requester' })).rejects.toMatchObject({ code: 'forbidden' });
  await expect(make({ files: [{}] })({ content: 'hi', audience: 'requester' })).rejects.toMatchObject({ code: 'invalid' });
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.priv).not.toHaveBeenCalled();
});
it('keeps one operation id across an uncertain acknowledgment and mints a new one after success', async () => {
  const write = make();
  mocks.create.mockResolvedValueOnce({ ok: false, code: 'unknownOutcome' }).mockResolvedValue({ ok: true, receipt });
  await expect(write({ content: 'hi', audience: 'shared_it' })).rejects.toMatchObject({ code: 'unknownOutcome' });
  await write({ content: 'hi', audience: 'shared_it' });
  await write({ content: 'hi', audience: 'shared_it' });
  const ids = mocks.create.mock.calls.map(call => call[1].operationId);
  expect(ids[0]).toBe(ids[1]); expect(ids[2]).not.toBe(ids[1]);
});
it('routes a foreign organization-private note to the private store, never the shared tenant', async () => {
  mocks.priv.mockResolvedValue({ ok: true, receipt });
  await make()({ content: 'secret', audience: 'organization_private' });
  expect(mocks.priv).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
});
