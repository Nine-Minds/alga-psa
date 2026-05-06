/* @vitest-environment jsdom */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  uploadDocument: vi.fn(),
}));

vi.mock('../../actions/comment-actions/clipboardImageDraftActions', () => ({
  deleteDraftClipboardImages: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionPermissionError: () => false,
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function createUploadResult(documentId: string, fileId = `file-${documentId}`) {
  return {
    success: true,
    document: {
      document_id: documentId,
      file_id: fileId,
      document_name: `${documentId}.png`,
    },
  };
}

async function loadHook() {
  return import('./useTicketRichTextUploadSession');
}

describe('useTicketRichTextUploadSession', () => {
  it('rejects missing ticket or user context before upload', async () => {
    const { useTicketRichTextUploadSession } = await loadHook();
    const uploadDocumentAction = vi.fn();
    const toastApi = { error: vi.fn(), success: vi.fn() };

    const { result: missingTicket } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'TicketInfo',
        ticketId: null,
        userId: 'user-1',
        trackDraftUploads: true,
        onDiscard: vi.fn(),
        uploadDocumentAction,
        toastApi,
      })
    );

    await expect(missingTicket.current.uploadFile(new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow(
      'Ticket ID is required for clipboard image upload.'
    );

    const { result: missingUser } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'TicketInfo',
        ticketId: 'ticket-1',
        userId: null,
        trackDraftUploads: true,
        onDiscard: vi.fn(),
        uploadDocumentAction,
        toastApi,
      })
    );

    await expect(missingUser.current.uploadFile(new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow(
      'User session is required for clipboard image upload.'
    );
    expect(uploadDocumentAction).not.toHaveBeenCalled();
  });

  it('rejects invalid clipboard files before upload', async () => {
    const { useTicketRichTextUploadSession } = await loadHook();
    const uploadDocumentAction = vi.fn();

    const { result } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'TicketInfo',
        ticketId: 'ticket-1',
        userId: 'user-1',
        trackDraftUploads: true,
        onDiscard: vi.fn(),
        uploadDocumentAction,
        toastApi: { error: vi.fn(), success: vi.fn() },
      })
    );

    await expect(result.current.uploadFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(
      'Only image clipboard content can be attached to ticket comments.'
    );
    expect(uploadDocumentAction).not.toHaveBeenCalled();
  });

  it('uploads images, refreshes documents, and tracks drafts only when enabled', async () => {
    const { useTicketRichTextUploadSession } = await loadHook();
    const uploadDocumentAction = vi
      .fn()
      .mockResolvedValueOnce(createUploadResult('doc-1', 'file-1'))
      .mockResolvedValueOnce(createUploadResult('doc-1', 'file-1'))
      .mockResolvedValueOnce(createUploadResult('doc-2', 'file-2'));
    const onDocumentsChanged = vi.fn();

    const { result } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'TicketInfo',
        ticketId: 'ticket-1',
        userId: 'user-1',
        trackDraftUploads: true,
        onDiscard: vi.fn(),
        onDocumentsChanged,
        uploadDocumentAction,
        toastApi: { error: vi.fn(), success: vi.fn() },
      })
    );

    let firstUrl = '';
    await act(async () => {
      firstUrl = await result.current.uploadFile(new File(['1'], 'one.png', { type: 'image/png' }));
      await result.current.uploadFile(new File(['1'], 'one-again.png', { type: 'image/png' }));
    });

    expect(firstUrl).toBe('/api/documents/view/file-1');
    await waitFor(() => expect(result.current.draftClipboardImages).toHaveLength(1));
    expect(onDocumentsChanged).toHaveBeenCalledTimes(2);

    const { result: untrackedResult } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'CommentItem',
        ticketId: 'ticket-1',
        userId: 'user-1',
        trackDraftUploads: false,
        onDiscard: vi.fn(),
        onDocumentsChanged,
        uploadDocumentAction,
        toastApi: { error: vi.fn(), success: vi.fn() },
      })
    );

    await act(async () => {
      await untrackedResult.current.uploadFile(new File(['2'], 'two.png', { type: 'image/png' }));
    });

    expect(untrackedResult.current.draftClipboardImages).toEqual([]);
  });

  it('opens a keep/delete dialog only when tracked draft uploads exist and keep clears the session', async () => {
    const { useTicketRichTextUploadSession } = await loadHook();
    const onDiscard = vi.fn();
    const { result } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'TicketConversation',
        ticketId: 'ticket-1',
        userId: 'user-1',
        trackDraftUploads: true,
        onDiscard,
        uploadDocumentAction: vi.fn().mockResolvedValue(createUploadResult('doc-1', 'file-1')),
        toastApi: { error: vi.fn(), success: vi.fn() },
      })
    );

    act(() => {
      result.current.requestDiscard();
    });
    expect(result.current.showDraftCancelDialog).toBe(false);
    expect(onDiscard).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.uploadFile(new File(['1'], 'one.png', { type: 'image/png' }));
    });

    act(() => {
      result.current.requestDiscard();
    });
    expect(result.current.showDraftCancelDialog).toBe(true);

    act(() => {
      result.current.keepDraftClipboardImages();
    });
    expect(result.current.showDraftCancelDialog).toBe(false);
    expect(result.current.draftClipboardImages).toEqual([]);
    expect(onDiscard).toHaveBeenCalledTimes(2);
  });

  it('deletes tracked drafts, refreshes documents, and reports mixed outcomes', async () => {
    const { useTicketRichTextUploadSession } = await loadHook();
    const onDiscard = vi.fn();
    const onDocumentsChanged = vi.fn();
    const toastApi = { error: vi.fn(), success: vi.fn() };
    const deleteDraftClipboardImagesAction = vi.fn().mockResolvedValue({
      deletedDocumentIds: ['doc-1'],
      failures: [{ documentId: 'doc-2', reason: 'already_referenced' }],
    });

    const { result } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'TicketInfo',
        ticketId: 'ticket-1',
        userId: 'user-1',
        trackDraftUploads: true,
        onDiscard,
        onDocumentsChanged,
        uploadDocumentAction: vi
          .fn()
          .mockResolvedValueOnce(createUploadResult('doc-1', 'file-1'))
          .mockResolvedValueOnce(createUploadResult('doc-2', 'file-2')),
        deleteDraftClipboardImagesAction,
        toastApi,
      })
    );

    await act(async () => {
      await result.current.uploadFile(new File(['1'], 'one.png', { type: 'image/png' }));
      await result.current.uploadFile(new File(['2'], 'two.png', { type: 'image/png' }));
    });

    await waitFor(() => expect(result.current.draftClipboardImages).toHaveLength(2));

    await act(async () => {
      await result.current.deleteTrackedDraftClipboardImages();
    });

    expect(deleteDraftClipboardImagesAction).toHaveBeenCalledWith({
      ticketId: 'ticket-1',
      documentIds: ['doc-1', 'doc-2'],
    });
    expect(onDocumentsChanged).toHaveBeenCalledTimes(3);
    expect(toastApi.success).toHaveBeenCalledWith('Deleted 1 pasted image.');
    expect(toastApi.error).toHaveBeenCalledWith('Could not delete 1 pasted image.');
    expect(result.current.draftClipboardImages).toEqual([]);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('uses injected view/download URL resolver when provided', async () => {
    const { useTicketRichTextUploadSession } = await loadHook();
    const uploadDocumentAction = vi.fn().mockResolvedValue(createUploadResult('doc-42', 'file-42'));
    const resolveDocumentViewUrl = vi.fn().mockReturnValue('/algadesk/attachments/file-42');

    const { result } = renderHook(() =>
      useTicketRichTextUploadSession({
        componentLabel: 'TicketConversation',
        ticketId: 'ticket-1',
        userId: 'user-1',
        trackDraftUploads: true,
        onDiscard: vi.fn(),
        uploadDocumentAction,
        resolveDocumentViewUrl,
        toastApi: { error: vi.fn(), success: vi.fn() },
      })
    );

    let resolvedUrl = '';
    await act(async () => {
      resolvedUrl = await result.current.uploadFile(new File(['1'], 'one.png', { type: 'image/png' }));
    });

    expect(resolveDocumentViewUrl).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: 'doc-42', file_id: 'file-42' })
    );
    expect(resolvedUrl).toBe('/algadesk/attachments/file-42');
    expect(result.current.draftClipboardImages[0]?.url).toBe('/algadesk/attachments/file-42');
  });
});
