/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real chain: provider -> data-source comment override -> real session.write -> real writer -> real registered stager ->
// real draft submission -> (mocked server actions) -> setUnsent -> real CoManagedConversationFiles -> real @alga-psa/ui Alert.
const h = vi.hoisted(() => ({
  native: { findCommentsByTicketId: vi.fn(), createComment: vi.fn(), addTicketCommentWithCache: vi.fn(), addTicketCommentWithCacheForCurrentUser: vi.fn() },
  staging: null as any,
  resource: vi.fn(), screen: vi.fn(), begin: vi.fn(), upload: vi.fn(), publish: vi.fn(), list: vi.fn(), createComment: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => ({ enabled: true }) }));
vi.mock('@alga-psa/tickets/lib/nativeTicketDataSource', () => ({ nativeTicketDataSource: { kind: 'native', conversation: {}, comments: h.native } }));
vi.mock('@/lib/actions/coManagedLocalTicketActions', () => ({ getCoManagedLocalTicketResourceAction: h.resource }));
vi.mock('@/lib/actions/coManagedTicketConversationActions', () => ({ getCoManagedTicketConversationScreenAction: h.screen }));
vi.mock('@/lib/actions/coManagedTicketCommentActions', () => ({ createCoManagedTicketCommentAction: h.createComment }));
vi.mock('@/lib/actions/coManagedPrivateTicketCommentActions', () => ({ saveCoManagedPrivateTicketCommentAction: vi.fn() }));
vi.mock('@/lib/actions/coManagedConversationDraftActions', () => ({
  beginCoManagedConversationDraftAction: h.begin, uploadCoManagedDraftAttachmentAction: h.upload, publishCoManagedConversationDraftAction: h.publish,
  listCoManagedConversationDraftsAction: h.list, abandonCoManagedConversationDraftAction: vi.fn(),
}));
vi.mock('@/lib/co-managed/attachmentStaging', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/co-managed/attachmentStaging')>();
  // Capture the staging instance the provider creates, so the test stages files exactly where the picker would.
  return { ...actual, createAttachmentStaging: (key: () => string) => (h.staging = actual.createAttachmentStaging(key)) };
});
vi.mock('@/lib/co-managed/attachmentUploadLimit', () => ({ coManagedAttachmentUploadLimit: () => 1024 }));
vi.mock('@/components/co-managed/SharedCommentAttachmentPicker', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedCommentAttachments', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedThreadDisclosure', () => ({ default: () => null }));

import { useTicketDataSource } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { CoManagedLocalTicketDataSourceProvider } from '@/components/co-managed/CoManagedLocalTicketDataSourceProvider';

const RESOURCE = { tenant: 'cust', relationshipId: 'r', kind: 'ticket', id: 'tk1' };
let source: any;
function Probe() { source = useTicketDataSource(); return null; }

const stagedFile = () => {
  const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('hello').buffer });
  return file;
};

// The composer's call (TicketDetailsContainer.handleAddComment): audience is the 9th argument.
const compose = () => source.comments.addTicketCommentWithCacheForCurrentUser('tk1', 'hello there', true, false, false, undefined, undefined, undefined, 'shared_it');

let items: any[];
async function mount() {
  render(<CoManagedLocalTicketDataSourceProvider ticketId="tk1"><Probe /></CoManagedLocalTicketDataSourceProvider>);
  await waitFor(() => expect(source.conversation.audiences).toContain('shared_it'));
  await waitFor(() => expect(document.getElementById('co-managed-conversation-files')).not.toBeNull());
}

