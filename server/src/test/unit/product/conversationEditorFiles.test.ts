import { beforeEach, expect, it, vi } from 'vitest';
import type { EditorDraftStoreScope } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { selectConversationEditorFiles } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: () => {
  const query = {
    where: () => query, whereNull: () => query, whereIn: () => query,
    modify: (apply: (query: unknown) => void) => { apply(query); return query; },
    forShare: mocks.read,
  };
  return query;
} }) }));

const scope = {
  trx: { isTransaction: true }, actor: { tenant: 'author', userId: 'user' },
  ticket: { tenant: 'customer', ticketId: 'ticket' },
  conversation: { storeTenant: 'customer', conversationId: 'conversation' }, conversationRevision: 1,
} as EditorDraftStoreScope;
const first = { attachment_id: 'first', file_name: 'first.txt', mime_type: 'text/plain', file_size: 5, content_hash: 'first-hash' };
const second = { ...first, attachment_id: 'second', file_name: 'second.txt', file_size: 10, content_hash: 'second-hash' };
beforeEach(() => vi.resetAllMocks());

it('preserves requested attachment order and reads metadata from the admitted rows', async () => {
  mocks.read.mockResolvedValue([second, first]);
  await expect(selectConversationEditorFiles(scope, [{ attachmentId: 'first' }, { attachmentId: 'second' }])).resolves.toEqual([
    { attachmentId: 'first', fileName: 'first.txt', mimeType: 'text/plain', size: 5, contentHash: 'first-hash' },
    { attachmentId: 'second', fileName: 'second.txt', mimeType: 'text/plain', size: 10, contentHash: 'second-hash' },
  ]);
});

it.each([{ rows: [first] }, { rows: [first, first] }])('denies a missing requested attachment even when row counts match', async ({ rows }) => {
  mocks.read.mockResolvedValue(rows);
  await expect(selectConversationEditorFiles(scope, [{ attachmentId: 'first' }, { attachmentId: 'second' }]))
    .rejects.toMatchObject({ code: 'CONVERSATION_FORBIDDEN' });
});

it('enforces the aggregate attachment limit using stored file sizes', async () => {
  mocks.read.mockResolvedValue([{ ...first, file_size: 26214400 }, second]);
  await expect(selectConversationEditorFiles(scope, [{ attachmentId: 'first' }, { attachmentId: 'second' }]))
    .rejects.toMatchObject({ code: 'CONVERSATION_INVALID' });
});