describe('failed-upload alert, real chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items = [];
    h.resource.mockResolvedValue(RESOURCE);
    h.screen.mockImplementation(async () => ({ items, nextBefore: null, actor: { tenant: 'msp', userId: 'u1' }, writeAudiences: ['requester', 'shared_it', 'organization_private'] }));
    h.native.findCommentsByTicketId.mockResolvedValue([]);
    h.list.mockResolvedValue({ ok: true, drafts: [] });
    h.begin.mockImplementation(async (_r: unknown, request: any) => ({ ok: true, draft: { operationId: request.operationId, storeTenant: RESOURCE.tenant, status: 'draft', uploadedAttachmentIds: [] } }));
  });
  afterEach(() => cleanup());

  it('shows the unsent alert right away for an unknown outcome, leaves version alone, and drops it after the next successful write', async () => {
    await mount();
    h.staging.add([stagedFile()]);
    h.upload.mockRejectedValue(new Error('network down'));

    const outcome = await act(async () => compose());
    expect(outcome).toEqual({ actionError: expect.any(String) });
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.conversation.drafts.unsent');
    expect(h.screen).toHaveBeenCalledTimes(1); // the failure triggered no load (so `version` did not move)

    // Next write succeeds (files uploaded, draft published, conversation reloaded with the new comment).
    h.upload.mockResolvedValue({ ok: true });
    h.publish.mockImplementation(async () => {
      items = [{ storeTenant: RESOURCE.tenant, commentId: 'c-new', threadId: 'th', parentCommentId: null, audience: 'shared_it', createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null, deleted: false, revision: 1, note: 'hello there', markdown: 'hello there' }];
      return { ok: true, receipt: { commentId: 'c-new', storeTenant: RESOURCE.tenant, threadId: 'th' } };
    });
    const stored = await act(async () => compose());
    expect(stored).toMatchObject({ comment_id: 'c-new' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a definite refusal as itself', async () => {
    await mount();
    h.staging.add([stagedFile()]);
    h.begin.mockResolvedValue({ ok: false, code: 'forbidden' });
    await act(async () => { await compose(); });
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.editor.errors.forbidden');
  });

  it('shows nothing for a failed write that carried no files', async () => {
    await mount();
    h.createComment.mockRejectedValue(new Error('boom'));
    await act(async () => { await compose(); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  describe('retry after an uncertain outcome replays the same draft', () => {
    const named = (name: string, body = 'hello') => {
      const file = new File([body], name, { type: 'text/plain' });
      Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(body).buffer });
      return file;
    };
    const published = () => h.publish.mockImplementation(async () => {
      items = [{ storeTenant: RESOURCE.tenant, commentId: 'c-new', threadId: 'th', parentCommentId: null, audience: 'shared_it', createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null, deleted: false, revision: 1, note: 'hello there', markdown: 'hello there' }];
      return { ok: true, receipt: { commentId: 'c-new', storeTenant: RESOURCE.tenant, threadId: 'th' } };
    });
    const trackServerUploads = () => {
      const stored: string[] = [];
      h.begin.mockImplementation(async (_r: unknown, request: any) => ({ ok: true, draft: { operationId: request.operationId, storeTenant: RESOURCE.tenant, status: 'draft', uploadedAttachmentIds: [...stored] } }));
      return stored;
    };

    it('sends an identical begin request, uploads only the missing file, publishes once and clears the alert', async () => {
      await mount();
      const stored = trackServerUploads();
      h.staging.add([named('a.txt', 'aaa'), named('b.txt', 'bbb')]);
      h.upload.mockImplementationOnce(async (_r: unknown, _ref: unknown, id: string) => { stored.push(id); return { ok: true }; })
        .mockRejectedValueOnce(new Error('network down'));
      await act(async () => compose());
      expect(screen.getByRole('alert')).toBeInTheDocument();

      h.upload.mockImplementation(async (_r: unknown, _ref: unknown, id: string) => { stored.push(id); return { ok: true }; });
      published();
      const stored2 = await act(async () => compose());
      expect(stored2).toMatchObject({ comment_id: 'c-new' });

      expect(h.begin).toHaveBeenCalledTimes(2);
      expect(h.begin.mock.calls[1][1]).toEqual(h.begin.mock.calls[0][1]);
      const request = h.begin.mock.calls[0][1];
      expect(h.upload).toHaveBeenCalledTimes(3); // a, b (failed), then only b again
      expect(h.upload.mock.calls[2][2]).toBe(request.files[1].attachmentId);
      expect(h.publish).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('gives byte-identical files distinct ids', async () => {
      await mount();
      h.staging.add([named('same.txt'), named('same.txt')]);
      h.upload.mockRejectedValue(new Error('down'));
      await act(async () => compose());
      const ids = h.begin.mock.calls[0][1].files.map((f: any) => f.attachmentId);
      expect(new Set(ids).size).toBe(2);
    });

    it('starts a fresh operation when the set of files changes', async () => {
      await mount();
      h.staging.add([named('a.txt', 'aaa')]);
      h.upload.mockRejectedValue(new Error('down'));
      await act(async () => compose());
      const [first] = h.staging.getSnapshot();
      h.staging.remove(first.key);
      h.staging.add([named('a.txt', 'aaa')]); // same bytes, a different staged entry
      await act(async () => compose());
      const [one, two] = [h.begin.mock.calls[0][1], h.begin.mock.calls[1][1]];
      expect(two.operationId).not.toBe(one.operationId);
      expect(two.files[0].attachmentId).not.toBe(one.files[0].attachmentId);
    });

    it('starts a fresh operation when the message text changes', async () => {
      await mount();
      h.staging.add([named('a.txt', 'aaa')]);
      h.upload.mockRejectedValue(new Error('down'));
      await act(async () => compose());
      await act(async () => source.comments.addTicketCommentWithCacheForCurrentUser('tk1', 'different words', true, false, false, undefined, undefined, undefined, 'shared_it'));
      const [one, two] = [h.begin.mock.calls[0][1], h.begin.mock.calls[1][1]];
      expect(two.operationId).not.toBe(one.operationId);
      expect(two.files[0].attachmentId).not.toBe(one.files[0].attachmentId);
    });
  });

  it('lists the unsent draft again as soon as the send fails, without a load or a comments-changed signal', async () => {
    await mount();
    h.staging.add([stagedFile()]);
    h.upload.mockRejectedValue(new Error('down'));
    const listed = h.list.mock.calls.length;
    await act(async () => compose());
    await waitFor(() => expect(h.list.mock.calls.length).toBeGreaterThan(listed));
    expect(h.screen).toHaveBeenCalledTimes(1);
  });

  it('clears the staged files when the composer Cancel hook fires', async () => {
    await mount();
    h.staging.add([stagedFile()]);
    expect(h.staging.getSnapshot()).toHaveLength(1);
    act(() => source.screen.onComposerCancel());
    expect(h.staging.getSnapshot()).toHaveLength(0);
  });
});
